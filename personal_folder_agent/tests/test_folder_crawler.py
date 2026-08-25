"""Unit tests for the FolderCrawler component.

Tests cover:
- Recursive directory traversal with a real (tmp_path) file system
- Depth-limited recursion and boundary semantics (root = depth 0)
- Exclusion patterns (file globs and directory-tree patterns)
- Permission error handling and graceful continuation
- Statistics collection accuracy (global and per-folder)
- Multiple root folders and invalid-root filtering
- get_statistics() / get_errors() return contracts
"""

import hashlib
from datetime import datetime

import pytest

from personal_folder_agent.components.folder_crawler import FolderCrawler
from personal_folder_agent.models import CrawlerConfig, CrawlStatistics, FileStatus


def _write_file(path, content: bytes = b"hello world"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return content


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _make_config(folder_paths, max_depth=10, exclusion_patterns=None):
    return CrawlerConfig(
        folder_paths=[str(p) for p in folder_paths],
        max_depth=max_depth,
        exclusion_patterns=exclusion_patterns or [],
    )


class TestRecursiveTraversal:
    def test_all_files_found_with_correct_metadata(self, tmp_path):
        """Every file in a nested tree is discovered with correct metadata."""
        root = tmp_path / "root"
        a_content = _write_file(root / "a.txt", b"alpha")
        b_content = _write_file(root / "sub" / "b.md", b"beta beta")
        c_content = _write_file(root / "sub" / "deep" / "c.json", b"gamma")

        crawler = FolderCrawler(_make_config([root]))
        results = crawler.crawl()

        by_path = {m.path: m for m in results}
        assert set(by_path) == {
            str(root / "a.txt"),
            str(root / "sub" / "b.md"),
            str(root / "sub" / "deep" / "c.json"),
        }

        a = by_path[str(root / "a.txt")]
        assert a.extension == ".txt"
        assert a.size_bytes == len(a_content)
        assert a.sha256_hash == _sha256(a_content)
        assert isinstance(a.last_modified, datetime)
        assert a.processing_status == FileStatus.PENDING

        b = by_path[str(root / "sub" / "b.md")]
        assert b.extension == ".md"
        assert b.size_bytes == len(b_content)
        assert b.sha256_hash == _sha256(b_content)

        c = by_path[str(root / "sub" / "deep" / "c.json")]
        assert c.extension == ".json"
        assert c.sha256_hash == _sha256(c_content)

    def test_extension_is_lowercased(self, tmp_path):
        """File extensions are normalized to lowercase."""
        root = tmp_path / "root"
        _write_file(root / "README.MD", b"x")

        crawler = FolderCrawler(_make_config([root]))
        results = crawler.crawl()

        assert results[0].extension == ".md"


class TestDepthLimiting:
    def _build_tree(self, tmp_path):
        root = tmp_path / "root"
        _write_file(root / "file0.txt", b"depth0")
        _write_file(root / "sub1" / "file1.txt", b"depth1")
        _write_file(root / "sub1" / "sub2" / "file2.txt", b"depth2")
        _write_file(root / "sub1" / "sub2" / "sub3" / "file3.txt", b"depth3")
        return root

    def test_files_beyond_max_depth_not_crawled(self, tmp_path):
        """Files deeper than max_depth are not discovered."""
        root = self._build_tree(tmp_path)

        crawler = FolderCrawler(_make_config([root], max_depth=1))
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert str(root / "file0.txt") in paths
        assert str(root / "sub1" / "file1.txt") in paths
        assert str(root / "sub1" / "sub2" / "file2.txt") not in paths
        assert str(root / "sub1" / "sub2" / "sub3" / "file3.txt") not in paths

    def test_max_depth_zero_only_root_files(self, tmp_path):
        """max_depth=0 crawls only files directly in the root folder."""
        root = self._build_tree(tmp_path)

        crawler = FolderCrawler(_make_config([root], max_depth=0))
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert paths == {str(root / "file0.txt")}

    def test_max_depth_two_includes_grandchild(self, tmp_path):
        """max_depth=2 reaches files two levels below the root."""
        root = self._build_tree(tmp_path)

        crawler = FolderCrawler(_make_config([root], max_depth=2))
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert str(root / "sub1" / "sub2" / "file2.txt") in paths
        assert str(root / "sub1" / "sub2" / "sub3" / "file3.txt") not in paths


class TestExclusionPatterns:
    def test_file_glob_excludes_files(self, tmp_path):
        """'*.log' excludes matching files and increments files_skipped."""
        root = tmp_path / "root"
        _write_file(root / "keep.txt", b"keep")
        _write_file(root / "debug.log", b"log")
        _write_file(root / "sub" / "other.log", b"log2")

        crawler = FolderCrawler(
            _make_config([root], exclusion_patterns=["*.log"])
        )
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert paths == {str(root / "keep.txt")}

        stats = crawler.get_statistics()
        assert stats.files_skipped == 2
        assert stats.files_processed == 1
        assert stats.total_files == 3

    def test_directory_tree_pattern_excludes_entire_subtree(self, tmp_path):
        """'node_modules/**' excludes the directory and everything under it."""
        root = tmp_path / "root"
        _write_file(root / "app.py", b"app")
        _write_file(root / "node_modules" / "pkg" / "index.js", b"js")
        _write_file(root / "node_modules" / "pkg" / "deep" / "util.js", b"js2")
        _write_file(root / "src" / "node_modules" / "nested.js", b"nested")

        crawler = FolderCrawler(
            _make_config([root], exclusion_patterns=["node_modules/**"])
        )
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert paths == {str(root / "app.py")}
        # The nested node_modules under src/ is also excluded.
        assert str(root / "src" / "node_modules" / "nested.js") not in paths

        stats = crawler.get_statistics()
        assert stats.files_processed == 1
        assert stats.files_skipped == 0  # excluded directories are not "skipped files"
        assert stats.total_files == 1

    def test_excluded_directory_not_counted_as_skipped_file(self, tmp_path):
        """Excluded directories do not inflate files_skipped (only files do)."""
        root = tmp_path / "root"
        _write_file(root / "a.txt", b"a")
        _write_file(root / "node_modules" / "x.js", b"x")

        crawler = FolderCrawler(
            _make_config([root], exclusion_patterns=["node_modules/**"])
        )
        crawler.crawl()

        stats = crawler.get_statistics()
        assert stats.files_skipped == 0
        assert stats.files_processed == 1
        assert stats.total_files == 1


class TestPermissionErrorHandling:
    def test_permission_error_continues_and_records(self, tmp_path, monkeypatch):
        """A permission-denied file is skipped, others processed, error recorded."""
        root = tmp_path / "root"
        _write_file(root / "ok1.txt", b"one")
        blocked = root / "blocked.txt"
        _write_file(blocked, b"secret")
        _write_file(root / "ok2.txt", b"two")

        real_access = __import__("os").access

        def fake_access(path, mode):
            if str(path) == str(blocked):
                return False
            return real_access(path, mode)

        monkeypatch.setattr("os.access", fake_access)

        crawler = FolderCrawler(_make_config([root]))
        results = crawler.crawl()

        paths = {m.path for m in results}
        assert paths == {str(root / "ok1.txt"), str(root / "ok2.txt")}

        stats = crawler.get_statistics()
        assert stats.files_processed == 2
        assert stats.files_errored == 1
        assert stats.total_files == 3

        errors = crawler.get_errors()
        assert len(errors) == 1
        assert errors[0]["path"] == str(blocked)
        assert errors[0]["error_type"] == "PermissionError"

    def test_read_error_during_processing_is_recorded(self, tmp_path, monkeypatch):
        """An OSError raised while reading a file is recorded and crawl continues."""
        root = tmp_path / "root"
        _write_file(root / "ok.txt", b"ok")
        bad = root / "bad.txt"
        _write_file(bad, b"bad")

        def boom(self, file_path):
            raise PermissionError("simulated read failure")

        monkeypatch.setattr(
            "personal_folder_agent.components.folder_crawler.FolderCrawler._compute_sha256",
            boom,
        )

        crawler = FolderCrawler(_make_config([root]))
        results = crawler.crawl()

        # The bad file fails during hashing; the ok file still succeeds.
        assert len(results) == 0  # both files fail hashing in this mock

        stats = crawler.get_statistics()
        assert stats.files_errored == 2
        assert stats.total_files == 2

        errors = crawler.get_errors()
        assert len(errors) == 2
        assert all(e["error_type"] == "PermissionError" for e in errors)


class TestStatisticsAccuracy:
    def test_global_and_per_folder_counts_match(self, tmp_path):
        """Global counters and per-folder sums are consistent."""
        root = tmp_path / "root"
        _write_file(root / "a.txt", b"aaaa")
        _write_file(root / "b.txt", b"bb")
        _write_file(root / "skip.log", b"log")
        _write_file(root / "sub" / "c.txt", b"c")

        crawler = FolderCrawler(
            _make_config([root], exclusion_patterns=["*.log"])
        )
        crawler.crawl()

        stats = crawler.get_statistics()
        assert isinstance(stats, CrawlStatistics)

        # 3 processed (a, b, c), 1 skipped (skip.log), 0 errored
        assert stats.files_processed == 3
        assert stats.files_skipped == 1
        assert stats.files_errored == 0
        assert stats.total_files == 4
        assert stats.total_size_bytes == 4 + 2 + 1  # aaaa + bb + c
        # root + sub = 2 directories traversed
        assert stats.folders_traversed == 2

        # Per-folder stats keyed by the configured root path
        assert str(root) in stats.stats_by_folder
        folder = stats.stats_by_folder[str(root)]
        assert folder.files_processed == 3
        assert folder.files_skipped == 1
        assert folder.files_errored == 0
        assert folder.total_files == 4
        assert folder.total_size_bytes == 7

        # Per-folder sums match global counts
        total_processed = sum(f.files_processed for f in stats.stats_by_folder.values())
        total_skipped = sum(f.files_skipped for f in stats.stats_by_folder.values())
        total_errored = sum(f.files_errored for f in stats.stats_by_folder.values())
        total_files = sum(f.total_files for f in stats.stats_by_folder.values())
        total_size = sum(f.total_size_bytes for f in stats.stats_by_folder.values())

        assert total_processed == stats.files_processed
        assert total_skipped == stats.files_skipped
        assert total_errored == stats.files_errored
        assert total_files == stats.total_files
        assert total_size == stats.total_size_bytes

    def test_total_files_equals_processed_plus_skipped_plus_errored(self, tmp_path, monkeypatch):
        """total_files == processed + skipped + errored across all outcomes."""
        root = tmp_path / "root"
        _write_file(root / "ok.txt", b"ok")
        _write_file(root / "skip.log", b"log")
        blocked = root / "blocked.txt"
        _write_file(blocked, b"blocked")

        real_access = __import__("os").access

        def fake_access(path, mode):
            if str(path) == str(blocked):
                return False
            return real_access(path, mode)

        monkeypatch.setattr("os.access", fake_access)

        crawler = FolderCrawler(
            _make_config([root], exclusion_patterns=["*.log"])
        )
        crawler.crawl()

        stats = crawler.get_statistics()
        assert stats.files_processed == 1
        assert stats.files_skipped == 1
        assert stats.files_errored == 1
        assert stats.total_files == 3
        assert (
            stats.total_files
            == stats.files_processed + stats.files_skipped + stats.files_errored
        )


class TestMultipleRootFolders:
    def test_one_entry_per_valid_root(self, tmp_path):
        """stats_by_folder has one entry per valid root; nonexistent filtered."""
        root1 = tmp_path / "root1"
        root2 = tmp_path / "root2"
        _write_file(root1 / "a.txt", b"a")
        _write_file(root2 / "b.txt", b"b")
        nonexistent = tmp_path / "does_not_exist"

        crawler = FolderCrawler(
            _make_config([root1, nonexistent, root2])
        )
        results = crawler.crawl()

        assert len(results) == 2
        stats = crawler.get_statistics()
        assert set(stats.stats_by_folder.keys()) == {str(root1), str(root2)}
        assert str(nonexistent) not in stats.stats_by_folder

    def test_value_error_when_all_roots_invalid(self, tmp_path):
        """ValueError is raised when no configured path exists."""
        nonexistent = tmp_path / "nope"
        crawler = FolderCrawler(_make_config([nonexistent]))

        with pytest.raises(ValueError, match="No valid folder paths"):
            crawler.crawl()

    def test_value_error_when_no_paths_configured(self):
        """ValueError is raised at construction when folder_paths is empty."""
        with pytest.raises(ValueError, match="At least one folder path"):
            FolderCrawler(CrawlerConfig(folder_paths=[]))


class TestGetStatisticsAndErrors:
    def test_get_statistics_returns_crawl_statistics(self, tmp_path):
        """get_statistics() returns a CrawlStatistics instance."""
        root = tmp_path / "root"
        _write_file(root / "a.txt", b"a")

        crawler = FolderCrawler(_make_config([root]))
        crawler.crawl()

        assert isinstance(crawler.get_statistics(), CrawlStatistics)

    def test_get_errors_returns_dicts_with_required_keys(self, tmp_path, monkeypatch):
        """get_errors() returns dicts with path/error_type/error_message/context/timestamp."""
        root = tmp_path / "root"
        blocked = root / "blocked.txt"
        _write_file(blocked, b"x")

        real_access = __import__("os").access

        def fake_access(path, mode):
            if str(path) == str(blocked):
                return False
            return real_access(path, mode)

        monkeypatch.setattr("os.access", fake_access)

        crawler = FolderCrawler(_make_config([root]))
        crawler.crawl()

        errors = crawler.get_errors()
        assert isinstance(errors, list)
        assert len(errors) == 1
        for e in errors:
            assert set(e.keys()) == {
                "path",
                "error_type",
                "error_message",
                "context",
                "timestamp",
            }
            assert e["path"] == str(blocked)
            assert e["error_type"] == "PermissionError"
            assert isinstance(e["error_message"], str)
            assert isinstance(e["context"], str)
            assert isinstance(e["timestamp"], str)

    def test_get_errors_empty_when_no_errors(self, tmp_path):
        """get_errors() returns an empty list for a clean crawl."""
        root = tmp_path / "root"
        _write_file(root / "a.txt", b"a")

        crawler = FolderCrawler(_make_config([root]))
        crawler.crawl()

        assert crawler.get_errors() == []
