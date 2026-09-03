#!/usr/bin/env python3
"""
Stale Firestore DB Audit Script
Scans eka-agent trees and classifies files by:
- SAFE_TO_DELETE (BUILD, SCRATCH, DESTRUCTIVE targeting dead DBs)
- NEEDS_FIX (CONFIG, OPS, TEST with stale references)
- KEEP_AS_IS (S24_CANONICAL, already correct)
"""
import os
import re
from pathlib import Path
from collections import defaultdict

# Trees to scan
TREES = {
    "eka-agent": r"C:\Users\abcom\github-repos\eka-agent",
    "eka-agent-clean": r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    "eka-agent-main": r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    "Eka Runner": r"C:\Users\abcom\Go4Garage\Eka Runner",
}

# Stale DBs
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]
CANONICAL_DB = "eka-agent"

# Patterns
STALE_DB_PATTERN = re.compile(
    r'\b(?:' + '|'.join(re.escape(db) for db in STALE_DBS) + r')\b',
    re.IGNORECASE
)

def classify_file(file_path: Path, content: str) -> dict:
    """Classify a file based on its content and path."""
    rel_path = str(file_path.relative_to(file_path.parent.parent))
    
    # Check for stale DB references
    matches = STALE_DB_PATTERN.findall(content)
    if not matches:
        return {"status": "KEEP", "reason": "No stale DB references"}
    
    # Count matches per DB
    db_counts = defaultdict(int)
    for match in matches:
        db_counts[match.lower()] += 1
    
    # Classify by directory
    path_str = str(file_path).lower()
    
    if '\\build\\' in path_str or '\\.tmp\\' in path_str or '\\scratch\\' in path_str:
        return {
            "status": "SAFE_TO_DELETE",
            "category": "BUILD/SCRATCH",
            "stale_dbs": dict(db_counts),
            "reason": "Build intermediate or scratch file"
        }
    
    if 'factory_reset' in path_str or 'wipe' in path_str or 'destructive' in path_str:
        return {
            "status": "SAFE_TO_DELETE",
            "category": "DESTRUCTIVE",
            "stale_dbs": dict(db_counts),
            "reason": "Destructive script targeting non-existent DBs"
        }
    
    if file_path.suffix in ['.json', '.yaml', '.toml']:
        return {
            "status": "NEEDS_FIX",
            "category": "CONFIG",
            "stale_dbs": dict(db_counts),
            "reason": "Config file with stale DB references",
            "suggested_action": f"Update to use '{CANONICAL_DB}'"
        }
    
    if file_path.suffix in ['.py', '.ps1', '.js', '.ts']:
        # Check if it's a canonical S24 file
        if 'devices\\s24' in path_str or 'samsung-s24-ultra' in content.lower():
            # Check if it correctly uses eka-agent
            if 'eka-agent' in content.lower() or 'database_id="eka-agent"' in content:
                return {
                    "status": "KEEP_AS_IS",
                    "category": "S24_CANONICAL",
                    "reason": "Already uses canonical eka-agent DB"
                }
            else:
                return {
                    "status": "NEEDS_FIX",
                    "category": "S24_CANONICAL",
                    "stale_dbs": dict(db_counts),
                    "reason": "S24 canonical file needs DB update",
                    "suggested_action": f"Update to use '{CANONICAL_DB}'"
                }
        
        return {
            "status": "NEEDS_REVIEW",
            "category": "OPS/SCRIPT",
            "stale_dbs": dict(db_counts),
            "reason": "Script with stale DB references - needs case-by-case review"
        }
    
    if file_path.suffix == '.md':
        return {
            "status": "NEEDS_REVIEW",
            "category": "DOC",
            "stale_dbs": dict(db_counts),
            "reason": "Documentation with stale references"
        }
    
    return {
        "status": "NEEDS_REVIEW",
        "category": "OTHER",
        "stale_dbs": dict(db_counts)
    }


def scan_tree(tree_name: str, tree_root: str) -> dict:
    """Scan a single tree and return classification results."""
    results = {
        "SAFE_TO_DELETE": [],
        "NEEDS_FIX": [],
        "NEEDS_REVIEW": [],
        "KEEP_AS_IS": [],
        "KEEP": [],
    }
    
    root = Path(tree_root)
    if not root.exists():
        return {"error": f"Tree root not found: {tree_root}"}
    
    # Scan specific file types
    for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.toml', '*.md', '*.txt']:
        for file_path in root.rglob(ext):
            # Skip node_modules, .git, android/build
            if any(skip in str(file_path) for skip in ['node_modules', '.git', '\\build\\']):
                if '\\build\\' not in str(file_path):  # But include build intermediates for deletion
                    continue
            
            try:
                content = file_path.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            
            classification = classify_file(file_path, content)
            classification["file_path"] = str(file_path)
            classification["tree"] = tree_name
            
            if classification["status"] in results:
                results[classification["status"]].append(classification)
    
    return results


def main():
    print("=" * 80)
    print("STALE FIRESTORE DB AUDIT")
    print(f"Canonical DB: {CANONICAL_DB}")
    print(f"Stale DBs: {', '.join(STALE_DBS)}")
    print("=" * 80)
    
    all_results = defaultdict(list)
    
    for tree_name, tree_root in TREES.items():
        print(f"\n>>> Scanning {tree_name}...")
        results = scan_tree(tree_name, tree_root)
        
        if "error" in results:
            print(f"  [!] {results['error']}")
            continue
        
        for status, files in results.items():
            if status == "error":
                continue
            all_results[status].extend(files)
            print(f"  {status}: {len(files)} files")
    
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    for status, files in sorted(all_results.items()):
        print(f"{status}: {len(files)} files")
    
    # Write detailed report
    report_path = Path(r"C:\Users\abcom\jpbir\stale_db_audit_report.json")
    import json
    report_path.write_text(json.dumps(dict(all_results), indent=2, default=str), encoding='utf-8')
    print(f"\nDetailed report written to: {report_path}")


if __name__ == "__main__":
    main()
