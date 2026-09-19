"""Offline integration checks for MVC boundaries and the unified CLI."""
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from scripts.controllers import institutional_data, report_generator
from scripts.__main__ import COMMANDS, main as cli_main
from scripts.models.repository import load_institutional_df, save_history, save_table
from scripts.common.paths import data_path
from scripts.technical.facade import TechnicalAnalyzer
from scripts.technical.indicators import IndicatorCalculator
from scripts.views.report import DISCLAIMER, render_report


def history():
    rng = np.random.default_rng(92)
    close = 100 + np.cumsum(rng.normal(0, 1, 100))
    return pd.DataFrame({"date": pd.date_range("2026-01-01", periods=100),
                         "open": close - .2, "high": close + 1.5,
                         "low": close - 1.0, "close": close,
                         "volume": rng.integers(2000, 5000, 100), "stock_code": "2330"})


class MvcIntegrationTests(unittest.TestCase):
    def setUp(self):
        root = Path(data_path("data/tmp"))
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.data_dir = self.temp.name
        # Every test must remain offline, including new report branches.
        network = patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network"))
        network.start()
        self.addCleanup(network.stop)

    def test_legacy_indicators_match_the_controller_result(self):
        analyzer = TechnicalAnalyzer(history())
        indicators = analyzer.all_indicators()
        for name in ("ema", "macd", "rsi", "atr", "adx", "kd", "obv"):
            with self.subTest(indicator=name):
                self.assertEqual(getattr(analyzer, name)(), indicators[name])
        self.assertIn("volume_ma5", analyzer.volume_analysis())
        self.assertIn("close", analyzer.bollinger())

    def test_existing_institutional_csv_is_loaded(self):
        frame = pd.DataFrame({"date": ["2026-01-02"], "foreign_net": [100]})
        save_table(frame, self.data_dir, "2330_institutional.csv")
        loaded = load_institutional_df("2330", self.data_dir)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.foreign_net.iloc[0], 100)
        self.assertTrue(pd.api.types.is_datetime64_any_dtype(loaded.date))

    def test_market_action_accepts_no_stock_code_and_saves_in_data(self):
        frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=5), "foreign_net": [1] * 5})
        with patch.object(sys, "argv", ["institutional_data", "--action", "market", "--save", "--data-dir", self.data_dir]), \
                patch.object(institutional_data, "InstitutionalFetcher") as fetcher, \
                patch.object(institutional_data, "summarize_market_institutional", return_value={"market": "test"}), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            fetcher.return_value.fetch_market_history.return_value = frame
            institutional_data.main()
        self.assertTrue((Path(self.data_dir) / "market_institutional.csv").exists())
        self.assertIn('"market": "test"', output.getvalue())

    def test_report_cli_declares_and_forwards_options(self):
        with patch.object(sys, "argv", ["report", "--code", "2330", "--market-code", "0050", "--day-trade"]), \
                patch.object(report_generator, "generate_report", return_value="report") as generate, \
                contextlib.redirect_stdout(io.StringIO()):
            report_generator.main()
        self.assertEqual(generate.call_args.args, ("2330", 5, data_path(), "0050", True))

    def test_report_controller_produces_data_and_view_only_renders(self):
        df = history()
        save_history(df, "2330", self.data_dir)
        prediction = {"current_price": float(df.close.iloc[-1]), "model": "stub",
                      "predicted_price": 110, "predicted_return": 1, "direction": "up",
                      "confidence": {"low": 90, "high": 120},
                      "signal": {"action": "BUY", "reason": "fixture"}}
        with patch.object(report_generator, "TWStockFetcher") as fetcher, \
                patch.object(report_generator, "StockPredictor") as predictor, \
                patch.object(report_generator.etf_analysis, "analyze", return_value={"info": {}, "notes": []}), \
                patch.object(report_generator, "NewsSentimentAnalyzer") as news:
            fetcher.return_value.get_realtime.return_value = {"close": 100, "name": "fixture"}
            predictor.return_value.predict.return_value = prediction
            news.return_value.analyze.side_effect = RuntimeError("offline fixture")
            result = report_generator.build_report("2330", data_dir=self.data_dir)
            self.assertIsNone(predictor.return_value.predict.call_args.kwargs["market_df"])
        expected_atr = IndicatorCalculator(df).atr_series().iloc[-1]
        self.assertAlmostEqual(result.risk["atr"], expected_atr)
        self.assertEqual(result.technical.indicators["data_as_of"], "2026-04-10")
        with patch.object(report_generator, "StockPredictor", side_effect=AssertionError("View trained a model")):
            text = render_report(result)
        for content in ("技術資料截至", "ML 預測", "建議止損價", "offline fixture", DISCLAIMER):
            self.assertIn(content, text)

    def test_wrong_stock_cache_stops_analysis_and_keeps_disclaimer(self):
        df = history()
        df.stock_code = "2317"
        save_table(df, self.data_dir, "2330_history.csv")
        with patch.object(report_generator, "TWStockFetcher") as fetcher, \
                patch.object(report_generator, "StockPredictor") as predictor:
            fetcher.return_value.get_realtime.return_value = {"error": "offline"}
            result = report_generator.generate_report("2330", data_dir=self.data_dir)
            predictor.assert_not_called()
        self.assertIn("資料驗證失敗", result)
        self.assertIn(DISCLAIMER, result)

    def test_all_cli_help_is_available_without_data_or_network(self):
        for name in COMMANDS:
            with self.subTest(entry=name), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(SystemExit) as status:
                    cli_main([name, "--help"])
                self.assertEqual(status.exception.code, 0)
                self.assertIn(f"python -m scripts {name}", output.getvalue())



if __name__ == "__main__":
    unittest.main()
