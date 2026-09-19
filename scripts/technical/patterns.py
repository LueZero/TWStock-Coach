"""規則化的 K 線與圖表型態偵測 Model。"""
import numpy as np
import pandas as pd

from .indicators import IndicatorCalculator


class PatternDetector:
    """只回報符合明確條件的候選型態，不宣稱預測必然成立。"""

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy().reset_index(drop=True)

    def _candle(self, index):
        row = self.df.iloc[index]
        body = abs(row["close"] - row["open"])
        candle_range = max(row["high"] - row["low"], 1e-9)
        return {"open": row["open"], "high": row["high"], "low": row["low"], "close": row["close"], "body": body, "range": candle_range, "upper": row["high"] - max(row["open"], row["close"]), "lower": min(row["open"], row["close"]) - row["low"], "bullish": row["close"] > row["open"]}

    def candlesticks(self):
        if len(self.df) < 3:
            return []
        patterns = []
        current, previous, prior = self._candle(-1), self._candle(-2), self._candle(-3)
        average_range = (self.df["high"] - self.df["low"]).rolling(20).mean().iloc[-1]
        if current["body"] <= current["range"] * 0.1:
            patterns.append({"name": "十字星", "direction": "neutral", "confidence": "low"})
        if current["body"] >= average_range * 1.5:
            name = "長紅線" if current["bullish"] else "長黑線"
            patterns.append({"name": name, "direction": "bullish" if current["bullish"] else "bearish", "confidence": "medium"})
        if current["lower"] >= current["body"] * 2 and current["upper"] <= current["body"]:
            patterns.append({"name": "錘頭線", "direction": "bullish", "confidence": "medium"})
        if current["upper"] >= current["body"] * 2 and current["lower"] <= current["body"]:
            patterns.append({"name": "倒錘頭/流星", "direction": "bearish", "confidence": "medium"})
        if not previous["bullish"] and current["bullish"] and current["open"] <= previous["close"] and current["close"] >= previous["open"]:
            patterns.append({"name": "多頭吞噬", "direction": "bullish", "confidence": "medium"})
        if previous["bullish"] and not current["bullish"] and current["open"] >= previous["close"] and current["close"] <= previous["open"]:
            patterns.append({"name": "空頭吞噬", "direction": "bearish", "confidence": "medium"})
        midpoint = (previous["open"] + previous["close"]) / 2
        if previous["bullish"] and not current["bullish"] and current["open"] > previous["close"] and current["close"] < midpoint:
            patterns.append({"name": "烏雲罩頂", "direction": "bearish", "confidence": "medium"})
        if not prior["bullish"] and previous["body"] <= previous["range"] * 0.3 and current["bullish"] and current["close"] > prior["open"]:
            patterns.append({"name": "晨星", "direction": "bullish", "confidence": "medium"})
        if prior["bullish"] and previous["body"] <= previous["range"] * 0.3 and not current["bullish"] and current["close"] < prior["open"]:
            patterns.append({"name": "暮星", "direction": "bearish", "confidence": "medium"})
        return patterns

    def zigzag(self, percent_threshold=0.03, atr_multiplier=1.5, atr_period=14, lookback=120):
        """以收盤價與 ATR 確認顯著波段轉折，避免單根影線造成假型態。"""
        subset = self.df.iloc[-lookback:].reset_index(drop=True)
        if len(subset) < atr_period + 2:
            return []
        atr = IndicatorCalculator(subset).atr(atr_period)
        atr_pct = atr.get("ATR_pct", 0) / 100
        threshold = max(percent_threshold, atr_pct * atr_multiplier)
        prices = subset["close"].to_numpy()
        swings, direction = [], 0
        anchor_index = extreme_index = 0
        anchor_price = extreme_price = prices[0]
        for index, price in enumerate(prices[1:], start=1):
            if direction == 0:
                if price >= anchor_price * (1 + threshold):
                    swings.append({"index": anchor_index, "price": round(float(anchor_price), 2), "kind": "trough"})
                    direction, extreme_index, extreme_price = 1, index, price
                elif price <= anchor_price * (1 - threshold):
                    swings.append({"index": anchor_index, "price": round(float(anchor_price), 2), "kind": "peak"})
                    direction, extreme_index, extreme_price = -1, index, price
            elif direction == 1:
                if price > extreme_price:
                    extreme_index, extreme_price = index, price
                elif price <= extreme_price * (1 - threshold):
                    swings.append({"index": extreme_index, "price": round(float(extreme_price), 2), "kind": "peak"})
                    direction, extreme_index, extreme_price = -1, index, price
            else:
                if price < extreme_price:
                    extreme_index, extreme_price = index, price
                elif price >= extreme_price * (1 + threshold):
                    swings.append({"index": extreme_index, "price": round(float(extreme_price), 2), "kind": "trough"})
                    direction, extreme_index, extreme_price = 1, index, price
        if direction and (not swings or swings[-1]["index"] != extreme_index):
            swings.append({"index": extreme_index, "price": round(float(extreme_price), 2), "kind": "peak" if direction == 1 else "trough"})
        return swings

    def _pivots(self):
        swings = self.zigzag()
        highs = [(swing["index"], swing["price"]) for swing in swings if swing["kind"] == "peak"]
        lows = [(swing["index"], swing["price"]) for swing in swings if swing["kind"] == "trough"]
        return highs, lows, swings

    def chart_patterns(self):
        if len(self.df) < 40:
            return []
        patterns = []
        highs, lows, swings = self._pivots()
        price = self.df["close"].iloc[-1]
        atr = IndicatorCalculator(self.df).atr().get("ATR", 0)
        tolerance = max(atr * 0.5, price * 0.005)
        if len(highs) >= 2 and abs(highs[-1][1] - highs[-2][1]) <= tolerance and price < min(point[1] for point in lows[-3:]):
            patterns.append({"name": "雙重頂（M頭）", "direction": "bearish", "confidence": "medium"})
        if len(lows) >= 2 and abs(lows[-1][1] - lows[-2][1]) <= tolerance and price > max(point[1] for point in highs[-3:]):
            patterns.append({"name": "雙重底（W底）", "direction": "bullish", "confidence": "medium"})
        if len(highs) >= 3:
            left, head, right = highs[-3:]
            if head[1] > left[1] and head[1] > right[1] and abs(left[1] - right[1]) <= tolerance:
                patterns.append({"name": "頭肩頂候選", "direction": "bearish", "confidence": "low"})
            if max(point[1] for point in highs[-3:]) - min(point[1] for point in highs[-3:]) <= tolerance:
                patterns.append({"name": "三重頂候選", "direction": "bearish", "confidence": "low"})
        if len(lows) >= 3:
            left, head, right = lows[-3:]
            if head[1] < left[1] and head[1] < right[1] and abs(left[1] - right[1]) <= tolerance:
                patterns.append({"name": "頭肩底候選", "direction": "bullish", "confidence": "low"})
            if max(point[1] for point in lows[-3:]) - min(point[1] for point in lows[-3:]) <= tolerance:
                patterns.append({"name": "三重底候選", "direction": "bullish", "confidence": "low"})
        if len(highs) >= 3 and len(lows) >= 2:
            last_highs, last_lows = highs[-3:], lows[-3:]
            high_slope = np.polyfit([point[0] for point in last_highs], [point[1] for point in last_highs], 1)[0]
            low_slope = np.polyfit([point[0] for point in last_lows], [point[1] for point in last_lows], 1)[0]
            if high_slope < 0 < low_slope:
                patterns.append({"name": "對稱三角形候選", "direction": "neutral", "confidence": "low"})
            elif abs(high_slope) < tolerance / 20 and low_slope > 0:
                patterns.append({"name": "上升三角形候選", "direction": "bullish", "confidence": "low"})
            elif high_slope < 0 and abs(low_slope) < tolerance / 20:
                patterns.append({"name": "下降三角形候選", "direction": "bearish", "confidence": "low"})
            elif high_slope > 0 and low_slope > 0 and low_slope > high_slope:
                patterns.append({"name": "上升楔形候選", "direction": "bearish", "confidence": "low"})
            elif high_slope < 0 and low_slope < 0 and high_slope < low_slope:
                patterns.append({"name": "下降楔形候選", "direction": "bullish", "confidence": "low"})
        recent = self.df.iloc[-20:]
        range_pct = (recent["high"].max() - recent["low"].min()) / recent["close"].mean()
        if range_pct < 0.08:
            patterns.append({"name": "矩形/箱型整理候選", "direction": "neutral", "confidence": "low"})
        closes = self.df["close"].iloc[-30:].to_numpy()
        early_slope = np.polyfit(np.arange(10), closes[:10], 1)[0]
        late_slope = np.polyfit(np.arange(10), closes[-10:], 1)[0]
        middle_low = closes[10:20].min()
        middle_high = closes[10:20].max()
        if early_slope < 0 < late_slope and middle_low == closes[10:20].min():
            patterns.append({"name": "圓弧底/V 型反轉候選", "direction": "bullish", "confidence": "low"})
        elif early_slope > 0 > late_slope and middle_high == closes[10:20].max():
            patterns.append({"name": "圓弧頂/V 型反轉候選", "direction": "bearish", "confidence": "low"})
        prior_slope = np.polyfit(np.arange(15), self.df["close"].iloc[-30:-15], 1)[0]
        consolidation_slope = np.polyfit(np.arange(15), self.df["close"].iloc[-15:], 1)[0]
        if prior_slope > 0 and consolidation_slope < 0 and abs(consolidation_slope) < abs(prior_slope):
            patterns.append({"name": "多頭旗型候選", "direction": "bullish", "confidence": "low"})
        elif prior_slope < 0 and consolidation_slope > 0 and abs(consolidation_slope) < abs(prior_slope):
            patterns.append({"name": "空頭旗型候選", "direction": "bearish", "confidence": "low"})
        return patterns

    def all(self):
        return {"candlesticks": self.candlesticks(), "chart_patterns": self.chart_patterns(), "zigzag": self.zigzag(), "notice": "圖表型態以 ZigZag 顯著轉折與 ATR 動態容許度產生候選訊號，需以突破、量能與風控確認。"}