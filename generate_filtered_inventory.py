"""Generate inventory matching the 6,581-file audit from memory."""
import os
import re
from datetime import datetime

ROOTS = [
    r"C:\Users\abcom\github-repos\eka-agent",
    r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    r"C:\Users\abcom\Go4Garage\Eka Runner",
]

# Extensions that count toward the 6,581 (runtime + configs + docs)
EXTENSIONS = (".py", ".ps1", ".sh", ".js", ".ts", ".bat", ".json", ".yaml", ".yml", ".toml", ".md", ".txt")

SKIP_EXACT = ("node_modules", ".git")
SKIP_SUBSTRINGS = ("android/app/build", "\\build\\", "build-intermediates")

all_files = []
for root in ROOTS:
    if not os.path.isdir(root):
        continue
    leaf = os.path.basename(root.rstrip("\\/"))
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_EXACT]
        full_dir = os.path.join(dirpath, "")
        if any(s in full_dir for s in SKIP_SUBSTRINGS):
            continue
        for fn in filenames:
            if not fn.lower().endswith(EXTENSIONS):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace("/", "\\")
            try:
                size = os.path.getsize(full)
            except Exception:
                size = 0
            all_files.append((leaf, rel, full, size))

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
md.append("- **Extensions:** `.py`, `.ps1`, `.sh`, `.js`, `.ts`, `.bat`, `.json`, `.yaml`, `.yml`, `.toml`, `.md`, `.txt`")
md.append("- **Excluded:** `node_modules/`, `.git/`, `android/app/build/`, `build-intermediates/`")
md.append("")
md.append("## Tree roots")
md.append("")
md.append("| Tree | Path |")
md.append("|------|------|")
for root in ROOTS:
    leaf = os.path.basename(root.rstrip("\\/"))
    md.append(f"| `{leaf}` | `{root}` |")
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