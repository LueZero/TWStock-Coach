"""台灣股票技術分析模組"""
import argparse
import json
import os

import numpy as np
import pandas as pd


class TechnicalAnalyzer:
    """技術指標計算器"""

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()

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
        return {
            "price": round(self.df["close"].iloc[-1], 2),
            "ma": self.ma(),
            "kd": self.kd(),
            "macd": self.macd(),
            "rsi": self.rsi(),
            "bollinger": self.bollinger(),
            "volume": self.volume_analysis(),
        }

    def generate_signals(self):
        """產生交易訊號"""
        signals = []
        indicators = self.all_indicators()
        price = indicators["price"]

        # MA 訊號
        ma_data = indicators.get("ma", {})
        if ma_data.get("MA5") and ma_data.get("MA20"):
            if ma_data["MA5"] > ma_data["MA20"]:
                signals.append(("MA", "多頭排列", "bullish"))
            else:
                signals.append(("MA", "空頭排列", "bearish"))

        # KD 訊號
        kd_data = indicators.get("kd", {})
        if kd_data:
            if kd_data["K"] > 80:
                signals.append(("KD", f"超買區 K={kd_data['K']}", "bearish"))
            elif kd_data["K"] < 20:
                signals.append(("KD", f"超賣區 K={kd_data['K']}", "bullish"))
            else:
                signals.append(("KD", f"中性 K={kd_data['K']}", "neutral"))

        # MACD 訊號
        macd_data = indicators.get("macd", {})
        if macd_data:
            if macd_data["OSC"] > 0:
                signals.append(("MACD", "正值偏多", "bullish"))
            else:
                signals.append(("MACD", "負值偏空", "bearish"))

        # RSI 訊號
        rsi_data = indicators.get("rsi", {})
        if rsi_data:
            rsi_val = rsi_data["RSI"]
            if rsi_val > 70:
                signals.append(("RSI", f"超買 {rsi_val}", "bearish"))
            elif rsi_val < 30:
                signals.append(("RSI", f"超賣 {rsi_val}", "bullish"))
            else:
                signals.append(("RSI", f"中性 {rsi_val}", "neutral"))

        # 布林訊號
        boll = indicators.get("bollinger", {})
        if boll:
            if price >= boll["upper"]:
                signals.append(("布林", "觸及上軌", "bearish"))
            elif price <= boll["lower"]:
                signals.append(("布林", "觸及下軌", "bullish"))

        # 綜合判斷
        bullish = sum(1 for _, _, s in signals if s == "bullish")
        bearish = sum(1 for _, _, s in signals if s == "bearish")

        if bullish > bearish + 1:
            overall = "偏多"
        elif bearish > bullish + 1:
            overall = "偏空"
        else:
            overall = "中性"

        return {"signals": signals, "overall": overall, "indicators": indicators}


def main():
    parser = argparse.ArgumentParser(description="台灣股票技術分析")
    parser.add_argument("--code", required=True, help="股票代碼")
    parser.add_argument("--indicators", default="all", help="指標類型")
    parser.add_argument("--data-dir", default="data", help="資料目錄")
    args = parser.parse_args()

    # 讀取歷史資料
    csv_path = os.path.join(args.data_dir, f"{args.code}_history.csv")
    if not os.path.exists(csv_path):
        print(f"找不到歷史資料: {csv_path}")
        print(f"請先執行: python scripts/fetch_stock_data.py --code {args.code} --action history --save")
        return

    df = pd.read_csv(csv_path, parse_dates=["date"])
    analyzer = TechnicalAnalyzer(df)

    if args.indicators == "all":
        result = analyzer.generate_signals()
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    else:
        indicators = analyzer.all_indicators()
        print(json.dumps(indicators, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
