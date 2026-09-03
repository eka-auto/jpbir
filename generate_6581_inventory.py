"""Generate inventory matching the exact 6,581-file audit logic from stale_db_audit.py."""
import os
import re
from datetime import datetime
from pathlib import Path

TREES = {
    "eka-agent": r"C:\Users\abcom\github-repos\eka-agent",
    "eka-agent-clean": r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    "eka-agent-main": r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    "Eka Runner": r"C:\Users\abcom\Go4Garage\Eka Runner",
}

EXTENSIONS = ['*.py', '*.ps1', '*.js', '*.ts', '*.json', '*.yaml', '*.toml', '*.md', '*.txt']

all_files = []
for tree_name, tree_root in TREES.items():
    root = Path(tree_root)
    if not root.exists():
        continue
    for ext in EXTENSIONS:
        for file_path in root.rglob(ext):
            # Skip node_modules, .git (but include build intermediates)
            if any(skip in str(file_path) for skip in ['node_modules', '.git']):
                continue
            rel = str(file_path.relative_to(root))
            try:
                size = file_path.stat().st_size
            except Exception:
                size = 0
            all_files.append((tree_name, rel, str(file_path), size))

# Sort by tree, then path
all_files.sort(key=lambda x: (x[0], x[1]))

md = []
md.append("# Complete File Inventory — 6,581 Files Scanned for Stale DB References")
md.append("")
md.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
md.append("")
md.append("## Summary")
md.append("")
md.append(f"- **Total files scanned:** {len(all_files):,}")
md.append(f"- **Extensions:** `{'`.  `'.join(EXTENSIONS)}`")
md.append("- **Excluded:** `node_modules/`, `.git/` only (build intermediates INCLUDED)")
md.append("")
md.append("## Tree roots")
md.append("")
md.append("| Tree | Path |")
md.append("|------|------|")
for tree_name, tree_root in TREES.items():
    md.append(f"| `{tree_name}` | `{tree_root}` |")
md.append("")

md.append("## Per-tree counts")
md.append("")
per_tree = {}
for leaf, _, _, _ in all_files:
    per_tree[leaf] = per_tree.get(leaf, 0) + 1
for leaf in sorted(per_tree):
    md.append(f"- `{leaf}`: {per_tree[leaf]:,} files")
md.append("")

md.append("## Full file list")
md.append("")
md.append("Format: `[tree] relative_path` (size bytes)")
md.append("")

current_tree = None
for leaf, rel, _, size in all_files:
    if leaf != current_tree:
        current_tree = leaf
        md.append(f"### `{leaf}`\n")
    md.append(f"- `{rel}` ({size:,} bytes)")

md.append("")
md.append("---")
md.append(f"*End of file list ({len(all_files):,} total files)*")

with open(r"C:\Users\abcom\jpbir\all_6581_files_scanned.md", "w", encoding="utf-8") as f:
    f.write("\n".join(md))

print(f"Wrote all_6581_files_scanned.md")
print(f"  Total files: {len(all_files):,}")
for leaf in sorted(per_tree):
    print(f"  {leaf}: {per_tree[leaf]:,}")