#!/usr/bin/env python3
"""Audit a Hugging Face bucket without emitting credential values.

The input listing is produced by ``hf buckets list ... --recursive --format
json``. Selected objects are downloaded in bounded batches, scanned as bytes,
and deleted immediately. The report contains only counts, pattern categories,
and remote object paths.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from huggingface_hub import HfApi


TEXT_EXTENSIONS = {
    ".bat",
    ".cfg",
    ".cjs",
    ".cmd",
    ".conf",
    ".csv",
    ".env",
    ".htm",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsonl",
    ".log",
    ".md",
    ".mjs",
    ".properties",
    ".ps1",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

SENSITIVE_BASENAME = re.compile(
    r"(?i)^(?:"
    r"login data(?: for account)?|cookies|web data|local state|preferences|"
    r"secure preferences|credentials?|secrets?|tokens?|passwords?|"
    r"\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|p12|pfx)"
    r")$"
)

PATH_GROUPS = {
    "raw_password_export": "jt_agent_segregated/sensitive/Jayati_Raw_Passwords/",
    "encrypted_sensitive_archive": "jt_agent_segregated/sensitive/encrypted/",
    "chrome_forensic_output": "jt_agent_segregated/chrome/chrome_forensic_output/",
    "chrome_profile_data": "jt_agent_segregated/chrome/temp_chrome",
    "whatsapp_data": "jt_agent_segregated/whatsapp/",
}

PATTERNS = {
    "anthropic_key": re.compile(rb"sk-ant-[A-Za-z0-9_-]{20,}"),
    "openrouter_key": re.compile(rb"sk-or-v1-[A-Za-z0-9_-]{20,}"),
    "openai_style_key": re.compile(rb"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}"),
    "hugging_face_token": re.compile(rb"hf_[A-Za-z0-9]{20,}"),
    "github_token": re.compile(
        rb"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"
    ),
    "google_api_key": re.compile(rb"AIza[0-9A-Za-z_-]{35}"),
    "aws_access_key": re.compile(rb"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    "private_key_pem": re.compile(
        rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    ),
    "google_service_account": re.compile(
        rb'"type"\s*:\s*"service_account"[\s\S]{0,4096}'
        rb'"private_key"\s*:'
    ),
    "generic_secret_assignment": re.compile(
        rb"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|"
        rb"password|passwd|client[_-]?secret)\b\s*[\"']?\s*[:=]\s*"
        rb"[\"']?[^\s\"']{8,}"
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket-id", required=True)
    parser.add_argument("--listing", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-object-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-total-bytes", type=int, default=500_000_000)
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--visibility-at-listing", choices=("public", "private"))
    return parser.parse_args()


def selected_for_content_scan(item: dict, max_object_bytes: int) -> bool:
    path = item["path"]
    size = int(item.get("size") or 0)
    if size > max_object_bytes:
        return False
    suffix = PurePosixPath(path).suffix.lower()
    basename = PurePosixPath(path).name
    return (
        suffix in TEXT_EXTENSIONS
        or path.startswith(PATH_GROUPS["raw_password_export"])
        or SENSITIVE_BASENAME.fullmatch(basename) is not None
    )


def group_stats(files: list[dict]) -> dict:
    output = {}
    for label, prefix in PATH_GROUPS.items():
        grouped = [item for item in files if item["path"].startswith(prefix)]
        output[label] = {
            "prefix": prefix,
            "file_count": len(grouped),
            "total_bytes": sum(int(item.get("size") or 0) for item in grouped),
            "largest_object_bytes": max(
                (int(item.get("size") or 0) for item in grouped), default=0
            ),
        }
    return output


def scan_file(path: Path) -> tuple[list[str], Counter]:
    content = path.read_bytes()
    categories = []
    occurrences = Counter()
    for label, pattern in PATTERNS.items():
        count = sum(1 for _ in pattern.finditer(content))
        if count:
            categories.append(label)
            occurrences[label] = count
    return categories, occurrences


def main() -> int:
    args = parse_args()
    listing = json.loads(args.listing.read_text(encoding="utf-8-sig"))
    files = [item for item in listing if item.get("type") == "file"]
    selected = [
        item
        for item in files
        if selected_for_content_scan(item, args.max_object_bytes)
    ]
    selected_bytes = sum(int(item.get("size") or 0) for item in selected)
    if selected_bytes > args.max_total_bytes:
        raise RuntimeError(
            f"selected byte count {selected_bytes} exceeds cap {args.max_total_bytes}"
        )

    api = HfApi()
    bucket = api.bucket_info(args.bucket_id)
    detections = []
    pattern_occurrences = Counter()
    pattern_files = Counter()
    scanned_files = 0
    scanned_bytes = 0

    with tempfile.TemporaryDirectory(prefix="hf-credential-audit-") as tmp:
        root = Path(tmp)
        for offset in range(0, len(selected), args.batch_size):
            batch = selected[offset : offset + args.batch_size]
            downloads = []
            local_paths = {}
            for item in batch:
                digest = hashlib.sha256(item["path"].encode("utf-8")).hexdigest()
                local_path = root / digest
                downloads.append((item["path"], local_path))
                local_paths[item["path"]] = local_path

            api.download_bucket_files(
                args.bucket_id,
                downloads,
                raise_on_missing_files=True,
            )
            for item in batch:
                local_path = local_paths[item["path"]]
                categories, occurrences = scan_file(local_path)
                scanned_files += 1
                scanned_bytes += int(item.get("size") or 0)
                if categories:
                    detections.append(
                        {
                            "path": item["path"],
                            "size": int(item.get("size") or 0),
                            "categories": categories,
                        }
                    )
                    pattern_files.update(categories)
                    pattern_occurrences.update(occurrences)
                local_path.unlink(missing_ok=True)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bucket_id": args.bucket_id,
        "visibility_at_listing": args.visibility_at_listing,
        "visibility_at_scan": "private" if bucket.private else "public",
        "listing": {
            "file_count": len(files),
            "total_bytes": sum(int(item.get("size") or 0) for item in files),
        },
        "path_groups": group_stats(files),
        "content_scan": {
            "selection_rule": (
                "known text extensions, raw-password prefix, or sensitive "
                "basename; each object bounded by max_object_bytes"
            ),
            "max_object_bytes": args.max_object_bytes,
            "max_total_bytes": args.max_total_bytes,
            "selected_files": len(selected),
            "selected_bytes": selected_bytes,
            "scanned_files": scanned_files,
            "scanned_bytes": scanned_bytes,
            "detection_file_count": len(detections),
            "pattern_file_counts": dict(sorted(pattern_files.items())),
            "pattern_occurrence_counts": dict(sorted(pattern_occurrences.items())),
            "detections": sorted(detections, key=lambda item: item["path"]),
        },
        "limitations": [
            "No credential values or file contents are included in this report.",
            "Objects larger than max_object_bytes and unselected binary formats were not content-scanned.",
            "Encrypted archives were classified by path only and were not decrypted.",
            "Pattern matches require rotation review; generic assignment matches can include false positives.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(f"scanned_files={scanned_files}")
    print(f"scanned_bytes={scanned_bytes}")
    print(f"detection_file_count={len(detections)}")
    for label, count in sorted(pattern_files.items()):
        print(f"{label}_files={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
