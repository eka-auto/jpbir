// The Windows device kits (Devices/Lenovo, Devices/Vivobook) reach the broker and
// survive a slow WMI query.
//
// Found on 2026-09-23 while g4g-lenovo-laptop showed "offline 12 days" on the dashboard
// during a session running on that very laptop. Two defects in the kits, either one
// enough to keep a Windows device dark:
//
// 1. Both kits' devices.json pointed broker_url at https://agent.jaytipargal.tech. That
//    name resolves to a different server (139.84.165.81), which answers 404 on
//    /api/device-heartbeat and /api/device-enroll. The broker is https://jaytipargal.tech
//    (the S24 kit was corrected in cbd3660; test_deploy_kits.py asserts it for S24 only).
//
// 2. collect_hardware_identity() swallowed a WMI timeout and returned no manufacturer or
//    model. The heartbeat went out anyway, the broker answered 403 "hardware mismatch",
//    BrokerClient raises every 403 as BrokerAuthError, and run_broker exits 3 on that.
//    The laptop's log: query timed out 2026-09-06 03:00:32, 403 at 03:00:45, exit; the
//    scheduled task restarts a failed run only three times, a minute apart.
//
// This executes the kit's real device_agent.py under Python (its OS and network
// dependencies stubbed) rather than asserting on its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, runPython } from './python-harness.mjs';

const BROKER = 'https://jaytipargal.tech';
const WINDOWS_KITS = ['Lenovo', 'Vivobook'];

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

t('every Windows kit sends its signed requests to the production broker', () => {
  for (const kit of WINDOWS_KITS) {
    const cfg = JSON.parse(read(`Devices/${kit}/devices.json`));
    assert.equal(cfg.broker_url, BROKER, `Devices/${kit}/devices.json broker_url`);
  }
  assert.match(read('Devices/S24/install_s24.sh'), /"broker_url": "https:\/\/jaytipargal\.tech"/,
    'the S24 installer is the reference and must keep the same broker');
});

t('no kit, installer or runtime contract names the host that answers 404', () => {
  for (const kit of [...WINDOWS_KITS, 'S24']) {
    for (const f of ['devices.json', kit === 'S24' ? 'install_s24.sh' : `install_${kit.toLowerCase()}.ps1`]) {
      let src;
      try { src = read(`Devices/${kit}/${f}`); } catch { continue; }
      assert.doesNotMatch(src, /agent\.jaytipargal\.tech/, `Devices/${kit}/${f} still names agent.jaytipargal.tech`);
    }
  }
});

t('the broker routes the kits call are deployed functions in vercel.json', () => {
  const builds = JSON.parse(read('vercel.json')).builds.map((b) => b.src);
  for (const fn of ['device-enroll', 'device-heartbeat', 'device-commands-poll']) {
    assert.ok(builds.includes(`Backend/${fn}.js`), `vercel.json does not build Backend/${fn}.js`);
  }
});

// Loads the kit agent with its imports stubbed; platform reports Windows and every
// PowerShell call is answered from INPUT.script: "ok" returns a complete reading,
// "timeout" raises TimeoutExpired, as the real query did.
const SETUP = `
import subprocess, types
class _AuthError(Exception):
    pass
class _BrokerError(Exception):
    pass
_stub("psutil")
_stub("signer", make_signer=lambda cfg: object())
_stub("single_instance", GuardHeldError=Exception, acquire_guard=lambda *a: None, release_guard=lambda *a: None)
CALLS = {"heartbeat": [], "poll": 0}
class _Client:
    enrolled = True
    def __init__(self, *a, **k):
        pass
    def heartbeat(self, hardware, telemetry=None):
        CALLS["heartbeat"].append(hardware)
        return {"success": True}
    def poll(self):
        CALLS["poll"] += 1
        return {"commands": []}
_stub("broker_client", BrokerAuthError=_AuthError, BrokerClient=_Client, BrokerError=_BrokerError)
agent = load(INPUT["kit"])
agent.platform = types.SimpleNamespace(system=lambda: "Windows")
SCRIPT = list(INPUT["script"])
def _run(cmd, **kw):
    step = SCRIPT.pop(0) if SCRIPT else "timeout"
    if step == "timeout":
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))
    return types.SimpleNamespace(returncode=0, stdout='{"Manufacturer":"LENOVO","Model":"82KA","UUID":"u-1"}')
agent.subprocess = types.SimpleNamespace(run=_run, TimeoutExpired=subprocess.TimeoutExpired,
                                         SubprocessError=subprocess.SubprocessError)
`;

const identityRun = (kit, script, body) => runPython(`${SETUP}\n${body}`, { kit: `Devices/${kit}/device_agent.py`, script });

for (const kit of WINDOWS_KITS) {
  t(`${kit}: a WMI timeout after one good reading reuses it instead of sending no manufacturer`, () => {
    const out = identityRun(kit, ['ok', 'timeout', 'timeout'], `
first = agent.collect_hardware_identity()
second = agent.collect_hardware_identity()
print(json.dumps({"first": first, "second": second}))`);
    assert.equal(out.first.manufacturer, 'LENOVO');
    assert.equal(out.second.manufacturer, 'LENOVO', 'the second reading dropped the manufacturer');
    assert.equal(out.second.model, '82KA');
    assert.equal(out.second.serialHash, out.first.serialHash, 'the enrolled serialHash must not change');
  });

  t(`${kit}: one slow first query is retried before anything is given up`, () => {
    const out = identityRun(kit, ['timeout', 'ok'], `
print(json.dumps(agent.collect_hardware_identity()))`);
    assert.equal(out.manufacturer, 'LENOVO');
  });

  t(`${kit}: with no reading at all the daemon skips the heartbeat and keeps running`, () => {
    // time.sleep ends the loop after one round; before the fix this round sent a
    // heartbeat with no manufacturer, which the broker answers with the 403 that exits 3.
    const out = identityRun(kit, ['timeout', 'timeout'], `
class _Stop(Exception):
    pass
def _sleep(s):
    raise _Stop()
agent.time.sleep = _sleep
cfg = {"broker_url": "https://jaytipargal.tech", "heartbeat_interval_seconds": 45, "command_poll_interval_seconds": 15, "allowed_commands": []}
outcome = "returned"
try:
    agent.run_broker(cfg, agent.Path("."), "g4g-lenovo-laptop", {"id": "g4g-lenovo-laptop"}, False)
except _Stop:
    outcome = "still-running"
except SystemExit as e:
    outcome = "exit-" + str(e.code)
print(json.dumps({"outcome": outcome, "heartbeats": CALLS["heartbeat"], "polls": CALLS["poll"]}))`);
    assert.equal(out.outcome, 'still-running', `the daemon ended: ${out.outcome}`);
    assert.deepEqual(out.heartbeats, [], 'a heartbeat went out with no manufacturer or model');
    assert.equal(out.polls, 1, 'command polling must continue while the heartbeat waits');
  });

  t(`${kit}: the installer's one-shot run fails loudly when identity is unavailable`, () => {
    const out = identityRun(kit, ['timeout', 'timeout'], `
cfg = {"broker_url": "https://jaytipargal.tech", "heartbeat_interval_seconds": 45, "command_poll_interval_seconds": 15, "allowed_commands": []}
try:
    agent.run_broker(cfg, agent.Path("."), "g4g-lenovo-laptop", {"id": "g4g-lenovo-laptop"}, True)
    outcome = "passed"
except agent.HardwareIdentityUnavailable:
    outcome = "identity-unavailable"
print(json.dumps({"outcome": outcome, "heartbeats": len(CALLS["heartbeat"])}))`);
    assert.equal(out.outcome, 'identity-unavailable', '--once must not report success without a heartbeat');
    assert.equal(out.heartbeats, 0);
  });
}

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
