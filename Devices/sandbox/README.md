# channel-sandbox — deployment guide

The channel-sandbox is the operator's private control-plane for the device
fleet. It deploys to Vercel as the `channel-sandbox` project with **Root
Directory** `Devices/sandbox`.

Once configured, it runs at
[`https://channel-sandbox.vercel.app`](https://channel-sandbox.vercel.app).
Load the dashboard with `?key=<STATS_KEY>` in the URL; the key persists in
`sessionStorage` for the tab.

## What you need before you start

1. **A Firestore database** — this repo assumes GCP project
   `intrepid-stage-495117-q1`, database `eka-agent`, collection `devices`.
   To use a different one, change the values in `SANDBOX_CONFIG_JSON` (below).
2. **A Google service account** with `roles/datastore.user` on that database.
   Download its JSON key from GCP Console → IAM & Admin → Service Accounts.
3. **The Vercel `channel-sandbox` project linked** to this repo with Root
   Directory `Devices/sandbox`. The original project was deleted at some point
   before 2026-09-19. It was re-created that day under the same name in team
   `jayti` (`prj_hRRe8dOt2F3mYU721Qk9lFAG9V92`), which is why the URL changed
   from `channel-sandbox-one.vercel.app`. The re-created project has **no env
   vars**, so step 2 is required.
4. **The repo-root `.vercelignore` must not strip this directory.** Vercel
   applies that file to this project's builds too. If it ignores
   `Devices/sandbox/` or anything inside it, the build "succeeds" with no
   output and every path returns `NOT_FOUND`.
   `_shared/tests/deploy-manifest.test.mjs` checks this.

## Step-by-step deploy

1. **Verify what's currently missing.** Visit
   [`https://channel-sandbox.vercel.app/api/diag`](https://channel-sandbox.vercel.app/api/diag)
   (public, no key needed). The response names every env var this service
   needs and reports whether it's set, whether it parses, and — for the
   service account — the public `client_email` and `project_id` so you can
   confirm it's the right credential. A green deployment shows
   `"ok": true`; missing env vars appear as `"set": false`.

2. **Set the three required env vars** on the Vercel project
   (Settings → Environment Variables → *Production*, *Preview*, *Development*):

   | Name | Value |
   |---|---|
   | `STATS_KEY` | any long random string; you'll pass it in `?key=` |
   | `SANDBOX_CONFIG_JSON` | see `.env.example` |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | paste the service-account JSON as one line |
   | `DATABASE_URL` | the Neon connection string — same name the main backend uses (`POSTGRES_URL` is accepted as a fallback); powers `/api/data/whatsapp` |

   Optional (only if you use `/api/agent/query`):
   `AGENT_API_URL`, `AGENT_API_KEY`.

3. **Re-deploy.** Vercel picks up env-var changes only on the *next* build.
   Trigger one by pushing an empty commit, clicking **Redeploy** in the
   Vercel dashboard, or waiting for the next `main` push.

4. **Seed the `devices` Firestore collection** so the dashboard has something
   to show before any physical device enrolls:

   ```bash
   pip install -r Devices/sandbox/requirements.txt
   export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)"
   python Devices/sandbox/scripts/seed_devices.py --write --allow-production
   ```

   The script reads `Devices/sandbox/devices.json`, writes each entry as a
   Firestore document under `devices/<id>`, and refuses to run against
   `mode:real` unless `--allow-production` is passed. Both flags are required
   and the command above previously omitted them: without `--write` it is a
   dry run that prints and exits, and without `--allow-production` it refuses
   outright — so following this step as written seeded nothing while looking
   like it had worked.

5. **Verify end-to-end.** Visit
   `https://channel-sandbox.vercel.app/?key=<STATS_KEY>`. The two
   device cards should populate. If a card stays "Connecting…", check
   `/api/diag` — it points at the exact failure without leaking secrets.

## Route reference

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/status` | public | health check (returns 200 always) |
| `GET /api/diag` | public | env-var + bootstrap diagnostic (safe values only) |
| `GET /api/keys` | key | SSH public-key fingerprints the sandbox knows about |
| `GET /api/devices` | key | list every enrolled device |
| `GET /api/devices/<id>/status` | key | one device's current status |
| `POST /api/devices/<id>/commands` | key | queue a command for the device |
| `GET /api/data/whatsapp` | key | latest N WhatsApp messages from Neon (`wa_messages` ⨝ `wa_chats`, newest first); requires `DATABASE_URL` |
| `GET /api/data/calls` | key | live rolling `samsungS24DirectSync.callLogs` array PATCHed into the device doc (falls back to the legacy `callLogs` subcollection only when the array is absent) |
| `GET /api/data/sms` | key | live rolling `samsungS24DirectSync.sms` array PATCHed into the device doc (same fallback as calls) |
| `GET /api/data/contacts` | key | nothing collects contacts — names come from WhatsApp chat names; always answers an explicit not-collected empty state |
| `POST /api/agent/query` | key + `AGENT_API_KEY` | proxy a RAG query to the external agent |

Every key-gated route returns `401 {"error":"unauthorized"}` without a valid
key and `503 {"error":"server not configured"}` when a required env var is
missing.

## Local development

```bash
pip install -r requirements.txt
./start_dashboard.sh            # or: python dashboard_api.py --port 5000
```

Then open <http://127.0.0.1:5000>.

Two things this used to get wrong, both of which stopped a clean-machine
bring-up dead:

- **There is no `--auth-disabled` flag.** It was documented but never existed;
  the command above exited 2 with `unrecognized arguments`. Auth is instead
  waived automatically when `STATS_KEY` is unset AND the bind is loopback, and
  `main()` refuses a non-loopback bind without a key. Setting
  `SANDBOX_AUTH_DISABLED` in the environment does nothing whatsoever — the
  guard reads `app.config`, which Flask never populates from `os.environ`.
- **`--config` now defaults to `devices.emulator.json`.** `devices.json` is
  `mode:real` against the production `devices` collection with no
  `allow_production_devices`, so `FirestoreClient` refuses it and the old
  default crashed before serving a request. `devices.json` remains the
  canonical public device roster; it is simply not a runnable local config.

The emulator config expects a Firestore emulator on `127.0.0.1:8080`:

```bash
firebase emulators:start --only firestore    # separate terminal
```

Without one running, the pages load and every Firestore-backed card reports
`live source unavailable` rather than failing silently — which is the state
worth being able to see locally.
