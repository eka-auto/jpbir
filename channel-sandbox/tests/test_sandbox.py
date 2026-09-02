from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import dashboard_api
import device_agent
import firestore_client
import single_instance
from firestore_client import FirestoreClient, decode_fields
from single_instance import check_guard, cmdline_matches


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self.payload = payload or {}

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise firestore_client.requests.HTTPError(response=self)


class FirestoreClientTests(unittest.TestCase):
    def make_client(self):
        return FirestoreClient(
            project="test-project",
            database="(default)",
            service_account_key="does-not-exist.json",
            scope="scope",
            mode="emulator",
            collection="sandbox_devices",
            emulator_host="127.0.0.1:8080",
        )

    def test_emulator_skips_credentials_and_real_devices_is_refused(self):
        client = self.make_client()
        self.assertIsNone(client._creds)
        with self.assertRaises(ValueError):
            FirestoreClient(
                "p", "d", "missing.json", "s", mode="real", collection="devices"
            )

    def test_paths_escape_collection_and_document_segments(self):
        self.assertEqual(
            FirestoreClient._path("a/b", "id?updateMask.fieldPaths=x"),
            "/a%2Fb/id%3FupdateMask.fieldPaths%3Dx",
        )

    def test_three_401_responses_return_last_response(self):
        client = self.make_client()
        responses = [FakeResponse(401) for _ in range(3)]
        with patch.object(firestore_client.requests, "request", side_effect=responses):
            result = client._request("GET", "/x")
        self.assertIs(result, responses[-1])
        self.assertEqual(client._token_expiry, 0.0)

    def test_request_exception_is_reraised(self):
        client = self.make_client()
        error = firestore_client.requests.ConnectionError("offline")
        with patch.object(
            firestore_client.requests, "request", side_effect=error
        ), patch.object(firestore_client.time, "sleep"):
            with self.assertRaises(firestore_client.requests.ConnectionError):
                client._request("GET", "/x")

    def test_naive_expiry_is_interpreted_as_utc(self):
        client = object.__new__(FirestoreClient)
        client.mode = "real"
        client._lock = threading.Lock()
        client._token = None
        client._token_expiry = 0.0
        expiry = datetime(2035, 1, 2, 3, 4, 5)
        creds = Mock(token="token", expiry=expiry)
        client._creds = creds
        self.assertEqual(client._ensure_token(), "token")
        self.assertEqual(
            client._token_expiry, expiry.replace(tzinfo=timezone.utc).timestamp()
        )

    def test_decode_fields_supports_extended_wire_types(self):
        decoded = decode_fields(
            {
                "time": {"timestampValue": "2026-01-01T00:00:00Z"},
                "bytes": {"bytesValue": "YWJj"},
                "ref": {"referenceValue": "projects/p/documents/x/y"},
                "point": {"geoPointValue": {"latitude": 1, "longitude": 2}},
            }
        )
        self.assertEqual(decoded["time"], "2026-01-01T00:00:00Z")
        self.assertEqual(decoded["point"]["longitude"], 2)

    def test_queue_cas_retries_and_preserves_raw_sibling_values(self):
        client = self.make_client()
        document = {
            "name": "projects/test-project/databases/(default)/documents/sandbox_devices/device",
            "updateTime": "2026-01-01T00:00:00Z",
            "fields": {
                "commandQueue": {
                    "mapValue": {
                        "fields": {
                            "sibling": {
                                "mapValue": {
                                    "fields": {
                                        "created": {
                                            "timestampValue": "2025-01-01T00:00:00Z"
                                        }
                                    }
                                }
                            },
                            "target": {
                                "mapValue": {
                                    "fields": {"action": {"stringValue": "ping"}}
                                }
                            },
                        }
                    }
                }
            },
        }
        client.get_doc = Mock(return_value=document)
        responses = [FakeResponse(412), FakeResponse(200, {"ok": True})]
        client._request = Mock(side_effect=responses)

        result = client.update_command_queue(
            "sandbox_devices", "device", "target", {"status": "ok"}
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(client._request.call_count, 2)
        body = client._request.call_args.kwargs["body"]
        write = body["writes"][0]
        queue = write["update"]["fields"]["commandQueue"]["mapValue"]["fields"]
        self.assertEqual(
            queue["sibling"]["mapValue"]["fields"]["created"],
            {"timestampValue": "2025-01-01T00:00:00Z"},
        )
        self.assertEqual(
            queue["target"]["mapValue"]["fields"]["action"],
            {"stringValue": "ping"},
        )
        self.assertEqual(
            write["currentDocument"],
            {"updateTime": "2026-01-01T00:00:00Z"},
        )
        self.assertEqual(client._request.call_args.args, ("POST", ":commit"))


class DashboardTests(unittest.TestCase):
    def setUp(self):
        dashboard_api.app.config["TESTING"] = True
        dashboard_api.app.config["SANDBOX_CFG"] = {
            "collection": "sandbox_devices",
            "devices": [{"id": "known", "display_name": "Known"}],
            "allowed_commands": ["ping"],
        }
        self.firestore = Mock()
        dashboard_api.app.config["FIRESTORE"] = self.firestore
        dashboard_api.app.config["SANDBOX_AUTH_DISABLED"] = True
        self.addCleanup(self._reset_app_config)
        self.http = dashboard_api.app.test_client()

    @staticmethod
    def _reset_app_config():
        for key in ("SANDBOX_CFG", "FIRESTORE", "SANDBOX_AUTH_DISABLED"):
            dashboard_api.app.config.pop(key, None)

    def test_devices_decodes_fields(self):
        self.firestore.get_doc.return_value = {
            "fields": {"online": {"booleanValue": True}}
        }
        response = self.http.get("/api/devices")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["devices"][0]["status"]["online"])

    def test_unknown_device_is_rejected_before_firestore(self):
        self.assertEqual(self.http.get("/api/devices/unknown/status").status_code, 404)
        self.assertEqual(
            self.http.post(
                "/api/devices/unknown/commands", json={"action": "ping"}
            ).status_code,
            404,
        )
        self.firestore.get_doc.assert_not_called()
        self.firestore.update_command_queue.assert_not_called()


class DashboardAuthTests(unittest.TestCase):
    """The deployed dashboard is public, so the key gate must fail closed."""

    def setUp(self):
        dashboard_api.app.config["TESTING"] = True
        dashboard_api.app.config["SANDBOX_CFG"] = {
            "collection": "sandbox_devices",
            "devices": [{"id": "known", "display_name": "Known"}],
            "allowed_commands": ["ping"],
        }
        self.firestore = Mock()
        self.firestore.get_doc.return_value = {"fields": {}}
        dashboard_api.app.config["FIRESTORE"] = self.firestore
        dashboard_api.app.config.pop("SANDBOX_AUTH_DISABLED", None)
        self.addCleanup(DashboardTests._reset_app_config)
        self.http = dashboard_api.app.test_client()

    def test_status_is_reachable_without_a_key(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.http.get("/api/status").status_code, 200)

    def test_unset_stats_key_refuses_rather_than_allows(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.http.get("/api/devices")
        self.assertEqual(response.status_code, 503)
        self.firestore.get_doc.assert_not_called()

    def test_wrong_key_is_rejected_before_firestore(self):
        with patch.dict(os.environ, {"STATS_KEY": "correct"}, clear=True):
            response = self.http.post(
                "/api/devices/known/commands?key=wrong", json={"action": "ping"}
            )
        self.assertEqual(response.status_code, 401)
        self.firestore.update_command_queue.assert_not_called()

    def test_correct_key_in_query_string_is_accepted(self):
        with patch.dict(os.environ, {"STATS_KEY": "correct"}, clear=True):
            response = self.http.get("/api/devices?key=correct")
        self.assertEqual(response.status_code, 200)

    def test_correct_key_in_header_is_accepted(self):
        with patch.dict(os.environ, {"STATS_KEY": "correct"}, clear=True):
            response = self.http.get(
                "/api/devices", headers={"X-Stats-Key": "correct"}
            )
        self.assertEqual(response.status_code, 200)

    def test_keys_endpoint_reports_fingerprints_without_private_keys(self):
        pub = (
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYkFrKFeBgyD5/trJjLVyJ1mHYPKbAGXnCoCRGTAl0p"
            " your_email@example.com"
        )
        with patch.dict(
            os.environ,
            {"STATS_KEY": "correct", "SSH_PUBKEY_PRIMARY": pub},
            clear=True,
        ):
            response = self.http.get("/api/keys?key=correct")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(len(body["keys"]), 1)
        self.assertEqual(body["keys"][0]["name"], "primary")
        self.assertEqual(body["keys"][0]["comment"], "your_email@example.com")
        self.assertTrue(body["keys"][0]["fingerprint"].startswith("SHA256:"))
        self.assertNotIn("PRIVATE", response.get_data(as_text=True))

    def test_keys_endpoint_requires_auth(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.http.get("/api/keys")
        self.assertEqual(response.status_code, 503)


class DashboardEnvConfigTests(unittest.TestCase):
    """Vercel imports dashboard_api:app, so config must come from the env."""

    def test_missing_config_env_is_reported_not_raised_as_keyerror(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(dashboard_api.ConfigError) as caught:
                dashboard_api.load_config_from_env()
        self.assertIn("SANDBOX_CONFIG_JSON", str(caught.exception))

    def test_real_mode_reads_the_service_account_from_the_env(self):
        env = {
            "SANDBOX_CONFIG_JSON": json.dumps(
                {"project": "p", "database": "(default)", "collection": "c",
                 "firestore_scope": "s", "devices": []}
            ),
            "FIREBASE_SERVICE_ACCOUNT_JSON": json.dumps({"client_email": "a@b.c"}),
        }
        with patch.dict(os.environ, env, clear=True):
            cfg = dashboard_api.load_config_from_env()
        self.assertEqual(cfg["mode"], "real")
        self.assertEqual(cfg["service_account_info"], {"client_email": "a@b.c"})
        self.assertNotIn("service_account_key", cfg)

    def test_real_mode_without_a_service_account_is_refused(self):
        env = {
            "SANDBOX_CONFIG_JSON": json.dumps(
                {"project": "p", "database": "(default)", "collection": "c",
                 "firestore_scope": "s", "devices": []}
            ),
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(dashboard_api.ConfigError) as caught:
                dashboard_api.load_config_from_env()
        self.assertIn("FIREBASE_SERVICE_ACCOUNT_JSON", str(caught.exception))


class AgentAndGuardTests(unittest.TestCase):
    def test_cmdline_match_requires_exact_script_basename_and_device_token(self):
        self.assertTrue(
            cmdline_matches(
                ["python", r"C:\sandbox\device_agent.py", "cfg", "device-1"],
                "device-1",
            )
        )
        self.assertFalse(
            cmdline_matches(
                ["python", r"C:\sandbox\device_agent.py", "cfg", "device-10"],
                "device-1",
            )
        )
        self.assertFalse(
            cmdline_matches(["python", "not_device_agent.py", "device-1"], "device-1")
        )

    def test_guard_only_blocks_a_confirmed_matching_process(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / "agent.pid"
            pidfile.write_text("12345\n10.000000\n", encoding="ascii")

            process = Mock()
            process.create_time.return_value = 10.0
            process.cmdline.return_value = [
                "python",
                str(HERE / "device_agent.py"),
                "config.json",
                "device-1",
            ]
            with patch("single_instance.psutil.Process", return_value=process):
                self.assertTrue(check_guard("device-1", pidfile))

            process.create_time.return_value = 11.0
            with patch("single_instance.psutil.Process", return_value=process):
                self.assertFalse(check_guard("device-1", pidfile))

            with patch(
                "single_instance.psutil.Process",
                side_effect=single_instance.psutil.AccessDenied(pid=12345),
            ):
                self.assertFalse(check_guard("device-1", pidfile))

    def test_process_queue_batches_all_pending_updates(self):
        command = lambda action: {
            "mapValue": {
                "fields": {
                    "action": {"stringValue": action},
                    "status": {"stringValue": "pending"},
                }
            }
        }
        client = Mock()
        client.get_doc.return_value = {
            "fields": {
                "commandQueue": {
                    "mapValue": {
                        "fields": {
                            "one": command("ping"),
                            "two": command("blocked"),
                        }
                    }
                }
            }
        }
        device_agent.process_command_queue(client, "c", "d", ["ping"])
        client.update_command_queue_entries.assert_called_once()
        entries = client.update_command_queue_entries.call_args.args[2]
        self.assertEqual(set(entries), {"one", "two"})
        self.assertEqual(entries["one"]["status"], "ok")
        self.assertEqual(entries["two"]["status"], "rejected")

    def test_once_failure_exits_two_and_skips_guard(self):
        argv = ["device_agent.py", "config.json", "device-1", "--once"]
        with patch.object(sys, "argv", argv), patch.object(
            device_agent, "run", side_effect=RuntimeError("failed")
        ), patch.object(device_agent, "acquire_guard") as acquire:
            with self.assertRaises(SystemExit) as caught:
                device_agent.main()
        self.assertEqual(caught.exception.code, 2)
        acquire.assert_not_called()

    def test_broker_launchers_share_guard_beside_broker_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "shared" / "device.broker-state.json"
            configs = []
            for name in ("task", "startup"):
                config = root / name / "devices.json"
                config.parent.mkdir()
                config.write_text(
                    json.dumps({
                        "transport": "broker",
                        "broker_state_file": str(state),
                    }),
                    encoding="utf-8",
                )
                configs.append(config)

            paths = [device_agent.guard_pidfile(config, "device-1") for config in configs]
            self.assertEqual(paths[0], paths[1])
            self.assertEqual(paths[0], state.parent / "logs" / "device-1.pid")


if __name__ == "__main__":
    unittest.main()
