"""台灣股票 ML 預測模組 - XGBoost + LightGBM ensemble"""
import argparse
import json
import os
import warnings
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")


class FeatureEngineer:
    """特徵工程（自適應資料量 + 可選跨資產特徵）"""

    @staticmethod
    def _add_market_features(data: pd.DataFrame, market_df: pd.DataFrame) -> pd.DataFrame:
        """加入大盤（0050）跨資產特徵：相對強弱、市場趨勢、相關性"""
        m = market_df[["date", "close", "volume"]].copy()
        m["date"] = pd.to_datetime(m["date"])
        m = m.rename(columns={"close": "mkt_close", "volume": "mkt_volume"})
        m["mkt_returns"] = m["mkt_close"].pct_change()
        m["mkt_ret_5"] = m["mkt_close"].pct_change(5)
        m["mkt_ret_20"] = m["mkt_close"].pct_change(20)
        m["mkt_vol_20"] = m["mkt_returns"].rolling(20).std()
        m["mkt_ma_20"] = m["mkt_close"].rolling(20).mean()
        m["mkt_above_ma20"] = (m["mkt_close"] > m["mkt_ma_20"]).astype(int)

        data["date"] = pd.to_datetime(data["date"])
        merged = data.merge(
            m[["date", "mkt_returns", "mkt_ret_5", "mkt_ret_20",
               "mkt_vol_20", "mkt_above_ma20"]],
            on="date", how="left",
        )
        # 相對強弱：個股報酬 - 大盤報酬
        merged["rel_strength_1"] = merged["returns"] - merged["mkt_returns"]
        merged["rel_strength_5"] = merged["close"].pct_change(5) - merged["mkt_ret_5"]
        merged["rel_strength_20"] = merged["close"].pct_change(20) - merged["mkt_ret_20"]
        # 與大盤滾動相關性（20 日）
        merged["mkt_corr_20"] = merged["returns"].rolling(20).corr(merged["mkt_returns"])
        return merged

    @staticmethod
    def _add_institutional_features(data: pd.DataFrame, inst_df: pd.DataFrame) -> pd.DataFrame:
        """加入法人籌碼特徵：買賣超累計、連買天數、融資融券變化、券資比"""
        from institutional_data import create_institutional_features

        inst = create_institutional_features(inst_df)
        inst["date"] = pd.to_datetime(inst["date"])
        data["date"] = pd.to_datetime(data["date"])

        # 選擇要合併的特徵欄位（排除原始欄位，只保留衍生特徵）
        feature_cols = [c for c in inst.columns if c != "date" and (
            "_5d" in c or "_10d" in c or "_20d" in c or
            "streak" in c or "change" in c or "ratio" in c
        )]
        merge_cols = ["date"] + feature_cols

        merged = data.merge(inst[merge_cols], on="date", how="left")

        # 法人買賣超佔成交量比例
        if "total_institutional_net" in inst.columns and "volume" in merged.columns:
            inst_vol = inst[["date", "total_institutional_net"]].copy()
            merged = merged.merge(inst_vol, on="date", how="left", suffixes=("", "_raw"))
            merged["inst_volume_ratio"] = np.where(
                merged["volume"] > 0,
                merged["total_institutional_net"] / merged["volume"],
                0,
            )
            # 移除合併用的臨時欄位
            if "total_institutional_net_raw" in merged.columns:
                merged.drop(columns=["total_institutional_net_raw"], inplace=True)
            if "total_institutional_net" in merged.columns:
                merged.drop(columns=["total_institutional_net"], inplace=True)

        # forward-fill 籌碼特徵（交易日缺漏）
        for col in feature_cols + ["inst_volume_ratio"]:
            if col in merged.columns:
                merged[col] = merged[col].ffill()

        return merged

    @staticmethod
    def create_features(df: pd.DataFrame, market_df: Optional[pd.DataFrame] = None,
                        institutional_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
        data = df.copy()
        n = len(data)

        # 根據資料量選擇窗口：資料太少時用小窗口
        if n >= 120:
            ma_windows = [5, 10, 20, 60]
            vol_windows = [5, 20]
        elif n >= 60:
            ma_windows = [5, 10, 20]
            vol_windows = [5, 10]
        else:
            ma_windows = [3, 5, 10]
            vol_windows = [3, 5]

        # 價格特徵
        data["returns"] = data["close"].pct_change()
        data["log_returns"] = np.log(data["close"] / data["close"].shift(1))

        # 移動平均
        for w in ma_windows:
            data[f"ma_{w}"] = data["close"].rolling(w).mean()
            data[f"ma_ratio_{w}"] = data["close"] / data[f"ma_{w}"]

        # 波動率
        for w in vol_windows:
            data[f"volatility_{w}"] = data["returns"].rolling(w).std()

        # RSI（資料太少時縮短期間）
        rsi_period = 14 if n >= 60 else 7
        delta = data["close"].diff()
        gain = delta.where(delta > 0, 0).rolling(rsi_period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(rsi_period).mean()
        rs = gain / loss
        data["rsi"] = 100 - (100 / (1 + rs))

        # MACD
        ema12 = data["close"].ewm(span=12).mean()
        ema26 = data["close"].ewm(span=26).mean()
        data["macd"] = ema12 - ema26
        data["macd_signal"] = data["macd"].ewm(span=9).mean()

        # 成交量特徵
        vol_win = 20 if n >= 60 else 10
        data["volume_ratio"] = data["volume"] / data["volume"].rolling(vol_win).mean()
        data["volume_change"] = data["volume"].pct_change()

        # 價格位置
        data["high_low_ratio"] = (data["close"] - data["low"]) / (data["high"] - data["low"] + 1e-8)

        # Lag features
        for lag in [1, 2, 3, 5]:
            data[f"return_lag_{lag}"] = data["returns"].shift(lag)

        # 跨資產特徵（若提供大盤資料）
        if market_df is not None and not market_df.empty:
            data = FeatureEngineer._add_market_features(data, market_df)

        # 法人籌碼特徵（若提供籌碼資料）
        if institutional_df is not None and not institutional_df.empty:
            data = FeatureEngineer._add_institutional_features(data, institutional_df)

        return data.dropna().reset_index(drop=True)


class StockPredictor:
    """股價預測器（XGBoost + LightGBM ensemble，回歸 + 分類雙頭）"""

    def __init__(self, ensemble: bool = True, params: Optional[dict] = None):
        self.ensemble = ensemble
        self.params = params or {}
        self.reg_models = []
        self.clf_models = []
        self.scaler = StandardScaler()
        self.feature_cols = None

    def _build_reg_xgb(self):
        from xgboost import XGBRegressor
        p = self.params.get("xgb_reg", {})
        return XGBRegressor(
            n_estimators=p.get("n_estimators", 100),
            max_depth=p.get("max_depth", 5),
            learning_rate=p.get("learning_rate", 0.1),
            subsample=p.get("subsample", 0.8),
            colsample_bytree=p.get("colsample_bytree", 0.8),
            reg_alpha=p.get("reg_alpha", 0.0),
            reg_lambda=p.get("reg_lambda", 1.0),
            random_state=42, verbosity=0,
        )

    def _build_reg_lgb(self):
        from lightgbm import LGBMRegressor
        p = self.params.get("lgb_reg", {})
        return LGBMRegressor(
            n_estimators=p.get("n_estimators", 100),
            max_depth=p.get("max_depth", -1),
            num_leaves=p.get("num_leaves", 31),
            learning_rate=p.get("learning_rate", 0.1),
            subsample=p.get("subsample", 0.8),
            colsample_bytree=p.get("colsample_bytree", 0.8),
            reg_alpha=p.get("reg_alpha", 0.0),
            reg_lambda=p.get("reg_lambda", 0.0),
            random_state=42, verbosity=-1,
        )

    def _build_clf_xgb(self):
        from xgboost import XGBClassifier
        p = self.params.get("xgb_clf", {})
        return XGBClassifier(
            n_estimators=p.get("n_estimators", 100),
            max_depth=p.get("max_depth", 5),
            learning_rate=p.get("learning_rate", 0.1),
            subsample=p.get("subsample", 0.8),
            colsample_bytree=p.get("colsample_bytree", 0.8),
            random_state=42, verbosity=0, eval_metric="logloss",
        )

    def _build_clf_lgb(self):
        from lightgbm import LGBMClassifier
        p = self.params.get("lgb_clf", {})
        return LGBMClassifier(
            n_estimators=p.get("n_estimators", 100),
            max_depth=p.get("max_depth", -1),
            num_leaves=p.get("num_leaves", 31),
            learning_rate=p.get("learning_rate", 0.1),
            subsample=p.get("subsample", 0.8),
            colsample_bytree=p.get("colsample_bytree", 0.8),
            random_state=42, verbosity=-1,
        )

    # 保留舊介面（給 backtest.py 使用）
    def _build_reg(self):
        return self._build_reg_xgb()

    def _build_clf(self):
        return self._build_clf_xgb()

    def _fit_ensemble(self, X, y_reg, y_cls):
        """訓練 ensemble 模型"""
        self.reg_models = [self._build_reg_xgb()]
        self.reg_models[0].fit(X, y_reg)

        if self.ensemble:
            try:
                lgb = self._build_reg_lgb()
                lgb.fit(X, y_reg)
                self.reg_models.append(lgb)
            except Exception:
                pass

        if len(np.unique(y_cls)) > 1:
            self.clf_models = [self._build_clf_xgb()]
            self.clf_models[0].fit(X, y_cls)
            if self.ensemble:
                try:
                    lgb = self._build_clf_lgb()
                    lgb.fit(X, y_cls)
                    self.clf_models.append(lgb)
                except Exception:
                    pass

    def _predict_ensemble(self, X):
        """ensemble 預測（平均）"""
        reg_preds = np.mean([m.predict(X) for m in self.reg_models], axis=0)
        if self.clf_models:
            prob_preds = np.mean(
                [m.predict_proba(X)[:, 1] for m in self.clf_models], axis=0
            )
        else:
            prob_preds = np.full(len(X), 0.5)
        return reg_preds, prob_preds

    # 相容舊版的 reg_model / clf_model 屬性
    @property
    def reg_model(self):
        return self.reg_models[0] if self.reg_models else None

    @reg_model.setter
    def reg_model(self, value):
        self.reg_models = [value] if value is not None else []

    @property
    def clf_model(self):
        return self.clf_models[0] if self.clf_models else None

    @clf_model.setter
    def clf_model(self, value):
        self.clf_models = [value] if value is not None else []

    @staticmethod
    def _signal(predicted_return: float, prob_up: float, vol: float,
                cost: float = 0.005, prob_threshold: float = 0.55) -> dict:
        """綜合訊號：預測報酬 > 成本 + 安全邊際，且機率 > 閾值"""
        safety = max(vol * 0.5, 0.003)
        threshold = cost + safety

        if predicted_return > threshold and prob_up > prob_threshold:
            action = "BUY"
            reason = f"預測報酬 {predicted_return*100:.2f}% > 門檻 {threshold*100:.2f}%，上漲機率 {prob_up*100:.0f}%"
        elif predicted_return < -threshold and prob_up < (1 - prob_threshold):
            action = "SELL"
            reason = f"預測報酬 {predicted_return*100:.2f}% < -{threshold*100:.2f}%，上漲機率僅 {prob_up*100:.0f}%"
        else:
            action = "HOLD"
            reason = f"訊號不足（預測 {predicted_return*100:.2f}%, 機率 {prob_up*100:.0f}%, 門檻 ±{threshold*100:.2f}%）"

        return {"action": action, "reason": reason, "threshold": round(threshold * 100, 2)}

    def predict(self, df: pd.DataFrame, days_ahead: int = 5,
                market_df: Optional[pd.DataFrame] = None,
                institutional_df: Optional[pd.DataFrame] = None) -> dict:
        """預測未來走勢（ensemble 回歸 + 分類 + 訊號）"""
        try:
            import xgboost  # noqa: F401
        except ImportError:
            return {"error": "需要安裝 xgboost: pip install xgboost"}

        data = FeatureEngineer.create_features(df, market_df=market_df, institutional_df=institutional_df)
        if len(data) < 30:
            return {
                "error": f"資料不足（需要至少 30 筆有效樣本，目前 {len(data)} 筆）",
                "hint": "請抓取更多歷史資料：python scripts/fetch_stock_data.py --code <code> --action history --days 365 --save",
            }

        original_days = days_ahead
        max_train_required = 20
        exclude = ["date", "target", "target_cls", "open", "high", "low", "close", "volume"]
        self.feature_cols = [c for c in data.columns if c not in exclude]

        train_data = None
        for try_days in [days_ahead, 3, 2, 1]:
            data["target"] = data["close"].shift(-try_days) / data["close"] - 1
            data["target_cls"] = (data["target"] > 0).astype(int)
            train_data = data.dropna(subset=["target"])
            if len(train_data) >= max_train_required:
                days_ahead = try_days
                break
        else:
            return {
                "error": f"訓練資料不足（需要 {max_train_required} 筆有效樣本）",
                "hint": "請抓取更多歷史資料",
            }

        X_train = train_data[self.feature_cols].values
        y_reg = train_data["target"].values
        y_cls = train_data["target_cls"].values
        X_train_scaled = self.scaler.fit_transform(X_train)

        self._fit_ensemble(X_train_scaled, y_reg, y_cls)

        latest = data.iloc[-1:][self.feature_cols].values
        latest_scaled = self.scaler.transform(latest)
        reg_preds, prob_preds = self._predict_ensemble(latest_scaled)
        predicted_return = float(reg_preds[0])
        prob_up = float(prob_preds[0])

        current_price = float(df["close"].iloc[-1])
        predicted_price = current_price * (1 + predicted_return)

        vol_col = next((c for c in ["volatility_20", "volatility_10", "volatility_5", "volatility_3"] if c in data.columns), None)
        recent_vol = float(data[vol_col].iloc[-1]) if vol_col else 0.02
        confidence_range = recent_vol * np.sqrt(days_ahead) * current_price

        signal = self._signal(predicted_return, prob_up, recent_vol)

        # 集成特徵重要性（取第一個模型）
        importance = dict(zip(
            self.feature_cols,
            [float(x) for x in self.reg_models[0].feature_importances_]
        ))
        top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:5]

        model_name = "XGB+LGB ensemble" if len(self.reg_models) > 1 else "XGBoost"

        return {
            "current_price": round(current_price, 2),
            "predicted_price": round(predicted_price, 2),
            "predicted_return": round(predicted_return * 100, 2),
            "prob_up": round(prob_up * 100, 1),
            "days_ahead": days_ahead,
            "confidence": {
                "high": round(predicted_price + confidence_range, 2),
                "low": round(predicted_price - confidence_range, 2),
                "volatility": round(recent_vol * 100, 2),
            },
            "signal": signal,
            "direction": "上漲" if predicted_return > 0.005 else ("下跌" if predicted_return < -0.005 else "持平"),
            "top_features": top_features,
            "model": model_name,
            "train_samples": len(train_data),
            "note": (f"原請求 {original_days} 天，因資料量自動調整為 {days_ahead} 天"
                     if original_days != days_ahead else None),
        }


def load_market_df(data_dir: str, market_code: str = "0050") -> Optional[pd.DataFrame]:
    """載入大盤資料（預設 0050），找不到回傳 None"""
    path = os.path.join(data_dir, f"{market_code}_history.csv")
    if not os.path.exists(path):
        return None
    try:
        return pd.read_csv(path, parse_dates=["date"])
    except Exception:
        return None


def load_or_fetch(code: str, data_dir: str, min_rows: int = 200) -> pd.DataFrame:
    """載入歷史資料，若不存在或資料不足則自動抓取（逐步加大天數）"""
    csv_path = os.path.join(data_dir, f"{code}_history.csv")

    df = None
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path, parse_dates=["date"])

    # 資料足夠直接回傳
    if df is not None and len(df) >= min_rows:
        return df

    # 動態抓取：依序嘗試 365 / 730 / 1095 天
    try:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from fetch_stock_data import TWStockFetcher
    except ImportError as e:
        print(f"⚠️  無法匯入 fetcher: {e}")
        return df if df is not None else pd.DataFrame()

    fetcher = TWStockFetcher()
    os.makedirs(data_dir, exist_ok=True)

    for days in [365, 730, 1095]:
        print(f"資料不足（{len(df) if df is not None else 0} 筆），自動抓取近 {days} 天...")
        try:
            df = fetcher.get_history(code, days)
            if df is not None and not df.empty:
                df.to_csv(csv_path, index=False)
                print(f"已抓取 {len(df)} 筆並儲存")
                if len(df) >= min_rows:
                    return df
        except Exception as e:
            print(f"抓取 {days} 天失敗: {e}")

    return df if df is not None else pd.DataFrame()


def main():
    parser = argparse.ArgumentParser(description="台灣股票 ML 預測")
    parser.add_argument("--code", required=True, help="股票代碼")
    parser.add_argument("--days_ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--model", default="xgboost", help="模型類型")
    parser.add_argument("--data-dir", default="data", help="資料目錄")
    parser.add_argument("--auto-fetch", action="store_true", default=True, help="資料不足時自動抓取（預設開啟）")
    parser.add_argument("--no-auto-fetch", dest="auto_fetch", action="store_false", help="關閉自動抓取")
    parser.add_argument("--market-code", default="0050", help="大盤代理代碼（預設 0050）")
    parser.add_argument("--no-market", action="store_true", help="不使用跨資產特徵")
    parser.add_argument("--params", help="載入優化參數 JSON")
    args = parser.parse_args()

    csv_path = os.path.join(args.data_dir, f"{args.code}_history.csv")

    if args.auto_fetch:
        df = load_or_fetch(args.code, args.data_dir)
    else:
        if not os.path.exists(csv_path):
            print(f"找不到歷史資料: {csv_path}")
            print(f"請先執行: python scripts/fetch_stock_data.py --code {args.code} --action history --save")
            return
        df = pd.read_csv(csv_path, parse_dates=["date"])

    if df is None or df.empty:
        print(json.dumps({"error": "無法取得任何歷史資料"}, ensure_ascii=False, indent=2))
        return

    market_df = None if args.no_market else load_market_df(args.data_dir, args.market_code)

    # 載入籌碼資料（若存在）
    institutional_df = None
    try:
        from institutional_data import load_institutional_df
        institutional_df = load_institutional_df(args.code, args.data_dir)
    except ImportError:
        pass

    params = None
    if args.params and os.path.exists(args.params):
        with open(args.params, encoding="utf-8") as f:
            params = json.load(f)

    predictor = StockPredictor(params=params)
    result = predictor.predict(df, args.days_ahead, market_df=market_df, institutional_df=institutional_df)
    if market_df is not None:
        result["market_features"] = f"已納入大盤代理 {args.market_code}"
    if institutional_df is not None:
        result["institutional_features"] = f"已納入籌碼特徵（{len(institutional_df)} 筆）"

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
