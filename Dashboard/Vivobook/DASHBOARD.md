# Dashboard — VivoBook

ASUS VivoBook laptop device-specific dashboard configuration.

## Structure

```
Vivobook/
├── frontend/     VivoBook-specific UI overrides (placeholder)
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
VivoBook → Firestore (eka-agent/devices/jayti-asus-vivobook) → Dashboard/Current/backend/api/ → jaytipargal.tech
```

The VivoBook reports `lastSeen`, `staleAlert`, and `commandQueue` to Firestore.
These are consumed by the shared backend in `Dashboard/Current/backend/api/`.

## Related

- **Sandbox counterpart:** `Sandbox/Vivobook/` — device agent, broker client, installer
- **Shared dashboard:** `Dashboard/Current/` — API endpoints, lib, UI
- **Device tools:** `Dashboard/Vivobook/tools/` — freeze/unfreeze scripts
- **Shared tools:** `tools/freeze_device.py`, `tools/query_firestore.py`

## Subfolders

### `frontend/`
VivoBook-specific UI overrides or custom dashboard views. Currently empty — the
VivoBook uses the shared UI from `Dashboard/Current/frontend/`.

### `backend/`
VivoBook-specific API endpoints or config. Currently empty — the VivoBook uses
the shared endpoints from `Dashboard/Current/backend/api/`.

### `others/`
VivoBook-specific config files, env templates, or test fixtures. Currently empty.