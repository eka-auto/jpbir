# Eka Broker Device Enrollment

Production deployment scripts for enrolling remote devices with the Eka broker (`https://agent.jaytipargal.tech`).

## Architecture

Devices connect via **signed outbound HTTPS** to the broker — no inbound connections, no tunnels.

```
Device (TPM/Keystore key) ──signed HTTPS──▶ https://agent.jaytipargal.tech
                                             ├─ /api/device-enroll      (one-time code → keyId)
                                             ├─ /api/device-heartbeat  (signed, hardware-verified)
                                             ├─ /api/device-commands-poll
                                             ├─ /api/broker-command-claim
                                             └─ /api/broker-command-complete
                                                      │
                                             Firestore eka-agent
                                             ├─ deviceKeys/{keyId} → deviceId
                                             └─ devices/{id}.enrollment
```

## Supported Devices

| Device | Key Storage | Signer | Key Name/Alias | Install Script |
|--------|-------------|--------|----------------|----------------|
| ASUS VivoBook | Windows TPM (CNG) | `windows-cng` | `EKA-BROKER-JAYTI-ASUS-VIVOBOOK` | `vivobook/install_vivobook.ps1` |
| Samsung S24 Ultra | Android Keystore | `android-keystore` | `eka-broker-samsung-s24-ultra` | `s24/install_s24.sh` |

## Prerequisites

### For ASUS VivoBook (Windows)
- Physical access to the ASUS VivoBook laptop
- Windows 10/11 with TPM 2.0 (Platform Crypto Provider)
- Python 3.10+ (64-bit)
- 32-character hexadecimal enrollment code (generated on the broker/dashboard)
- Target directory: `C:\eka-agent\broker\` (created by installer)

### For Samsung S24 Ultra (Termux)
- Physical access to the Samsung S24 Ultra phone
- Termux installed from F-Droid
- Termux:API app installed (for Keystore access)
- Battery ≥30% and charging (daemon will die below ~30%)
- 32-character hexadecimal enrollment code
- ADB connection for initial setup (optional but recommended)

## Enrollment Process

### ASUS VivoBook

1. **Copy deploy kit to the target machine**
   ```powershell
   # On the ASUS VivoBook, create the deploy directory
   mkdir C:\eka-agent\deploy
   # Copy the entire vivobook\ folder from this repo
   ```

2. **Generate an enrollment code** on the dashboard/broker admin panel
   - Codes are 32-character hexadecimal strings
   - Each code is single-use and expires after 10 minutes
   - Codes can be bound to specific device IDs and key types

3. **Run the enrollment script**
   ```powershell
   cd C:\eka-agent\deploy\vivobook
   .\install_vivobook.ps1
   ```
   - When prompted, enter the 32-character enrollment code
   - Or set `EKA_ENROLLMENT_CODE` environment variable before running

4. **Verify enrollment**
   - Script exits with `[ok]` messages on success
   - Check logs at `C:\eka-agent\broker\logs\jayti-asus-vivobook.log`
   - Dashboard should show device `online: true` within 60 seconds

5. **Persistent operation**
   - Daemon installs as scheduled task `EKA-VivoBook-Daemon`
   - Heartbeat every 45 seconds
   - Command poll every 15 seconds
   - No service account key stored on device (TPM-backed signing only)

### Samsung S24 Ultra

1. **Push deploy kit to the phone**
   ```bash
   # From laptop with ADB access
   adb push s24/ /data/data/com.termux/files/home/eka-broker-deploy/
   ```

2. **Generate an enrollment code** on the dashboard/broker admin panel

3. **Run the enrollment script in Termux**
   ```bash
   # On the phone, in Termux
   cd ~/eka-broker-deploy/s24
   bash install_s24.sh
   ```
   - When prompted, enter the 32-character enrollment code
   - Or set `EKA_ENROLLMENT_CODE` environment variable before running

4. **Verify enrollment**
   - Script exits with `[ok]` messages on success
   - Check logs at `~/.local/share/eka-broker/logs/samsung-s24-ultra.log`
   - Dashboard should show device `online: true` within 60 seconds

5. **Persistent operation**
   - Boot script at `~/.termux/boot/start_eka_s24_broker.sh`
   - Termux job scheduler (job 240619, 15-minute interval)
   - Wake lock acquired (survives sleep)
   - Heartbeat every 45 seconds
   - Command poll every 15 seconds

## Security Properties

- **Non-exportable keys**: Private keys never leave TPM/Keystore
- **Hardware-bound enrollment**: Codes can be bound to specific hardware fingerprints
- **Signature verification**: Every request signed with ECDSA P-256
- **Replay protection**: Sequence numbers and request IDs prevent replay attacks
- **Rate limiting**: 30 requests per minute per device key
- **No service account keys on devices**: Devices use hardware-backed signers only
- **Audit logging**: All enrollment and heartbeat events logged to Firestore `auditLog` collection

## Troubleshooting

### Enrollment code rejected
- Verify code is exactly 32 hexadecimal characters
- Check code has not expired (10-minute TTL)
- Ensure code is being used on the correct device (device-bound codes)
- Verify code has not already been consumed

### Hardware guard failed
- VivoBook: Must be ASUS/ASUSTeK with "VivoBook" in model name
- S24: Must be Samsung with model starting with `SM-S928`
- Lenovo laptops are explicitly rejected (guard against accidental enrollment)

### TPM/Keystore signer errors
- Windows: Verify TPM is enabled in BIOS and Platform Crypto Provider is available
- S24: Grant Termux:API all required permissions; reinstall Termux:API app if needed

### Daemon not starting persistently
- Windows: Check Task Scheduler for `EKA-VivoBook-Daemon` task
- S24: Check `~/.termux/boot/` script exists and is executable
- Review logs for specific error messages

## Current Connection State (as of 2026-09-03)

| Device | Enrolled | Key ID | Status |
|--------|----------|--------|--------|
| g4g-lenovo-laptop | ✅ Yes | `563a431d...` | Active (this machine) |
| jayti-asus-vivobook | ❌ No | — | Blocked on physical access |
| samsung-s24-ultra | ❌ No | — | Blocked on physical access |

Broker endpoints are live (HTTP 405 on GET = POST-only). The infrastructure is fully deployed and tested — remote devices need the install scripts run with valid enrollment codes.

## File Integrity

Broker Python artifacts are pinned to commit `183e600d0acd7e6171e35be904c657e7fe967384` with SHA-256 hashes:

| File | SHA-256 |
|------|---------|
| `device_agent.py` | `70a74469a2e004f671897b30f85a8759f684aca4ce1f5860bf39c7e12396d2f7` |
| `broker_client.py` | `e380867c5843e49c21d7e46704db20607389a9f1faad4b3cf61f9b4eab173bb1` |
| `signer.py` | `8aabf8e5fff25a067b02901ef4798d061a9c2b3d5844d72e59db1419112632f7` |
| `single_instance.py` | `1a572f39dc96599e8df55debe9ccd9bd8232cffecac08bbc898ff5fff4f9ef46` |
