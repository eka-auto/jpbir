#!/usr/bin/env python3
"""Static safety checks for physical-device deploy kits."""
from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]          # Sandbox/Configuration
SANDBOX = ROOT.parent                                 # Sandbox/
DEPLOY = SANDBOX                                      # kits are direct children: Sandbox/S24, Sandbox/Vivobook, etc.
ARTIFACTS = (
    "device_agent.py",
    "broker_client.py",
    "signer.py",
    "single_instance.py",
    "requirements-broker.txt",
)


class TestDeployKits(unittest.TestCase):
    def test_bundled_runtime_files_exactly_match_canonical_files(self):
        for kit_name in ("lenovo", "vivobook", "s24"):
            for artifact in ARTIFACTS:
                with self.subTest(kit=kit_name, artifact=artifact):
                    self.assertEqual(
                        (DEPLOY / kit_name / artifact).read_bytes(),
                        (ROOT / artifact).read_bytes(),
                    )

    def test_windows_kits_are_broker_only_and_hardware_guarded(self):
        expectations = {
            "lenovo": ("g4g-lenovo-laptop", "82KA", "EKA-BROKER-G4G-LENOVO-LAPTOP"),
            "vivobook": ("jayti-asus-vivobook", "VivoBook", "EKA-BROKER-JAYTI-ASUS-VIVOBOOK"),
        }
        for kit_name, (device_id, hardware, key_name) in expectations.items():
            with self.subTest(kit=kit_name):
                config = json.loads((DEPLOY / kit_name / "devices.json").read_text(encoding="utf-8"))
                installer = (DEPLOY / kit_name / f"install_{kit_name}.ps1").read_text(encoding="utf-8")
                self.assertEqual(config["transport"], "broker")
                self.assertEqual(config["signer"], "windows-cng")
                self.assertEqual(config["devices"][0]["id"], device_id)
                self.assertEqual(config["key_name"], key_name)
                self.assertIn(hardware, installer)
                self.assertIn("--once", installer)
                self.assertNotIn("FIRESTORE", config)
                self.assertNotIn("service_account_key", config)
                self.assertFalse((DEPLOY / kit_name / "firestore_client.py").exists())

    def test_s24_installer_has_no_inbound_or_key_download_path(self):
        installer = (DEPLOY / "s24" / "install_s24.sh").read_text(encoding="utf-8").lower()
        contract = json.loads((DEPLOY / "s24" / "runtime_contract.json").read_text(encoding="utf-8"))
        for forbidden in (
            "sshd",
            "openssh",
            "bore",
            "service.adb.tcp",
            "bootstrap/s24key",
            "eka_service_account_key",
            "set +e",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, installer)
        self.assertIn("sm-s928", installer)
        self.assertIn("termux-keystore", installer)
        self.assertIn("--once", installer)
        self.assertEqual(contract["transport"]["method"], "signed-outbound-https")
        self.assertFalse(contract["transport"]["inboundListener"])


if __name__ == "__main__":
    unittest.main()
