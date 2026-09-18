# Scope resolution — what to do when there are MANY Frontends / Backends

A real project rarely has exactly one `Frontend` and one `Backend`. A monorepo
has one per product; a large app has several services. So when an agent is told
"work on the frontend" or scans the tree and finds the layer in five places, it
must **not guess**. This file is the decision procedure. Follow it top to
bottom; stop at the first rule that resolves the target.

The goal: turn a vague layer word into ONE concrete folder path, or ask exactly
one clarifying question when it truly can't be decided.

## Step 0 — Discover every candidate

Before deciding anything, enumerate. Run:

```bash
python3 scripts/resolve_scope.py <root> --layer Frontend
```

It walks the tree and returns every folder that IS a `Frontend` layer (and the
same for any layer), each annotated with:
- its **owner** — the product/service/app folder it sits inside
- its **depth** and full path
- **signals** found inside (framework files, entrypoints, last-modified)
- a **confidence** that this is a real layer vs a coincidental folder name

If there is exactly one candidate → that's the answer. Done. The rest of this
file is only for when there are two or more.

## Step 1 — Use an explicit scope if the user gave one

The user's words usually name the owner. Match in this order:

1. **Exact owner name / id** — "URGAA frontend", "PRD-URG-001", "the billing
   service backend" → pick the candidate whose owner matches. A product id or a
   quoted product name is the strongest signal there is.
2. **Alias** — check each owner folder's aliases (from any `INTEGRATION.md` /
   state file, or the folder's own README). "URJA" resolves to URGAA.
3. **Path fragment** — if the user typed a path piece ("products/gst/..."),
   filter candidates to those under it.

If exactly one candidate survives → that's the target.

## Step 2 — Use the active working context

If the user gave no owner but the conversation has one, inherit it:

- A file was opened / edited earlier this session → its owner is the active
  scope. "now change the frontend" means *that same product's* Frontend.
- The state file's `resume_point` names an owner → use it.
- The user is clearly mid-task on one product → stay there. Switching products
  silently is the worst failure mode; it edits the wrong app.

## Step 3 — Rank by objective signals (only if still tied)

When nothing above narrows it to one, score each candidate and present the top
ranked — but still confirm before writing. Score = sum of:

| Signal | Why it matters | Weight |
|--------|----------------|--------|
| Has a real entrypoint (`App.tsx`, `main.py`, `index.html`) | it's a live layer, not a stub | +3 |
| Framework manifest present (`package.json`, `vite.config`, `requirements.txt`) | it's actually built out | +2 |
| Recently modified (mtime within active window) | it's where work is happening | +2 |
| More files / larger | more likely the primary, not a placeholder | +1 |
| Marked primary in state/README | human already said so | +5 |
| Only `.gitkeep` / empty | it's a scaffold, deprioritise | −3 |

`resolve_scope.py` computes this and prints a ranked table. The highest score is
the *suggestion*, never an automatic write target when the margin is small.

## Step 4 — Decide: act, or ask ONE question

- **Clear winner** (one candidate, or a top score that beats the next by the
  configured margin, default ≥4 points) → proceed, and state which owner you
  picked: "Working on URGAA's Frontend (`04_PRODUCTS/PRD-URG-001.../Frontend`)."
  Announcing the pick lets the user catch a wrong guess immediately.
- **Close call** (top two within the margin) → ask exactly one question,
  listing the candidates by *owner*, not by raw path:
  "Which frontend — URGAA, GSTSAAS, or the Website?" One question, concrete
  options, then act. Never dump all paths and go silent.
- **Cross-cutting change** (the user wants ALL frontends, e.g. a global style
  token) → operate on every candidate, and say so: "Applying to all 7 product
  Frontends." Detect this from words like "all", "every", "across products",
  "platform-wide".

## Step 5 — Record the resolution

Write the chosen scope back into the state file so the next agent inherits it
instead of re-deriving:

```json
"active_scope": {
  "owner": "PRD-URG-001",
  "layer": "Frontend",
  "path": "04_PRODUCTS/PRD-URG-001_URGAA_Platform/Frontend",
  "resolved_by": "explicit owner name in user request",
  "resolved_at": "2026-09-08T11:00:00"
}
```

This is what makes a hand-off seamless: the *why* of the pick travels with the
project, so a different model doesn't re-litigate it.

## Worked examples

**One frontend, user says "fix the frontend"**
→ Step 0 finds one candidate → act. No question.

**Seven frontends (monorepo), user says "fix the URGAA frontend"**
→ Step 1 exact-owner match → `PRD-URG-001.../Frontend` → act, announce pick.

**Seven frontends, user says "fix the frontend" mid-task on GSTSAAS**
→ Step 1 empty, Step 2 inherits active owner GSTSAAS → act, announce pick.

**Seven frontends, cold start, user says "fix the frontend"**
→ Steps 1-2 empty, Step 3 ranks; if Website scores far above the rest (only one
with a built entrypoint) → suggest it and confirm. If two are close → Step 4
asks: "Which one — URGAA or GSTSAAS?"

**User says "bump the design token in every frontend"**
→ Step 4 cross-cutting branch → apply to all, report the list.

## The non-negotiable

Never silently write to a layer when more than one candidate exists and the
choice isn't clearly resolved. A wrong-scope edit is worse than a question. When
in doubt, one crisp question beats a confident mistake.
