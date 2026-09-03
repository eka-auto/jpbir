# ✅ Vercel Deployment - Final Steps

## Deployment Status

**GitHub**: ✅ Pushed successfully  
**Vercel**: ⚠️ Needs configuration

**Deployment URL**: https://vercel.com/jayti/channel-sandbox/EePjhk5T5ckwZMJviDKWfxJGYRic

---

## Configure Vercel Project Settings

### Step 1: Go to Vercel Project
https://vercel.com/jayti/channel-sandbox/settings

### Step 2: Set Root Directory

**Settings → General → Root Directory**

Click **"Edit"** and set:
```
channel-sandbox
```

This tells Vercel that your app lives in the `channel-sandbox` subdirectory of the monorepo.

### Step 3: Configure Environment Variables

**Settings → Environment Variables**

Add these 3 variables:

| Name | Value |
|------|-------|
| `SANDBOX_MODE` | `real` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Paste full JSON from `C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json` |
| `STATS_KEY` | Generate secure random string (e.g., `openssl rand -hex 16`) |

**How to get FIREBASE_SERVICE_ACCOUNT_JSON:**

1. Open `C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json`
2. Copy the **entire JSON content**
3. Paste it as the value in Vercel

**How to generate STATS_KEY:**

```powershell
openssl rand -hex 16
```

Or use any 32-character random string.

### Step 4: Redeploy

After configuring:

1. Go to **Deployments**
2. Click **"Redeploy"** on the latest deployment
3. Wait for build to complete (~2-3 minutes)

---

## Your Dashboard URL

Once deployed, your dashboard will be live at:

```
https://channel-sandbox-kth2ebjc9-jayti.vercel.app
```

Or access via:
https://vercel.com/jayti/channel-sandbox

---

## What You'll See

### Device Status Cards
- 📱 **Samsung S24 Ultra** - Online/Offline, Battery, Last Seen
- 💻 **Asus VivoBook** - Online/Offline, Last Seen

### Rolling Data (Last 50 Records)
- WhatsApp Messages
- Call Logs
- Contacts

### Device Controls
- Heartbeat
- Status Check

---

## Troubleshooting

### Build Fails: "Root Directory not found"
**Fix**: Set Root Directory to `channel-sandbox` in Vercel Settings

### Dashboard Shows "Offline" for Devices
**Cause**: Devices not running their agents

**Fix**:
1. S24: Run `s24_phone_direct_cloud.py` in Termux
2. VivoBook: Run device agent
3. Wait 15-30 seconds

### 401 Unauthorized
**Fix**: Ensure `STATS_KEY` environment variable is set

### No Data in Rolling Windows
**Fix**: Send "Heartbeat" command from dashboard, wait for device response

---

## Next Steps After Deployment

1. ✅ Test device connections (click Heartbeat)
2. ✅ Verify rolling data windows populate
3. ✅ Configure ntfy wake-up (optional)
4. ✅ Monitor Vercel function logs

---

**Ready to configure?** Go to https://vercel.com/jayti/channel-sandbox/settings and set the Root Directory to `channel-sandbox`.
