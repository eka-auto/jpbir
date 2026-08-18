# Personal Folder Trained Agent

A personalized AI agent fine-tuned on your personal folder structure and content. The system crawls user-specified directories, extracts text from multiple file formats, processes content into training chunks, fine-tunes a Qwen 2.5-3B model, and provides an inference interface for querying the trained agent.

## Features

- Recursive folder crawling with metadata collection
- Multi-format text extraction (PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JSON, XML)
- Token-aware text chunking (512-1024 tokens)
- Fine-tuning pipeline for Qwen 2.5-3B model
- Semantic search and inference engine
- Google Colab and Google Drive integration
- AES-256-GCM encryption for cloud storage
- YAML-based configuration

## Requirements

- Python 3.8 or higher
- 8 GB RAM minimum (16 GB+ recommended for training)
- 10 GB+ free disk space
- NVIDIA GPU with 8 GB+ VRAM (optional, recommended for training)

## Setup

### 1. Create a Virtual Environment

**Windows (PowerShell):**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**

```cmd
python -m venv venv
venv\Scripts\activate.bat
```

**Linux / macOS:**

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

Install all required packages:

```bash
pip install -r requirements.txt
```

Or install with optional web interface support:

```bash
pip install -e ".[web]"
```

Or install with development/testing dependencies:

```bash
pip install -e ".[dev]"
```

Or install everything:

```bash
pip install -e ".[web,dev]"
```

### 3. Verify Installation

```bash
python -c "import personal_folder_agent; print('Installation successful')"
```

### 4. Run Tests

```bash
pytest
```

## Usage

### Command-Line Interface

```bash
# Crawl folders
personal-folder-agent crawl --config config.yaml

# Train model
personal-folder-agent train --config config.yaml

# Query the trained agent
personal-folder-agent query "Where are my project files?"

# Export model
personal-folder-agent export --output ./model_output
```

### Configuration

Create a `config.yaml` file to specify your folder paths and training parameters. See `configs/` directory for examples.

## Project Structure

```
personal_folder_agent/
├── __init__.py
├── cli.py                    # Command-line interface
├── components/
│   ├── __init__.py
│   ├── folder_crawler.py     # Directory traversal
│   ├── text_processor.py     # File content extraction
│   ├── text_chunker.py       # Token-aware chunking
│   ├── training_pipeline.py  # Model fine-tuning
│   ├── model_exporter.py     # Model persistence
│   ├── inference_engine.py   # Query processing
│   ├── config_manager.py     # Configuration handling
│   └── progress_monitor.py   # Progress tracking
├── utils/
│   ├── __init__.py
│   ├── security.py           # Encryption and permissions
│   └── errors.py             # Error handling
├── tests/
│   ├── __init__.py
│   └── ...
└── configs/
    └── example_config.yaml
```

## Google Colab

For training in Google Colab, use the provided notebook templates in the `notebooks/` directory. The system automatically detects the Colab environment and optimizes GPU usage.

## License

MIT
