#!/usr/bin/env python3
"""
Simple Robust Firestore DB Fix Script
Replaces all stale DB references with canonical 'eka-agent'.
"""
import os
import re
from pathlib import Path
from datetime import datetime

TREES = {
    "eka-agent": r"C:\Users\abcom\github-repos\eka-agent",
    "eka-agent-clean": r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    "eka-agent-main": r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    "Eka Runner": r"C:\Users\abcom\Go4Garage\Eka Runner",
}

CANONICAL_DB = "eka-agent"
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]

def fix_content(content: str) -> tuple[str, int]:
    """Replace all stale DB references. Returns (new_content, change_count)."""
    original = content
    changes = 0
    
    # Simple string replacement for all variants
    for stale in STALE_DBS:
        # Case-insensitive replacements
        # Python strings
        content = content.replace(f"'{stale}'", f"'{CANONICAL_DB}'")
        content = content.replace(f'"{stale}"', f'"{CANONICAL_DB}"')
        changes += 1
    
    # Count actual replacements by comparing
    if content != original:
        # Rough count
        changes = len(original) - len(content)
    
    return content, 1 if content != original else 0

# Skip patterns
SKIP_PATHS = [
    r"node_modules", r"\.git", r"android[/\\]app[/\\]build",
    r"stale_db_audit", r"COMPLETE_FILE_LIST", r"fix_report",
    r"STALE_DB_FIX", r"all_6581_files", r"generate_",
    r"inventory_", r"audit_", r"_verify", r"__pycache__",
]

SKIP_FILES = [
    "monitor_jarvis.ps1",  # GitHub repo, not DB
    "factory_reset_s24_ultra_all_databases.py",  # Guarded
    "execute_armed_wipe_queue.py",  # Needs guard
    "execute_real_device_hardware_wipe.py",
    "execute_real_device_hardware_wipe_fast.py",
    "execute_pure_engineering_factory_reset.py",
]

def should_skip(file_path: Path) -> bool:
    path_str = str(file_path).lower()
    name = file_path.name.lower()
    
    for pattern in SKIP_PATHS:
        if re.search(pattern, path_str, re.IGNORECASE):
            return True
    
    if name in [f.lower() for f in SKIP_FILES]:
        return True
    
    # Skip tests
    if 'test' in name or '\\test\\' in path_str or '/test/' in path_str:
        return True
    
    return False

def main():
    print("=" * 80)
    print("SIMPLE FIRESTORE DB FIX")
    print(f"Canonical DB: {CANONICAL_DB}")
    print(f"Stale DBs: {', '.join(STALE_DBS)}")
    print("=" * 80)
    
    total_fixed = 0
    total_skipped = 0
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            print(f"[!] Not found: {tree_root}")
            continue
        
        tree_fixed = 0
        tree_skipped = 0
        
        print(f"\n>>> {tree_name}...")
        
        # Process all text files
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.yml', '*.toml', '*.md', '*.txt', '*.sh', '*.bat']:
            for file_path in root.rglob(ext):
                if should_skip(file_path):
                    tree_skipped += 1
                    continue
                
                try:
                    content = file_path.read_text(encoding='utf-8', errors='ignore')
                    new_content, changed = fix_content(content)
                    
                    if changed:
                        file_path.write_text(new_content, encoding='utf-8')
                        tree_fixed += 1
                except Exception as e:
                    pass
        
        print(f"  Fixed: {tree_fixed}, Skipped: {tree_skipped}")
        total_fixed += tree_fixed
        total_skipped += tree_skipped
    
    print("\n" + "=" * 80)
    print(f"TOTAL: Fixed={total_fixed:,}, Skipped={total_skipped:,}")
    print("=" * 80)

if __name__ == "__main__":
    main()
