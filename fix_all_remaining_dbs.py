#!/usr/bin/env python3
"""
Comprehensive Firestore DB Fix Script - Phase 2
Fixes ALL remaining stale DB references across 6,581 files.

Canonical:
- Project: intrepid-stage-495117-q1
- Database: eka-agent
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

CANONICAL_PROJECT = "intrepid-stage-495117-q1"
CANONICAL_DB = "eka-agent"

# Stale DBs to replace
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]
STALE_DBS_PATTERN = '|'.join(re.escape(db) for db in STALE_DBS)

# Comprehensive patterns
PATTERNS = [
    # Python string literals
    (re.compile(r"""database\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: m.group(0).replace(m.group().split('=')[1].strip().strip('"\''), CANONICAL_DB)),
    
    # Python database_id defaults
    (re.compile(r"""database_id\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: m.group(0).replace(m.group().split('=')[1].strip().strip('"\''), CANONICAL_DB)),
    
    # Python Firestore client
    (re.compile(r"""firestore\.Client\([^)]*database\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"][^)]*\)""", re.IGNORECASE),
     lambda m: re.sub(r"""database\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", f"database='{CANONICAL_DB}'", m.group(0), flags=re.IGNORECASE)),
    
    # Python env fallbacks
    (re.compile(r"""os\.environ\.get\(\s*['"]FIRESTORE_DB['"]\s*,\s*['"]""" + STALE_DBS_PATTERN + """['"]\s*\)""", re.IGNORECASE),
     lambda m: f'os.environ.get("FIRESTORE_DB", "{CANONICAL_DB}")'),
    
    (re.compile(r"""os\.getenv\(\s*['"]FIRESTORE_DB['"]\s*,\s*['"]""" + STALE_DBS_PATTERN + """['"]\s*\)""", re.IGNORECASE),
     lambda m: f'os.getenv("FIRESTORE_DB", "{CANONICAL_DB}")'),
    
    # PowerShell variables
    (re.compile(r"""\$db\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'$db = "{CANONICAL_DB}"'),
    
    (re.compile(r"""\$database\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'$database = "{CANONICAL_DB}"'),
    
    (re.compile(r"""\$FirestoreDB\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'$FirestoreDB = "{CANONICAL_DB}"'),
    
    (re.compile(r"""\$databaseId\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'$databaseId = "{CANONICAL_DB}"'),
    
    # JavaScript/TypeScript
    (re.compile(r"""const\s+(?:db|database|DATABASE|DB)\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: re.sub(r"""['"]""" + STALE_DBS_PATTERN + """['"]""", f"'{CANONICAL_DB}'", m.group(0), flags=re.IGNORECASE)),
    
    (re.compile(r"""let\s+(?:db|database|DATABASE|DB)\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: re.sub(r"""['"]""" + STALE_DBS_PATTERN + """['"]""", f"'{CANONICAL_DB}'", m.group(0), flags=re.IGNORECASE)),
    
    # YAML
    (re.compile(r"""^(\s*database:\s*)""" + STALE_DBS_PATTERN + r"""\s*$""", re.IGNORECASE | re.MULTILINE),
     lambda m: f"{m.group(1)}{CANONICAL_DB}"),
    
    (re.compile(r"""^(\s*databaseId:\s*)""" + STALE_DBS_PATTERN + r"""\s*$""", re.IGNORECASE | re.MULTILINE),
     lambda m: f"{m.group(1)}{CANONICAL_DB}"),
    
    # JSON
    (re.compile(r"""["']database["']:\s*["']""" + STALE_DBS_PATTERN + """["']""", re.IGNORECASE),
     lambda m: f'"database": "{CANONICAL_DB}"'),
    
    (re.compile(r"""["']databaseId["']:\s*["']""" + STALE_DBS_PATTERN + """["']""", re.IGNORECASE),
     lambda m: f'"databaseId": "{CANONICAL_DB}"'),
    
    # TOML
    (re.compile(r"""database\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'database = "{CANONICAL_DB}"'),
    
    # Shell scripts
    (re.compile(r"""DATABASE\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'DATABASE="{CANONICAL_DB}"'),
    
    (re.compile(r"""DB_NAME\s*=\s*['"]""" + STALE_DBS_PATTERN + """['"]""", re.IGNORECASE),
     lambda m: f'DB_NAME="{CANONICAL_DB}"'),
    
    # Markdown/docs (code blocks and inline)
    (re.compile(r"""`(?:database|db)[:=]\s*""" + STALE_DBS_PATTERN + """`""", re.IGNORECASE),
     lambda m: re.sub(STALE_DBS_PATTERN, CANONICAL_DB, m.group(0), flags=re.IGNORECASE)),
    
    # Comments with DB references
    (re.compile(r"""#\s*(?:using|use|uses|target|targets|targeting|for|to)\s+(?:the\s+)?(?:Firestore\s+)?(?:database\s+)?""" + STALE_DBS_PATTERN, re.IGNORECASE),
     lambda m: re.sub(STALE_DBS_PATTERN, CANONICAL_DB, m.group(0), flags=re.IGNORECASE)),
]

# Skip paths
SKIP_PATHS = [
    "node_modules", ".git", "android/app/build", "build-intermediates",
    "stale_db_audit.py", "stale_db_audit_report.json",
    "COMPLETE_FILE_LIST.md", "all_6581_files_scanned.md", "stale_db_inventory.md",
    "fix_all_stale_dbs.py", "fix_all_remaining_dbs.py", "fix_report.md",
    "STALE_DB_FIX_COMPLETE.md", "all_files_scanned.py", "all_6581_files_scanned.md",
    "generate_", "inventory_", "audit_", "_verify_", "check_", "test_",
]

# Skip files
SKIP_FILES = [
    "monitor_jarvis.ps1",  # GitHub repo ref
    "factory_reset_s24_ultra_all_databases.py",  # Already guarded
    "execute_armed_wipe_queue.py",  # Needs manual guard
    "execute_real_device_hardware_wipe.py",
    "execute_real_device_hardware_wipe_fast.py",
    "execute_pure_engineering_factory_reset.py",
]

def should_skip(file_path: Path) -> tuple[bool, str]:
    path_str = str(file_path).lower()
    name = file_path.name.lower()
    
    for skip in SKIP_PATHS:
        if skip.lower() in path_str:
            return True, f"skip path: {skip}"
    
    # Skip test files
    if 'test_' in name or name.startswith('test_') or '\\test_' in path_str or '/test_' in path_str:
        return True, "skip test file"
    
    if name in [f.lower() for f in SKIP_FILES]:
        return True, f"skip file: {file_path.name}"
    
    return False, ""

def apply_patterns(content: str) -> tuple[str, list[str]]:
    changes = []
    for pattern, replacement in PATTERNS:
        matches = pattern.findall(content)
        if matches:
            content = pattern.sub(replacement, content)
            for match in matches[:5]:  # Limit per pattern
                if isinstance(match, tuple):
                    match = match[0]
                changes.append(f"Match: {match}")
    return content, changes

def fix_file(file_path: Path) -> tuple[int, list[str]]:
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return 0, [f"read error: {e}"]
    
    original = content
    content, changes = apply_patterns(content)
    
    if content != original and changes:
        try:
            file_path.write_text(content, encoding="utf-8")
            return len(changes), changes
        except Exception as e:
            return 0, [f"write error: {e}"]
    
    return 0, []

def main():
    print("=" * 80)
    print("COMPREHENSIVE FIRESTORE DB FIX - PHASE 2")
    print(f"Canonical project: {CANONICAL_PROJECT}")
    print(f"Canonical database: {CANONICAL_DB}")
    print("=" * 80)
    print()
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report = []
    report.append(f"# Comprehensive DB Fix Report - Phase 2")
    report.append(f"Generated: {timestamp}")
    report.append(f"Canonical DB: `{CANONICAL_DB}`")
    report.append("")
    
    total_fixed = 0
    total_skipped = 0
    total_errors = 0
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            continue
        
        tree_fixed = 0
        tree_skipped = 0
        tree_errors = 0
        tree_changes = []
        
        print(f"\n>>> Processing {tree_name}...")
        
        # All file extensions
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.yml', '*.toml', '*.md', '*.txt', '*.sh', '*.bat', '*.cmd']:
            for file_path in root.rglob(ext):
                skip, reason = should_skip(file_path)
                if skip:
                    tree_skipped += 1
                    continue
                
                count, changes = fix_file(file_path)
                if count > 0:
                    tree_fixed += 1
                    rel_path = str(file_path.relative_to(root))
                    tree_changes.append(f"  - `{rel_path}` ({count} changes)")
                elif changes:
                    tree_errors += 1
        
        print(f"  Fixed: {tree_fixed}, Skipped: {tree_skipped}, Errors: {tree_errors}")
        
        report.append(f"## {tree_name}")
        report.append(f"- Fixed: {tree_fixed}")
        report.append(f"- Skipped: {tree_skipped}")
        if tree_changes:
            report.append("**Changes:**")
            report.extend(tree_changes[:20])  # Limit
        report.append("")
        
        total_fixed += tree_fixed
        total_skipped += tree_skipped
        total_errors += tree_errors
    
    print("\n" + "=" * 80)
    print(f"TOTAL: Fixed={total_fixed}, Skipped={total_skipped}, Errors={total_errors}")
    print("=" * 80)
    
    report.append("---")
    report.append(f"**Total Fixed:** {total_fixed}")
    report.append(f"**Total Skipped:** {total_skipped}")
    report.append(f"**Total Errors:** {total_errors}")
    
    report_path = Path(r"C:\Users\abcom\jpbir\fix_report_phase2.md")
    report_path.write_text("\n".join(report), encoding="utf-8")
    print(f"\nReport: {report_path}")

if __name__ == "__main__":
    main()
