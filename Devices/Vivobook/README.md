# ASUS VivoBook Deploy Kit

This kit enrolls only the physical ASUS VivoBook as `jayti-asus-vivobook`.
The device keeps a non-exportable P-256 signing key in the Windows TPM and
dials out to the HTTPS broker. No Google service-account key is installed.

## Install

1. From the admin machine, mint a code bound to `jayti-asus-vivobook`:
   `python Devices/sandbox/mint_enrollment_code.py mint jayti-asus-vivobook`
2. Copy this directory to the VivoBook.
3. On the VivoBook, run PowerShell as the intended signed-in user:
   `powershell -ExecutionPolicy Bypass -File .\install_vivobook.ps1`
4. Enter the 32-character code when prompted.

The installer rejects Lenovo hardware, requires an ASUS/ASUSTeK VivoBook,
copies broker files bundled from a pinned commit, verifies SHA-256 hashes, creates
an isolated Python environment, proves enrollment with a signed heartbeat,
then registers `EKA-VivoBook-Daemon`.

The one-time code file is deleted after successful enrollment. The allowed
commands are limited to `status-only`, `ping`, and `echo`.
