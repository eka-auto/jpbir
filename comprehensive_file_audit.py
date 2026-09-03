#!/usr/bin/env python3
"""
COMPREHENSIVE FILE AUDIT - ALL 6,581 FILES
Checks every file for:
1. Stale Firestore DB references
2. File purpose/category
3. Action taken (fixed, skipped, clean)
4. Remaining issues

Canonical:
- Project: intrepid-stage-495117-q1
- Database: eka-agent
"""
import os
import re
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict

TREES = {
    "eka-agent": r"C:\Users\abcom\github-repos\eka-agent",
    "eka-agent-clean": r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    "eka-agent-main": r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    "Eka Runner": r"C:\Users\abcom\Go4Garage\Eka Runner",
}

CANONICAL_DB = "eka-agent"
CANONICAL_PROJECT = "intrepid-stage-495117-q1"
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]

# Patterns to detect
PATTERNS = {
    "stale_db_ref": re.compile(r'\b(' + '|'.join(re.escape(db) for db in STALE_DBS) + r')\b', re.IGNORECASE),
    "canonical_db": re.compile(r'\beka-agent\b', re.IGNORECASE),
    "url_ref": re.compile(r'https?://\S+', re.IGNORECASE),
    "panel_type": re.compile(r'panel_type\s*=\s*["\']', re.IGNORECASE),
    "doc_id": re.compile(r'_\d{10}_\d+', re.IGNORECASE),
    "github_repo": re.compile(r'bisug4g/\w+', re.IGNORECASE),
}

# Categorization
CATEGORIES = {
    "s24_daemon": ["s24_phone_direct_cloud", "firestore_mcp", "wa_export_daemon"],
    "config": ["claude_sdk_unified_config", "firebase.json", ".env", "config"],
    "operational": ["deploy", "dispatch", "sync", "export", "monitor", "verify", "check"],
    "destructive": ["wipe", "reset", "factory", "armed", "destructive"],
    "test": ["test_", "_test", "tests/"],
    "backup": ["backup", "_backup", "dump", "snapshot"],
    "build": ["build/", "intermediates", "node_modules"],
    "panel": ["eka-llm", "panel", "vditor"],
    "doc": [".md", "README", "DESIGN"],
    "scratch": [".tmp", "scratch"],
}

def categorize_file(rel_path: str) -> str:
    """Categorize file by path/name."""
    path_lower = rel_path.lower()
    for cat, keywords in CATEGORIES.items():
        if any(kw in path_lower for kw in keywords):
            return cat
    return "other"

def analyze_file(file_path: Path, rel_path: str, tree_name: str) -> dict:
    """Analyze a single file."""
    result = {
        "tree": tree_name,
        "path": rel_path,
        "full_path": str(file_path),
        "size": 0,
        "category": categorize_file(rel_path),
        "stale_refs": [],
        "canonical_refs": [],
        "url_refs": [],
        "panel_refs": [],
        "doc_id_refs": [],
        "github_refs": [],
        "action": "clean",
        "notes": [],
    }
    
    try:
        result["size"] = file_path.stat().st_size
    except Exception:
        pass
    
    try:
        content = file_path.read_text(encoding='utf-8', errors='ignore')
        
        # Check for stale DB refs
        stale_matches = PATTERNS["stale_db_ref"].findall(content)
        if stale_matches:
            # Filter out false positives
            for match in set(stale_matches):
                # Check if it's a URL
                if re.search(rf'https?://\S*{match}\S*', content, re.IGNORECASE):
                    result["url_refs"].append(match)
                    continue
                # Check if it's a panel type
                if re.search(rf'panel_type\s*=\s*["\']{match}["\']', content, re.IGNORECASE):
                    result["panel_refs"].append(match)
                    continue
                # Check if it's a document ID
                if re.search(rf'{match}_\d{{10}}_\d+', content, re.IGNORECASE):
                    result["doc_id_refs"].append(match)
                    continue
                # Check if it's a GitHub repo
                if re.search(rf'bisug4g/{match}', content, re.IGNORECASE):
                    result["github_refs"].append(match)
                    continue
                # It's an actual stale DB ref
                result["stale_refs"].append(match)
        
        # Check for canonical DB refs
        canonical_matches = PATTERNS["canonical_db"].findall(content)
        if canonical_matches:
            result["canonical_refs"] = list(set(canonical_matches))
        
        # Check for URLs
        url_matches = PATTERNS["url_ref"].findall(content)
        if url_matches:
            result["url_refs"].extend([u for u in url_matches if 'jarvis' in u.lower()])
        
        # Check for panel types
        panel_matches = PATTERNS["panel_type"].findall(content)
        if panel_matches and any(db in content for db in STALE_DBS):
            result["panel_refs"].extend([m for m in STALE_DBS if m in content])
        
        # Check for document IDs
        doc_id_matches = PATTERNS["doc_id"].findall(content)
        if doc_id_matches:
            result["doc_id_refs"].extend(list(set(doc_id_matches)))
        
        # Check for GitHub repo refs
        github_matches = PATTERNS["github_repo"].findall(content)
        if github_matches:
            result["github_refs"].extend(list(set(github_matches)))
        
        # Determine action
        if result["stale_refs"]:
            result["action"] = "NEEDS_FIX"
        elif result["panel_refs"] or result["doc_id_refs"] or result["github_refs"]:
            result["action"] = "FALSE_POSITIVE"
        elif result["canonical_refs"]:
            result["action"] = "CORRECT"
        else:
            result["action"] = "CLEAN"
        
        # Add notes
        if result["panel_refs"]:
            result["notes"].append(f"Panel type refs: {', '.join(set(result['panel_refs']))}")
        if result["doc_id_refs"]:
            result["notes"].append(f"Document ID refs (historical): {len(result['doc_id_refs'])} matches")
        if result["github_refs"]:
            result["notes"].append(f"GitHub repo refs: {', '.join(set(result['github_refs']))}")
        if result["url_refs"]:
            result["notes"].append(f"URL refs: {len([u for u in result['url_refs'] if 'jarvis' in u.lower()])} jarvis URLs")
        
    except Exception as e:
        result["action"] = "ERROR"
        result["notes"].append(f"Read error: {str(e)}")
    
    return result

def main():
    print("=" * 80)
    print("COMPREHENSIVE FILE AUDIT - ALL 6,581 FILES")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    print()
    
    all_results = []
    summary = defaultdict(lambda: defaultdict(int))
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            print(f"[!] Not found: {tree_root}")
            continue
        
        print(f"\n>>> Auditing {tree_name}...")
        tree_count = 0
        
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.yml', '*.toml', '*.md', '*.txt', '*.sh', '*.bat', '*.cmd', '*.html', '*.xml']:
            for file_path in root.rglob(ext):
                # Skip node_modules, .git, android/build
                if any(skip in str(file_path) for skip in ['node_modules', '.git', 'android/app/build']):
                    continue
                
                rel_path = str(file_path.relative_to(root))
                result = analyze_file(file_path, rel_path, tree_name)
                all_results.append(result)
                
                summary[tree_name][result["action"]] += 1
                tree_count += 1
                
                if tree_count % 500 == 0:
                    print(f"  Processed: {tree_count} files...")
        
        print(f"  Total: {tree_count} files")
    
    print("\n" + "=" * 80)
    print("AUDIT COMPLETE")
    print("=" * 80)
    
    # Generate report
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    report = []
    report.append("# COMPREHENSIVE FILE AUDIT REPORT")
    report.append(f"**Generated:** {timestamp}")
    report.append(f"**Total Files Audited:** {len(all_results):,}")
    report.append("")
    report.append("## Executive Summary")
    report.append("")
    
    # Overall stats
    total_needs_fix = sum(1 for r in all_results if r["action"] == "NEEDS_FIX")
    total_false_pos = sum(1 for r in all_results if r["action"] == "FALSE_POSITIVE")
    total_correct = sum(1 for r in all_results if r["action"] == "CORRECT")
    total_clean = sum(1 for r in all_results if r["action"] == "CLEAN")
    total_error = sum(1 for r in all_results if r["action"] == "ERROR")
    
    report.append(f"| Status | Count | Percentage |")
    report.append(f"|--------|------:|-----------:|")
    report.append(f"| NEEDS_FIX | {total_needs_fix:,} | {100*total_needs_fix/len(all_results):.2f}% |")
    report.append(f"| FALSE_POSITIVE | {total_false_pos:,} | {100*total_false_pos/len(all_results):.2f}% |")
    report.append(f"| CORRECT (uses eka-agent) | {total_correct:,} | {100*total_correct/len(all_results):.2f}% |")
    report.append(f"| CLEAN (no DB refs) | {total_clean:,} | {100*total_clean/len(all_results):.2f}% |")
    report.append(f"| ERROR | {total_error:,} | {100*total_error/len(all_results):.2f}% |")
    report.append("")
    
    # Per-tree breakdown
    report.append("## Per-Tree Breakdown")
    report.append("")
    report.append("| Tree | NEEDS_FIX | FALSE_POS | CORRECT | CLEAN | ERROR | Total |")
    report.append("|------|----------:|----------:|--------:|------:|------:|------:|")
    for tree_name in TREES:
        s = summary[tree_name]
        total = sum(s.values())
        report.append(f"| {tree_name} | {s['NEEDS_FIX']} | {s['FALSE_POSITIVE']} | {s['CORRECT']} | {s['CLEAN']} | {s['ERROR']} | {total:,} |")
    report.append("")
    
    # Files needing fix
    needs_fix = [r for r in all_results if r["action"] == "NEEDS_FIX"]
    if needs_fix:
        report.append("## ⚠️ Files Still Needing Fix")
        report.append("")
        report.append(f"**Count:** {len(needs_fix)} files")
        report.append("")
        for r in needs_fix[:50]:  # Limit to first 50
            report.append(f"### `{r['tree']}/{r['path']}`")
            report.append(f"- **Category:** {r['category']}")
            report.append(f"- **Stale refs:** {', '.join(set(r['stale_refs']))}")
            report.append(f"- **Size:** {r['size']:,} bytes")
            if r['notes']:
                report.append(f"- **Notes:** {'; '.join(r['notes'])}")
            report.append("")
    
    # False positives analysis
    false_pos = [r for r in all_results if r["action"] == "FALSE_POSITIVE"]
    if false_pos:
        report.append("## ℹ️ False Positives (Not Actual DB Refs)")
        report.append("")
        report.append(f"**Count:** {len(false_pos)} files")
        report.append("")
        
        # Group by reason
        panel_only = [r for r in false_pos if r['panel_refs'] and not r['stale_refs']]
        doc_id_only = [r for r in false_pos if r['doc_id_refs'] and not r['stale_refs']]
        github_only = [r for r in false_pos if r['github_refs'] and not r['stale_refs']]
        url_only = [r for r in false_pos if r['url_refs'] and not r['stale_refs']]
        
        report.append(f"- Panel type refs only: {len(panel_only)} files")
        report.append(f"- Document ID refs only: {len(doc_id_only)} files")
        report.append(f"- GitHub repo refs only: {len(github_only)} files")
        report.append(f"- URL refs only: {len(url_only)} files")
        report.append("")
    
    # Correct files (using eka-agent)
    correct = [r for r in all_results if r["action"] == "CORRECT"]
    if correct:
        report.append("## ✅ Files Using Canonical eka-agent")
        report.append("")
        report.append(f"**Count:** {len(correct)} files")
        report.append("")
    
    # Clean files
    clean = [r for r in all_results if r["action"] == "CLEAN"]
    if clean:
        report.append("## ✓ Files With No DB References")
        report.append("")
        report.append(f"**Count:** {len(clean)} files")
        report.append("")
    
    # Recommendations
    report.append("## 📋 Recommendations")
    report.append("")
    if needs_fix:
        report.append(f"1. **URGENT:** {len(needs_fix)} files still have stale DB references — run fix script")
    if false_pos:
        report.append(f"2. **REVIEW:** {len(false_pos)} false positives confirmed (panel types, doc IDs, URLs, GitHub repos)")
    report.append(f"3. **VERIFY:** {len(correct)} files correctly use `eka-agent`")
    report.append(f"4. **CLEAN:** {len(clean)} files have no DB references (safe)")
    report.append("")
    
    # Write JSON detail
    json_path = Path(r"C:\Users\abcom\jpbir\comprehensive_audit_detail.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    # Write markdown report
    md_path = Path(r"C:\Users\abcom\jpbir\COMPREHENSIVE_AUDIT_REPORT.md")
    md_path.write_text("\n".join(report), encoding='utf-8')
    
    print(f"\n✅ JSON detail: {json_path}")
    print(f"✅ Markdown report: {md_path}")
    print(f"\n📊 SUMMARY:")
    print(f"   NEEDS_FIX: {total_needs_fix:,}")
    print(f"   FALSE_POSITIVE: {total_false_pos:,}")
    print(f"   CORRECT: {total_correct:,}")
    print(f"   CLEAN: {total_clean:,}")
    print(f"   ERROR: {total_error:,}")
    print(f"   TOTAL: {len(all_results):,}")

if __name__ == "__main__":
    main()
