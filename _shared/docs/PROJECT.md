# jpbir

Repository for the device dashboard, sandbox deploy kits, MCP tools, and training artifacts.

## Structure

| Location | Contents |
| --- | --- |
| `Dashboard/Current/` | Active Vercel dashboard: `api/`, `lib/`, `frontend/`, and tests |
| `Dashboard/S24/`, `Dashboard/Vivobook/` | Per-device dashboard context |
| `Sandbox/Configuration/` | Shared broker, Flask dashboard API, signer, and tests |
| `Sandbox/S24/`, `Sandbox/Vivobook/`, `Sandbox/Lenovo/` | Device installation kits |
| `Sandbox/S24/daemon/` | Daemon variants previously stored at the repository root |
| `Sandbox/S24/daemon/legacy/` | Earlier imported daemon variants, retained separately |
| `Sandbox/S24/DAEMON_ARCHITECTURE.md` | Existing S24 architecture notes |
| `tools/mcp/` | MCP servers and connection helpers |
| `tools/diagnostics/` | Device and command-queue inspection scripts |
| `tools/` | Corpus builders, scanners, validators, and `pipeline.ps1` |
| `training/` | Colab notebook and training dependencies |
| `eka-runner/`, `eka-runner-private/` | Existing device-agent submodules |
| `runs/` | Local training artifacts, excluded from Git |

## Files kept at the root

`.gitignore` and `.gitmodules` configure Git for the entire repository.
`pyproject.toml` configures Python test discovery. `CLAUDE.md` provides repository
agent guidance, and `PROJECT.md` is this overview. The existing `.claudesignore`
also remains at the root. Application code and project dependencies live with
their respective projects.

The former root `package.json` now belongs to `Sandbox/S24/daemon/`, where it
sets the module format for those scripts. The dashboard keeps its own package.

## Running checks

Install the sandbox test dependencies and dashboard Node dependencies first.
The local pipeline selects `venv/Scripts/python.exe` when available, otherwise
`python`. A different interpreter can be supplied with `-PythonPath`.

```powershell
.\tools\pipeline.ps1
```

The pipeline runs the sandbox tests, syntax-checks every tracked JavaScript
file, and runs the dashboard tests. It resolves paths from the repository
location, so it also works when called from another working directory.

Individual checks:

```powershell
python -m pytest Sandbox/Configuration/tests -q -o addopts=""
cd Dashboard/Current
npm ci
node others/test/stale.test.mjs
node others/test/broker.test.mjs
node others/test/connect.test.mjs
```

## Deployment

GitHub Actions validates pushes and pull requests to `main`. Vercel's Git
integration deploys the three projects:

| Vercel project | Source directory |
| --- | --- |
| `channel-sandbox` | `Sandbox/Configuration/` |
| `jpbir` | `Sandbox/Configuration/` |
| `jayti-dashboard` | `Dashboard/Current/` |

This layout change preserves those source directories and the existing device
installation kit. MCP registration commands now reference `tools/mcp/`.

## Training

See [training/README.md](training/README.md). The retained notebook depends on
`personal_folder_agent`, which is no longer included in this repository.
Training runs in Colab; moving the notebook does not restore that dependency.

## Data stores

- Neon Postgres: indexed web telemetry and dashboard analytics.
- Firestore: `eka-agent` for device heartbeats and queued commands.

## Dependency notes

**Unused packages (2026-09-10 audit):**
- `geoip-lite@2.0.3` - Installed but not imported anywhere in the codebase. IP geolocation is handled via Vercel edge headers (`x-vercel-ip-*`) in `Dashboard/Current/api/jp-track.js`.
- `ip-address@10.7.0` - Transitive dependency of `geoip-lite`, also unused.

Both packages are marked as `extraneous` by npm. Safe to remove when cleaning up dependencies. Backup exists at `C:\eka-agent-backups\bisug4g-migration-final\ip-address` (v10.3.1, outdated).
