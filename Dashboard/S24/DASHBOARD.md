# Dashboard — S24

Samsung S24 Ultra device-specific dashboard configuration.

## Structure

```
S24/
├── frontend/     S24-specific UI overrides (placeholder)
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
S24 → Firestore (eka-agent/devices/samsung-s24-ultra) → Dashboard/Current/backend/api/ → jaytipargal.tech
```

The S24 reports `lastSeen`, `staleAlert`, and `commandQueue` to Firestore.
These are consumed by the shared backend in `Dashboard/Current/backend/api/`.

## Related

- **Sandbox counterpart:** `Sandbox/S24/` — device agent, broker client, installer
- **Shared dashboard:** `Dashboard/Current/` — API endpoints, lib, UI
- **Device tools:** `Dashboard/S24/tools/` — freeze/unfreeze scripts
- **Shared tools:** `tools/freeze_device.py`, `tools/query_firestore.py`

## Subfolders

### `frontend/`
S24-specific UI overrides or custom dashboard views. Currently empty — the S24
uses the shared UI from `Dashboard/Current/frontend/`.

### `backend/`
S24-specific API endpoints or config. Currently empty — the S24 uses the shared
endpoints from `Dashboard/Current/backend/api/`.

### `others/`
S24-specific config files, env templates, or test fixtures. Currently empty.