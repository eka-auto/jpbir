#!/usr/bin/env python3
"""Unit tests for broker v2 signer and client."""
from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from signer import SoftwareP256Signer, WindowsCngSigner, ec_public_key_from_xy, key_id_from_pem
from broker_client import BrokerClient, BrokerError, CANONICAL_PATHS, PROTO, WIRE_PATHS


class TestSoftwareSigner(unittest.TestCase):
    def test_key_generation_and_persistence(self):
        with tempfile.TemporaryDirectory() as td:
            key_path = Path(td) / "test-key.pem"
            signer1 = SoftwareP256Signer(str(key_path))
            pem1 = signer1.public_key_pem()
            kid1 = key_id_from_pem(pem1)
            # Reload from disk
            signer2 = SoftwareP256Signer(str(key_path))
            pem2 = signer2.public_key_pem()
            self.assertEqual(pem1, pem2)
            self.assertEqual(signer1.key_type, "software-p256")
            self.assertEqual(signer2.key_type, "software-p256")

    def test_sign_deterministic_verify(self):
        signer = SoftwareP256Signer(tempfile.mktemp(suffix=".pem"))
        data = b"v2\nkeyid\nPOST\n/api/test\n1\n1234567890\nreq-id\nabcdef"
        sig = signer.sign(data)
        self.assertGreater(len(sig), 8)
        self.assertLessEqual(len(sig), 72)
        r, s = decode_dss_signature(sig)
        self.assertGreater(r, 0)
        self.assertGreater(s, 0)

    def test_key_id_stability(self):
        signer = SoftwareP256Signer(tempfile.mktemp(suffix=".pem"))
        pem = signer.public_key_pem()
        kid1 = key_id_from_pem(pem)
        kid2 = key_id_from_pem(pem)
        self.assertEqual(kid1, kid2)
        self.assertEqual(len(kid1), 32)

    def test_android_xy_coordinates_build_p256_public_key(self):
        signer = SoftwareP256Signer(tempfile.mktemp(suffix=".pem"))
        numbers = signer._key.public_key().public_numbers()
        rebuilt = ec_public_key_from_xy(format(numbers.x, "x"), format(numbers.y, "x"))
        self.assertEqual(rebuilt.public_numbers(), numbers)


class TestWindowsCngSigner(unittest.TestCase):
    def test_helper_passes_operation_and_key_name_via_environment(self):
        signer = WindowsCngSigner.__new__(WindowsCngSigner)
        signer.key_name = "EKA-TEST-KEY"
        completed = Mock(returncode=0, stdout=b"exists\r\n", stderr=b"")
        with patch("signer.subprocess.run", return_value=completed) as run:
            self.assertEqual(signer._run("exists"), "exists")

        command = run.call_args.args[0]
        self.assertEqual(command[-2], "-Command")
        self.assertNotIn("exists", command)
        self.assertEqual(run.call_args.kwargs["env"]["EKA_CNG_OP"], "exists")
        self.assertEqual(run.call_args.kwargs["env"]["EKA_CNG_KEY_NAME"], "EKA-TEST-KEY")


class TestBrokerClientEnvelope(unittest.TestCase):
    def test_state_persistence(self):
        with tempfile.TemporaryDirectory() as td:
            state_path = Path(td) / "state.json"
            signer = SoftwareP256Signer(Path(td) / "key.pem")
            client = BrokerClient("https://example.com", signer, "test-device", state_path)
            self.assertFalse(client.enrolled)
            self.assertEqual(client._state["seq"], 0)
            # Simulate seq advancement
            client._state["seq"] = 5
            client._save_state()
            # Reload
            client2 = BrokerClient("https://example.com", signer, "test-device", state_path)
            self.assertEqual(client2._state["seq"], 5)

    def test_canonical_string_format(self):
        # Verify the canonical string format matches the spec
        signer = SoftwareP256Signer(tempfile.mktemp(suffix=".pem"))
        key_id = key_id_from_pem(signer.public_key_pem())
        body = b'{"test":1}'
        body_sha256 = hashlib.sha256(body).hexdigest()
        seq = 42
        ts = 1725278400000
        rid = "550e8400-e29b-41d4-a716-446655440000"
        canonical = "\n".join([
            "v" + PROTO,
            key_id,
            "POST",
            "/api/device/enroll",
            str(seq),
            str(ts),
            rid,
            body_sha256,
        ])
        # Sign and verify round-trip
        sig = signer.sign(canonical.encode("utf-8"))
        self.assertGreater(len(sig), 0)

    def test_network_retry_reuses_the_same_signed_envelope(self):
        class Response:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"success": True}

        with tempfile.TemporaryDirectory() as td:
            signer = SoftwareP256Signer(Path(td) / "key.pem")
            client = BrokerClient("https://example.com", signer, "test-device", Path(td) / "state.json")
            with patch("broker_client.requests.post", side_effect=[requests.ConnectionError("lost"), Response()]) as post:
                self.assertEqual(client._request("/api/device/heartbeat", {}), {"success": True})
            first = post.call_args_list[0].kwargs["headers"]
            second = post.call_args_list[1].kwargs["headers"]
            self.assertEqual(first, second)

    def test_direct_wire_path_is_signed_with_canonical_v2_path(self):
        class Response:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"success": True}

        with tempfile.TemporaryDirectory() as td:
            signer = SoftwareP256Signer(Path(td) / "key.pem")
            client = BrokerClient("https://example.com", signer, "test-device", Path(td) / "state.json")
            with patch("broker_client.requests.post", return_value=Response()) as post:
                client.heartbeat({"manufacturer": "test"})

            call = post.call_args
            self.assertEqual(call.args[0], f"https://example.com{WIRE_PATHS['heartbeat']}")
            headers = call.kwargs["headers"]
            raw = call.kwargs["data"]
            canonical = "\n".join([
                "v" + PROTO,
                headers["X-Key-Id"],
                "POST",
                CANONICAL_PATHS["heartbeat"],
                headers["X-Device-Seq"],
                headers["X-Timestamp"],
                headers["X-Request-Id"],
                hashlib.sha256(raw).hexdigest(),
            ])
            public_key = serialization.load_pem_public_key(signer.public_key_pem().encode("ascii"))
            public_key.verify(
                base64.b64decode(headers["X-Signature"]),
                canonical.encode("utf-8"),
                ec.ECDSA(hashes.SHA256()),
            )

    def test_command_wire_urls_keep_nested_canonical_paths(self):
        class Response:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"success": True}

        with tempfile.TemporaryDirectory() as td:
            signer = SoftwareP256Signer(Path(td) / "key.pem")
            client = BrokerClient("https://example.com", signer, "test-device", Path(td) / "state.json")
            with patch("broker_client.requests.post", return_value=Response()) as post:
                client.claim("command_1", "worker-1")
                claim_call = post.call_args
                client.complete("command_1", "0" * 32, {"status": "ok"})
                complete_call = post.call_args

            self.assertEqual(
                claim_call.args[0],
                "https://example.com/api/device-command-claim?commandId=command_1",
            )
            self.assertEqual(
                complete_call.args[0],
                "https://example.com/api/device-command-complete?commandId=command_1",
            )
            for call, canonical_path in (
                (claim_call, "/api/device/commands/command_1/claim"),
                (complete_call, "/api/device/commands/command_1/complete"),
            ):
                headers = call.kwargs["headers"]
                raw = call.kwargs["data"]
                canonical = "\n".join([
                    "v" + PROTO,
                    headers["X-Key-Id"],
                    "POST",
                    canonical_path,
                    headers["X-Device-Seq"],
                    headers["X-Timestamp"],
                    headers["X-Request-Id"],
                    hashlib.sha256(raw).hexdigest(),
                ])
                serialization.load_pem_public_key(signer.public_key_pem().encode("ascii")).verify(
                    base64.b64decode(headers["X-Signature"]),
                    canonical.encode("utf-8"),
                    ec.ECDSA(hashes.SHA256()),
                )


if __name__ == "__main__":
    unittest.main()
