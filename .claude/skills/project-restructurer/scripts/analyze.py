#!/usr/bin/env python3
"""
analyze.py — Build a full recursive worktree of a folder.

Walks the target folder to its full depth (children -> their children -> ...
until leaves), and produces:
  - a nested tree structure
  - a flat file inventory with a first-pass layer guess + confidence
  - an ASCII rendering for humans

Usage:
  python3 analyze.py <folder> --out worktree.json
  python3 analyze.py <folder> --out worktree.json --deep   # sniff file contents
  python3 analyze.py <folder> --tree-only        # just print the ASCII tree
"""
import argparse
import json
import os
import sys

from classify import guess_layer  # sibling module

# The ASCII tree uses box-drawing characters; force utf-8 so Windows' cp1252
# console default doesn't raise UnicodeEncodeError mid-render.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Folders we never descend into or move — noise / regenerable / VCS internals.
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", "dist", "build", ".next", ".nuxt", "target", ".idea", ".vscode",
    ".restructure_backup", ".pytest_cache", ".mypy_cache", "coverage",
}


def build_tree(root, deep=False):
    """Return (nested_tree_dict, flat_file_list, stats).

    With deep=True, files whose extension cannot settle their layer are opened
    and their first few KB sniffed for framework/SDK signals. Costs one read per
    ambiguous file; repays it in far fewer low-confidence guesses.
    """
    flat = []
    stats = {"files": 0, "folders": 0, "max_depth": 0, "skipped_dirs": []}

    def walk(path, depth):
        stats["max_depth"] = max(stats["max_depth"], depth)
        name = os.path.basename(path.rstrip(os.sep)) or path
        node = {"name": name, "type": "folder", "children": []}
        try:
            entries = sorted(os.listdir(path))
        except (PermissionError, OSError) as e:
            node["error"] = str(e)
            return node
        for entry in entries:
            full = os.path.join(path, entry)
            if os.path.isdir(full):
                if entry in SKIP_DIRS:
                    stats["skipped_dirs"].append(full)
                    continue
                stats["folders"] += 1
                node["children"].append(walk(full, depth + 1))
            elif os.path.isfile(full):
                stats["files"] += 1
                rel = os.path.relpath(full, root)
                try:
                    size = os.path.getsize(full)
                except OSError:
                    size = None
                ext = os.path.splitext(entry)[1].lower()
                layer, confidence, reason = guess_layer(
                    rel, entry, ext, abs_path=full, deep=deep)
                finfo = {
                    "name": entry,
                    "type": "file",
                    "rel_path": rel,
                    "size": size,
                    "ext": ext,
                    "layer_guess": layer,
                    "confidence": confidence,
                    "reason": reason,
                }
                node["children"].append(finfo)
                flat.append(finfo)
        return node

    tree = walk(root, 0)
    stats["deep_scan"] = deep
    stats["low_confidence"] = sum(1 for f in flat if f["confidence"] < 0.6)
    return tree, flat, stats


def ascii_tree(node, prefix="", is_last=True):
    lines = []
    connector = "└── " if is_last else "├── "
    label = node["name"]
    if node["type"] == "file":
        label += f"   [{node['layer_guess']}·{int(node['confidence']*100)}%]"
    lines.append(prefix + connector + label)
    if node["type"] == "folder":
        kids = node.get("children", [])
        new_prefix = prefix + ("    " if is_last else "│   ")
        for i, child in enumerate(kids):
            lines.append(ascii_tree(child, new_prefix, i == len(kids) - 1))
    return "\n".join(lines)


def layer_distribution(flat):
    dist = {}
    for f in flat:
        dist[f["layer_guess"]] = dist.get(f["layer_guess"], 0) + 1
    return dist


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out", default=None)
    ap.add_argument("--tree-only", action="store_true")
    ap.add_argument("--deep", action="store_true",
                    help="open ambiguous files and infer the layer from their "
                         "contents (slower, much more accurate)")
    args = ap.parse_args()

    root = os.path.abspath(args.folder)
    if not os.path.isdir(root):
        print(f"error: not a folder: {root}", file=sys.stderr)
        sys.exit(1)

    tree, flat, stats = build_tree(root, deep=args.deep)
    ascii_ = ascii_tree(tree)

    if args.tree_only:
        print(ascii_)
        return

    result = {
        "root": root,
        "stats": stats,
        "layer_distribution": layer_distribution(flat),
        "tree": tree,
        "files": flat,
        "ascii_tree": ascii_,
    }
    payload = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
        print(ascii_)
        print()
        print(f"Files: {stats['files']}  Folders: {stats['folders']}  "
              f"Max depth: {stats['max_depth']}"
              f"{'  (deep scan)' if args.deep else ''}")
        print(f"Layer guess distribution: {layer_distribution(flat)}")
        print(f"Low confidence (<60%), needs review: {stats['low_confidence']}")
        if not args.deep and stats["low_confidence"]:
            print("Tip: re-run with --deep to classify these by file contents.")
        print(f"Worktree written to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
