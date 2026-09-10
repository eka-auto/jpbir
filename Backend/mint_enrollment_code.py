#!/usr/bin/env python3
"""Admin tool for broker v2 enrollment codes (Google ADC, no SA files).

Usage:
  python mint_enrollment_code.py mint <deviceId> [--key-type tpm-cng-p256] [--allow-software]
  python mint_enrollment_code.py revoke <code>
  python mint_enrollment_code.py revoke-device <deviceId>
  python mint_enrollment_code.py list

Codes are stored ONLY as SHA-256 hashes (doc id = sha256(code)); the raw code
is printed exactly once and never logged. Codes are bound to a canonical
device id, an expected hardware fingerprint and a key type, expire after ten
minutes, and allow five enrollment attempts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import sys
from datetime import datetime, timedelta, timezone

import requests

PROJECT = "intrepid-stage-495117-q1"
DATABASE = "eka-agent"
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5

ALLOWED_DEVICES = {
    "g4g-lenovo-laptop": {
        "hardwareFingerprint": {"manufacturer": "^LENOVO$", "model": "^82KA"},
        "defaultKeyType": "tpm-cng-p256",
    },
    "jayti-asus-vivobook": {
        "hardwareFingerprint": {"manufacturer": "ASUSTeK|ASUS", "model": "VivoBook"},
        "defaultKeyType": "tpm-cng-p256",
    },
    "samsung-s24-ultra": {
        "hardwareFingerprint": {"model": "^SM-S928"},
        "defaultKeyType": "android-keystore-p256",
    },
}

DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore"


def adc_token():
    import google.auth
    import google.auth.transport.requests

    credentials, project = google.auth.default(scopes=[DATASTORE_SCOPE])
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token


def base_uri():
    return f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents"


def enc(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": v}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [enc(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: enc(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def dec(v):
    if not v:
        return None
    if "stringValue" in v:
        return v["stringValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: dec(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v:
        return [dec(x) for x in v["arrayValue"].get("values", [])]
    return None


def fs_get(token, path):
    r = requests.get(f"{base_uri()}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def fs_patch(token, path, fields):
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    r = requests.patch(
        f"{base_uri()}{path}?{mask}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"fields": {key: enc(value) for key, value in fields.items()}},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def fs_list(token, collection):
    r = requests.get(
        f"{base_uri()}/{collection}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json().get("documents", [])


def cmd_mint(args):
    if args.device_id not in ALLOWED_DEVICES:
        print(f"ERROR: unknown device id. Allowed: {sorted(ALLOWED_DEVICES)}", file=sys.stderr)
        return 2
    spec = ALLOWED_DEVICES[args.device_id]
    key_type = args.key_type or spec["defaultKeyType"]

    token = adc_token()
    code = secrets.token_hex(16)
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    fields = {
        "deviceId": args.device_id,
        "keyType": key_type,
        "hardwareFingerprint": spec["hardwareFingerprint"],
        "allowSoftware": bool(args.allow_software),
        "expiresAt": (now + timedelta(minutes=CODE_TTL_MINUTES)).isoformat(),
        "maxAttempts": MAX_ATTEMPTS,
        "attempts": 0,
        "consumed": False,
        "revoked": False,
        "createdAt": now.isoformat(),
    }
    fs_patch(token, f"/enrollmentCodes/{code_hash}", fields)

    print(f"Enrollment code minted for {args.device_id} (keyType={key_type})")
    print(f"  expires:   {fields['expiresAt']} ({CODE_TTL_MINUTES} min)")
    print(f"  attempts:  {MAX_ATTEMPTS}")
    print(f"  code:      {code}")
    print("The code is shown once. Only its SHA-256 hash is stored.")
    return 0


def cmd_revoke(args):
    token = adc_token()
    code_hash = hashlib.sha256(args.code.strip().lower().encode()).hexdigest()
    doc = fs_get(token, f"/enrollmentCodes/{code_hash}")
    if not doc:
        print("ERROR: no enrollment code matches that hash", file=sys.stderr)
        return 1
    fs_patch(token, f"/enrollmentCodes/{code_hash}", {"revoked": True, "revokedAt": datetime.now(timezone.utc).isoformat()})
    print("code revoked")
    return 0


def cmd_revoke_device(args):
    if args.device_id not in ALLOWED_DEVICES:
        print(f"ERROR: unknown device id. Allowed: {sorted(ALLOWED_DEVICES)}", file=sys.stderr)
        return 2
    token = adc_token()
    revoked = 0
    now = datetime.now(timezone.utc).isoformat()
    for doc in fs_list(token, "enrollmentCodes"):
        fields = {key: dec(value) for key, value in (doc.get("fields") or {}).items()}
        if fields.get("deviceId") != args.device_id:
            continue
        if fields.get("consumed") is True or fields.get("revoked") is True:
            continue
        document_id = doc["name"].rsplit("/", 1)[-1]
        fs_patch(token, f"/enrollmentCodes/{document_id}", {"revoked": True, "revokedAt": now})
        revoked += 1
    print(f"revoked {revoked} active code(s) for {args.device_id}")
    return 0


def cmd_list(args):
    token = adc_token()
    docs = fs_list(token, "enrollmentCodes")
    if not docs:
        print("no enrollment codes")
        return 0
    for doc in docs:
        f = {k: dec(v) for k, v in (doc.get("fields") or {}).items()}
        print(
            f"hash={doc['name'].split('/')[-1][:12]}... device={f.get('deviceId')} "
            f"keyType={f.get('keyType')} consumed={f.get('consumed')} revoked={f.get('revoked')} "
            f"attempts={f.get('attempts')}/{f.get('maxAttempts')} expiresAt={f.get('expiresAt')}"
        )
    return 0


def main():
    p = argparse.ArgumentParser(description="Broker v2 enrollment code admin (Google ADC)")
    sub = p.add_subparsers(dest="cmd", required=True)

    pm = sub.add_parser("mint", help="mint a one-time code")
    pm.add_argument("device_id")
    pm.add_argument("--key-type", choices=["tpm-cng-p256", "android-keystore-p256", "software-p256"])
    pm.add_argument("--allow-software", action="store_true", help="permit software-key enrollment with this code")

    pr = sub.add_parser("revoke", help="revoke a code by its raw value")
    pr.add_argument("code")

    prd = sub.add_parser("revoke-device", help="revoke every unconsumed code for a device")
    prd.add_argument("device_id")

    sub.add_parser("list", help="list code metadata (hashes only)")

    args = p.parse_args()
    handlers = {
        "mint": cmd_mint,
        "revoke": cmd_revoke,
        "revoke-device": cmd_revoke_device,
        "list": cmd_list,
    }
    sys.exit(handlers[args.cmd](args))


if __name__ == "__main__":
    main()
