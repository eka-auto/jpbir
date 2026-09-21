# Samsung S24 Ultra Deploy Kit

This kit enrolls only a Samsung `SM-S928*` device as
`samsung-s24-ultra`. It uses an AndroidKeyStore P-256 key through
Termux:API and makes signed outbound HTTPS requests to the broker. It does
not place a Google service-account key on the phone or expose an inbound
control service.

## Install With The Phone In Hand

1. Install Termux, Termux:API, and Termux:Boot from the same trusted
   distribution source. Open Termux:Boot once so Android enables its boot
   receiver, then grant Termux:API access when Android prompts.
2. From the admin machine, mint a short-lived code:
   `python Devices/sandbox/mint_enrollment_code.py mint samsung-s24-ultra`
3. Transfer this complete directory to the phone and immediately run:
   `bash install_s24.sh`
4. Enter the one-time code when prompted.

The installer targets `https://jaytipargal.tech` and fails closed unless
Android reports manufacturer `Samsung`, model `SM-S928*`, and a P-256 key
inside secure hardware. It verifies each bundled artifact against a pinned
SHA-256 digest and creates an isolated Python environment. Enrollment runs
without publishing liveness; the installer then verifies the executable
Termux:Boot launcher and persisted 15-minute JobScheduler entry, records that
installation evidence, and only then publishes the final signed heartbeat.
The install also starts the persistent broker process and verifies its PID.

The official command surface is exactly `status-only`, `ping`, `echo`,
`wa-push`, `wa-media-push`, and `sync-now`. Status and ping accept no payload;
echo returns a JSON-object payload unchanged; the three push/sync actions
accept only an optional bounded integer `timeout_seconds`. A dashboard LIVE
badge alone is not execution proof; verify a fresh signed heartbeat and a
command that reaches completed status.

## Direct-cloud data sync with a local checkpoint

The phone-data archive is a separate, outbound-only path:

```text
S24 Termux --HTTPS--> Firestore --read--> private local JSON
                                      --P-256 signed HTTPS--> Vercel --SQL--> Neon
```

The sync runs on a schedule in GitHub Actions (see below). The laptop steps
here are the manual fallback when Actions is unavailable or the owner has
chosen not to place an exportable signing key in CI.

1. Run `s24_phone_direct_cloud.py` inside Termux on the physical S24. Laptop
   mode is not a phone connection and is deliberately rejected by the local
   launchers.
2. Run `python pull_direct_cloud.py --service-account <local-key.json>`. This
   is a read-only Firestore export and uses no ADB. It writes `manifest.json`
   plus `records.jsonl.gz` beneath `%LOCALAPPDATA%\Jayti\S24 Sync\runs` on the
   laptop, or under the `--output-root` given in CI. Every discovered
   subcollection and bounded direct-sync dataset gets an explicit `ok`,
   `empty`, `denied`, `unavailable`, or `error` ledger row. Direct call, SMS,
   and location snapshots are accepted only with fresh Android-Termux runtime
   evidence; stale laptop-authored snapshots fail closed.
3. Create/read the non-exportable public key with
   `python push_to_vercel.py --print-public-key`. Configure that public PEM in
   Vercel as `S24_SYNC_PUBLIC_KEYS`; never copy a private key to Vercel.
4. Run `python push_to_vercel.py`. Uploads are byte-signed (Windows Platform
   Crypto Provider key on the laptop, `--software-key` PEM in CI) and safely
   retried using request replay IDs.
5. Open `/db`, select **S24 archive**, and unlock it with the dashboard key.

The local export directory and all key files are gitignored. Treat exports as
private device data: do not move them into this repository or a synced folder.

## Scheduled sync (GitHub Actions)

`.github/workflows/s24-export-sync.yml` runs the same pull/push pipeline twice
a day (`23 5,17 * * *`, times chosen not to collide with the Vercel
`/api/s24-sync-cron`) plus on demand via **Actions → S24 Direct-Cloud Export
Sync → Run workflow**.

**It does nothing until both repository secrets below exist.** The job fails
closed on each one, so before they are provisioned every scheduled run simply
goes red twice a day. That is deliberate — an export job that quietly skipped
its credentials would leave you believing the archive was current.

**This is not the same thing as the Vercel cron.** `/api/s24-sync-cron`
(`17 */6 * * *`, `Backend/s24-sync-cron.js`) only queues a `sync-now` command
into the phone's Firestore `commandQueue`; it produces no export run, and
nothing cloud-side can make the phone act on it. This Actions job is the other
half: it reads Firestore and pushes a signed export to `/api/s24-ingest`, which
is what actually fills the `s24_*` tables behind **/db → S24 archive**.

It needs two repository secrets:

```bash
# A PAT with repo access (gh auth login --with-token), or paste in
# Settings → Secrets and variables → Actions instead.
gh secret set EKA_SERVICE_ACCOUNT_JSON < service-account.json
gh secret set S24_SYNC_PRIVATE_KEY_PEM < s24-ci-signing-key.pem
```

- `EKA_SERVICE_ACCOUNT_JSON` — full JSON of the Firestore read-only service
  account (same key the laptop points `EKA_SERVICE_ACCOUNT_KEY` at).
- `S24_SYNC_PRIVATE_KEY_PEM` — an **exportable** P-256 PEM. CI cannot use the
  laptop's non-exportable TPM key, so this must be a dedicated key the owner
  consciously creates, e.g.
  `openssl ecparam -name prime256v1 -genkey -noout -out s24-ci-signing-key.pem`.
  Keeping the laptop flow instead is a valid choice; then delete the workflow.

Publish the CI public half to the Vercel `S24_SYNC_PUBLIC_KEYS` env var — it
accepts several PEM blocks newline-separated or a JSON array, so append rather
than replace:

```bash
python push_to_vercel.py --software-key s24-ci-signing-key.pem --print-public-key
# PEM on stdout goes into S24_SYNC_PUBLIC_KEYS; key_id on stderr must match.
```

When a run fails, the job log names the failing step: a pull failure means
Firestore auth or the device document, a push failure means signature or
ingest rejection (e.g. public key not in `S24_SYNC_PUBLIC_KEYS`). Re-running
the workflow is always safe: records upsert on `(device_id, dataset,
record_id)`, so retries converge instead of duplicating.
