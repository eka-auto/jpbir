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
