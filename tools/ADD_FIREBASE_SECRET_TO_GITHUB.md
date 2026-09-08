# Add Firebase Service Account Key to Vercel (and optionally GitHub Secrets)

## Required Secret: `FIREBASE_SERVICE_ACCOUNT_JSON`

The place this key actually matters is **Vercel**: the dashboard API endpoints
(`Dashboard/Current/api/jp-devices.js`, `jp-ask.js`, `check-stale.js`, and
`lib/broker.js`) read `FIREBASE_SERVICE_ACCOUNT_JSON` from Vercel env. The
sandbox API (`Sandbox/Configuration/`) and `tools/freeze_device.ps1` read the
same variable from their own environment.

**No workflow in this repository reads the GitHub Actions secret.** As of this
writing `.github/workflows/` holds only `ci-deploy.yml` (references no secrets)
and `verify-secrets.yml` (checks the phone credential `PHONE_DAEMON_KEY` and the
SSH secrets — not Firebase). The GitHub secret is therefore optional here; keep
it only if an external consumer (e.g. an eka-runner workflow in its own repo)
needs it. Setting or rotating it in GitHub does nothing for the dashboard.

> ⚠️ **Every consumer in this repo expects the raw JSON.** The Vercel functions
> call `JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)` directly, `freeze_device.ps1`
> pipes it straight into `ConvertFrom-Json`, and the sandbox API reads it as
> JSON. Nothing base64-decodes it. The base64 form that used to be pasted here
> was only a convenience for `gh secret set`; no code in this repository ever
> decoded it. Pasting a base64 blob into Vercel makes `JSON.parse` throw and the
> dashboard stays down — set the **raw JSON** there.

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

### Option 1: GitHub Actions secret via Web UI (optional — no in-repo workflow uses it)

1. Go to: https://github.com/jaytipargal/jpbir/settings/secrets/actions
2. Click "New repository secret"
3. **Name**: `FIREBASE_SERVICE_ACCOUNT_JSON`
4. **Value**: the key in whatever encoding the external consumer expects. Nothing
   in this repository decodes base64, so raw JSON is the safe default.
5. Click "Add secret"

### Option 2: GitHub Actions secret via CLI (optional — no in-repo workflow uses it)

```powershell
# Install GitHub CLI if not already installed
# winget install GitHub.cli

# Login to GitHub
gh auth login

# Add the secret from the raw key file (nothing in this repo decodes base64)
gh secret set FIREBASE_SERVICE_ACCOUNT_JSON -R jaytipargal/jpbir < key.json
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
3. Set the new key as **raw JSON** everywhere it is consumed:
   - **Vercel** (Option 3) — this is the store that fixes the dashboard. It also
     feeds the sandbox API, since `jpbir` and `channel-sandbox` deploy from
     `Sandbox/Configuration/` and read the same `FIREBASE_SERVICE_ACCOUNT_JSON`
     environment variable.
   - For `tools/freeze_device.ps1`, one of the two sources it actually reads:
     the `FIREBASE_SERVICE_ACCOUNT_JSON` variable in the **shell's process
     environment** (it does not load a `.env` file), or `serviceAccountKey.json`
     at the repository root.
   - The GitHub Actions secret (Option 1/2) only if an external consumer needs
     it; no workflow in this repository reads it.
4. Redeploy Vercel, then verify as described below.

## Base64-Encoded Service Account Key

```
<REDACTED-2026-09-07: full base64 service-account key removed from the repo.
Key bd6c343e65e4fcbe70ea76f49aee43178d82b5a8 (firebase-adminsdk-fbsvc@intrepid-stage-495117-q1.iam.gserviceaccount.com)
was exposed in git history. Rotate this key in GCP before re-adding any secret here.>
```

## Verification

Verify against the consumer that actually uses the key — the dashboard API.
(Do **not** use the `verify-secrets.yml` workflow for this: despite its name it
is the "S24 connection diagnostic", checks `PHONE_DAEMON_KEY` and the SSH
secrets only, and never reports on `FIREBASE_SERVICE_ACCOUNT_JSON`.)

1. After the Vercel redeploy, open the S24 page (`/s24`) — the device card must
   load instead of showing "Failed to load device state".
2. Or call the endpoint directly and check for `"success": true` and a
   `devices` array:

   ```bash
   curl -s "https://<dashboard-host>/api/jp-devices" -H "x-stats-key: $STATS_KEY"
   ```

   A response containing `invalid_grant` means Google rejected the deployed
   service-account credential itself (an old or revoked key). A value that is
   not raw JSON never reaches Google: `JSON.parse` fails first, and the API
   returns a 500 whose `error` is a `SyntaxError` (e.g. `Unexpected token …
   is not valid JSON`) instead.

## What This Key Does

This Firebase service account key allows the dashboard API (Vercel), the sandbox
API, and the device tools to:
- Connect to Firestore database `eka-agent` in project `intrepid-stage-495117-q1`
- Read/write device documents (e.g., `devices/samsung-s24-ultra`)
- Set device status, heartbeats, and command queues
- Freeze/unfreeze devices by setting `staleAlert.state`

## Security Notes

- Never commit the key to the repo — store it only as a Vercel environment
  variable (and, if needed, an encrypted GitHub secret)
- Rotate the key periodically via the GCP console, and immediately if it is
  ever exposed (as `bd6c343e65e4…` was)
