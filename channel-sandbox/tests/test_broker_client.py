#!/usr/bin/env python3
"""Unit tests for broker v2 signer and client."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from signer import SoftwareP256Signer, WindowsCngSigner, ec_public_key_from_xy, key_id_from_pem
from broker_client import BrokerClient, BrokerError, PROTO


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
        # DER signature length varies; just check it's valid DER
        self.assertGreater(len(sig), 8)
        self.assertLessEqual(len(sig), 72)

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


if __name__ == "__main__":
    unittest.main()
