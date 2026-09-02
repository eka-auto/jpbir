#!/usr/bin/env python3
"""Tests for the broker enrollment-code admin tool."""
from __future__ import annotations

import unittest
from argparse import Namespace
from unittest.mock import patch

import mint_enrollment_code as admin


class FakeResponse:
    status_code = 200

    @staticmethod
    def raise_for_status():
        return None

    @staticmethod
    def json():
        return {"ok": True}


class TestFirestoreEncoding(unittest.TestCase):
    def test_patch_uses_document_fields_not_a_map_value_wrapper(self):
        fields = {
            "deviceId": "jayti-asus-vivobook",
            "attempts": 0,
            "consumed": False,
            "hardwareFingerprint": {"manufacturer": "ASUS"},
        }
        with patch.object(admin.requests, "patch", return_value=FakeResponse()) as request:
            admin.fs_patch("token", "/enrollmentCodes/hash", fields)

        body = request.call_args.kwargs["json"]
        self.assertEqual(body["fields"]["deviceId"], {"stringValue": "jayti-asus-vivobook"})
        self.assertEqual(body["fields"]["attempts"], {"integerValue": 0})
        self.assertEqual(body["fields"]["consumed"], {"booleanValue": False})
        self.assertEqual(
            body["fields"]["hardwareFingerprint"],
            {"mapValue": {"fields": {"manufacturer": {"stringValue": "ASUS"}}}},
        )
        self.assertNotIn("mapValue", body["fields"])

    def test_revoke_device_revokes_only_active_matching_codes(self):
        documents = [
            {
                "name": "projects/p/databases/d/documents/enrollmentCodes/active",
                "fields": {
                    "deviceId": {"stringValue": "g4g-lenovo-laptop"},
                    "consumed": {"booleanValue": False},
                    "revoked": {"booleanValue": False},
                },
            },
            {
                "name": "projects/p/databases/d/documents/enrollmentCodes/used",
                "fields": {
                    "deviceId": {"stringValue": "g4g-lenovo-laptop"},
                    "consumed": {"booleanValue": True},
                    "revoked": {"booleanValue": False},
                },
            },
            {
                "name": "projects/p/databases/d/documents/enrollmentCodes/other",
                "fields": {
                    "deviceId": {"stringValue": "samsung-s24-ultra"},
                    "consumed": {"booleanValue": False},
                    "revoked": {"booleanValue": False},
                },
            },
        ]
        with (
            patch.object(admin, "adc_token", return_value="token"),
            patch.object(admin, "fs_list", return_value=documents),
            patch.object(admin, "fs_patch") as write,
        ):
            result = admin.cmd_revoke_device(Namespace(device_id="g4g-lenovo-laptop"))

        self.assertEqual(result, 0)
        self.assertEqual(write.call_count, 1)
        self.assertEqual(write.call_args.args[:2], ("token", "/enrollmentCodes/active"))
        self.assertTrue(write.call_args.args[2]["revoked"])


if __name__ == "__main__":
    unittest.main()
