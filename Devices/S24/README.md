# Samsung S24 Ultra Deploy Kit

This kit enrolls only a Samsung `SM-S928*` device as
`samsung-s24-ultra`. It uses an AndroidKeyStore P-256 key through
Termux:API and makes signed outbound HTTPS requests to the broker. It does
not place a Google service-account key on the phone or expose an inbound
control service.

## Install With The Phone In Hand

1. Install Termux and the matching Termux:API app from the same trusted
   distribution source, then grant the API app access when Android prompts.
2. From the admin machine, mint a short-lived code:
   `python channel-sandbox/mint_enrollment_code.py mint samsung-s24-ultra`
3. Transfer this complete directory to the phone and immediately run:
   `bash install_s24.sh`
4. Enter the one-time code when prompted.

The installer fails closed unless Android reports manufacturer `Samsung`,
model `SM-S928*`, and a P-256 key inside secure hardware. It verifies each
bundled artifact against a pinned SHA-256 digest, creates an isolated Python
environment, proves enrollment with a signed heartbeat, and only then adds
Termux boot/watchdog startup.

The command surface is intentionally limited to `status-only`, `ping`, and
`echo`. A dashboard LIVE badge alone is not an operational proof; verify a
fresh signed heartbeat and a command that reaches completed status.

## Direct-cloud data sync with a local checkpoint

The phone-data archive is a separate, outbound-only path:

```text
S24 Termux --HTTPS--> Firestore --read--> private laptop JSON
                                      --P-256 signed HTTPS--> Vercel --SQL--> Neon
```

1. Run `s24_phone_direct_cloud.py` inside Termux on the physical S24. Laptop
   mode is not a phone connection and is deliberately rejected by the local
   launchers.
2. On the laptop, run
   `python pull_direct_cloud.py --service-account <local-key.json>`. This is a
   read-only Firestore export and uses no ADB. It writes `manifest.json` plus
   `records.jsonl.gz` beneath `%LOCALAPPDATA%\Jayti\S24 Sync\runs`. Every
   discovered subcollection and bounded direct-sync dataset gets an explicit
   `ok`, `empty`, `denied`, `unavailable`, or `error` ledger row. Direct call,
   SMS, and location snapshots are accepted only with fresh Android-Termux
   runtime evidence; stale laptop-authored snapshots fail closed.
3. Create/read the laptop's non-exportable public key with
   `python push_to_vercel.py --print-public-key`. Configure that public PEM in
   Vercel as `S24_SYNC_PUBLIC_KEYS`; never copy a private key to Vercel.
4. Run `python push_to_vercel.py`. Uploads are byte-signed with the Windows
   Platform Crypto Provider key and safely retried using request replay IDs.
5. Open `/db`, select **S24 archive**, and unlock it with the dashboard key.

The local export directory and all key files are gitignored. Treat exports as
private device data: do not move them into this repository or a synced folder.
