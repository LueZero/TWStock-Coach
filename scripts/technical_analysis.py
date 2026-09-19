"""台灣股票技術分析模組"""
import argparse
if __package__:
    from .project_paths import data_path, stock_code
else:
    from project_paths import data_path, stock_code
import json
import os

import numpy as np
import pandas as pd

try:
    from .technical.controller import TechnicalAnalysisController
    from .technical.views import TechnicalAnalysisView
except ImportError:
    from technical.controller import TechnicalAnalysisController
    from technical.views import TechnicalAnalysisView


def validate_history_code(df: pd.DataFrame, code: str) -> None:
    """若歷史資料含來源代碼標記，確認其與使用者請求一致。"""
    if "stock_code" not in df:
        return
    stored_codes = {str(value).strip() for value in df["stock_code"].dropna().unique()}
    if stored_codes and stored_codes != {str(code).strip()}:
        raise ValueError(f"歷史資料代碼不符：要求 {code}，檔案標記為 {', '.join(sorted(stored_codes))}")


class TechnicalAnalyzer:
    """技術指標計算器"""

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self.controller = TechnicalAnalysisController(self.df)

    def ma(self, periods=(5, 10, 20, 60)):
        """移動平均線"""
        result = {}
        for p in periods:
            if len(self.df) >= p:
                result[f"MA{p}"] = round(self.df["close"].rolling(p).mean().iloc[-1], 2)
        return result

    def ema(self, periods=(12, 26)):
        """指數移動平均"""
        result = {}
        for p in periods:
            if len(self.df) >= p:
                result[f"EMA{p}"] = round(self.df["close"].ewm(span=p).mean().iloc[-1], 2)
        return result

    def kd(self, n=9):
        """KD 隨機指標"""
        if len(self.df) < n:
            return {}
        low_n = self.df["low"].rolling(n).min()
        high_n = self.df["high"].rolling(n).max()
        rsv = (self.df["close"] - low_n) / (high_n - low_n) * 100

        k = rsv.ewm(com=2, adjust=False).mean()
        d = k.ewm(com=2, adjust=False).mean()

        return {"K": round(k.iloc[-1], 1), "D": round(d.iloc[-1], 1)}

    def macd(self, fast=12, slow=26, signal=9):
        """MACD 指標"""
        if len(self.df) < slow:
            return {}
        ema_fast = self.df["close"].ewm(span=fast).mean()
        ema_slow = self.df["close"].ewm(span=slow).mean()
        dif = ema_fast - ema_slow
        sig = dif.ewm(span=signal).mean()
        osc = (dif - sig) * 2

        return {
            "DIF": round(dif.iloc[-1], 2),
            "SIGNAL": round(sig.iloc[-1], 2),
            "OSC": round(osc.iloc[-1], 2),
        }

    def rsi(self, period=14):
        """RSI 相對強弱指標"""
        if len(self.df) < period + 1:
            return {}
        delta = self.df["close"].diff()
        gain = delta.where(delta > 0, 0).rolling(period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
        rs = gain / loss
        rsi_val = 100 - (100 / (1 + rs))
        return {"RSI": round(rsi_val.iloc[-1], 1)}

    def bollinger(self, period=20, std_dev=2):
        """布林通道"""
        if len(self.df) < period:
            return {}
        ma = self.df["close"].rolling(period).mean()
        std = self.df["close"].rolling(period).std()
        return {
            "upper": round(ma.iloc[-1] + std_dev * std.iloc[-1], 2),
            "middle": round(ma.iloc[-1], 2),
            "lower": round(ma.iloc[-1] - std_dev * std.iloc[-1], 2),
            "close": round(self.df["close"].iloc[-1], 2),
        }

    def atr(self, period=14):
        """平均真實波幅，用於衡量日常波動與止損距離"""
        if len(self.df) < period + 1:
            return {}
        previous_close = self.df["close"].shift(1)
        true_range = pd.concat([
            self.df["high"] - self.df["low"],
            (self.df["high"] - previous_close).abs(),
            (self.df["low"] - previous_close).abs(),
        ], axis=1).max(axis=1)
        atr_value = true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean().iloc[-1]
        price = self.df["close"].iloc[-1]
        return {
            "ATR": round(atr_value, 2),
            "ATR_pct": round(atr_value / price * 100, 2) if price else 0,
        }

    def adx(self, period=14):
        """ADX/DMI 趨勢強度與方向指標"""
        if len(self.df) < period * 2:
            return {}
        high_diff = self.df["high"].diff()
        low_diff = -self.df["low"].diff()
        plus_dm = high_diff.where((high_diff > low_diff) & (high_diff > 0), 0.0)
        minus_dm = low_diff.where((low_diff > high_diff) & (low_diff > 0), 0.0)
        previous_close = self.df["close"].shift(1)
        true_range = pd.concat([
            self.df["high"] - self.df["low"],
            (self.df["high"] - previous_close).abs(),
            (self.df["low"] - previous_close).abs(),
        ], axis=1).max(axis=1)
        smoothed_tr = true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
        plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
        minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
        directional_sum = plus_di + minus_di
        dx = (100 * (plus_di - minus_di).abs() / directional_sum).where(directional_sum != 0)
        adx_value = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean().iloc[-1]
        return {
            "ADX": round(adx_value, 1) if pd.notna(adx_value) else None,
            "plus_DI": round(plus_di.iloc[-1], 1),
            "minus_DI": round(minus_di.iloc[-1], 1),
        }

    def obv(self, period=20):
        """能量潮，觀察量價累積方向"""
        if len(self.df) < period + 1:
            return {}
        direction = np.sign(self.df["close"].diff()).fillna(0)
        obv_series = (direction * self.df["volume"]).cumsum()
        change = obv_series.iloc[-1] - obv_series.iloc[-period]
        return {
            "OBV": int(obv_series.iloc[-1]),
            "OBV_change": int(change),
            "period": period,
        }

    def support_resistance(self, period=20):
        """近期區間支撐與壓力位"""
        if len(self.df) < period:
            return {}
        support = self.df["low"].rolling(period).min().iloc[-1]
        resistance = self.df["high"].rolling(period).max().iloc[-1]
        price = self.df["close"].iloc[-1]
        return {
            "support": round(support, 2),
            "resistance": round(resistance, 2),
            "support_distance_pct": round((price / support - 1) * 100, 2) if support else 0,
            "resistance_distance_pct": round((resistance / price - 1) * 100, 2) if price else 0,
        }

    def volume_analysis(self):
        """成交量分析"""
        if len(self.df) < 5:
            return {}
        vol_5 = self.df["volume"].rolling(5).mean().iloc[-1]
        vol_today = self.df["volume"].iloc[-1]
        return {
            "volume_today": int(vol_today),
            "volume_ma5": int(vol_5),
            "volume_ratio": round(vol_today / vol_5, 2) if vol_5 > 0 else 0,
        }

    def all_indicators(self):
        """計算所有指標"""
        return self.controller.calculator.all()

    def generate_signals(self):
        """產生交易訊號"""
        result = self.controller.analyze()
        return {
            "signals": [(signal.category, signal.description, signal.direction) for signal in result.signals],
            "overall": result.overall,
            "indicators": result.indicators,
            "patterns": result.patterns,
            "summary": result.summary,
        }


def main():
    parser = argparse.ArgumentParser(description="台灣股票技術分析")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--indicators", default="all", help="指標類型")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    args = parser.parse_args()

    # 讀取歷史資料
    csv_path = data_path(args.data_dir, f"{args.code}_history.csv")
    if not os.path.exists(csv_path):
        print(f"找不到歷史資料: {csv_path}")
        print(f"請先執行: python scripts/fetch_stock_data.py --code {args.code} --action history --save")
        return

    df = pd.read_csv(csv_path, parse_dates=["date"], dtype={"stock_code": str})
    try:
        validate_history_code(df, args.code)
    except ValueError as error:
        print(f"資料驗證失敗: {error}")
        return
    result = TechnicalAnalysisController(df).analyze()
    if args.indicators == "markdown":
        print(TechnicalAnalysisView.markdown(result))
    else:
        print(TechnicalAnalysisView.json(result))


if __name__ == "__main__":
    main()
