"""Exercise launch scripts with fake Hermes programs; never start an LLM."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from scripts.common.paths import PROJECT_ROOT, data_path


class HermesLauncherTests(unittest.TestCase):
    def test_dashboard_runtime_overrides_bad_registry_mime_in_child_only(self):
        import sys
        environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                           PYTHONPATH=str(PROJECT_ROOT / "hermes/dashboard_runtime"))
        result = subprocess.run([sys.executable, "-B", "-c",
                                 "import mimetypes; print(mimetypes.guess_type('app.js')[0])"],
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "text/javascript")

    def setUp(self):
        temporary_root = Path(data_path("data/tmp"))
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.directory.cleanup)
        self.bin = Path(self.directory.name)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell launcher")
    def test_powershell_modes_and_exit_status(self):
        fake = self.bin / "hermes.ps1"
        fake.write_text(
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n"
            "@{ cwd = (Get-Location).Path; argv = @($args); tui_cwd = $env:HERMES_CWD; tools = $env:HERMES_TUI_TOOLSETS } | ConvertTo-Json -Compress\nexit 7\n",
            encoding="utf-8-sig",
        )
        environment = dict(os.environ)
        path_key = next(key for key in environment if key.lower() == "path")
        environment[path_key] = str(self.bin) + os.pathsep + environment[path_key]
        cases = [([], ["chat", "-t", "terminal,skills,web,delegation"]),
                 (["-Query", "sample request"], ["chat", "-q", "sample request", "-t", "terminal,skills,web", "-Q"]),
                 (["-Tools", "terminal,skills"], ["chat", "-t", "terminal,skills"]),
                 (["-Dashboard", "-Port", "9220", "-NoOpen"], ["dashboard", "--host", "127.0.0.1", "--port", "9220", "--no-open"])]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(PROJECT_ROOT / "run.ps1"), *arguments],
                    cwd=self.bin, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=30,
                )
                self.assertEqual(result.returncode, 7, result.stderr)
                payload = json.loads(result.stdout.lstrip("\ufeff"))
                self.assertEqual(payload["argv"], expected)
                self.assertEqual(Path(payload["cwd"]), PROJECT_ROOT)
                if "-Dashboard" in arguments:
                    self.assertEqual(Path(payload["tui_cwd"]), PROJECT_ROOT)
                    self.assertEqual(payload["tools"], "terminal,skills,web,delegation")

    def test_bash_modes_and_exit_status(self):
        bash = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
        if not bash or not Path(bash).exists():
            self.skipTest("Bash unavailable")
        fake = self.bin / "hermes"
        fake.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$PWD" "$@"\nexit 7\n', encoding="utf-8")
        fake.chmod(0o755)
        setup = ('fakebin=$(cygpath -u "$1"); launcher=$(cygpath -u "$2"); '
                 if os.name == "nt" else 'fakebin="$1"; launcher="$2"; ')
        setup += 'export PATH="$fakebin:$PATH"; shift 2; exec bash "$launcher" "$@"'
        cases = [([], ["chat", "-t", "terminal,skills,web,delegation"]),
                 (["sample request"], ["chat", "-q", "sample request", "-t", "terminal,skills,web", "-Q"]),
                 (["--dashboard", "--no-open"], ["dashboard", "--host", "127.0.0.1", "--no-open"])]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    [bash, "-c", setup, "--", str(self.bin), str(PROJECT_ROOT / "run.sh"), *arguments],
                    cwd=self.bin, capture_output=True, text=True, encoding="utf-8", timeout=30,
                )
                self.assertEqual(result.returncode, 7, result.stderr)
                lines = result.stdout.splitlines()
                self.assertEqual(lines[1:], expected)
                expected_cwd = PROJECT_ROOT.as_posix()
                if os.name == "nt":
                    expected_cwd = "/" + expected_cwd[0].lower() + expected_cwd[2:]
                self.assertEqual(lines[0], expected_cwd)


if __name__ == "__main__":
    unittest.main()
