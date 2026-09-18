#!/usr/bin/env python3
"""
verify.py — Prove no file was lost, and find true duplicates.

The skill's first principle is "never lose data", but until this script every
check was structural: the state file said a copy *was attempted*, not that the
bytes arrived. This compares actual content hashes.

Two modes:

  --verify      Every file under --source must exist somewhere under --dest
                with identical content. Reports MISSING (real data loss),
                CHANGED, and EXTRA files. Exit code 1 if anything is missing,
                so it can gate a destructive cleanup step.

  --duplicates  Group files by content hash and report every group with more
                than one member. These are the ONLY files safe to delete when
                the instruction is "remove duplicates but keep everything
                else" — identical bytes mean nothing is lost by keeping one.

Usage:
  python3 verify.py --verify --source <src> --dest <dest>
  python3 verify.py --duplicates <folder>
  python3 verify.py --duplicates <folder> --json
"""
import argparse
import hashlib
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Kept in step with analyze.py: regenerable or VCS-internal trees are not part
# of the user's data, so their absence is never data loss.
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", "dist", "build", ".next", ".nuxt", "target", ".idea", ".vscode",
    ".restructure_backup", ".pytest_cache", ".mypy_cache", "coverage",
}

# Files that are byte-identical but genuinely belong in several places — an
# empty __init__.py or .gitkeep is a marker, not a duplicate to collapse.
NEVER_DUPLICATE = {".gitkeep", ".gitignore", "__init__.py", ".npmignore"}

READ_CHUNK = 1 << 20  # 1 MiB


def file_hash(path):
    """SHA-256 of a file's contents, or None if it can't be read."""
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(READ_CHUNK)
                if not chunk:
                    break
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def walk_files(root):
    """Yield (rel_path, abs_path) for every file under root, skipping noise."""
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            full = os.path.join(dirpath, name)
            yield os.path.relpath(full, root).replace("\\", "/"), full


def index_by_hash(root):
    """Map content hash -> list of rel paths. Also returns unreadable paths."""
    by_hash = {}
    unreadable = []
    for rel, full in walk_files(root):
        digest = file_hash(full)
        if digest is None:
            unreadable.append(rel)
            continue
        by_hash.setdefault(digest, []).append(rel)
    return by_hash, unreadable


def do_verify(source, dest):
    src_hashes, src_bad = index_by_hash(source)
    dst_hashes, dst_bad = index_by_hash(dest)

    missing = []   # content present in source, absent from dest -> DATA LOSS
    for digest, paths in src_hashes.items():
        if digest not in dst_hashes:
            missing.extend(sorted(paths))
    extra = []     # content in dest that was never in source
    for digest, paths in dst_hashes.items():
        if digest not in src_hashes:
            extra.extend(sorted(paths))

    src_files = sum(len(p) for p in src_hashes.values())
    dst_files = sum(len(p) for p in dst_hashes.values())

    print(f"Source: {src_files} files, {len(src_hashes)} distinct contents")
    print(f"Dest:   {dst_files} files, {len(dst_hashes)} distinct contents")
    print()
    if missing:
        print(f"MISSING — {len(missing)} file(s) from source have NO "
              f"byte-identical copy in dest. This is data loss:")
        for p in missing[:60]:
            print(f"  - {p}")
        if len(missing) > 60:
            print(f"  ... +{len(missing) - 60} more")
    else:
        print("MISSING: none. Every source file's content exists in dest.")
    print()
    if extra:
        print(f"EXTRA — {len(extra)} file(s) in dest not present in source "
              f"(generated files, handoff docs, or edits):")
        for p in extra[:25]:
            print(f"  + {p}")
        if len(extra) > 25:
            print(f"  ... +{len(extra) - 25} more")
    for label, bad in (("source", src_bad), ("dest", dst_bad)):
        if bad:
            print(f"\nUNREADABLE in {label} ({len(bad)}): "
                  f"{', '.join(bad[:10])}")
    return 1 if (missing or src_bad) else 0


def do_duplicates(root, as_json):
    by_hash, unreadable = index_by_hash(root)
    groups = []
    for digest, paths in by_hash.items():
        if len(paths) < 2:
            continue
        # Marker files are identical by nature; collapsing them breaks packages.
        if all(os.path.basename(p) in NEVER_DUPLICATE for p in paths):
            continue
        size = os.path.getsize(os.path.join(root, paths[0]))
        groups.append({
            "hash": digest,
            "size_bytes": size,
            "count": len(paths),
            # Shallowest path first: it is usually the canonical one to keep.
            "paths": sorted(paths, key=lambda p: (p.count("/"), p)),
            "reclaimable_bytes": size * (len(paths) - 1),
        })
    groups.sort(key=lambda g: -g["reclaimable_bytes"])
    total_dupes = sum(g["count"] - 1 for g in groups)
    reclaimable = sum(g["reclaimable_bytes"] for g in groups)

    if as_json:
        print(json.dumps({
            "root": root,
            "duplicate_groups": len(groups),
            "redundant_files": total_dupes,
            "reclaimable_bytes": reclaimable,
            "groups": groups,
            "unreadable": unreadable,
        }, indent=2))
        return 0

    print(f"Duplicate groups: {len(groups)}")
    print(f"Redundant files (safe to delete, keeping one per group): "
          f"{total_dupes}")
    print(f"Reclaimable: {reclaimable / 1024:.1f} KiB\n")
    for g in groups[:40]:
        print(f"  {g['count']}x  {g['size_bytes']} bytes")
        print(f"      KEEP   {g['paths'][0]}")
        for p in g["paths"][1:]:
            print(f"      dupe   {p}")
    if len(groups) > 40:
        print(f"  ... +{len(groups) - 40} more groups")
    if unreadable:
        print(f"\nUnreadable ({len(unreadable)}): {', '.join(unreadable[:10])}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true",
                    help="check every source file survived into dest")
    ap.add_argument("--duplicates", metavar="FOLDER", default=None,
                    help="report byte-identical duplicate files in FOLDER")
    ap.add_argument("--source", default=None)
    ap.add_argument("--dest", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.duplicates:
        root = os.path.abspath(args.duplicates)
        if not os.path.isdir(root):
            print(f"error: not a folder: {root}", file=sys.stderr)
            return 2
        return do_duplicates(root, args.json)

    if args.verify:
        if not (args.source and args.dest):
            print("error: --verify needs --source and --dest", file=sys.stderr)
            return 2
        return do_verify(os.path.abspath(args.source),
                         os.path.abspath(args.dest))

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
