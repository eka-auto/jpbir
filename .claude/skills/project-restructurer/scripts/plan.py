#!/usr/bin/env python3
"""
plan.py — Turn the worktree inventory into an explicit migration plan.

For every file, compute its destination path inside the new five-layer
layout. Nothing is moved here; this only produces a reviewable JSON plan.

Two layouts are available, and the choice matters:

  default (flatten)  Layer/<one subdir hint>/<filename>. Collapses the old
                     scatter into a clean shallow tree. Right for loose
                     scripts, assets and dead code — wrong for a running app,
                     because every relative import breaks.

  --preserve-depth   Layer/<original/relative/path>. Keeps each file's
                     directory chain intact under its new layer, so relative
                     imports between files that land in the SAME layer keep
                     resolving. Right for an application you still need to
                     build. Cross-layer imports still need fixing by hand.

Usage:
  python3 plan.py worktree.json --out plan.json
  python3 plan.py worktree.json --out plan.json --preserve-depth
"""
import argparse
import json
import os

LAYERS = ["Frontend", "Backend", "Database", "Server", "Integrations", "_shared"]

# When a path segment clearly names a sub-area, keep it under the layer so the
# new tree stays legible instead of dumping everything flat.
KEEP_SUBDIR_HINTS = {
    "Frontend": {"components", "pages", "views", "styles", "assets", "hooks", "public"},
    "Backend": {"controllers", "services", "routes", "handlers", "middleware", "utils"},
    "Database": {"migrations", "models", "seeds", "schema", "schemas"},
    "Server": {"deploy", "infra", "docker", "k8s", "ci", "pipelines"},
    "Integrations": {"payments", "auth", "webhooks", "email", "sms", "maps"},
}


# Paths that tooling finds ONLY at the repository root. Moving one does not
# raise an error — the tool simply stops finding it, so CI quietly stops
# running, the package quietly stops building, ignore rules quietly stop
# applying. These stay exactly where they are, in every layout mode.
PINNED_DIRS = {".github", ".circleci", ".gitlab", ".husky", ".vscode", ".idea",
               # agent/tool metadata read from a fixed path, same as .github
               ".agents", ".claude", ".devcontainer"}

PINNED_FILES = {
    # version control
    ".gitignore", ".gitattributes", ".gitmodules", ".mailmap", "codeowners",
    # rendered by the forge from the root and nowhere else
    "readme.md", "readme.rst", "readme.txt", "license", "license.md",
    "license.txt", "contributing.md", "security.md", "changelog.md",
    # python packaging
    "pyproject.toml", "setup.py", "setup.cfg", "pipfile", "pipfile.lock",
    "poetry.lock", "tox.ini", "pytest.ini", "manifest.in",
    # node packaging
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "npm-shrinkwrap.json", ".npmrc", ".nvmrc",
    # other ecosystems
    "go.mod", "go.sum", "cargo.toml", "cargo.lock", "gemfile", "gemfile.lock",
    "composer.json", "composer.lock", "pom.xml", "build.gradle",
    "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
    # build / framework config resolved from the project root
    "tsconfig.json", "jsconfig.json", ".editorconfig", ".dockerignore",
    "docker-compose.yml", "docker-compose.yaml", "procfile",
    # platform config
    "firebase.json", ".firebaserc", "vercel.json", "netlify.toml", "app.json",
    # CI at root
    ".gitlab-ci.yml", "azure-pipelines.yml",
}

# Root files matched by prefix/suffix rather than exact name.
PINNED_PREFIXES = (".env", "requirements", ".eslintrc", ".prettierrc",
                   "babel.config", "vite.config", "next.config",
                   "tailwind.config", "jest.config", "webpack.config",
                   "rollup.config", "svelte.config", "nuxt.config")


def is_pinned(rel_path):
    """True if this file must stay at the repo root to keep working.

    Only root-level files qualify, plus anything inside a pinned directory
    such as `.github/`. A `package.json` deep inside a workspace is a real
    sub-package and moves with its code; the root one anchors the project.
    """
    parts = rel_path.replace("\\", "/").split("/")
    if parts[0].lower() in PINNED_DIRS:
        return True
    if len(parts) > 1:
        return False
    name = parts[0].lower()
    if name in PINNED_FILES:
        return True
    return name.startswith(PINNED_PREFIXES)


def collision_key(path):
    """Key used to decide whether two destinations are "the same file".

    Case-folded on purpose. Windows and macOS treat `Utils.js` and `utils.js`
    as one name, so two sources whose destinations differ only in case would
    overwrite each other on the user's own machine while the plan happily
    showed two distinct rows.
    """
    return path.lower()


def unique_dest(dest, taken):
    """Return a destination no earlier file has already claimed.

    Registers whatever name it hands back. Skipping that registration is what
    lets a file genuinely named `utils__1.js` and the `utils__1.js` generated
    for a clash of `utils.js` resolve to one path — after which one of them is
    silently lost, with no row in the plan and no row in the state file.

    Returns (path, was_renamed).
    """
    key = collision_key(dest)
    if key not in taken:
        taken.add(key)
        return dest, False
    base, ext = os.path.splitext(dest)
    n = 1
    while collision_key(f"{base}__{n}{ext}") in taken:
        n += 1
    renamed = f"{base}__{n}{ext}"
    taken.add(collision_key(renamed))
    return renamed, True


def strip_redundant_prefix(parts, layer, strip_prefix=None):
    """Drop leading directories that only restate where the file already is.

    A project that is *already* organised into layer folders — `app/backend/`,
    `src/frontend/` — would otherwise get destinations like
    `Backend/app/backend/jp-ask.js`, which buries the file one level deeper for
    no information gained. Two kinds of leading segment are dropped:

      1. an explicit --strip-prefix (e.g. `app/`), matched case-insensitively
      2. a segment that names the layer it is being filed under, so
         `backend/` under `Backend` goes, and `shared/` under `_shared` goes

    Only LEADING segments are considered: a nested `app/backend/models/app/` is
    real structure and stays. Returns the remaining parts.
    """
    parts = list(parts)
    if strip_prefix:
        prefix = [p for p in strip_prefix.replace("\\", "/").split("/") if p]
        if [p.lower() for p in parts[:len(prefix)]] == [p.lower() for p in prefix]:
            parts = parts[len(prefix):]
    # `_shared` is spelled `shared` in source trees; compare without the mark.
    layer_key = layer.lstrip("_").lower()
    while len(parts) > 1 and parts[0].lower() == layer_key:
        parts = parts[1:]
    return parts


def dest_for(finfo, preserve_depth=False, strip_prefix=None):
    layer = finfo["layer_guess"]
    rel = finfo["rel_path"]
    parts = rel.replace("\\", "/").split("/")
    filename = parts[-1]
    old_dirs = [p.lower() for p in parts[:-1]]

    # Keep the whole directory chain under the layer. Files that shared a
    # directory before still share one, so relative imports between two files
    # that land in the same layer keep resolving.
    if preserve_depth:
        kept = strip_redundant_prefix(parts, layer, strip_prefix)
        return f"{layer}/{'/'.join(kept)}"

    # Try to preserve one meaningful sub-directory hint under the layer.
    subdir = None
    hints = KEEP_SUBDIR_HINTS.get(layer, set())
    for d in old_dirs:
        # normalize plurals loosely
        if d in hints or d.rstrip("s") + "s" in hints:
            subdir = d
            break

    # Always emit forward slashes: these paths are written into the plan and the
    # STATE file, which another agent may read on a different OS.
    if subdir:
        return f"{layer}/{subdir}/{filename}"
    return f"{layer}/{filename}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("worktree")
    ap.add_argument("--out", default="plan.json")
    ap.add_argument("--preserve-depth", action="store_true",
                    help="keep each file's original directory chain under its "
                         "new layer, so same-layer relative imports survive "
                         "(use for a running app; the default flatten mode "
                         "breaks them)")
    ap.add_argument("--strip-prefix", default=None, metavar="PREFIX",
                    help="with --preserve-depth, drop this leading path from "
                         "every source path (e.g. 'app/') so an already-"
                         "organised tree does not end up as "
                         "Backend/app/backend/x.js. A leading segment that "
                         "merely names the layer is always dropped too.")
    args = ap.parse_args()
    if args.strip_prefix and not args.preserve_depth:
        # In flatten mode only the filename and one subdir hint survive, so a
        # prefix has nothing to strip from — silently ignoring the flag would
        # leave the user thinking it applied.
        ap.error("--strip-prefix only applies with --preserve-depth")

    with open(args.worktree, encoding="utf-8") as fh:
        wt = json.load(fh)

    moves = []
    taken = set()
    for f in wt["files"]:
        rel = f["rel_path"].replace("\\", "/")
        pinned = is_pinned(rel)
        if pinned:
            # stays put: same path in, same path out
            dest, renamed = unique_dest(rel, taken)
        else:
            dest, renamed = unique_dest(
                dest_for(f, args.preserve_depth, args.strip_prefix), taken)
        moves.append({
            "from": rel,
            "to": dest,
            "layer": "_pinned" if pinned else f["layer_guess"],
            "confidence": f["confidence"],
            "reason": ("must stay at repo root or tooling silently stops "
                       "finding it") if pinned else f["reason"],
            "needs_review": (not pinned) and f["confidence"] < 0.6,
            # Renamed to avoid clobbering an earlier file of the same name.
            # Surfaced so a human can give it a meaningful name instead.
            "collision_renamed": renamed,
            "pinned": pinned,
        })

    collisions = [m for m in moves if m["collision_renamed"]]
    plan = {
        "root": wt["root"],
        "layers": LAYERS,
        "moves": moves,
        "review_count": sum(1 for m in moves if m["needs_review"]),
        "collision_count": len(collisions),
        "pinned_count": sum(1 for m in moves if m["pinned"]),
        # Top-level entries apply.py must never clean up: these are the
        # project's anchors, not leftover scatter.
        "pinned_roots": sorted({m["to"].split("/")[0]
                                for m in moves if m["pinned"]}),
        # Recorded so apply/integrate and the next agent know whether relative
        # imports were preserved or flattened.
        "layout": "preserve-depth" if args.preserve_depth else "flatten",
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, indent=2)

    # human summary
    by_layer = {}
    for m in moves:
        by_layer.setdefault(m["layer"], []).append(m)
    print(f"Migration plan: {len(moves)} files across {len(by_layer)} layers")
    print(f"Needs human review (low confidence): {plan['review_count']}")
    print(f"Renamed to avoid a name clash: {plan['collision_count']}")
    print(f"Pinned at root (not moved): {plan['pinned_count']}\n")
    for layer in LAYERS + ["_pinned"]:
        items = by_layer.get(layer, [])
        if not items:
            continue
        print(f"  {layer}/  ({len(items)} files)")
        for m in items[:12]:
            flags = []
            if m["needs_review"]:
                flags.append("REVIEW")
            if m["collision_renamed"]:
                flags.append("RENAMED")
            flag = f"  <-- {' + '.join(flags)}" if flags else ""
            print(f"    {m['from']}  ->  {m['to']}{flag}")
        if len(items) > 12:
            print(f"    ... +{len(items) - 12} more")
        print()

    # Listed in full and outside the per-layer truncation: a clash means two
    # different files wanted one name, and `__1` is a placeholder, not an
    # answer. The user should rename them to something meaningful.
    if collisions:
        print(f"  Name clashes ({len(collisions)}) — auto-suffixed, rename these:")
        for m in collisions:
            print(f"    {m['from']}  ->  {m['to']}")
        print()
    print(f"Plan written to {args.out}")


if __name__ == "__main__":
    main()
