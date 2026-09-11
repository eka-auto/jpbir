#!/usr/bin/env python3
"""Extract Chrome browsing history from CSV exports into JSONL chunks."""

import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.scrub_secrets import classify as classify_secrets  # noqa: E402

SRC = os.path.join(os.path.expanduser("~"), "Downloads", "chrome-history-extracted")
OUT = os.path.join(ROOT, "runs", "jt_agent", "parts", "dl_chrome_hist.jsonl")

CHROME_EPOCH_OFFSET = 11644473600  # seconds between 1601-01-01 and 1970-01-01
CHROME_TICK = 1_000_000            # microseconds per second in Chrome timestamps


def chrome_ts_to_iso(ts_str: str) -> str:
    """Convert Chrome microseconds-since-1601 to ISO date string."""
    try:
        ts = int(ts_str)
        if ts == 0:
            return ""
        unix_s = ts / CHROME_TICK - CHROME_EPOCH_OFFSET
        # Simple year extraction to avoid datetime import
        import datetime
        dt = datetime.datetime.utcfromtimestamp(unix_s)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def make_chunk(text: str, source: str, kind: str, label: str = "chrome_history", idx: int = 0) -> dict:
    return {
        "text": text,
        "source_file": source,
        "chunk_index": idx,
        "byte_offset": 0,
        "token_count": len(text.split()),
        "chunk_id": "%s::chrome::%d" % (label, idx),
        "metadata": {
            "corpus_label": "databases",
            "kind": kind,
            "profile": label,
        },
    }


def extract_profile(profile_dir: str, profile_name: str, out_fh, chunk_counter: list) -> int:
    written = 0

    # --- urls.csv ---
    urls_csv = os.path.join(profile_dir, "urls.csv")
    if os.path.isfile(urls_csv):
        with open(urls_csv, encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            batch_lines = []
            for row in reader:
                url = row.get("url", "").strip()
                title = row.get("title", "").strip()
                visit_count = row.get("visit_count", "0")
                last_visit = chrome_ts_to_iso(row.get("last_visit_time", "0"))
                if not url or url.startswith("data:"):
                    continue
                line = "URL: %s" % url
                if title:
                    line += "\nTitle: %s" % title
                if last_visit:
                    line += "\nLast visited: %s" % last_visit
                if visit_count and visit_count != "0":
                    line += "\nVisit count: %s" % visit_count
                batch_lines.append(line)
                if len(batch_lines) >= 20:
                    text = "\n\n".join(batch_lines)
                    if not classify_secrets(text):
                        chunk = make_chunk(text, urls_csv, "chrome_urls", profile_name, chunk_counter[0])
                        out_fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                        written += 1
                        chunk_counter[0] += 1
                    batch_lines = []
            if batch_lines:
                text = "\n\n".join(batch_lines)
                if not classify_secrets(text):
                    chunk = make_chunk(text, urls_csv, "chrome_urls", profile_name, chunk_counter[0])
                    out_fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                    written += 1
                    chunk_counter[0] += 1

    # --- keyword_search_terms.csv ---
    kw_csv = os.path.join(profile_dir, "keyword_search_terms.csv")
    if os.path.isfile(kw_csv):
        searches = []
        with open(kw_csv, encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                term = row.get("term", "").strip()
                normalized = row.get("normalized_term", "").strip()
                if term:
                    searches.append(term or normalized)
        if searches:
            # Group into chunks of 50 search terms
            for i in range(0, len(searches), 50):
                batch = searches[i:i+50]
                text = "Chrome search queries (%s):\n%s" % (profile_name, "\n".join("- " + t for t in batch))
                if not classify_secrets(text):
                    chunk = make_chunk(text, kw_csv, "chrome_searches", profile_name, chunk_counter[0])
                    out_fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                    written += 1
                    chunk_counter[0] += 1

    # --- downloads.csv ---
    dl_csv = os.path.join(profile_dir, "downloads.csv")
    if os.path.isfile(dl_csv):
        downloads = []
        with open(dl_csv, encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                target = row.get("target_path", "").strip()
                url = row.get("url", "").strip() if "url" in row else ""
                start = chrome_ts_to_iso(row.get("start_time", "0"))
                if target:
                    line = "Downloaded: %s" % target
                    if start:
                        line += " (at %s)" % start
                    downloads.append(line)
        if downloads:
            for i in range(0, len(downloads), 30):
                batch = downloads[i:i+30]
                text = "Chrome downloads (%s):\n%s" % (profile_name, "\n".join(batch))
                if not classify_secrets(text):
                    chunk = make_chunk(text, dl_csv, "chrome_downloads", profile_name, chunk_counter[0])
                    out_fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                    written += 1
                    chunk_counter[0] += 1

    return written


def main():
    if not os.path.isdir(SRC):
        print("ERROR: source not found: %s" % SRC)
        sys.exit(1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    counter = [0]
    total = 0

    with open(OUT, "w", encoding="utf-8") as out_fh:
        for entry in sorted(os.listdir(SRC)):
            profile_dir = os.path.join(SRC, entry)
            if not os.path.isdir(profile_dir):
                continue
            n = extract_profile(profile_dir, entry, out_fh, counter)
            print("  %s: %d chunks" % (entry, n))
            total += n

    print("Total: %d chunks -> %s" % (total, OUT))


if __name__ == "__main__":
    main()
