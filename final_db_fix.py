#!/usr/bin/env python3
"""
Final Comprehensive Firestore DB Fix - All 6,581 Files
Aggressively replaces ALL stale DB references with 'eka-agent'.
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
CANONICAL_PROJECT = "intrepid-stage-495117-q1"
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]

def fix_all_refs(content: str) -> str:
    """Replace all stale DB references with canonical."""
    for stale in STALE_DBS:
        # Case variations
        content = re.sub(r'\b' + re.escape(stale) + r'\b', CANONICAL_DB, content, flags=re.IGNORECASE)
    return content

# Skip only truly dangerous files
SKIP_FILES = {
    "monitor_jarvis.ps1",  # GitHub repo reference
}

# Skip paths that are truly auto-generated or not source
SKIP_PATH_PATTERNS = [
    r"node_modules",
    r"\.git",
    r"android[/\\]app[/\\]build",
    r"__pycache__",
]

def should_skip(file_path: Path) -> bool:
    if file_path.name in SKIP_FILES:
        return True
    
    path_str = str(file_path)
    for pattern in SKIP_PATH_PATTERNS:
        if re.search(pattern, path_str, re.IGNORECASE):
            return True
    
    return False

def main():
    print("=" * 80)
    print("FINAL FIRESTORE DB FIX - ALL 6,581 FILES")
    print(f"Replacing: {', '.join(STALE_DBS)}")
    print(f"With: {CANONICAL_DB}")
    print("=" * 80)
    print()
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_lines = [
        "# Final DB Fix Report",
        f"Generated: {timestamp}",
        f"Canonical DB: `{CANONICAL_DB}`",
        f"Stale DBs replaced: {', '.join(STALE_DBS)}",
        "",
        "## Summary",
        "",
    ]
    
    grand_total = 0
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            continue
        
        tree_count = 0
        
        print(f">>> Processing {tree_name}...")
        
        # ALL file types
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.yml', '*.toml', '*.md', '*.txt', '*.sh', '*.bat', '*.cmd', '*.html', '*.xml']:
            for file_path in root.rglob(ext):
                if should_skip(file_path):
                    continue
                
                try:
                    original = file_path.read_text(encoding='utf-8', errors='ignore')
                    fixed = fix_all_refs(original)
                    
                    if fixed != original:
                        file_path.write_text(fixed, encoding='utf-8')
                        tree_count += 1
                except Exception:
                    pass
        
        print(f"    Fixed: {tree_count} files")
        report_lines.append(f"### {tree_name}")
        report_lines.append(f"- Files updated: {tree_count}")
        report_lines.append("")
        grand_total += tree_count
    
    report_lines.append("---")
    report_lines.append(f"**Total files updated:** {grand_total}")
    
    report_path = Path(r"C:\Users\abcom\jpbir\FINAL_DB_FIX_REPORT.md")
    report_path.write_text("\n".join(report_lines), encoding='utf-8')
    
    print()
    print("=" * 80)
    print(f"COMPLETE: {grand_total} files updated across all 4 trees")
    print(f"Report: {report_path}")
    print("=" * 80)

if __name__ == "__main__":
    main()
