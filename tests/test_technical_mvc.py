"""技術分析 MVC 基本回歸測試。"""
import unittest

import numpy as np
import pandas as pd

from scripts.technical.controller import TechnicalAnalysisController
from scripts.technical.views import TechnicalAnalysisView
from scripts.technical.facade import TechnicalAnalyzer
from scripts.models.repository import validate_history_code


def sample_ohlcv(rows=100):
    rng = np.random.default_rng(42)
    close = 100 + np.cumsum(rng.normal(0.1, 1, rows))
    return pd.DataFrame({
        "open": close + rng.normal(0, 0.3, rows),
        "high": close + rng.uniform(0.4, 1.5, rows),
        "low": close - rng.uniform(0.4, 1.5, rows),
        "close": close,
        "volume": rng.integers(1_000, 10_000, rows),
    })


class TechnicalMvcTests(unittest.TestCase):
    def test_controller_includes_complete_indicator_groups(self):
        result = TechnicalAnalysisController(sample_ohlcv()).analyze()
        expected = {"ma", "ema", "kd", "macd", "rsi", "cci", "bollinger", "keltner", "atr", "adx", "obv", "vr", "price_volume", "candlestick_anatomy", "bias", "market_regime", "higher_timeframe", "trailing_stop", "support_resistance", "trendlines", "fibonacci", "volume_profile"}
        self.assertTrue(expected.issubset(result.indicators))
        self.assertIn("candlesticks", result.patterns)
        self.assertIn("chart_patterns", result.patterns)
        self.assertIn("zigzag", result.patterns)

    def test_view_serializes_result(self):
        result = TechnicalAnalysisController(sample_ohlcv()).analyze()
        self.assertIn("indicators", TechnicalAnalysisView.json(result))
        self.assertIn("###", TechnicalAnalysisView.markdown(result))

    def test_legacy_analyzer_remains_compatible(self):
        result = TechnicalAnalyzer(sample_ohlcv()).generate_signals()
        self.assertIn("overall", result)
        self.assertIn("patterns", result)
        self.assertTrue(all(len(signal) == 3 for signal in result["signals"]))

    def test_trending_regime_ignores_oscillator_signals(self):
        close = np.arange(100, 200, dtype=float)
        df = pd.DataFrame({
            "open": close - 0.2,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": np.full(100, 2_000),
        })
        result = TechnicalAnalysisController(df).analyze()
        categories = {signal.category for signal in result.signals}
        self.assertEqual(result.summary["market_regime"], "trending")
        self.assertTrue(result.summary["trailing_stop"])
        self.assertFalse({"KD", "RSI", "CCI"} & categories)

    def test_technical_result_excludes_0050_relative_strength(self):
        stock = sample_ohlcv()
        stock["date"] = pd.date_range("2026-01-01", periods=len(stock), freq="B")
        result = TechnicalAnalysisController(stock).analyze()
        self.assertNotIn("relative_strength", result.indicators)
        self.assertEqual(result.indicators["data_as_of"], "2026-05-20")

    def test_low_confidence_pattern_is_not_scored(self):
        controller = TechnicalAnalysisController(sample_ohlcv())
        indicators = controller.calculator.all()
        patterns = {
            "candlesticks": [],
            "chart_patterns": [{"name": "低信心候選", "direction": "bullish", "confidence": "low"}],
        }
        self.assertNotIn("型態", {signal.category for signal in controller._signals(indicators, patterns)})

    def test_history_code_validation_rejects_mismatched_cache(self):
        df = sample_ohlcv()
        df["stock_code"] = "2330"
        with self.assertRaises(ValueError):
            validate_history_code(df, "2317")
        validate_history_code(df, "2330")


if __name__ == "__main__":
    unittest.main()