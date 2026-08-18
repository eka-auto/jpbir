"""Personal Folder Trained Agent - A system for creating AI agents fine-tuned on personal folder content."""

__version__ = "0.1.0"

from personal_folder_agent.models import (
    ChunkingStrategy,
    CrawlerConfig,
    CrawlStatistics,
    DataStatistics,
    ErrorSeverity,
    ExportResult,
    FileMetadata,
    FileStatus,
    InferenceResult,
    PerformanceMetrics,
    ProgressReport,
    SearchResult,
    TextChunk,
    TextExtractionResult,
    TrainingMetadata,
    UploadResult,
)
from personal_folder_agent.interfaces import (
    ConfigurationManager,
    FolderCrawler,
    InferenceEngine,
    ModelExporter,
    ProgressMonitor,
    TextChunker,
    TextProcessor,
    TrainingPipeline,
)

__all__ = [
    # Enums
    "FileStatus",
    "ErrorSeverity",
    "ChunkingStrategy",
    # Data models
    "CrawlerConfig",
    "FileMetadata",
    "TextExtractionResult",
    "TextChunk",
    "DataStatistics",
    "PerformanceMetrics",
    "TrainingMetadata",
    "InferenceResult",
    "CrawlStatistics",
    "SearchResult",
    "ExportResult",
    "UploadResult",
    "ProgressReport",
    # Abstract interfaces
    "FolderCrawler",
    "TextProcessor",
    "TextChunker",
    "TrainingPipeline",
    "ModelExporter",
    "InferenceEngine",
    "ConfigurationManager",
    "ProgressMonitor",
]
