#!/usr/bin/env python3
"""Static safety checks for physical-device deploy kits."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]          # Sandbox/Configuration
SANDBOX = ROOT.parent                                 # Sandbox/
sys.path.insert(0, str(ROOT))

import device_agent

# Folder names use TitleCase, but test kit names are lowercase
KIT_DIR = {"lenovo": "Lenovo", "vivobook": "Vivobook", "s24": "S24"}
SHARED_ARTIFACTS = (
    "broker_client.py",
    "signer.py",
    "single_instance.py",
    "requirements-broker.txt",
)


def kit_path(kit_name: str) -> Path:
    return SANDBOX / KIT_DIR[kit_name]


class TestDeployKits(unittest.TestCase):
    def test_shared_runtime_files_exactly_match_canonical_files(self):
        for kit_name in ("lenovo", "vivobook", "s24"):
            for artifact in SHARED_ARTIFACTS:
                with self.subTest(kit=kit_name, artifact=artifact):
                    self.assertEqual(
                        (kit_path(kit_name) / artifact).read_bytes(),
                        (ROOT / artifact).read_bytes(),
                    )

    def test_s24_agent_exactly_matches_the_canonical_release_source(self):
        self.assertEqual(
            (kit_path("s24") / "device_agent.py").read_bytes(),
            (ROOT / "device_agent.py").read_bytes(),
        )

    def test_windows_agents_remain_on_their_matching_pinned_release(self):
        self.assertEqual(
            (kit_path("lenovo") / "device_agent.py").read_bytes(),
            (kit_path("vivobook") / "device_agent.py").read_bytes(),
        )

    def test_windows_kits_are_broker_only_and_hardware_guarded(self):
        expectations = {
            "lenovo": ("g4g-lenovo-laptop", "82KA", "EKA-BROKER-G4G-LENOVO-LAPTOP"),
            "vivobook": ("jayti-asus-vivobook", "VivoBook", "EKA-BROKER-JAYTI-ASUS-VIVOBOOK"),
        }
        for kit_name, (device_id, hardware, key_name) in expectations.items():
            with self.subTest(kit=kit_name):
                kp = kit_path(kit_name)
                config = json.loads((kp / "devices.json").read_text(encoding="utf-8"))
                installer = (kp / f"install_{kit_name}.ps1").read_text(encoding="utf-8")
                self.assertEqual(config["transport"], "broker")
                self.assertEqual(config["signer"], "windows-cng")
                self.assertEqual(config["devices"][0]["id"], device_id)
                self.assertEqual(config["key_name"], key_name)
                self.assertIn(hardware, installer)
                self.assertIn("--once", installer)
                self.assertNotIn("FIRESTORE", config)
                self.assertNotIn("service_account_key", config)
                self.assertFalse((kp / "firestore_client.py").exists())

    def test_s24_installer_has_no_inbound_or_key_download_path(self):
        kp = kit_path("s24")
        installer = (kp / "install_s24.sh").read_text(encoding="utf-8").lower()
        contract = json.loads((kp / "runtime_contract.json").read_text(encoding="utf-8"))
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
        self.assertIn("com.termux.boot", installer)
        self.assertIn("termux-job-scheduler --pending", installer)
        self.assertIn("--enroll-only", installer)
        self.assertIn("--once", installer)
        self.assertEqual(contract["transport"]["method"], "signed-outbound-https")
        self.assertEqual(contract["transport"]["brokerBaseUrl"], "https://jaytipargal.tech")
        self.assertEqual(contract["transport"]["connectionMethod"], "signed-broker-v2")
        self.assertFalse(contract["transport"]["inboundListener"])

    def test_s24_release_contract_and_install_order_are_pinned(self):
        kp = kit_path("s24")
        installer = (kp / "install_s24.sh").read_text(encoding="utf-8")
        contract = json.loads((kp / "runtime_contract.json").read_text(encoding="utf-8"))
        official = ["status-only", "ping", "echo", "wa-push", "wa-media-push", "sync-now"]

        self.assertEqual(contract["command"]["allowlistedActions"], official)
        self.assertEqual(list(device_agent.S24_ALLOWED_COMMANDS), official)
        self.assertIn(f'"allowed_commands": {json.dumps(official)}', installer)
        self.assertNotIn("https://agent.jaytipargal.tech", installer)
        self.assertEqual(contract["heartbeat"]["agentVersionPrefix"], "s24-termux-broker-")
        self.assertTrue(contract["persistence"]["verifiedBeforeFinalHeartbeat"])

        enroll = installer.index("--enroll-only")
        old_process_stop = installer.index("process.terminate()")
        launcher = installer.index('cat >"$BOOT_PATH"')
        scheduler_proof = installer.index('PENDING_JOBS="$(termux-job-scheduler --pending)"')
        evidence = installer.index('"jobSchedulerVerified": True')
        final_heartbeat = installer.index("--once --log-file")
        self.assertLess(old_process_stop, enroll)
        self.assertLess(enroll, launcher)
        self.assertLess(launcher, scheduler_proof)
        self.assertLess(scheduler_proof, evidence)
        self.assertLess(evidence, final_heartbeat)

    def test_s24_installer_sha256_pins_match_bundled_bytes(self):
        kp = kit_path("s24")
        installer = (kp / "install_s24.sh").read_text(encoding="utf-8")
        pins = dict(re.findall(r"install_verified '([^']+)' '([0-9a-f]{64})'", installer))
        self.assertEqual(set(pins), {"device_agent.py", "broker_client.py", "signer.py", "single_instance.py"})
        for name, expected in pins.items():
            with self.subTest(artifact=name):
                actual = hashlib.sha256((kp / name).read_bytes()).hexdigest()
                self.assertEqual(expected, actual)


class TestS24AgentContract(unittest.TestCase):
    def test_official_actions_and_payloads_have_fixed_behavior(self):
        self.assertEqual(device_agent.handle_command("status-only", {})["status"], "ok")
        self.assertTrue(device_agent.handle_command("ping", {})["result"]["pong"])
        payload = {"message": "safe", "nested": {"value": 1}}
        self.assertEqual(device_agent.handle_command("echo", payload)["result"]["echoed"], payload)
        self.assertEqual(device_agent.handle_command("status-only", {"unexpected": True})["status"], "rejected")
        self.assertEqual(device_agent.handle_command("wa-push", {"timeout_seconds": 0})["status"], "rejected")
        self.assertEqual(device_agent.handle_command("wa-media-push", {"timeout_seconds": 901})["status"], "rejected")
        self.assertEqual(device_agent.handle_command("wakeup", {})["status"], "rejected")

    def test_android_and_persistence_evidence_must_all_pass(self):
        hardware = {"manufacturer": "Samsung", "model": "SM-S928B"}
        installation = {
            "termuxBootPackageVerified": True,
            "bootLauncherVerified": True,
            "jobSchedulerVerified": True,
        }
        with patch.dict(os.environ, {
            "ANDROID_ROOT": "/system",
            "PREFIX": "/data/data/com.termux/files/usr",
        }, clear=False):
            evidence = device_agent._s24_runtime_evidence(hardware, installation)
        self.assertEqual(evidence, {
            "heartbeatAuth": "termux-phone",
            "liveDeviceVerified": True,
            "sourceType": "live_daemon",
            "runtimeIsAndroid": True,
        })
        installation["jobSchedulerVerified"] = False
        with patch.dict(os.environ, {
            "ANDROID_ROOT": "/system",
            "PREFIX": "/data/data/com.termux/files/usr",
        }, clear=False):
            self.assertFalse(device_agent._s24_runtime_evidence(hardware, installation)["liveDeviceVerified"])


if __name__ == "__main__":
    unittest.main()
