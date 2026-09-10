# S24 cloud and relay compatibility audit

## Result

The inspected components do not implement one end-to-end protocol. The phone
workers and relays agree on the canonical Firestore project/database, but the
Global Devices command transport differs from the phone workers. Push-token
registration targets a different database, and the FCM listener expects a third
message format.

## Scope and revisions

- Current GitHub `jaytipargal/eka-runner` main: `71df0d0069997d0083c1d033c9343b44b885595c`.
- Current GitHub `jaytipargal/eka-runner-private` main: `d329d3fc125c675a9864dd7d4664f5fe2238793d`.
- Configured Global Devices relay: `C:/Samsung-S24/global_devices_mcp.py`.
- Configured Codex S24 relay: `C:/Users/abcom/temp_repos_rollback/urgaa-eka-agent-fresh/devices/s24/firestore_mcp.py`.
- That S24 checkout has origin `urgaa-eka/eka-agent`; local HEAD is `e59559841243fade369486712473bf09164f07d0`.
- The repositories' worker and FCM-listener files match the inspected submodule copies after newline normalization. Registration scripts differ in CLI/output handling, but both versions omit the database argument.
- GitHub source snapshots and hashes of the configured relay files are saved beside this report.

## Routing and command comparison

| Component | Database / destination | Command or record format | Result |
| --- | --- | --- | --- |
| Global Devices relay | `eka-agent`, `devices/samsung-s24-ultra/commands/{id}` | `command`, `type: shell` or `ping`, `status: pending` | Different queue and payload from the S24 workers |
| Both phone workers | `eka-agent`, device document's `commandQueue.{id}` | `action`, `status: pending`; public worker also accepts `type` as an action alias | Does not poll the Global Devices `commands` subcollection |
| Configured S24 relay | `eka-agent`, device document's `commandQueue.{id}` | `schemaVersion: s24-command-v2`, `action`, request ID and timestamps | Queue matches; declared lifecycle differs from older workers |
| Both token-registration scripts | `(default)`, `devices/{device_id}` | `fcmToken`, `deviceName`, `updatedAt` | Wrong database for the canonical `eka-agent` record |
| Both FCM listeners | Incoming FCM message's `data` object | `command: run_sync`, `commandId`, optional `script` | Separate push protocol; no command-queue acknowledgement |

The relays and phone worker defaults use project `intrepid-stage-495117-q1` and
device `samsung-s24-ultra`. Registration instead obtains its project from an
external service-account file and does not explicitly validate the canonical
project. Those service-account files are absent in the inspected submodule
roots; their deployed configuration is unverified.

## Concrete findings

1. **Global Devices targets a Windows command consumer.** Its `send_command`
   writes the `command` string into the `commands` subcollection. Its `ping_device`
   builds PowerShell using `Get-CimInstance` and the Windows registry. The S24
   workers inspect the parent document's `commandQueue` map and dispatch named
   actions. They do not read that subcollection.

2. **Token registration uses the default database.** Both remote registration
   scripts call `firestore.client()` without `database_id`. Firebase documents
   that this selects the default database. The code does not read
   `EKA_FIRESTORE_DB`. This is a source-code finding, not proof that a token was
   successfully registered there.

3. **FCM is not wired to the relay's command transport.** The listener responds
   only to `data.command == run_sync`, selects a script, and logs its subprocess
   result. It never claims/completes a Firestore queue item. The configured Global
   Devices relay contains no FCM send call. Its command write will not directly
   trigger this listener. No external deployed trigger was assessed.

4. **Push bootstrap remains incomplete in these sources.** The listener defaults
   to `YOUR_FCM_SENDER_ID`; the boot script registers a token only if
   `termux/fcm_token.txt` already exists. The listener's default
   `trigger_s24_full_export.py` is absent from both current GitHub trees, though
   it also searches phone-local fallback locations that cannot be verified here.
   No actual on-phone token generation/listening was validated.

5. **The private installer selects the public worker repository by default.**
   Both installers default `EKA_REPO_URL` to
   `https://github.com/jaytipargal/eka-runner.git`. Running the installer from
   the private repository does not select the private implementation unless
   deployment configuration changes that target. Both installers also reference
   bootstrap data in `(default)`; no bootstrap endpoint was accessed.

6. **S24 acknowledgement schemas have drifted.** The active S24 contract declares
   `pending -> running -> succeeded/failed` with `startedAt/completedAt`.
   The public worker reports `completed` and `completedAt`; the private worker's
   fallback contract uses `claimed -> completed/failed` with `processedAt/ackAt`.
   Neither current worker repository includes the private worker's default
   runtime-contract file. A phone-local override could change its contract and
   has not been inspected. The active guarded sync script explicitly accepts
   `completed` as well as `succeeded`, so this status-name difference alone is
   not proof of a sync timeout.

7. **The configured S24 MCP is a read-only interface.** Its queue/wakeup/sync tool
   names return policy responses; the separate guarded sync script is the write
   path. The older files recently organized under `jpbir/tools/mcp` are not the
   same source files as the configured Codex S24 relay.

## Live state and practical implication

The user reports that the canonical S24 record has no push token or SSH tunnel
endpoint, that no relevant repository has a registered runner, and that a
connector scope restriction prevented checking the default database. These
reported live-state findings were not independently rechecked in this audit.
Actual registration in `(default)` remains unverified.

A phone-side Firestore polling worker does not require a GitHub Actions runner,
but it must already be installed, running, and authenticated on the phone. A
repository update alone does not establish that execution path. The actual
phone runtime/version and its local overrides remain unverified.

The correction requires one chosen S24 queue contract shared by the phone and
its producer, token registration in the same named database/project, and push
handling that wakes that consumer and preserves its acknowledgement path.
Installing or replacing a worker still requires an established phone access path.

No installer, device command, workflow, token registration, or Firestore mutation
was executed during this comparison. No runtime files or repository configuration
were changed.

## Sources

- [Global Devices queue writer](C:/Samsung-S24/global_devices_mcp.py:518)
- [Phone queue reader](C:/Users/abcom/jpbir/eka-runner/s24_phone_direct_cloud.py:482)
- [Private phone queue reader](C:/Users/abcom/jpbir/eka-runner-private/s24_phone_direct_cloud.py:2901)
- [Latest token-registration snapshot](eka-runner/termux/register_device_token.py)
- [Latest private-installer snapshot](eka-runner-private/termux/install_s24_direct_cloud.sh)
- [Latest FCM-listener snapshot](eka-runner/termux/fcm_listener.py)
- [Firebase client database selection](https://firebase.google.com/docs/reference/admin/python/firebase_admin.firestore)
