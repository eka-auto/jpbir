# Chrome Data Extraction

Extracts browser data from Chrome profiles and uploads to Hugging Face Datasets.

## Quick Start

```bash
# Run extraction
python chrome_extraction/extract_simple.py

# View extracted data in browser
python chrome_extraction/browse_data.py
# Then open: http://localhost:8000/viewer.html
```

## What Gets Extracted

- **History** - Visited URLs, titles, timestamps
- **Local Storage** - Website persistent storage (key-value pairs)
- **Session Storage** - Temporary session data
- **IndexedDB** - Structured database records

## Output

- SQLite databases in `chrome_extraction/output/`
- Uploaded to Hugging Face: https://huggingface.co/datasets/go4garage/chrome-browser-data
- Interactive web viewer at http://localhost:8000/viewer.html

## Files

- `extract_simple.py` - Main extraction script
- `browse_data.py` - HTTP server for viewing data
- `viewer.html` - Interactive web UI
- `show_summary.py` - Quick text summary
- `EXTRACTION_SUMMARY.md` - Detailed documentation

## Requirements

- Python 3.10+
- ccl_chromium_reader (installed from submodule)
- huggingface_hub
- HF authentication token (cached or via HF_TOKEN env var)

## Example Output

```
============================================================
EXTRACTED CHROME DATA SUMMARY
============================================================

chrome_data_local_default:
  History: 0 records
  Local Storage: 214 records

chrome_data_local_profile_1:
  History: 19,977 records
  Local Storage: 0 records
  Date range: 2026-06-15 to 2026-06-18

chrome_data_local_profile_2:
  History: 545 records
  Local Storage: 0 records
  Date range: 2026-05-24 to 2026-06-23

============================================================
TOTAL: 20,522 history + 214 storage = 20,736 records
============================================================
```

## Database Schema

Each SQLite database contains:
- `history` - Browser history (url, title, visit_time, source_device)
- `local_storage` - LocalStorage entries (origin, key, value, source_device)
- `session_storage` - SessionStorage entries (host, key, value, source_device)
- `indexeddb` - IndexedDB records (database_name, origin, object_store, user_key, value_json)
- `extraction_metadata` - Extraction run info

## Hugging Face Integration

Datasets uploaded to:
- **Repo**: https://huggingface.co/datasets/go4garage/chrome-browser-data
- **Structure**: One folder per device/profile
- **Format**: SQLite database files
