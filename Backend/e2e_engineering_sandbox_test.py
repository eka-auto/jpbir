#!/usr/bin/env python3
"""Live end-to-end verification against the configured Firestore emulator."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = r"C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe"
PORT = 5056
sys.path.insert(0, str(HERE))

from firestore_client import FirestoreClient, decode_fields


def request_json(method, path, body=None, timeout=5):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def run_agent(config_path, device_id):
    result = subprocess.run(
        [PY, str(HERE / "device_agent.py"), str(config_path), device_id, "--once"],
        cwd=str(HERE),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"agent {device_id} exited {result.returncode}: {result.stderr.strip()}"
        )


def wait_for_dashboard(deadline_seconds=15):
    deadline = time.monotonic() + deadline_seconds
    while time.monotonic() < deadline:
        try:
            status, _ = request_json("GET", "/api/status")
            if status == 200:
                return
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    raise RuntimeError("dashboard did not become ready")


def make_client(cfg):
    return FirestoreClient(
        project=cfg["project"],
        database=cfg["database"],
        service_account_key=cfg["service_account_key"],
        scope=cfg["firestore_scope"],
        mode=cfg["mode"],
        collection=cfg["collection"],
        emulator_host=cfg["emulator_host"],
    )


def main():
    config_path = HERE / "devices.json"
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    if cfg.get("mode") != "emulator" or cfg.get("collection") == "devices":
        raise RuntimeError("e2e requires emulator mode and a non-production collection")

    client = make_client(cfg)
    device_ids = [device["id"] for device in cfg["devices"]]
    for device_id in device_ids:
        client.delete_doc(cfg["collection"], device_id)

    log_dir = HERE / "logs"
    log_dir.mkdir(exist_ok=True)
    log_handle = (log_dir / "dashboard.e2e.log").open("ab")
    dashboard = subprocess.Popen(
        [
            PY,
            str(HERE / "dashboard_api.py"),
            "--config",
            str(config_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
        ],
        cwd=str(HERE),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
    )
    try:
        wait_for_dashboard()

        expected = {}
        for index, device_id in enumerate(device_ids):
            run_agent(config_path, device_id)
            expected[device_id] = []
            for action, payload in (
                ("ping", {"sequence": index * 2 + 1}),
                ("echo", {"sequence": index * 2 + 2}),
            ):
                status, response = request_json(
                    "POST",
                    f"/api/devices/{device_id}/commands",
                    {"action": action, "payload": payload},
                )
                assert status == 202
                expected[device_id].append(
                    (response["commandId"], action, payload, response["queuedAt"])
                )
            run_agent(config_path, device_id)

        status, listing = request_json("GET", "/api/devices")
        assert status == 200
        assert {item["id"] for item in listing["devices"]} == set(device_ids)

        for device_id, commands in expected.items():
            status, response = request_json(
                "GET", f"/api/devices/{device_id}/status"
            )
            assert status == 200
            device_status = response["status"]
            assert device_status["online"] is True
            queue = device_status["commandQueue"]
            assert len(queue) == 2
            for command_id, action, payload, queued_at in commands:
                entry = queue[command_id]
                assert entry["status"] == "ok"
                assert entry["action"] == action
                assert entry["payload"] == payload
                assert entry["queuedAt"] == queued_at
                assert entry["completedAt"]
                assert entry["result"]

            raw = client.get_doc(cfg["collection"], device_id)
            decoded = decode_fields(raw["fields"])
            assert decoded["commandQueue"] == queue

        try:
            request_json("GET", "/api/devices/not-configured/status")
            raise AssertionError("unknown device bypassed the allowlist")
        except urllib.error.HTTPError as exc:
            assert exc.code == 404

        print("PASS: two commands per device completed with IDs and fields intact")
        print("PASS: dashboard list/status decoding and unknown-device allowlist")
        print("PASS: all writes stayed in emulator collection", cfg["collection"])
        return 0
    finally:
        dashboard.terminate()
        try:
            dashboard.wait(timeout=5)
        except subprocess.TimeoutExpired:
            dashboard.kill()
            dashboard.wait(timeout=5)
        log_handle.close()
        for device_id in device_ids:
            client.delete_doc(cfg["collection"], device_id)


if __name__ == "__main__":
    sys.exit(main())
