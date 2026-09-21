#!/usr/bin/env python3
"""Export the S24's direct-cloud Firestore state to private local JSON.

No ADB is used. The real S24 Termux daemon is the only phone collector. It
writes its bounded datasets to Firestore; this laptop reads that cloud state,
materialises an auditable manifest plus gzip JSON Lines, and performs no cloud
writes. ``push_to_vercel.py`` is a separate, TPM-signed second step.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


DEVICE_ID = "samsung-s24-ultra"
DEFAULT_DATABASE = "eka-agent"
PHONE_HEARTBEAT_MAX_AGE_SECONDS = 5 * 60


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "Jayti" / "S24 Sync"


def as_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, bytes):
        return {"encoding": "base64", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "latitude") and hasattr(value, "longitude"):
        return {"latitude": value.latitude, "longitude": value.longitude}
    if hasattr(value, "path"):
        return {"document_path": value.path}
    return str(value)


def _age_seconds(value) -> float | None:
    moment = as_datetime(value)
    return None if moment is None else (datetime.now(timezone.utc) - moment).total_seconds()


def _fresh(age: float | None) -> bool:
    return age is not None and 0 <= age <= PHONE_HEARTBEAT_MAX_AGE_SECONDS


def phone_attestation(fields: dict) -> tuple[bool, str]:
    """Python mirror of s24LivenessVerdict() in Backend/lib/s24-attestation.js.

    _shared/tests/s24-attestation.test.mjs feeds this and the JS module the same
    documents. This copy once rejected connectionMethod='signed-broker-v2' and
    required sourceType='live_termux' while the broker writes 'live_daemon', so every
    payload a healthy broker-era phone produced was marked unattested and dropped.
    """
    heartbeat_age = _age_seconds(fields.get("lastSeen"))
    checks = {
        "freshLastSeen": _fresh(heartbeat_age),
        "agentVersion": str(fields.get("agentVersion") or "").startswith(("s24-termux-", "s24-direct-cloud-")),
        "heartbeatAuth": fields.get("heartbeatAuth") == "termux-phone",
        "liveDeviceVerified": fields.get("liveDeviceVerified") is True,
        "sourceType": fields.get("sourceType") in {"live_termux", "live_daemon"},
        "runtimeIsAndroid": fields.get("runtimeIsAndroid") is True,
    }
    method = fields.get("connectionMethod")
    if method == "signed-broker-v2":
        # The broker stamps these beside the enrollment only after it verifies the
        # signature, the active unexpired key and the enrolled hardware.
        enrollment = fields.get("enrollment") if isinstance(fields.get("enrollment"), dict) else {}
        active_key = enrollment.get("activeKeyId")
        checks["signedBrokerHeartbeat"] = (
            isinstance(enrollment.get("lastSignedHeartbeatAt"), str)
            and enrollment.get("lastSignedHeartbeatAt") == fields.get("lastSeen")
            and isinstance(active_key, str) and active_key != ""
            and enrollment.get("lastSignedHeartbeatKeyId") == active_key
            and enrollment.get("lastSignedHeartbeatProtocol") == "2"
        )
        checks["androidHardwareKey"] = enrollment.get("keyType") == "android-keystore-p256"
    elif method in {"termux-direct-cloud", "direct-daemon"}:
        # No server stamp on the legacy path, so a fresh completed ACK whose queue
        # entry agrees with it has to stand in for one.
        queue = fields.get("commandQueue") if isinstance(fields.get("commandQueue"), dict) else {}
        ack_id = fields.get("lastCommandAckId")
        entry = queue.get(ack_id) if isinstance(ack_id, str) else None
        checks["commandAckFresh"] = (
            _fresh(_age_seconds(fields.get("lastCommandAckAt")))
            and fields.get("lastCommandAckStatus") == "completed"
            and isinstance(entry, dict)
            and entry.get("status") == "completed"
            and isinstance(fields.get("lastCommandAckAt"), str)
            and entry.get("completedAt") == fields.get("lastCommandAckAt")
        )
    else:
        checks["connectionMethod"] = False
    failed = [name for name, passed in checks.items() if not passed]
    return not failed, "all phone-runtime checks passed" if not failed else "failed: " + ", ".join(failed)


def stable_id(payload: dict, preferred=None) -> str:
    if preferred not in (None, ""):
        return str(preferred)
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def make_record(dataset: str, payload: dict, preferred_id=None, occurred_at=None, label=None) -> dict:
    result = {
        "dataset": dataset,
        "record_id": stable_id(payload, preferred_id),
        "payload": json_safe(payload),
    }
    if occurred_at not in (None, ""):
        result["occurred_at"] = json_safe(occurred_at)
    if label not in (None, ""):
        result["label"] = str(label)[:400]
    return result


def dataset_status(name: str, status: str, count: int, source: str, detail: str = "", collected_at=None) -> dict:
    row = {
        "dataset": name,
        "status": status,
        "record_count": count,
        "source": source,
        "collected_at": json_safe(collected_at) if collected_at else utc_now(),
    }
    if detail:
        row["detail"] = detail[:2000]
    return row


def status_from_diagnostic(value: str | None, has_rows: bool) -> str:
    if has_rows:
        return "ok"
    return {
        "blocked": "denied",
        "unavailable": "unavailable",
        "error": "error",
        "empty": "empty",
    }.get(str(value or "").lower(), "empty")


def protect_directory(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o700)
        return
    user = os.environ.get("USERNAME")
    if user and shutil.which("icacls"):
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:(OI)(CI)F"],
            capture_output=True,
            timeout=30,
        )


def firestore_client(service_account: Path, database: str):
    if not service_account.is_file():
        raise RuntimeError(f"service-account file not found: {service_account}")
    app_name = f"s24-local-export-{uuid.uuid4().hex}"
    app = firebase_admin.initialize_app(credentials.Certificate(str(service_account)), name=app_name)
    return firestore.client(app=app, database_id=database), app


def collect(args: argparse.Namespace) -> Path:
    service_account = Path(args.service_account).expanduser().resolve()
    db, app = firestore_client(service_account, args.database)
    started_at = utc_now()
    try:
        ref = db.collection("devices").document(DEVICE_ID)
        snapshot = ref.get()
        if not snapshot.exists:
            raise RuntimeError(f"Firestore document devices/{DEVICE_ID} does not exist")
        fields = snapshot.to_dict() or {}
        attested, attestation_detail = phone_attestation(fields)

        datasets: list[dict] = []
        records: list[dict] = []
        doc_payload = json_safe(fields)
        records.append(make_record(
            "device_document", doc_payload, "current", fields.get("lastSeen"),
            fields.get("deviceDisplayName") or DEVICE_ID,
        ))
        datasets.append(dataset_status(
            "device_document", "ok", 1,
            f"firestore://{args.database}/devices/{DEVICE_ID}",
            f"Cloud control-plane snapshot; phone attestation {attestation_detail}.",
            snapshot.update_time,
        ))

        direct = fields.get("samsungS24DirectSync") if isinstance(fields.get("samsungS24DirectSync"), dict) else {}
        collection_diag = fields.get("samsungS24Collection") if isinstance(fields.get("samsungS24Collection"), dict) else {}
        synced_at = direct.get("syncedAt") or fields.get("lastSeen")
        for dataset, key, label_key in (
            ("direct_call_logs", "callLogs", "name"),
            ("direct_sms", "sms", "sender"),
        ):
            values = direct.get(key) if isinstance(direct.get(key), list) else []
            diagnostic = collection_diag.get(key) if isinstance(collection_diag.get(key), dict) else {}
            if not attested:
                values = []
                status = "unavailable"
                detail = "Latest direct-sync payload rejected: " + attestation_detail
            else:
                status = status_from_diagnostic(diagnostic.get("status"), bool(values))
                detail = str(diagnostic.get("detail") or "")
            for index, item in enumerate(values):
                payload = json_safe(item if isinstance(item, dict) else {"value": item})
                preferred = payload.get("_id") or payload.get("id")
                occurred = payload.get("timestamp") or payload.get("date") or synced_at
                label = payload.get(label_key) or payload.get("number") or payload.get("address")
                records.append(make_record(dataset, payload, preferred or f"{index}-{stable_id(payload)[:16]}", occurred, label))
            datasets.append(dataset_status(
                dataset, status, len(values),
                f"firestore://{args.database}/devices/{DEVICE_ID}/samsungS24DirectSync.{key}",
                detail, synced_at,
            ))

        location = direct.get("location") if isinstance(direct.get("location"), dict) else {}
        location_diag = collection_diag.get("location") if isinstance(collection_diag.get("location"), dict) else {}
        if attested and location and location.get("available") is not False:
            records.append(make_record("direct_location", location, "latest", synced_at, "Latest location"))
            location_status = "ok"
        elif attested:
            location_status = status_from_diagnostic(location_diag.get("status"), False)
        else:
            location_status = "unavailable"
        datasets.append(dataset_status(
            "direct_location", location_status, 1 if location_status == "ok" else 0,
            f"firestore://{args.database}/devices/{DEVICE_ID}/samsungS24DirectSync.location",
            str(location_diag.get("detail") or attestation_detail), synced_at,
        ))

        # Discover every device subcollection instead of maintaining a list.
        # A newly introduced phone dataset is therefore exported automatically
        # and appears in the dashboard coverage ledger on its first run.
        for collection in ref.collections():
            name = "firestore_" + collection.id.replace("-", "_")
            source = f"firestore://{args.database}/devices/{DEVICE_ID}/{collection.id}"
            try:
                count = 0
                newest = None
                for document in collection.stream():
                    payload = json_safe(document.to_dict() or {})
                    occurred = payload.get("timestamp") or payload.get("date") or payload.get("updatedAt") or payload.get("createdAt")
                    label = payload.get("name") or payload.get("filename") or payload.get("action") or payload.get("type")
                    records.append(make_record(name, payload, document.id, occurred, label))
                    count += 1
                    newest = document.update_time if newest is None or document.update_time > newest else newest
                detail = "Historical Firestore rows; retained with their original document ids."
                datasets.append(dataset_status(name, "ok" if count else "empty", count, source, detail, newest))
            except Exception as exc:  # one failed collection must remain visible without losing the rest
                datasets.append(dataset_status(name, "error", 0, source, str(exc)))
    finally:
        firebase_admin.delete_app(app)

    run_id = f"s24-cloud-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    run_dir = Path(args.output_root).expanduser().resolve() / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    protect_directory(run_dir.parent.parent)
    manifest = {
        "format": "jpbir-s24-direct-cloud-local-v1",
        "run": {
            "run_id": run_id,
            "device_id": DEVICE_ID,
            "started_at": started_at,
            "finished_at": utc_now(),
            "host": socket.gethostname(),
            "android_version": str(fields.get("androidVersion") or ""),
            "model": str(fields.get("model") or ""),
            "notes": f"No-ADB Firestore export. Latest phone attestation: {attestation_detail}.",
        },
        "datasets": datasets,
        "record_count": len(records),
    }
    records_path = run_dir / "records.jsonl.gz"
    with gzip.open(records_path, "wt", encoding="utf-8", newline="\n") as handle:
        for item in records:
            handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    manifest["records_sha256"] = hashlib.sha256(records_path.read_bytes()).hexdigest()
    (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (run_dir.parent.parent / "latest.txt").write_text(str(run_dir) + "\n", encoding="utf-8")
    return run_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service-account",
        default=os.environ.get("EKA_SERVICE_ACCOUNT_KEY", ""),
        required=not bool(os.environ.get("EKA_SERVICE_ACCOUNT_KEY")),
        help="local service-account JSON path (or EKA_SERVICE_ACCOUNT_KEY)",
    )
    parser.add_argument("--database", default=os.environ.get("EKA_FIRESTORE_DB", DEFAULT_DATABASE))
    parser.add_argument("--output-root", default=str(default_root()), help="private local sync root")
    args = parser.parse_args()
    try:
        run_dir = collect(args)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"cloud pull failed: {exc}", file=sys.stderr)
        return 1
    print(f"local direct-cloud export complete: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
