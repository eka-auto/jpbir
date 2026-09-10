#!/usr/bin/env python3
"""
Simple Chrome Data Extraction Script
Extracts browser data from Chrome profiles and stores in SQLite databases.
Uploads results to Hugging Face Datasets.
"""

import sqlite3
import json
import pathlib
import sys
import os
from datetime import datetime

# Add ccl_chromium_reader to path
sys.path.insert(0, str(pathlib.Path(__file__).parent / 'ccl_chromium_reader'))

try:
    import ccl_chromium_reader
    print("[+] ccl_chromium_reader loaded")
except ImportError as e:
    print(f"[!] Failed to import ccl_chromium_reader: {e}")
    sys.exit(1)

try:
    from huggingface_hub import HfApi, upload_folder
    print("[+] huggingface_hub loaded")
except ImportError as e:
    print(f"[!] Failed to import huggingface_hub: {e}")
    sys.exit(1)

DATA_TYPES = ['history', 'local_storage', 'session_storage', 'indexeddb']

def get_hf_token():
    """Get HF token from environment or file."""
    token = os.environ.get('HF_TOKEN')
    if token:
        return token
    token_file = pathlib.Path.home() / '.cache' / 'huggingface' / 'token'
    if token_file.exists():
        return token_file.read_text().strip()
    return None


def create_database(output_path: pathlib.Path) -> sqlite3.Connection:
    """Create SQLite database with schema for Chrome data."""
    conn = sqlite3.connect(output_path)
    cursor = conn.cursor()
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT, title TEXT, visit_time TEXT, source_device TEXT, extracted_at TEXT)''')
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS local_storage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT, key TEXT, value TEXT, source_device TEXT, extracted_at TEXT)''')
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS session_storage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host TEXT, key TEXT, value TEXT, source_device TEXT, extracted_at TEXT)''')
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS indexeddb (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_name TEXT, origin TEXT, object_store TEXT,
        user_key TEXT, value_json TEXT, source_device TEXT, extracted_at TEXT)''')
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS extraction_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_path TEXT, source_device TEXT, extraction_start TEXT,
        extraction_end TEXT, data_types_extracted TEXT, total_records INTEGER)''')
    
    conn.commit()
    return conn


def extract_all_data(profile, conn, source_device, extracted_at):
    """Extract all available data from profile."""
    cursor = conn.cursor()
    totals = {'history': 0, 'local_storage': 0, 'session_storage': 0, 'indexeddb': 0}
    
    # Extract History
    try:
        if (profile.path / 'History').exists():
            for rec in profile.iterate_history_records():
                cursor.execute(
                    'INSERT INTO history (url, title, visit_time, source_device, extracted_at) VALUES (?, ?, ?, ?, ?)',
                    (rec.url, rec.title, rec.visit_time.isoformat() if rec.visit_time else None,
                     source_device, extracted_at))
                totals['history'] += 1
            conn.commit()
            print(f"  - History: {totals['history']} records")
        else:
            print(f"  - History: (no DB)")
    except Exception as e:
        print(f"  - History: Error - {e}")
    
    # Extract Local Storage
    try:
        if (profile.path / 'Local Storage' / 'leveldb').exists():
            for host in profile.iter_local_storage_hosts():
                for rec in profile.iter_local_storage(storage_key=host):
                    cursor.execute(
                        'INSERT INTO local_storage (origin, key, value, source_device, extracted_at) VALUES (?, ?, ?, ?, ?)',
                        (host, rec.script_key, rec.value, source_device, extracted_at))
                    totals['local_storage'] += 1
            conn.commit()
            print(f"  - Local Storage: {totals['local_storage']} records")
        else:
            print(f"  - Local Storage: (no data)")
    except Exception as e:
        print(f"  - Local Storage: Error - {e}")
    
    # Extract Session Storage
    try:
        if (profile.path / 'Session Storage').exists():
            for host in profile.iter_session_storage_hosts():
                try:
                    for rec in profile.iter_session_storage(host=host):
                        cursor.execute(
                            'INSERT INTO session_storage (host, key, value, source_device, extracted_at) VALUES (?, ?, ?, ?, ?)',
                            (host, rec.key, rec.value, source_device, extracted_at))
                        totals['session_storage'] += 1
                except:
                    continue
            conn.commit()
            print(f"  - Session Storage: {totals['session_storage']} records")
        else:
            print(f"  - Session Storage: (no data)")
    except Exception as e:
        print(f"  - Session Storage: Error - {e}")
    
    # Extract IndexedDB
    try:
        if (profile.path / 'IndexedDB').exists():
            for host in profile.iter_indexeddb_hosts():
                try:
                    wrapped_idb = profile.get_indexeddb(host)
                    for db_meta in wrapped_idb.database_ids:
                        try:
                            db = wrapped_idb[db_meta.name, db_meta.origin]
                            for store_name in db.object_store_names:
                                try:
                                    store = db[store_name]
                                    for rec in store.iterate_records(errors_to_stdout=True):
                                        cursor.execute(
                                            'INSERT INTO indexeddb (database_name, origin, object_store, user_key, value_json, source_device, extracted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                            (db_meta.name, db_meta.origin, store_name,
                                             str(rec.user_key), json.dumps(rec.value, default=str),
                                             source_device, extracted_at))
                                        totals['indexeddb'] += 1
                                except:
                                    continue
                        except:
                            continue
                except:
                    continue
            conn.commit()
            print(f"  - IndexedDB: {totals['indexeddb']} records")
        else:
            print(f"  - IndexedDB: (no data)")
    except Exception as e:
        print(f"  - IndexedDB: Error - {e}")
    
    return sum(totals.values())


def upload_to_huggingface(db_path, repo_id, source_device, token):
    """Upload database to Hugging Face."""
    if not token:
        print(f"  [!] No token - skipping upload")
        return False
    
    try:
        api = HfApi(token=token)
        user = api.whoami(token=token)
        username = user.get('name', 'jaytipargal')
        
        repo_id = f"{username}/{repo_id}"
        
        api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True, token=token)
        
        upload_folder(
            folder_path=str(db_path.parent),
            repo_id=repo_id, repo_type="dataset",
            path_in_repo=source_device, token=token
        )
        
        print(f"  [+] Uploaded to {repo_id}/{source_device}")
        return True
    except Exception as e:
        print(f"  [!] Upload failed: {e}")
        return False


def extract_profile(profile_path, output_dir, device_name, repo_id, token):
    """Extract data from a single Chrome profile."""
    print(f"\n{'='*50}")
    print(f"Device: {device_name}")
    print(f"Profile: {profile_path}")
    print(f"{'='*50}")
    
    extracted_at = datetime.now().isoformat()
    db_path = output_dir / f"chrome_data_{device_name}.db"
    
    conn = create_database(db_path)
    
    try:
        with ccl_chromium_reader.ChromiumProfileFolder(profile_path, missing_data_ok=True) as profile:
            print("Extracting:")
            total = extract_all_data(profile, conn, device_name, extracted_at)
            
            # Save metadata
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO extraction_metadata (profile_path, source_device, extraction_start, extraction_end, data_types_extracted, total_records) VALUES (?, ?, ?, ?, ?, ?)',
                (str(profile_path), device_name, extracted_at, datetime.now().isoformat(),
                 json.dumps(DATA_TYPES), total))
            conn.commit()
            
            print(f"\n[+] Total: {total} records")
            
    except Exception as e:
        print(f"[!] Extraction failed: {e}")
        conn.close()
        return False
    
    conn.close()
    return upload_to_huggingface(db_path, repo_id, device_name, token)


def main():
    print("="*50)
    print("CHROME DATA EXTRACTION")
    print("="*50)
    
    output_dir = pathlib.Path(__file__).parent / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    token = get_hf_token()
    if token:
        print("[+] HF token loaded")
    else:
        print("[!] No HF token found")
    
    # Find Chrome profiles
    chrome_path = pathlib.Path(r"C:\Users\abcom\AppData\Local\Google\Chrome\User Data")
    profiles = []
    
    if chrome_path.exists():
        print(f"\nChrome path: {chrome_path}")
        for profile_dir in ["Default", "Profile 1", "Profile 2"]:
            path = chrome_path / profile_dir
            if path.exists():
                profiles.append((path, f"local_{profile_dir.lower().replace(' ', '_')}"))
                print(f"  [+] Found {profile_dir}")
    
    if not profiles:
        print("[!] No Chrome profiles found!")
        return False
    
    print(f"\nExtracting from {len(profiles)} profiles...")
    
    results = {}
    for profile_path, device_name in profiles:
        results[device_name] = extract_profile(
            profile_path, output_dir, device_name,
            "chrome-browser-data", token
        )
    
    # Summary
    print(f"\n{'='*50}")
    print("SUMMARY")
    print(f"{'='*50}")
    for device, success in results.items():
        print(f"{'[+]' if success else '[!]'} {device}")
    
    print(f"\nOutput: {output_dir}")
    for db in output_dir.glob("*.db"):
        print(f"  - {db.name} ({db.stat().st_size / 1024 / 1024:.2f} MB)")
    
    if token:
        print(f"\nDatasets: https://huggingface.co/datasets/jaytipargal/chrome-browser-data")
    
    return all(results.values())


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
