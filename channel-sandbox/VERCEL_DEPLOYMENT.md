# Channel Sandbox Dashboard - Vercel Deployment

## ✅ Configuration Pushed to GitHub

Your `channel-sandbox` is now configured for Vercel deployment with:

- **Database**: `eka-agent` (Firestore)
- **Devices**: Samsung S24 Ultra + Asus VivoBook
- **Vercel Config**: `vercel.json` deployed

## Next Steps - Deploy to Vercel

### Option 1: Vercel Web Dashboard (Recommended)

1. **Go to Vercel**: https://vercel.com
2. **Import Project**: Click "Add New" → Import your GitHub repository `jaytipargal/jpbir`
3. **Configure Root Directory**: Set to `channel-sandbox`
4. **Add Environment Variables**:
   
   ```
   SANDBOX_MODE=real
   FIREBASE_SERVICE_ACCOUNT_JSON=<paste service account JSON>
   STATS_KEY=your-secret-key-here
   ```

5. **Deploy**: Click "Deploy"

### Option 2: Vercel CLI

```powershell
cd C:\Users\abcom\jpbir\channel-sandbox
vercel --prod
```

## Environment Variables Required

Create these in Vercel Dashboard → Project Settings → Environment Variables:

| Name | Value |
|------|-------|
| `SANDBOX_MODE` | `real` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service account JSON from `C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json` |
| `STATS_KEY` | Any secure random string (e.g., `openssl rand -hex 16`) |

## Dashboard Features

Once deployed, your dashboard at `https://<your-project>.vercel.app` will show:

### Device Status Cards
- **Samsung S24 Ultra**
  - Online/Offline status
  - Battery level + charging
  - Last seen timestamp
  - SSH tunnel endpoint (bore.pub)
  
- **Asus VivoBook**
  - Online/Offline status
  - Last seen timestamp
  - Connection method

### Rolling Data Windows (Last 50 Records)
- WhatsApp Messages
- Call Logs
- SMS Messages
- Contacts

### Device Controls
- Heartbeat
- Status Check
- Wake Up (via ntfy)

## Testing Locally

Before deploying, test locally:

```powershell
cd C:\Users\abcom\jpbir\channel-sandbox
.\start_dashboard.bat
```

Open: http://localhost:5000

## Architecture

```
Vercel Dashboard
       ↓
Vercel Functions (dashboard_api.py)
       ↓
Firestore (eka-agent/devices)
       ↓
┌──────┴──────┐
S24 Ultra   VivoBook
```

## Troubleshooting

### Dashboard shows "Offline"
- Ensure S24 daemon is running in Termux
- Ensure VivoBook agent is running
- Wait 15-30 seconds for heartbeat

### 401 Unauthorized
- Check `STATS_KEY` environment variable
- Redeploy in Vercel

### No data showing
- Send a "Heartbeat" command from dashboard
- Check Firestore Console for device documents

---

**Repository**: https://github.com/jaytipargal/jpbir  
**Branch**: main  
**Latest Commit**: feat: configure S24 + VivoBook dashboard for Vercel
