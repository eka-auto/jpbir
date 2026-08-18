"""Abstract base classes defining interfaces for all core components.

This module defines the contracts that each component must implement.
All components are designed to be loosely coupled with clear boundaries.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from personal_folder_agent.models import (
    CrawlStatistics,
    ExportResult,
    FileMetadata,
    InferenceResult,
    ProgressReport,
    SearchResult,
    TextChunk,
    TextExtractionResult,
    TrainingMetadata,
    UploadResult,
)


class FolderCrawler(ABC):
    """Abstract base class for folder crawling operations.

    Responsible for recursively traversing user-specified directories,
    collecting file metadata, and handling permission errors gracefully.
    """

    @abstractmethod
    def crawl(self) -> List[FileMetadata]:
        """Recursively traverse configured directories and collect file metadata.

        Returns:
            List of FileMetadata objects for all accessible files found
            during the traversal.

        Raises:
            ValueError: If no valid folder paths are configured.
        """
        ...

    @abstractmethod
    def get_statistics(self) -> CrawlStatistics:
        """Return statistics about the most recent crawl operation.

        Returns:
            CrawlStatistics with counts of files processed, skipped,
            errored, and total size information.
        """
        ...


class TextProcessor(ABC):
    """Abstract base class for text extraction from various file formats.

    Responsible for extracting text content from files using format-specific
    libraries, cleaning the extracted text, and handling unsupported formats.
    """

    @abstractmethod
    def extract_text(self, file_path: str, file_metadata: FileMetadata) -> TextExtractionResult:
        """Extract and clean text content from a file.

        Uses format-specific extraction methods based on file extension.
        Handles encoding detection and normalization to UTF-8.

        Args:
            file_path: Absolute path to the file to process.
            file_metadata: Pre-collected metadata about the file.

        Returns:
            TextExtractionResult containing the extracted text and
            processing metadata.
        """
        ...

    @abstractmethod
    def get_supported_formats(self) -> List[str]:
        """Return list of supported file extensions.

        Returns:
            List of file extensions (e.g., ['.pdf', '.docx', '.txt'])
            that this processor can handle.
        """
        ...


class TextChunker(ABC):
    """Abstract base class for splitting documents into training chunks.

    Responsible for splitting large texts into chunks of 512-1024 tokens,
    preserving context boundaries, and maintaining source references.
    """

    @abstractmethod
    def chunk_document(self, text: str, source_file: str) -> List[TextChunk]:
        """Split a document's text into manageable chunks for training.

        Splits text into chunks respecting the configured token limits
        (512-1024 tokens) while preserving context boundaries.

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
        ...

    @abstractmethod
    def count_tokens(self, text: str) -> int:
        """Count tokens in a text string using the configured tokenizer.

        Args:
            text: Text to count tokens for.

        Returns:
            Number of tokens in the text according to the Qwen tokenizer.
        """
        ...


class TrainingPipeline(ABC):
    """Abstract base class for the model training pipeline.

    Responsible for preparing training data, configuring the model,
    executing fine-tuning, monitoring progress, and saving checkpoints.
    """

    @abstractmethod
    def train(self, text_chunks: List[TextChunk]) -> TrainingMetadata:
        """Execute the full training pipeline on prepared text chunks.

        Prepares 80/20 train/validation split, configures the model,
        runs fine-tuning, and monitors training progress.

        Args:
            text_chunks: List of TextChunk objects to train on.

        Returns:
            TrainingMetadata with session details, metrics, and checkpoint paths.

        Raises:
            RuntimeError: If training fails and cannot be recovered.
        """
        ...

    @abstractmethod
    def resume_from_checkpoint(self, checkpoint_path: str) -> TrainingMetadata:
        """Resume training from a previously saved checkpoint.

        Loads model weights, optimizer state, and training metadata
        from the checkpoint, then continues training.

        Args:
            checkpoint_path: Path to the checkpoint directory or file.

        Returns:
            TrainingMetadata with updated session information.

        Raises:
            FileNotFoundError: If the checkpoint path does not exist.
            RuntimeError: If the checkpoint is corrupted or incompatible.
        """
        ...


class ModelExporter(ABC):
    """Abstract base class for exporting trained models.

    Responsible for saving models to local storage, creating metadata files,
    handling Google Drive uploads with encryption, and versioning.
    """

    @abstractmethod
    def export_model(self, model: Any, training_metadata: TrainingMetadata) -> ExportResult:
        """Save the trained model and metadata to configured storage.

        Creates a versioned archive with the model weights, configuration,
        and training metadata in the configured output directory.

        Args:
            model: The trained model object to export.
            training_metadata: Metadata about the training session.

        Returns:
            ExportResult with paths to saved artifacts and status.
        """
        ...

    @abstractmethod
    def upload_to_google_drive(self, local_path: str, drive_folder_id: str) -> UploadResult:
        """Encrypt and upload model artifacts to Google Drive.

        Encrypts the model data using AES-256-GCM before uploading
        to the specified Google Drive folder.

        Args:
            local_path: Path to the local model archive to upload.
            drive_folder_id: Google Drive folder ID for the upload destination.

        Returns:
            UploadResult with Drive file ID, URL, and status.

        Raises:
            ConnectionError: If Google Drive is unreachable.
            PermissionError: If authentication fails.
        """
        ...


class InferenceEngine(ABC):
    """Abstract base class for the inference engine.

    Responsible for loading trained models, processing user queries,
    performing semantic search, and generating personalized responses.
    """

    @abstractmethod
    def generate_response(self, query: str, context_files: Optional[List[str]] = None) -> InferenceResult:
        """Generate a response to a user query using the trained model.

        Validates the query, retrieves relevant context from file chunks,
        and generates a response using the fine-tuned model.

        Args:
            query: User query string (max 2000 characters).
            context_files: Optional list of specific file paths to use as context.

        Returns:
            InferenceResult with the generated response, timing, and metadata.

        Raises:
            ValueError: If query exceeds 2000 characters or has invalid syntax.
            TimeoutError: If response generation exceeds 30 seconds.
        """
        ...

    @abstractmethod
    def search_files(self, query: str, top_k: int = 3) -> List[SearchResult]:
        """Search file content using semantic similarity.

        Uses sentence-transformers to find the most relevant text chunks
        matching the query using cosine similarity.

        Args:
            query: Search query string.
            top_k: Number of top results to return (default: 3).

        Returns:
            List of SearchResult objects ranked by similarity score.
        """
        ...


class ConfigurationManager(ABC):
    """Abstract base class for configuration management.

    Responsible for loading, validating, and saving YAML configuration files,
    managing authentication, and providing sensible defaults.
    """

    @abstractmethod
    def load_configuration(self) -> Dict[str, Any]:
        """Load and validate the system configuration from a YAML file.

        Parses the configuration file, validates all parameters against
        their expected ranges and types, and applies defaults for missing values.

        Returns:
            Dictionary containing the validated system configuration.

        Raises:
            FileNotFoundError: If the configuration file does not exist.
            ValueError: If configuration contains invalid parameters.
        """
        ...

    @abstractmethod
    def save_configuration(self, config: Dict[str, Any]) -> bool:
        """Save the current configuration to the YAML file.

        Validates the configuration before saving and handles
        authentication for sensitive configuration files.

        Args:
            config: Configuration dictionary to save.

        Returns:
            True if the configuration was saved successfully, False otherwise.

        Raises:
            PermissionError: If authentication is required but not provided.
            ValueError: If the configuration is invalid.
        """
        ...


class ProgressMonitor(ABC):
    """Abstract base class for progress monitoring and reporting.

    Responsible for tracking processing progress, displaying real-time
    updates, generating reports, and providing diagnostic information.
    """

    @abstractmethod
    def update_progress(self, stage: str, current: int, total: int, details: Optional[Dict[str, Any]] = None) -> None:
        """Update the progress display for a processing stage.

        Updates the real-time progress information including current step,
        total steps, and optional details about the current operation.

        Args:
            stage: Name of the current processing stage (e.g., 'crawling', 'training').
            current: Current step number.
            total: Total number of steps in this stage.
            details: Optional dictionary with additional details (e.g., file name, loss value).
        """
        ...

    @abstractmethod
    def generate_report(self) -> ProgressReport:
        """Generate a comprehensive JSON-compatible progress report.

        Creates a summary report with total files processed, tokens extracted,
        training duration, validation loss, and any errors encountered.

        Returns:
            ProgressReport with complete processing statistics.
        """
        ...
