#!/usr/bin/env python3
"""
Connect to Firestore and freeze/unfreeze devices by setting staleAlertState.
Usage: 
  python freeze_device.py --device samsung-s24-ultra --action freeze
  python freeze_device.py --device samsung-s24-ultra --action unfreeze
  python freeze_device.py --list  # List all devices
"""

import json
import pathlib
import sys
import argparse
from datetime import datetime, timezone

# Try to import firebase_admin
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("[!] firebase_admin not installed. Run: pip install firebase-admin")
    sys.exit(1)

# Environment variable name MUST match GitHub secret name exactly
FIREBASE_SA_ENV = "FIREBASE_SERVICE_ACCOUNT_JSON"

# Initialize Firebase
def init_firebase():
    """Initialize Firebase Admin SDK."""
    # Try common locations for service account key
    sa_paths = [
        pathlib.Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json"),
        pathlib.Path(__file__).parent / "serviceAccountKey.json",
        pathlib.Path.home() / ".config" / "eka" / "serviceAccountKey.json",
    ]
    
    sa_path = None
    for p in sa_paths:
        if p.exists():
            sa_path = p
            break
    
    if not sa_path:
        # Try environment variable (must match GitHub secret name)
        import os
        sa_json = os.environ.get(FIREBASE_SA_ENV)
        if sa_json:
            sa_path = "env"
            cred = credentials.Certificate(json.loads(sa_json))
        else:
            print("[!] No service account key found!")
            print(f"  Checked env var: {FIREBASE_SA_ENV}")
            for p in sa_paths:
                print(f"    - {p}")
            return None
    
    if sa_path == "env":
        print("[+] Loaded service account from environment")
        cred = credentials.Certificate(json.loads(sa_json))
    else:
        print(f"[+] Loaded service account from: {sa_path}")
        cred = credentials.Certificate(str(sa_path))
    
    # Get project ID from the service account
    project_id = cred.project_id
    print(f"[+] Project ID: {project_id}")
    
    # Try to initialize app
    db_name = "eka-agent"
    try:
        # Initialize with explicit project ID
        app = firebase_admin.initialize_app(credential=cred, options={})
        print(f"[+] Connected to Firestore (default database)")
        db = firestore.client(app)
        # Verify we can access the eka-agent database
        devices_ref = db.collection("devices")
        print(f"[+] Using database: {db_name}")
        return db
    except Exception as e:
        print(f"[!] Failed to initialize Firebase: {e}")
        return None


def list_devices(db):
    """List all devices in Firestore."""
    print("\n" + "="*60)
    print("DEVICES IN FIRESTORE")
    print("="*60)
    
    devices_ref = db.collection("devices")
    docs = devices_ref.stream()
    
    count = 0
    for doc in docs:
        count += 1
        data = doc.to_dict()
        print(f"\n{count}. {doc.id}")
        if "deviceDisplayName" in data:
            print(f"   Display: {data['deviceDisplayName']}")
        if "lastSeen" in data:
            print(f"   Last Seen: {data['lastSeen']}")
        if "online" in data:
            print(f"   Online: {data['online']}")
        if "staleAlert" in data and "state" in data["staleAlert"]:
            print(f"   Stale Alert State: {data['staleAlert']['state']}")
        else:
            print(f"   Stale Alert State: (not set)")
    
    if count == 0:
        print("\n[!] No devices found!")
    
    print("\n" + "="*60)
    return count


def freeze_device(db, device_id, action="freeze"):
    """Freeze or unfreeze a device by setting staleAlertState."""
    print(f"\n{'='*60}")
    print(f"{action.upper()} DEVICE: {device_id}")
    print("="*60)
    
    device_ref = db.collection("devices").document(device_id)
    doc = device_ref.get()
    
    if not doc.exists:
        print(f"[!] Device '{device_id}' not found!")
        return False
    
    data = doc.to_dict()
    print(f"\nCurrent state:")
    print(f"  Display Name: {data.get('deviceDisplayName', device_id)}")
    if "lastSeen" in data:
        print(f"  Last Seen: {data['lastSeen']}")
    if "online" in data:
        print(f"  Online: {data['online']}")
    
    current_state = None
    if "staleAlert" in data and "state" in data["staleAlert"]:
        current_state = data["staleAlert"]["state"]
    print(f"  Current Stale Alert State: {current_state or '(not set)'}")
    
    # Set new state
    new_state = "frozen" if action == "freeze" else "healthy"
    now_iso = datetime.now(timezone.utc).isoformat()
    
    print(f"\n  Setting staleAlertState to: {new_state}")
    
    try:
        device_ref.update({
            "staleAlert.state": new_state,
            "staleAlert.since": now_iso
        })
        print(f"\n[+] Device {device_id} successfully {action}d!")
        print(f"  New state: {new_state}")
        print(f"  Since: {now_iso}")
        return True
    except Exception as e:
        print(f"\n[!] Failed to update device: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Freeze/unfreeze devices in Firestore")
    parser.add_argument("--device", help="Device ID to freeze/unfreeze")
    parser.add_argument("--action", choices=["freeze", "unfreeze"], default="freeze",
                       help="Action to perform (default: freeze)")
    parser.add_argument("--list", action="store_true", help="List all devices")
    
    args = parser.parse_args()
    
    if not args.device and not args.list:
        parser.print_help()
        print("\n[!] Either --device or --list is required")
        sys.exit(1)
    
    db = init_firebase()
    if not db:
        sys.exit(1)
    
    if args.list:
        list_devices(db)
        sys.exit(0)
    
    success = freeze_device(db, args.device, args.action)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
