# Implementation Plan: Personal Folder Trained Agent

## Overview

Implement a Python-based system that enables users to create personalized AI agents fine-tuned on their personal folder structure and content. The system crawls user-specified directories (minimum 36 folders), extracts text from multiple file formats, processes content into training chunks, fine-tunes a Qwen 2.5-3B model, and provides an inference interface for querying the trained agent.

**Implementation Language:** Python

**Core Components:**
1. Folder Crawler - Recursive directory traversal and file metadata collection
2. Text Processor - Format-specific text extraction and cleaning
3. Text Chunker - Document splitting into 512-1024 token chunks
4. Configuration Manager - YAML parsing and hyperparameter validation
5. Training Pipeline - Qwen 2.5-3B fine-tuning with checkpointing
6. Model Exporter - Local/Google Drive model persistence with versioning
7. Inference Engine - Query processing with semantic search
8. Progress Monitor - Real-time progress tracking and reporting

## Tasks

- [x] 1. Set up project structure and core interfaces
  - [x] 1.1 Create project directory structure
    - Create main package directory `personal_folder_agent/`
    - Create subdirectories: `components/`, `utils/`, `tests/`, `configs/`
    - Create `__init__.py` files for proper Python package structure
    - _Requirements: 7.1_

  - [x] 1.2 Define core data models and interfaces
    - Implement Python dataclasses: `FileMetadata`, `TextExtractionResult`, `TextChunk`, `TrainingMetadata`, `InferenceResult`, `ModelMetadata`
    - Define base interfaces/abstract classes for all components
    - Create type hints and docstrings for all public methods
    - _Requirements: 1.3, 2.5, 4.2_

  - [x] 1.3 Set up Python environment and dependencies
    - Create `requirements.txt` with pinned versions (transformers>=4.45, accelerate>=0.30, trl>=0.10, tiktoken>=0.7, sentence-transformers>=3.0, pdfplumber>=0.11, python-docx>=0.8, openpyxl>=3.1, python-pptx>=0.6, pandas>=2.0, hypothesis, pytest)
    - Create `pyproject.toml` with project metadata and build configuration
    - _Requirements: 3.1_

  - [x] 1.4 Write unit tests for data models
    - Test dataclass instantiation and field validation
    - Test serialization/deserialization to JSON
    - _Requirements: 1.3, 2.5_

- [x] 2. Checkpoint - Verify project structure
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Implement Folder Crawler component
  - [x] 3.1 Create FolderCrawler class with recursive traversal
    - Implement `__init__()` accepting CrawlerConfig (max_depth, folder_paths, exclusion_patterns)
    - Implement `crawl()` method with depth-limited recursion (max depth 10)
    - Implement file metadata collection: path, extension, size_bytes, last_modified (ISO 8601), SHA-256 hash
    - Handle minimum 36 folder paths from configuration
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.2 Implement permission checking and error handling
    - Check file read permissions before reading any file
    - Skip files where current user lacks read permissions
    - Log errors with file path and error type to error log
    - Continue processing other files in the same folder on errors
    - _Requirements: 1.4, 6.3, 9.1_

  - [x] 3.3 Add statistics collection and reporting
    - Implement `get_statistics()` returning CrawlStatistics
    - Track files processed, files skipped, errors encountered per folder
    - _Requirements: 8.1, 8.3_

  - [x] 3.4 Write unit tests for Folder Crawler
    - Test recursive directory traversal with mock file system
    - Test permission error handling and graceful continuation
    - Test statistics collection accuracy
    - _Requirements: 1.1, 1.4_

- [ ] 4. Implement Text Processor component
  - [x] 4.1 Create TextProcessor class and format handlers
    - Implement base TextProcessor class with `extract_text()` method
    - Create format-specific handlers: PDFHandler (pdfplumber), DOCXHandler (python-docx), XLSXHandler (openpyxl), PPTXHandler (python-pptx), CSVHandler (pandas), TextHandler (plain text with encoding detection)
    - _Requirements: 2.1, 2.2_

  - [x] 4.2 Implement text cleaning and normalization
    - Remove Unicode control characters U+0000 to U+001F (excluding U+0009 tab, U+000A LF, U+000D CR)
    - Normalize extra whitespace and line endings to LF
    - Handle encoding detection and conversion to UTF-8
    - _Requirements: 2.1_

  - [x] 4.3 Add fallback handling for unsupported formats
    - Attempt basic text extraction (treat as plain text) for unsupported formats
    - Log warning with file extension if fallback also fails
    - Skip file and continue processing
    - _Requirements: 2.6, 9.1_

  - [x] 4.4 Write property test for text cleaning
    - **Property 1: Text Cleaning Preserves Allowed Characters**
    - For any input string, verify cleaning removes exactly the forbidden control characters and preserves all others
    - **Validates: Requirements 2.1**

  - [x] 4.5 Write integration tests for Text Processor
    - Test text extraction from sample files (PDF, DOCX, XLSX, PPTX, TXT)
    - Test fallback behavior for unsupported formats
    - _Requirements: 2.1, 2.2, 2.6_

- [ ] 5. Checkpoint - Verify data extraction components
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Text Chunker component
  - [x] 6.1 Create TextChunker class with token counting
    - Implement `__init__()` with Qwen 2.5 tokenizer initialization
    - Implement `count_tokens()` using tiktoken cl100k_base for estimation and Qwen tokenizer for final count
    - Add chunk size validation (512-1024 tokens)
    - _Requirements: 2.3, 2.4_

  - [x] 6.2 Implement chunking strategies
    - Implement `SentenceAwareChunker`: split at sentence boundaries preserving context
    - Implement `ParagraphAwareChunker`: preserve paragraph structure
    - Implement `FixedSizeChunker`: fixed token size chunks with overlap
    - Only chunk documents larger than 100KB
    - _Requirements: 2.3, 7.3_

  - [x] 6.3 Add source file reference management
    - Maintain source metadata for each chunk in JSON format
    - Generate chunk IDs: `{file_path}:{chunk_index}`
    - Store file path, chunk index, byte offset, and token count per chunk
    - _Requirements: 2.5_

  - [ ] 6.4 Write property test for chunk token bounds
    - **Property 2: Chunk Token Count Bounds**
    - For any document >100KB, verify all chunks have 512-1024 tokens
    - **Validates: Requirements 2.3, 2.4**

  - [ ] 6.5 Write property test for chunk metadata completeness
    - **Property 3: Chunk Metadata Completeness**
    - For any chunk, verify metadata contains: file path (non-empty), chunk index (>=0), byte offset (>=0), token count (>0 matching actual)
    - **Validates: Requirements 2.5**

  - [ ] 6.6 Write unit tests for Text Chunker
    - Test token counting accuracy against known strings
    - Test each chunking strategy with sample documents
    - Test source reference preservation
    - _Requirements: 2.3, 2.4, 2.5_

- [ ] 7. Implement Configuration Manager
  - [x] 7.1 Create YAML configuration parser
    - Implement `ConfigurationManager` class with `load_configuration()` method
    - Parse YAML config: folder paths (absolute/relative), file filters (glob patterns), exclusion patterns
    - Support chunking strategy selection (fixed_size, sentence_aware, paragraph_aware)
    - Support model architecture selection (Qwen2.5-3B, Qwen2.5-7B, Qwen2.5-14B)
    - _Requirements: 7.1, 7.3_

  - [x] 7.2 Add hyperparameter validation with clear errors
    - Validate training hyperparameters with ranges: learning_rate (1e-6 to 1e-3), batch_size (1 to 16), epochs (1 to 10), gradient_accumulation_steps (1 to 16)
    - Set sensible defaults for missing configuration values
    - Return clear validation errors listing each invalid parameter and expected format
    - _Requirements: 7.2, 7.4_

  - [x] 7.3 Write property test for configuration validation
    - **Property 4: Configuration Validation Correctness**
    - For any hyperparameter value, verify validator accepts values in valid ranges and rejects values outside with clear error
    - **Validates: Requirements 7.2, 7.4**

  - [x] 7.4 Write unit tests for Configuration Manager
    - Test YAML parsing with valid and malformed configs
    - Test hyperparameter boundary values
    - Test error message clarity for invalid configurations
    - _Requirements: 7.1, 7.4_

- [ ] 8. Checkpoint - Verify configuration and chunking
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Training Pipeline
  - [x] 9.1 Create TrainingPipeline class with dependency management
    - Implement automatic dependency installation via pip (datasets, transformers, accelerate, trl, langchain-text-splitters)
    - Handle version constraints for compatibility
    - Set up training environment detection (Colab vs local)
    - _Requirements: 3.1, 10.2_

  - [x] 9.2 Implement data preparation and splitting
    - Prepare 80/20 training/validation split with deterministic seed (42)
    - Create dataset objects compatible with Hugging Face transformers
    - Implement efficient batched data loading
    - _Requirements: 3.2_

  - [ ] 9.3 Configure Qwen 2.5-3B model fine-tuning
    - Load Qwen 2.5-3B-Instruct model from Hugging Face
    - Set hyperparameters: 3 epochs, batch_size=2, learning_rate=2e-5, gradient_accumulation_steps=4, bf16=True, max_length=1024
    - Configure precision: bf16 for GPU, fp32 for CPU
    - _Requirements: 3.3_

  - [ ] 9.4 Add training monitoring and checkpointing
    - Monitor loss and accuracy metrics every epoch
    - Save checkpoints after each epoch (model weights, optimizer state, metadata)
    - Implement OOM recovery: reduce batch size by 50%, restart from last checkpoint
    - Define success: final validation loss < 1.5 AND convergence (loss delta positive AND < 0.01 between last two epochs)
    - _Requirements: 3.4, 3.5, 3.6_

  - [ ] 9.5 Write property test for deterministic split
    - **Property 5: Deterministic Training Split**
    - For any dataset with seed 42, verify identical splits across multiple invocations with 80/20 ratio
    - **Validates: Requirements 3.2**

  - [ ] 9.6 Write integration tests for Training Pipeline
    - Test data splitting determinism
    - Test checkpoint saving and loading
    - Test OOM recovery logic with mocked memory errors
    - _Requirements: 3.2, 3.4, 3.5_

- [ ] 10. Implement Model Exporter component
  - [ ] 10.1 Create ModelExporter with local storage
    - Implement `export_model()` saving to configured local output directory
    - Precondition check: training completed successfully AND files > 0 AND tokens > 0
    - Create `model_metadata.json` with file count, total tokens, folder list, hyperparameters, performance metrics
    - _Requirements: 4.1, 4.2_

  - [ ] 10.2 Add versioned archive creation and serialization
    - Create versioned zip archives: `personal_agent_v{major}.{minor}.{patch}_{YYYY-MM-DDTHH-MM-SS}.zip`
    - Serialize model using pickle protocol version 4+ (Python 3.8+ compatible)
    - _Requirements: 4.4, 4.5_

  - [ ] 10.3 Implement Google Drive upload
    - Implement OAuth2 authentication via credentials.json or interactive browser auth
    - Upload model and metadata to configured Google Drive folder with user confirmation
    - Handle upload even if local save fails
    - _Requirements: 4.3, 6.1, 10.1_

  - [ ]* 10.4 Write property test for archive naming
    - **Property 6: Model Archive Naming Format**
    - For any valid version and timestamp, verify archive name matches `personal_agent_v{major}.{minor}.{patch}_{YYYY-MM-DDTHH-MM-SS}.zip`
    - **Validates: Requirements 4.4**

  - [ ]* 10.5 Write unit tests for Model Exporter
    - Test local model saving and metadata generation
    - Test Google Drive upload with mocked API
    - Test versioned archive creation
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 11. Checkpoint - Verify training and export components
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement Inference Engine component
  - [ ] 12.1 Create InferenceEngine with model loading
    - Implement `__init__()` loading trained model from pickle file
    - Add checksum validation during model deserialization
    - Verify model integrity before use
    - _Requirements: 5.1_

  - [ ] 12.2 Implement query processing and response generation
    - Add query validation: reject queries >2000 characters or with invalid syntax, return error and stop processing
    - Implement `generate_response()` with temperature=0.7, max_new_tokens=512
    - Add 30-second timeout for response generation
    - _Requirements: 5.2, 5.5_

  - [ ] 12.3 Add semantic search and context retrieval
    - Implement semantic search using sentence-transformers with cosine similarity
    - Retrieve top 3 most relevant text chunks for context
    - Support file location matching and organizational pattern queries
    - _Requirements: 5.3, 5.4_

  - [ ] 12.4 Implement inaccessible file handling
    - Notify user which files could not be accessed (permission denied, not found)
    - Continue processing with available files
    - _Requirements: 5.6_

  - [ ] 12.5 Write integration tests for Inference Engine
    - Test model loading and integrity verification
    - Test query validation and rejection
    - Test semantic search and context retrieval
    - Test inaccessible file notification
    - _Requirements: 5.1, 5.2, 5.4, 5.6_

- [ ] 13. Implement Progress Monitor component
  - [ ] 13.1 Create ProgressMonitor with real-time updates
    - Display current folder name, files processed per folder, total files processed
    - Update file processing display at least every 10 seconds
    - Display training metrics: loss (4 decimal places), steps completed, ETA (minutes)
    - Update training display every 30 seconds
    - _Requirements: 8.1, 8.2_

  - [ ] 13.2 Add diagnostic information and reporting
    - Trigger diagnostics when single file/folder processing exceeds 60 seconds
    - Show CPU usage %, memory usage MB, specific file path causing delay
    - Generate JSON summary report: total files, total tokens, training duration, final loss, errors list
    - Save reports to configured output directory
    - _Requirements: 8.3, 8.4, 8.5_

  - [ ] 13.3 Implement error classification system
    - Classify errors: critical (stops pipeline), warning (continue with logging), info (record only)
    - Handle each severity appropriately per classification rules
    - _Requirements: 9.5_

  - [ ] 13.4 Write unit tests for Progress Monitor
    - Test progress display formatting and update intervals
    - Test diagnostic triggering threshold
    - Test error classification logic
    - _Requirements: 8.1, 8.4, 9.5_

- [ ] 14. Checkpoint - Verify inference and monitoring components
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement Security and Privacy Features
  - [ ] 15.1 Add file permission checking
    - Check file read permissions before reading any file
    - Skip files where the current user lacks read permissions
    - Integrate permission checking into Folder Crawler flow
    - _Requirements: 6.3_

  - [ ] 15.2 Implement restricted resource handling
    - Detect attempts to access restricted system folders
    - Log warning with violation details to system log
    - Skip the restricted resource and continue processing
    - _Requirements: 6.2_

  - [ ] 15.3 Implement temporary file management
    - Store temporary files in system's standard temporary directory (`tempfile.gettempdir()`)
    - Delete temporary files when processing completes or is terminated
    - Register `atexit` handler for cleanup on unexpected termination
    - _Requirements: 6.4_

  - [ ] 15.4 Write unit tests for security features
    - Test permission checking logic
    - Test restricted resource detection and skip behavior
    - Test temp file cleanup on normal and abnormal termination
    - _Requirements: 6.2, 6.3, 6.4_

- [ ] 16. Implement Google Colab Integration
  - [ ] 16.1 Add Colab environment detection and optimization
    - Detect Colab via COLAB_GPU or IN_COLAB environment variables
    - Automatically select available GPU in Colab
    - Configure memory-efficient data loading
    - Allow GPU optimizations outside Colab as well
    - _Requirements: 10.2, 10.5_

  - [ ] 16.2 Implement Google Drive mounting and authentication
    - Add Google Drive mounting with OAuth2 (credentials.json or interactive browser auth)
    - Handle credential management and storage
    - Provide ready-to-run Colab notebook templates with pre-configured cells
    - _Requirements: 10.1, 10.3_

  - [ ] 16.3 Add session timeout recovery
    - Save intermediate progress to Google Drive every 30 minutes (configurable)
    - Implement retry logic and local caching for failed saves
    - Support resume from Google Drive checkpoints after session disconnect
    - _Requirements: 10.4_

  - [ ] 16.4 Write integration tests for Colab features
    - Test Colab environment detection with mocked env vars
    - Test Google Drive integration with mocked API
    - Test session recovery functionality
    - _Requirements: 10.2, 10.4_

- [ ] 17. Checkpoint - Verify security and Colab integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Implement Error Handling and Recovery System
  - [ ] 18.1 Create error handler with retry logic
    - Implement automatic retry for transient failures (network timeouts, temporary file locks)
    - Configure max 3 retries spaced 5 seconds apart
    - Distinguish transient vs permanent failures
    - _Requirements: 9.4_

  - [ ] 18.2 Implement training recovery from checkpoints
    - Resume from last checkpoint (model weights + optimizer state + metadata)
    - When no checkpoint exists, restart training from beginning
    - Handle interruptions: power loss, system crash, manual termination
    - _Requirements: 9.2_

  - [ ] 18.3 Add actionable error messages
    - Include specific Python exception type and details
    - Include affected file paths
    - Provide step-by-step recovery instructions for common failure scenarios
    - _Requirements: 9.3_

  - [ ] 18.4 Implement file processing error recovery
    - Skip corrupted/locked/encoding-error files and continue
    - Log error with file path and specific failure reason
    - Continue processing other files in the same directory
    - _Requirements: 9.1_

  - [ ] 18.5 Write error handling tests
    - Test retry logic with simulated transient failures
    - Test training recovery from checkpoints
    - Test error message content and actionability
    - _Requirements: 9.1, 9.2, 9.4_

- [ ] 19. Final integration and wiring
  - [ ] 19.1 Create main pipeline orchestrator
    - Implement `PersonalFolderAgent` class orchestrating all components
    - Wire components in order: Config → Crawler → TextProcessor → Chunker → Training → Export
    - Propagate configuration to all components
    - Connect Progress Monitor to all stages
    - _Requirements: 3.6, 7.1_

  - [ ] 19.2 Implement command-line interface
    - Create CLI with commands: `crawl`, `train`, `query`, `export`
    - Add argument parsing with help documentation
    - Support configuration file path as argument
    - _Requirements: 7.1, 8.5_

  - [ ] 19.3 Add optional web interface (FastAPI)
    - Implement REST API endpoints for querying the trained model
    - Add progress monitoring endpoint
    - Include OpenAPI/Swagger documentation
    - _Requirements: 5.2, 8.5_

  - [ ] 19.4 Write end-to-end tests
    - Test complete pipeline with synthetic test data (small folder set, 1 epoch)
    - Test CLI commands with various configurations
    - Test error recovery across the full pipeline
    - _Requirements: 9.1, 9.2_

- [ ] 20. Final checkpoint - Complete system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout development
- Property tests validate universal correctness properties from the design document
- Unit/integration tests validate specific examples and edge cases
- Security is simplified: permission checking, restricted resource warnings, standard temp file cleanup
- Configuration requires no authentication — just YAML parsing, validation, and clear errors

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.4"] },
    { "id": 1, "tasks": ["3.1", "4.1", "7.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.2", "4.3", "6.1", "7.2"] },
    { "id": 3, "tasks": ["3.4", "4.4", "4.5", "6.2", "6.3", "7.3", "7.4"] },
    { "id": 4, "tasks": ["6.4", "6.5", "6.6", "9.1", "9.2"] },
    { "id": 5, "tasks": ["9.3", "9.4", "10.1"] },
    { "id": 6, "tasks": ["9.5", "9.6", "10.2", "10.3"] },
    { "id": 7, "tasks": ["10.4", "10.5", "12.1", "12.2"] },
    { "id": 8, "tasks": ["12.3", "12.4", "13.1", "13.2", "13.3"] },
    { "id": 9, "tasks": ["12.5", "13.4", "15.1", "15.2", "15.3"] },
    { "id": 10, "tasks": ["15.4", "16.1", "16.2", "16.3"] },
    { "id": 11, "tasks": ["16.4", "18.1", "18.2", "18.3", "18.4"] },
    { "id": 12, "tasks": ["18.5", "19.1"] },
    { "id": 13, "tasks": ["19.2", "19.3"] },
    { "id": 14, "tasks": ["19.4"] }
  ]
}
```
