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


def legacy_cleanup_body(installer: str) -> str:
    """The code of Remove-LegacyFleetStartup, full-line comments dropped.

    From its declaration to the first closing brace at column 0, so the
    cleanup assertions cannot be satisfied by code elsewhere in the installer,
    and a comment can neither satisfy nor trip one.
    """
    start = re.search(r"(?m)^function Remove-LegacyFleetStartup \{$", installer)
    assert start is not None, "Remove-LegacyFleetStartup is not defined"
    end = installer.index("\n}\n", start.start())
    body = installer[start.start():end + 2]
    return "\n".join(line for line in body.split("\n") if not re.match(r"\s*#", line))


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
                # Scoped to the cleanup function's own code. Against the whole
                # file, Stop-Process and serviceAccountKey.json were already
                # satisfied by the running-broker restart and the $StaleKey
                # removal, so deleting the legacy kill or key removal stayed green.
                body = legacy_cleanup_body(installer)
                self.assertIn("$LegacyRoot = 'C:\\eka-fleet-agent'", body)
                self.assertIn("EKA-Fleet-Agent.vbs", body)
                self.assertIn("CommonStartup", body)
                self.assertIn("Stop-Process -Id $ProcessId", body)
                self.assertIn("Unregister-ScheduledTask", body)
                self.assertRegex(body, r"Join-Path \$LegacyRoot 'serviceAccountKey\.json'[\s\S]*Remove-Item -LiteralPath \$LegacyKey")
                self.assertIn("Write-Warning", body)
                self.assertGreater(
                    installer.rindex("Remove-LegacyFleetStartup"),
                    installer.index("Persistent broker startup did not prove a signed request"),
                )
                # Set-StrictMode -Version Latest: a COM-handler task action has no
                # Execute/Arguments, and reading them threw and emptied the list.
                self.assertRegex(installer, r"(?m)^Set-StrictMode -Version Latest$")
                self.assertNotRegex(body, r"\$_\.(Execute|Arguments)\b")
                self.assertIn("PSObject.Properties[$Name]", body)
                # pythonw.exe writer, wscript/cscript loop, 32-bit Run key, .lnk shortcuts.
                self.assertIn(r"pythonw?\.exe", body)
                self.assertIn(r"[wc]script\.exe", body)
                self.assertIn("WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run", body)
                self.assertIn("Extension -ieq '.lnk'", body)

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

    def test_s24_daemon_installer_requires_the_signed_broker_not_a_service_account(self):
        installer = (kit_path("s24") / "install_daemon.sh").read_text(encoding="utf-8")
        self.assertIn("verify_broker_install", installer)
        self.assertIn("install_s24.sh", installer)
        self.assertIn("BROKER_CONFIG_PATH", installer)
        self.assertIn("broker_state_file", installer)
        self.assertIn("installation_evidence_file", installer)
        self.assertIn("broker_recovery_required", installer)
        self.assertIn("isinstance(record, dict)", installer)
        self.assertIn("os.path.getsize(boot_launcher) > 0", installer)
        self.assertIn("exit 78", installer)
        self.assertNotIn("serviceAccountKey", installer)
        # The call, not the definition: index("verify_broker_install") found the
        # declaration on line 21, which precedes `pkg update -y` whether or not
        # the function is ever called.
        definition = re.search(r"(?m)^verify_broker_install\(\) \{$", installer)
        call = re.search(r"(?m)^verify_broker_install$", installer)
        self.assertIsNotNone(call, "verify_broker_install is defined but never called")
        self.assertIsNotNone(definition)
        self.assertGreater(call.start(), definition.start())
        for later in ("pkg update -y", "pkg install -y", 'cp "$WA_DIR/wa_push.py"', "| crontab -"):
            with self.subTest(later=later):
                self.assertLess(call.start(), installer.index(later))

    def test_s24_daemon_installer_provisions_no_listener(self):
        # runtime_contract.json transport.inboundListener is false; this
        # installer used to provision s24-agent-daemon.mjs, a Node HTTP server
        # with a run_shell tool, and tell the operator to start it.
        kp = kit_path("s24")
        installer = (kp / "install_daemon.sh").read_text(encoding="utf-8")
        contract = json.loads((kp / "runtime_contract.json").read_text(encoding="utf-8"))
        self.assertFalse(contract["transport"]["inboundListener"])
        self.assertNotRegex(installer, r'cat > "?\$APP_DIR/run\.sh"?|cat > package\.json|AGENT_TOKEN="\$\(openssl')
        self.assertNotRegex(installer, r"(?m)^pkg install[^\n]*\b(nodejs|nodejs-lts|openssl-tool)\b")
        done = installer[installer.index("Install complete"):]
        self.assertNotRegex(done, r"run\.sh|s24-agent-daemon|loopback-only")
        for kept in ("wa_push_tick.sh", "wa_media_tick.sh", "wa_export_tick.sh"):
            with self.subTest(kept=kept):
                self.assertIn(f'"$APP_DIR/{kept}"', installer)

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

        # The previous release's job cannot relaunch a daemon mid-enrollment, the final
        # heartbeat retries when the new job's daemon holds the guard (exit 75) instead of
        # racing it on the same seq, and success is a live guard owner, not one PID.
        self.assertLess(installer.index('termux-job-scheduler --cancel --job-id "$JOB_ID"'), enroll)
        self.assertIn('[[ "$final_status" -eq 75 ]] || break', installer)
        self.assertLess(installer.index("stop_running_agent\n  final_status=0"), final_heartbeat)
        self.assertIn('DAEMON_PID="$(guard_owner_pid)"', installer)
        self.assertNotIn('kill -0 "$DAEMON_PID"', installer)

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
