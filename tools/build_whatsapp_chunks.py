"""Turn WhatsApp chat exports into per-contact, per-day chunks.

A raw export is one long undifferentiated text file, which is the worst
possible shape for retrieval: a single 1 MB blob answers "what did we ever
talk about" and nothing more specific. This splits it two ways at once --
by *who* and by *when* -- so the trained agent can answer "what did Nilesh
and I decide in March" rather than only "here is the whole thread".

Two kinds of chunk come out:

  contact_profile  One per person. Message counts each way, the date range,
                   busiest days, and how the conversation was distributed
                   over time. This is the chunk that answers "who is this
                   person to me and how often do we talk".
  conversation     One per contact per day, holding that day's messages.
                   Long days are split at message boundaries rather than
                   mid-sentence, so no message is ever cut in half.

Both WhatsApp export dialects are handled:
    12/03/2026, 21:04 - Nilesh: message
    [12/03/26, 21:04:11] Nilesh: message

Usage:
    python tools/build_whatsapp_chunks.py --scan-only --input "D:/path/to/exports"
    python tools/build_whatsapp_chunks.py --input "D:/path/to/exports" \\
        --me "Jayti" --out runs/jt_agent/parts/whatsapp.jsonl
"""

from __future__ import annotations

import argparse
import collections
import datetime
import glob
import json
import os
import re
import sys
import zipfile
from typing import Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.scrub_secrets import classify as classify_secrets

# "12/03/2026, 21:04 - Sender: text"  and  "[12/03/26, 21:04:11] Sender: text"
LINE_RES = [
    re.compile(
        r"^(?P<d>\d{1,2})[/.](?P<m>\d{1,2})[/.](?P<y>\d{2,4}),?\s+"
        r"(?P<hh>\d{1,2}):(?P<mm>\d{2})(?::\d{2})?\s*(?P<ap>[apAP]\.?[mM]\.?)?\s*-\s*"
        r"(?P<rest>.*)$"
    ),
    re.compile(
        r"^\[(?P<d>\d{1,2})[/.](?P<m>\d{1,2})[/.](?P<y>\d{2,4}),?\s+"
        r"(?P<hh>\d{1,2}):(?P<mm>\d{2})(?::\d{2})?\s*(?P<ap>[apAP]\.?[mM]\.?)?\]\s*"
        r"(?P<rest>.*)$"
    ),
]

# Lines WhatsApp itself writes. They are not conversation and they repeat
# thousands of times, so they would dominate any similarity search.
SYSTEM_MARKERS = (
    "messages and calls are end-to-end encrypted",
    "you deleted this message",
    "this message was deleted",
    "<media omitted>",
    "media omitted",
    "null",
    "joined using this group's invite link",
    "changed the subject",
    "changed this group's icon",
    "security code changed",
    "missed voice call",
    "missed video call",
)

CHAT_NAME_RE = re.compile(r"whatsapp chat with (.+?)\.txt$", re.I)
MAX_CHUNK_CHARS = 3200


def contact_from_filename(path: str) -> str:
    """Recover the counterparty name from a standard export filename."""
    match = CHAT_NAME_RE.search(os.path.basename(path))
    if match:
        return match.group(1).strip()
    return os.path.splitext(os.path.basename(path))[0].strip()


def parse_line(line: str) -> Optional[Tuple[datetime.date, str, str, str]]:
    """Parse one export line into (date, clock, sender, text).

    Returns None for a continuation line, which the caller appends to the
    message before it.
    """
    for pattern in LINE_RES:
        match = pattern.match(line)
        if not match:
            continue
        year = int(match.group("y"))
        if year < 100:
            year += 2000
        hour = int(match.group("hh"))
        meridiem = (match.group("ap") or "").lower().replace(".", "")
        if meridiem == "pm" and hour != 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
        try:
            day = datetime.date(year, int(match.group("m")), int(match.group("d")))
        except ValueError:
            return None

        rest = match.group("rest")
        if ": " in rest:
            sender, text = rest.split(": ", 1)
        else:
            sender, text = "", rest
        return day, "%02d:%s" % (hour, match.group("mm")), sender.strip(), text.strip()
    return None


def is_system(sender: str, text: str) -> bool:
    if not sender:
        return True
    lowered = text.lower().strip()
    return (not lowered) or any(marker in lowered for marker in SYSTEM_MARKERS)


def read_export(path: str) -> str:
    """Read an export, transparently unwrapping a single-file .zip."""
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".txt")]
            if not names:
                return ""
            with archive.open(names[0]) as handle:
                return handle.read().decode("utf-8", errors="replace")
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def parse_export(path: str) -> Tuple[str, List[Dict[str, object]]]:
    """Return (contact, messages) for one export file."""
    contact = contact_from_filename(path)
    messages: List[Dict[str, object]] = []
    text = read_export(path)

    for raw in text.splitlines():
        parsed = parse_line(raw)
        if parsed is None:
            if messages:
                messages[-1]["text"] = (messages[-1]["text"] + "\n" + raw.strip()).strip()
            continue
        day, clock, sender, body = parsed
        if is_system(sender, body):
            continue
        messages.append(
            {"date": day.isoformat(), "at": clock, "sender": sender, "text": body}
        )
    return contact, messages


def profile_text(contact: str, messages: List[Dict[str, object]], me: Optional[str]) -> str:
    """Render the one-per-person summary chunk."""
    senders = collections.Counter(str(m["sender"]) for m in messages)
    days = collections.Counter(str(m["date"]) for m in messages)
    ordered = sorted(days)

    lines = [
        "# WhatsApp: %s" % contact,
        "",
        "Total messages: %d" % len(messages),
        "Conversation spans %s to %s across %d days."
        % (ordered[0], ordered[-1], len(ordered)),
        "",
        "## Who said how much",
    ]
    for name, count in senders.most_common():
        role = " (me)" if me and name.lower() == me.lower() else ""
        lines.append("- %s%s: %d messages (%.0f%%)"
                     % (name, role, count, 100.0 * count / max(1, len(messages))))

    lines.append("")
    lines.append("## Busiest days")
    for day, count in days.most_common(10):
        lines.append("- %s: %d messages" % (day, count))

    by_month = collections.Counter(str(m["date"])[:7] for m in messages)
    lines.append("")
    lines.append("## Messages per month")
    for month in sorted(by_month):
        lines.append("- %s: %d" % (month, by_month[month]))

    return "\n".join(lines) + "\n"


def day_chunks(contact: str, day: str, messages: List[Dict[str, object]]) -> List[str]:
    """Render one day of conversation, split at message boundaries."""
    header = "# WhatsApp with %s - %s (%s)\n\n" % (
        contact, day, datetime.date.fromisoformat(day).strftime("%A")
    )
    out: List[str] = []
    buffer = header
    for message in messages:
        rendered = "[%s] %s: %s\n" % (message["at"], message["sender"], message["text"])
        if len(buffer) + len(rendered) > MAX_CHUNK_CHARS and buffer != header:
            out.append(buffer.rstrip() + "\n")
            buffer = header + rendered
        else:
            buffer += rendered
    if buffer.strip() != header.strip():
        out.append(buffer.rstrip() + "\n")
    return out


def emit(contact: str, messages: List[Dict[str, object]], me: Optional[str],
         source: str) -> Iterable[Dict[str, object]]:
    """Yield the profile chunk and every conversation chunk for one contact."""
    if not messages:
        return

    def record(text: str, kind: str, index: int, day: Optional[str]) -> Dict[str, object]:
        chunk_id = "whatsapp://%s/%s:%d" % (contact, day or "profile", index)
        return {
            "text": text,
            "source_file": source,
            "chunk_index": index,
            "byte_offset": 0,
            "token_count": max(1, len(text) // 4),
            "chunk_id": chunk_id,
            "metadata": {
                "corpus_label": "whatsapp",
                "kind": kind,
                "contact": contact,
                "date": day,
            },
        }

    yield record(profile_text(contact, messages, me), "contact_profile", 0, None)

    by_day: Dict[str, List[Dict[str, object]]] = collections.defaultdict(list)
    for message in messages:
        by_day[str(message["date"])].append(message)

    for day in sorted(by_day):
        for index, text in enumerate(day_chunks(contact, day, by_day[day])):
            yield record(text, "conversation", index, day)


def discover(inputs: List[str]) -> List[str]:
    """Expand paths, globs and directories into a list of export files."""
    found: List[str] = []
    for item in inputs:
        if os.path.isdir(item):
            for root, _, names in os.walk(item):
                for name in names:
                    if CHAT_NAME_RE.search(name) or name.lower().endswith(
                        ("whatsapp.txt", "_chat.txt")
                    ):
                        found.append(os.path.join(root, name))
        else:
            matches = glob.glob(item)
            found.extend(matches if matches else ([item] if os.path.isfile(item) else []))
    return sorted(set(found))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", dest="inputs", required=True,
                        help="Export file, glob, or directory to search. Repeatable.")
    parser.add_argument("--out", help="Output .jsonl (required unless --scan-only).")
    parser.add_argument("--me", help="Your own display name, to label your side.")
    parser.add_argument("--exclude-contact", action="append", default=[],
                        help="Skip this contact entirely. Repeatable.")
    parser.add_argument("--scan-only", action="store_true")
    parser.add_argument("--report")
    args = parser.parse_args(argv)

    files = discover(args.inputs)
    if not files:
        print(json.dumps({"error": "no WhatsApp exports found", "searched": args.inputs},
                         indent=2))
        return 1

    excluded = {name.lower() for name in args.exclude_contact}
    per_contact: List[Dict[str, object]] = []
    written = 0
    secrets_skipped = 0
    handle = None

    if not args.scan_only:
        if not args.out:
            parser.error("--out is required unless --scan-only is given")
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
        handle = open(args.out, "w", encoding="utf-8")

    try:
        for path in files:
            contact, messages = parse_export(path)
            if contact.lower() in excluded:
                per_contact.append({"contact": contact, "file": path,
                                    "messages": len(messages), "skipped": "excluded"})
                continue

            days = sorted({str(m["date"]) for m in messages})
            per_contact.append({
                "contact": contact,
                "file": path,
                "messages": len(messages),
                "days": len(days),
                "first": days[0] if days else None,
                "last": days[-1] if days else None,
                "senders": sorted({str(m["sender"]) for m in messages}),
            })

            if handle is None:
                continue
            for record in emit(contact, messages, args.me, path):
                if classify_secrets(str(record["text"])):
                    secrets_skipped += 1
                    continue
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                written += 1
    finally:
        if handle is not None:
            handle.close()

    summary = {
        "exports_found": len(files),
        "contacts": per_contact,
        "chunks_written": written,
        "secret_chunks_skipped": secrets_skipped,
        "out": args.out if not args.scan_only else None,
    }
    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as report:
            report.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
