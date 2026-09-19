"""Offline checks: python -B -m unittest discover -s tests -p test_project_paths.py."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.common.paths import DATA_ROOT, PROJECT_ROOT, data_path, stock_code


class ArtifactPathsTest(unittest.TestCase):
    def test_paths_ignore_working_directory(self):
        previous = Path.cwd()
        try:
            os.chdir(PROJECT_ROOT.parent)
            self.assertEqual(Path(data_path()), DATA_ROOT)
            self.assertEqual(Path(data_path('data/models', '2330.json')),
                             DATA_ROOT / 'models' / '2330.json')
        finally:
            os.chdir(previous)

    def test_outside_paths_and_codes_rejected(self):
        for value in ['models', 'data/../../outside', str(PROJECT_ROOT.parent)]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                data_path(value)
        for value in ['../2330', '/2330', 'a\\2330']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                stock_code(value)

    def test_resolved_link_escape_rejected(self):
        # Model Path.resolve() following a junction/symlink without requiring
        # Windows symlink privileges or creating artifacts outside data/.
        with patch.object(Path, 'resolve', return_value=PROJECT_ROOT.parent):
            with self.assertRaises(ValueError):
                data_path('data/link', '2330.csv')

    def test_cli_rejects_external_directory_before_fetch(self):
        from scripts.controllers import fetch_stock_data
        with patch.object(sys, 'argv', ['fetch', '--code', '2330', '--data-dir', '../outside']), \
                patch.object(fetch_stock_data, 'TWStockFetcher') as fetcher, \
                contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                fetch_stock_data.main()
            self.assertEqual(error.exception.code, 2)
            fetcher.assert_not_called()

    def test_saved_params_are_consumed_by_report(self):
        import pandas as pd
        from scripts.controllers import tune
        from scripts.controllers import report_generator
        tmp_root = Path(data_path('data/tmp'))
        tmp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_root) as directory:
            params = {'max_depth': 3}
            with patch.object(sys, 'argv', ['tune', '--code', '2330', '--save', '--data-dir', directory]), \
                    patch.object(tune, 'optimize', return_value={'best_params': params}), \
                    contextlib.redirect_stdout(io.StringIO()):
                tune.main()
            saved = Path(directory) / 'models' / '2330_best_params.json'
            self.assertEqual(json.loads(saved.read_text(encoding='utf-8')), params)
            frame = pd.DataFrame({'date': ['2026-01-02'], 'close': [100]})
            from scripts.technical.models import AnalysisResult
            with patch.object(report_generator, 'TWStockFetcher') as fetcher, \
                    patch.object(report_generator, 'TechnicalAnalysisController') as analyzer, \
                    patch.object(report_generator, 'StockPredictor') as predictor, \
                    patch.object(report_generator.etf_analysis, 'analyze', return_value={'info': {}, 'notes': []}), \
                    patch.object(report_generator, 'NewsSentimentAnalyzer') as news:
                fetcher.return_value.get_realtime.return_value = {'error': 'offline'}
                fetcher.return_value.get_history.return_value = frame
                analyzer.return_value.analyze.return_value = AnalysisResult(indicators={'price': 100})
                news.return_value.analyze.return_value = {'window_days': 7, 'article_count': 0,
                    'positive_count': 0, 'negative_count': 0, 'label': 'test', 'articles': []}
                predictor.return_value.predict.return_value = {'error': 'offline'}
                report_generator.generate_report('2330', data_dir=directory)
                predictor.assert_called_once_with(ensemble=True, params=params)
            self.assertTrue((Path(directory) / '2330_history.csv').is_file())


if __name__ == '__main__':
    unittest.main()
