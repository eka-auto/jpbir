#!/usr/bin/env python3
"""Broker v2 client.

The device holds only a platform signer (TPM/Keystore-backed where
available) and talks to the dashboard broker over HTTPS. Every request is an
envelope: protocol version, keyId, method, canonical path, monotonically
increasing sequence, timestamp, unique requestId and SHA-256 body digest,
all signed with the device key. Identity is derived server-side from the
verified keyId; the client-supplied deviceId is only authoritative during
enrollment (where it must match the code binding).
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
import uuid
from pathlib import Path

import requests

from signer import SignerError, key_id_from_pem

log = logging.getLogger("channel_sandbox.broker")

PROTO = "2"


class BrokerError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class BrokerAuthError(BrokerError):
    """Raised on signature/sequence/requestId/key-state rejections."""


class BrokerClient:
    def __init__(self, base_url, signer, device_id, state_path, timeout=20):
        self.base_url = base_url.rstrip("/")
        self.signer = signer
        self.device_id = device_id
        self.state_path = Path(state_path)
        self.timeout = timeout
        self._state = self._load_state()

    def _load_state(self):
        if self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                log.warning("broker state file unreadable; starting fresh")
        return {"seq": 0, "enrolled": False, "keyId": None}

    def _save_state(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state), encoding="utf-8")
        tmp.replace(self.state_path)

    @property
    def key_id(self):
        if not self._state.get("keyId"):
            self._state["keyId"] = key_id_from_pem(self.signer.public_key_pem())
        return self._state["keyId"]

    @property
    def enrolled(self):
        return bool(self._state.get("enrolled"))

    def _next_seq(self):
        self._state["seq"] = int(self._state.get("seq", 0)) + 1
        self._save_state()
        return self._state["seq"]

    def _headers(self, canonical_path, seq, raw_body):
        ts = int(time.time() * 1000)
        request_id = str(uuid.uuid4())
        digest = hashlib.sha256(raw_body).hexdigest()
        canonical = "\n".join([
            "v" + PROTO,
            self.key_id,
            "POST",
            canonical_path,
            str(seq),
            str(ts),
            request_id,
            digest,
        ])
        try:
            signature = self.signer.sign(canonical.encode("utf-8"))
        except SignerError as e:
            raise BrokerError(f"signer failed: {e}") from e

        return {
            "Content-Type": "application/json",
            "X-Broker-Proto": PROTO,
            "X-Key-Id": self.key_id,
            "X-Device-Seq": str(seq),
            "X-Timestamp": str(ts),
            "X-Request-Id": request_id,
            "X-Signature": base64.b64encode(signature).decode("ascii"),
        }

    def _request(self, path, body_obj, seq=None):
        raw = json.dumps(body_obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
        if seq is None:
            seq = self._next_seq()
        url = f"{self.base_url}{path}"
        last_exc = None
        for attempt in range(3):
            try:
                headers = self._headers(path, seq, raw)
                resp = requests.post(url, data=raw, headers=headers, timeout=self.timeout)
                if resp.status_code in (401, 403):
                    raise BrokerAuthError(
                        f"{path} rejected: {resp.status_code} {resp.text[:200]}",
                        status=resp.status_code,
                    )
                if resp.status_code >= 400:
                    raise BrokerError(
                        f"{path} failed: {resp.status_code} {resp.text[:200]}",
                        status=resp.status_code,
                    )
                return resp.json()
            except requests.RequestException as e:
                last_exc = e
                log.warning("broker request %s attempt %s failed: %s", path, attempt, e)
                time.sleep(0.5 * (attempt + 1))
        raise BrokerError(f"broker unreachable after 3 attempts: {url} ({last_exc})")

    def enroll(self, code, hardware, key_type=None, attestation=None):
        if self.enrolled:
            raise BrokerError("already enrolled")
        body = {
            "code": code,
            "deviceId": self.device_id,
            "publicKeyPem": self.signer.public_key_pem(),
            "keyType": key_type or self.signer.key_type,
            "attestation": attestation or self.signer.attestation(),
            "hardware": hardware,
        }
        result = self._request("/api/device/enroll", body, seq=0)
        self._state["enrolled"] = True
        self._state["keyId"] = result.get("keyId", self.key_id)
        self._save_state()
        return result

    def heartbeat(self, hardware, telemetry=None):
        body = {"hardware": hardware}
        if telemetry:
            body["telemetry"] = telemetry
        return self._request("/api/device/heartbeat", body)

    def poll(self):
        return self._request("/api/device/commands/poll", {})

    def claim(self, command_id, worker_session_id):
        return self._request(
            f"/api/device/commands/{command_id}/claim",
            {"workerSessionId": worker_session_id},
        )

    def complete(self, command_id, claim_token, result):
        return self._request(
            f"/api/device/commands/{command_id}/complete",
            {"claimToken": claim_token, "result": result},
        )
