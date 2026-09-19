"""技術分析 Controller：整合 Model 並決定訊號。"""
import pandas as pd

from .indicators import IndicatorCalculator
from .models import AnalysisResult, Signal
from .patterns import PatternDetector


class TechnicalAnalysisController:
    """協調指標、型態與可回測訊號規則。"""

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self.calculator = IndicatorCalculator(df)
        self.detector = PatternDetector(df)

    def _granville_signals(self):
        if len(self.df) < 21:
            return []
        ma20 = self.df["close"].rolling(20).mean()
        current, previous = self.df["close"].iloc[-1], self.df["close"].iloc[-2]
        current_ma, previous_ma = ma20.iloc[-1], ma20.iloc[-2]
        if previous <= previous_ma and current > current_ma:
            return [Signal("葛蘭碧", "股價上穿 20 日均線", "bullish", 2)]
        if previous >= previous_ma and current < current_ma:
            return [Signal("葛蘭碧", "股價下穿 20 日均線", "bearish", 2)]
        if current_ma > previous_ma and current < current_ma * 0.96:
            return [Signal("葛蘭碧", "上升均線下的乖離回檔", "bullish")]
        if current_ma < previous_ma and current > current_ma * 1.04:
            return [Signal("葛蘭碧", "下降均線上的乖離反彈", "bearish")]
        return []

    def _signals(self, indicators, patterns):
        signals, price = [], indicators["price"]
        regime = indicators["market_regime"]["regime"]
        trend_weight = 2 if regime == "trending" else 1
        oscillator_weight = 2 if regime == "ranging" else 1
        oscillator_enabled = regime != "trending"
        ma, ema = indicators["ma"], indicators["ema"]
        if ma.get("MA5") and ma.get("MA20"):
            signals.append(Signal("MA", "短均線位於長均線之上" if ma["MA5"] > ma["MA20"] else "短均線位於長均線之下", "bullish" if ma["MA5"] > ma["MA20"] else "bearish", trend_weight))
        if ema.get("EMA12") and ema.get("EMA26"):
            signals.append(Signal("EMA", "短 EMA 位於長 EMA 之上" if ema["EMA12"] > ema["EMA26"] else "短 EMA 位於長 EMA 之下", "bullish" if ema["EMA12"] > ema["EMA26"] else "bearish", trend_weight))
        kd = indicators["kd"]
        if kd and oscillator_enabled:
            signals.append(Signal("KD", f"超買 K={kd['K']}" if kd["K"] > 80 else (f"超賣 K={kd['K']}" if kd["K"] < 20 else f"中性 K={kd['K']}"), "bearish" if kd["K"] > 80 else ("bullish" if kd["K"] < 20 else "neutral"), oscillator_weight))
        macd = indicators["macd"]
        if macd:
            signals.append(Signal("MACD", "柱狀體正值" if macd["OSC"] > 0 else "柱狀體負值", "bullish" if macd["OSC"] > 0 else "bearish", trend_weight))
        rsi, cci = indicators["rsi"], indicators["cci"]
        if rsi and oscillator_enabled:
            signals.append(Signal("RSI", f"過熱 {rsi['RSI']}" if rsi["RSI"] > 70 else (f"過冷 {rsi['RSI']}" if rsi["RSI"] < 30 else f"中性 {rsi['RSI']}"), "bearish" if rsi["RSI"] > 70 else ("bullish" if rsi["RSI"] < 30 else "neutral"), oscillator_weight))
        if cci and oscillator_enabled and abs(cci["CCI"]) > 100:
            signals.append(Signal("CCI", f"過熱 {cci['CCI']}" if cci["CCI"] > 100 else f"過冷 {cci['CCI']}", "bearish" if cci["CCI"] > 100 else "bullish", oscillator_weight))
        boll, keltner = indicators["bollinger"], indicators["keltner"]
        if boll and oscillator_enabled and (price >= boll["upper"] or price <= boll["lower"]):
            signals.append(Signal("布林", "觸及上軌" if price >= boll["upper"] else "觸及下軌", "bearish" if price >= boll["upper"] else "bullish", oscillator_weight))
        if keltner and (price >= keltner["upper"] or price <= keltner["lower"]):
            signals.append(Signal("肯特納", "突破上通道" if price >= keltner["upper"] else "跌破下通道", "bullish" if price >= keltner["upper"] else "bearish"))
        adx = indicators["adx"]
        if adx and adx["ADX"] is not None and adx["ADX"] >= 25:
            signals.append(Signal("ADX/DMI", f"趨勢明顯 ADX={adx['ADX']}", "bullish" if adx["plus_DI"] > adx["minus_DI"] else "bearish", 2))
        obv, price_volume, vr = indicators["obv"], indicators["price_volume"], indicators["vr"]
        if obv and obv["OBV_change"] != 0:
            signals.append(Signal("OBV", f"近 {obv['period']} 日量能{'累積' if obv['OBV_change'] > 0 else '流出'}", "bullish" if obv["OBV_change"] > 0 else "bearish"))
        if price_volume:
            direction = "bullish" if price_volume["label"] == "價量齊揚" else ("bearish" if price_volume["label"] == "價跌量增" else "neutral")
            signals.append(Signal("量價", price_volume["label"], direction))
        if vr and vr["VR"] is not None and (vr["VR"] > 150 or vr["VR"] < 70):
            signals.append(Signal("VR", f"VR={vr['VR']}", "bullish" if vr["VR"] > 150 else "bearish"))
        signals.extend(self._granville_signals())
        volume_confirmed = indicators["volume"].get("volume_ratio", 0) >= 1
        for pattern in patterns["candlesticks"] + patterns["chart_patterns"]:
            if pattern["direction"] != "neutral" and pattern["confidence"] == "medium" and volume_confirmed:
                signals.append(Signal("型態", pattern["name"], pattern["direction"], 2))
        if not volume_confirmed and (patterns["candlesticks"] or patterns["chart_patterns"]):
            signals.append(Signal("量能確認", "型態候選未達 5 日均量，不納入方向計分", "neutral"))
        bias = indicators["bias"]
        if bias and abs(bias["zscore"]) >= 2:
            signals.append(Signal("BIAS", f"MA{bias['period']} 乖離極端 Z={bias['zscore']}", "bearish" if bias["zscore"] > 0 else "bullish", 2))
        higher_timeframe = indicators["higher_timeframe"]
        if higher_timeframe and higher_timeframe["background"] != "neutral":
            signals.append(Signal("季線背景", "價格位於上升 MA60 之上" if higher_timeframe["background"] == "bullish" else "價格位於下降 MA60 之下", higher_timeframe["background"], 2))
        anatomy = indicators["candlestick_anatomy"]
        support = indicators["support_resistance"]
        if oscillator_enabled and support and price <= support["support"] * 1.02 and anatomy["lower_shadow"] >= anatomy["body"] * 2:
            signals.append(Signal("K線反轉", "支撐附近出現長下影線", "bullish", 2))
        return signals

    def analyze(self):
        indicators = self.calculator.all()
        patterns = self.detector.all()
        signals = self._signals(indicators, patterns)
        bullish = sum(signal.strength for signal in signals if signal.direction == "bullish")
        bearish = sum(signal.strength for signal in signals if signal.direction == "bearish")
        overall = "偏多" if bullish >= bearish + 2 else ("偏空" if bearish >= bullish + 2 else "中性")
        summary = {"bullish_score": bullish, "bearish_score": bearish, "signal_count": len(signals), "market_regime": indicators["market_regime"]["regime"], "volume_confirmed": indicators["volume"].get("volume_ratio", 0) >= 1, "trailing_stop": indicators["trailing_stop"], "methodology": "依市場狀態動態加權的規則化技術分析；不構成預測或交易指令。"}
        return AnalysisResult(indicators=indicators, patterns=patterns, signals=signals, overall=overall, summary=summary)