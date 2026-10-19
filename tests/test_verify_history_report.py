"""Regression checks use temporary repositories and constructed dummy values only."""

import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "verify_history_report", ROOT / "_shared/tools/verify_history_report.py"
)
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class HistoryReportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="history-report-test-")
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        self.git("init", "--quiet", "-b", "main")
        self.template = self.repo / "Devices/sandbox/.env.example"
        self.template.parent.mkdir(parents=True)
        self.template.write_bytes(b"STATS_KEY=fixture-initial-value\n")
        self.subject = self.commit()

    def git(self, *args):
        result = subprocess.run(
            ["git", "-C", str(self.repo), "-c", "core.hooksPath=NUL", *args],
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, "Temporary fixture Git command failed")
        return result.stdout.strip().decode("ascii")

    def commit(self):
        self.git("add", "--all")
        self.git(
            "-c", "user.name=History report test", "-c", "user.email=history-test@invalid",
            "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture",
        )
        return self.git("rev-parse", "HEAD")

    def run_check(self, *extra, subject=None):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = CHECKER.main([
                "--repo", str(self.repo), "--subject", subject or self.subject, *extra,
            ])
        return code, json.loads(output.getvalue()), output.getvalue()

    def test_assignment_forms_and_token_lengths(self):
        value = b"A" * 40
        for contents in [
            b"AWS_SECRET_ACCESS_KEY=" + value,
            b'{"AWS_SECRET_ACCESS_KEY": "' + value + b'"}',
            b"JP_WRITE_AWS_SECRET_ACCESS_KEY='" + value + b"'",
            b'{"AWS_SESSION_TOKEN": "' + b"B" * 80 + b'"}',
        ]:
            with self.subTest(form=contents[:20]):
                self.assertTrue(CHECKER.has_assignment(contents))
        self.assertFalse(CHECKER.has_assignment(b"AWS_SECRET_ACCESS_KEY=" + b"A" * 39))
        self.assertFalse(CHECKER.has_assignment(b"AWS_SECRET_ACCESS_KEY=" + b"A" * 41))

    def test_space_in_path_is_scanned_without_exposing_the_match(self):
        value = "A" * 40
        target = self.repo / "folder with spaces/config.json"
        target.parent.mkdir()
        target.write_text(json.dumps({"AWS_SECRET_ACCESS_KEY": value}), encoding="utf-8")
        self.commit()
        code, summary, output = self.run_check()
        self.assertEqual(code, 1)
        self.assertEqual(summary["reachable_blobs"], 2)
        self.assertEqual(summary["scanned_blobs"], 2)
        self.assertEqual(summary["skipped_blobs"], 0)
        self.assertEqual(summary["matching_blobs"], 1)
        self.assertNotIn(value, output)
        self.assertNotIn("fixture-initial-value", output)

    def test_comparison_remains_pinned_when_main_changes(self):
        old_blob = self.git("rev-parse", "HEAD:Devices/sandbox/.env.example")
        self.template.write_bytes(b"STATS_KEY=fixture-updated-value\n")
        self.commit()
        new_blob = self.git("rev-parse", "HEAD:Devices/sandbox/.env.example")
        code, summary, output = self.run_check(
            "--compare-blob", old_blob, "--compare-blob", new_blob,
        )
        self.assertEqual(code, 0)
        self.assertEqual(summary["subject_revision"], self.subject)
        self.assertEqual(
            [entry["identical_to_subject"] for entry in summary["stats_key_comparisons"]],
            [True, False],
        )
        self.assertNotIn("fixture-updated-value", output)

    def test_missing_or_duplicate_assignment_is_an_error(self):
        for contents in [b"# no assignment\n", b"STATS_KEY=one\nSTATS_KEY=two\n"]:
            with self.subTest(case="missing" if contents.startswith(b"#") else "duplicate"):
                self.template.write_bytes(contents)
                revision = self.commit()
                code, summary, _ = self.run_check(subject=revision)
                self.assertEqual(code, 2)
                self.assertEqual(summary["status"], "error")
                self.assertNotIn("matching_blobs", summary)

    def test_unresolved_object_is_an_error_instead_of_identical_empty_files(self):
        code, summary, _ = self.run_check("--compare-blob", "0" * 40)
        self.assertEqual(code, 2)
        self.assertEqual(summary["status"], "error")
        self.assertNotIn("stats_key_comparisons", summary)

    def test_memory_bound_never_silently_skips_history(self):
        code, summary, _ = self.run_check("--max-bytes", "1")
        self.assertEqual(code, 2)
        self.assertEqual(summary["status"], "error")
        self.assertNotIn("matching_blobs", summary)

    def test_a_moving_branch_is_not_accepted_as_the_subject(self):
        code, summary, _ = self.run_check(subject="main")
        self.assertEqual(code, 2)
        self.assertEqual(summary["status"], "error")


if __name__ == "__main__":
    unittest.main()
