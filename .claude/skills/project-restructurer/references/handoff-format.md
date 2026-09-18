# Handoff format — STATE and INTEGRATION templates

These two files are the actual product of this skill. Everything else exists to
produce them. Their job: let a *different* agent or human open the folder, read
one file, and know (a) what happened, (b) where everything is, and (c) exactly
where to resume — without re-scanning the whole tree.

`scripts/apply.py` maintains the JSON; `scripts/integrate.py` renders the
Markdown. If you ever hand-write either, match these shapes so other agents can
parse them reliably.

## RESTRUCTURE_STATE.json (machine source of truth)

```json
{
  "schema_version": "1.0",
  "tool": "project-restructurer",
  "created": "2026-09-08T10:30:00",
  "root": "/abs/path/to/output",
  "backup": "/abs/path/to/output/.restructure_backup",
  "layers": ["Frontend", "Backend", "Database", "Server", "Integrations", "_shared"],
  "moves": [
    {
      "from": "src/pages/Home.tsx",
      "to": "Frontend/pages/Home.tsx",
      "layer": "Frontend",
      "confidence": 0.92,
      "reason": "extension .tsx maps to Frontend",
      "status": "moved"
    }
  ],
  "removed": ["src", "old-scripts", "run.sh"],
  "resume_point": "phase4_integrate",
  "open_questions": [
    {"file": "_shared/util.js", "reason": "no strong signal", "confidence": 0.2}
  ]
}
```

Field notes:
- `status` is `moved` or `skipped` (with a `note`). This is what makes re-runs
  idempotent — completed moves are skipped, never repeated.
- `resume_point` is a short machine token another agent keys off:
  `phase1_analyze` → `phase2_plan` → `phase3_apply` → `phase4_integrate` →
  `done`.
- `open_questions` collects every low-confidence placement so a human can
  confirm them. Empty list means fully confident.

## INTEGRATION.md (human-readable handoff)

Sections, in this exact order — an agent reads top to bottom and can stop as
soon as it knows where to start:

1. **Start Here** — one paragraph. What the project is, what was done, and the
   single next action. This is the most-read part; make it self-contained.
2. **Where things live** — the layer table: layer, real path, file count,
   one-line description.
3. **Entry Points — where to begin** — the specific file to open first per
   layer (e.g. `Server/index.js` to boot, `Frontend/App.tsx` for UI). This is
   the answer to "where do I start working?" — the whole reason the skill
   exists. Never omit it.
4. **How the layers talk** — the data-flow diagram + the restaurant analogy, so
   even a newcomer gets the mental model in ten seconds.
5. **Resume Point** — plain-language restatement of the JSON `resume_point`,
   plus backup location and what was removed.
6. **Open Questions / TODO** — the low-confidence items to confirm.

## Why "where to start" matters

The user's core requirement is that another model can be brought in mid-way and
*"start from where it should start, in the same file or folder."* The **Entry
Points** section plus `resume_point` are how we deliver that: instead of the
next agent guessing or re-reading everything, it opens the named entrypoint of
the relevant layer and continues. Always populate both, even if you have to
infer the entrypoint by inspecting the layer's files.
