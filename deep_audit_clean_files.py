#!/usr/bin/env python3
"""
DEEP AUDIT OF 2,115 "CLEAN" FILES
Verify these files truly have no DB references or need fixes.
"""
import os
import re
import json
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

# Broader DB-related patterns
DB_PATTERNS = {
    "firestore": re.compile(r'firestore|Firestore|FIRESTORE', re.IGNORECASE),
    "database": re.compile(r'\b(data)?base\b', re.IGNORECASE),
    "db_var": re.compile(r'\b(db|DB|database)\s*[:=]', re.IGNORECASE),
    "collection": re.compile(r'collection\s*\(\s*["\']', re.IGNORECASE),
    "document": re.compile(r'document\s*\(\s*["\']', re.IGNORECASE),
    "query": re.compile(r'\.query\s*\(|\.get\s*\(|\.set\s*\(', re.IGNORECASE),
}

# Device/telemetry patterns
DEVICE_PATTERNS = {
    "device_doc": re.compile(r'devices?/|device[-_]id|deviceDoc', re.IGNORECASE),
    "command_queue": re.compile(r'commandQueue|command[-_]queue', re.IGNORECASE),
    "telemetry": re.compile(r'telemetry|heartbeat|status|online', re.IGNORECASE),
    "s24": re.compile(r's24|samsung|termux|android', re.IGNORECASE),
}

def analyze_clean_file(file_path: Path, rel_path: str, tree_name: str) -> dict:
    """Deep analyze a "clean" file."""
    result = {
        "tree": tree_name,
        "path": rel_path,
        "full_path": str(file_path),
        "size": 0,
        "has_firestore": False,
        "has_database": False,
        "has_device": False,
        "has_telemetry": False,
        "has_s24": False,
        "actually_clean": True,
        "concerns": [],
        "recommendation": "CLEAN",
    }
    
    try:
        result["size"] = file_path.stat().st_size
    except Exception:
        pass
    
    try:
        content = file_path.read_text(encoding='utf-8', errors='ignore')
        
        # Check for Firestore refs
        if DB_PATTERNS["firestore"].search(content):
            result["has_firestore"] = True
            result["concerns"].append("Has Firestore references")
        
        # Check for database patterns
        if DB_PATTERNS["database"].search(content):
            matches = DB_PATTERNS["database"].findall(content)
            # Filter out generic uses like "database connection"
            db_refs = [m for m in matches if m.lower() in ['database', 'base']]
            if db_refs:
                result["has_database"] = True
                result["concerns"].append(f"Has 'database' mentions ({len(db_refs)})")
        
        # Check for device/telemetry patterns
        if DEVICE_PATTERNS["device_doc"].search(content):
            result["has_device"] = True
            result["concerns"].append("Has device document references")
        
        if DEVICE_PATTERNS["telemetry"].search(content):
            result["has_telemetry"] = True
            result["concerns"].append("Has telemetry/heartbeat code")
        
        if DEVICE_PATTERNS["s24"].search(content):
            result["has_s24"] = True
            result["concerns"].append("Has S24/Android references")
        
        # Determine if actually clean
        if result["has_firestore"] or result["has_database"]:
            result["actually_clean"] = False
            result["recommendation"] = "REVIEW"
        elif result["has_device"] or result["has_telemetry"] or result["has_s24"]:
            result["actually_clean"] = True  # Still clean, just device-related
            result["recommendation"] = "CLEAN_BUT_DEVICE_RELATED"
        
    except Exception as e:
        result["concerns"].append(f"Read error: {str(e)}")
        result["recommendation"] = "ERROR"
    
    return result

def main():
    print("=" * 80)
    print("DEEP AUDIT OF 2,115 'CLEAN' FILES")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    print()
    
    all_results = []
    summary = {
        "truly_clean": 0,
        "clean_device_related": 0,
        "needs_review": 0,
        "error": 0,
    }
    
    for tree_name, tree_root in TREES.items():
        root = Path(tree_root)
        if not root.exists():
            continue
        
        print(f"\n>>> Deep auditing {tree_name}...")
        tree_count = 0
        
        for ext in ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.yml', '*.toml', '*.md', '*.txt', '*.sh', '*.bat', '*.cmd', '*.html', '*.xml']:
            for file_path in root.rglob(ext):
                # Skip node_modules, .git, android/build
                if any(skip in str(file_path) for skip in ['node_modules', '.git', 'android/app/build']):
                    continue
                
                rel_path = str(file_path.relative_to(root))
                result = analyze_clean_file(file_path, rel_path, tree_name)
                all_results.append(result)
                
                if result["recommendation"] == "CLEAN":
                    summary["truly_clean"] += 1
                elif result["recommendation"] == "CLEAN_BUT_DEVICE_RELATED":
                    summary["clean_device_related"] += 1
                elif result["recommendation"] == "REVIEW":
                    summary["needs_review"] += 1
                else:
                    summary["error"] += 1
                
                tree_count += 1
                if tree_count % 500 == 0:
                    print(f"  Processed: {tree_count} files...")
        
        print(f"  Total: {tree_count} files")
    
    print("\n" + "=" * 80)
    print("DEEP AUDIT COMPLETE")
    print("=" * 80)
    print(f"\nSUMMARY:")
    print(f"  Truly clean (no DB/device refs): {summary['truly_clean']:,}")
    print(f"  Clean but device-related: {summary['clean_device_related']:,}")
    print(f"  Needs review (has Firestore/DB): {summary['needs_review']:,}")
    print(f"  Errors: {summary['error']:,}")
    
    # Generate report
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    report = []
    report.append("# DEEP AUDIT OF 'CLEAN' FILES")
    report.append(f"**Generated:** {timestamp}")
    report.append(f"**Total Files Analyzed:** {len(all_results):,}")
    report.append("")
    report.append("## Summary")
    report.append("")
    report.append(f"| Category | Count | Percentage |")
    report.append(f"|----------|------:|-----------:|")
    report.append(f"| Truly clean | {summary['truly_clean']:,} | {100*summary['truly_clean']/len(all_results):.2f}% |")
    report.append(f"| Clean (device-related) | {summary['clean_device_related']:,} | {100*summary['clean_device_related']/len(all_results):.2f}% |")
    report.append(f"| **Needs review** | {summary['needs_review']:,} | {100*summary['needs_review']/len(all_results):.2f}% |")
    report.append(f"| Errors | {summary['error']:,} | {100*summary['error']/len(all_results):.2f}% |")
    report.append("")
    
    # Files needing review
    needs_review = [r for r in all_results if r["recommendation"] == "REVIEW"]
    if needs_review:
        report.append("## ⚠️ Files Needing Review")
        report.append("")
        report.append(f"**Count:** {len(needs_review)} files")
        report.append("")
        for r in needs_review[:30]:  # Limit
            report.append(f"### `{r['tree']}/{r['path']}`")
            report.append(f"- **Size:** {r['size']:,} bytes")
            report.append(f"- **Concerns:** {'; '.join(r['concerns'])}")
            report.append(f"- **Firestore refs:** {r['has_firestore']}")
            report.append(f"- **Database refs:** {r['has_database']}")
            report.append("")
    
    # Device-related files (sample)
    device_related = [r for r in all_results if r["recommendation"] == "CLEAN_BUT_DEVICE_RELATED"]
    if device_related:
        report.append("## ℹ️ Clean But Device-Related (Sample)")
        report.append("")
        report.append(f"**Count:** {len(device_related)} files")
        report.append("")
        report.append("These files have device/telemetry/S24 references but NO actual Firestore DB names.")
        report.append("")
        for r in device_related[:20]:
            report.append(f"- `{r['tree']}/{r['path']}`")
            report.append(f"  - Device: {r['has_device']}, Telemetry: {r['has_telemetry']}, S24: {r['has_s24']}")
        report.append("")
    
    # Write outputs
    json_path = Path(r"C:\Users\abcom\jpbir\deep_audit_detail.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    md_path = Path(r"C:\Users\abcom\jpbir\DEEP_CLEAN_AUDIT_REPORT.md")
    md_path.write_text("\n".join(report), encoding='utf-8')
    
    print(f"\n✅ JSON detail: {json_path}")
    print(f"✅ Markdown report: {md_path}")

if __name__ == "__main__":
    main()
