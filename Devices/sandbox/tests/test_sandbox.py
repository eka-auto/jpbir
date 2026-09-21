from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import dashboard_api
import device_agent
from broker_client import BrokerAuthError
import firestore_client
import single_instance
from firestore_client import FirestoreClient, decode_fields, _encode_fields
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


class MakeClientConfigTests(unittest.TestCase):
    """``make_client`` must forward ``allow_production_devices`` to the client.

    It did not. ``FirestoreClient`` defaults the flag to False, so the
    real-mode/``devices`` guard fired unconditionally and
    ``SANDBOX_CONFIG_JSON``'s ``allow_production_devices`` was dead config on
    the HTTP path: the deployed dashboard reported ``firestore unavailable``
    even with the flag set to true, while ``device_agent.py`` - which does
    forward it - disagreed about what was permitted.
    """

    CFG = {
        "project": "test-project",
        "database": "eka-agent",
        "collection": "devices",
        "firestore_scope": "https://www.googleapis.com/auth/datastore",
        "mode": "real",
    }

    def forwarded(self, extra):
        cfg = dict(self.CFG, **extra)
        with patch.object(dashboard_api, "FirestoreClient") as fake:
            dashboard_api.make_client(cfg)
        return fake.call_args.kwargs["allow_production_devices"]

    def test_configured_true_reaches_the_client(self):
        self.assertIs(self.forwarded({"allow_production_devices": True}), True)

    def test_absent_flag_defaults_false_so_it_still_fails_closed(self):
        self.assertIs(self.forwarded({}), False)

    def test_explicit_false_is_not_silently_upgraded(self):
        self.assertIs(self.forwarded({"allow_production_devices": False}), False)

    def test_real_devices_collection_is_reachable_once_the_flag_is_set(self):
        guard = "without allow_production_devices=True"
        kwargs = dict(
            project="p",
            database="d",
            service_account_key="does-not-exist.json",
            scope="s",
            mode="real",
            collection="devices",
        )

        with self.assertRaises(ValueError) as blocked:
            FirestoreClient(**kwargs)
        self.assertIn(guard, str(blocked.exception))

        # Past the guard it reaches credential loading, which fails on the
        # missing key file - a different error, proving the guard was passed.
        with self.assertRaises(FileNotFoundError):
            FirestoreClient(**kwargs, allow_production_devices=True)


class MissingRosterTests(unittest.TestCase):
    """A config with no device roster must answer JSON 503, never an HTML 500.

    Every device route read ``cfg["devices"]`` directly, so a deployment whose
    ``SANDBOX_CONFIG_JSON`` omitted the roster answered with a bare KeyError
    that Flask rendered as an HTML 500. That reads like a crash and is not
    parseable by the JS dashboard that consumes these routes. The roster is not
    optional in a lambda - there is no ``devices.json`` there - so an absent one
    is a deployment misconfiguration and has to say so.
    """

    ROUTES = [
        ("get", "/api/devices"),
        ("get", "/api/devices/known/status"),
        ("get", "/api/data/calls"),
        ("post", "/api/devices/known/commands"),
    ]

    def setUp(self):
        dashboard_api.app.config["TESTING"] = True
        # TESTING implies PROPAGATE_EXCEPTIONS, which re-raises past the error
        # handler. Production runs with it off, so turn it off here to exercise
        # the path the lambda actually takes.
        dashboard_api.app.config["PROPAGATE_EXCEPTIONS"] = False
        dashboard_api.app.config["SANDBOX_CFG"] = {
            "collection": "sandbox_devices",
            "allowed_commands": ["ping"],
        }
        dashboard_api.app.config["FIRESTORE"] = Mock()
        dashboard_api.app.config["SANDBOX_AUTH_DISABLED"] = True
        self.addCleanup(self._reset_app_config)
        self.http = dashboard_api.app.test_client()

    @staticmethod
    def _reset_app_config():
        for key in (
            "SANDBOX_CFG",
            "FIRESTORE",
            "SANDBOX_AUTH_DISABLED",
            "PROPAGATE_EXCEPTIONS",
            "TESTING",
        ):
            dashboard_api.app.config.pop(key, None)

    def test_every_device_route_reports_misconfiguration_as_json(self):
        for method, path in self.ROUTES:
            with self.subTest(route=f"{method.upper()} {path}"):
                kwargs = {"json": {}} if method == "post" else {}
                response = getattr(self.http, method)(path, **kwargs)
                self.assertEqual(response.status_code, 503)
                self.assertTrue(response.is_json, f"{path} answered HTML, not JSON")
                body = response.get_json()
                self.assertEqual(body["error"], "server not configured")
                self.assertIn("devices", body["detail"])

    def test_an_empty_roster_fails_the_same_way_as_a_missing_one(self):
        dashboard_api.app.config["SANDBOX_CFG"]["devices"] = []
        response = self.http.get("/api/devices")
        self.assertEqual(response.status_code, 503)
        self.assertIn("devices", response.get_json()["detail"])

    def test_a_null_roster_fails_the_same_way_too(self):
        dashboard_api.app.config["SANDBOX_CFG"]["devices"] = None
        with self.assertRaises(dashboard_api.ConfigError):
            dashboard_api.configured_devices(
                dashboard_api.app.config["SANDBOX_CFG"]
            )

    def test_configured_devices_returns_the_roster_when_present(self):
        roster = [{"id": "known", "display_name": "Known"}]
        self.assertIs(dashboard_api.configured_devices({"devices": roster}), roster)


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

    def test_command_writer_accepts_contract_action_and_preserves_payload(self):
        response = self.http.post(
            "/api/devices/known/commands",
            json={"action": "echo", "payload": {"sequence": 7}},
        )
        self.assertEqual(response.status_code, 202)
        args = self.firestore.update_command_queue.call_args.args
        self.assertEqual(args[:2], ("sandbox_devices", "known"))
        self.assertEqual(args[3]["action"], "echo")
        self.assertEqual(args[3]["payload"], {"sequence": 7})
        self.assertEqual(args[3]["status"], "pending")

    def test_stale_config_cannot_reenable_non_contract_action(self):
        dashboard_api.app.config["SANDBOX_CFG"]["allowed_commands"] = ["start-ssh"]
        response = self.http.post(
            "/api/devices/known/commands", json={"action": "start-ssh"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not allowed", response.get_json()["error"])
        self.firestore.update_command_queue.assert_not_called()

    def test_agent_query_proxies_to_live_agent(self):
        upstream = Mock()
        upstream.ok = True
        upstream.json.return_value = {"response": "ok", "sources": 1}
        with patch.dict(
            os.environ,
            {"AGENT_API_URL": "http://agent.local:8000", "AGENT_API_KEY": "agent-key"},
            clear=False,
        ), patch.object(dashboard_api.requests, "post", return_value=upstream) as post:
            response = self.http.post("/api/agent/query", json={"query": "health", "use_rag": False})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["response"], "ok")
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["headers"]["X-API-Key"], "agent-key")
        self.assertEqual(post.call_args.kwargs["json"]["use_rag"], False)

    def test_agent_query_requires_configured_agent_key(self):
        with patch.dict(os.environ, {"AGENT_API_URL": "http://agent.local:8000"}, clear=False):
            response = self.http.post("/api/agent/query", json={"query": "health"})
        self.assertEqual(response.status_code, 503)


class DataRoutesTests(unittest.TestCase):
    """/api/data/<kind> is backed by live sources, not the dead subcollections.

    whatsapp reads Neon wa_messages over the SQL-over-HTTP API (DATABASE_URL),
    calls/sms read the rolling samsungS24DirectSync arrays the phone daemon
    PATCHes into the device doc (falling back to the legacy subcollection only
    when a device has no array yet), and contacts are an explicit
    not-collected state rather than a fake empty read.
    """

    NEON_URL = "postgres://user:pass@ep-demo-pooler.us-east-1.aws.neon.tech/db"

    def setUp(self):
        dashboard_api.app.config["TESTING"] = True
        # TESTING implies PROPAGATE_EXCEPTIONS, which would re-raise the
        # ConfigError a missing DATABASE_URL must instead answer 503 with.
        dashboard_api.app.config["PROPAGATE_EXCEPTIONS"] = False
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
        for key in (
            "SANDBOX_CFG",
            "FIRESTORE",
            "SANDBOX_AUTH_DISABLED",
            "PROPAGATE_EXCEPTIONS",
            "TESTING",
        ):
            dashboard_api.app.config.pop(key, None)

    @staticmethod
    def _doc_with_direct_sync(**arrays):
        sync = {name: rows for name, rows in arrays.items()}
        return {"fields": _encode_fields({"samsungS24DirectSync": sync})}

    def test_calls_read_the_live_direct_sync_array(self):
        self.firestore.get_doc.return_value = self._doc_with_direct_sync(
            callLogs=[
                {"number": "+91 111", "name": "A", "type": "Incoming",
                 "date": "2026-09-20T09:00:00+05:30", "duration_seconds": 60},
                {"number": "+91 222", "name": "B", "type": "Missed",
                 "date": "2026-09-20T10:00:00+05:30", "duration_seconds": 0},
            ]
        )
        response = self.http.get("/api/data/calls?limit=50")
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()["data"]
        # newest first, daemon shape passed through with deviceId attached
        self.assertEqual([r["number"] for r in rows], ["+91 222", "+91 111"])
        self.assertEqual(rows[0]["type"], "Missed")
        self.assertEqual(rows[0]["duration_seconds"], 0)
        self.assertEqual(rows[0]["deviceId"], "known")
        # the live array was present, so the legacy subcollection must not be read
        self.firestore.list_docs.assert_not_called()

    def test_calls_fall_back_to_the_subcollection_when_no_array_yet(self):
        self.firestore.get_doc.return_value = {"fields": {}}
        self.firestore.list_docs.return_value = [
            {"id": "c1", "number": "+91 999", "type": 2, "date": "2026-09-19T08:00:00+05:30",
             "duration": 45},
        ]
        response = self.http.get("/api/data/calls?limit=50")
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()["data"]
        self.assertEqual(len(rows), 1)
        # legacy numeric codes are normalized to the daemon's type strings
        self.assertEqual(rows[0]["type"], "Outgoing")
        self.assertEqual(rows[0]["duration_seconds"], 45)
        self.assertEqual(rows[0]["deviceId"], "known")
        self.firestore.list_docs.assert_called_once_with(
            "sandbox_devices", "known", "callLogs", limit=50
        )

    def test_sms_read_the_live_direct_sync_array(self):
        self.firestore.get_doc.return_value = self._doc_with_direct_sync(
            sms=[
                {"sender": "+91 555", "body": "hi", "timestamp": "2026-09-20T08:00:00+05:30",
                 "type": "Received"},
            ]
        )
        response = self.http.get("/api/data/sms?limit=50")
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()["data"]
        self.assertEqual(rows[0]["sender"], "+91 555")
        self.assertEqual(rows[0]["type"], "Received")
        self.assertEqual(rows[0]["deviceId"], "known")
        self.firestore.list_docs.assert_not_called()

    def test_whatsapp_without_database_url_is_server_not_configured(self):
        env = {k: v for k, v in os.environ.items()
               if k not in ("DATABASE_URL", "POSTGRES_URL")}
        with patch.dict(os.environ, env, clear=True):
            response = self.http.get("/api/data/whatsapp")
        self.assertEqual(response.status_code, 503)
        body = response.get_json()
        self.assertEqual(body["error"], "server not configured")
        self.assertIn("DATABASE_URL", body["detail"])

    def test_whatsapp_queries_neon_over_http(self):
        request_seen = {}

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps({
                    "rows": [{"msg_id": "m1", "chat_name": "Jayti", "body": "hello"}]
                }).encode("utf-8")

        def fake_urlopen(req, timeout=None):
            request_seen["url"] = req.full_url
            request_seen["header"] = req.get_header("Neon-connection-string")
            request_seen["sql"] = req.data.decode("utf-8")
            return FakeResp()

        with patch.dict(os.environ, {"DATABASE_URL": self.NEON_URL}, clear=False), \
                patch.object(dashboard_api.urllib.request, "urlopen", fake_urlopen):
            response = self.http.get("/api/data/whatsapp?limit=25")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"][0]["msg_id"], "m1")
        # the HTTP SQL API answers on the direct endpoint, not the pooler
        self.assertEqual(
            request_seen["url"],
            "https://ep-demo.us-east-1.aws.neon.tech/sql",
        )
        self.assertEqual(request_seen["header"], self.NEON_URL)
        self.assertIn("JOIN wa_chats", request_seen["sql"])
        self.assertIn("LIMIT 25", request_seen["sql"])

    def test_whatsapp_neon_failure_is_a_502_not_a_crash(self):
        def failing_urlopen(req, timeout=None):
            raise urllib.error.URLError("connection reset")

        with patch.dict(os.environ, {"DATABASE_URL": self.NEON_URL}, clear=False), \
                patch.object(dashboard_api.urllib.request, "urlopen", failing_urlopen):
            response = self.http.get("/api/data/whatsapp")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "live store unavailable")

    def test_contacts_are_an_explicit_not_collected_state(self):
        response = self.http.get("/api/data/contacts")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["data"], [])
        self.assertIs(body["collected"], False)
        self.assertIn("not collected", body["note"])
        # no Firestore read backs a state that has no source at all
        self.firestore.get_doc.assert_not_called()
        self.firestore.list_docs.assert_not_called()

    def test_unknown_kind_is_still_a_404(self):
        response = self.http.get("/api/data/weather")
        self.assertEqual(response.status_code, 404)


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

    def test_every_mode_takes_the_guard_and_releases_it_on_failure(self):
        # --once used to run unguarded and raced the daemon the installer's own
        # JobScheduler job had just started: both signed the same seq, and the
        # second request was rejected as a replay.
        for flag in ("--once", "--enroll-only"):
            with self.subTest(flag=flag):
                argv = ["device_agent.py", "config.json", "device-1", flag]
                with patch.object(sys, "argv", argv), patch.object(
                    device_agent, "run", side_effect=RuntimeError("failed")
                ), patch.object(device_agent, "acquire_guard") as acquire, patch.object(
                    device_agent, "release_guard"
                ) as release, patch.object(device_agent.atexit, "register"):
                    with self.assertRaises(SystemExit) as caught:
                        device_agent.main()
                self.assertEqual(caught.exception.code, 2)
                acquire.assert_called_once()
                release.assert_called()

    def test_a_held_guard_exits_with_the_code_the_installer_retries_on(self):
        argv = ["device_agent.py", "config.json", "device-1", "--once"]
        with patch.object(sys, "argv", argv), patch.object(
            device_agent, "acquire_guard", side_effect=device_agent.GuardHeldError("held")
        ), patch.object(device_agent, "run") as run:
            with self.assertRaises(SystemExit) as caught:
                device_agent.main()
        self.assertEqual(caught.exception.code, device_agent.GUARD_HELD_EXIT)
        self.assertEqual(device_agent.GUARD_HELD_EXIT, 75)
        run.assert_not_called()

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


class BrokerEnrollOnlyTests(unittest.TestCase):
    CFG = {
        "broker_url": "https://example.invalid",
        "heartbeat_interval_seconds": 45,
        "command_poll_interval_seconds": 15,
        "allowed_commands": list(device_agent.S24_ALLOWED_COMMANDS),
    }

    def enroll_only(self, device_id, cfg=None, poll=None):
        client = Mock(enrolled=True)
        client.poll.side_effect = poll if poll is not None else [{"commands": []}]
        with patch.object(device_agent, "make_signer"), patch.object(
            device_agent, "BrokerClient", return_value=client
        ):
            device_agent.run_broker(
                cfg or dict(self.CFG), Path(tempfile.gettempdir()), device_id, {"id": device_id},
                False, enroll_only=True,
            )
        return client

    def test_existing_enrollment_is_proven_with_a_signed_poll_not_assumed(self):
        # Local state saying "enrolled" used to be enough for the installer to print
        # "signed enrollment verified" and install boot persistence.
        client = self.enroll_only("samsung-s24-ultra")
        client.poll.assert_called_once()
        client.enroll.assert_not_called()
        client.heartbeat.assert_not_called()

    def test_a_revoked_or_expired_key_stops_before_persistence_is_installed(self):
        with self.assertRaises(SystemExit) as caught:
            self.enroll_only("samsung-s24-ultra", poll=BrokerAuthError("key expired; re-enroll", status=403))
        self.assertIn("fresh enrollment code", str(caught.exception.code))

    def test_s24_allowlist_is_the_contract_set_in_any_order(self):
        reordered = ["sync-now", "status-only", "ping", "echo", "wa-push", "wa-media-push"]
        self.enroll_only("samsung-s24-ultra", cfg={**self.CFG, "allowed_commands": reordered})
        with self.assertRaises(SystemExit):
            self.enroll_only("samsung-s24-ultra", cfg={**self.CFG, "allowed_commands": reordered[:-1]})
        with self.assertRaises(SystemExit):
            self.enroll_only("samsung-s24-ultra", cfg={**self.CFG, "allowed_commands": reordered + ["start-ssh"]})


if __name__ == "__main__":
    unittest.main()
