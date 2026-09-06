# Dashboard — S24

Samsung S24 Ultra device-specific dashboard configuration.

## Structure

```
S24/
├── frontend/     S24 section source, published at /s24
├── backend/      S24-specific API config (placeholder)
├── others/       S24-specific config files (placeholder)
└── DASHBOARD.md  this file
```

## Device

| Field | Value |
|---|---|
| Device ID | `samsung-s24-ultra` |
| Type | phone |
| Role | primary |
| Firestore doc | `devices/samsung-s24-ultra` (eka-agent database) |

## Data flow

```
S24 → Firestore (eka-agent/devices/samsung-s24-ultra) → Dashboard/Current/api/ → jaytipargal.tech
```

The S24 reports `lastSeen`, `staleAlert`, and `commandQueue` to Firestore.
These are consumed by the shared backend in `Dashboard/Current/api/`.

## Related

- **Sandbox counterpart:** `Sandbox/S24/` — device agent, broker client, installer
- **Shared dashboard:** `Dashboard/Current/` — API endpoints, lib, UI
- **Device tools:** `Dashboard/S24/tools/` — freeze/unfreeze scripts
- **Shared tools:** `tools/freeze_device.py`, `tools/query_firestore.py`

## Subfolders

### `frontend/`
`index.html` is the source for the `/s24` section. Edit this file directly.
Running `npm run build` in `Dashboard/Current/` copies it to `Current/dist/s24.html`
alongside the existing homepage and VivoBook section. The historical copy in
`Current/frontend/s24.html` is excluded from the build.

Place section assets under `frontend/s24/` and reference them at `/s24/...`
to avoid collisions with the other sections. See
[`Current/DASHBOARD.md`](../Current/DASHBOARD.md#frontend) for the shared build.

### `backend/`
S24-specific API endpoints or config. Currently empty — the S24 uses the shared
endpoints from `Dashboard/Current/api/`.

### `others/`
S24-specific config files, env templates, or test fixtures. Currently empty.
