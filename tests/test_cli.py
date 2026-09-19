"""Unified CLI routing, error handling, and an offline module invocation."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from scripts import __main__ as cli
from scripts.common.paths import PROJECT_ROOT, data_path
from scripts.controllers import report_generator
from scripts.models.repository import save_history


class UnifiedCliTests(unittest.TestCase):
    def test_top_level_help_does_not_import_controllers(self):
        with patch.object(cli, "import_module", side_effect=AssertionError("Eager import")), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(cli.main([]), 0)
            with self.assertRaises(SystemExit) as status:
                cli.main(["--help"])
        self.assertEqual(status.exception.code, 0)
        self.assertIn("technical", output.getvalue())

    def test_invalid_command_fails_without_loading_a_controller(self):
        with patch.object(cli, "import_module") as loader, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as status:
                cli.main(["unknown-command"])
        self.assertEqual(status.exception.code, 2)
        loader.assert_not_called()

    def test_report_arguments_are_forwarded_without_changing_sys_argv(self):
        previous = sys.argv[:]
        with patch.object(report_generator, "generate_report", return_value="fixture report") as generate, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            cli.main(["report", "--code", "2330", "--days-ahead", "3", "--market-code", "0050", "--day-trade"])
        self.assertEqual(generate.call_args.args, ("2330", 3, data_path(), "0050", True))
        self.assertEqual(sys.argv, previous)
        self.assertIn("fixture report", output.getvalue())

    def test_missing_required_and_unknown_options_fail(self):
        for arguments in (["technical"], ["technical", "--code", "2330", "--unknown"]):
            with self.subTest(arguments=arguments), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as status:
                    cli.main(arguments)
                self.assertEqual(status.exception.code, 2)

    def test_real_module_invocation_reads_project_data(self):
        temporary_root = Path(data_path("data/tmp"))
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            rng = np.random.default_rng(11)
            close = 100 + rng.normal(0, 1, 90).cumsum()
            frame = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=90),
                                  "open": close - .2, "high": close + 1, "low": close - 1,
                                  "close": close, "volume": np.full(90, 10000), "stock_code": "2330"})
            save_history(frame, "2330", directory)
            relative_data_dir = Path(directory).relative_to(PROJECT_ROOT).as_posix()
            environment = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
            result = subprocess.run(
                [sys.executable, "-B", "-m", "scripts", "technical", "--code", "2330", "--data-dir", relative_data_dir],
                cwd=PROJECT_ROOT, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            analysis = json.loads(result.stdout)
            self.assertEqual(analysis["indicators"]["data_as_of"], "2026-03-31")
            self.assertAlmostEqual(analysis["indicators"]["price"], round(close[-1], 2))
            self.assertIn("signals", analysis)


if __name__ == "__main__":
    unittest.main()
