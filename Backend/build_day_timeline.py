"""Build per-day "what did I do" chunks from activity signals on this machine.

Document chunks answer "what does this file say". They cannot answer "what
did I do on 14 March, and who did I speak to" -- that question is about time,
and the document corpus has no time axis. This builds the missing axis: one
chunk per calendar day, assembled from the traces a day actually leaves.

Signals, in descending order of how much they can be trusted:

  git commits    Authored timestamp and message. The strongest signal by far:
                 the timestamp is written at the moment of work and survives
                 copying, unlike mtime.
  call log       Filenames of call recordings, which encode counterparty and
                 a YYMMDD_HHMMSS stamp. Who was spoken to, and when.
  file activity  mtime of files created or edited that day. Weakest: copying a
                 folder rewrites mtimes wholesale, so a backup can manufacture
                 a "busy day" that never happened. Reported, never trusted
                 alone, and always attributed so the agent can discount it.

Usage:
    python tools/build_day_timeline.py --days 365 \\
        --root "C:\\JP" --root "C:\\jayti" \\
        --out runs/jt_agent/parts/timeline.jsonl
"""

from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
from typing import Dict, Iterable, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PRUNE_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode", "node_modules", "__pycache__",
    ".pytest_cache", ".mypy_cache", "venv", ".venv", "env", "site-packages",
    ".next", ".nuxt", ".cache", ".terraform", ".vercel", "AppData",
    "$RECYCLE.BIN", "$Recycle.Bin", "System Volume Information",
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "build", "dist", "obj", "target",
}

# "Call recording <name>_<YYMMDD>_<HHMMSS>.m4a" -- the Samsung dialer format.
CALL_RE = re.compile(
    r"^call recording (?P<who>.+?)_(?P<date>\d{6})_(?P<time>\d{6})\.\w+$", re.I
)

# Screenshot_20260814_101500.png, IMG_20260814_101500.jpg, and friends.
STAMPED_RE = re.compile(r"(?P<y>20\d{2})(?P<m>\d{2})(?P<d>\d{2})[_\-]?(?P<hh>\d{2})?")

MEDIA_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".mp4", ".m4a", ".mp3", ".wav", ".3gp"}


def in_window(day: datetime.date, start: datetime.date, end: datetime.date) -> bool:
    return start <= day <= end


def normalise_contact(raw: str) -> str:
    """Collapse dialer name variants so one person is not three contacts.

    The dialer writes whatever the contact card said at the time, so the same
    person shows up as "Jayti", "Jayti Pargal" and "Jayti <emoji>". Counting
    those separately would understate how often a day involved that person.
    """
    cleaned = "".join(
        char for char in raw if char.isalnum() or char in " .-_"
    ).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or raw.strip()


def collect_calls(
    roots: List[str], start: datetime.date, end: datetime.date, max_depth: int = 6
) -> Dict[str, List[Dict[str, str]]]:
    """Find call recordings and index them by ISO date.

    The same recording is usually present in several backup folders. Counting
    each copy would inflate "how often did I speak to X" by however many times
    that folder was backed up, so identity here is (day, clock, contact) and
    the first copy found wins.
    """
    by_day: Dict[str, List[Dict[str, str]]] = collections.defaultdict(list)
    seen: Set[Tuple[str, str, str]] = set()

    for root in roots:
        if not os.path.isdir(root):
            continue
        root_depth = root.rstrip("\\/").count(os.sep)
        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            if dirpath.count(os.sep) - root_depth >= max_depth:
                dirnames[:] = []
                continue
            dirnames[:] = [n for n in dirnames if n not in PRUNE_DIRS]

            for name in filenames:
                match = CALL_RE.match(name)
                if not match:
                    continue
                stamp = match.group("date")
                try:
                    day = datetime.date(
                        2000 + int(stamp[:2]), int(stamp[2:4]), int(stamp[4:])
                    )
                except ValueError:
                    continue
                if not in_window(day, start, end):
                    continue
                clock = match.group("time")
                contact = normalise_contact(match.group("who"))
                identity = (day.isoformat(), clock, contact)
                if identity in seen:
                    continue
                seen.add(identity)
                by_day[day.isoformat()].append(
                    {
                        "contact": contact,
                        "at": "%s:%s" % (clock[:2], clock[2:4]),
                        "file": os.path.join(dirpath, name),
                    }
                )
    return by_day


def find_git_repos(roots: List[str], max_depth: int = 3) -> List[str]:
    """Locate git working trees a few levels under each root."""
    repos: List[str] = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        root_depth = root.rstrip("\\/").count(os.sep)
        for dirpath, dirnames, _ in os.walk(root, topdown=True, followlinks=False):
            depth = dirpath.count(os.sep) - root_depth
            if depth >= max_depth:
                dirnames[:] = []
                continue
            if ".git" in dirnames:
                repos.append(dirpath)
                dirnames[:] = [n for n in dirnames if n not in PRUNE_DIRS and n != ".git"]
                continue
            dirnames[:] = [n for n in dirnames if n not in PRUNE_DIRS]
    return repos


def collect_commits(
    repos: List[str], start: datetime.date, end: datetime.date
) -> Dict[str, List[Dict[str, str]]]:
    """Read commit subjects per day from every discovered repo."""
    by_day: Dict[str, List[Dict[str, str]]] = collections.defaultdict(list)

    for repo in repos:
        try:
            completed = subprocess.run(
                [
                    "git", "-C", repo, "log", "--all", "--no-merges",
                    "--since", start.isoformat(),
                    "--until", (end + datetime.timedelta(days=1)).isoformat(),
                    "--date=short",
                    "--pretty=format:%ad\x1f%an\x1f%s",
                ],
                capture_output=True, text=True, timeout=60,
                encoding="utf-8", errors="replace",
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if completed.returncode != 0:
            continue

        label = os.path.basename(repo.rstrip("\\/")) or repo
        for line in completed.stdout.splitlines():
            parts = line.split("\x1f")
            if len(parts) != 3:
                continue
            day, author, subject = parts
            by_day[day].append(
                {"repo": label, "author": author, "subject": subject[:200]}
            )
    return by_day


def collect_file_activity(
    roots: List[str],
    start: datetime.date,
    end: datetime.date,
    max_depth: int = 8,
    per_day_cap: int = 40,
) -> Tuple[Dict[str, List[str]], Dict[str, int], Dict[str, int]]:
    """Index files by mtime day, capping how many paths are kept per day."""
    paths: Dict[str, List[str]] = collections.defaultdict(list)
    counts: Dict[str, int] = collections.Counter()
    media: Dict[str, int] = collections.Counter()

    for root in roots:
        if not os.path.isdir(root):
            continue
        root_depth = root.rstrip("\\/").count(os.sep)
        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            if dirpath.count(os.sep) - root_depth >= max_depth:
                dirnames[:] = []
                continue
            dirnames[:] = [
                n for n in dirnames
                if n not in PRUNE_DIRS and not os.path.islink(os.path.join(dirpath, n))
            ]

            for name in filenames:
                path = os.path.join(dirpath, name)
                try:
                    day = datetime.date.fromtimestamp(os.path.getmtime(path))
                except OSError:
                    continue
                if not in_window(day, start, end):
                    continue
                key = day.isoformat()
                counts[key] += 1
                if os.path.splitext(name)[1].lower() in MEDIA_EXTS:
                    media[key] += 1
                if len(paths[key]) < per_day_cap:
                    paths[key].append(path)
    return paths, dict(counts), dict(media)


def render_day(
    day: str,
    calls: List[Dict[str, str]],
    commits: List[Dict[str, str]],
    files: List[str],
    file_count: int,
    media_count: int,
) -> str:
    """Render one day as the prose the agent will be trained on."""
    date = datetime.date.fromisoformat(day)
    lines = [
        "# %s (%s)" % (day, date.strftime("%A")),
        "",
    ]

    if calls:
        contacts = collections.Counter(call["contact"] for call in calls)
        lines.append("## Calls (%d)" % len(calls))
        lines.append(
            "Spoke with: "
            + ", ".join("%s (%dx)" % (name, n) for name, n in contacts.most_common())
        )
        for call in sorted(calls, key=lambda c: c["at"]):
            lines.append("- %s  call with %s" % (call["at"], call["contact"]))
        lines.append("")

    if commits:
        by_repo: Dict[str, List[str]] = collections.defaultdict(list)
        for commit in commits:
            by_repo[commit["repo"]].append(commit["subject"])
        lines.append("## Work committed (%d commits across %d repos)"
                     % (len(commits), len(by_repo)))
        for repo, subjects in sorted(by_repo.items()):
            lines.append("- %s:" % repo)
            for subject in subjects[:12]:
                lines.append("    - %s" % subject)
        lines.append("")

    if file_count:
        lines.append("## Files touched (%d%s)"
                     % (file_count, ", %d photos/recordings" % media_count if media_count else ""))
        lines.append(
            "_File timestamps are a weak signal: copying a folder rewrites them, "
            "so a large count here may reflect a backup rather than a day's work._"
        )
        for path in files[:25]:
            lines.append("- %s" % path)
        lines.append("")

    if not (calls or commits or file_count):
        lines.append("No recorded activity on this day.")

    return "\n".join(lines).rstrip() + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", action="append", dest="roots", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--label", default="timeline")
    parser.add_argument("--skip-empty", action="store_true",
                        help="Omit days with no recorded activity.")
    parser.add_argument("--report")
    args = parser.parse_args(argv)

    end = datetime.date.today()
    start = end - datetime.timedelta(days=args.days - 1)

    print("window: %s -> %s (%d days)" % (start, end, args.days), flush=True)

    print("scanning call recordings...", flush=True)
    calls = collect_calls(args.roots, start, end)

    print("locating git repos...", flush=True)
    repos = find_git_repos(args.roots)
    print("  %d repos" % len(repos), flush=True)
    commits = collect_commits(repos, start, end)

    print("indexing file activity...", flush=True)
    file_paths, file_counts, media_counts = collect_file_activity(args.roots, start, end)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)

    written = 0
    days_with_activity = 0
    total_calls = sum(len(v) for v in calls.values())
    total_commits = sum(len(v) for v in commits.values())
    contacts_seen: Set[str] = set()
    covered: List[str] = []

    with open(args.out, "w", encoding="utf-8") as out:
        for offset in range(args.days):
            day = (start + datetime.timedelta(days=offset)).isoformat()
            day_calls = calls.get(day, [])
            day_commits = commits.get(day, [])
            day_files = file_paths.get(day, [])
            file_count = file_counts.get(day, 0)

            has_activity = bool(day_calls or day_commits or file_count)
            if has_activity:
                days_with_activity += 1
                covered.append(day)
            elif args.skip_empty:
                continue

            contacts_seen.update(call["contact"] for call in day_calls)

            text = render_day(
                day, day_calls, day_commits, day_files,
                file_count, media_counts.get(day, 0),
            )
            record = {
                "text": text,
                "source_file": "timeline://%s" % day,
                "chunk_index": 0,
                "byte_offset": 0,
                "token_count": max(1, len(text) // 4),
                "chunk_id": "timeline://%s:0" % day,
                "metadata": {
                    "corpus_label": args.label,
                    "kind": "day_card",
                    "date": day,
                    "weekday": datetime.date.fromisoformat(day).strftime("%A"),
                    "calls": len(day_calls),
                    "commits": len(day_commits),
                    "files_touched": file_count,
                    "contacts": sorted({c["contact"] for c in day_calls}),
                },
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    summary = {
        "out": args.out,
        "window": {"start": start.isoformat(), "end": end.isoformat(), "days": args.days},
        "day_cards_written": written,
        "days_with_activity": days_with_activity,
        "coverage_pct": round(100.0 * days_with_activity / args.days, 1),
        "first_active_day": covered[0] if covered else None,
        "last_active_day": covered[-1] if covered else None,
        "git_repos_found": len(repos),
        "total_commits": total_commits,
        "total_calls": total_calls,
        "distinct_contacts": sorted(contacts_seen),
        "days_with_calls": len(calls),
        "days_with_commits": len(commits),
        "days_with_file_activity": len(file_counts),
    }
    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
