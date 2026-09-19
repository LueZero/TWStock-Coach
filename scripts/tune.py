"""Optuna 自動超參數調校

用 walk-forward 回測的方向命中率 + Sharpe 作為優化目標，
搜尋 XGBoost / LightGBM 的最佳超參數組合。

輸出：
- best_params.json (供 prediction_model.py 載入)
- 優化過程紀錄
"""
import argparse
if __package__:
    from .project_paths import data_path, stock_code
else:
    from project_paths import data_path, stock_code
import json
import os
import sys
import warnings
from typing import Optional

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prediction_model import FeatureEngineer, StockPredictor, load_or_fetch, load_market_df

warnings.filterwarnings("ignore")


def _walk_forward_score(
    df_features: pd.DataFrame,
    feature_cols: list,
    params: dict,
    days_ahead: int,
    train_window: int,
    step: int,
) -> dict:
    """以給定參數跑 walk-forward，回傳評估指標"""
    data = df_features.copy()
    data["target"] = data["close"].shift(-days_ahead) / data["close"] - 1
    data["target_cls"] = (data["target"] > 0).astype(int)

    preds, probs, actuals = [], [], []
    end = len(data) - days_ahead
    i = train_window
    while i < end:
        train = data.iloc[i - train_window : i].dropna(subset=["target"])
        if len(train) < 20:
            i += step
            continue
        test = data.iloc[i : i + step]

        predictor = StockPredictor(ensemble=True, params=params)
        predictor.feature_cols = feature_cols
        X_tr = train[feature_cols].values
        X_tr_s = predictor.scaler.fit_transform(X_tr)
        try:
            predictor._fit_ensemble(X_tr_s, train["target"].values, train["target_cls"].values)
        except Exception:
            i += step
            continue

        for j in range(len(test)):
            row = test.iloc[j : j + 1]
            if pd.isna(row["target"].iloc[0]):
                continue
            X = predictor.scaler.transform(row[feature_cols].values)
            r, p = predictor._predict_ensemble(X)
            preds.append(float(r[0]))
            probs.append(float(p[0]))
            actuals.append(float(row["target"].iloc[0]))
        i += step

    if not preds:
        return {"score": -1, "direction_hit": 0, "sharpe": 0, "n": 0}

    preds = np.array(preds)
    probs = np.array(probs)
    actuals = np.array(actuals)

    direction_hit = float(np.mean((preds > 0) == (actuals > 0)))
    mae = float(np.mean(np.abs(preds - actuals)))

    # 訊號策略 Sharpe（僅供參考）
    signals = ((preds > 0.008) & (probs > 0.55)).astype(int)
    strat_ret = np.where(signals == 1, actuals - 0.01, 0)
    if signals.sum() > 1:
        trade_rets = strat_ret[signals == 1]
        sharpe = float(np.mean(trade_rets) / (np.std(trade_rets) + 1e-8) * np.sqrt(250 / days_ahead))
    else:
        sharpe = 0.0

    # 評分：以方向命中率為主，減去 MAE 懲罰，讓模型必須「獲胝且估準」
    # MAE 通常 0.02~0.05，所以乘 2 讓等級與 hit 相當
    score = direction_hit - 2.0 * mae

    return {
        "score": score,
        "direction_hit": direction_hit,
        "mae": mae,
        "sharpe": sharpe,
        "n_signals": int(signals.sum()),
        "n_predictions": len(preds),
    }


def optimize(
    code: str,
    data_dir: str = "data",
    days_ahead: int = 5,
    train_window: int = 120,
    step: int = 5,
    n_trials: int = 30,
    market_code: Optional[str] = "0050",
) -> dict:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    df = load_or_fetch(code, data_dir, min_rows=train_window + 60)
    if df is None or df.empty:
        return {"error": "無法取得歷史資料"}

    market_df = load_market_df(data_dir, market_code) if market_code else None
    df_features = FeatureEngineer.create_features(df, market_df=market_df)
    exclude = ["date", "target", "target_cls", "open", "high", "low", "close", "volume"]
    feature_cols = [c for c in df_features.columns if c not in exclude]

    def objective(trial):
        params = {
            "xgb_reg": {
                "n_estimators": trial.suggest_int("xgb_n", 50, 300, step=50),
                "max_depth": trial.suggest_int("xgb_depth", 3, 8),
                "learning_rate": trial.suggest_float("xgb_lr", 0.01, 0.3, log=True),
                "subsample": trial.suggest_float("xgb_sub", 0.6, 1.0),
                "colsample_bytree": trial.suggest_float("xgb_col", 0.6, 1.0),
                "reg_alpha": trial.suggest_float("xgb_alpha", 0.0, 1.0),
                "reg_lambda": trial.suggest_float("xgb_lambda", 0.5, 5.0),
            },
            "lgb_reg": {
                "n_estimators": trial.suggest_int("lgb_n", 50, 300, step=50),
                "num_leaves": trial.suggest_int("lgb_leaves", 15, 127),
                "learning_rate": trial.suggest_float("lgb_lr", 0.01, 0.3, log=True),
                "subsample": trial.suggest_float("lgb_sub", 0.6, 1.0),
                "colsample_bytree": trial.suggest_float("lgb_col", 0.6, 1.0),
                "reg_alpha": trial.suggest_float("lgb_alpha", 0.0, 1.0),
                "reg_lambda": trial.suggest_float("lgb_lambda", 0.0, 5.0),
            },
        }
        # 分類頭沿用回歸的核心參數
        params["xgb_clf"] = {
            "n_estimators": params["xgb_reg"]["n_estimators"],
            "max_depth": params["xgb_reg"]["max_depth"],
            "learning_rate": params["xgb_reg"]["learning_rate"],
            "subsample": params["xgb_reg"]["subsample"],
            "colsample_bytree": params["xgb_reg"]["colsample_bytree"],
        }
        params["lgb_clf"] = {
            "n_estimators": params["lgb_reg"]["n_estimators"],
            "num_leaves": params["lgb_reg"]["num_leaves"],
            "learning_rate": params["lgb_reg"]["learning_rate"],
            "subsample": params["lgb_reg"]["subsample"],
            "colsample_bytree": params["lgb_reg"]["colsample_bytree"],
        }

        res = _walk_forward_score(df_features, feature_cols, params, days_ahead, train_window, step)
        return res["score"]

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    # 重新計算最佳參數的細節
    best_trial = study.best_trial
    best_params = {
        "xgb_reg": {
            "n_estimators": best_trial.params["xgb_n"],
            "max_depth": best_trial.params["xgb_depth"],
            "learning_rate": best_trial.params["xgb_lr"],
            "subsample": best_trial.params["xgb_sub"],
            "colsample_bytree": best_trial.params["xgb_col"],
            "reg_alpha": best_trial.params["xgb_alpha"],
            "reg_lambda": best_trial.params["xgb_lambda"],
        },
        "lgb_reg": {
            "n_estimators": best_trial.params["lgb_n"],
            "num_leaves": best_trial.params["lgb_leaves"],
            "learning_rate": best_trial.params["lgb_lr"],
            "subsample": best_trial.params["lgb_sub"],
            "colsample_bytree": best_trial.params["lgb_col"],
            "reg_alpha": best_trial.params["lgb_alpha"],
            "reg_lambda": best_trial.params["lgb_lambda"],
        },
    }
    best_params["xgb_clf"] = {k: v for k, v in best_params["xgb_reg"].items()
                              if k in ["n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree"]}
    best_params["lgb_clf"] = {k: v for k, v in best_params["lgb_reg"].items()
                              if k in ["n_estimators", "num_leaves", "learning_rate", "subsample", "colsample_bytree"]}

    final = _walk_forward_score(df_features, feature_cols, best_params, days_ahead, train_window, step)

    return {
        "code": code,
        "n_trials": n_trials,
        "best_score": round(study.best_value, 4),
        "best_metrics": {
            "direction_hit_rate": round(final["direction_hit"] * 100, 2),
            "mae": round(final["mae"] * 100, 3),
            "sharpe": round(final["sharpe"], 2),
            "n_signals": final["n_signals"],
            "n_predictions": final["n_predictions"],
        },
        "best_params": best_params,
    }


def main():
    parser = argparse.ArgumentParser(description="Optuna 超參數調校")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--days_ahead", type=int, default=5)
    parser.add_argument("--train_window", type=int, default=120)
    parser.add_argument("--step", type=int, default=5)
    parser.add_argument("--n_trials", type=int, default=30, help="優化次數")
    parser.add_argument("--data-dir", type=data_path, default="data")
    parser.add_argument("--save", action="store_true", help="儲存最佳參數到 data/models/<code>_best_params.json")
    parser.add_argument("--market-code", type=stock_code, default="0050", help="大盤代理代碼")
    parser.add_argument("--no-market", action="store_true", help="不使用跨資產特徵")
    args = parser.parse_args()

    print(f"開始優化 {args.code}（{args.n_trials} trials）...")
    result = optimize(
        args.code, args.data_dir, args.days_ahead,
        args.train_window, args.step, args.n_trials,
        market_code=None if args.no_market else args.market_code,
    )

    print(json.dumps({k: v for k, v in result.items() if k != "best_params"},
                     ensure_ascii=False, indent=2))

    if args.save and "best_params" in result:
        os.makedirs(data_path(args.data_dir, "models"), exist_ok=True)
        path = data_path(args.data_dir, "models", f"{args.code}_best_params.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result["best_params"], f, ensure_ascii=False, indent=2)
        print(f"\n最佳參數已儲存至: {path}")


if __name__ == "__main__":
    main()
