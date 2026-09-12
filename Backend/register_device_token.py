#!/usr/bin/env python3
"""
Register Device FCM Token in Firestore.
Usage:
  python register_device_token.py <FCM_TOKEN> [DEVICE_ID]
"""

import sys
from pathlib import Path
import json
import firebase_admin
from firebase_admin import credentials, firestore

# Resolve paths
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SERVICE_ACCOUNT_PATH = ROOT_DIR / "serviceAccountKey.json"

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Register Device FCM Token in Firestore.")
    parser.add_argument("token", help="FCM token to register.")
    parser.add_argument("device_id", nargs="?", default="samsung-s24-ultra", help="Device document ID.")
    parser.add_argument("--json", action="store_true", help="Emit result as JSON.")
    args = parser.parse_args()

    if not SERVICE_ACCOUNT_PATH.exists():
        msg = {"ok": False, "error": f"Service account key not found at {SERVICE_ACCOUNT_PATH}"}
        print(json.dumps(msg, ensure_ascii=False) if args.json else msg["error"])
        sys.exit(1)

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))

    db = firestore.client()

    doc_ref = db.collection('devices').document(args.device_id)
    doc_ref.set({
        'deviceName': 'Samsung S24 Ultra' if args.device_id == "samsung-s24-ultra" else args.device_id,
        'fcmToken': args.token,
        'updatedAt': firestore.SERVER_TIMESTAMP
    }, merge=True)

    msg = {"ok": True, "device_id": args.device_id}
    print(json.dumps(msg, ensure_ascii=False) if args.json else f"Successfully registered token for '{args.device_id}' in Firestore.")
    sys.exit(0)

if __name__ == "__main__":
    main()
