# 📦 Channel Sandbox - Complete Deployment Package

**Generated**: 2026-09-03  
**Status**: ✅ Ready for Deployment  
**Repository**: https://github.com/jaytipargal/jpbir  
**Vercel Project**: https://vercel.com/jayti/channel-sandbox

---

## 🎯 Executive Summary

This document provides complete information about the channel-sandbox deployment for AI agents to verify every component before and after deployment.

### What is Channel Sandbox?

A real-time dashboard that displays device status and rolling data windows for:
- 📱 **Samsung S24 Ultra** (phone daemon via Firestore)
- 💻 **Asus VivoBook** (laptop agent via Firestore)

**Key Features:**
- Live device status (online/offline, battery, last seen)
- Rolling data windows (last 50 records only - no accumulation)
- Device control commands (heartbeat, status check)
- Auto-refresh every 15 seconds

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Repository: jaytipargal/jpbir                       │
│  Branch: main                                               │
│  Latest Commit: 1f80219                                     │
└────────────────────┬────────────────────────────────────────┘
                     │ git push
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  Vercel Auto-Deploy                                         │
│  - Detects GitHub push                                      │
│  - Builds Python function (dashboard_api.py)                │
│  - Deploys to Production                                    │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS REST API
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  Google Cloud Firestore                                     │
│  Project: intrepid-stage-495117-q1                          │
│  Database: eka-agent                                        │
│  Collection: devices                                        │
│  - Document: samsung-s24-ultra                              │
│  - Document: jayti-asus-vivobook                            │
└────────────────────┬────────────────────────────────────────┘
                     │ Firestore polling (15s)
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  Device Daemons                                             │
│  - S24: s24_phone_direct_cloud.py (Termux)                  │
│  - VivoBook: device_agent.py (Windows)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Complete File Inventory

### Repository Root (`C:\Users\abcom\jpbir\`)

| File | Purpose | Critical? |
|------|---------|-----------|
| `vercel.json` | Vercel deployment config (points to channel-sandbox/) | ✅ YES |
| `.gitignore` | Git ignore rules (includes `!vercel.json` exception) | ✅ YES |
| `DEPLOYMENT_VERIFICATION_CHECKLIST.md` | Pre-deployment verification guide | ✅ YES |
| `DASHBOARD_READY.md` | Architecture overview | Reference |

### Channel Sandbox Directory (`C:\Users\abcom\jpbir\channel-sandbox\`)

#### Core Application Files

| File | Purpose | Critical? |
|------|---------|-----------|
| `dashboard_api.py` | Flask backend API (Firestore queries, command routing) | ✅ YES |
| `devices.json` | Device configuration (eka-agent database, 2 devices) | ✅ YES |
| `vercel.json` | Vercel build configuration | ✅ YES |
| `dashboard/index.html` | Frontend dashboard UI | ✅ YES |
| `requirements.txt` | Python dependencies | ✅ YES |
| `pyproject.toml` | Python project config (Python 3.12) | ✅ YES |

#### Supporting Files

| File | Purpose |
|------|---------|
| `firestore_client.py` | Firestore client utility |
| `broker_client.py` | Message broker client |
| `device_agent.py` | Device agent implementation |
| `signer.py` | Request signing utility |
| `single_instance.py` | Single instance enforcement |
| `run_agent.bat` | Windows batch launcher |
| `start_dashboard.bat` | Dashboard launcher |

#### Deployment Documentation

| File | Purpose |
|------|---------|
| `DEPLOYMENT_VERIFICATION_CHECKLIST.md` | Pre-deployment checklist |
| `VERCEL_FINAL_STEPS.md` | Vercel configuration guide |
| `VERCEL_DEPLOYMENT.md` | Deployment instructions |
| `README.md` | Project overview |

#### Test Files

| File | Purpose |
|------|---------|
| `tests/test_sandbox.py` | Sandbox tests |
| `tests/test_broker_client.py` | Broker client tests |
| `tests/test_deploy_kits.py` | Deployment kit tests |
| `e2e_engineering_sandbox_test.py` | E2E tests |

#### Deploy Kits

| Directory | Purpose |
|-----------|---------|
| `deploy/s24/` | S24 deployment scripts |
| `deploy/vivobook/` | VivoBook deployment scripts |
| `deploy/lenovo/` | Lenovo deployment scripts |

---

## 🔧 Configuration Details

### 1. Vercel Configuration (Root)

**File**: `vercel.json`

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

**Key Points:**
- `version: 2` - Vercel config version
- `builds[0].src` - Must match `channel-sandbox/dashboard_api.py`
- `builds[0].use` - Python runtime
- `routes` - API routes to Python, static to HTML

---

### 2. Device Configuration

**File**: `channel-sandbox/devices.json`

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
    "sync-now",
    "heartbeat",
    "status-only",
    "wakeup",
    "collect-calls",
    "collect-sms",
    "collect-contacts",
    "collect-location",
    "collect-app-list",
    "collect-whatsapp",
    "full-sync",
    "extract_whatsapp",
    "debug-calllogs",
    "start-ssh",
    "start-daemon"
  ]
}
```

**Key Fields:**
- `project`: GCP project ID
- `database`: Firestore database name
- `mode`: `real` (not mock)
- `devices`: Array of device definitions
- `allowed_commands`: Whitelist for commandQueue

---

### 3. Backend API (dashboard_api.py)

**Critical Components:**

#### Environment Variables
```python
SANDBOX_MODE = os.environ.get('SANDBOX_MODE', 'mock')
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
STATS_KEY = os.environ.get('STATS_KEY')
```

#### Firebase Initialization
```python
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate(json.loads(FIREBASE_SERVICE_ACCOUNT_JSON))
firebase_admin.initialize_app(cred)
db = firestore.client()
```

#### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/devices` | GET | List all devices with status |
| `/api/devices/<id>` | GET | Get single device status |
| `/api/devices/<id>/data` | GET | Get rolling data (50 records) |
| `/api/devices/<id>/command` | POST | Send command to device |

#### Firestore Queries

```python
# Get devices
devices_ref = db.collection('devices')
docs = devices_ref.stream()

# Get WhatsApp messages (last 50)
whatsapp_ref = db.collection('whatsapp_messages')
whatsapp_ref.order_by('timestamp', firestore.Query.Direction.DESCENDING).limit(50)

# Get call logs (last 50)
calls_ref = db.collection('call_logs')
calls_ref.order_by('timestamp', firestore.Query.Direction.DESCENDING).limit(50)

# Get contacts (last 50)
contacts_ref = db.collection('contacts')
contacts_ref.limit(50)
```

---

### 4. Frontend Dashboard (dashboard/index.html)

**Key Sections:**

#### Device Status Cards
```html
<!-- Samsung S24 Ultra -->
<div id="device-s24" class="device-card">
  <h3>Samsung S24 Ultra</h3>
  <div class="status-indicator online"></div>
  <div class="battery-level">85%</div>
  <div class="last-seen">2026-09-03T10:30:00Z</div>
  <button onclick="sendCommand('heartbeat')">Heartbeat</button>
  <button onclick="sendCommand('status-only')">Status Check</button>
</div>

<!-- Asus VivoBook -->
<div id="device-vivobook" class="device-card">
  <h3>Asus VivoBook</h3>
  <div class="status-indicator offline"></div>
  <div class="last-seen">2026-09-03T09:15:00Z</div>
  <button onclick="sendCommand('heartbeat')">Heartbeat</button>
  <button onclick="sendCommand('status-only')">Status Check</button>
</div>
```

#### Rolling Data Windows
```html
<!-- WhatsApp Messages -->
<section id="whatsapp-data">
  <h3>WhatsApp Messages (Last 50)</h3>
  <div id="whatsapp-container" class="data-container"></div>
</section>

<!-- Call Logs -->
<section id="calls-data">
  <h3>Call Logs (Last 50)</h3>
  <div id="calls-container" class="data-container"></div>
</section>

<!-- Contacts -->
<section id="contacts-data">
  <h3>Contacts (Last 50)</h3>
  <div id="contacts-container" class="data-container"></div>
</section>
```

#### JavaScript Functions
```javascript
// Fetch device status
async function fetchDevices() {
  const response = await fetch('/api/devices');
  const data = await response.json();
  updateDeviceCards(data.devices);
}

// Send command to device
async function sendCommand(deviceId, action) {
  const response = await fetch(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
  return await response.json();
}

// Auto-refresh (every 15 seconds)
setInterval(fetchDevices, 15000);
```

---

## 🔐 Environment Variables

### Required Variables (Vercel Dashboard)

**URL**: https://vercel.com/jayti/channel-sandbox/settings/environment-variables

| Variable | Value | Type | Environment | Purpose |
|----------|-------|------|-------------|---------|
| `SANDBOX_MODE` | `real` | Secret | Production | Enable real Firestore mode |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | (full JSON) | Secret | Production | Firebase auth |
| `STATS_KEY` | (32-char hex) | Secret | Production | API authentication |

### Service Account JSON Structure

```json
{
  "type": "service_account",
  "project_id": "intrepid-stage-495117-q1",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@intrepid-stage-495117-q1.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

**Validation Checklist:**
- ✅ `type` = `service_account`
- ✅ `project_id` = `intrepid-stage-495117-q1`
- ✅ `private_key` starts with `-----BEGIN PRIVATE KEY-----`
- ✅ `client_email` ends with `@intrepid-stage-495117-q1.iam.gserviceaccount.com`

**Source**: `C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json`

---

## 🚀 Deployment Procedure

### Step 1: Pre-Deployment Verification

Run the complete checklist from `DEPLOYMENT_VERIFICATION_CHECKLIST.md`:

```bash
cd C:\Users\abcom\jpbir

# Check git status
git status
git log -n 1

# Verify files exist
Test-Path vercel.json
Test-Path channel-sandbox\dashboard_api.py
Test-Path channel-sandbox\devices.json
Test-Path channel-sandbox\dashboard\index.html

# Verify file contents (critical fields)
Get-Content vercel.json | ConvertFrom-Json
Get-Content channel-sandbox\devices.json | ConvertFrom-Json
```

**Expected Results:**
- ✅ Working tree clean
- ✅ All critical files present
- ✅ vercel.json paths correct
- ✅ devices.json has correct database

---

### Step 2: Commit and Push

```bash
cd C:\Users\abcom\jpbir

# Stage changes
git add vercel.json
git add channel-sandbox/DEPLOYMENT_VERIFICATION_CHECKLIST.md
git add channel-sandbox/devices.json
git add channel-sandbox\dashboard_api.py

# Commit
git commit -m "feat: configure channel-sandbox for S24 + VivoBook dashboard"

# Push
git push origin main
```

**Vercel Auto-Deploy:**
- Vercel detects GitHub push
- Build starts automatically (~30 seconds)
- Deployment completes (~2 minutes)

---

### Step 3: Vercel Configuration (One-Time Setup)

**URL**: https://vercel.com/jayti/channel-sandbox/settings

#### 3.1 Clear Root Directory

1. Go to **Settings → General → Root Directory**
2. Click **"Edit"**
3. **Clear the value** (make it empty)
4. Click **"Save"**

**Why**: `vercel.json` at repo root handles path mapping. Having both creates conflict.

#### 3.2 Verify Environment Variables

1. Go to **Settings → Environment Variables**
2. Verify all 3 variables exist:
   - `SANDBOX_MODE` = `real`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = full JSON
   - `STATS_KEY` = 32-char hex
3. All set to **Production** environment

#### 3.3 Redeploy

1. Go to **Deployments** tab
2. Click latest deployment
3. Click **"Redeploy"** (three dots menu)
4. Wait for build (~2 minutes)

---

### Step 4: Post-Deployment Verification

#### 4.1 Check Deployment Status

```bash
cd C:\Users\abcom\jpbir\channel-sandbox
vercel inspect https://channel-sandbox-kzfcpqe69-jayti.vercel.app
```

**Expected Output:**
```
General
  id          dpl_...
  name        channel-sandbox
  target      production
  status      ● Ready
  url         https://channel-sandbox-kzfcpqe69-jayti.vercel.app

Builds
  └── λ dashboard_api.py (15.24MB) [iad1]
```

#### 4.2 Test Dashboard

**URL**: https://channel-sandbox-kzfcpqe69-jayti.vercel.app

**Checklist:**
- ✅ Page loads (may require Vercel login)
- ✅ Samsung S24 Ultra card visible
- ✅ Asus VivoBook card visible
- ✅ Rolling data sections present
- ✅ Control buttons enabled

#### 4.3 Test API Endpoints

```bash
curl -L https://channel-sandbox-kzfcpqe69-jayti.vercel.app/api/health
curl -L https://channel-sandbox-kzfcpqe69-jayti.vercel.app/api/devices
```

**Expected Responses:**
```json
// /api/health
{"status": "ok"}

// /api/devices
{
  "devices": [
    {
      "id": "samsung-s24-ultra",
      "display_name": "Samsung S24 Ultra",
      "online": true,
      "lastSeen": "2026-09-03T10:30:00Z",
      "battery": 85
    },
    {
      "id": "jayti-asus-vivobook",
      "display_name": "Asus VivoBook",
      "online": false,
      "lastSeen": "2026-09-03T09:15:00Z"
    }
  ]
}
```

---

## 🔍 Troubleshooting Guide

### Issue: Build Fails - "Root Directory not found"

**Error Message:**
```
Error: The specified Root Directory 'channel-sandbox' does not exist.
```

**Root Cause:**
Vercel's Root Directory setting conflicts with `vercel.json` at repo root.

**Fix:**
1. Go to https://vercel.com/jayti/channel-sandbox/settings
2. **General → Root Directory → Edit → Clear value**
3. Save
4. Redeploy

---

### Issue: 401 Unauthorized

**Error Message:**
```
401 Unauthorized
Invalid STATS_KEY
```

**Root Cause:**
Missing or incorrect `STATS_KEY` environment variable.

**Fix:**
1. Go to Vercel Settings → Environment Variables
2. Verify `STATS_KEY` exists
3. Generate new key if needed: `openssl rand -hex 16`
4. Update variable
5. Redeploy

---

### Issue: Devices Show "Offline"

**Symptom:**
Both devices show offline status.

**Root Cause:**
Device daemons not running.

**Fix:**
1. **S24**: Run `s24_phone_direct_cloud.py` in Termux
   ```bash
   cd C:\Users\abcom\Go4Garage\Eka Runner
   python s24_phone_direct_cloud.py
   ```
2. **VivoBook**: Run device agent
   ```powershell
   cd C:\Users\abcom\jpbir\channel-sandbox\deploy\vivobook
   .\run_vivobook.bat
   ```
3. Wait 15-30 seconds
4. Refresh dashboard

---

### Issue: No Data in Rolling Windows

**Symptom:**
WhatsApp/Calls/Contacts sections empty.

**Root Cause:**
No data in Firestore yet.

**Fix:**
1. Click "Heartbeat" from dashboard
2. Wait for device to execute command
3. Device writes data to Firestore
4. Refresh dashboard

---

### Issue: Environment Variables Not Applied

**Symptom:**
Dashboard runs in mock mode despite env vars set.

**Root Cause:**
Environment variables set to wrong environment (Development instead of Production).

**Fix:**
1. Go to Vercel Settings → Environment Variables
2. Verify variables set to **Production** (not just Development)
3. Redeploy

---

## 📊 Monitoring & Maintenance

### Deployment URLs

| Environment | URL | Status |
|-------------|-----|--------|
| Production | https://channel-sandbox-kzfcpqe69-jayti.vercel.app | ✅ Ready |
| Production (Alias) | https://channel-sandbox-one.vercel.app | ✅ Ready |
| Production (Alias) | https://channel-sandbox-jayti.vercel.app | ✅ Ready |
| Git Branch | https://channel-sandbox-git-main-jayti.vercel.app | ✅ Ready |

### Vercel Dashboard

**URL**: https://vercel.com/jayti/channel-sandbox

**Monitor:**
- Deployment status
- Build logs
- Function invocations
- Error rates

### Firestore Console

**URL**: https://console.firebase.google.com/project/intrepid-stage-495117-q1/firestore

**Collections to Monitor:**
- `devices` - Device status documents
- `whatsapp_messages` - WhatsApp message data
- `call_logs` - Call log data
- `contacts` - Contact data

### Device Health Checks

**Daily Checks:**
1. Dashboard loads without errors
2. S24 shows online (if daemon running)
3. VivoBook shows online (if agent running)
4. Rolling data windows populate
5. Heartbeat commands succeed

**Weekly Checks:**
1. Review Vercel function logs
2. Check Firestore document sizes
3. Verify device daemons running
4. Test all API endpoints

---

## 📞 Support Resources

### Documentation Links

- Vercel Python Runtime: https://vercel.com/docs/runtimes/python
- Firebase Admin SDK: https://firebase.google.com/docs/admin/setup
- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Vercel Deployment Configuration: https://vercel.com/docs/vercel-json

### Project Links

- GitHub Repository: https://github.com/jaytipargal/jpbir
- Vercel Dashboard: https://vercel.com/jayti/channel-sandbox
- Firestore Console: https://console.firebase.google.com/project/intrepid-stage-495117-q1/firestore

### Key Files

- `channel-sandbox/DEPLOYMENT_VERIFICATION_CHECKLIST.md` - Pre-deployment checklist
- `channel-sandbox/VERCEL_FINAL_STEPS.md` - Deployment guide
- `channel-sandbox/DASHBOARD_READY.md` - Architecture overview
- `channel-sandbox/dashboard_api.py` - Backend API
- `channel-sandbox/devices.json` - Device configuration

---

## ✅ Final Checklist

**Before Deployment:**
- [ ] All files committed to git
- [ ] Latest commit pushed to origin/main
- [ ] vercel.json exists at repo root
- [ ] devices.json has correct database (eka-agent)
- [ ] dashboard_api.py loads environment variables
- [ ] dashboard/index.html has both device cards

**Vercel Settings:**
- [ ] Root Directory is CLEARED (empty)
- [ ] Environment variables configured (3 required)
- [ ] All set to "Production" environment
- [ ] Git integration enabled
- [ ] Auto-deploy enabled

**Post-Deployment:**
- [ ] Deployment status is "Ready"
- [ ] Dashboard loads in browser
- [ ] Device cards visible
- [ ] API endpoints respond
- [ ] Heartbeat button works
- [ ] Rolling data windows populate

---

**Status**: ✅ COMPLETE DEPLOYMENT PACKAGE READY

Use this document with `DEPLOYMENT_VERIFICATION_CHECKLIST.md` to verify every aspect of the deployment before and after pushing to GitHub.
