# Requirements Document

## Introduction

This system enables users to create a personalized AI agent trained specifically on their personal folder structure and content. The agent learns from the user's files, understands their organizational patterns, and can assist with file management, content understanding, and task execution based on the trained knowledge.

## Glossary

- **Personal_Agent**: The AI model fine-tuned on a user's personal folder structure and content
- **Folder_Crawler**: A component that traverses specified directory paths and reads files
- **Text_Chunker**: A component that splits large text files into manageable chunks for training
- **Qwen_2.5-3B**: The base AI model to be fine-tuned (Qwen 2.5 3B parameters)
- **Training_Pipeline**: The end-to-end process from data collection to model training
- **Model_Exporter**: Component that saves trained models to persistent storage
- **Inference_Engine**: Component that runs the trained model for user queries

## Requirements

### Requirement 1: Folder Structure Analysis

**User Story:** As a user, I want the system to analyze my personal folder structure, so that my AI agent understands how my files are organized.

#### Acceptance Criteria

1. WHEN a folder path is provided via configuration, THE Folder_Crawler SHALL recursively traverse all subdirectories up to a maximum depth of 10 levels.
2. THE Folder_Crawler SHALL process files from all specified folders (minimum 36 folders) that exist on the system, including paths such as "C:\Final S24", "C:\tmp", and "C:\Go4Garage Products".
3. WHILE traversing folders, THE Folder_Crawler SHALL maintain metadata including file path, file extension, file size in bytes, last modification date (ISO 8601 format), and a SHA-256 hash of file content.
4. IF a file cannot be read due to insufficient permissions, THE Folder_Crawler SHALL log the error with file path and error type to the error log and continue processing other files in the same folder.

### Requirement 2: File Content Processing

**User Story:** As a user, I want my files to be processed into training data, so that the AI can learn from my content.

#### Acceptance Criteria

1. WHEN text files are encountered (file extensions .txt, .md, .csv, .json, .xml), THE Text_Processor SHALL extract text content and clean it by removing extra whitespace, normalizing line endings to LF, and stripping Unicode control characters (U+0000 to U+001F, excluding U+0009, U+000A, U+000D).
2. WHERE multiple file formats exist (.pdf, .docx, .xlsx, .pptx), THE Text_Processor SHALL use appropriate libraries for each format (pdfplumber for PDF, python-docx for DOCX, openpyxl for XLSX, python-pptx for PPTX) to extract readable text content.
3. THE Text_Chunker SHALL split documents larger than 100 KB into chunks of 512-1024 tokens (estimated using tiktoken library with cl100k_base tokenizer), preserving sentence boundaries where possible.
4. THE Text_Chunker SHALL count tokens for each chunk using the Qwen 2.5-3B tokenizer and reject chunks exceeding 1024 tokens for splitting.
5. WHEN processing files, THE System SHALL maintain source file references for each text chunk in JSON format including file path, chunk index, byte offset, and token count.
6. IF a file format is unsupported or no appropriate library is available, THE Text_Processor SHALL attempt basic text extraction (treating the file as plain text) as a fallback BEFORE logging a warning with file extension to the error log and skipping the file.

### Requirement 3: Model Training Pipeline

**User Story:** As a developer, I want to fine-tune a Qwen 2.5-3B model on my personal data, so that I have a customized AI agent.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL install required dependencies (datasets, transformers, accelerate, trl, langchain-text-splitters) via pip with version constraints to ensure compatibility.
2. WHEN the data collection phase completes, THE Training_Pipeline SHALL prepare an 80/20 training/validation split using a deterministic random seed (42) to ensure reproducibility.
3. THE Training_Pipeline SHALL fine-tune the Qwen 2.5-3B model using the collected text chunks with hyperparameters: 3 epochs, per_device_train_batch_size=2, learning_rate=2e-5, gradient_accumulation_steps=4, bf16=True, max_length=1024.
4. WHILE training, THE System SHALL monitor loss and accuracy metrics every epoch and save checkpoints to disk after each epoch completion.
5. IF training fails due to out-of-memory errors, THE Training_Pipeline SHALL reduce batch size by 50% and restart training from the last successful checkpoint, BUT SHALL prevent restarting until the batch size reduction has been applied.
6. THE Training_Pipeline SHALL be considered successful WHEN the final validation loss is below 1.5 AND the model converges (loss reduction is positive AND less than 0.01 between last two epochs).

### Requirement 4: Model Persistence and Export

**User Story:** As a user, I want my trained model to be saved permanently, so that I can reuse it without retraining.

#### Acceptance Criteria

1. WHEN training completes successfully AND training data was processed (files > 0 AND tokens > 0), THE Model_Exporter SHALL save the trained model to the local file system at the configured output directory path.
2. THE Model_Exporter SHALL include metadata about training data (file count, total tokens, folder list), hyperparameters (epochs, learning_rate, batch_size), and performance metrics (final_loss, training_duration_seconds) in a JSON file named model_metadata.json.
3. WHERE Google Drive credentials are configured AND a connection to Google Drive can be established, THE Model_Exporter SHALL upload the trained model and metadata to the specified Google Drive folder with user confirmation, EVEN IF local saving fails.
4. THE Model_Exporter SHALL create a versioned model archive named personal_agent_v{major}.{minor}.{patch}_{timestamp}.zip where timestamp follows ISO 8601 format (YYYY-MM-DDTHH-MM-SS).
5. THE Model_Exporter SHALL serialize the model using pickle protocol version 4 or higher to ensure the model can be loaded in future Python sessions (Python 3.8+).

### Requirement 5: Agent Inference Interface

**User Story:** As a user, I want to interact with my trained agent, so that it can assist me with my files and content.

#### Acceptance Criteria

1. THE Inference_Engine SHALL load the trained model from persistent storage by deserializing the pickle file and verifying model integrity via checksum validation.
2. WHEN a user query is received via a text input field or API endpoint, THE Inference_Engine SHALL generate a response within 30 seconds using the model's generate() method with temperature=0.7 and max_new_tokens=512.
3. THE Inference_Engine SHALL support questions about file locations by matching query keywords against file metadata, content understanding by searching for relevant text chunks, and organizational patterns by analyzing folder structure statistics.
4. IF a query references specific files by name or path, THE Inference_Engine SHALL retrieve the top 3 most relevant text chunks from those files using cosine similarity with sentence-transformers model and include them as context in the response.
5. WHEN a user query contains invalid syntax or exceeds 2000 characters, THE Inference_Engine SHALL return an error message explaining the issue and suggesting corrections, AND SHALL stop all processing for that query immediately.
6. IF a referenced file is inaccessible (permission denied, file not found), THE Inference_Engine SHALL notify the user which file could not be accessed and continue processing with available files.

### Requirement 6: Security and Privacy

**User Story:** As a privacy-conscious user, I want my personal data to remain secure, so that my information is protected.

#### Acceptance Criteria

1. WHERE cloud storage (Google Drive) is used, THE System SHALL upload model files and metadata to the configured Google Drive folder using the authenticated user's credentials.
2. IF a security permission violation is detected (e.g., attempt to access restricted system folders), THE System SHALL log a warning with the violation details to the system log and skip the restricted resource.
3. THE System SHALL check file read permissions before reading any file and skip files where the current user lacks read permissions.
4. THE System SHALL store temporary files in the system's standard temporary directory and delete them when processing completes or is terminated.

### Requirement 7: Configuration and Customization

**User Story:** As an advanced user, I want to customize the training parameters, so that I can optimize the agent for my specific needs.

#### Acceptance Criteria

1. THE Configuration_Manager SHALL allow specification of folder paths (absolute or relative), file filters (glob patterns like *.txt, *.md), and exclusion patterns (paths to skip) via a YAML configuration file.
2. WHERE hyperparameters need adjustment, THE Configuration_Manager SHALL expose training settings with validated ranges: learning_rate (1e-6 to 1e-3), batch_size (1 to 16), epochs (1 to 10), gradient_accumulation_steps (1 to 16).
3. THE Configuration_Manager SHALL support different chunking strategies (fixed_size, sentence_aware, paragraph_aware) and model architectures (Qwen2.5-3B, Qwen2.5-7B, Qwen2.5-14B) via configuration selection.
4. IF invalid configuration is provided (e.g., non-existent folder path, hyperparameter outside valid range), THE Configuration_Manager SHALL provide clear validation errors listing each invalid parameter and the expected format.

### Requirement 8: Progress Monitoring and Reporting

**User Story:** As a user, I want to see training progress, so that I know how the process is advancing.

#### Acceptance Criteria

1. WHILE processing folders, THE Progress_Monitor SHALL display current folder name being processed, number of files processed in that folder, and total files processed across all folders, updating the display at least once every 10 seconds.
2. DURING training, THE Progress_Monitor SHALL show loss value (to 4 decimal places), number of steps completed, and estimated time remaining (in minutes) in a dashboard updated every 30 seconds.
3. THE Progress_Monitor SHALL generate a summary report in JSON format containing total files processed, total tokens extracted, training duration, final validation loss, and a list of any errors encountered during processing.
4. IF processing takes more than 60 seconds to process a single file or folder, THE Progress_Monitor SHALL provide diagnostic information including CPU usage percentage, memory usage in MB, and the specific file path causing the delay.
5. THE Progress_Monitor SHALL save progress reports to disk at the configured output directory AND make them accessible via a web interface or file system.

### Requirement 9: Error Handling and Recovery

**User Story:** As a user, I want robust error handling, so that temporary issues don't break the entire process.

#### Acceptance Criteria

1. WHEN file reading fails due to corruption, unsupported encoding, or file lock, THE Error_Handler SHALL skip the problematic file, log the error with file path and specific failure reason, and continue processing other files in the same directory.
2. IF training is interrupted due to power loss, system crash, or manual termination, THE System SHALL support resuming from the last checkpoint which includes model weights, optimizer state, and training metadata, BUT WHEN no checkpoint exists (like on the very first training run), THE System SHALL restart training from the beginning.
3. THE Error_Handler SHALL provide actionable error messages with resolution suggestions, including specific Python exception details, affected file paths, and step-by-step recovery instructions for common failure scenarios.
4. WHERE possible, THE System SHALL implement automatic retry logic for transient failures (network timeouts, temporary file locks) with a maximum of 3 retries spaced 5 seconds apart before declaring a permanent failure.
5. THE System SHALL classify errors into severity levels (critical, warning, info) and handle them appropriately: critical errors stop processing, warnings continue with logging, info messages are recorded but processing continues.

### Requirement 10: Integration with Existing Tools

**User Story:** As a Colab user, I want seamless integration with Google Drive and Colab notebooks, so that I can use my existing workflow.

#### Acceptance Criteria

1. THE System SHALL support mounting Google Drive for data access and model storage using OAuth2 authentication via a user-provided credentials.json file or interactive browser authentication.
2. WHERE the Google Colab environment is detected (presence of COLAB_GPU or IN_COLAB environment variables), THE System SHALL optimize for Colab's GPU resources by automatically selecting the available GPU and configuring memory-efficient data loading, BUT SHALL also allow GPU optimizations outside Colab environments.
3. THE System SHALL provide ready-to-run Colab notebook templates with pre-configured code cells for folder path specification, dependency installation, and model training execution.
4. IF the Colab session times out or disconnects, THE System SHALL save intermediate progress (processed file list, extracted chunks, training checkpoints) to Google Drive at the configured save interval (default: every 30 minutes), AND SHALL implement retry logic and local caching for failed saves.
5. THE System SHALL detect Colab environment optimizations when the COLAB_GPU environment variable exists and training completes within 50% of the estimated time using GPU acceleration compared to CPU-only execution.
