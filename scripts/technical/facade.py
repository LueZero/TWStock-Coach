"""Legacy TechnicalAnalyzer API backed by the single MVC calculation model."""
from .controller import TechnicalAnalysisController


class TechnicalAnalyzer:
    def __init__(self, df):
        self.df = df.copy()
        self.controller = TechnicalAnalysisController(self.df)

    def ma(self, periods=(5, 10, 20, 60)):
        return self.controller.calculator.sma(periods)

    def ema(self, periods=(12, 26)):
        return self.controller.calculator.ema(periods)

    def kd(self, n=9):
        return self.controller.calculator.kd(n)

    def macd(self, fast=12, slow=26, signal=9):
        return self.controller.calculator.macd(fast, slow, signal)

    def rsi(self, period=14):
        return self.controller.calculator.rsi(period)

    def bollinger(self, period=20, std_dev=2):
        values = self.controller.calculator.bollinger(period, std_dev)
        if values:
            values["close"] = round(self.df["close"].iloc[-1], 2)
        return values

    def atr(self, period=14):
        return self.controller.calculator.atr(period)

    def adx(self, period=14):
        return self.controller.calculator.adx(period)

    def obv(self, period=20):
        return self.controller.calculator.obv(period)

    def support_resistance(self, period=20):
        return self.controller.calculator.support_resistance(period)

    def volume_analysis(self):
        values = self.controller.calculator.volume()
        if values:
            values["volume_ma5"] = values.pop("volume_ma")
        return values

    def all_indicators(self):
        return self.controller.calculator.all()

    def generate_signals(self):
        result = self.controller.analyze()
        return {
            "signals": [(s.category, s.description, s.direction) for s in result.signals],
            "overall": result.overall,
            "indicators": result.indicators,
            "patterns": result.patterns,
            "summary": result.summary,
        }
