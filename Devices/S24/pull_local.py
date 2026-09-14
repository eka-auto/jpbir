#!/usr/bin/env python3
"""Pull the Samsung S24 into a local, auditable JSON export.

The laptop is deliberately the first durable sync point. This command talks to
the phone only through ADB, writes a manifest plus gzip-compressed JSON Lines,
and never calls Vercel. Every attempted dataset receives a status row, including
permission denials and empty providers, so missing phone data is never silent.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


DEVICE_ID = "samsung-s24-ultra"
MODEL_PATTERN = re.compile(r"^SM-S928", re.IGNORECASE)
CONTENT_DATASETS = (
    ("call_log", "content://call_log/calls", "_id:number:type:date:duration:name"),
    ("sms", "content://sms", "_id:thread_id:address:date:type:read:status:body"),
    ("contacts", "content://com.android.contacts/contacts", "_id:display_name:last_time_contacted:times_contacted"),
    ("calendar", "content://com.android.calendar/events", "_id:title:dtstart:dtend:eventLocation:description"),
    ("images", "content://media/external/images/media", "_id:_display_name:date_added:date_modified:mime_type:size:relative_path"),
    ("videos", "content://media/external/video/media", "_id:_display_name:date_added:date_modified:mime_type:size:duration:relative_path"),
    ("audio", "content://media/external/audio/media", "_id:_display_name:title:artist:album:date_added:mime_type:size:duration:relative_path"),
    ("downloads", "content://media/external/downloads", "_id:_display_name:date_added:date_modified:mime_type:size:relative_path"),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "Jayti" / "S24 Sync"


def run(command: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def adb(adb_path: str, serial: str, *args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return run([adb_path, "-s", serial, *args], timeout=timeout)


def choose_device(adb_path: str, requested: str | None) -> str:
    result = run([adb_path, "devices"], timeout=30)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "adb devices failed")
    devices = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.strip().split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    if requested:
        if requested not in devices:
            raise RuntimeError(f"ADB device {requested!r} is not attached and authorised")
        return requested
    if not devices:
        raise RuntimeError("no authorised ADB device is attached; connect USB debugging or pair wireless ADB first")
    if len(devices) > 1:
        raise RuntimeError("multiple ADB devices are attached; select one with --serial")
    return devices[0]


def shell_text(adb_path: str, serial: str, *args: str, timeout: int = 90) -> str:
    result = adb(adb_path, serial, "shell", *args, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or f"adb shell {' '.join(args)} failed")
    return result.stdout.replace("\r\n", "\n").strip()


def classify_error(message: str) -> str:
    lowered = message.lower()
    if "permission denial" in lowered or "securityexception" in lowered or "not allowed" in lowered:
        return "denied"
    if "unknown uri" in lowered or "not found" in lowered or "no such" in lowered:
        return "unavailable"
    return "error"


def split_content_fields(text: str) -> dict[str, str | None]:
    # `content query` prints `Row: N key=value, key=value`. A value may contain
    # commas; split only where the following token looks like another column.
    text = re.sub(r"^Row:\s*\d+\s*", "", text.strip())
    fields: dict[str, str | None] = {}
    for part in re.split(r",\s+(?=[A-Za-z_][A-Za-z0-9_]*=)", text):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        fields[key] = None if value == "NULL" else value
    return fields


def record(dataset: str, payload: dict, record_id: object | None = None, occurred_at: object | None = None) -> dict:
    stable = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    rid = record_id if record_id not in (None, "") else hashlib.sha256(stable.encode("utf-8")).hexdigest()
    label = next((payload.get(k) for k in ("display_name", "_display_name", "name", "title", "package", "number", "address", "path") if payload.get(k)), None)
    out = {"dataset": dataset, "record_id": str(rid), "payload": payload}
    if occurred_at not in (None, ""):
        out["occurred_at"] = occurred_at
    if label not in (None, ""):
        out["label"] = str(label)[:400]
    return out


def content_dataset(adb_path: str, serial: str, dataset: str, uri: str, projection: str) -> tuple[dict, list[dict]]:
    source = f"adb shell content query --uri {uri} --projection {projection}"
    result = adb(adb_path, serial, "shell", "content", "query", "--uri", uri, "--projection", projection, timeout=180)
    output = (result.stdout or "").replace("\r\n", "\n").strip()
    error = (result.stderr or "").strip()
    if result.returncode or "Permission Denial" in output or "SecurityException" in output:
        detail = (error or output or "provider query failed")[:2000]
        return {"dataset": dataset, "status": classify_error(detail), "record_count": 0, "source": source, "detail": detail, "collected_at": utc_now()}, []
    rows = []
    for line in output.splitlines():
        if not line.startswith("Row:"):
            continue
        payload = split_content_fields(line)
        occurred = payload.get("date") or payload.get("date_added") or payload.get("dtstart") or payload.get("last_time_contacted")
        rows.append(record(dataset, payload, payload.get("_id"), occurred))
    status = "ok" if rows else "empty"
    return {"dataset": dataset, "status": status, "record_count": len(rows), "source": source, "collected_at": utc_now()}, rows


def simple_dataset(dataset: str, source: str, producer) -> tuple[dict, list[dict]]:
    collected = utc_now()
    try:
        rows = producer()
        return {"dataset": dataset, "status": "ok" if rows else "empty", "record_count": len(rows), "source": source, "collected_at": collected}, rows
    except Exception as exc:  # each dataset must fail independently
        detail = str(exc)[:2000]
        return {"dataset": dataset, "status": classify_error(detail), "record_count": 0, "source": source, "detail": detail, "collected_at": collected}, []


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


def collect(args: argparse.Namespace) -> Path:
    adb_path = shutil.which(args.adb) or args.adb
    serial = choose_device(adb_path, args.serial)
    model = shell_text(adb_path, serial, "getprop", "ro.product.model", timeout=30)
    manufacturer = shell_text(adb_path, serial, "getprop", "ro.product.manufacturer", timeout=30)
    if manufacturer.lower() != "samsung" or not MODEL_PATTERN.match(model):
        raise RuntimeError(f"refusing non-S24 device: manufacturer={manufacturer!r} model={model!r}")

    started = utc_now()
    run_id = f"s24-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    run_dir = Path(args.output_root).expanduser().resolve() / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    protect_directory(run_dir.parent.parent)

    datasets: list[dict] = []
    records: list[dict] = []

    props = {
        "manufacturer": manufacturer,
        "model": model,
        "android_version": shell_text(adb_path, serial, "getprop", "ro.build.version.release", timeout=30),
        "sdk": shell_text(adb_path, serial, "getprop", "ro.build.version.sdk", timeout=30),
        "build_fingerprint": shell_text(adb_path, serial, "getprop", "ro.build.fingerprint", timeout=30),
        "security_patch": shell_text(adb_path, serial, "getprop", "ro.build.version.security_patch", timeout=30),
        "serial_sha256": hashlib.sha256(serial.encode("utf-8")).hexdigest(),
    }
    datasets.append({"dataset": "device_info", "status": "ok", "record_count": 1, "source": "adb shell getprop", "collected_at": utc_now()})
    records.append(record("device_info", props, "device"))

    def package_rows() -> list[dict]:
        output = shell_text(adb_path, serial, "pm", "list", "packages", "-f", "-U", timeout=180)
        rows = []
        for line in output.splitlines():
            match = re.match(r"^package:(.*?)=([^\s]+)(?:\s+uid:(\d+))?", line.strip())
            if match:
                payload = {"apk_path": match.group(1), "package": match.group(2), "uid": match.group(3)}
                rows.append(record("apps", payload, match.group(2)))
        return rows

    status, rows = simple_dataset("apps", "adb shell pm list packages -f -U", package_rows)
    datasets.append(status); records.extend(rows)

    for spec in CONTENT_DATASETS:
        status, rows = content_dataset(adb_path, serial, *spec)
        datasets.append(status); records.extend(rows)

    def file_rows() -> list[dict]:
        output = shell_text(adb_path, serial, "find", "/sdcard", "-type", "f", timeout=300)
        return [record("shared_files", {"path": line}, line) for line in output.splitlines() if line.startswith("/")]

    status, rows = simple_dataset("shared_files", "adb shell find /sdcard -type f", file_rows)
    datasets.append(status); records.extend(rows)

    def text_snapshot(dataset: str, command: tuple[str, ...], timeout: int = 120) -> None:
        source = "adb shell " + " ".join(command)
        def produce() -> list[dict]:
            value = shell_text(adb_path, serial, *command, timeout=timeout)
            return [record(dataset, {"text": value}, "snapshot")] if value else []
        status_row, rows_out = simple_dataset(dataset, source, produce)
        datasets.append(status_row); records.extend(rows_out)

    text_snapshot("battery", ("dumpsys", "battery"))
    text_snapshot("storage", ("df", "-k"))
    text_snapshot("network", ("dumpsys", "connectivity"), 180)
    text_snapshot("notifications", ("dumpsys", "notification", "--noredact"), 180)

    manifest = {
        "format": "jpbir-s24-local-sync-v1",
        "run": {
            "run_id": run_id,
            "device_id": DEVICE_ID,
            "started_at": started,
            "finished_at": utc_now(),
            "host": socket.gethostname(),
            "adb_serial": hashlib.sha256(serial.encode("utf-8")).hexdigest()[:16],
            "android_version": props["android_version"],
            "model": model,
            "notes": "Local-first ADB export; serial identifiers are hashed before storage.",
        },
        "datasets": datasets,
        "record_count": len(records),
    }
    records_path = run_dir / "records.jsonl.gz"
    with gzip.open(records_path, "wt", encoding="utf-8", newline="\n") as handle:
        for item in records:
            handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    manifest["records_sha256"] = hashlib.sha256(records_path.read_bytes()).hexdigest()
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (run_dir.parent.parent / "latest.txt").write_text(str(run_dir) + "\n", encoding="utf-8")
    return run_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", help="ADB serial when more than one device is attached")
    parser.add_argument("--adb", default="adb", help="adb executable or path")
    parser.add_argument("--output-root", default=str(default_root()), help="private local sync root")
    args = parser.parse_args()
    try:
        run_dir = collect(args)
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"pull failed: {exc}", file=sys.stderr)
        return 1
    print(f"local export complete: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
