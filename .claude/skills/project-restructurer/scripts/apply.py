#!/usr/bin/env python3
"""
apply.py — Apply a migration plan: move files into the new five-layer layout.

Safety properties:
  * BACKUP FIRST: full copy of source into <dest>/.restructure_backup/ unless
    --no-backup. Never destroy the only copy of anything.
  * IDEMPOTENT: records each move in <dest>/RESTRUCTURE_STATE.json as it goes.
    Re-running skips already-completed moves instead of duplicating.
  * CLEAN-OLD (default on): after ALL moves succeed, remove the now-empty old
    folders and stray root scripts from the working copy. Everything removed is
    listed in state and still present in the backup.
  * NEVER TOUCHES VERSION CONTROL: .git/.hg/.svn are never removed, so history
    survives even an in-place run. They are excluded from the backup precisely
    because they are never deleted.

Usage:
  python3 apply.py plan.json --source <src> --dest <out> --backup --clean-old
"""
import argparse
import json
import os
import shutil
import time

# Version-control metadata. Removing these is unrecoverable (the backup does not
# copy them), so clean-old always skips them. Do not add to this set lightly.
VCS_DIRS = {".git", ".hg", ".svn", ".bzr"}


def load_state(dest):
    sp = os.path.join(dest, "RESTRUCTURE_STATE.json")
    if os.path.exists(sp):
        with open(sp, encoding="utf-8") as fh:
            return json.load(fh)
    return {
        "schema_version": "1.0",
        "tool": "project-restructurer",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "root": dest,
        "layers": [],
        "moves": [],
        "removed": [],
        "backup": None,
        "resume_point": "phase1_analyze",
        "open_questions": [],
    }


def fs_is_case_insensitive(path):
    """True if this filesystem treats FOO and foo as the same name.

    Matters because a source folder named `integrations/` IS the destination
    layer `Integrations/` on Windows and macOS — the file is already in place,
    and the old folder must not be "cleaned up" as if it were separate.
    """
    probe = os.path.join(path, ".pr_case_probe")
    try:
        with open(probe, "w"):
            pass
        return os.path.exists(os.path.join(path, ".PR_CASE_PROBE"))
    except OSError:
        return True  # unknown: assume the answer that prevents deletion
    finally:
        try:
            os.remove(probe)
        except OSError:
            pass


def copy_with_retry(src, dst, attempts=4):
    """Copy one file, retrying transient locks.

    On Windows a just-written file is routinely held for a moment by the
    indexer or an AV scanner, which surfaces as PermissionError/WinError 32.
    Returns None on success, or the error string after the last attempt.
    """
    delay = 0.15
    for attempt in range(attempts):
        try:
            shutil.copy2(src, dst)
            return None
        except (PermissionError, OSError) as e:
            if attempt == attempts - 1:
                return f"{type(e).__name__}: {e}"
            time.sleep(delay)
            delay *= 2


def save_state(dest, state):
    path = os.path.join(dest, "RESTRUCTURE_STATE.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--source", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--backup", action="store_true", default=True)
    ap.add_argument("--no-backup", dest="backup", action="store_false")
    ap.add_argument("--clean-old", action="store_true", default=True)
    ap.add_argument("--no-clean-old", dest="clean_old", action="store_false")
    args = ap.parse_args()

    source = os.path.abspath(args.source)
    dest = os.path.abspath(args.dest)
    with open(args.plan, encoding="utf-8") as fh:
        plan = json.load(fh)

    # --- preflight: no two files may aim at one destination --------------
    # SKILL.md tells the agent to hand-correct this JSON, so a clash can be
    # reintroduced after plan.py de-duped it. Case-folded, because Windows and
    # macOS collapse `Utils.js` and `utils.js` into one file. This has to be
    # caught before the first copy: afterwards the second file matches the
    # already-moved set, is counted as "skipped", and vanishes from the state
    # file with no error anywhere.
    claims = {}
    for m in plan["moves"]:
        claims.setdefault(m["to"].lower(), []).append(m["from"])
    clashes = {k: v for k, v in claims.items() if len(v) > 1}
    if clashes:
        print("REFUSING to apply: the plan sends more than one file to the "
              "same destination. Nothing has been copied.")
        for dst, srcs in sorted(clashes.items()):
            print(f"  {dst}")
            for s in srcs:
                print(f"      <- {s}")
        print("Give each one a distinct 'to' path and re-run.")
        raise SystemExit(1)

    os.makedirs(dest, exist_ok=True)
    state = load_state(dest)
    state["root"] = dest
    state["layers"] = plan["layers"]
    # Recorded as moved AND still on disk. Trusting the record alone makes a
    # re-run skip a destination that has since been deleted or truncated, so a
    # damaged output stays damaged and the state file keeps insisting it is
    # fine. Idempotent has to mean "converge on the plan", not "never redo what
    # I wrote down".
    done = {m["to"] for m in state["moves"]
            if m.get("status") == "moved"
            and os.path.exists(os.path.join(dest, *m["to"].split("/")))}

    # --- backup ---------------------------------------------------------
    backup_dir = os.path.join(dest, ".restructure_backup")
    if args.backup and not state.get("backup"):
        if not os.path.exists(backup_dir):
            shutil.copytree(source, backup_dir,
                            ignore=shutil.ignore_patterns(
                                ".git", "node_modules", "__pycache__",
                                ".restructure_backup"))
        state["backup"] = backup_dir
        save_state(dest, state)
        print(f"Backup created at {backup_dir}")

    # --- move files -----------------------------------------------------
    moved, skipped, failed = 0, 0, 0
    # A re-run records a fresh outcome for any destination it revisits. Keeping
    # the stale entry too would double-count the file in the per-layer totals
    # that INTEGRATION.md reports.
    def record(entry):
        state["moves"] = [e for e in state["moves"] if e["to"] != entry["to"]]
        state["moves"].append(entry)

    for m in plan["moves"]:
        to_rel = m["to"]
        if to_rel in done:
            skipped += 1
            continue
        # plan paths are stored with forward slashes for cross-OS handoff
        src_file = os.path.join(source, *m["from"].split("/"))
        dst_file = os.path.join(dest, *to_rel.split("/"))
        if not os.path.exists(src_file):
            record({**m, "status": "skipped", "note": "source missing"})
            skipped += 1
            continue
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
        if os.path.exists(dst_file) and os.path.samefile(src_file, dst_file):
            # e.g. integrations/stripe.js -> Integrations/stripe.js on Windows:
            # same file, nothing to copy. Already where the plan wants it.
            record({**m, "status": "moved",
                    "note": "already in place (same file)"})
            done.add(to_rel)
            moved += 1
            continue
        err = copy_with_retry(src_file, dst_file)
        if err:
            # One unreadable file must not abort the run: record it, keep going,
            # and let the failure count block cleanup below.
            record({**m, "status": "failed", "note": err})
            failed += 1
            continue
        record({**m, "status": "moved"})
        done.add(to_rel)
        moved += 1
        if moved % 25 == 0:
            save_state(dest, state)

    # low-confidence items become open questions for the next agent
    state["open_questions"] = [
        {"file": m["to"], "reason": m["reason"], "confidence": m["confidence"]}
        for m in plan["moves"] if m.get("needs_review")
    ]
    # auto-suffixed names are placeholders, not decisions — a human should
    # give the file a real name before the next agent inherits `utils__1.js`
    state["open_questions"].extend(
        {"file": m["to"],
         "reason": f"renamed from {m['from']} to avoid a name clash — "
                   f"give it a meaningful name"}
        for m in plan["moves"] if m.get("collision_renamed"))

    state["resume_point"] = "phase4_integrate"
    for m in state["moves"]:
        if m.get("status") == "failed":
            state["open_questions"].append(
                {"file": m["from"], "reason": f"copy failed: {m.get('note')}"})

    # Reconciliation: every planned file must have SOME row in state. A file
    # that is neither moved, skipped nor failed has gone missing silently,
    # which is the one outcome this tool must never produce quietly.
    recorded = {(m["from"], m["to"]) for m in state["moves"]}
    unaccounted = [m for m in plan["moves"]
                   if (m["from"], m["to"]) not in recorded]
    for m in unaccounted:
        state["open_questions"].append(
            {"file": m["from"],
             "reason": "planned but never recorded as moved/skipped/failed — "
                       "verify this file by hand"})
    save_state(dest, state)
    if unaccounted:
        print(f"WARNING: {len(unaccounted)} planned file(s) produced no state "
              f"row. Listed in open_questions; verify before cleanup.")
    print(f"Moved {moved} files, skipped {skipped} already-done/missing"
          f"{f', FAILED {failed}' if failed else ''}.")

    # --- clean old structure (only after successful moves) --------------
    # Operates on the DEST working copy only; source is untouched, backup holds
    # everything. We remove old scattered folders/scripts that are NOT part of
    # the new layer layout.
    if args.clean_old and dest == source and (failed or unaccounted):
        print(f"REFUSING to clean old structure: {failed} file(s) failed to "
              f"copy and {len(unaccounted)} produced no state row. Deleting "
              f"the originals now would lose them. Fix the listed problems "
              f"and re-run (completed moves are skipped).")
    elif args.clean_old and dest == source:
        # in-place mode: remove original top-level dirs/files not in layers
        if not state.get("backup"):
            print("REFUSING to clean old structure: no backup was taken. "
                  "Re-run without --no-backup, or pass --no-clean-old.")
            print(f"State: {os.path.join(dest, 'RESTRUCTURE_STATE.json')}")
            return
        # Pinned roots (.github, package.json, pyproject.toml …) are anchors,
        # not leftover scatter. They were deliberately never moved, so without
        # them in `keep` cleanup would delete the very files that make the
        # project build — silently, since nothing errors when they vanish.
        keep = (set(plan["layers"]) | VCS_DIRS
                | set(plan.get("pinned_roots", []))
                | {".restructure_backup", "RESTRUCTURE_STATE.json",
                   "INTEGRATION.md"})
        # On a case-insensitive filesystem `integrations` IS the `Integrations`
        # layer we just wrote into — match without case so we never delete it.
        if fs_is_case_insensitive(dest):
            keep = {k.lower() for k in keep}
            matches_keep = lambda e: e.lower() in keep
        else:
            matches_keep = lambda e: e in keep

        # Only remove a top-level entry the plan actually relocated files OUT
        # of. analyze.py skips regenerable-looking directories (dist, build,
        # target, .venv, coverage), so they never appear in the plan and never
        # reach pinned_roots — under a plain "not in keep" rule cleanup deletes
        # them sight-unseen. That is real loss when a repo COMMITS its built
        # artifact: a Firebase project whose firebase.json deploys
        # dist/firestore.rules loses the exact file it ships. Nothing was moved
        # out of an unexamined directory, so there is no basis to delete it.
        moved_from = {m["from"].split("/")[0] for m in plan["moves"]}
        if fs_is_case_insensitive(dest):
            moved_from = {r.lower() for r in moved_from}
            relocated = lambda e: e.lower() in moved_from
        else:
            relocated = lambda e: e in moved_from

        for entry in os.listdir(dest):
            if matches_keep(entry):
                continue
            if not relocated(entry):
                state.setdefault("left_alone", []).append(entry)
                continue
            full = os.path.join(dest, entry)
            try:
                if os.path.isdir(full):
                    shutil.rmtree(full)
                else:
                    os.remove(full)
                state["removed"].append(entry)
            except OSError as e:
                state["open_questions"].append(
                    {"file": entry, "reason": f"could not remove: {e}"})
        save_state(dest, state)
        print(f"Removed {len(state['removed'])} old folders/scripts "
              f"(recoverable from backup).")
        if state.get("left_alone"):
            print(f"Left untouched (never examined, so nothing was moved out "
                  f"of them): {', '.join(sorted(set(state['left_alone'])))}")
    elif args.clean_old:
        # copy mode: the dest is fresh, so there's nothing old to clean there.
        # We note that the source is left intact as the "old" copy.
        print("Copy mode: source left intact as the old structure; "
              "new layout is in dest. Nothing removed.")

    print(f"State: {os.path.join(dest, 'RESTRUCTURE_STATE.json')}")


if __name__ == "__main__":
    main()
