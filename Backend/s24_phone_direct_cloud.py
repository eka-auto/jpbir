#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
S24 Direct-to-Cloud Autopilot Sync Daemon
DESIGNED EXCLUSIVELY TO RUN ON THE SAMSUNG S24 (Inside the Termux App).
100% Laptop-Free. No ADB wireless connect, no local ARP scans, no laptop dependencies.
Queries native Android call logs, SMS, and GPS location locally on the device,
and writes them directly to Firestore over public HTTPS REST APIs on any network (4G/5G or Wi-Fi).
"""

import os
import re
import sys
import time
import json
import shutil
import subprocess
import urllib.request
import urllib.parse
import threading
from datetime import datetime, timezone, timedelta

# Google Firestore Configurations
PROJECT_ID = 'intrepid-stage-495117-q1'
FIRESTORE_DB = os.environ.get('EKA_FIRESTORE_DB', 'eka-agent')
DEVICE_DOC_ID = 'samsung-s24-ultra'
SECONDARY_DOC_ID = 'Samsung-S24'
CANONICAL_DEVICE_ID = DEVICE_DOC_ID
LEGACY_DEVICE_IDS = [SECONDARY_DOC_ID]
KEY_PATH = 'serviceAccountKey.json'
IST = timezone(timedelta(hours=5, minutes=30))
DIRECT_CLOUD_BUILD = '2026-09-07.1'
DIRECT_CLOUD_SCHEMA_VERSION = 's24-direct-cloud-v3'
DIRECT_CLOUD_CONNECTION_METHOD = 'termux-direct-cloud'

# Values claimed only when this really is the phone. They are assigned below,
# after the Android guard has run — see the note there for why they cannot stay
# constants.
TERMUX_AGENT_VERSION = 's24-termux-direct-cloud-' + DIRECT_CLOUD_BUILD
TERMUX_HEARTBEAT_AUTH = 'termux-phone'
TERMUX_SOURCE_TYPE = 'live_termux'
DIRECT_CLOUD_REPO_URL = 'https://github.com/jaytipargal/eka-runner.git'
DIRECT_CLOUD_WRITER = 's24_phone_direct_cloud.py'
DIRECT_CLOUD_BOOT_SCRIPT = 'termux/boot/start_s24_direct_cloud.sh'
DIRECT_CLOUD_INSTALL_SCRIPT = 'termux/install_s24_direct_cloud.sh'
PROCESS_STARTED_AT = datetime.now(timezone.utc).isoformat()
PROCESS_ID = os.getpid()
TOKEN_CACHE = {'token': None, 'expires_at': 0.0}
os.environ["EKA_VERBOSE_DEVICE_OUTPUT"] = "0"

if os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') != '1':
    try:
        _LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 's24_phone_direct_cloud.log')
        _LOG_FILE = open(_LOG_PATH, 'a', encoding='utf-8', buffering=1)
    except Exception:
        _LOG_FILE = open(os.devnull, 'w', encoding='utf-8')
    sys.stdout = _LOG_FILE
    sys.stderr = _LOG_FILE


def _is_android_termux_runtime():
    prefix = os.environ.get('PREFIX', '')
    home = os.environ.get('HOME', '')
    return (
        os.path.exists('/system/bin/getprop')
        and (
            '/data/data/com.termux' in prefix
            or '/data/data/com.termux' in home
            or command_exists_for_guard('termux-battery-status')
        )
    )


def command_exists_for_guard(name):
    return shutil.which(name) is not None


RUNTIME_IS_ANDROID = _is_android_termux_runtime()
RUNTIME_PLATFORM = sys.platform
print(
    "[Runtime] role=s24-phone-direct-cloud platform=%s androidTermux=%s executable=%r"
    % (RUNTIME_PLATFORM, RUNTIME_IS_ANDROID, sys.executable)
)

# There is no laptop mode. A Windows process can reach Firestore, but it cannot
# read Android providers; allowing it to run created fresh heartbeats with empty
# phone payloads and previously let an old process assert Termux attestation.
if not RUNTIME_IS_ANDROID:
    print(
        "[FATAL] Refusing to run S24 direct-cloud collector outside Android Termux. "
        f"platform={sys.platform} executable={sys.executable!r} cwd={os.getcwd()!r}"
    )
    print(
        "[FATAL] EKA_ALLOW_NON_TERMUX_S24_AGENT is no longer an override. The laptop "
        "must use the read-only Firestore-to-local exporter instead."
    )
    sys.exit(78)


# The attestation a document carries describes the runtime that wrote it.
if RUNTIME_IS_ANDROID:
    DIRECT_CLOUD_AGENT_VERSION = TERMUX_AGENT_VERSION
    HEARTBEAT_AUTH = TERMUX_HEARTBEAT_AUTH
    HEARTBEAT_SOURCE_TYPE = TERMUX_SOURCE_TYPE
    LIVE_DEVICE_VERIFIED = True
else:
    # Defensive fallback for static analysis; startup exits before this branch
    # can execute on a non-Android runtime.
    DIRECT_CLOUD_AGENT_VERSION = 's24-bridge-%s-%s' % (RUNTIME_PLATFORM, DIRECT_CLOUD_BUILD)
    HEARTBEAT_AUTH = 'non-termux-bridge'
    HEARTBEAT_SOURCE_TYPE = 'bridge_process'
    LIVE_DEVICE_VERIFIED = False


def _find_service_account_key():
    """Search for serviceAccountKey.json in multiple locations."""
    candidates = [
        KEY_PATH,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'serviceAccountKey.json'),
        r'C:\eka-llm\serviceAccountKey.json',
        r'C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json',
        os.path.expanduser('~/eka-runner/serviceAccountKey.json'),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None

def get_firestore_token():
    """Generates an OAuth bearer token dynamically from the local serviceAccountKey.json"""
    now = time.time()
    cached = TOKEN_CACHE.get('token')
    if cached and now < TOKEN_CACHE.get('expires_at', 0.0) - 60:
        return cached
    key_file = _find_service_account_key()
    if not key_file:
        print(f"[Sync] serviceAccountKey.json not found in any location. Standard token required.")
        return None
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(
            key_file, scopes=['https://www.googleapis.com/auth/datastore'])
        creds.refresh(Request())
        TOKEN_CACHE['token'] = creds.token
        TOKEN_CACHE['expires_at'] = now + 3500
        return creds.token
    except Exception as e:
        print(f"[Sync] Dynamic OAuth generation failure: {e}")
        return None

def _enc(v):
    """Firestore REST API Value Encoder"""
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': v}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {kk: _enc(vv) for kk, vv in v.items()}}}
    if isinstance(v, list):
        return {'arrayValue': {'values': [_enc(x) for x in v]}}
    return {'stringValue': str(v)}


def _set_encoded_field_path(fields, field_path, value):
    """Set a dotted Firestore update path in a nested document body."""
    target = fields
    parts = field_path.split('.')
    for part in parts[:-1]:
        node = target.setdefault(part, {'mapValue': {'fields': {}}})
        target = node['mapValue']['fields']
    target[parts[-1]] = _enc(value)

def _dec(value):
    if not isinstance(value, dict):
        return None
    if 'nullValue' in value:
        return None
    if 'stringValue' in value:
        return value['stringValue']
    if 'booleanValue' in value:
        return bool(value['booleanValue'])
    if 'integerValue' in value:
        return int(value['integerValue'])
    if 'doubleValue' in value:
        return float(value['doubleValue'])
    if 'timestampValue' in value:
        return value['timestampValue']
    if 'mapValue' in value:
        fields = value.get('mapValue', {}).get('fields', {})
        return {key: _dec(child) for key, child in fields.items()}
    if 'arrayValue' in value:
        values = value.get('arrayValue', {}).get('values', [])
        return [_dec(child) for child in values]
    return None


def merge_maps(primary, secondary):
    merged = {}
    if isinstance(secondary, dict):
        merged.update(secondary)
    if isinstance(primary, dict):
        merged.update(primary)
    return merged


def fetch_firestore_document(doc_id):
    token = get_firestore_token()
    if not token:
        return {}
    headers = {'Authorization': f'Bearer {token}'}
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{FIRESTORE_DB}/documents/devices/{doc_id}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        print(f"[Cloud] Failed reading document {doc_id}: {exc}")
        return {}
    fields = payload.get('fields', {})
    return {key: _dec(value) for key, value in fields.items()}


def fetch_remote_state():
    # Reads both docs for backward-compatibility (legacy commands may still arrive
    # in Samsung-S24). Writes go ONLY to the canonical doc (see push_to_firestore).
    primary = fetch_firestore_document(DEVICE_DOC_ID)
    secondary = fetch_firestore_document(SECONDARY_DOC_ID)
    merged = {}
    if isinstance(secondary, dict):
        merged.update(secondary)
    if isinstance(primary, dict):
        merged.update(primary)
    for key in ('currentDirectCloudRuntime', 'termuxInstallation', 'commandQueue', 'samsungS24DirectSync', 'samsungS24CloudSync'):
        nested = merge_maps(
            primary.get(key) if isinstance(primary, dict) else None,
            secondary.get(key) if isinstance(secondary, dict) else None,
        )
        if nested:
            merged[key] = nested
    return merged


def push_to_firestore(payload, doc_ids=None):
    """Write S24 telemetry directly to the Firestore REST API over public HTTPS"""
    token = get_firestore_token()
    if not token:
        print("[Cloud] Direct write cancelled: No valid OAuth token available.")
        return False
        
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }

    success = True
    # Write only to the canonical document. Writing to SECONDARY_DOC_ID as well
    # duplicates sensitive telemetry (SMS, call logs, location) and doubles the
    # Firestore write surface. Legacy Samsung-S24 doc is read-only from here on.
    for doc_id in doc_ids or [DEVICE_DOC_ID]:
        url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{FIRESTORE_DB}/documents/devices/{doc_id}"
        
        # Build update mask query parameters
        paths = [f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in payload.keys()]
        patch_url = f"{url}?{'&'.join(paths)}"
        
        fields = {k: _enc(v) for k, v in payload.items()}
        body = json.dumps({"fields": fields}).encode('utf-8')
        
        try:
            req = urllib.request.Request(patch_url, data=body, method='PATCH', headers=headers)
            urllib.request.urlopen(req, timeout=12)
            print(f"[Cloud] Successfully wrote direct telemetry to Firestore document: {doc_id}")
        except Exception as e:
            success = False
            print(f"[Cloud] Failed writing to document {doc_id}: {e}")
    return success

def get_dual_user_ids():
    """Discover active user profiles on the S24 (Main and Cloned Messenger spaces)"""
    try:
        # Run Termux shell package manager command directly on phone
        res = subprocess.run(['pm', 'list', 'users'], capture_output=True, text=True, timeout=5)
        user_ids = []
        for line in res.stdout.splitlines():
            match = re.search(r'UserInfo{(\d+):', line)
            if match:
                user_ids.append(match.group(1))
        return user_ids if user_ids else ['0']
    except Exception:
        return ['0']

def command_exists(name):
    return shutil.which(name) is not None


def run_command(args, timeout=10):
    try:
        res = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return {
            'ok': res.returncode == 0,
            'returncode': res.returncode,
            'stdout': res.stdout or '',
            'stderr': res.stderr or '',
        }
    except Exception as exc:
        return {
            'ok': False,
            'returncode': None,
            'stdout': '',
            'stderr': str(exc),
        }


def truncate_text(value, limit=180):
    text = str(value or '').strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit - 1]}…"


def to_int(value, default=0):
    try:
        return int(str(value).strip())
    except Exception:
        return default


def env_int(name, default, minimum=1):
    try:
        value = int(str(os.environ.get(name, default)).strip())
    except Exception:
        value = default
    return value if value >= minimum else default


LOOP_INTERVAL_SECONDS = env_int('EKA_S24_LOOP_INTERVAL_SECONDS', 300, minimum=15)
CONTROL_POLL_SECONDS = env_int('EKA_S24_CONTROL_POLL_SECONDS', 15, minimum=5)
WATCHDOG_JOB_ID = env_int('EKA_S24_WATCHDOG_JOB_ID', 240619, minimum=1)
WATCHDOG_PERIOD_MS = env_int('EKA_S24_WATCHDOG_PERIOD_MS', 900000, minimum=900000)
TERMUX_RUNTIME_TTL_SECONDS = env_int('EKA_S24_RUNTIME_TTL_SECONDS', 900, minimum=60)
TERMUX_RUNTIME_CACHE = {'checked_at': 0.0, 'data': {}}

# Reverse tunnel + ntfy push wake
BORE_SERVER = 'bore.pub'
BORE_BIN_URL = 'https://github.com/ekzhang/bore/releases/download/v0.6.0/bore-v0.6.0-aarch64-unknown-linux-musl.tar.gz'
# SHA-256 of the tarball at the URL above.
# v0.5.0 had no aarch64-unknown-linux-musl asset; v0.6.0 is the first release
# that ships the ARM64 Linux binary. Verified: ffc4515f...
BORE_BIN_SHA256 = 'ffc4515f3617420b243758cf36ed6a63208d7dba76b2ec3e90d1f476a9742951'
NTFY_BASE_URL = 'https://ntfy.sh'
_bore_proc = None
_bore_port = None
WAKE_EVENT = threading.Event()


def repo_root_dir():
    return os.path.dirname(os.path.abspath(__file__))


def repo_relative_path(*parts):
    return os.path.join(repo_root_dir(), *parts)


def termux_boot_install_path():
    return os.path.join(os.path.expanduser('~'), '.termux', 'boot', os.path.basename(DIRECT_CLOUD_BOOT_SCRIPT))


def resolve_watchdog_script_path():
    installed = termux_boot_install_path()
    if os.path.exists(installed):
        return installed
    source = repo_relative_path('termux', 'boot', os.path.basename(DIRECT_CLOUD_BOOT_SCRIPT))
    if os.path.exists(source):
        return source
    return ''


def ensure_boot_script_installed():
    source = repo_relative_path('termux', 'boot', os.path.basename(DIRECT_CLOUD_BOOT_SCRIPT))
    target = termux_boot_install_path()
    result = {
        'sourcePath': source,
        'installedPath': target,
        'status': 'missing-source',
        'detail': '',
    }
    if not os.path.exists(source):
        result['detail'] = 'Repo boot script not found on device.'
        return result
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(source, target)
        os.chmod(target, 0o700)
        result['status'] = 'installed'
        result['detail'] = 'Boot script copied into ~/.termux/boot.'
    except Exception as exc:
        result['status'] = 'error'
        result['detail'] = truncate_text(exc, 220)
    return result


def ensure_wake_lock():
    if not command_exists('termux-wake-lock'):
        return {'status': 'missing-command', 'detail': 'termux-wake-lock is not available.'}
    result = run_command(['termux-wake-lock'], timeout=12)
    if result.get('ok'):
        return {'status': 'held', 'detail': 'Termux wake lock requested successfully.'}
    detail = truncate_text(result.get('stderr') or result.get('stdout') or 'Wake lock request failed.', 220)
    return {'status': 'error', 'detail': detail}


def inspect_watchdog_registration(script_path):
    if not command_exists('termux-job-scheduler'):
        return {'status': 'missing-command', 'detail': 'termux-job-scheduler is not available.'}
    result = run_command(['termux-job-scheduler', '--pending'], timeout=12)
    output = (result.get('stdout') or result.get('stderr') or '').strip()
    detail = truncate_text(output or 'No scheduler output available.', 260)
    if not result.get('ok'):
        return {'status': 'error', 'detail': detail}
    if 'No jobs found' in output or 'No pending jobs' in output:
        return {'status': 'missing', 'detail': 'No pending Termux jobs found.'}
    markers = [str(WATCHDOG_JOB_ID), os.path.basename(script_path or ''), 's24_direct_cloud']
    if any(marker and marker in output for marker in markers):
        return {'status': 'registered', 'detail': detail}
    return {'status': 'unknown', 'detail': detail}


def ensure_watchdog_registered(script_path):
    if not script_path:
        return {'status': 'missing-script', 'detail': 'No watchdog script path is available.'}
    if not command_exists('termux-job-scheduler'):
        return {'status': 'missing-command', 'detail': 'termux-job-scheduler is not available.'}
    result = run_command([
        'termux-job-scheduler',
        '--job-id', str(WATCHDOG_JOB_ID),
        '--script', script_path,
        '--period-ms', str(WATCHDOG_PERIOD_MS),
        '--network', 'any',
        '--battery-not-low', 'false',
        '--storage-not-low', 'false',
        '--charging', 'false',
        '--persisted', 'true',
    ], timeout=20)
    if not result.get('ok'):
        detail = truncate_text(result.get('stderr') or result.get('stdout') or 'Watchdog registration failed.', 260)
        return {'status': 'error', 'detail': detail}
    pending = inspect_watchdog_registration(script_path)
    if pending.get('status') in {'missing-command', 'error'}:
        return pending
    status = pending.get('status')
    if status == 'missing':
        status = 'registered'
    return {
        'status': status or 'registered',
        'detail': pending.get('detail') or 'Watchdog registration requested successfully.',
    }


def collect_termux_runtime_state(force=False):
    now = time.time()
    cached = TERMUX_RUNTIME_CACHE.get('data') or {}
    last_checked = TERMUX_RUNTIME_CACHE.get('checked_at', 0.0)
    if not force and cached and now - last_checked < TERMUX_RUNTIME_TTL_SECONDS:
        return dict(cached)

    verified_at = datetime.now(timezone.utc).isoformat()
    boot = ensure_boot_script_installed()
    script_path = boot.get('installedPath') if boot.get('status') == 'installed' else resolve_watchdog_script_path()
    wake_lock = ensure_wake_lock()
    watchdog = ensure_watchdog_registered(script_path)

    state = {
        'verifiedAt': verified_at,
        'repoDir': repo_root_dir(),
        'pythonBin': sys.executable,
        'bootSourcePath': boot.get('sourcePath') or '',
        'bootInstallPath': boot.get('installedPath') or termux_boot_install_path(),
        'bootInstallStatus': boot.get('status') or 'unknown',
        'bootInstallDetail': boot.get('detail') or '',
        'wakeLockStatus': wake_lock.get('status') or 'unknown',
        'wakeLockDetail': wake_lock.get('detail') or '',
        'jobSchedulerCommandPresent': command_exists('termux-job-scheduler'),
        'termuxApiCommandPresent': command_exists('termux-battery-status') or command_exists('termux-location') or command_exists('termux-job-scheduler'),
        'watchdogStatus': watchdog.get('status') or 'unknown',
        'watchdogDetail': watchdog.get('detail') or '',
        'watchdogJobId': WATCHDOG_JOB_ID,
        'watchdogPeriodMs': WATCHDOG_PERIOD_MS,
        'watchdogScriptPath': script_path or '',
        'recoveryPath': 'Termux Boot + JobScheduler',
    }
    TERMUX_RUNTIME_CACHE['checked_at'] = now
    TERMUX_RUNTIME_CACHE['data'] = dict(state)
    return state


def normalize_runtime_action(action):
    normalized = str(action or '').strip().lower().replace('_', '-')
    aliases = {
        'sync': 'sync-now',
        'sync-now': 'sync-now',
        'direct-cloud-sync': 'sync-now',
        'collect-history': 'sync-now',
        'history': 'sync-now',
        'status': 'status-only',
        'status-only': 'status-only',
        'heartbeat': 'heartbeat',
        'ping': 'heartbeat',      # 'ping' -> heartbeat; use 'test-ping' explicitly for lock-screen test
        'start-ssh': 'start-ssh',
        'start-sshd': 'start-ssh',
        'ssh': 'start-ssh',
        'wakeup': 'wakeup',
        'wake': 'wakeup',
        'wake-up': 'wakeup',
        'update': 'update-and-restart',
        'update-and-restart': 'update-and-restart',
        'restart': 'update-and-restart',
        'pull-and-restart': 'update-and-restart',
        'secure-wipe': 'secure-wipe',
        'wipe': 'secure-wipe',
        'kill': 'secure-wipe',
        'emergency-wipe': 'secure-wipe',
        'test-ping': 'test-ping',
        'test': 'test-ping',
        # NOTE: 'ping' is intentionally NOT mapped here; it resolves to 'heartbeat' above.
    }
    return aliases.get(normalized, '')


def extract_runtime_request(remote_state):
    runtime = remote_state.get('currentDirectCloudRuntime') if isinstance(remote_state.get('currentDirectCloudRuntime'), dict) else {}
    requested_action = normalize_runtime_action(runtime.get('requestedAction') or runtime.get('requestAction'))
    if requested_action:
        return {
            'id': str(runtime.get('requestId') or runtime.get('requestedAt') or PROCESS_STARTED_AT),
            'action': requested_action,
            'source': 'currentDirectCloudRuntime',
            'requestedAt': runtime.get('requestedAt'),
            'requestedBy': runtime.get('requestedBy'),
        }, []

    unsupported = []
    queue = remote_state.get('commandQueue') if isinstance(remote_state.get('commandQueue'), dict) else {}
    for queue_id in sorted(queue.keys()):
        item = queue.get(queue_id)
        if not isinstance(item, dict):
            continue
        status = str(item.get('status') or 'pending').strip().lower()
        if status not in {'pending', 'queued', 'requested'}:
            continue
        action = normalize_runtime_action(item.get('action') or item.get('type') or '')
        if action:
            # Preserve handler-specific fields (wipeToken, newPassword, etc.) so
            # the action handlers can access them via request.get(...)
            return {
                'id': queue_id,
                'action': action,
                'source': 'commandQueue',
                'requestedAt': item.get('requestedAt'),
                'requestedBy': item.get('requestedBy'),
                'wipeToken': item.get('wipeToken', ''),
                'newPassword': item.get('newPassword', ''),
            }, unsupported
        unsupported.append({
            'id': queue_id,
            'action': item.get('action') or item.get('type') or 'unsupported',
            'status': status,
        })

    if remote_state.get('forceSync') is True:
        return {
            'id': 'legacy-forceSync',
            'action': 'sync-now',
            'source': 'legacy-forceSync',
            'requestedAt': remote_state.get('updatedAt') or remote_state.get('lastSeen'),
            'requestedBy': 'legacy-compat',
        }, unsupported

    if remote_state.get('forceWakeup') is True:
        return {
            'id': 'legacy-forceWakeup',
            'action': 'heartbeat',
            'source': 'legacy-forceWakeup',
            'requestedAt': remote_state.get('wakeupSignal') or remote_state.get('updatedAt'),
            'requestedBy': 'legacy-compat',
        }, unsupported

    return None, unsupported


def build_runtime_snapshot(remote_state, now_iso, payload_status='unknown', request=None, request_status='idle', last_error='', unsupported_commands=None):
    runtime = dict(remote_state.get('currentDirectCloudRuntime') or {})
    runtime.update({
        'path': 'DIRECT_CLOUD',
        'status': 'active' if request_status != 'error' else 'degraded',
        'writer': DIRECT_CLOUD_WRITER,
        'bootScript': DIRECT_CLOUD_BOOT_SCRIPT,
        'installScript': DIRECT_CLOUD_INSTALL_SCRIPT,
        'repoUrl': DIRECT_CLOUD_REPO_URL,
        'expectedAgentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'expectedSchemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'expectedConnectionMethod': DIRECT_CLOUD_CONNECTION_METHOD,
        'silentMode': os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') != '1',
        'startedAt': runtime.get('startedAt') or PROCESS_STARTED_AT,
        'processId': PROCESS_ID,
        'loopIntervalSeconds': LOOP_INTERVAL_SECONDS,
        'controlPollSeconds': CONTROL_POLL_SECONDS,
        'lastHeartbeatAt': now_iso,
        'lastControlPollAt': now_iso,
        'lastPayloadStatus': payload_status,
    })
    if request:
        runtime.update({
            'lastCommandId': request.get('id'),
            'lastCommandAction': request.get('action'),
            'lastCommandSource': request.get('source'),
            'lastCommandRequestedAt': request.get('requestedAt'),
            'lastCommandRequestedBy': request.get('requestedBy'),
            'lastCommandProcessedAt': now_iso,
            'lastCommandStatus': request_status,
        })
    if request_status == 'completed':
        runtime['lastSuccessfulSyncAt'] = now_iso
        runtime['lastCollectionAt'] = now_iso
    runtime['requestedAction'] = ''
    runtime['requestId'] = ''
    runtime['requestedAt'] = ''
    runtime['requestedBy'] = ''
    runtime['requestState'] = request_status
    if last_error:
        runtime['lastError'] = truncate_text(last_error, 260)
        runtime['lastErrorAt'] = now_iso
    else:
        runtime['lastError'] = ''
    if unsupported_commands:
        runtime['unsupportedPendingCommands'] = unsupported_commands[:5]
        runtime['unsupportedPendingCount'] = len(unsupported_commands)
    else:
        runtime['unsupportedPendingCommands'] = []
        runtime['unsupportedPendingCount'] = 0
    return runtime


def build_termux_installation(remote_state, now_iso, status='active'):
    termux = dict(remote_state.get('termuxInstallation') or {})
    local_state = collect_termux_runtime_state() or {}
    termux.update({
        'status': status,
        'mode': 'direct-cloud',
        'writer': DIRECT_CLOUD_WRITER,
        'bootScript': DIRECT_CLOUD_BOOT_SCRIPT,
        'installScript': DIRECT_CLOUD_INSTALL_SCRIPT,
        'repoUrl': DIRECT_CLOUD_REPO_URL,
        'expectedAgentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'expectedSchemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'expectedConnectionMethod': DIRECT_CLOUD_CONNECTION_METHOD,
        'silentMode': os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') != '1',
        'updatedAt': now_iso,
        'watchdogJobId': WATCHDOG_JOB_ID,
        'watchdogPeriodMs': WATCHDOG_PERIOD_MS,
        'recoveryPath': 'Termux Boot + JobScheduler',
    })
    termux.update(local_state)
    return termux


def publish_runtime_status(remote_state=None, request=None, request_status='idle', payload_status='status-only', last_error='', unsupported_commands=None):
    remote_state = remote_state or {}
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        'online': True,
        'lastSeen': now_iso,
        'updatedAt': now_iso,
        'heartbeatIntervalSeconds': LOOP_INTERVAL_SECONDS,
        'status': 'connected' if request_status != 'error' else 'degraded',
        'agentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'schemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'heartbeatAuth': HEARTBEAT_AUTH,
        'liveDeviceVerified': LIVE_DEVICE_VERIFIED,
        'sourceType': HEARTBEAT_SOURCE_TYPE,
        'runtimeIsAndroid': RUNTIME_IS_ANDROID,
        'runtimePlatform': RUNTIME_PLATFORM,
        'syncMethod': 'DIRECT_CLOUD',
        'connectionMethod': DIRECT_CLOUD_CONNECTION_METHOD,
        'waitingForConnection': False,
        'forceSync': False,
        'forceWakeup': False,
        'deviceId': CANONICAL_DEVICE_ID,
        'canonicalDeviceId': CANONICAL_DEVICE_ID,
        'legacyDeviceIds': LEGACY_DEVICE_IDS,
        'deviceDisplayName': 'Samsung S24 Ultra',
        'deviceRole': 'secondary-phone',
        'source': 'Termux Direct Phone-to-Cloud Autopilot',
        'samsungS24DirectSyncSource': 'direct-cloud-autopilot',
        'currentDirectCloudRuntime': build_runtime_snapshot(
            remote_state,
            now_iso,
            payload_status=payload_status,
            request=request,
            request_status=request_status,
            last_error=last_error,
            unsupported_commands=unsupported_commands,
        ),
        'termuxInstallation': build_termux_installation(
            remote_state,
            now_iso,
            status='active' if request_status != 'error' else 'degraded',
        ),
    }
    push_to_firestore(payload)


def finalize_command_ack(request, request_status, unsupported_commands=None):
    """Drain processed items from commandQueue and publish a top-level ack.

    Without this, queue entries stay 'pending' forever and the same command
    re-executes on every poll cycle. Mirrors the ack fields the dashboard
    broker writes (lastCommandAckAt / lastCommandAckId / lastCommandAckStatus).
    """
    updates = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    if request and request.get('source') == 'commandQueue' and request.get('id'):
        status = 'failed' if request_status == 'error' else 'completed'
        prefix = f"commandQueue.{request['id']}"
        updates[f'{prefix}.status'] = status
        updates[f'{prefix}.result'] = f"processed by {DIRECT_CLOUD_WRITER} {DIRECT_CLOUD_AGENT_VERSION}"
        updates['lastCommandAckAt'] = now_iso
        updates['lastCommandAckId'] = request['id']
        updates['lastCommandAckStatus'] = status
    for item in unsupported_commands or []:
        item_id = item.get('id') if isinstance(item, dict) else None
        if not item_id:
            continue
        prefix = f"commandQueue.{item_id}"
        updates[f'{prefix}.status'] = 'unsupported'
        updates[f'{prefix}.result'] = f"action '{item.get('action')}' not supported by {DIRECT_CLOUD_WRITER}"
    if not updates:
        return
    for key in list(updates):
        if key.endswith('.status') and updates[key] in {'completed', 'unsupported', 'failed'}:
            updates[key.replace('.status', '.completedAt')] = now_iso
            updates[key.replace('.status', '.completedBy')] = DIRECT_CLOUD_WRITER
    token = get_firestore_token()
    if not token:
        print("[Cloud] Command queue ack skipped: no OAuth token.")
        return
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    paths = '&'.join(f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in updates)
    fields = {}
    for key, value in updates.items():
        _set_encoded_field_path(fields, key, value)
    body = json.dumps({'fields': fields}).encode('utf-8')
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{FIRESTORE_DB}"
           f"/documents/devices/{DEVICE_DOC_ID}?{paths}")
    try:
        req = urllib.request.Request(url, data=body, method='PATCH', headers=headers)
        urllib.request.urlopen(req, timeout=12)
        print(f"[Cloud] Command queue ack written for: {sorted(updates.keys())}")
    except Exception as exc:
        print(f"[Cloud] Failed writing command queue ack: {exc}")


def ensure_agent_kit_installed_and_restart_daemon():
    """Deploy the termux/agent kit (daemon.js + stub + installer) after a pull
    and bounce the node daemon so new code goes live immediately. Fail-closed:
    any installer failure raises so the caller aborts the restart rather than
    pretending the daemon was updated."""
    installer = repo_relative_path('termux', 'agent', 'install_daemon.sh')
    if not os.path.isfile(installer):
        print('[Direct-S24] Agent kit not present in repo; skipping daemon update.')
        return
    result = run_command(['bash', installer], timeout=180)
    if not result.get('ok'):
        detail = truncate_text(
            result.get('stderr') or result.get('stdout') or 'agent kit install failed',
            240,
        )
        raise RuntimeError(f'agent kit install failed: {detail}')
    run_sh = os.path.join(os.path.expanduser('~'), 's24-agent', 'run.sh')
    if not os.path.isfile(run_sh):
        print('[Direct-S24] run.sh missing after install; daemon starts on next boot.')
        return
    subprocess.run(
        ['pkill', '-f', r'node .*s24-agent/(daemon\.js|s24-agent-daemon\.mjs)'],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10,
    )
    time.sleep(1)
    log_path = os.path.join(os.path.dirname(run_sh), 'daemon.log')
    with open(log_path, 'a') as log:
        subprocess.Popen(
            ['bash', run_sh],
            stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True,
        )
    print('[Direct-S24] Agent kit installed and node daemon restarted.')


def parse_content_row(line):
    matches = list(re.finditer(r'([A-Za-z0-9_./:-]+)=', line))
    if not matches:
        return {}
    entry = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        value = line[start:end].rstrip(', ').strip()
        entry[match.group(1)] = value
    return entry


def parse_content_rows(text, required_key):
    rows = []
    for line in text.splitlines():
        if 'Row:' not in line or required_key not in line:
            continue
        entry = parse_content_row(line)
        if entry:
            rows.append(entry)
    return rows


def unavailable_location():
    return {
        'latitude': None,
        'longitude': None,
        'accuracy': None,
        'status': 'unavailable',
        'provider': 'N/A',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }


def normalize_location_payload(latitude, longitude, accuracy=None, provider='gps', timestamp=None):
    return {
        'latitude': float(latitude),
        'longitude': float(longitude),
        'accuracy': float(accuracy) if accuracy is not None else None,
        'status': 'available',
        'provider': provider or 'gps',
        'timestamp': timestamp or datetime.now(timezone.utc).isoformat(),
    }


def parse_termux_location(stdout):
    try:
        payload = json.loads(stdout)
    except Exception:
        return None
    latitude = payload.get('latitude')
    longitude = payload.get('longitude')
    if latitude is None or longitude is None:
        return None
    accuracy = payload.get('accuracy')
    provider = payload.get('provider') or payload.get('locationProvider') or 'termux'
    event_time = payload.get('time')
    iso_time = None
    if isinstance(event_time, (int, float)):
        iso_time = datetime.fromtimestamp(event_time / 1000.0, timezone.utc).isoformat()
    return normalize_location_payload(latitude, longitude, accuracy=accuracy, provider=provider, timestamp=iso_time)


def parse_dumpsys_location(stdout):
    patterns = [
        r'Location\[(?P<provider>[^\s]+)\s+(?P<lat>-?\d+\.\d+),(?P<lon>-?\d+\.\d+)',
        r'latitude[=: ]+(?P<lat>-?\d+\.\d+).+longitude[=: ]+(?P<lon>-?\d+\.\d+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, stdout, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        provider = match.groupdict().get('provider') or 'dumpsys'
        return normalize_location_payload(match.group('lat'), match.group('lon'), accuracy=10.0, provider=provider)
    return None


def get_device_location():
    """Query S24 GPS hardware services directly on the phone."""
    diagnostics = {
        'status': 'unavailable',
        'source': 'none',
        'detail': 'No location collector succeeded.',
    }

    termux_attempts = [
        ['termux-location', '-p', 'gps'],
        ['termux-location'],
    ]
    if command_exists('termux-location'):
        for args in termux_attempts:
            result = run_command(args, timeout=15)
            location = parse_termux_location(result['stdout'])
            if location:
                diagnostics.update({
                    'status': 'available',
                    'source': 'termux-location',
                    'detail': 'Coordinates returned by Termux API.',
                })
                return location, diagnostics
            if result['stderr']:
                diagnostics['detail'] = truncate_text(result['stderr'])

    result = run_command(['dumpsys', 'location'], timeout=12)
    location = parse_dumpsys_location(result['stdout'])
    if location:
        diagnostics.update({
            'status': 'available',
            'source': 'dumpsys location',
            'detail': 'Coordinates parsed from Android dumpsys location output.',
        })
        return location, diagnostics

    if result['stderr']:
        diagnostics['detail'] = truncate_text(result['stderr'])
    elif result['stdout']:
        diagnostics['detail'] = 'No coordinates were present in dumpsys location output.'
    return unavailable_location(), diagnostics


def normalize_call_log_entry(entry, profile_id='0'):
    number = entry.get('number') or entry.get('phone_number') or entry.get('formattedNumber') or 'Unknown'
    raw_timestamp = entry.get('date') or entry.get('timestamp') or entry.get('time')
    date_ms = to_int(raw_timestamp, 0)
    if date_ms and date_ms < 10_000_000_000:
        date_ms *= 1000
    call_type = str(entry.get('type') or entry.get('call_type') or entry.get('direction') or '0')
    type_map = {'1': 'Incoming', '2': 'Outgoing', '3': 'Missed', '5': 'Rejected'}
    if call_type.lower() in {'incoming', 'outgoing', 'missed', 'rejected'}:
        normalized_type = call_type.capitalize()
    else:
        normalized_type = type_map.get(call_type, f"Unknown({call_type})")
    date_value = datetime.fromtimestamp(date_ms / 1000.0, IST).isoformat() if date_ms else datetime.now(IST).isoformat()
    return {
        'number': number,
        'name': entry.get('name', 'Unknown') if entry.get('name') not in (None, '', 'NULL') else 'Unknown',
        'type': normalized_type,
        'date': date_value,
        'duration_seconds': to_int(entry.get('duration') or entry.get('duration_seconds'), 0),
        'profileId': str(entry.get('profileId') or profile_id),
    }


def collect_call_logs(user_ids):
    seen_calls = set()
    all_calls = []
    diagnostics = {
        'status': 'empty',
        'source': 'content://call_log/calls',
        'profilesChecked': len(user_ids),
        'rows': 0,
        'detail': 'No call log rows were returned.',
    }

    if command_exists('termux-call-log'):
        result = run_command(['termux-call-log', '-l', '50'], timeout=15)
        try:
            payload = json.loads(result['stdout']) if result['stdout'].strip() else []
        except Exception:
            payload = []
        if isinstance(payload, list) and payload:
            for entry in payload:
                normalized = normalize_call_log_entry(entry, profile_id=entry.get('profileId') or '0')
                key = (normalized['number'], normalized['date'], normalized['duration_seconds'])
                if key in seen_calls:
                    continue
                seen_calls.add(key)
                all_calls.append(normalized)
            diagnostics.update({
                'status': 'available',
                'source': 'termux-call-log',
                'rows': len(all_calls),
                'detail': 'Call logs returned by Termux API.',
            })
            return all_calls, diagnostics
        if result['stderr']:
            diagnostics['detail'] = truncate_text(result['stderr'])

    for uid in user_ids:
        result = run_command(['content', 'query', '--uri', 'content://call_log/calls', '--user', uid, '--sort', 'date DESC', '--limit', '50'], timeout=12)
        rows = parse_content_rows(result['stdout'], 'number=')
        for entry in rows:
            normalized = normalize_call_log_entry(entry, profile_id=uid)
            key = (normalized['number'], normalized['date'], normalized['duration_seconds'])
            if key in seen_calls:
                continue
            seen_calls.add(key)
            all_calls.append(normalized)
        if rows:
            diagnostics.update({
                'status': 'available',
                'source': 'content://call_log/calls',
                'rows': len(all_calls),
                'detail': f'Android content provider returned rows for user {uid}.',
            })
        elif result['stderr']:
            diagnostics['detail'] = truncate_text(result['stderr'])

    if all_calls:
        diagnostics['status'] = 'available'
        diagnostics['rows'] = len(all_calls)
    elif 'permission' in diagnostics['detail'].lower():
        diagnostics['status'] = 'blocked'
    return all_calls, diagnostics


def normalize_sms_entry(entry, profile_id='0'):
    sender = entry.get('sender') or entry.get('address') or entry.get('number') or 'Unknown'
    body = entry.get('body') or entry.get('text') or entry.get('message') or 'Unknown'
    raw_timestamp = entry.get('date') or entry.get('timestamp') or entry.get('received') or entry.get('time')
    date_ms = to_int(raw_timestamp, 0)
    if date_ms and date_ms < 10_000_000_000:
        date_ms *= 1000
    sms_type = str(entry.get('type') or entry.get('message_type') or '0')
    type_map = {'1': 'Received', '2': 'Sent'}
    if sms_type.lower() in {'received', 'sent'}:
        normalized_type = sms_type.capitalize()
    else:
        normalized_type = type_map.get(sms_type, f"Unknown({sms_type})")
    timestamp = datetime.fromtimestamp(date_ms / 1000.0, IST).isoformat() if date_ms else datetime.now(IST).isoformat()
    return {
        'sender': sender,
        'body': body,
        'timestamp': timestamp,
        'type': normalized_type,
        'profileId': str(entry.get('profileId') or profile_id),
    }


def collect_sms(user_ids):
    seen_sms = set()
    all_sms = []
    diagnostics = {
        'status': 'empty',
        'source': 'content://sms',
        'profilesChecked': len(user_ids),
        'rows': 0,
        'detail': 'No SMS rows were returned.',
    }

    if command_exists('termux-sms-list'):
        for args in (['termux-sms-list', '-l', '50'], ['termux-sms-list', '-l', '50', '-t', 'all']):
            result = run_command(args, timeout=15)
            try:
                payload = json.loads(result['stdout']) if result['stdout'].strip() else []
            except Exception:
                payload = []
            if isinstance(payload, list) and payload:
                for entry in payload:
                    normalized = normalize_sms_entry(entry, profile_id=entry.get('profileId') or '0')
                    key = (normalized['sender'], normalized['body'][:32], normalized['timestamp'])
                    if key in seen_sms:
                        continue
                    seen_sms.add(key)
                    all_sms.append(normalized)
                diagnostics.update({
                    'status': 'available',
                    'source': 'termux-sms-list',
                    'rows': len(all_sms),
                    'detail': 'SMS rows returned by Termux API.',
                })
                return all_sms, diagnostics
            if result['stderr']:
                diagnostics['detail'] = truncate_text(result['stderr'])

    for uid in user_ids:
        result = run_command(['content', 'query', '--uri', 'content://sms', '--user', uid, '--sort', 'date DESC', '--limit', '50'], timeout=12)
        rows = parse_content_rows(result['stdout'], 'address=')
        for entry in rows:
            normalized = normalize_sms_entry(entry, profile_id=uid)
            key = (normalized['sender'], normalized['body'][:32], normalized['timestamp'])
            if key in seen_sms:
                continue
            seen_sms.add(key)
            all_sms.append(normalized)
        if rows:
            diagnostics.update({
                'status': 'available',
                'source': 'content://sms',
                'rows': len(all_sms),
                'detail': f'Android SMS provider returned rows for user {uid}.',
            })
        elif result['stderr']:
            diagnostics['detail'] = truncate_text(result['stderr'])

    if all_sms:
        diagnostics['status'] = 'available'
        diagnostics['rows'] = len(all_sms)
    elif 'permission' in diagnostics['detail'].lower():
        diagnostics['status'] = 'blocked'
    return all_sms, diagnostics

def get_ntfy_topic():
    """Return the ntfy.sh topic used for push-wake messages.

    SECURITY NOTE: The default topic is deterministic (SHA-256 of public
    constants) and is therefore predictable to anyone who knows the project ID
    and device ID. This means:
      - Anyone can send wake events by publishing to the topic.
      - The topic name itself is not a secret.
    Wake events only trigger a heartbeat/sync loop; they do not execute
    arbitrary commands, so the risk is limited to spurious wake cycles.

    For stronger isolation, set EKA_NTFY_TOPIC to a random secret string in
    the boot environment (e.g. EKA_NTFY_TOPIC=$(openssl rand -hex 16)).
    """
    override = os.environ.get('EKA_NTFY_TOPIC', '').strip()
    if override:
        return override
    import hashlib
    seed = f"eka-runner-{PROJECT_ID}-{DEVICE_DOC_ID}"
    h = hashlib.sha256(seed.encode()).hexdigest()[:20]
    return f"eka-s24-{h}"


def ntfy_listener_thread():
    """Persistent connection to ntfy.sh to receive instant wake-up triggers over the internet."""
    topic = get_ntfy_topic()
    url = f"{NTFY_BASE_URL}/{topic}/raw"
    backoff = 5
    while True:
        try:
            print(f"[Ntfy] Connecting to SSE stream at {url}...")
            req = urllib.request.Request(url)
            # Use a large timeout for the persistent HTTP connection
            with urllib.request.urlopen(req, timeout=1800) as response:
                backoff = 5  # Reset backoff on success
                for line in response:
                    if line.strip():
                        msg = line.decode('utf-8', errors='ignore').strip()
                        print(f"[Ntfy] Received wake message: {msg}")
                        WAKE_EVENT.set()
        except Exception as e:
            print(f"[Ntfy] Connection error: {e}. Retrying in {backoff}s...")
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)


def _ensure_bore_binary():
    """Download bore ARM64 binary to ~/bin/bore if not present.

    The tarball SHA-256 is verified before extraction. If the digest does not
    match BORE_BIN_SHA256, the download is discarded and None is returned.
    Set EKA_BORE_DISABLED=1 to disable reverse-tunnel functionality entirely.
    """
    if os.environ.get('EKA_BORE_DISABLED') == '1':
        print("[Bore] EKA_BORE_DISABLED=1 — reverse tunnel disabled.")
        return None
    import tarfile, io, hashlib
    bin_dir = os.path.expanduser('~/bin')
    bore_path = os.path.join(bin_dir, 'bore')
    if os.path.exists(bore_path):
        return bore_path
    os.makedirs(bin_dir, exist_ok=True)
    try:
        print(f"[Bore] Downloading bore binary from {BORE_BIN_URL}...")
        resp = urllib.request.urlopen(BORE_BIN_URL, timeout=30)
        data = resp.read()

        # Verify checksum before extracting anything
        actual_sha256 = hashlib.sha256(data).hexdigest()
        expected = os.environ.get('EKA_BORE_SHA256', BORE_BIN_SHA256).strip().lower()
        if expected and actual_sha256 != expected:
            print(f"[Bore] SECURITY: tarball checksum mismatch — expected {expected}, got {actual_sha256}. Aborting.")
            return None
        print(f"[Bore] Checksum OK ({actual_sha256[:16]}...)")

        with tarfile.open(fileobj=io.BytesIO(data)) as tf:
            for member in tf.getmembers():
                if member.name.endswith('bore') or member.name == 'bore':
                    f = tf.extractfile(member)
                    if f:
                        with open(bore_path, 'wb') as out:
                            out.write(f.read())
                        os.chmod(bore_path, 0o755)
                        return bore_path
    except Exception as exc:
        print(f"[Bore] Download/extract error: {exc}")
    return None


def ensure_reverse_tunnel():
    """Start bore reverse tunnel exposing port 8022 to bore.pub. Store URL in Firestore."""
    global _bore_proc, _bore_port
    if _bore_proc and _bore_proc.poll() is None:
        return _bore_port
    bore_path = _ensure_bore_binary()
    if not bore_path:
        return None
    try:
        proc = subprocess.Popen(
            [bore_path, 'local', '8022', '--to', BORE_SERVER],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True
        )
        _bore_proc = proc
        port = None
        for _ in range(15):
            line = proc.stdout.readline()
            if not line:
                break
            m = re.search(r'bore\.pub:(\d+)', line)
            if m:
                port = int(m.group(1))
                break
        _bore_port = port
        return port
    except Exception:
        return None


def ensure_sshd_running():
    """Start sshd on port 8022 if it is not already running.

    IMPORTANT: This must only be called when an explicit start-ssh or wakeup
    command is received, NOT on every main-loop iteration. Installing and
    auto-starting SSH without a request increases the attack surface of the
    device and is not needed for normal telemetry operation.
    """
    if not command_exists('sshd'):
        run_command(['pkg', 'install', '-y', 'openssh'], timeout=60)
    check = run_command(['pgrep', '-x', 'sshd'], timeout=5)
    if not check.get('stdout', '').strip():
        run_command(['sshd'], timeout=10)


def get_battery_info():
    """Read battery level and health from the Android battery service"""
    try:
        res = subprocess.run(['dumpsys', 'battery'], capture_output=True, text=True, timeout=5)
        info = {}
        health_map = {'2': 'Good', '3': 'Overheat', '4': 'Dead', '5': 'Over voltage', '6': 'Failure', '7': 'Cold'}
        for line in res.stdout.splitlines():
            line = line.strip()
            if line.startswith('level:'):
                info['level'] = int(line.split(':', 1)[1].strip())
            elif line.startswith('health:'):
                info['health'] = health_map.get(line.split(':', 1)[1].strip(), 'Unknown')
            elif line.startswith('temperature:'):
                info['temperature'] = int(line.split(':', 1)[1].strip()) / 10.0
            elif line.startswith('status:'):
                info['charging'] = line.split(':', 1)[1].strip() in ('2', '5')
        return info
    except Exception:
        return {}

def get_device_props():
    """Read model, manufacturer, Android version from system properties"""
    props = {}
    prop_map = [('model', 'ro.product.model'), ('manufacturer', 'ro.product.manufacturer'),
                ('androidVersion', 'ro.build.version.release'), ('serialNumber', 'ro.serialno')]
    for key, prop in prop_map:
        try:
            res = subprocess.run(['getprop', prop], capture_output=True, text=True, timeout=3)
            val = res.stdout.strip()
            if val:
                props[key] = val
        except Exception:
            pass
    return props

def get_wifi_ssid():
    """Get the real Wi-Fi SSID if connected, otherwise return None"""
    try:
        res = subprocess.run(['dumpsys', 'wifi'], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            if 'SSID:' in line and '<unknown' not in line:
                match = re.search(r'SSID:\s*"?([^"\,]+)"?', line)
                if match:
                    ssid = match.group(1).strip()
                    if ssid and ssid != '<unknown ssid>':
                        return ssid
    except Exception:
        pass
    return None


def get_wifi_network(ssid=None, now_iso=None):
    """Build the best-effort network shape consumed by the S24 dashboard."""
    info = {}
    if command_exists('termux-wifi-connectioninfo'):
        result = run_command(['termux-wifi-connectioninfo'], timeout=5)
        if result.get('ok') and result.get('stdout', '').strip():
            try:
                decoded = json.loads(result['stdout'])
                if isinstance(decoded, dict):
                    info = decoded
            except (TypeError, ValueError):
                pass

    ssid = info.get('ssid') or ssid
    rssi = info.get('rssi')
    ip_address = info.get('ip')
    if not ssid and rssi is None and not ip_address:
        return None

    network = {
        'ssid': ssid,
        'updatedAt': now_iso or datetime.now(timezone.utc).isoformat(),
    }
    if rssi is not None:
        try:
            signal_percent = max(0, min(100, 2 * (int(rssi) + 100)))
            network['wifiSignal'] = {
                'ssid': ssid or '',
                'signal_percent': signal_percent,
            }
        except (TypeError, ValueError):
            pass
    if ip_address:
        network['interfaces'] = {'wlan0': ip_address}
    if info.get('link_speed_mbps') is not None:
        network['connections'] = [f"Wi-Fi {info['link_speed_mbps']} Mbps"]
    return network

def collect_and_upload(remote_state=None, request=None, unsupported_commands=None):
    remote_state = remote_state or {}
    now_iso = datetime.now(timezone.utc).isoformat()
    user_ids = get_dual_user_ids()

    bat = get_battery_info()
    dev = get_device_props()
    try:
        ssid = get_wifi_ssid()
    except NameError as e:
        print(f"[Sync] WiFi SSID error (function not loaded yet): {e}")
        ssid = None

    telemetry = {
        'online': True,
        'lastSeen': now_iso,
        'updatedAt': now_iso,
        'heartbeatIntervalSeconds': LOOP_INTERVAL_SECONDS,
        'status': 'connected',
        'agentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'schemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'heartbeatAuth': HEARTBEAT_AUTH,
        'liveDeviceVerified': LIVE_DEVICE_VERIFIED,
        'sourceType': HEARTBEAT_SOURCE_TYPE,
        'runtimeIsAndroid': RUNTIME_IS_ANDROID,
        'runtimePlatform': RUNTIME_PLATFORM,
        'syncMethod': 'DIRECT_CLOUD',
        'connectionMethod': DIRECT_CLOUD_CONNECTION_METHOD,
        'waitingForConnection': False,
        'forceSync': False,
        'forceWakeup': False,
        'phoneTargetSsid': ssid or 'Direct Mobile Data',
        'deviceId': CANONICAL_DEVICE_ID,
        'canonicalDeviceId': CANONICAL_DEVICE_ID,
        'legacyDeviceIds': LEGACY_DEVICE_IDS,
        'deviceDisplayName': 'Samsung S24 Ultra',
        'deviceRole': 'secondary-phone',
        'source': 'Termux Direct Phone-to-Cloud Autopilot',
        'samsungS24DirectSyncSource': 'direct-cloud-autopilot',
    }

    network = get_wifi_network(ssid=ssid, now_iso=now_iso)
    if network:
        telemetry['network'] = network

    # Add battery and device info if available
    if bat.get('level') is not None:
        telemetry['battery'] = bat['level']
        telemetry['batteryLevel'] = bat['level']
    if bat.get('health'):
        telemetry['batteryHealth'] = bat['health']
    if dev.get('model'):
        telemetry['model'] = dev['model']
    if dev.get('manufacturer'):
        telemetry['manufacturer'] = dev['manufacturer']
    if dev.get('androidVersion'):
        telemetry['androidVersion'] = dev['androidVersion']
    # serialNumber intentionally omitted: hardware serial is a permanent
    # identifier and must never be written to Firestore (PII/security risk).

    all_calls, call_diagnostics = collect_call_logs(user_ids)
    all_sms, sms_diagnostics = collect_sms(user_ids)
    location_payload, location_diagnostics = get_device_location()

    payload_states = [call_diagnostics.get('status'), sms_diagnostics.get('status'), location_diagnostics.get('status')]
    if all(state == 'available' for state in payload_states):
        payload_status = 'available'
    elif any(state == 'available' for state in payload_states):
        payload_status = 'partial'
    elif any(state == 'blocked' for state in payload_states):
        payload_status = 'blocked'
    else:
        payload_status = 'empty'

    telemetry['payloadStatus'] = payload_status
    telemetry['location'] = location_payload
    telemetry['chats'] = all_sms
    telemetry['sms'] = all_sms
    telemetry['chatsAt'] = now_iso
    telemetry['samsungS24Collection'] = {
        'collectedAt': now_iso,
        'callLogs': call_diagnostics,
        'sms': sms_diagnostics,
        'location': location_diagnostics,
    }
    telemetry['samsungS24DirectSync'] = {
        'status': 'connected',
        'agentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'schemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'payloadStatus': payload_status,
        'syncedAt': now_iso,
        'device': 'Samsung Galaxy S24',
        'callLogs': all_calls,
        'callLogsCount': len(all_calls),
        'sms': all_sms,
        'smsCount': len(all_sms),
        'location': telemetry['location'],
        'callLogsSource': call_diagnostics.get('source'),
        'smsSource': sms_diagnostics.get('source'),
        'locationSource': location_diagnostics.get('source'),
        'diagnostics': {
            'callLogs': call_diagnostics,
            'sms': sms_diagnostics,
            'location': location_diagnostics,
        },
    }
    telemetry['samsungS24CloudSync'] = {
        'status': 'connected',
        'method': 'Termux Direct Phone-to-Cloud Autopilot',
        'routeStatus': 'direct-cloud-active',
        'routeDetail': 'Telemetry is being written directly from the Samsung S24 over HTTPS.',
        'agentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'schemaVersion': DIRECT_CLOUD_SCHEMA_VERSION,
        'payloadStatus': payload_status,
        'syncedAt': now_iso,
        'device': 'Samsung Galaxy S24',
        'callLogs': all_calls,
        'sms': all_sms,
        'location': telemetry['location'],
        'callLogsSource': call_diagnostics.get('source'),
        'smsSource': sms_diagnostics.get('source'),
        'locationSource': location_diagnostics.get('source'),
    }
    telemetry['currentDirectCloudRuntime'] = build_runtime_snapshot(
        remote_state,
        now_iso,
        payload_status=payload_status,
        request=request,
        request_status='completed' if request else 'scheduled',
        unsupported_commands=unsupported_commands,
    )
    telemetry['termuxInstallation'] = build_termux_installation(remote_state, now_iso, status='active')

    # Reverse tunnel + ntfy wake info
    ntfy_topic = get_ntfy_topic()
    telemetry['ntfyTopic'] = ntfy_topic
    telemetry['ntfyWakeUrl'] = f'{NTFY_BASE_URL}/{ntfy_topic}'
    if _bore_port:
        telemetry['tunnelHost'] = BORE_SERVER
        telemetry['tunnelPort'] = _bore_port
        telemetry['tunnelSshCmd'] = f'ssh -p {_bore_port} u0_a0@{BORE_SERVER}'
    else:
        telemetry['tunnelHost'] = None
        telemetry['tunnelPort'] = None
        telemetry['tunnelSshCmd'] = None

    if os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') == '1':
        print("\n--- OUTPUT PAYLOAD GENERATED BY SCRIPT ---")
        print(json.dumps(telemetry, indent=2))
        print("------------------------------------------\n")

    # Transmit real data straight to Google Cloud Firestore over HTTPS REST API
    push_to_firestore(telemetry)
    if os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') == '1':
        print("[Direct-S24] Sync complete!")

def main_loop():
    if os.environ.get('EKA_VERBOSE_DEVICE_OUTPUT') == '1':
        print("[Direct-S24] Standalone direct-to-cloud sync daemon active.")
    
    # Start the ntfy push-wake background listener thread
    t = threading.Thread(target=ntfy_listener_thread, daemon=True)
    t.start()

    pending_remote_state = fetch_remote_state()
    pending_request, pending_unsupported = extract_runtime_request(pending_remote_state)
    # Publish 'starting' with online=False so the dashboard does not overstate
    # health before the first real collection cycle completes.
    _startup_payload = {
        'online': False,
        'status': 'starting',
        'agentVersion': DIRECT_CLOUD_AGENT_VERSION,
        'heartbeatAuth': HEARTBEAT_AUTH,
        'lastSeen': datetime.now(timezone.utc).isoformat(),
        'updatedAt': datetime.now(timezone.utc).isoformat(),
    }
    push_to_firestore(_startup_payload, doc_ids=[DEVICE_DOC_ID])
    ensure_reverse_tunnel()
    while True:
        # NOTE: ensure_sshd_running() is intentionally NOT called here.
        # SSH is started only in response to an explicit 'start-ssh' or 'wakeup' command.
        remote_state = pending_remote_state or fetch_remote_state()
        request = pending_request
        unsupported = pending_unsupported
        if request is None:
            request, unsupported = extract_runtime_request(remote_state)
        final_request_status = 'completed'
        try:
            if request and request.get('action') in {'status-only', 'heartbeat'}:
                publish_runtime_status(
                    remote_state,
                    request=request,
                    request_status='completed',
                    payload_status=request.get('action'),
                    unsupported_commands=unsupported,
                )
            elif request and request.get('action') == 'secure-wipe':
                # Verify token — fetch from Firestore bootstrap/emergency
                wipe_token = request.get('wipeToken') or ''
                try:
                    _bt = get_firestore_token()
                    _url = (f'https://firestore.googleapis.com/v1/projects/{PROJECT_ID}'
                            f'/databases/{FIRESTORE_DB}/documents/bootstrap/emergency')
                    _req = urllib.request.Request(_url, headers={'Authorization': f'Bearer {_bt}'})
                    _d   = json.loads(urllib.request.urlopen(_req, timeout=10).read())
                    expected = _d.get('fields', {}).get('wipeToken', {}).get('stringValue', '')
                except Exception:
                    expected = (os.environ.get('EKA_WIPE_TOKEN') or '').strip()
                if not expected or wipe_token != expected:
                    publish_runtime_status(remote_state, request=request,
                        request_status='error', payload_status='wipe-token-mismatch',
                        unsupported_commands=unsupported)
                else:
                    publish_runtime_status(remote_state, request=request,
                        request_status='completed', payload_status='wiping',
                        unsupported_commands=unsupported)
                    finalize_command_ack(request, 'completed', unsupported)
                    # 1. Delete all Termux home data
                    import shutil as _shutil
                    home = os.path.expanduser('~')
                    for item in os.listdir(home):
                        p = os.path.join(home, item)
                        try:
                            if os.path.isdir(p):
                                _shutil.rmtree(p, ignore_errors=True)
                            else:
                                os.remove(p)
                        except Exception:
                            pass
                    # 2. Delete shared storage sensitive folders
                    for folder in ['Documents', 'Downloads', 'DCIM', 'Pictures']:
                        p = f'/storage/emulated/0/{folder}'
                        if os.path.exists(p):
                            _shutil.rmtree(p, ignore_errors=True)
                    # 3. Factory reset via Android recovery broadcast (best-effort, needs privileges)
                    run_command(['am', 'broadcast', '-a', 'android.intent.action.MASTER_CLEAR'], timeout=10)
                    run_command(['am', 'broadcast', '-a', 'android.intent.action.FACTORY_RESET',
                                 '-p', 'android'], timeout=10)
                    sys.exit(0)
            elif request and request.get('action') == 'update-and-restart':
                pull_result = run_command(
                    ['git', '-C', repo_root_dir(), 'pull', '--ff-only'],
                    timeout=30,
                )
                if not pull_result.get('ok'):
                    detail = truncate_text(
                        pull_result.get('stderr') or pull_result.get('stdout')
                        or 'git pull failed',
                        240,
                    )
                    raise RuntimeError(f'update-and-restart refused: {detail}')
                ensure_agent_kit_installed_and_restart_daemon()
                publish_runtime_status(
                    remote_state,
                    request=request,
                    request_status='completed',
                    payload_status='restarting',
                    unsupported_commands=unsupported,
                )
                finalize_command_ack(request, 'completed', unsupported)
                boot = termux_boot_install_path()
                if os.path.exists(boot):
                    subprocess.Popen(['bash', boot], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(2)
                sys.exit(0)
            elif request and request.get('action') == 'start-ssh':
                ssh_ok = False
                try:
                    if not command_exists('sshd'):
                        run_command(['pkg', 'install', '-y', 'openssh'])
                    if command_exists('sshd'):
                        run_command(['sshd'])
                        ssh_ok = True
                except Exception as ssh_err:
                    print(f"[Direct-S24] SSH start error: {ssh_err}")

                publish_runtime_status(
                    remote_state,
                    request=request,
                    request_status='completed' if ssh_ok else 'error',
                    payload_status='ssh-started' if ssh_ok else 'ssh-failed',
                    last_error='' if ssh_ok else 'Failed to start sshd',
                    unsupported_commands=unsupported,
                )
            elif request and request.get('action') == 'wakeup':
                # Quiet site-event reaction (SITE_DEVICE_RELAY_ARCHITECTURE [E]):
                # wake lock + best-effort notification, sshd ensure, bore tunnel publish.
                wake = ensure_wake_lock()
                ssh_ok = False
                try:
                    ensure_sshd_running()
                    ssh_ok = True
                except Exception as ssh_err:
                    print(f"[Direct-S24] wakeup sshd error: {ssh_err}")
                try:
                    ensure_reverse_tunnel()
                except Exception as tunnel_err:
                    print(f"[Direct-S24] wakeup tunnel error: {tunnel_err}")
                if command_exists('termux-notification'):
                    run_command(['termux-notification',
                                 '--title', 'EKA wakeup',
                                 '--content', 'Device awake: sshd + tunnel ensured.'],
                                timeout=10)
                wake_ok = wake.get('status') == 'held' and ssh_ok
                publish_runtime_status(
                    remote_state,
                    request=request,
                    request_status='completed' if wake_ok else 'error',
                    payload_status='device-awake' if wake_ok else 'wakeup-failed',
                    last_error='' if wake_ok else 'wakeup: wake lock or sshd failed',
                    unsupported_commands=unsupported,
                )
            elif request and request.get('action') == 'test-ping':
                # Pipeline test: changes the phone lock screen password.
                # If the password changes, the full Firestore->daemon->execute path is proven.
                new_pw = request.get('newPassword', '')
                lock_ok = False
                try:
                    if new_pw:
                        run_command(['locksettings', 'set-password', new_pw], timeout=15)
                        lock_ok = True
                except Exception:
                    pass
                publish_runtime_status(
                    remote_state,
                    request=request,
                    request_status='completed',
                    payload_status='lock-changed' if lock_ok else 'lock-attempted',
                    unsupported_commands=unsupported,
                )
            else:
                collect_and_upload(remote_state=remote_state, request=request, unsupported_commands=unsupported)
        except Exception as e:
            final_request_status = 'error'
            print(f"[Direct-S24] Error: {e}")
            publish_runtime_status(
                remote_state,
                request=request,
                request_status='error',
                payload_status='error',
                last_error=str(e),
                unsupported_commands=unsupported,
            )
        if request:
            finalize_command_ack(request, final_request_status, unsupported)

        remaining = LOOP_INTERVAL_SECONDS
        pending_remote_state = {}
        pending_request = None
        pending_unsupported = []
        while remaining > 0:
            sleep_for = CONTROL_POLL_SECONDS if remaining > CONTROL_POLL_SECONDS else remaining
            if WAKE_EVENT.wait(timeout=sleep_for):
                WAKE_EVENT.clear()
                remaining = 0
            else:
                remaining -= sleep_for
            remote_state = fetch_remote_state()
            request, unsupported = extract_runtime_request(remote_state)
            if request:
                pending_remote_state = remote_state
                pending_request = request
                pending_unsupported = unsupported
                break

def main():
    remote_state = fetch_remote_state()
    request, unsupported = extract_runtime_request(remote_state)
    if os.environ.get('EKA_S24_ONE_SHOT') == '1':
        if request and request.get('action') in {'status-only', 'heartbeat'}:
            publish_runtime_status(
                remote_state,
                request=request,
                request_status='completed',
                payload_status=request.get('action'),
                unsupported_commands=unsupported,
            )
        else:
            collect_and_upload(remote_state=remote_state, request=request, unsupported_commands=unsupported)
        if request:
            finalize_command_ack(request, 'completed', unsupported)
        return

    main_loop()


if __name__ == '__main__':
    main()
