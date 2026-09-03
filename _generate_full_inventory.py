#!/usr/bin/env python3
"""
Generate complete Markdown inventory of all 6,581 files from stale_db_audit_report.json
"""
import json
from pathlib import Path
from collections import defaultdict

REPORT_PATH = r"C:\Users\abcom\jpbir\stale_db_audit_report.json"
OUTPUT_PATH = r"C:\Users\abcom\jpbir\COMPLETE_FILE_LIST.md"

def load_report():
    with open(REPORT_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def generate_markdown(data):
    md = []
    md.append("# Complete File Inventory - Stale Firestore DB Audit\n")
    md.append("**Generated:** 2026-09-03\n")
    md.append(f"**Source:** `{REPORT_PATH.split(chr(92))[-1]}`\n")
    md.append(f"**Total Files:** {sum(len(v) for v in data.values()):,}\n")
    md.append("---\n")
    
    # Summary table
    md.append("## Summary\n")
    md.append("| Status | Count | Percentage |")
    md.append("|--------|-------|------------|")
    total = sum(len(v) for v in data.values())
    for status in ['KEEP', 'KEEP_AS_IS', 'SAFE_TO_DELETE', 'NEEDS_FIX', 'NEEDS_REVIEW']:
        count = len(data.get(status, []))
        pct = (count / total * 100) if total > 0 else 0
        md.append(f"| **{status}** | {count:,} | {pct:.1f}% |")
    md.append("")
    md.append("---\n")
    
    # Detailed lists by category
    categories = [
        ('SAFE_TO_DELETE', 'Files Safe to Delete (161 files)'),
        ('NEEDS_FIX', 'Files Needing Config Fixes (345 files)'),
        ('NEEDS_REVIEW', 'Files Needing Review (428 files)'),
        ('KEEP_AS_IS', 'Files Already Correct (106 files)'),
        ('KEEP', 'Files With No Issues (5,541 files)'),
    ]
    
    for status, title in categories:
        md.append(f"## {title}\n")
        files = data.get(status, [])
        
        if not files:
            md.append("*No files in this category.*\n")
            continue
        
        # Group by tree
        by_tree = defaultdict(list)
        for f in files:
            by_tree[f['tree']].append(f)
        
        for tree, tree_files in sorted(by_tree.items()):
            md.append(f"### {tree} ({len(tree_files)} files)\n")
            md.append("| # | File Path | Category | Stale DBs |")
            md.append("|---|-----------|----------|-----------|")
            
            for i, f in enumerate(tree_files[:100], 1):  # Limit 100 per tree for readability
                file_path = f['file_path']
                category = f.get('category', 'N/A')
                stale_dbs = ', '.join(f.get('stale_dbs', {}).keys()) if f.get('stale_dbs') else 'N/A'
                md.append(f"| {i} | `{file_path}` | {category} | {stale_dbs} |")
            
            if len(tree_files) > 100:
                md.append(f"\n*... and {len(tree_files) - 100} more files*")
            
            md.append("")
        
        md.append("---\n")
    
    # Appendix: All files flat list
    md.append("## Appendix: Complete Flat File List\n")
    md.append(f"**Total:** {total:,} files across 4 trees\n")
    md.append("")
    
    all_files = []
    for status, files in data.items():
        for f in files:
            all_files.append((status, f))
    
    # Sort by tree, then path
    all_files.sort(key=lambda x: (x[1]['tree'], x[1]['file_path']))
    
    md.append("| # | Status | Tree | File Path |")
    md.append("|---|--------|------|-----------|")
    
    for i, (status, f) in enumerate(all_files, 1):
        md.append(f"| {i} | {status} | {f['tree']} | `{f['file_path']}` |")
    
    return '\n'.join(md)

def main():
    print("Loading audit report...")
    data = load_report()
    
    print("Generating Markdown...")
    md_content = generate_markdown(data)
    
    print(f"Writing to {OUTPUT_PATH}...")
    Path(OUTPUT_PATH).write_text(md_content, encoding='utf-8')
    
    print(f"\n✓ Complete! Generated {OUTPUT_PATH}")
    print(f"  Total files documented: {sum(len(v) for v in data.values()):,}")

if __name__ == "__main__":
    main()
