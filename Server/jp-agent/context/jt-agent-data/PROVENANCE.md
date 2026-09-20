# jt-agent-data (config only)

Mirrored from the private HF dataset `go4garage01/jt-agent-data` on 2026-09-14.
These are the pipeline **specs** — how personal data should be keyed, routed,
retained and exposed to agent components. No personal data is here.

## Deliberately NOT mirrored

- `jtagent/jt-agent-data` (dataset **and** model repo, same name, different
  contents): raw Chrome profile trees — `Local Storage/leveldb`,
  `ClientCertificates`, `Code Cache`, `Crashpad` — plus `calendar/` and `audit/`.
- `jtagent/chrome-browser-data`: Chrome profile SQLite DBs, and **public** on the
  Hub as of this date.

This host runs arbitrary shell behind a single bearer token and is reachable from
the internet. Browser history, cookies and WhatsApp content do not belong on it
until the segregation described in `config/segregation/` actually exists as code.
`access-control.json` sets `default_deny: true` and `form_filling` is scoped to
`credentials`/`payment` fields — honor that design rather than rsyncing raw dumps.

## Upstream README

The dataset's own README is an unedited HuggingFace template — every field still
says "[More Information Needed]". The JSON under `config/` is the real artifact.

## What the agent can do with this today

Read it. It describes sources (chrome, whatsapp, desktop-windows, mobile-android),
per-source retention, argon2id key hierarchy (master -> source -> shard, 90-day
rotation), and which agent components may touch which source. None of the
`data/` or `indexes/` paths it references exist yet — this is the design, not the
store.
