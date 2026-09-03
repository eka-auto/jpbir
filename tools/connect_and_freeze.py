#!/usr/bin/env python3
"""
Connect (enroll) a device in Firestore and optionally freeze it.
Usage:
  python connect_and_freeze.py --device samsung-s24-ultra --display "Samsung S24 Ultra"
  python connect_and_freeze.py --device jayti-asus-vivobook --display "ASUS VivoBook" --freeze
"""

import json
import pathlib
import sys
import argparse
from datetime import datetime, timezone

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("[!] firebase_admin not installed. Run: pip install firebase-admin")
    sys.exit(1)

FIREBASE_SA_ENV = "FIREBASE_SERVICE_ACCOUNT_JSON"

def init_firebase():
    """Initialize Firebase Admin SDK."""
    sa_paths = [
        pathlib.Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json"),
        pathlib.Path(__file__).parent / "serviceAccountKey.json",
    ]
    
    sa_path = None
    for p in sa_paths:
        if p.exists():
            sa_path = p
            break
    
    if not sa_path:
        import os
        sa_json = os.environ.get(FIREBASE_SA_ENV)
        if sa_json:
            sa_path = "env"
            cred = credentials.Certificate(json.loads(sa_json))
        else:
            print("[ERROR] No service account key found!")
            return None
    
    if sa_path == "env":
        print("[OK] Loaded service account from environment")
        cred = credentials.Certificate(json.loads(sa_json))
    else:
        print(f"[OK] Loaded service account from: {sa_path}")
        cred = credentials.Certificate(str(sa_path))
    
    project_id = cred.project_id
    print(f"[OK] Project ID: {project_id}")
    
    try:
        app = firebase_admin.initialize_app(credential=cred, options={})
        print(f"[OK] Connected to Firestore")
        return firestore.client(app), project_id
    except Exception as e:
        print(f"[ERROR] Failed to initialize Firebase: {e}")
        return None, None


def connect_device(db, device_id, display_name, device_type="phone", online=True):
    """Enroll/connect a device in Firestore."""
    print(f"\n{'='*60}")
    print(f"CONNECT DEVICE: {device_id}")
    print("="*60)
    
    device_ref = db.collection("devices").document(device_id)
    doc = device_ref.get()
    
    if doc.exists:
        print(f"[INFO] Device '{device_id}' already exists")
        data = doc.to_dict()
        print(f"  Current state:")
        print(f"    Display: {data.get('deviceDisplayName', 'N/A')}")
        print(f"    Online: {data.get('online', False)}")
        print(f"    Last Seen: {data.get('lastSeen', 'N/A')}")
        return True, data
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    device_data = {
        "deviceId": device_id,
        "deviceDisplayName": display_name,
        "deviceType": device_type,
        "online": online,
        "lastSeen": now_iso,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "enrollment": {
            "seq": 0,
            "lastRequestIds": [],
            "lastHeartbeatAt": now_iso,
        },
        "staleAlert": {
            "state": "healthy",
            "since": now_iso,
        },
    }
    
    try:
        device_ref.set(device_data)
        print(f"\n[OK] Device '{device_id}' connected successfully!")
        print(f"  Display Name: {display_name}")
        print(f"  Type: {device_type}")
        print(f"  Online: {online}")
        print(f"  Stale Alert State: healthy")
        return True, device_data
    except Exception as e:
        print(f"\n[ERROR] Failed to connect device: {e}")
        return False, None


def freeze_device(db, device_id):
    """Freeze a device by setting staleAlertState to 'frozen'."""
    print(f"\n{'='*60}")
    print(f"FREEZE DEVICE: {device_id}")
    print("="*60)
    
    device_ref = db.collection("devices").document(device_id)
    doc = device_ref.get()
    
    if not doc.exists:
        print(f"[!] Device '{device_id}' not found! Connect it first.")
        return False
    
    data = doc.to_dict()
    print(f"\nCurrent state:")
    print(f"  Display Name: {data.get('deviceDisplayName', device_id)}")
    print(f"  Online: {data.get('online', False)}")
    if "lastSeen" in data:
        print(f"  Last Seen: {data['lastSeen']}")
    
    current_state = None
    if "staleAlert" in data and "state" in data["staleAlert"]:
        current_state = data["staleAlert"]["state"]
    print(f"  Current Stale Alert State: {current_state or '(not set)'}")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    try:
        device_ref.update({
            "staleAlert.state": "frozen",
            "staleAlert.since": now_iso,
        })
        print(f"\n[+] Device '{device_id}' frozen successfully!")
        print(f"  New state: frozen")
        print(f"  Since: {now_iso}")
        return True
    except Exception as e:
        print(f"\n[!] Failed to freeze device: {e}")
        return False


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
        if "deviceType" in data:
            print(f"   Type: {data['deviceType']}")
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


def main():
    parser = argparse.ArgumentParser(description="Connect and freeze devices in Firestore")
    parser.add_argument("--device", help="Device ID to connect/freeze")
    parser.add_argument("--display", help="Display name for the device")
    parser.add_argument("--type", default="phone", choices=["phone", "laptop", "desktop"],
                       help="Device type (default: phone)")
    parser.add_argument("--freeze", action="store_true", help="Freeze the device after connecting")
    parser.add_argument("--list", action="store_true", help="List all devices")
    
    args = parser.parse_args()
    
    if not args.device and not args.list:
        parser.print_help()
        print("\n[!] Either --device or --list is required")
        sys.exit(1)
    
    db, project_id = init_firebase()
    if not db:
        sys.exit(1)
    
    if args.list:
        list_devices(db)
        sys.exit(0)
    
    if not args.display:
        print("[!] --display is required when connecting a device")
        sys.exit(1)
    
    success, data = connect_device(db, args.device, args.display, args.type)
    if not success:
        sys.exit(1)
    
    if args.freeze:
        freeze_device(db, args.device)
    
    sys.exit(0)


if __name__ == "__main__":
    main()
