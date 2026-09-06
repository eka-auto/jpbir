# Dashboard — VivoBook

ASUS VivoBook laptop device-specific dashboard configuration.

## Structure

```
Vivobook/
├── frontend/     VivoBook section source, published at /vivobook
├── backend/      VivoBook-specific API config (placeholder)
├── others/       VivoBook-specific config files (placeholder)
└── DASHBOARD.md  this file
```

## Device

| Field | Value |
|---|---|
| Device ID | `jayti-asus-vivobook` |
| Type | laptop |
| Role | secondary |
| Firestore doc | `devices/jayti-asus-vivobook` (eka-agent database) |

## Data flow

```
VivoBook → Firestore (eka-agent/devices/jayti-asus-vivobook) → Dashboard/Current/api/ → jaytipargal.tech
```

The VivoBook reports `lastSeen`, `staleAlert`, and `commandQueue` to Firestore.
These are consumed by the shared backend in `Dashboard/Current/api/`.

## Related

- **Sandbox counterpart:** `Sandbox/Vivobook/` — device agent, broker client, installer
- **Shared dashboard:** `Dashboard/Current/` — API endpoints, lib, UI
- **Device tools:** `Dashboard/Vivobook/tools/` — freeze/unfreeze scripts
- **Shared tools:** `tools/freeze_device.py`, `tools/query_firestore.py`

## Subfolders

### `frontend/`
`index.html` is the source for the `/vivobook` section. Edit this file directly.
Running `npm run build` in `Dashboard/Current/` copies it to `Current/dist/vivobook.html`
alongside the existing homepage and S24 section. The historical copy in
`Current/frontend/vivobook.html` is excluded from the build.

Place section assets under `frontend/vivobook/` and reference them at `/vivobook/...`
to avoid collisions with the other sections. See
[`Current/DASHBOARD.md`](../Current/DASHBOARD.md#frontend) for the shared build.

### `backend/`
VivoBook-specific API endpoints or config. Currently empty — the VivoBook uses
the shared endpoints from `Dashboard/Current/api/`.

### `others/`
VivoBook-specific config files, env templates, or test fixtures. Currently empty.
