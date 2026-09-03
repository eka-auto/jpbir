# 🚀 Channel Sandbox Deployment Verification Checklist

**Purpose**: Complete pre-deployment verification for AI agents to validate all components before Vercel deployment.

**Last Updated**: 2026-09-03  
**Project**: channel-sandbox  
**Repository**: https://github.com/jaytipargal/jpbir  
**Vercel Project**: jayti/channel-sandbox

---

## 📋 Pre-Deployment Verification Steps

### Step 1: Verify Repository Structure

```bash
cd C:\Users\abcom\jpbir
git status
git log -n 1
```

**Expected Results:**
- ✅ `channel-sandbox/` folder exists
- ✅ `vercel.json` exists at repo root
- ✅ `.gitignore` includes `!vercel.json` exception
- ✅ No uncommitted changes in channel-sandbox/
- ✅ Latest commit pushed to origin/main

**Critical Files to Verify:**
```
channel-sandbox/
├── dashboard_api.py          # Flask backend API
├── devices.json              # Device configuration
├── vercel.json               # Vercel build config
├── dashboard/
│   └── index.html            # Dashboard frontend
├── requirements.txt          # Python dependencies
└── pyproject.toml            # Python project config
```

---

### Step 2: Verify Vercel Configuration Files

#### 2.1 Root vercel.json (Repo Root)

**File**: `C:\Users\abcom\jpbir\vercel.json`

**Required Content:**
```json
{
  "version": 2,
  "builds": [
    { "src": "channel-sandbox/dashboard_api.py", "use": "@vercel/python" }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "channel-sandbox/dashboard_api.py"
    },
    {
      "src": "/(.*)",
      "dest": "channel-sandbox/dashboard/index.html"
    }
  ]
}
```

**Validation Checks:**
- ✅ `builds[0].src` points to `channel-sandbox/dashboard_api.py`
- ✅ `builds[0].use` is `@vercel/python`
- ✅ `routes[0].dest` points to `channel-sandbox/dashboard_api.py`
- ✅ `routes[1].dest` points to `channel-sandbox/dashboard/index.html`
- ✅ No `name` or `regions` fields (deprecated)

#### 2.2 Channel Sandbox vercel.json (Subdirectory)

**File**: `C:\Users\abcom\jpbir\channel-sandbox\vercel.json`

**Required Content:**
```json
{
  "version": 2,
  "builds": [
    { "src": "dashboard_api.py", "use": "@vercel/python" }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "dashboard_api.py"
    },
    {
      "src": "/(.*)",
      "dest": "dashboard/index.html"
    }
  ]
}
```

**Validation Checks:**
- ✅ Paths are relative to channel-sandbox/ directory
- ✅ Matches root vercel.json structure (without channel-sandbox/ prefix)

---

### Step 3: Verify Device Configuration

**File**: `C:\Users\abcom\jpbir\channel-sandbox\devices.json`

**Required Content:**
```json
{
  "project": "intrepid-stage-495117-q1",
  "mode": "real",
  "database": "eka-agent",
  "collection": "devices",
  "firestore_scope": "https://www.googleapis.com/auth/datastore",
  "heartbeat_interval_seconds": 15,
  "command_poll_interval_seconds": 15,
  "devices": [
    {
      "id": "samsung-s24-ultra",
      "display_name": "Samsung S24 Ultra",
      "role": "phone",
      "type": "android",
      "model": "SM-S928B"
    },
    {
      "id": "jayti-asus-vivobook",
      "display_name": "Asus VivoBook",
      "role": "laptop",
      "type": "windows",
      "model": "LENOVO"
    }
  ],
  "allowed_commands": [
    "sync-now", "heartbeat", "status-only", "wakeup",
    "collect-calls", "collect-sms", "collect-contacts",
    "collect-location", "collect-app-list", "collect-whatsapp",
    "full-sync", "extract_whatsapp", "debug-calllogs",
    "start-ssh", "start-daemon"
  ]
}
```

**Validation Checks:**
- ✅ `project` is `intrepid-stage-495117-q1` (canonical GCP project)
- ✅ `database` is `eka-agent` (not legacy databases)
- ✅ `mode` is `real` (not mock/simulation)
- ✅ Both devices present: `samsung-s24-ultra` and `jayti-asus-vivobook`
- ✅ `allowed_commands` matches s24_phone_direct_cloud.py allowlist

---

### Step 4: Verify Backend API (dashboard_api.py)

**File**: `C:\Users\abcom\jpbir\channel-sandbox\dashboard_api.py`

**Critical Components to Verify:**

#### 4.1 Environment Variable Loading
```python
# Must load these from Vercel environment:
SANDBOX_MODE = os.environ.get('SANDBOX_MODE', 'mock')
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
STATS_KEY = os.environ.get('STATS_KEY')
```

**Validation:**
- ✅ Reads `SANDBOX_MODE` (defaults to 'mock' for safety)
- ✅ Reads `FIREBASE_SERVICE_ACCOUNT_JSON` (required for real mode)
- ✅ Reads `STATS_KEY` (for API authentication)

#### 4.2 Firebase Initialization
```python
# Must initialize Firebase Admin SDK with service account
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(json.loads(FIREBASE_SERVICE_ACCOUNT_JSON))
firebase_admin.initialize_app(cred, {
    'databaseURL': f'https://{database}.default.firebaseio.com'
})
db = firestore.client()
```

**Validation:**
- ✅ Uses `firebase_admin` SDK
- ✅ Parses service account JSON from environment
- ✅ Connects to correct Firestore database

#### 4.3 API Endpoints
**Required Endpoints:**
- ✅ `GET /api/devices` - Returns device list with status
- ✅ `GET /api/devices/<device_id>/data` - Returns rolling data (last 50 records)
- ✅ `POST /api/devices/<device_id>/command` - Sends command to device
- ✅ `GET /api/health` - Health check endpoint

**Response Format Validation:**
```json
{
  "devices": [
    {
      "id": "samsung-s24-ultra",
      "display_name": "Samsung S24 Ultra",
      "online": true,
      "lastSeen": "2026-09-03T10:30:00Z",
      "battery": 85
    }
  ]
}
```

#### 4.4 Firestore Queries
**Required Queries:**
- ✅ Devices collection: `db.collection('devices').stream()`
- ✅ WhatsApp messages: `db.collection('whatsapp_messages').order_by('timestamp', desc).limit(50)`
- ✅ Call logs: `db.collection('call_logs').order_by('timestamp', desc).limit(50)`
- ✅ Contacts: `db.collection('contacts').limit(50)`

**Validation:**
- ✅ All queries use `.limit(50)` for rolling windows
- ✅ Proper ordering by timestamp (newest first)
- ✅ No unbounded queries

---

### Step 5: Verify Frontend Dashboard

**File**: `C:\Users\abcom\jpbir\channel-sandbox\dashboard\index.html`

**Critical Components:**

#### 5.1 Device Status Cards
**Required Elements:**
- ✅ Card for Samsung S24 Ultra (id: `device-s24`)
- ✅ Card for Asus VivoBook (id: `device-vivobook`)
- ✅ Online/Offline indicator (green/red dot)
- ✅ Last seen timestamp display
- ✅ Battery level indicator (S24 only)

#### 5.2 Rolling Data Windows
**Required Sections:**
- ✅ WhatsApp Messages (last 50)
- ✅ Call Logs (last 50)
- ✅ Contacts (last 50)

**Validation:**
- ✅ Each section has container with unique ID
- ✅ Auto-scrolls or paginates if >50 items
- ✅ Shows "No data" message when empty

#### 5.3 Device Controls
**Required Buttons:**
- ✅ Heartbeat button (calls `/api/devices/<id>/command` with `action: heartbeat`)
- ✅ Status Check button (calls `/api/devices/<id>/command` with `action: status-only`)

**Validation:**
- ✅ Buttons disabled when device offline
- ✅ Loading spinner during API call
- ✅ Success/error toast notifications

#### 5.4 Auto-Refresh
**Required Behavior:**
- ✅ Refreshes every 15 seconds
- ✅ Fetches device status
- ✅ Fetches rolling data
- ✅ Updates UI without page reload

**Validation:**
- ✅ Uses `setInterval` or similar
- ✅ Clears interval on page unload
- ✅ Error handling for failed requests

---

### Step 6: Verify Vercel Environment Variables

**Command to Check:**
```bash
cd C:\Users\abcom\jpbir\channel-sandbox
vercel env list
```

**Required Environment Variables:**

| Name | Type | Value | Required | Purpose |
|------|------|-------|----------|---------|
| `SANDBOX_MODE` | Secret | `real` | ✅ Required | Enables real Firestore mode |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Secret | Full JSON | ✅ Required | Firebase authentication |
| `STATS_KEY` | Secret | 32-char hex | ✅ Required | API authentication |
| `SANDBOX_CONFIG_JSON` | Secret | devices.json | Optional | Runtime device config |

**Validation Checks:**
- ✅ All 3 required variables exist
- ✅ Set to "Production" environment
- ✅ Marked as "Secret" (not plain text)
- ✅ `FIREBASE_SERVICE_ACCOUNT_JSON` contains valid service account JSON

**Service Account JSON Validation:**
```json
{
  "type": "service_account",
  "project_id": "intrepid-stage-495117-q1",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...@intrepid-stage-495117-q1.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

**Required Fields:**
- ✅ `type` = `service_account`
- ✅ `project_id` = `intrepid-stage-495117-q1`
- ✅ `private_key` starts with `-----BEGIN PRIVATE KEY-----`
- ✅ `client_email` ends with `@intrepid-stage-495117-q1.iam.gserviceaccount.com`

---

### Step 7: Verify Vercel Project Settings

**URL**: https://vercel.com/jayti/channel-sandbox/settings

#### 7.1 Root Directory Setting
**Current State**: MUST BE CLEARED (empty)

**Validation:**
- ✅ Root Directory field is EMPTY (not `channel-sandbox`)
- ✅ Reason: `vercel.json` at repo root handles path mapping

**If Root Directory is NOT empty:**
```
ACTION REQUIRED:
1. Click "Edit" next to Root Directory
2. Clear the value
3. Click "Save"
4. Redeploy
```

#### 7.2 Build Settings
**Framework Preset**: Should be `Other` or `Python`

**Validation:**
- ✅ No conflicting framework preset
- ✅ Build command: (empty - uses vercel.json)
- ✅ Output directory: (empty - uses vercel.json)
- ✅ Install command: (empty - uses requirements.txt)

#### 7.3 Git Integration
**Validation:**
- ✅ Connected to GitHub repository: `jaytipargal/jpbir`
- ✅ Branch: `main`
- ✅ Auto-deploy: Enabled

---

### Step 8: Verify GitHub Repository

**URL**: https://github.com/jaytipargal/jpbir

#### 8.1 Repository Structure
**Validation:**
```bash
git ls-files channel-sandbox/
```

**Required Files:**
- ✅ `channel-sandbox/dashboard_api.py`
- ✅ `channel-sandbox/dashboard/index.html`
- ✅ `channel-sandbox/devices.json`
- ✅ `channel-sandbox/vercel.json`
- ✅ `channel-sandbox/requirements.txt`
- ✅ `channel-sandbox/pyproject.toml`
- ✅ `vercel.json` (at repo root)

#### 8.2 Git Status
**Validation:**
```bash
git status
git log -n 1
```

**Expected:**
- ✅ Working tree clean (no uncommitted changes)
- ✅ Latest commit pushed to origin/main
- ✅ No large files (>100MB) in history

#### 8.3 GitHub Actions / Webhooks
**Validation:**
- ✅ Vercel webhook configured (automatic deployments)
- ✅ No failed CI/CD checks blocking deployment

---

### Step 9: Test Deployment Locally (Optional but Recommended)

**Command:**
```bash
cd C:\Users\abcom\jpbir\channel-sandbox
.\start_dashboard.bat
```

**Validation:**
- ✅ Server starts on port 5000
- ✅ Visit http://localhost:5000
- ✅ Dashboard loads without errors
- ✅ Device cards show correct names
- ✅ API endpoints respond (may show mock data if env vars not set)

**Test API Endpoints:**
```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/devices
```

---

### Step 10: Post-Deployment Verification

**Deployment URL**: https://channel-sandbox-kzfcpqe69-jayti.vercel.app

#### 10.1 Deployment Status
**Command:**
```bash
cd C:\Users\abcom\jpbir\channel-sandbox
vercel inspect https://channel-sandbox-kzfcpqe69-jayti.vercel.app
```

**Expected:**
- ✅ Status: `● Ready`
- ✅ Target: `Production`
- ✅ Builds: `dashboard_api.py` succeeded
- ✅ No errors in build logs

#### 10.2 Live Dashboard Test
**URL**: https://channel-sandbox-kzfcpqe69-jayti.vercel.app

**Validation:**
- ✅ Page loads (may require Vercel login if not public)
- ✅ Samsung S24 Ultra card visible
- ✅ Asus VivoBook card visible
- ✅ Rolling data sections present
- ✅ Control buttons (Heartbeat, Status) enabled

#### 10.3 API Endpoint Test
**Commands:**
```bash
curl -L https://channel-sandbox-kzfcpqe69-jayti.vercel.app/api/health
curl -L https://channel-sandbox-kzfcpqe69-jayti.vercel.app/api/devices
```

**Expected Responses:**
- ✅ `/api/health` returns `{"status": "ok"}` or similar
- ✅ `/api/devices` returns JSON array with 2 devices

#### 10.4 Environment Variable Verification
**Test:**
- ✅ Dashboard shows "Real Mode" or similar indicator
- ✅ Device status reflects actual Firestore data (not mock)
- ✅ Clicking "Heartbeat" sends command to Firestore

---

## 🚨 Common Issues & Fixes

### Issue 1: Build Fails - "Root Directory not found"
**Symptom**: Vercel build error: "The specified Root Directory 'channel-sandbox' does not exist"

**Fix:**
1. Go to Vercel Settings → General → Root Directory
2. Clear the value (make it empty)
3. Save changes
4. Redeploy

**Root Cause**: Having both Root Directory setting AND vercel.json at repo root creates conflict.

---

### Issue 2: 401 Unauthorized from API
**Symptom**: Dashboard shows "401 Unauthorized" or "Invalid STATS_KEY"

**Fix:**
1. Verify `STATS_KEY` environment variable exists in Vercel
2. Check dashboard_api.py validates against correct key
3. Redeploy after adding/updating variable

---

### Issue 3: Dashboard Shows "Offline" for All Devices
**Symptom**: Both devices show offline status

**Cause**: Device daemons not running

**Fix:**
1. S24: Run `s24_phone_direct_cloud.py` in Termux
2. VivoBook: Run device agent script
3. Wait 15-30 seconds for heartbeat
4. Refresh dashboard

---

### Issue 4: No Data in Rolling Windows
**Symptom**: WhatsApp/Calls/Contacts sections empty

**Cause**: No data in Firestore yet

**Fix:**
1. Click "Heartbeat" or "Status" from dashboard
2. Wait for device to execute command
3. Device writes data to Firestore
4. Refresh dashboard

---

### Issue 5: Environment Variables Not Applied
**Symptom**: Dashboard runs in mock mode despite env vars set

**Fix:**
1. Verify env vars are set to "Production" environment (not just Development)
2. Check vercel.json doesn't override environment variables
3. Redeploy after confirming env var settings

---

## ✅ Final Deployment Checklist

Before clicking "Deploy" in Vercel:

- [ ] **Repository**
  - [ ] All files committed to git
  - [ ] Latest commit pushed to origin/main
  - [ ] No uncommitted changes in channel-sandbox/
  - [ ] vercel.json exists at repo root

- [ ] **Configuration Files**
  - [ ] `vercel.json` paths correct (channel-sandbox/ prefix)
  - [ ] `devices.json` has correct database (eka-agent)
  - [ ] `dashboard_api.py` loads environment variables
  - [ ] `dashboard/index.html` has both device cards

- [ ] **Vercel Settings**
  - [ ] Root Directory is CLEARED (empty)
  - [ ] Environment variables configured (3 required)
  - [ ] Git integration enabled
  - [ ] Auto-deploy enabled

- [ ] **Environment Variables**
  - [ ] `SANDBOX_MODE` = `real`
  - [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` = valid JSON
  - [ ] `STATS_KEY` = 32-char hex string
  - [ ] All set to "Production" environment

- [ ] **Post-Deployment**
  - [ ] Deployment status is "Ready"
  - [ ] Dashboard loads in browser
  - [ ] Device cards visible
  - [ ] API endpoints respond
  - [ ] Heartbeat button works

---

## 📞 Support & References

**Documentation:**
- Vercel Python Runtime: https://vercel.com/docs/runtimes/python
- Firebase Admin SDK: https://firebase.google.com/docs/admin/setup
- Vercel Environment Variables: https://vercel.com/docs/environment-variables

**Project Links:**
- GitHub: https://github.com/jaytipargal/jpbir
- Vercel Dashboard: https://vercel.com/jayti/channel-sandbox
- Firestore Console: https://console.firebase.google.com/project/intrepid-stage-495117-q1/firestore

**Key Files:**
- `channel-sandbox/DEPLOYMENT_VERIFICATION_CHECKLIST.md` (this file)
- `channel-sandbox/VERCEL_FINAL_STEPS.md` (deployment guide)
- `channel-sandbox/DASHBOARD_READY.md` (architecture overview)

---

## 🤖 AI Agent Instructions

When verifying deployment, follow this exact sequence:

1. **Run Step 1** (Repository Structure) - MUST PASS
2. **Run Step 2** (Vercel Config) - MUST PASS
3. **Run Step 3** (Device Config) - MUST PASS
4. **Run Step 4** (Backend API) - MUST PASS
5. **Run Step 5** (Frontend) - MUST PASS
6. **Run Step 6** (Env Variables) - MUST PASS
7. **Run Step 7** (Vercel Settings) - MUST PASS
8. **Run Step 8** (GitHub) - MUST PASS
9. **Optional Step 9** (Local Test) - RECOMMENDED
10. **Run Step 10** (Post-Deployment) - REQUIRED AFTER DEPLOY

**If ANY step fails:**
- Stop deployment
- Fix the issue
- Re-run failed step
- Continue only when step passes

**If ALL steps pass:**
- Proceed with deployment
- Monitor build logs
- Verify post-deployment checks

---

**Status**: ✅ READY FOR VERIFICATION

Use this checklist to verify every aspect of the deployment before and after pushing to GitHub.
