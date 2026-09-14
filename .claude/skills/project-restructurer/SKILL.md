---
name: project-restructurer
description: >-
  Analyze any project folder, produce a full recursive worktree of it, then
  reorganize every file into a clean, standard architecture layout —
  Frontend, Backend, Database, Server, Integrations — moving each file into
  its correct layer, removing the old scattered folders and stray scripts,
  and writing a machine-and-human readable STATE file (RESTRUCTURE_STATE.json
  plus INTEGRATION.md) so that ANY other agent or model can pick up the work
  later and know exactly what was done, where everything now lives, and where
  to resume. Use this skill whenever the user wants to "restructure",
  "reorganize", "clean up", "worktree", "map out", or "standardize" a
  codebase or folder, wants files sorted into Frontend/Backend/Database/
  Server/Integrations buckets, wants a project made handoff-ready for another
  agent, or asks to turn a messy folder into an enterprise-scale layout —
  even if they don't say the word "restructure" explicitly.
---

# Project Restructurer

Turn any messy folder into a clean, standard, **handoff-ready** project. The
whole point is that after this skill runs, a *different* agent or human can
open the folder, read one file, and instantly know what happened, where every
file lives, and where to start working. Optimize for that handoff above all.

## The five-layer model

Every file lands in exactly one of these layers. The restaurant analogy is the
mental model — keep it in mind when classifying:

| Layer | Analogy | Holds |
|-------|---------|-------|
| `Frontend` | dining area (customer sits here) | UI, components, pages, styles, client assets |
| `Backend` | kitchen (food is cooked here) | business logic, controllers, services, routes, APIs |
| `Database` | store room (all stock kept here) | schemas, migrations, models, seeds, ORM config |
| `Server` | the whole building it runs in | app entrypoint, hosting/deploy/infra, containers, CI/CD |
| `Integrations` | the waiter (carries orders in and out) | third-party clients: payments, SMS/email, maps, auth, webhooks |

A `_shared/` layer exists for genuinely cross-cutting files (root configs,
docs, env samples) that do not belong to a single layer. Use it sparingly.

## Workflow — run these phases in order

Do NOT skip phases. Each phase writes state, so if interrupted, the work is
resumable. **Always operate on a copy, never the user's original in place**,
unless the user explicitly says to modify in place.

### Phase 0 — Confirm scope

Establish and echo back to the user:
- **Target folder** (absolute path).
- **In-place or copy?** Default to copy (`<folder>_restructured`). Only work
  in place if the user insists — and even then, take a backup first.
- **Dry-run or apply?** Default to producing the plan first and showing it,
  then applying once. For a cautious user, stop after the plan.
- **Delete old folders?** The user asked for old scattered folders and stray
  scripts to be removed after files are moved. Confirm this is wanted; it is
  the default for this skill. Old structure is always recoverable from the
  backup.

If the folder path isn't given, ask for it. Don't guess.

### Phase 1 — Build the recursive worktree

Run the analyzer to walk the tree to its full depth (children → their children
→ … until leaves), capturing every file and folder.

```bash
python3 scripts/analyze.py <target-folder> --out /tmp/pr_worktree.json
```

This produces:
- A complete nested tree (JSON) of the current folder.
- A flat file inventory with, per file: path, size, extension, and a
  **first-pass layer guess** with a confidence score.
- An `ascii_tree` rendering for humans.

Show the user the ASCII tree and a short summary (file count, folder count,
depth, guessed layer distribution). This is the "worktree" deliverable they
asked for. See `references/classification.md` for how the guesser decides —
read it before overriding any classification.

### Phase 2 — Produce the migration plan

Turn the inventory into an explicit, reviewable plan: for every file, its
`from` path and its `to` path in the new layout. Nothing is moved yet.

```bash
python3 scripts/plan.py /tmp/pr_worktree.json --out /tmp/pr_plan.json
```

Review low-confidence classifications yourself using
`references/classification.md`, and hand-correct the plan JSON where the
guesser was wrong (e.g. a file named `payment.js` that is really internal
billing logic, not a third-party integration). Framework and language
signals matter more than filenames — a `.tsx` file is almost always Frontend
even if it's called `server.tsx`.

Show the user the plan grouped by target layer. Ask for corrections before
applying. This review gate is what makes the result trustworthy.

**Tell the user what moving files costs, and pick the layout to match.**
Nothing rewrites `import`/`require` paths, build configs, or route
registrations afterwards, so the layout choice decides whether the project
still builds:

| Mode | Destination | Use for |
|------|-------------|---------|
| default | `Layer/<one subdir hint>/<filename>` | loose scripts, assets, dead code — collapses the scatter |
| `--preserve-depth` | `Layer/<original/relative/path>` | a running application — same-layer relative imports keep resolving |

```bash
python3 scripts/plan.py /tmp/pr_worktree.json --out /tmp/pr_plan.json --preserve-depth
```

Neither mode fixes *cross-layer* imports; those still need hand-fixing after.
Say which case this is before applying, and on a running app offer to fix the
remaining imports as a follow-up step. The chosen mode is recorded as `layout`
in the plan and state files so the next agent knows what it inherited.

**Root-anchored files are pinned, never moved.** `.github/`, `.gitignore`,
`package.json`, `pyproject.toml`, `requirements*.txt`, `README.md`,
`firebase.json`, lockfiles and framework configs are found by tooling *only*
at the repo root. Moving one raises no error — CI just stops running, the
package just stops building. They appear in the plan under `_pinned` with
`from == to`, and `apply.py` keeps them through cleanup. If a project's
tooling reads some other path from the root, add it to `PINNED_FILES` in
`scripts/plan.py` before planning.

Pinning keeps the *anchors* working; it does not fix references those anchors
contain. If `pyproject.toml` says `packages.find include = ["ekagent*"]` and
`ekagent/` moves to `Backend/`, the manifest still needs editing by hand. Check
every pinned manifest for paths that point into moved code before declaring
the repo healthy.

**Name clashes are surfaced, not silently resolved.** When two files want one
destination the second is suffixed (`utils__1.js`) and listed under "Name
clashes" in the plan, and again in `open_questions`. `__1` is a placeholder —
get the user to give the file a real name rather than shipping it. Clash
detection is case-insensitive because Windows and macOS treat `Utils.js` and
`utils.js` as the same file.

### Phase 3 — Apply: move files into the new layout

```bash
python3 scripts/apply.py /tmp/pr_plan.json \
  --source <target-folder> \
  --dest <output-folder> \
  --backup
```

`apply.py` is **idempotent** and safe:
- Always writes a full backup first (`<output>/.restructure_backup/`) unless
  `--no-backup` is passed. Never destroy the only copy of anything.
- Creates the five (or six, with `_shared`) layer folders.
- Copies each file to its planned destination, preserving sub-structure
  *within* a layer where it aids clarity (e.g. `Frontend/components/…`).
- Records every move in the state file as it goes, so a re-run resumes
  instead of duplicating.
- Only after all moves succeed does it remove the now-empty old folders and
  stray root scripts (Phase requirement) — and only when `--clean-old` is
  set (default on for this skill). Removed paths are listed in the state
  file and still exist in the backup.

Two things about cleanup that the flags do not make obvious — say them to the
user rather than letting them assume:

- **Cleanup only happens in in-place mode** (`--dest` equals `--source`). In
  the default copy mode the source folder is untouched and *is* the old
  structure; nothing is deleted anywhere. If the user asked for the old
  scattered folders to be gone, they mean in-place — confirm that explicitly
  before running, because it is the destructive path.
- **Version control is never removed.** `.git`/`.hg`/`.svn` survive cleanup by
  design: they are excluded from the backup, so deleting them would be
  unrecoverable. Cleanup also refuses to run at all if no backup was taken.

### Phase 4 — Write the integration / handoff files

This is the most important deliverable. Generate two files at the output root:

```bash
python3 scripts/integrate.py --dest <output-folder>
```

1. **`RESTRUCTURE_STATE.json`** — the machine-readable source of truth:
   - schema version, timestamp, tool version
   - the resolved five-layer map
   - every file's `from` → `to`, its layer, and status (`moved` / `skipped`)
   - list of removed old folders/scripts
   - backup location
   - `resume_point`: the next phase/action any agent should take
   - `open_questions`: anything left ambiguous (low-confidence files a human
     should confirm)

2. **`INTEGRATION.md`** — the human-readable handoff. It MUST contain, in this
   order, so another model can start correctly and *in the right place*:
   - **Start Here** — one paragraph: what this project is, what was done, and
     the single next action to take.
   - **Where things live** — the layer table, each with its real folder path
     and a one-line description.
   - **Entry points** — the exact file(s) to open first per layer (e.g.
     `Server/index.js` to boot, `Frontend/App.tsx` for UI). This is how a
     new agent knows *where to begin* rather than reading everything.
   - **How the layers talk** — a short data-flow line using the analogy:
     Frontend → (API request) → Backend → Database, with Integrations called
     from Backend, all hosted in Server.
   - **Resume point** — restated from the JSON, plain language.
   - **Open questions / TODO** — the low-confidence items to confirm.

Keep both files at the output root so they're the first thing anyone sees.
Read `references/handoff-format.md` for the exact templates — follow them so
the output is consistent across runs and other agents can parse it reliably.

### Phase 4.5 — Verify nothing was lost

"Never lose data" is this skill's first principle, but the state file only
records that a copy was *attempted*. Prove it by content, before you tell the
user the job is done and before anything destructive runs:

```bash
python3 scripts/verify.py --verify --source <original-or-backup> --dest <output-folder>
```

Every file under source must have a byte-identical twin somewhere under dest.
The script reports `MISSING` (real data loss), `EXTRA` (generated files and the
handoff docs — expected), and exits non-zero if anything is missing, so it can
gate a cleanup step. **If it reports anything missing, do not clean up and do
not report success** — fix the plan and re-run Phase 3, which resumes.

On a case-insensitive filesystem (Windows, macOS) also confirm the new layer
folders have the exact casing the plan specified. `git mv backend Backend` can
silently no-op there, and a deploy that builds on Linux then 404s everything
while `git status` looks clean:

```bash
ls -d */ | cat      # read the real casing, not what you intended
```

### Phase 4.6 — Duplicates: report before removing

```bash
python3 scripts/verify.py --duplicates <folder>
```

Groups files by content hash, so a group is genuinely the same bytes — not a
guess from matching filenames. Shallowest path is listed first as the suggested
keeper. `.gitkeep`/`__init__.py` style markers are excluded; they are identical
by design.

**Identical bytes do not mean the copy is redundant.** Before deleting any
group, ask what the second copy is *for*: one bundle per deployable device,
a vendored file a build step expects in two places, a fixture committed beside
two different tests. Collapsing those breaks things in ways that only show up
at deploy or run time. Report the groups, say which ones you believe are safe
and why, and let the user decide. Default to keeping both and recording the
group in `open_questions`.

### Phase 5 — Report

Show the user: the new tree (`scripts/analyze.py <output-folder> --tree-only`),
counts per layer, what was removed, where the backup is, the verify result,
and the resume point. End by pointing them (and any future agent) at
`INTEGRATION.md`.

## Working on a project that has MANY Frontends / Backends

After restructuring — or on any monorepo — the same layer name exists in
several places (one `Frontend` per product/service). When the user later says
"work on the frontend", or an agent scans the tree and finds the layer five
times, **never guess which one**. A wrong-scope edit changes the wrong app and
is worse than pausing to ask.

Resolve to exactly one target with `scripts/resolve_scope.py`, then follow the
procedure in `references/scope-resolution.md`. In short:

1. **Enumerate** every candidate: `python3 scripts/resolve_scope.py <root>
   --layer Frontend`. One candidate → that's it, done.
2. **Explicit scope wins** — if the user named an owner ("URGAA frontend",
   "PRD-URG-001"), filter to it: `--owner URGAA`.
3. **Inherit active context** — no owner named but the session is mid-task on
   one product? Stay in that product's layer. Silently switching products is
   the worst failure.
4. **Rank by signals** — entrypoint present, framework manifest, recently
   modified, non-empty. The script scores these; a clear winner (margin ≥4)
   can be used after announcing the pick.
5. **Act or ask ONE question** — clear winner → proceed and say which owner you
   picked. Close call → ask a single question listing candidates *by owner*
   ("Which frontend — URGAA, GSTSAAS, or the Website?"). "All frontends" →
   apply to every candidate and report the list.
6. **Record it** — write the chosen `active_scope` into the state file so the
   next agent inherits the decision instead of re-deriving it.

Read `references/scope-resolution.md` before resolving — it has the full ranking
table, the margin rule, and worked examples.

## Principles

- **Handoff first.** If a choice makes the result easier for the next agent to
  pick up, take it. The STATE + INTEGRATION files are the product.
- **Never lose data.** Backup before any destructive step. Everything removed
  is listed and recoverable.
- **Idempotent.** Re-running never duplicates or corrupts; it resumes from the
  state file.
- **Explain classifications.** When you override the guesser, note why in the
  plan so it's auditable.
- **Language/framework > filename** when classifying. See
  `references/classification.md`.

## Reference files

- `references/classification.md` — full rules for sorting files into the five
  layers, including per-language and per-framework signals and edge cases.
  Read before Phase 2 corrections.
- `references/handoff-format.md` — exact templates for `RESTRUCTURE_STATE.json`
  and `INTEGRATION.md`. Read before Phase 4.
- `references/scope-resolution.md` — the decision procedure for picking ONE
  layer when many exist (multiple Frontends/Backends). Read before acting on a
  layer in any multi-product or monorepo tree.

## Scripts

| Script | Phase | What it does |
|--------|-------|--------------|
| `analyze.py` | 1 | recursive worktree + first-pass layer guess. `--deep` opens ambiguous files and classifies them by what they import — use it, it roughly halves the review queue |
| `plan.py` | 2 | `from` → `to` for every file. `--preserve-depth` for a running app, `--strip-prefix app/` when the tree is already in layer folders, so you get `Backend/x.js` and not `Backend/app/backend/x.js` |
| `apply.py` | 3 | backup, then copy each file to its destination. Idempotent; resumes from state |
| `verify.py` | 4.5 | `--verify` proves every source file survived, by hash. `--duplicates` finds byte-identical copies |
| `integrate.py` | 4 | writes `INTEGRATION.md` from the state file |
| `resolve_scope.py` | — | picks ONE layer when a monorepo has several |

## Restructuring a tree that is ALREADY organised

Some projects already have layer-ish folders (`app/backend/`, `src/frontend/`).
Three things change:

- Run `plan.py --preserve-depth --strip-prefix app/` so destinations come out
  as `Backend/jp-ask.js`, not `Backend/app/backend/jp-ask.js`. A leading
  segment that merely names the layer is dropped automatically.
- **Check what the move buys before doing it.** If the tree is already layered
  and something deploys from those paths, re-rooting them is churn with a real
  breakage cost and close to zero architectural gain. Say that plainly rather
  than restructuring because you were asked to restructure.
- **Grep for every hardcoded path first.** Deploy configs
  (`vercel.json`, `netlify.toml`, CI workflows, Dockerfiles), not source
  imports, are what usually break — and they fail at deploy, not at build.
  Watch for a *second*, nested config (e.g. `app/sandbox/vercel.json`) that a
  bulk find-and-replace would corrupt.
