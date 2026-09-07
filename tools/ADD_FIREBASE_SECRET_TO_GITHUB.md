# Add Firebase Service Account Key to GitHub Secrets

## Required Secret: `FIREBASE_SERVICE_ACCOUNT_JSON`

The GitHub repository needs the Firebase service account key to run the eka-runner and connect devices.

## Steps to Add the Secret

### Option 1: Via GitHub Web UI (Recommended)

1. Go to: https://github.com/jaytipargal/jpbir/settings/secrets/actions
2. Click "New repository secret"
3. **Name**: `FIREBASE_SERVICE_ACCOUNT_JSON`
4. **Value**: Paste the base64-encoded key below
5. Click "Add secret"

### Option 2: Via GitHub CLI

```powershell
# Install GitHub CLI if not already installed
# winget install GitHub.cli

# Login to GitHub
gh auth login

# Add the secret
gh secret set FIREBASE_SERVICE_ACCOUNT_JSON -b "<BASE64_KEY>" -R jaytipargal/jpbir
```

## Base64-Encoded Service Account Key

```
<REDACTED-2026-09-07: full base64 service-account key removed from the repo.
Key bd6c343e65e4fcbe70ea76f49aee43178d82b5a8 (firebase-adminsdk-fbsvc@intrepid-stage-495117-q1.iam.gserviceaccount.com)
was exposed in git history. Rotate this key in GCP before re-adding any secret here.>
```

## Verification

After adding the secret, run the "Verify Secrets" workflow to confirm it's properly configured:

1. Go to: https://github.com/jaytipargal/jpbir/actions/workflows/verify-secrets.yml
2. Click "Run workflow"
3. Wait for the workflow to complete
4. Check that `FIREBASE_SERVICE_ACCOUNT_JSON is configured` shows green

## What This Key Does

This Firebase service account key allows GitHub Actions to:
- Connect to Firestore database `eka-agent` in project `intrepid-stage-495117-q1`
- Read/write device documents (e.g., `devices/samsung-s24-ultra`)
- Set device status, heartbeats, and command queues
- Freeze/unfreeze devices by setting `staleAlert.state`

## Security Notes

- This key is stored as an **encrypted GitHub secret** - never commit it to the repo
- The key is only accessible to GitHub Actions workflows
- Rotate the key periodically via Firebase Console
