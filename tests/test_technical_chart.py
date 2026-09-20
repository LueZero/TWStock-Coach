"""Verify chart series parity, artifact output and the unchanged JSON CLI."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from scripts.common.paths import data_path
from scripts.models.repository import save_history
from scripts.technical.controller import TechnicalAnalysisController
from scripts.technical.chart_view import TrendChartView
from scripts.controllers import technical_analysis


class TrendChartTests(unittest.TestCase):
    def setUp(self):
        root = Path(data_path("data/tmp"))
        root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.tmp.cleanup)
        price = np.arange(100, 280, dtype=float) + np.sin(np.arange(180))
        self.frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=180),
                                   "open": price-.2, "high": price+1, "low": price-1,
                                   "close": price, "volume": np.arange(180)*100+1000,
                                   "stock_code": "0050"})

    def test_ma_full_history_before_cropping_and_matches_summary(self):
        controller = TechnicalAnalysisController(self.frame)
        result = controller.analyze()
        chart = controller.trend_chart("0050", result, 30)
        self.assertEqual(len(chart.dates), 30)
        self.assertAlmostEqual(chart.moving_averages["MA60"][0], self.frame.close.iloc[91:151].mean())
        for name, values in chart.moving_averages.items():
            self.assertEqual(round(values[-1], 2), result.indicators["ma"][name])

    def test_chart_cli_emits_png_markdown_and_artifact_metadata(self):
        save_history(self.frame, "0050", self.tmp.name)
        def test_path(path="data", *parts):
            return data_path(self.tmp.name, *parts) if path == "data/reports" else data_path(path, *parts)
        with patch.object(technical_analysis, "data_path", side_effect=test_path), contextlib.redirect_stdout(io.StringIO()) as output:
            technical_analysis.main(["--code", "0050", "--data-dir", self.tmp.name, "--chart", "--chart-bars", "60"])
        result = json.loads(output.getvalue())
        image = Path(result["artifacts"]["chart_png"])
        report = Path(result["artifacts"]["report_markdown"])
        self.assertTrue(image.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(image.stat().st_size, 20000)
        self.assertIn(image.name, report.read_text(encoding="utf-8"))
        self.assertEqual(result["artifacts"]["chart_bars"], 60)
        self.assertEqual(result["artifacts"]["data_as_of"], "2026-06-29")
        self.assertIn("indicators", result)

    def test_default_has_no_artifacts_and_output_path_is_guarded(self):
        save_history(self.frame, "0050", self.tmp.name)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            technical_analysis.main(["--code", "0050", "--data-dir", self.tmp.name])
        self.assertNotIn("artifacts", json.loads(output.getvalue()))
        with self.assertRaises(ValueError):
            TrendChartView.png(None, "outside.png")

    def test_unsorted_dates_are_rejected(self):
        controller = TechnicalAnalysisController(self.frame.iloc[::-1])
        with self.assertRaises(ValueError):
            controller.trend_chart("0050", controller.analyze())


if __name__ == "__main__":
    unittest.main()
