#!/usr/bin/env python3
"""Run broker v2 end to end with production handlers and an in-memory store.

This pipeline never contacts Firestore or a production broker. It starts a
localhost Node adapter around the real Vercel handlers, replaces their
OAuth/Firestore fetches with an in-memory REST emulator, and drives them with
the real Python broker client and device agent.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from broker_client import (  # noqa: E402
    BrokerAuthError,
    BrokerClient,
    BrokerError,
    CANONICAL_PATHS,
)
from device_agent import collect_hardware_identity  # noqa: E402
from signer import SoftwareP256Signer, key_id_from_pem  # noqa: E402

DEVICE_ID = "g4g-lenovo-laptop"
MANUAL_COMMAND_ID = "sandbox-manual-command"
AGENT_COMMAND_ID = "sandbox-agent-command"


def iso_at(delta):
    return (datetime.now(timezone.utc) + delta).isoformat()


def free_local_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def expect_broker_status(label, call, expected):
    try:
        call()
    except (BrokerAuthError, BrokerError) as error:
        if error.status == expected:
            return
        raise AssertionError(f"{label}: expected HTTP {expected}, got {error.status}") from error
    raise AssertionError(f"{label}: expected HTTP {expected}, request succeeded")


def signed_request(client, wire_path, canonical_path, body, seq, request_id=None, timestamp=None):
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    headers = client._headers(
        canonical_path,
        seq,
        raw,
        timestamp=timestamp,
        request_id=request_id,
    )
    return raw, headers


def post_signed(base_url, wire_path, raw, headers):
    return requests.post(
        f"{base_url}{wire_path}",
        data=raw,
        headers=headers,
        timeout=10,
    )


def mutate_signature(headers):
    changed = dict(headers)
    raw = bytearray(base64.b64decode(changed["X-Signature"], validate=True))
    raw[-1] ^= 1
    changed["X-Signature"] = base64.b64encode(raw).decode("ascii")
    return changed


def wait_for_server(process, base_url):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=2)
            raise RuntimeError(
                "sandbox server exited during startup: "
                + (stderr or stdout or "no diagnostic output")[-1000:]
            )
        try:
            response = requests.get(f"{base_url}/__sandbox/health", timeout=1)
            if response.status_code == 200:
                return
        except requests.RequestException:
            pass
        time.sleep(0.1)
    raise RuntimeError("sandbox server did not become ready")


def get_control_state(base_url, control_token):
    response = requests.get(
        f"{base_url}/__sandbox/state",
        headers={"X-Sandbox-Token": control_token},
        timeout=5,
    )
    response.raise_for_status()
    return response.json()


def main():
    hardware = collect_hardware_identity()
    if str(hardware.get("manufacturer", "")).upper() != "LENOVO" or not str(
        hardware.get("model", "")
    ).upper().startswith("82KA"):
        raise RuntimeError("this pipeline is guarded for the current Lenovo 82KA host")
    if not hardware.get("serialHash"):
        raise RuntimeError("hardware identity did not produce a stable serial hash")

    codes = {name: secrets.token_hex(16) for name in (
        "valid", "software_blocked", "expired", "exhausted"
    )}
    fingerprint = {
        "manufacturer": r"^LENOVO$",
        "model": r"^82KA",
        "serialHash": f"^{re.escape(hardware['serialHash'])}$",
    }

    def code_fields(*, allow_software, expires_at, attempts=0):
        return {
            "deviceId": DEVICE_ID,
            "keyType": "software-p256",
            "hardwareFingerprint": fingerprint,
            "allowSoftware": allow_software,
            "expiresAt": expires_at,
            "maxAttempts": 5,
            "attempts": attempts,
            "consumed": False,
            "revoked": False,
            "createdAt": iso_at(timedelta()),
        }

    seed = {
        "deviceId": DEVICE_ID,
        "codes": [
            {"label": "valid", "code": codes["valid"], "fields": code_fields(
                allow_software=True, expires_at=iso_at(timedelta(minutes=10))
            )},
            {"label": "software_blocked", "code": codes["software_blocked"], "fields": code_fields(
                allow_software=False, expires_at=iso_at(timedelta(minutes=10))
            )},
            {"label": "expired", "code": codes["expired"], "fields": code_fields(
                allow_software=True, expires_at=iso_at(timedelta(minutes=-1))
            )},
            {"label": "exhausted", "code": codes["exhausted"], "fields": code_fields(
                allow_software=True, expires_at=iso_at(timedelta(minutes=10)), attempts=5
            )},
        ],
        "commandQueue": {
            MANUAL_COMMAND_ID: {
                "action": "echo",
                "payload": {"source": "manual-client", "value": 1},
                "status": "pending",
                "queuedAt": iso_at(timedelta()),
                "attempt": 0,
            },
            AGENT_COMMAND_ID: {
                "action": "ping",
                "payload": {"source": "device-agent"},
                "status": "pending",
                "queuedAt": iso_at(timedelta()),
                "attempt": 0,
            },
        },
    }

    port = free_local_port()
    base_url = f"http://127.0.0.1:{port}"
    control_token = secrets.token_urlsafe(32)
    server_env = os.environ.copy()
    server_env.update({
        "BROKER_SANDBOX_PORT": str(port),
        "BROKER_SANDBOX_CONTROL_TOKEN": control_token,
        "BROKER_SANDBOX_SEED_B64": base64.b64encode(
            json.dumps(seed, separators=(",", ":")).encode("utf-8")
        ).decode("ascii"),
    })
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    server = subprocess.Popen(
        ["node", str(HERE / "tests" / "v2_pipeline_server.mjs")],
        cwd=HERE,
        env=server_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=creationflags,
    )

    try:
        wait_for_server(server, base_url)
        with tempfile.TemporaryDirectory(prefix="eka-broker-v2-") as temp_name:
            temp = Path(temp_name)
            key_path = temp / "software-p256.pem"
            state_path = temp / "broker-state.json"
            signer = SoftwareP256Signer(key_path)
            client = BrokerClient(base_url, signer, DEVICE_ID, state_path, timeout=5)

            enrollment_body = {
                "code": codes["valid"],
                "deviceId": DEVICE_ID,
                "publicKeyPem": signer.public_key_pem(),
                "keyType": signer.key_type,
                "attestation": signer.attestation(),
                "hardware": hardware,
            }
            raw, headers = signed_request(
                client,
                "/api/device-enroll",
                "/api/device-enroll",
                enrollment_body,
                0,
            )
            tampered = post_signed(base_url, "/api/device-enroll", raw, mutate_signature(headers))
            assert tampered.status_code == 401, "enrollment accepted an invalid signature"

            expect_broker_status(
                "software key without explicit permission",
                lambda: client.enroll(codes["software_blocked"], hardware),
                403,
            )
            expect_broker_status(
                "expired enrollment code",
                lambda: client.enroll(codes["expired"], hardware),
                403,
            )
            expect_broker_status(
                "exhausted enrollment code",
                lambda: client.enroll(codes["exhausted"], hardware),
                403,
            )
            wrong_device = BrokerClient(
                base_url,
                signer,
                "samsung-s24-ultra",
                temp / "wrong-device-state.json",
                timeout=5,
            )
            expect_broker_status(
                "device-bound enrollment code",
                lambda: wrong_device.enroll(codes["valid"], hardware),
                403,
            )
            expect_broker_status(
                "key-type-bound enrollment code",
                lambda: client.enroll(
                    codes["valid"],
                    hardware,
                    key_type="tpm-cng-p256",
                    attestation={
                        "provider": "Microsoft Platform Crypto Provider",
                        "exportable": False,
                    },
                ),
                403,
            )
            wrong_hardware = dict(hardware, manufacturer="NOT-LENOVO")
            expect_broker_status(
                "hardware-bound enrollment code",
                lambda: client.enroll(codes["valid"], wrong_hardware),
                403,
            )

            enrolled = client.enroll(codes["valid"], hardware)
            expected_key_id = key_id_from_pem(signer.public_key_pem())
            assert enrolled["keyId"] == expected_key_id
            assert client.enrolled

            heartbeat = client.heartbeat(hardware, {
                "deviceId": DEVICE_ID,
                "connectionMethod": "broker-v2-sandbox",
                "network": {"ssid": "sandbox", "sent_mb": 1.0},
            })
            assert heartbeat["success"] is True and heartbeat["seq"] == 1

            polled = client.poll()
            commands = {item["commandId"]: item for item in polled["commands"]}
            assert commands[MANUAL_COMMAND_ID]["state"] == "pending"
            assert commands[AGENT_COMMAND_ID]["action"] == "ping"

            claim_seq = client._next_seq()
            claim_id = str(uuid.uuid4())
            claim_wire = f"/api/device-command-claim/{MANUAL_COMMAND_ID}"
            claim_path = f"/api/device-command-claim/{MANUAL_COMMAND_ID}"
            claim_raw, claim_headers = signed_request(
                client,
                claim_wire,
                claim_path,
                {"workerSessionId": "sandbox-worker"},
                claim_seq,
                request_id=claim_id,
            )
            signature = base64.b64decode(claim_headers["X-Signature"], validate=True)
            assert signature.startswith(b"\x30"), "P-256 signature is not ASN.1 DER"
            first_claim = post_signed(base_url, claim_wire, claim_raw, claim_headers)
            assert first_claim.status_code == 200
            claim_result = first_claim.json()
            assert claim_result["payload"] == {"source": "manual-client", "value": 1}
            duplicate_claim = post_signed(base_url, claim_wire, claim_raw, claim_headers)
            assert duplicate_claim.status_code == 200
            assert duplicate_claim.json() == claim_result

            changed_raw, changed_headers = signed_request(
                client,
                claim_wire,
                claim_path,
                {"workerSessionId": "different-worker"},
                claim_seq + 1,
                request_id=claim_id,
            )
            changed_replay = post_signed(base_url, claim_wire, changed_raw, changed_headers)
            assert changed_replay.status_code == 401

            bad_raw, bad_headers = signed_request(
                client,
                "/api/device-heartbeat",
                CANONICAL_PATHS["heartbeat"],
                {"hardware": hardware},
                claim_seq + 1,
            )
            bad_signature = post_signed(
                base_url,
                "/api/device-heartbeat",
                bad_raw,
                mutate_signature(bad_headers),
            )
            assert bad_signature.status_code == 401

            mismatch_raw, mismatch_headers = signed_request(
                client,
                "/api/device-heartbeat",
                CANONICAL_PATHS["heartbeat"],
                {"hardware": wrong_hardware},
                claim_seq + 1,
            )
            mismatch = post_signed(
                base_url,
                "/api/device-heartbeat",
                mismatch_raw,
                mismatch_headers,
            )
            assert mismatch.status_code == 403

            complete_seq = client._next_seq()
            complete_id = str(uuid.uuid4())
            complete_wire = f"/api/device-command-complete/{MANUAL_COMMAND_ID}"
            complete_path = f"/api/device-command-complete/{MANUAL_COMMAND_ID}"
            complete_raw, complete_headers = signed_request(
                client,
                complete_wire,
                complete_path,
                {
                    "claimToken": claim_result["claimToken"],
                    "result": {"status": "ok", "source": "pipeline"},
                },
                complete_seq,
                request_id=complete_id,
            )
            completed = post_signed(base_url, complete_wire, complete_raw, complete_headers)
            assert completed.status_code == 200
            assert completed.json()["status"] == "completed"
            duplicate_complete = post_signed(base_url, complete_wire, complete_raw, complete_headers)
            assert duplicate_complete.status_code == 200
            assert duplicate_complete.json() == completed.json()

            after_complete = client.poll()
            assert [item["commandId"] for item in after_complete["commands"]] == [AGENT_COMMAND_ID]

            replay_raw, replay_headers = signed_request(
                client,
                "/api/device-commands-poll",
                CANONICAL_PATHS["poll"],
                {},
                complete_seq,
            )
            replay = post_signed(
                base_url,
                "/api/device-commands-poll",
                replay_raw,
                replay_headers,
            )
            assert replay.status_code == 401

            config_path = temp / "devices.json"
            config_path.write_text(json.dumps({
                "transport": "broker",
                "broker_url": base_url,
                "signer": "software",
                "key_path": str(key_path),
                "broker_state_file": str(state_path),
                "heartbeat_interval_seconds": 45,
                "command_poll_interval_seconds": 15,
                "devices": [{
                    "id": DEVICE_ID,
                    "display_name": "Broker v2 sandbox Lenovo",
                    "role": "sandbox",
                    "type": "laptop",
                }],
                "allowed_commands": ["status-only", "ping", "echo"],
            }, indent=2), encoding="utf-8")
            agent = subprocess.run(
                [
                    sys.executable,
                    str(HERE / "device_agent.py"),
                    str(config_path),
                    DEVICE_ID,
                    "--once",
                    "--log-file",
                    str(temp / "agent.log"),
                ],
                cwd=HERE,
                capture_output=True,
                text=True,
                timeout=45,
                creationflags=creationflags,
            )
            if agent.returncode != 0:
                raise RuntimeError(
                    f"device_agent.py exited {agent.returncode}: "
                    + (agent.stderr or agent.stdout)[-1000:]
                )

            final_state = get_control_state(base_url, control_token)
            assert final_state["codes"]["valid"]["consumed"] is True
            assert final_state["codes"]["valid"]["attempts"] == 4
            assert final_state["codes"]["software_blocked"]["attempts"] == 1
            assert final_state["codes"]["expired"]["consumed"] is False
            assert final_state["codes"]["exhausted"]["attempts"] == 5
            assert final_state["device"]["online"] is True
            assert final_state["device"]["enrollment"]["activeKeyId"] == expected_key_id
            assert final_state["device"]["enrollment"]["seq"] == 9
            assert final_state["device"]["enrollment"]["requestIdCount"] <= 50
            assert final_state["device"]["commandQueue"][MANUAL_COMMAND_ID]["status"] == "completed"
            assert final_state["device"]["commandQueue"][AGENT_COMMAND_ID]["status"] == "completed"
            assert final_state["device"]["commandQueue"][AGENT_COMMAND_ID]["result"]["pong"] is True
            assert final_state["keys"] == [{
                "keyId": expected_key_id,
                "deviceId": DEVICE_ID,
                "keyType": "software-p256",
                "status": "active",
            }]

        print("PASS: enrollment code TTL, attempt, device, key-type, software, and hardware gates")
        print("PASS: ECDSA P-256 DER envelope, raw-body digest, sequence, and requestId replay controls")
        print("PASS: poll -> lease claim -> idempotent replay -> complete -> real device_agent ACK")
        print("PASS: all OAuth and Firestore traffic remained in the in-memory localhost sandbox")
        return 0
    finally:
        try:
            requests.post(
                f"{base_url}/__sandbox/shutdown",
                headers={"X-Sandbox-Token": control_token},
                timeout=2,
            )
        except requests.RequestException:
            pass
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=3)


if __name__ == "__main__":
    raise SystemExit(main())
