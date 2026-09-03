# SSH Mesh Device Control

Bidirectional SSH mesh for device control between three devices:
- **g4g-lenovo-laptop** (Windows 11)
- **jayti-asus-vivobook** (ASUS VivoBook, Windows 11)
- **samsung-s24-ultra** (Samsung S24 Ultra, Termux on Android 16)

## Architecture

All devices connect via direct SSH (port 22) with Ed25519 key-based authentication. No broker, no tunnels, no passwords.

## Quick Start

1. **On each device**, run the setup script to generate SSH keys and start the SSH server
2. **Exchange public keys** between all devices
3. **Test connections** with the test script

## Files

- `laptop/setup_laptop.ps1` - Laptop SSH setup
- `vivobook/setup_vivobook.ps1` - VivoBook SSH setup  
- `s24/setup_s24.sh` - S24 Termux SSH setup
- `exchange_keys.ps1` - Key distribution
- `test_connections.ps1` - Connection testing

## Security

- Ed25519 keys only
- Key-based auth (no passwords)
- Hardware guards verify device identity
- All devices must be on same trusted network
