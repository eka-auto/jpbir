"""Concrete implementation of the FolderCrawler component.

This module provides recursive directory traversal with depth limiting,
file metadata collection (SHA-256 hashing, size, timestamps), permission
checking, and exclusion pattern support.
"""

import hashlib
import logging
import os
import stat
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path
from typing import Any, Dict, List

from personal_folder_agent.interfaces import FolderCrawler as FolderCrawlerBase
from personal_folder_agent.models import CrawlerConfig, CrawlStatistics, FileMetadata, FileStatus

logger = logging.getLogger(__name__)


class FolderCrawler(FolderCrawlerBase):
    """Recursively traverses directories and collects file metadata.

    Implements depth-limited recursion (max depth configurable, default 10),
    SHA-256 hashing for file integrity, permission checking before access,
    and glob-based exclusion patterns.

    Args:
        config: CrawlerConfig with folder_paths, max_depth, and exclusion_patterns.

    Raises:
        ValueError: If no valid folder paths are configured.
    """

    def __init__(self, config: CrawlerConfig) -> None:
        self._config = config
        self._statistics = CrawlStatistics()
        self._results: List[FileMetadata] = []
        self._errors: List[Dict[str, Any]] = []

        if not config.folder_paths:
            raise ValueError("At least one folder path must be configured.")

    def crawl(self) -> List[FileMetadata]:
        """Recursively traverse configured directories and collect file metadata.

        Traverses each folder path in the configuration up to the configured
        max_depth. Checks permissions before accessing files and skips
        entries matching exclusion patterns.

        Returns:
            List of FileMetadata objects for all accessible files.

        Raises:
            ValueError: If no valid folder paths are configured.
        """
        self._results = []
        self._statistics = CrawlStatistics()
        self._errors = []

        valid_paths = [p for p in self._config.folder_paths if os.path.isdir(p)]
        if not valid_paths:
            raise ValueError(
                "No valid folder paths found. Ensure configured paths exist on the system."
            )

        for folder_path in valid_paths:
            self._traverse_directory(Path(folder_path), current_depth=0)

        return self._results

    def get_statistics(self) -> CrawlStatistics:
        """Return statistics from the most recent crawl operation.

        Returns:
            CrawlStatistics with file counts, size totals, and error info.
        """
        return self._statistics

    def get_errors(self) -> List[Dict[str, Any]]:
        """Return error records from the most recent crawl operation.

        Each record contains the affected path, the specific exception type
        (e.g. 'PermissionError', 'OSError'), a human-readable message, the
        operation being attempted, and a timestamp. This makes errors
        inspectable after the crawl completes rather than only visible in
        logs (Requirements 1.4, 9.1).

        Returns:
            A list of error record dictionaries, in the order encountered.
        """
        return list(self._errors)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _record_error(self, path: Path, exc: Exception, context: str) -> None:
        """Record and log an error without interrupting traversal.

        Captures the path, the specific exception type, and message so the
        error can be inspected later (e.g. by ProgressMonitor/statistics in
        task 3.3), and writes a single log entry that always includes the
        file/directory path and the error type (Requirements 1.4, 9.1).

        Args:
            path: The file or directory path where the error occurred.
            exc: The exception instance describing the failure.
            context: Short description of the attempted operation
                (e.g. 'list directory', 'read file').
        """
        error_type = type(exc).__name__
        error_record = {
            "path": str(path),
            "error_type": error_type,
            "error_message": str(exc),
            "context": context,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._errors.append(error_record)
        logger.error(
            "Failed to %s '%s': %s: %s",
            context,
            path,
            error_type,
            exc,
        )

    def _traverse_directory(self, directory: Path, current_depth: int) -> None:
        """Recursively traverse a directory up to max_depth.

        Errors encountered while listing the directory or inspecting an
        entry are logged and recorded, and traversal continues with
        remaining siblings/directories rather than propagating the
        exception up the call stack (Requirements 1.4, 9.1).

        Args:
            directory: The directory path to traverse.
            current_depth: Current recursion depth (0-indexed from the root folder).
        """
        if current_depth > self._config.max_depth:
            return

        self._statistics.folders_traversed += 1

        try:
            entries = sorted(directory.iterdir())
        except OSError as exc:
            # Covers PermissionError (a subclass of OSError) and other I/O
            # failures listing this directory. The parent's traversal loop
            # continues with the next sibling directory/entry.
            self._record_error(directory, exc, "list directory")
            return

        for entry in entries:
            if self._is_excluded(entry):
                continue

            try:
                is_dir = entry.is_dir()
                is_file = (not is_dir) and entry.is_file()
            except OSError as exc:
                # entry.is_dir()/is_file() can themselves raise (e.g. a
                # child with broken/inaccessible metadata). Skip just this
                # entry and continue with the remaining siblings.
                self._record_error(entry, exc, "stat directory entry")
                continue

            if is_dir:
                self._traverse_directory(entry, current_depth + 1)
            elif is_file:
                self._process_file(entry)

    def _process_file(self, file_path: Path) -> None:
        """Collect metadata for a single file.

        Checks read permissions BEFORE any read attempt (stat, open, or
        hashing). If the file is inaccessible or reading it fails for any
        reason (permission denied, corruption, file lock, transient OS
        error), the error is logged with the file path and specific error
        type, recorded for later inspection, and processing continues with
        the next file in the same directory (Requirements 1.4, 6.3, 9.1).

        Args:
            file_path: Path to the file to process.
        """
        self._statistics.total_files += 1

        # Permission check happens before any read attempt (Requirements 1.4, 6.3)
        if not self._has_read_permission(file_path):
            self._record_error(
                file_path,
                PermissionError("Insufficient read permissions"),
                "check read permission",
            )
            self._statistics.files_errored += 1
            return

        try:
            file_stat = file_path.stat()
            sha256_hash = self._compute_sha256(file_path)

            last_modified = datetime.fromtimestamp(
                file_stat.st_mtime, tz=timezone.utc
            )

            permissions = stat.filemode(file_stat.st_mode)

            metadata = FileMetadata(
                path=str(file_path),
                size_bytes=file_stat.st_size,
                extension=file_path.suffix.lower(),
                last_modified=last_modified,
                sha256_hash=sha256_hash,
                permissions=permissions,
                processing_status=FileStatus.PENDING,
            )

            self._results.append(metadata)
            self._statistics.files_processed += 1
            self._statistics.total_size_bytes += file_stat.st_size

        except OSError as exc:
            # Covers PermissionError, file locks (Windows sharing
            # violations surface as OSError/PermissionError), missing
            # files removed mid-crawl, and other I/O failures.
            self._record_error(file_path, exc, "read file")
            self._statistics.files_errored += 1
        except (ValueError, UnicodeError) as exc:
            # Defensive: guards against unexpected decode/format errors so
            # a single problematic file never aborts the whole crawl.
            self._record_error(file_path, exc, "read file")
            self._statistics.files_errored += 1

    def _has_read_permission(self, file_path: Path) -> bool:
        """Check if the current user has read permission for a file.

        Args:
            file_path: Path to check.

        Returns:
            True if the file is readable, False otherwise.
        """
        return os.access(file_path, os.R_OK)

    def _compute_sha256(self, file_path: Path) -> str:
        """Compute SHA-256 hash of a file's content.

        Reads the file in 64KB chunks for memory efficiency.

        Args:
            file_path: Path to the file to hash.

        Returns:
            Hex-encoded SHA-256 hash string.
        """
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sha256.update(chunk)
        return sha256.hexdigest()

    def _is_excluded(self, entry: Path) -> bool:
        """Check if a path matches any exclusion pattern.

        Patterns are matched against the entry name and the full path using
        fnmatch-style glob matching. Directory-tree patterns (e.g.
        'node_modules/**', '.git/**') are matched against every path
        component so that a directory is excluded (and never recursed into)
        regardless of how deep it appears under a configured root folder.

        Args:
            entry: Path entry to check against exclusion patterns.

        Returns:
            True if the entry should be excluded, False otherwise.
        """
        name = entry.name
        path_str = entry.as_posix()

        for pattern in self._config.exclusion_patterns:
            normalized_pattern = pattern.replace("\\", "/")

            # Match against the file/directory name (e.g. '*.log', '*.pyc')
            if fnmatch(name, normalized_pattern):
                return True

            # Match against the full path (e.g. absolute-style patterns)
            if fnmatch(path_str, normalized_pattern):
                return True

            # Directory-tree patterns like 'node_modules/**' or '.git/**':
            # exclude if any ancestor path component matches the directory
            # prefix. Since this is checked before recursing into
            # directories, matching directories are skipped entirely along
            # with their contents.
            if normalized_pattern.endswith("/**"):
                dir_pattern = normalized_pattern[:-3]
                if any(fnmatch(part, dir_pattern) for part in entry.parts):
                    return True

        return False
