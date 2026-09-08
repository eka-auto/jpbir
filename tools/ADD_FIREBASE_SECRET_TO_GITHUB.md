# Add Firebase Service Account Key to GitHub Secrets and Vercel

## Required Secret: `FIREBASE_SERVICE_ACCOUNT_JSON`

The GitHub repository needs the Firebase service account key to run the eka-runner and connect devices.

The same key must **also** live in Vercel: the dashboard API endpoints
(`Dashboard/Current/api/jp-devices.js`, `jp-ask.js`, `check-stale.js`, and
`lib/broker.js`) read `FIREBASE_SERVICE_ACCOUNT_JSON` from Vercel env, not from
GitHub. Rotating it in only one place leaves the other broken.

> ⚠️ **The two stores expect different encodings of the same key.** The Vercel
> functions call `JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)` directly (no base64
> decode), so Vercel must hold the **raw JSON** of the key file. The GitHub
> Actions secret holds the **base64-encoded** value (the workflow decodes it).
> Pasting the base64 blob into Vercel makes `JSON.parse` throw and the dashboard
> stays down — set the raw JSON there.

## Symptom of a stale/revoked key

When the deployed key has been revoked or rotated in GCP but the env var still
holds the old one, the token exchange with Google fails and the dashboard shows:

```
token exchange failed: {"error":"invalid_grant","error_description":"Invalid JWT Signature."}
```

`invalid_grant / Invalid JWT Signature` is Google rejecting the signed assertion
because the key's public half no longer matches the service account. It is **not**
a code bug — the fix is to rotate the credential everywhere it is stored (below).
The previously committed key `bd6c343e65e4fcbe70ea76f49aee43178d82b5a8` was leaked
(see git history) and must be deleted in GCP if it has not been already.

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

### Option 3: Vercel (required for the dashboard)

Set the **raw JSON** value (the contents of the downloaded key file, not the
base64 blob) on each Vercel project that serves the dashboard/relay
(`jpbir`, `jayti-dashboard`, `channel-sandbox`), then redeploy so the running
functions pick it up:

```bash
# Via the Vercel dashboard: Project → Settings → Environment Variables →
#   FIREBASE_SERVICE_ACCOUNT_JSON (Production) → paste the RAW JSON → Save → Redeploy.
# Or via CLI, per project (feed the raw JSON file on stdin, not the base64 value):
vercel env rm FIREBASE_SERVICE_ACCOUNT_JSON production
vercel env add FIREBASE_SERVICE_ACCOUNT_JSON production < key.json   # raw JSON
vercel --prod                                                        # redeploy
```

## Rotating a leaked or revoked key

1. In the GCP console for project `intrepid-stage-495117-q1`, open the service
   account `firebase-adminsdk-fbsvc@intrepid-stage-495117-q1.iam.gserviceaccount.com`
   → **Keys**, and **delete** the exposed key
   `bd6c343e65e4fcbe70ea76f49aee43178d82b5a8` if it still exists.
2. Create a new JSON key for that service account and download it (`key.json`).
3. Update the secret in **all three** stores, minding the encoding each expects:
   - **GitHub Actions** (Option 1/2): the **base64** value — `base64 -w0 key.json`.
   - **Vercel** (Option 3): the **raw JSON** — the `key.json` contents verbatim.
   - Any local `.env`: raw JSON, same as Vercel.
4. Redeploy Vercel and re-run the verify workflow below.

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
