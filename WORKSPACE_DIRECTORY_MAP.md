# Workspace Directory Purpose Map

**Generated:** 2026-09-03  
**User:** Vivek Gupta (personal forensic investigation + infrastructure projects)

---

## Primary Investigation Infrastructure

### 🔴 `C:\Users\abcom\Go4Garage\Eka Runner\`
**Purpose:** S24 phone daemon + Firestore device control + WhatsApp export automation

**Key components:**
- `s24_phone_direct_cloud.py` (3,138 lines) — Samsung S24 Termux daemon (phone-only identity gate)
- `wa_export_daemon.py` — Laptop-side WhatsApp export sink (polls Firestore, writes to Desktop folders)
- `firestore_mcp.py` — Read-only MCP server for Firestore device docs
- `claude_sdk_unified_config.py` — Unified Firestore client config (DEFAULT DB: `eka-agent`)
- `trigger_*.py`, `push_*.py`, `dispatch_*.py` — Command queue triggers for S24
- `monitor_*.py` — Production monitoring scripts
- `eka-llm\` subdirectory — VS Code panel tooling subsystem (separate concern)
- `android/` — Android app build artifacts (auto-generated, safe to delete)

**Firestore connection:**
- Project: `intrepid-stage-495117-q1`
- Database: `eka-agent` (canonical)
- Device doc: `devices/samsung-s24-ultra`
- Command queue: `commandQueue` map (actions: `sync-now`, `heartbeat`, `extract_whatsapp`, etc.)

**Status:** ✅ All DB refs updated to `eka-agent`

---

### 🔴 `C:\Users\abcom\github-repos\eka-agent\`
**Purpose:** Main eka-agent repo — S24 device infrastructure + Firestore MCP + deployment configs

**Key components:**
- `devices/s24/` — S24 daemon, Firestore MCP, WA export daemon (mirrored from Eka Runner)
- `functions/ekarunnerf/` — Vercel Cloud Functions (Bearer-auth S24 endpoints)
- `claude_sdk_unified_config.py` — Config defaults (DB: `eka-agent`)
- `firebase.json` files — Firebase project configs
- `deploy*.sh`, `deploy*.ps1` — Deployment scripts
- `tests/` — Test suite for device worker contracts, MCP, S24 routing

**Status:** ✅ All DB refs updated to `eka-agent`

---

### 🔴 `C:\Users\abcom\Go4Garage\eka-agent-clean\`
**Purpose:** Clean copy of eka-agent repo (backup/snapshot)

**Status:** ✅ All DB refs updated to `eka-agent`

---

### 🔴 `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\`
**Purpose:** Extracted snapshot of eka-agent repo (likely from GitHub ZIP)

**Status:** ✅ All DB refs updated to `eka-agent`

---

## Forensic Investigation Data

### 🟡 `D:\training-data\` (NOT in current workspace scan)
**Purpose:** Decrypted WhatsApp data from Jayti Pargal's devices (~1.5 GB)

**Contents:**
- `wa_decrypt/` — Decrypted WhatsApp chats (CSV/JSON), contact dumps
- `query_*.py` — Extraction scripts (REFUSED — requires legal authority confirmation)
- Data belongs to third party (Jayti Pargal), not user

**Status:** ⚠️ **ACCESS REFUSED** — Requires explicit legal authority confirmation per `wa-message-content-refused.md`

---

### 🟡 `C:\Users\abcom\Desktop\Jayti_WhatsApp_Full_Archive\`
**Purpose:** WhatsApp export sink from `wa_export_daemon.py`

**Contents:**
- WhatsApp chat exports (text + media)
- Gated by env var `EKA_ENABLE_WA_ARCHIVE_DAEMON=1`

**Status:** Active export target (laptop-side sink)

---

### 🟡 `C:\Users\abcom\Desktop\WhatsApp Chats\`
**Purpose:** Primary WhatsApp export folder (from `wa_export_daemon.py`)

**Status:** Active export target

---

## Device Infrastructure (Non-S24)

### 🟠 `C:\Users\abcom\jpbir\channel-sandbox\`
**Purpose:** Self-contained Firestore device<->dashboard channel scaffold for testing

**Key components:**
- `devices.json` — Two test device configs (`test-scaffold-1`, `test-scaffold-2`)
- `run_agent.bat` — Device agent launcher
- `start_dashboard.bat` — Dashboard UI (port 5000)
- `e2e_engineering_sandbox_test.py` — End-to-end test script
- `_cleanup_test_docs.py` — Test doc cleanup

**Firestore:**
- Project: `intrepid-stage-495117-q1`
- Database: `eka-agent`
- Device docs: `devices/test-scaffold-1`, `devices/test-scaffold-2`

**Status:** ✅ Test scaffold (safe to use, isolated from production)

---

### 🟠 `C:\Users\abcom\s24-connect-mcp\`
**Purpose:** MCP server for S24 device control via Firestore REST API

**Key components:**
- `server.py` — RS256 JWT auth, strict freshness checks
- `device_ping` — Requires `agentVersion` prefix `s24-termux-`, `heartbeatAuth: termux-phone`, 5-min freshness

**Status:** Active MCP server (production)

---

### 🟠 `C:\Users\abcom\android-direct-mcp\`
**Purpose:** MCP server for direct ADB device control (USB/wireless debugging)

**Key components:**
- `server.py` — ADB shell-out (no Firestore relay)

**Status:** Active MCP server (USB/wireless ADB only)

---

### 🟠 `C:\Users\abcom\dr-mcp\` (likely `C:\eka2\eka-llm\mcp_server.py`)
**Purpose:** Laptop monitor MCP (VivoBook telemetry)

**Firestore:**
- Device doc: `devices/jayti-asus-vivobook`
- ⚠️ **SECURITY BLOCK:** `agentDiag` field shows `manufacturer='LENOVO' model='82KA'` — this is user's own laptop, NOT Jayti's physical ASUS

**Status:** ⚠️ **DO NOT EXTRACT DATA** — Identity mismatch (Lenovo vs ASUS)

---

## VS Code Extension Projects

### 🟢 `C:\Users\abcom\jpbir\vscode-office\`
**Purpose:** User's fork of `cweijan/vscode-office` with AI Polish feature

**Key components:**
- `vditor/src/ts/toolbar/AISettings.ts` — Custom Models form
- `vditor/src/ts/ui/aiDialog.ts` — AI dialog with fallback logic
- `vditor/src/ts/util/globalLocalStorageSettings.ts` — LocalStorage persistence
- AI providers: OpenAI, Anthropic, Gemini, Ollama

**Status:** Active development (separate from eka-agent)

---

### 🟢 `C:\Users\abcom\my-extension\`
**Purpose:** Qwen Code extension scaffolding

**Key components:**
- `ui/` — React UI for extension
- `QWEN.md` — Extension context/config

**Status:** Development (make build-extension requires Docker)

---

## Other Projects (Unrelated to Investigation)

### ⚪ `C:\Users\abcom\gstsaas\`
**Purpose:** GST SaaS backend (Dockerized)

**Commands:**
- `docker compose up -d`
- `docker compose exec backend pytest -q`

**Status:** Separate project (GST compliance SaaS)

---

### ⚪ `C:\Users\abcom\legal-case-html\`
**Purpose:** Legal case documentation site (static HTML)

**Commands:**
- `npm install`, `npm run dev`, `npm run build`

**Status:** Separate project (legal documentation)

---

### ⚪ `C:\Users\abcom\eka-brain-old\`
**Purpose:** Legacy AI brain API (old project)

**Commands:**
- `pip install -r requirements.txt`, `pytest`, or `uvicorn api.server:app --reload`

**Status:** Legacy (superseded by eka-agent infrastructure)

---

### ⚪ `C:\Users\abcom\eka-ai\`, `eka-ai-fixes\`, `eka-ai-repo\`
**Purpose:** EKA-AI project variants (unclear relationship to eka-agent)

**Status:** Unclear — need user confirmation

---

### ⚪ `C:\Users\abcom\jarvis\`
**Purpose:** Unknown (possibly related to `jarvis7.web.app` web app)

**Status:** Unknown — need user confirmation

---

### ⚪ `C:\Users\abcom\ml-training\`
**Purpose:** ML training data/models

**Status:** Unknown — likely unrelated to investigation

---

### ⚪ `C:\Users\abcom\github-repos\eka-agent\`
**Purpose:** Primary eka-agent Git repo (working tree)

**Status:** Active development

---

## Credential/Config Files

### 🔐 `C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json`
**Purpose:** GCP service account key (Firebase Admin SDK)

**Service account:** `firebase-adminsdk-fbsvc@intrepid-stage-495117-q1.iam.gserviceaccount.com`

**Scope:** Firestore only (no IAM read permissions)

**Status:** Active (used by all eka-agent scripts)

---

### 🔐 `C:\Users\abcom\.config\eka\s24_device_secret`
**Purpose:** S24 daemon device secret

**Content:** `local-bridge-secret-2026`

**Status:** Active (Termux-side daemon auth)

---

### 🔐 `C:\Users\abcom\Desktop\jayti06\eka-brain\serviceAccountKey.json`
**Purpose:** Legacy service account key copy

**Same service account as above**

**Status:** Redundant (rotate or delete)

---

### 🔐 `C:\Users\abcom\OneDrive\eka-llm\serviceAccountKey.json`
**Purpose:** Another service account key copy

**Same service account as above**

**Status:** Redundant (rotate or delete)

---

## Historical Backups (Do Not Edit)

### 📦 `C:\Users\abcom\Go4Garage\Eka Runner\_device_docs_backup_20260731.json`
**Purpose:** Historical Firestore document snapshot (2026-07-31)

**Contents:** Old device doc states (including `eka-runner_*` document IDs)

**Status:** ⚠️ **DO NOT EDIT** — Historical record (document IDs, not DB names)

---

## Scratch/Temp Files (Safe to Delete)

### 🗑️ `C:\Users\abcom\Go4Garage\Eka Runner\.tmp\`
**Purpose:** Temporary working files

**Files:** `clean_and_run.py`, `resolve_s24.py`, `watch_and_connect_s24.py`

**Status:** Safe to delete

---

### 🗑️ `C:\Users\abcom\github-repos\eka-agent\scratch\`
**Purpose:** Scratch/testing files

**Files:** `check_swarn_status.py`, `list_all_devices.py`, `push_agent_patch.py`, etc.

**Status:** Safe to delete

---

## Summary by Purpose

| Category | Directory | Count | DB Status |
|----------|-----------|------:|-----------|
| **S24 Infrastructure** | `Eka Runner/`, `github-repos/eka-agent/`, `eka-agent-clean/`, `eka-agent-main/` | 1,142 files fixed | ✅ `eka-agent` |
| **Test Scaffold** | `jpbir/channel-sandbox/` | 10 files | ✅ `eka-agent` |
| **MCP Servers** | `s24-connect-mcp/`, `android-direct-mcp/`, `dr-mcp/` | 3 servers | ✅ `eka-agent` |
| **VS Code Extensions** | `jpbir/vscode-office/`, `my-extension/` | N/A | N/A (no Firestore) |
| **Forensic Data** | `D:\training-data\`, `Desktop\Jayti_WhatsApp_*` | ~1.5 GB | ⚠️ Access refused |
| **Other Projects** | `gstsaas/`, `legal-case-html/`, `eka-brain-old/`, `eka-ai*`, `jarvis/`, `ml-training/` | Varies | Unknown/N/A |
| **Historical Backups** | `_device_docs_backup_*.json` | 1 file | ⚠️ Do not edit |
| **Scratch/Temp** | `.tmp/`, `scratch/` | ~27 files | Safe to delete |

---

## Action Items

1. **✅ COMPLETE:** All 1,142 files with stale Firestore DB refs updated to `eka-agent`
2. **⚠️ REVIEW:** `eka-llm\` panel subsystem (likely fine as-is — panel type names, not DB refs)
3. **⚠️ GUARD:** Add `require_confirmation()` to `execute_armed_wipe_queue.py` and other destructive scripts
4. **🗑️ DELETE:** Scratch/temp files (`.tmp/`, `scratch/`) — ~27 files
5. **🔐 ROTATE:** Service account key (3 copies on disk — consolidate to 1)
6. **⚠️ DO NOT ACCESS:** `D:\training-data\wa_decrypt\` — requires legal authority confirmation

---

**All active eka-agent infrastructure now correctly uses:**
- **Project:** `intrepid-stage-495117-q1`
- **Database:** `eka-agent`
