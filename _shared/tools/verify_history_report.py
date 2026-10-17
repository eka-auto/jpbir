"""Compare a pinned STATS_KEY assignment and scan local Git history without values."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


class CheckError(Exception):
    """An incomplete check, reported without Git output or repository contents."""


PREFIX = rb"(?<![a-z0-9_])[\"']?"
ASSIGNMENT = rb"[\"']?[ \t]*[:=][ \t]*[\"']?"
SECRET_PATTERN = re.compile(
    PREFIX
    + rb"(?:aws_secret_access_key|jp_(?:write_)?aws_secret[a-z0-9_]*)"
    + ASSIGNMENT
    + rb"[a-z0-9/+=]{40}(?![a-z0-9/+=])",
    re.IGNORECASE,
)
SESSION_PATTERN = re.compile(
    PREFIX + rb"aws_session_token" + ASSIGNMENT + rb"[a-z0-9/+=]{40,}",
    re.IGNORECASE,
)


def git(repo: Path, *args: str, data: bytes | None = None) -> bytes:
    env = {**os.environ, "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            input=data,
            capture_output=True,
            env=env,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise CheckError("Git could not complete the local inspection.") from None
    if result.returncode:
        raise CheckError("A required Git read failed; the check is incomplete.")
    return result.stdout


def stats_line(contents: bytes) -> bytes:
    lines = [line for line in contents.splitlines(keepends=True) if line.startswith(b"STATS_KEY=")]
    if len(lines) != 1:
        raise CheckError("Expected exactly one STATS_KEY assignment; comparison is incomplete.")
    return lines[0]


def has_assignment(contents: bytes) -> bool:
    return bool(SECRET_PATTERN.search(contents) or SESSION_PATTERN.search(contents))


def inspect(repo: Path, subject: str, comparisons: list[str], max_bytes: int) -> dict:
    if not re.fullmatch(r"[a-fA-F0-9]{40}", subject):
        raise CheckError("The subject must be a full, immutable commit SHA.")
    if git(repo, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise CheckError("A shallow repository cannot establish full-history coverage.")
    resolved = git(repo, "rev-parse", "--verify", subject + "^{commit}").strip().decode("ascii")
    baseline = stats_line(git(repo, "show", resolved + ":Devices/sandbox/.env.example"))
    verdicts = []
    for candidate in comparisons:
        if not re.fullmatch(r"[a-fA-F0-9]{7,40}", candidate):
            raise CheckError("Comparison objects must be hexadecimal blob identifiers.")
        oid = git(repo, "rev-parse", "--verify", candidate + "^{blob}").strip().decode("ascii")
        contents = git(repo, "cat-file", "blob", oid)
        verdicts.append({"blob": oid, "identical_to_subject": stats_line(contents) == baseline})

    refs = git(repo, "for-each-ref", "--format=%(refname) %(objectname)")
    ids = list(dict.fromkeys(git(repo, "rev-list", "--objects", "--all", "--no-object-names").splitlines()))
    metadata = git(
        repo, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        data=b"\n".join(ids) + b"\n",
    ).splitlines()
    if len(metadata) != len(ids):
        raise CheckError("Git object coverage could not be established.")
    blobs = []
    for oid, record in zip(ids, metadata):
        fields = record.split()
        if len(fields) != 3 or fields[0] != oid or not fields[2].isdigit():
            raise CheckError("A required object is missing or malformed.")
        if fields[1] == b"blob":
            blobs.append((oid, int(fields[2])))
    total_bytes = sum(size for _, size in blobs)
    if total_bytes > max_bytes:
        raise CheckError("History exceeds the configured memory bound; no scan verdict was produced.")

    payload = git(repo, "cat-file", "--batch", data=b"\n".join(oid for oid, _ in blobs) + b"\n")
    offset = matching = 0
    for oid, size in blobs:
        end = payload.find(b"\n", offset)
        expected = oid + b" blob " + str(size).encode("ascii")
        if end < 0 or payload[offset:end] != expected:
            raise CheckError("A blob read failed; the scan is incomplete.")
        start = end + 1
        contents = payload[start:start + size]
        if len(contents) != size or payload[start + size:start + size + 1] != b"\n":
            raise CheckError("A blob read was truncated; the scan is incomplete.")
        matching += has_assignment(contents)
        offset = start + size + 1
    if offset != len(payload):
        raise CheckError("Unexpected data prevented complete blob accounting.")
    if refs != git(repo, "for-each-ref", "--format=%(refname) %(objectname)"):
        raise CheckError("Repository refs changed during inspection; no stable verdict was produced.")
    return {
        "status": "matches_found" if matching else "no_pattern_matches",
        "subject_revision": resolved,
        "refs_sha256": hashlib.sha256(refs).hexdigest(),
        "refs_count": len(refs.splitlines()),
        "reachable_blobs": len(blobs),
        "scanned_blobs": len(blobs),
        "scanned_bytes": total_bytes,
        "skipped_blobs": 0,
        "matching_blobs": matching,
        "stats_key_comparisons": verdicts,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--compare-blob", action="append", default=[])
    parser.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024)
    args = parser.parse_args(argv)
    try:
        summary = inspect(args.repo, args.subject, args.compare_blob, args.max_bytes)
    except (CheckError, UnicodeError, ValueError):
        print(json.dumps({"status": "error", "reason": "History verification is incomplete; no clean verdict was produced."}))
        return 2
    print(json.dumps(summary, indent=2))
    return 1 if summary["matching_blobs"] else 0


if __name__ == "__main__":
    sys.exit(main())
