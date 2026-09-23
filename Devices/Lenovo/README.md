# Lenovo 82KA Deploy Kit

This kit enrolls only this physical Lenovo 82KA as `g4g-lenovo-laptop`.
It replaces the legacy direct-Firestore heartbeat with signed outbound HTTPS
through the broker while leaving unrelated MCP tasks untouched.

Run `python Devices/sandbox/mint_enrollment_code.py mint g4g-lenovo-laptop`
from the admin checkout, then run
`powershell -ExecutionPolicy Bypass -File .\install_lenovo.ps1` and enter the
one-time code. The installer requires a matching Lenovo 82KA, creates a
non-exportable TPM key, verifies the pinned bundled files, sends a signed heartbeat,
and only then replaces `EKA-Lenovo-Daemon`.

The allowed commands are `status-only`, `ping`, and `echo`. No service-account
key is copied into the broker runtime.
