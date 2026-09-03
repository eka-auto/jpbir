#!/usr/bin/env python3
"""
VERIFY 1,593 "NEEDS REVIEW" FILES
Check if they actually use stale DB names or correctly use eka-agent.
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
STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]

def verify_file(file_path: Path) -> dict:
    """Verify a single file."""
    result = {
        "path": str(file_path),
        "has_stale_refs": False,
        "stale_dbs_found": [],
        "has_canonical": False,
        "uses_canonical_only": True,
        "verdict": "CLEAN",
    }
    
    try:
        content = file_path.read_text(encoding='utf-8', errors='ignore')
        
        # Check for stale DBs
        for stale_db in STALE_DBS:
            pattern = re.compile(r'\b' + re.escape(stale_db) + r'\b', re.IGNORECASE)
            if pattern.search(content):
                # Exclude URLs
                if re.search(rf'https?://\S*{stale_db}\S*', content, re.IGNORECASE):
                    continue
                # Exclude panel types
                if re.search(rf'panel_type\s*=\s*["\']{stale_db}["\']', content, re.IGNORECASE):
                    continue
                # Exclude document IDs
                if re.search(rf'{stale_db}_\d{{10}}_\d+', content, re.IGNORECASE):
                    continue
                # It's a real stale ref
                result["has_stale_refs"] = True
                if stale_db not in result["stale_dbs_found"]:
                    result["stale_dbs_found"].append(stale_db)
        
        # Check for canonical DB
        if re.compile(r'\beka-agent\b', re.IGNORECASE).search(content):
            result["has_canonical"] = True
        
        # Determine verdict
        if result["has_stale_refs"]:
            if result["has_canonical"]:
                result["verdict"] = "MIXED"  # Has both stale AND canonical
            else:
                result["verdict"] = "STALE_ONLY"
        elif result["has_canonical"]:
            result["verdict"] = "CORRECT"  # Only uses eka-agent
        else:
            result["verdict"] = "NO_DB_REFS"
        
    except Exception as e:
        result["verdict"] = f"ERROR: {e}"
    
    return result

def main():
    print("=" * 80)
    print("VERIFYING 1,593 'NEEDS REVIEW' FILES")
    print("=" * 80)
    print()
    
    # Load deep audit results
    deep_audit_path = Path(r"C:\Users\abcom\jpbir\deep_audit_detail.json")
    if not deep_audit_path.exists():
        print("[!] deep_audit_detail.json not found")
        return
    
    with open(deep_audit_path, 'r', encoding='utf-8') as f:
        all_files = json.load(f)
    
    # Filter to "needs review" files
    needs_review = [f for f in all_files if f.get("recommendation") == "REVIEW"]
    print(f"Files to verify: {len(needs_review)}")
    print()
    
    # Verify each file
    results = {
        "CLEAN": [],
        "CORRECT": [],
        "MIXED": [],
        "STALE_ONLY": [],
        "NO_DB_REFS": [],
        "ERROR": [],
    }
    
    for file_info in needs_review:
        file_path = Path(file_info["full_path"])
        if not file_path.exists():
            continue
        
        result = verify_file(file_path)
        result["tree"] = file_info["tree"]
        result["rel_path"] = file_info["path"]
        
        verdict = result["verdict"]
        if verdict.startswith("ERROR"):
            results["ERROR"].append(result)
        else:
            results[verdict].append(result)
    
    # Print summary
    print("=" * 80)
    print("VERIFICATION RESULTS")
    print("=" * 80)
    print()
    print(f"CLEAN (no stale refs): {len(results['CLEAN'])}")
    print(f"CORRECT (uses eka-agent): {len(results['CORRECT'])}")
    print(f"MIXED (has both stale + canonical): {len(results['MIXED'])}")
    print(f"STALE_ONLY (only stale refs): {len(results['STALE_ONLY'])}")
    print(f"NO_DB_REFS (no actual DB names): {len(results['NO_DB_REFS'])}")
    print(f"ERROR: {len(results['ERROR'])}")
    print()
    
    # Show files with stale refs
    stale_files = results["MIXED"] + results["STALE_ONLY"]
    if stale_files:
        print("=" * 80)
        print("⚠️ FILES WITH STALE DB REFS")
        print("=" * 80)
        for r in stale_files[:50]:
            print(f"\n{r['tree']}/{r['rel_path']}")
            print(f"  Stale DBs: {', '.join(r['stale_dbs_found'])}")
            print(f"  Verdict: {r['verdict']}")
    else:
        print("=" * 80)
        print("✅ ZERO FILES WITH STALE DB REFS")
        print("=" * 80)
    
    # Write report
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    report = []
    report.append("# VERIFICATION OF 1,593 'NEEDS REVIEW' FILES")
    report.append(f"**Generated:** {timestamp}")
    report.append("")
    report.append("## Summary")
    report.append("")
    report.append(f"| Verdict | Count | Percentage |")
    report.append(f"|---------|------:|-----------:|")
    total = len(needs_review)
    report.append(f"| CLEAN | {len(results['CLEAN'])} | {100*len(results['CLEAN'])/total:.2f}% |")
    report.append(f"| CORRECT (uses eka-agent) | {len(results['CORRECT'])} | {100*len(results['CORRECT'])/total:.2f}% |")
    report.append(f"| MIXED (stale + canonical) | {len(results['MIXED'])} | {100*len(results['MIXED'])/total:.2f}% |")
    report.append(f"| STALE_ONLY | {len(results['STALE_ONLY'])} | {100*len(results['STALE_ONLY'])/total:.2f}% |")
    report.append(f"| NO_DB_REFS | {len(results['NO_DB_REFS'])} | {100*len(results['NO_DB_REFS'])/total:.2f}% |")
    report.append(f"| ERROR | {len(results['ERROR'])} | {100*len(results['ERROR'])/total:.2f}% |")
    report.append("")
    
    if stale_files:
        report.append("## ⚠️ Files Needing Fix")
        report.append("")
        report.append(f"**Count:** {len(stale_files)} files still have stale DB references")
        report.append("")
        for r in stale_files:
            report.append(f"- `{r['tree']}/{r['rel_path']}`")
            report.append(f"  - Stale DBs: {', '.join(r['stale_dbs_found'])}")
            report.append(f"  - Verdict: {r['verdict']}")
        report.append("")
    else:
        report.append("## ✅ ALL FILES VERIFIED CLEAN")
        report.append("")
        report.append(f"**Zero files** have stale Firestore DB references.")
        report.append("")
    
    report_path = Path(r"C:\Users\abcom\jpbir\VERIFICATION_1593_REPORT.md")
    report_path.write_text("\n".join(report), encoding='utf-8')
    
    # Write JSON
    json_path = Path(r"C:\Users\abcom\jpbir\verification_1593_detail.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(dict(results), f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Report: {report_path}")
    print(f"✅ JSON: {json_path}")

if __name__ == "__main__":
    main()
