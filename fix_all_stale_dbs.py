#!/usr/bin/env python3
"""
Fix all stale Firestore DB references across 4 eka-agent trees.
Updates all scripts/configs to use canonical 'eka-agent' database.

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

# Patterns for different DB reference formats
PATTERNS = {
    # String literals: database='swarn', database="jarvis", etc.
    "db_string_single": (
        re.compile(r"""database\s*=\s*['"](eka-validation|eka-llm|eka-runner|swarn|jarvis)['"]""", re.IGNORECASE),
        rf"database='{CANONICAL_DB}'"
    ),
    "db_string_double": (
        re.compile(r"""database\s*=\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']""", re.IGNORECASE),
        rf'database="{CANONICAL_DB}"'
    ),
    # database_id defaults
    "database_id_default": (
        re.compile(r"""database_id\s*=\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']""", re.IGNORECASE),
        rf"database_id='{CANONICAL_DB}'"
    ),
    # Firestore client instantiation
    "firestore_client": (
        re.compile(r"""firestore\.Client\s*\(\s*project\s*=\s*['"]intrepid-stage-495117-q1['"]\s*,\s*database\s*=\s*['"](eka-validation|eka-llm|eka-runner|swarn|jarvis)['"]\s*\)""", re.IGNORECASE),
        rf"firestore.Client(project='{CANONICAL_PROJECT}', database='{CANONICAL_DB}')"
    ),
    # Env var fallbacks: os.environ.get("FIRESTORE_DB", "swarn")
    "env_fallback": (
        re.compile(r"""os\.environ\.get\s*\(\s*["']FIRESTORE_DB["']\s*,\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']\s*\)""", re.IGNORECASE),
        rf'os.environ.get("FIRESTORE_DB", "{CANONICAL_DB}")'
    ),
    # PowerShell: $db = "swarn"
    "ps1_db_var": (
        re.compile(r"""\$\s*db\s*=\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']""", re.IGNORECASE),
        rf'$db = "{CANONICAL_DB}"'
    ),
    # PowerShell: $database = "jarvis"
    "ps1_database_var": (
        re.compile(r"""\$\s*database\s*=\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']""", re.IGNORECASE),
        rf'$database = "{CANONICAL_DB}"'
    ),
    # JS/TS: const db = 'swarn'
    "js_db_const": (
        re.compile(r"""const\s+(?:db|database|DATABASE)\s*=\s*['"](eka-validation|eka-llm|eka-runner|swarn|jarvis)['"]""", re.IGNORECASE),
        rf"const db = '{CANONICAL_DB}'"
    ),
    # YAML: database: swarn
    "yaml_db": (
        re.compile(r"""^(\s*database:\s*)(eka-validation|eka-llm|eka-runner|swarn|jarvis)\s*$""", re.IGNORECASE | re.MULTILINE),
        rf"\1{CANONICAL_DB}"
    ),
    # JSON: "database": "swarn"
    "json_db": (
        re.compile(r"""["']database["']\s*:\s*["'](eka-validation|eka-llm|eka-runner|swarn|jarvis)["']""", re.IGNORECASE),
        rf'"database": "{CANONICAL_DB}"'
    ),
}

# Files to skip (already correct or special purpose)
SKIP_PATHS = [
    "node_modules",
    ".git",
    "android/app/build",
    "build-intermediates",
    "stale_db_audit.py",
    "stale_db_audit_report.json",
    "COMPLETE_FILE_LIST.md",
    "all_6581_files_scanned.md",
    "stale_db_inventory.md",
]

# Files that should NOT be auto-fixed (need manual review)
SKIP_FILES = [
    "monitor_jarvis.ps1",  # References GitHub repo bisug4g/jarvis, not Firestore DB
    "factory_reset_s24_ultra_all_databases.py",  # Destructive - needs guard, not blind fix
    "execute_armed_wipe_queue.py",  # Destructive
    "execute_real_device_hardware_wipe.py",  # Destructive
    "execute_real_device_hardware_wipe_fast.py",  # Destructive
    "execute_pure_engineering_factory_reset.py",  # Destructive
]

def should_skip(file_path: Path) -> tuple[bool, str]:
    """Check if file should be skipped."""
    path_str = str(file_path).lower()
    name = file_path.name.lower()
    
    for skip in SKIP_PATHS:
        if skip.lower() in path_str:
            return True, f"skip path: {skip}"
    
    if name in [f.lower() for f in SKIP_FILES]:
        return True, f"skip file: {file_path.name}"
    
    return False, ""

def fix_file(file_path: Path) -> tuple[int, list[str]]:
    """Apply all fix patterns to a file. Returns (count of changes, list of descriptions)."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return 0, [f"read error: {e}"]
    
    original = content
    changes = []
    
    for pattern_name, (pattern, replacement) in PATTERNS.items():
        matches = pattern.findall(content)
        if matches:
            content = pattern.sub(replacement, content)
            for match in matches:
                changes.append(f"{pattern_name}: {match} → {CANONICAL_DB}")
    
    if content != original:
        try:
            file_path.write_text(content, encoding="utf-8")
            return len(changes), changes
        except Exception as e:
            return 0, [f"write error: {e}"]
    
    return 0, []

def main():
    print("=" * 80)
    print("FIRESTORE DB REFERENCE FIX SCRIPT")
    print(f"Canonical project: {CANONICAL_PROJECT}")
    print(f"Canonical database: {CANONICAL_DB}")
    print(f"Stale DBs being replaced: {', '.join(STALE_DBS)}")
    print("=" * 80)
    print()
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_lines = [
        f"# Stale Firestore DB Fix Report",
        f"Generated: {timestamp}",
        f"",
        f"## Summary",
        f"- Canonical project: `{CANONICAL_PROJECT}`",
        f"- Canonical database: `{CANONICAL_DB}`",
        f"- Stale DBs replaced: `{', '.join(STALE_DBS)}`",
        f"",
        f"## Results by tree",
        f"",
    ]
    
    total_fixed = 0
    total_skipped = 0
    total_errors = 0
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            print(f"[!] Tree not found: {tree_root}")
            continue
        
        tree_fixed = 0
        tree_skipped = 0
        tree_errors = 0
        tree_changes = []
        
        print(f"\n>>> Scanning {tree_name}...")
        
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.toml']:
            for file_path in root.rglob(ext):
                # Check skip conditions
                skip, reason = should_skip(file_path)
                if skip:
                    tree_skipped += 1
                    continue
                
                # Apply fixes
                count, changes = fix_file(file_path)
                if count > 0:
                    tree_fixed += 1
                    rel_path = str(file_path.relative_to(root))
                    tree_changes.append(f"  - `{rel_path}` ({count} changes)")
                    for c in changes[:3]:  # Show first 3 changes per file
                        tree_changes.append(f"    - {c}")
                    if len(changes) > 3:
                        tree_changes.append(f"    - ... and {len(changes) - 3} more")
                elif changes:
                    tree_errors += 1
        
        print(f"  Fixed: {tree_fixed} files")
        print(f"  Skipped: {tree_skipped} files")
        if tree_errors:
            print(f"  Errors: {tree_errors} files")
        
        report_lines.append(f"### {tree_name}")
        report_lines.append(f"- Fixed: {tree_fixed} files")
        report_lines.append(f"- Skipped: {tree_skipped} files")
        report_lines.append(f"- Errors: {tree_errors} files")
        report_lines.append("")
        if tree_changes:
            report_lines.append("**Changes:**")
            report_lines.extend(tree_changes)
            report_lines.append("")
        
        total_fixed += tree_fixed
        total_skipped += tree_skipped
        total_errors += tree_errors
    
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total fixed: {total_fixed} files")
    print(f"Total skipped: {total_skipped} files")
    if total_errors:
        print(f"Total errors: {total_errors} files")
    
    report_lines.append("---")
    report_lines.append(f"**Total fixed:** {total_fixed} files")
    report_lines.append(f"**Total skipped:** {total_skipped} files")
    if total_errors:
        report_lines.append(f"**Total errors:** {total_errors} files")
    
    # Write report
    report_path = Path(r"C:\Users\abcom\jpbir\fix_report.md")
    report_path.write_text("\n".join(report_lines), encoding="utf-8")
    print(f"\nReport written to: {report_path}")

if __name__ == "__main__":
    main()
