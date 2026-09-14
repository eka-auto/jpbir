#!/usr/bin/env python3
"""
resolve_scope.py — Find every instance of a layer and rank them.

When a project has many Frontends/Backends (a monorepo, or several services),
"work on the frontend" is ambiguous. This script enumerates every candidate
folder for a layer, figures out which owner (product/service/app) each belongs
to, scores each by objective signals, and prints a ranked table so the agent
can pick one — or ask a single, well-formed question.

See references/scope-resolution.md for the decision procedure that consumes
this output.

Usage:
  python3 resolve_scope.py <root> --layer Frontend
  python3 resolve_scope.py <root> --layer Backend --owner URGAA
  python3 resolve_scope.py <root> --layer Frontend --json
"""
import argparse
import json
import os
import sys
import time

# The ranked table uses non-ASCII marks; force utf-8 so Windows' cp1252 console
# default doesn't raise UnicodeEncodeError.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAYER_NAMES = {"Frontend", "Backend", "Database", "Server", "Integrations"}

# entrypoints / manifests that prove a layer is real, not a stub
ENTRYPOINTS = {
    "App.tsx", "App.jsx", "main.tsx", "main.jsx", "index.html",
    "main.py", "app.py", "index.js", "server.js", "manage.py",
}
MANIFESTS = {
    "package.json", "vite.config.ts", "vite.config.js", "requirements.txt",
    "pyproject.toml", "go.mod", "pom.xml", "tsconfig.json",
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".restructure_backup",
             "dist", "build", ".next", "venv", ".venv"}

# how recent counts as "active" (days)
ACTIVE_WINDOW_DAYS = 21
# score margin below which top-2 is "too close to auto-pick"
DEFAULT_MARGIN = 4


def owner_of(root, layer_path):
    """The folder that OWNS this layer = its parent directory.
    e.g. .../04_PRODUCTS/PRD-URG-001_URGAA_Platform/Frontend
         -> owner 'PRD-URG-001_URGAA_Platform'
    """
    parent = os.path.dirname(layer_path)
    return os.path.basename(parent) if parent != root else "(root)"


def scan_dir_signals(path):
    """Collect signals from inside a candidate layer folder."""
    files = []
    latest_mtime = 0
    only_gitkeep = True
    for r, dirs, fs in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in fs:
            files.append(f)
            if f != ".gitkeep":
                only_gitkeep = False
            try:
                m = os.path.getmtime(os.path.join(r, f))
                latest_mtime = max(latest_mtime, m)
            except OSError:
                pass
    return files, latest_mtime, only_gitkeep


def find_candidates(root, layer):
    cands = []
    for r, dirs, _ in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for d in dirs:
            if d == layer:
                full = os.path.join(r, d)
                files, mtime, only_gitkeep = scan_dir_signals(full)
                has_entry = any(f in ENTRYPOINTS for f in files)
                has_manifest = any(f in MANIFESTS for f in files)
                cands.append({
                    "path": os.path.relpath(full, root),
                    "owner": owner_of(root, full),
                    "depth": os.path.relpath(full, root).count(os.sep),
                    "file_count": len(files),
                    "has_entrypoint": has_entry,
                    "has_manifest": has_manifest,
                    "only_gitkeep": only_gitkeep,
                    "mtime": mtime,
                })
    return cands


def score(c, now):
    s = 0
    reasons = []
    if c["has_entrypoint"]:
        s += 3; reasons.append("+3 entrypoint")
    if c["has_manifest"]:
        s += 2; reasons.append("+2 manifest")
    if c["mtime"] and (now - c["mtime"]) < ACTIVE_WINDOW_DAYS * 86400:
        s += 2; reasons.append("+2 recently modified")
    if c["file_count"] > 3:
        s += 1; reasons.append("+1 has content")
    if c["only_gitkeep"] or c["file_count"] == 0:
        s -= 3; reasons.append("-3 empty/stub")
    c["score"] = s
    c["score_reasons"] = reasons
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--layer", required=True, choices=sorted(LAYER_NAMES))
    ap.add_argument("--owner", default=None,
                    help="filter to owners whose name contains this (case-insensitive)")
    ap.add_argument("--margin", type=int, default=DEFAULT_MARGIN)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    now = time.time()
    cands = [score(c, now) for c in find_candidates(root, args.layer)]

    # optional owner filter (Step 1 of the procedure)
    if args.owner:
        needle = args.owner.lower()
        filtered = [c for c in cands if needle in c["owner"].lower()]
        if filtered:
            cands = filtered

    cands.sort(key=lambda c: (-c["score"], c["depth"], c["path"]))

    # decide resolution status
    if len(cands) == 0:
        status = "none"
    elif len(cands) == 1:
        status = "unique"
    else:
        top, second = cands[0], cands[1]
        status = "clear" if (top["score"] - second["score"]) >= args.margin else "ambiguous"

    result = {
        "layer": args.layer,
        "owner_filter": args.owner,
        "status": status,
        "margin": args.margin,
        "candidates": cands,
        "suggested": cands[0] if cands else None,
    }

    if args.json:
        print(json.dumps(result, indent=2))
        return

    # human table
    print(f"Layer: {args.layer}   candidates: {len(cands)}   status: {status.upper()}")
    if args.owner:
        print(f"(filtered to owner ~ '{args.owner}')")
    print()
    for i, c in enumerate(cands):
        mark = "★" if i == 0 else " "
        print(f"{mark} [{c['score']:>2}] {c['owner']}")
        print(f"      {c['path']}")
        print(f"      {', '.join(c['score_reasons']) or 'no signals'}")
    print()
    if status == "none":
        print("No such layer found. Check the layer name or the root path.")
    elif status == "unique":
        print(f"RESOLVED -> {cands[0]['path']}  (only candidate)")
    elif status == "clear":
        print(f"RESOLVED -> {cands[0]['path']}  (owner: {cands[0]['owner']}) "
              f"— clear winner. Announce this pick before writing.")
    else:
        tops = [c['owner'] for c in cands[:3]]
        print(f"AMBIGUOUS — ask ONE question. Candidates: {', '.join(tops)}"
              f"{' ...' if len(cands) > 3 else ''}")
        print("Do NOT write to any of them until the user picks.")


if __name__ == "__main__":
    main()
