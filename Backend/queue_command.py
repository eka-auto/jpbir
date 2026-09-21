#!/usr/bin/env python3
"""
Queue a benign command on a device via the Firestore direct-cloud commandQueue,
authenticated with the Firebase service account.

Only actions in the S24 runtime contract are allowed here.
The command executes on the device only when its daemon polls the queue.

Usage:
  python queue_command.py --device samsung-s24-ultra --action status-only
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
    print("[ERROR] firebase_admin not installed. Run: pip install firebase-admin")
    sys.exit(1)

# Exact mirror of Devices/S24/runtime_contract.json command.allowlistedActions.
# _shared/tests/s24-action-gate.test.mjs fails if this writer drifts.
ALLOWED_ACTIONS = {
    "status-only", "ping", "echo", "wa-push", "wa-media-push", "sync-now"
}

FIREBASE_SA_ENV = "FIREBASE_SERVICE_ACCOUNT_JSON"


def init_firebase():
    sa_paths = [
        pathlib.Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json"),
        pathlib.Path(__file__).parent / "serviceAccountKey.json",
    ]
    sa_path = next((p for p in sa_paths if p.exists()), None)
    if not sa_path:
        import os
        sa_json = os.environ.get(FIREBASE_SA_ENV)
        if not sa_json:
            print("[ERROR] No service account key found")
            return None, None
        cred = credentials.Certificate(json.loads(sa_json))
    else:
        print(f"[OK] Service account: {sa_path}")
        cred = credentials.Certificate(str(sa_path))

    print(f"[OK] Project: {cred.project_id}")
    print(f"[OK] Service account email: {cred.service_account_email}")
    app = firebase_admin.initialize_app(credential=cred, options={})
    return firestore.client(app, database_id="eka-agent"), cred


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="samsung-s24-ultra")
    parser.add_argument("--action", default="status-only")
    args = parser.parse_args()

    if args.action not in ALLOWED_ACTIONS:
        print(f"[ERROR] Action '{args.action}' not allowed. Choose from: {sorted(ALLOWED_ACTIONS)}")
        sys.exit(1)

    db, cred = init_firebase()
    if not db:
        sys.exit(1)

    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "action": args.action,
        "status": "pending",
        "queuedAt": now_iso,
        "queuedBy": cred.service_account_email,
    }

    ref = db.collection("devices").document(args.device)
    if not ref.get().exists:
        print(f"[ERROR] Device '{args.device}' not found")
        sys.exit(1)

    ref.update({f"commandQueue.{args.action}": entry})
    print(f"[OK] Queued '{args.action}' on {args.device} (status=pending)")
    print("[INFO] It executes on the device only when its daemon polls the queue.")


if __name__ == "__main__":
    main()
