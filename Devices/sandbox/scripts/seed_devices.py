#!/usr/bin/env python3
"""Seed the Firestore ``devices`` collection from ``devices.json``.

Reads the sandbox's registry file, and for each entry writes a document at
``devices/<id>`` with an initial ``enrolled=false`` state. This exists so a
fresh deployment has something to render on the dashboard before any physical
device has enrolled — enrollment itself is done by the on-device agent, not
this script.

Usage:

    export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/sa.json)"
    python scripts/seed_devices.py                    # dry-run
    python scripts/seed_devices.py --write            # actually write
    python scripts/seed_devices.py --write --allow-production   # overrides the
                                                                # sandbox-mode guard

Refuses to write against ``mode:"real"`` without ``--allow-production`` so an
accidental run against a live collection can't stomp on it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_SANDBOX_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_SANDBOX_DIR))

from firestore_client import FirestoreClient  # noqa: E402


def load_config():
    raw = os.environ.get("SANDBOX_CONFIG_JSON")
    if raw:
        return json.loads(raw)
    with (REPO_SANDBOX_DIR / "devices.json").open("r", encoding="utf-8") as f:
        return json.load(f)


def load_credential():
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not raw:
        raise SystemExit(
            "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Export it as the JSON "
            "content of your service-account key file:\n"
            '    export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/sa.json)"'
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: {exc}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Actually write to Firestore. Without this the script prints what "
             "it would write and exits.",
    )
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="Required to write against a config with mode=real.",
    )
    parser.add_argument(
        "--devices-file",
        type=Path,
        default=REPO_SANDBOX_DIR / "devices.json",
        help="Alternative devices registry to seed from.",
    )
    args = parser.parse_args()

    cfg = load_config()
    with args.devices_file.open("r", encoding="utf-8") as f:
        registry = json.load(f)

    mode = cfg.get("mode", "emulator")
    project = cfg.get("project")
    database = cfg.get("database", "(default)")
    collection = cfg.get("collection", "devices")

    print(f"target: {project}/{database}/{collection} (mode={mode})")
    print(f"seeding {len(registry.get('devices', []))} devices")

    if args.write and mode == "real" and not args.allow_production:
        raise SystemExit(
            "config has mode=real; pass --allow-production to write. "
            "The guard exists so a stray run can't stomp on a live collection."
        )

    if not args.write:
        for dev in registry.get("devices", []):
            print(f"  DRY-RUN would write {collection}/{dev['id']}: {dev}")
        print("re-run with --write to actually seed")
        return

    cred = load_credential()
    client = FirestoreClient(
        project=project,
        database=database,
        service_account_info=cred,
        service_account_key=None,
        scope=cfg["firestore_scope"],
        mode=mode,
        collection=collection,
        allow_production_devices=args.allow_production,
    )

    now = datetime.now(timezone.utc).isoformat()
    written = 0
    for dev in registry.get("devices", []):
        doc = {
            "deviceId": dev["id"],
            "displayName": dev.get("display_name") or dev["id"],
            "type": dev.get("type"),
            "model": dev.get("model"),
            "role": dev.get("role"),
            "enrolled": False,
            "seededAt": now,
            "status": {
                "online": False,
                "lastSeen": None,
                "batteryLevel": None,
                "agentVersion": None,
            },
        }
        client.set_doc(collection, dev["id"], doc)
        print(f"  wrote {collection}/{dev['id']}")
        written += 1

    print(f"done — {written} document(s) written to {project}/{database}/{collection}")


if __name__ == "__main__":
    main()
