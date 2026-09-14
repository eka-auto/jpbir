#!/usr/bin/env python3
"""Upload one local S24 JSON export to Vercel with a P-256 signature.

Vercel does not accept SSH connections. This uses the equivalent asymmetric
trust boundary over HTTPS: the public key is configured in Vercel while the
private key stays non-exportable in this laptop's Windows TPM/CNG provider.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from signer import SoftwareP256Signer, WindowsCngSigner, key_id_from_pem


PROTO_VERSION = "2"
DEFAULT_ENDPOINT = "https://jaytipargal.tech/api/s24-ingest"
MAX_BODY_BYTES = 3_500_000
MAX_RECORDS = 500


def default_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "Jayti" / "S24 Sync"


def signer_from_args(args: argparse.Namespace):
    if args.software_key:
        return SoftwareP256Signer(args.software_key)
    if sys.platform != "win32":
        raise RuntimeError("the production signer requires Windows TPM/CNG; --software-key is test-only")
    return WindowsCngSigner(args.key_name)


def canonical(key_id: str, seq: str, timestamp: str, request_id: str, body_hash: str) -> str:
    return "\n".join((f"v{PROTO_VERSION}", key_id, "POST", "/api/s24-ingest", seq, timestamp, request_id, body_hash))


def verify_signer(signer, public_pem: str) -> None:
    probe = b"jpbir-s24-local-sync-signer-check"
    public_key = serialization.load_pem_public_key(public_pem.encode("ascii"))
    try:
        public_key.verify(signer.sign(probe), probe, ec.ECDSA(hashes.SHA256()))
    except Exception as exc:
        raise RuntimeError("the configured signer failed its local signature check") from exc


def next_sequence(root: Path) -> str:
    path = root / "sequence.txt"
    previous = 0
    try:
        previous = int(path.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        pass
    value = max(previous + 1, int(time.time() * 1000))
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(str(value), encoding="ascii")
    temp.replace(path)
    return str(value)


def latest_run(root: Path) -> Path:
    marker = root / "latest.txt"
    if marker.exists():
        candidate = Path(marker.read_text(encoding="utf-8").strip())
        if (candidate / "manifest.json").exists():
            return candidate
    runs = sorted((root / "runs").glob("*/manifest.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not runs:
        raise RuntimeError(f"no local export found under {root / 'runs'}; run pull_local.py first")
    return runs[0].parent


def read_export(run_dir: Path) -> tuple[dict, list[dict]]:
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    records_path = run_dir / "records.jsonl.gz"
    actual_hash = hashlib.sha256(records_path.read_bytes()).hexdigest()
    if actual_hash != manifest.get("records_sha256"):
        raise RuntimeError("local records hash does not match manifest; refusing altered export")
    records = []
    with gzip.open(records_path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            try:
                records.append(json.loads(line))
            except ValueError as exc:
                raise RuntimeError(f"invalid JSON record at line {line_number}") from exc
    if len(records) != manifest.get("record_count"):
        raise RuntimeError("local record count does not match manifest")
    return manifest, records


def encode_body(run: dict, datasets: list[dict], records: list[dict], upload: dict | None = None) -> bytes:
    return json.dumps(
        {"run": run, "datasets": datasets, "records": records, **({"upload": upload} if upload else {})},
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def record_chunks(run: dict, datasets: list[dict], records: list[dict]):
    if not records:
        yield []
        return
    current = []
    for item in records:
        candidate = current + [item]
        body = encode_body(run, datasets, candidate)
        if current and (len(candidate) > MAX_RECORDS or len(body) > MAX_BODY_BYTES):
            yield current
            current = [item]
            if len(encode_body(run, datasets, current)) > MAX_BODY_BYTES:
                raise RuntimeError(f"record {item.get('dataset')}/{item.get('record_id')} exceeds the upload body limit")
        else:
            current = candidate
    if current:
        yield current


def signed_headers(signer, key_id: str, body: bytes, root: Path) -> dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    request_id = str(uuid.uuid4())
    seq = next_sequence(root)
    body_hash = hashlib.sha256(body).hexdigest()
    signature = base64.b64encode(signer.sign(canonical(key_id, seq, timestamp, request_id, body_hash).encode("utf-8"))).decode("ascii")
    return {
        "Content-Type": "application/json",
        "X-Key-Id": key_id,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
        "X-Request-Id": request_id,
        "X-Seq": seq,
    }


def post(endpoint: str, body: bytes, headers: dict[str, str], attempts: int = 4) -> dict:
    # Retries retain the exact body, request id and signature. The server's
    # replay row then converts an ambiguous network timeout into a safe no-op.
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode("utf-8"))
                if not result.get("ok"):
                    raise RuntimeError(result.get("error") or "ingest rejected the batch")
                return result
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            if exc.code < 500 or attempt == attempts:
                raise RuntimeError(f"ingest HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == attempts:
                raise RuntimeError(f"ingest connection failed: {exc}") from exc
        time.sleep(min(2 ** (attempt - 1), 8))
    raise RuntimeError("upload retries exhausted")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", nargs="?", help="export directory; defaults to the newest local run")
    parser.add_argument("--root", default=str(default_root()), help="private local sync root")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--key-name", default="JP-S24-LOCAL-SYNC-P256", help="Windows CNG key name")
    parser.add_argument("--software-key", help="test only: use an exportable PEM private key")
    parser.add_argument("--print-public-key", action="store_true", help="print the public key and exit")
    args = parser.parse_args()
    try:
        root = Path(args.root).expanduser().resolve()
        signer = signer_from_args(args)
        public_pem = signer.public_key_pem()
        verify_signer(signer, public_pem)
        key_id = key_id_from_pem(public_pem)
        if args.print_public_key:
            print(public_pem.rstrip())
            print(f"key_id={key_id}", file=sys.stderr)
            return 0

        run_dir = Path(args.run_dir).expanduser().resolve() if args.run_dir else latest_run(root)
        manifest, records = read_export(run_dir)
        sent = 0
        batches = list(record_chunks(manifest["run"], manifest["datasets"], records))
        for index, batch_records in enumerate(batches, 1):
            body = encode_body(
                manifest["run"], manifest["datasets"], batch_records,
                {"batch_index": index, "batch_count": len(batches)},
            )
            result = post(args.endpoint, body, signed_headers(signer, key_id, body, root))
            sent += int(result.get("records") or 0)
            print(f"batch {index}/{len(batches)} accepted ({result.get('records', 0)} records)")
        print(f"upload complete: run={manifest['run']['run_id']} records={sent} key={key_id}")
        return 0
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"push failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
