"""Core data models for the Personal Folder Trained Agent system.

This module defines all dataclasses used across the system for representing
file metadata, text extraction results, training chunks, and inference outputs.
"""

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class FileStatus(Enum):
    """Status of a file during processing."""

    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    ERROR = "ERROR"
    SKIPPED = "SKIPPED"


class ErrorSeverity(Enum):
    """Severity levels for error classification."""

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class ChunkingStrategy(Enum):
    """Available chunking strategies for text splitting."""

    FIXED_SIZE = "fixed_size"
    SENTENCE_AWARE = "sentence_aware"
    PARAGRAPH_AWARE = "paragraph_aware"


@dataclass
class CrawlerConfig:
    """Configuration for the FolderCrawler component.

    Attributes:
        folder_paths: List of absolute or relative directory paths to crawl.
        max_depth: Maximum recursion depth for directory traversal (default 10).
        exclusion_patterns: Glob patterns for files/directories to skip
            (e.g., ['*.log', 'node_modules/**']).
    """

    folder_paths: List[str]
    max_depth: int = 10
    exclusion_patterns: List[str] = field(default_factory=list)


@dataclass
class FileMetadata:
    """Metadata for a single file discovered during crawling.

    Attributes:
        path: Absolute file path.
        size_bytes: File size in bytes.
        extension: File extension (e.g., '.pdf', '.docx').
        last_modified: Last modification timestamp in ISO 8601 format.
        sha256_hash: SHA-256 hash of file content for integrity verification.
        permissions: File permission string (e.g., 'rwxr-xr-x').
        processing_status: Current processing status of the file.
    """

    path: str
    size_bytes: int
    extension: str
    last_modified: datetime
    sha256_hash: str
    permissions: str
    processing_status: FileStatus = FileStatus.PENDING


@dataclass
class TextExtractionResult:
    """Result of text extraction from a single file.

    Attributes:
        file_metadata: Metadata of the source file.
        extracted_text: The extracted and cleaned text content.
        extraction_method: Method used for extraction (e.g., 'pdfplumber', 'python-docx').
        error_message: Error message if extraction failed, None otherwise.
        processing_time_ms: Time taken for extraction in milliseconds.
    """

    file_metadata: FileMetadata
    extracted_text: str
    extraction_method: str
    error_message: Optional[str] = None
    processing_time_ms: int = 0


@dataclass
class TextChunk:
    """A chunk of text prepared for model training.

    Attributes:
        text: The text content of the chunk.
        source_file: Path to the source file this chunk was extracted from.
        chunk_index: Index of this chunk within the source document.
        byte_offset: Byte offset of the chunk start within the source file.
        token_count: Number of tokens in this chunk.
        chunk_id: Unique identifier in format '{file_path}:{chunk_index}'.
        metadata: Additional context and metadata for the chunk.
    """

    text: str
    source_file: str
    chunk_index: int
    byte_offset: int
    token_count: int
    chunk_id: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-serializable dict of this chunk's source metadata.

        Per Requirement 2.5, the source file reference for each chunk is
        maintained in JSON format including file path, chunk index, byte
        offset, and token count. The chunk_id (``{file_path}:{chunk_index}``)
        is also included for unambiguous identification.

        Returns:
            A dict with keys ``file_path``, ``chunk_index``, ``byte_offset``,
            ``token_count``, and ``chunk_id``.
        """
        return {
            "file_path": self.source_file,
            "chunk_index": self.chunk_index,
            "byte_offset": self.byte_offset,
            "token_count": self.token_count,
            "chunk_id": self.chunk_id,
        }

    def to_json(self) -> str:
        """Serialize this chunk's source metadata to a JSON string.

        Returns:
            A JSON string containing file path, chunk index, byte offset,
            token count, and chunk_id.
        """
        return json.dumps(self.to_dict())


@dataclass
class DataStatistics:
    """Statistics about the processed dataset.

    Attributes:
        total_files: Total number of files processed.
        total_chunks: Total number of text chunks generated.
        total_tokens: Total token count across all chunks.
        files_by_format: Breakdown of files by format (extension -> count).
        avg_chunk_size: Average chunk size in tokens.
    """

    total_files: int = 0
    total_chunks: int = 0
    total_tokens: int = 0
    files_by_format: Dict[str, int] = field(default_factory=dict)
    avg_chunk_size: float = 0.0


@dataclass
class PerformanceMetrics:
    """Performance metrics from a training session.

    Attributes:
        final_loss: Final training loss value.
        final_validation_loss: Final validation loss value.
        training_duration_seconds: Total training duration in seconds.
        tokens_per_second: Average tokens processed per second.
        peak_memory_mb: Peak memory usage in megabytes during training.
    """

    final_loss: float = 0.0
    final_validation_loss: float = 0.0
    training_duration_seconds: float = 0.0
    tokens_per_second: float = 0.0
    peak_memory_mb: float = 0.0


@dataclass
class TrainingMetadata:
    """Metadata about a training session.

    Attributes:
        training_id: Unique identifier for the training session.
        start_time: When training started.
        end_time: When training ended, None if still in progress.
        hyperparameters: Training hyperparameters used.
        data_statistics: Statistics about the training data.
        performance_metrics: Performance metrics from training.
        checkpoint_paths: Paths to saved checkpoints.
    """

    training_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    hyperparameters: Dict[str, Any] = field(default_factory=dict)
    data_statistics: DataStatistics = field(default_factory=DataStatistics)
    performance_metrics: PerformanceMetrics = field(default_factory=PerformanceMetrics)
    checkpoint_paths: List[str] = field(default_factory=list)


@dataclass
class InferenceResult:
    """Result of an inference query against the trained model.

    Attributes:
        query: The original user query.
        response: Generated response text.
        processing_time_ms: Time taken to generate the response in milliseconds.
        context_files: List of file paths used as context for the response.
        confidence_score: Confidence score of the response (0.0 to 1.0).
        tokens_generated: Number of tokens in the generated response.
    """

    query: str
    response: str
    processing_time_ms: int
    context_files: List[str] = field(default_factory=list)
    confidence_score: float = 0.0
    tokens_generated: int = 0


@dataclass
class FolderStatistics:
    """Per-folder breakdown of crawl statistics for one configured root folder.

    Attributes:
        total_files: Total files discovered within this folder (recursively).
        files_processed: Files successfully processed within this folder.
        files_skipped: Files skipped within this folder (e.g. matched an
            exclusion pattern).
        files_errored: Files that encountered errors within this folder.
        total_size_bytes: Total size in bytes of successfully processed
            files within this folder.
    """

    total_files: int = 0
    files_processed: int = 0
    files_skipped: int = 0
    files_errored: int = 0
    total_size_bytes: int = 0


@dataclass
class CrawlStatistics:
    """Statistics from a folder crawl operation.

    Attributes:
        total_files: Total files discovered.
        files_processed: Files successfully processed.
        files_skipped: Files skipped (unsupported format, etc.).
        files_errored: Files that encountered errors.
        total_size_bytes: Total size of all discovered files.
        folders_traversed: Number of directories traversed.
        stats_by_folder: Per-folder breakdown keyed by the configured root
            folder path (as given in CrawlerConfig.folder_paths), each
            tracking files processed/skipped/errored within that folder.
    """

    total_files: int = 0
    files_processed: int = 0
    files_skipped: int = 0
    files_errored: int = 0
    total_size_bytes: int = 0
    folders_traversed: int = 0
    stats_by_folder: Dict[str, FolderStatistics] = field(default_factory=dict)


@dataclass
class SearchResult:
    """Result of a file content search operation.

    Attributes:
        file_path: Path to the matching file.
        chunk_text: Relevant text chunk from the file.
        similarity_score: Cosine similarity score (0.0 to 1.0).
        chunk_id: ID of the matching chunk.
    """

    file_path: str
    chunk_text: str
    similarity_score: float
    chunk_id: str


@dataclass
class ExportResult:
    """Result of a model export operation.

    Attributes:
        local_path: Path where the model was saved locally.
        archive_name: Name of the versioned archive file.
        metadata_path: Path to the metadata JSON file.
        success: Whether the export was successful.
        error_message: Error message if export failed.
    """

    local_path: str
    archive_name: str
    metadata_path: str
    success: bool = True
    error_message: Optional[str] = None


@dataclass
class UploadResult:
    """Result of a Google Drive upload operation.

    Attributes:
        drive_file_id: Google Drive file ID of the uploaded file.
        drive_url: URL to access the file on Google Drive.
        encrypted: Whether the file was encrypted before upload.
        success: Whether the upload was successful.
        error_message: Error message if upload failed.
    """

    drive_file_id: str = ""
    drive_url: str = ""
    encrypted: bool = False
    success: bool = True
    error_message: Optional[str] = None


@dataclass
class ProgressReport:
    """Comprehensive progress report for the processing pipeline.

    Attributes:
        total_files_processed: Total files processed across all folders.
        total_tokens_extracted: Total tokens extracted from all files.
        training_duration_seconds: Training duration in seconds.
        final_validation_loss: Final validation loss from training.
        errors: List of error records encountered during processing.
        current_stage: Current processing stage name.
        percent_complete: Overall completion percentage (0-100).
    """

    total_files_processed: int = 0
    total_tokens_extracted: int = 0
    training_duration_seconds: float = 0.0
    final_validation_loss: float = 0.0
    errors: List[Dict[str, Any]] = field(default_factory=list)
    current_stage: str = ""
    percent_complete: float = 0.0
