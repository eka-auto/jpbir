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

## Service Account Key Value

Do **not** put a key value in this document. Obtain a newly issued JSON key through GCP IAM, add it directly to GitHub Actions as `FIREBASE_SERVICE_ACCOUNT_JSON`, verify the workflow, and delete the downloaded file.

> Security incident: an old base64-encoded service-account credential was committed here. The 2026-09-21 audit confirmed its key ID no longer exists in GCP IAM, so it is already revoked/deleted. The value was removed from the current tree; do not restore it.

## Verification

After adding or rotating the secret, run the live `Sync keys to Vercel` workflow in dry-run mode first:

1. Go to: https://github.com/jaytipargal/jpbir/actions/workflows/sync-keys-to-vercel.yml
2. Click "Run workflow" and select `dry_run: true`
3. Review the masked plan; then run with `dry_run: false`
4. Wait for the workflow and the production redeploy to complete

## What This Key Does

This Firebase service account key allows GitHub Actions to:
- Connect to Firestore database `eka-agent` in project `intrepid-stage-495117-q1`
- Read/write device documents (e.g., `devices/samsung-s24-ultra`)
- Set device status, heartbeats, and command queues
- Freeze/unfreeze devices by setting `staleAlert.state`

## Security Notes

- Store the key only as an **encrypted GitHub secret** — never commit or paste it into repository files
- The key is only accessible to GitHub Actions workflows
- Rotate the key periodically via Firebase Console
