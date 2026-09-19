"""Walk-forward 回測框架

用滾動視窗訓練 + 測試，模擬真實交易場景，回報：
- MAE / RMSE / 方向命中率
- 策略累計報酬 / 年化報酬 / Sharpe / 最大回撤
- 交易次數 / 勝率
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


def walk_forward_backtest(
    df: pd.DataFrame,
    days_ahead: int = 5,
    train_window: int = 120,
    step: int = 5,
    cost: float = 0.005,
    params: Optional[dict] = None,
    ensemble: bool = True,
    market_df: Optional[pd.DataFrame] = None,
    stop_loss: float = 0.0,
    take_profit: float = 0.0,
    stop_loss_atr_mult: float = 0.0,
    position_size: float = 0.1,
) -> dict:
    """滾動回測

    Args:
        df: 歷史價格資料（需含 date/open/high/low/close/volume）
        days_ahead: 預測未來幾天
        train_window: 訓練視窗大小（天數）
        step: 每次滑動的天數
        cost: 單次交易成本
        params: 最佳超參數
        ensemble: 是否使用 XGB+LGB 集成
        market_df: 大盤代理資料
        stop_loss: 固定止損幅度（0.05 = 5%），0 表示不啟用
        take_profit: 固定止盈幅度，0 表示不啟用
        stop_loss_atr_mult: ATR 動態止損倍數（例 2.0，0 表示不啟用），使用時會覆蓋 stop_loss
        position_size: 每筆交易使用資金比例（0.1 = 10%），避免滿倉複利幻覺
    """
    """滾動回測

    Args:
        df: 歷史價格資料（需含 date/open/high/low/close/volume）
        days_ahead: 預測未來幾天
        train_window: 訓練視窗大小（天數）
        step: 每次滑動的天數
        cost: 單次交易成本（含手續費+滑點），預設 0.5%
        params: 最佳超參數（從 Optuna 載入）
        ensemble: 是否使用 XGB+LGB 集成
    """
    data = FeatureEngineer.create_features(df, market_df=market_df)
    if len(data) < train_window + days_ahead + 10:
        return {
            "error": f"資料不足（需要至少 {train_window + days_ahead + 10} 筆，目前 {len(data)} 筆）",
            "hint": "請抓取更多歷史資料或減小 train_window",
        }

    # ATR(14) 計算（供動態止損）
    h = data["high"]
    l = data["low"]
    c_prev = data["close"].shift(1)
    tr = pd.concat([h - l, (h - c_prev).abs(), (l - c_prev).abs()], axis=1).max(axis=1)
    data["atr14"] = tr.rolling(14).mean()
    data["atr_pct"] = data["atr14"] / data["close"]

    # 建立目標
    data["target"] = data["close"].shift(-days_ahead) / data["close"] - 1
    data["target_cls"] = (data["target"] > 0).astype(int)
    exclude = ["date", "target", "target_cls", "open", "high", "low", "close", "volume"]
    feature_cols = [c for c in data.columns if c not in exclude]

    predictions = []
    end = len(data) - days_ahead

    i = train_window
    while i < end:
        train = data.iloc[i - train_window : i].dropna(subset=["target"])
        if len(train) < 20:
            i += step
            continue

        test = data.iloc[i : i + step]
        if len(test) == 0:
            break

        predictor = StockPredictor(ensemble=ensemble, params=params)
        predictor.feature_cols = feature_cols
        X_train = train[feature_cols].values
        X_train_scaled = predictor.scaler.fit_transform(X_train)
        predictor._fit_ensemble(
            X_train_scaled,
            train["target"].values,
            train["target_cls"].values,
        )

        for j in range(len(test)):
            row = test.iloc[j : j + 1]
            if pd.isna(row["target"].iloc[0]):
                continue
            X = predictor.scaler.transform(row[feature_cols].values)
            reg_p, prob_p = predictor._predict_ensemble(X)
            pred_ret = float(reg_p[0])
            prob_up = float(prob_p[0])
            actual_ret = float(row["target"].iloc[0])

            # 抓取持倉期間的 daily high/low（供止損止盈判斷）
            entry_idx = data.index[data["date"] == row["date"].iloc[0]]
            entry_price = float(row["close"].iloc[0])
            entry_atr_pct = float(row["atr_pct"].iloc[0]) if not pd.isna(row["atr_pct"].iloc[0]) else 0.02
            # 決定本筆交易的止損幅度：ATR 優先，否則用固定
            effective_stop = entry_atr_pct * stop_loss_atr_mult if stop_loss_atr_mult > 0 else stop_loss
            future_low_pct = 0.0
            future_high_pct = 0.0
            stop_hit_day = -1
            tp_hit_day = -1
            if len(entry_idx) > 0:
                start = entry_idx[0] + 1
                hold = data.iloc[start : start + days_ahead]
                for d_idx in range(len(hold)):
                    low_pct = float(hold["low"].iloc[d_idx]) / entry_price - 1
                    high_pct = float(hold["high"].iloc[d_idx]) / entry_price - 1
                    if low_pct < future_low_pct:
                        future_low_pct = low_pct
                    if high_pct > future_high_pct:
                        future_high_pct = high_pct
                    if stop_hit_day < 0 and effective_stop > 0 and low_pct <= -effective_stop:
                        stop_hit_day = d_idx
                    if tp_hit_day < 0 and take_profit > 0 and high_pct >= take_profit:
                        tp_hit_day = d_idx

            predictions.append({
                "date": str(row["date"].iloc[0])[:10] if "date" in row else "",
                "pred_return": pred_ret,
                "prob_up": prob_up,
                "actual_return": actual_ret,
                "stop_hit_day": stop_hit_day,
                "tp_hit_day": tp_hit_day,
                "effective_stop": effective_stop,
                "atr_pct": entry_atr_pct,
                "future_low_pct": future_low_pct,
                "future_high_pct": future_high_pct,
            })

        i += step

    if not predictions:
        return {"error": "回測無有效預測"}

    pred_df = pd.DataFrame(predictions)

    # === 預測準確度 ===
    errors = pred_df["pred_return"] - pred_df["actual_return"]
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    direction_hit = float(np.mean(
        (pred_df["pred_return"] > 0) == (pred_df["actual_return"] > 0)
    ))

    # === 策略績效（訊號觸發時持有 days_ahead 天，含止損止盈）===
    # 訊號規則：預測報酬 > cost+0.3% 且 機率 > 55% → 做多
    safety = 0.003
    threshold = cost + safety
    signals = (
        (pred_df["pred_return"] > threshold) & (pred_df["prob_up"] > 0.55)
    ).astype(int)

    # 按止損/止盈調整實際出場報酬（使用每筆的 effective_stop）
    def _exit_return(r):
        sl_day = r["stop_hit_day"]
        tp_day = r["tp_hit_day"]
        if sl_day >= 0 and (tp_day < 0 or sl_day <= tp_day):
            return -float(r["effective_stop"])
        if tp_day >= 0:
            return take_profit
        return r["actual_return"]

    use_stop = (stop_loss > 0) or (stop_loss_atr_mult > 0)
    if use_stop or take_profit > 0:
        adj_returns = pred_df.apply(_exit_return, axis=1).values
    else:
        adj_returns = pred_df["actual_return"].values

    # 每次交易扣除來回成本
    strategy_returns = np.where(signals == 1, adj_returns - 2 * cost, 0)

    n_trades = int(signals.sum())
    n_stopped = int(((signals == 1) & (pred_df["stop_hit_day"] >= 0)).sum()) if use_stop else 0
    n_take_profit = int(((signals == 1) & (pred_df["tp_hit_day"] >= 0)).sum()) if take_profit > 0 else 0
    avg_stop_pct = float(pred_df.loc[(signals == 1) & (pred_df["stop_hit_day"] >= 0), "effective_stop"].mean()) if n_stopped > 0 else 0.0
    if n_trades > 0:
        wins = int(((signals == 1) & (pd.Series(adj_returns) > 2 * cost)).sum())
        win_rate = wins / n_trades
        avg_return = float(np.mean(strategy_returns[signals == 1]))
    else:
        win_rate = 0.0
        avg_return = 0.0

    # === 雙模型報酬計算 ===
    # 模型 A：滿倉複利（原始模型，可能重疊持倉有偏高假設）
    cum_returns = (1 + pd.Series(strategy_returns)).cumprod()
    total_return_compound = float(cum_returns.iloc[-1] - 1) if len(cum_returns) > 0 else 0.0
    running_max = cum_returns.cummax()
    drawdown = (cum_returns - running_max) / running_max
    max_drawdown_compound = float(drawdown.min()) if len(drawdown) > 0 else 0.0

    # 模型 B：固定資金部位（每筆用 position_size 比例的初始資金，不複利）
    # 更貼近「隨時可關機」的真實交易報酬
    sized_returns = strategy_returns * position_size
    total_return_sized = float(np.sum(sized_returns))
    equity_curve = 1 + np.cumsum(sized_returns)
    eq_max = np.maximum.accumulate(equity_curve)
    max_drawdown_sized = float(np.min((equity_curve - eq_max) / eq_max)) if len(equity_curve) > 0 else 0.0

    # 年化（以滿倉複利為基準）
    holding_days = n_trades * days_ahead
    annual_return = (
        float((1 + total_return_compound) ** (250 / max(holding_days, 1)) - 1)
        if total_return_compound > -1 and holding_days > 0
        else 0.0
    )

    # Sharpe（粗略：每次交易報酬的均值/標準差，年化）
    if n_trades > 1:
        trade_returns = strategy_returns[signals == 1]
        sharpe = (
            float(np.mean(trade_returns) / np.std(trade_returns) * np.sqrt(250 / days_ahead))
            if np.std(trade_returns) > 0 else 0.0
        )
    else:
        sharpe = 0.0

    # === Buy & Hold 對照組 ===
    bh_return = float(df["close"].iloc[-1] / df["close"].iloc[train_window] - 1) if len(df) > train_window else 0.0

    return {
        "config": {
            "train_window": train_window,
            "step": step,
            "days_ahead": days_ahead,
            "cost_per_trade": cost,
        },
        "samples": len(pred_df),
        "accuracy": {
            "mae": round(mae * 100, 3),
            "rmse": round(rmse * 100, 3),
            "direction_hit_rate": round(direction_hit * 100, 2),
        },
        "strategy": {
            "n_trades": n_trades,
            "win_rate": round(win_rate * 100, 2),
            "avg_trade_return": round(avg_return * 100, 3),
            "total_return": round(total_return_compound * 100, 2),
            "annual_return": round(annual_return * 100, 2),
            "sharpe": round(sharpe, 2),
            "max_drawdown": round(max_drawdown_compound * 100, 2),
            "stop_loss": round(stop_loss * 100, 2) if stop_loss > 0 else None,
            "take_profit": round(take_profit * 100, 2) if take_profit > 0 else None,
            "stop_loss_atr_mult": stop_loss_atr_mult if stop_loss_atr_mult > 0 else None,
            "avg_dynamic_stop_pct": round(avg_stop_pct * 100, 2) if avg_stop_pct > 0 else None,
            "n_stopped": n_stopped if use_stop else None,
            "n_take_profit": n_take_profit if take_profit > 0 else None,
        },
        "strategy_realistic": {
            "_note": f"每筆交易使用 {position_size*100:.0f}% 資金，無複利（貼近實戰）",
            "position_size": position_size,
            "total_return": round(total_return_sized * 100, 2),
            "max_drawdown": round(max_drawdown_sized * 100, 2),
        },
        "benchmark": {
            "buy_and_hold_return": round(bh_return * 100, 2),
            "excess_vs_bh": round((total_return_compound - bh_return) * 100, 2),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Walk-forward 回測")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--days_ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--train_window", type=int, default=120, help="訓練視窗")
    parser.add_argument("--step", type=int, default=5, help="滑動步長")
    parser.add_argument("--cost", type=float, default=0.005, help="單次交易成本")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    parser.add_argument("--params", type=data_path, help="從 JSON 載入優化過的超參數（data/models/<code>_best_params.json）")
    parser.add_argument("--no-ensemble", action="store_true", help="只用 XGBoost（關閉 ensemble）")
    parser.add_argument("--market-code", type=stock_code, default="0050", help="大盤代理代碼（預設 0050）")
    parser.add_argument("--no-market", action="store_true", help="不使用跨資產特徵")
    parser.add_argument("--stop-loss", type=float, default=0.0, help="固定止損幅度（0.05 = 5%）")
    parser.add_argument("--take-profit", type=float, default=0.0, help="固定止盈幅度（0.08 = 8%）")
    parser.add_argument("--stop-loss-atr", type=float, default=0.0, help="ATR 動態止損倍數（例 2.0）。設定後覆蓋 --stop-loss")
    parser.add_argument("--position-size", type=float, default=0.1, help="每筆交易資金比例（0.1=10%%）供 realistic 模型使用")
    args = parser.parse_args()

    df = load_or_fetch(args.code, args.data_dir, min_rows=args.train_window + 60)
    if df is None or df.empty:
        print(json.dumps({"error": "無法取得歷史資料"}, ensure_ascii=False, indent=2))
        return

    market_df = None if args.no_market else load_market_df(args.data_dir, args.market_code)

    params = None
    if args.params and os.path.exists(args.params):
        with open(args.params, encoding="utf-8") as f:
            params = json.load(f)

    result = walk_forward_backtest(
        df, args.days_ahead, args.train_window, args.step, args.cost,
        params=params, ensemble=not args.no_ensemble, market_df=market_df,
        stop_loss=args.stop_loss, take_profit=args.take_profit,
        stop_loss_atr_mult=args.stop_loss_atr, position_size=args.position_size,
    )
    if market_df is not None:
        result["market_features"] = f"已納入大盤代理 {args.market_code}"
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
