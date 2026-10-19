// Guards the extracted S24 attestation module.
//
// The dashboard and the jp-agent service each had their own copy of this policy and they drifted
// twice in one day. First the jp-agent service accepted only the `s24-termux-` agentVersion prefix
// while the collector shipped to the phone writes `s24-direct-cloud-<date>.<n>`, so
// authenticatedAgent could never pass. Then, after both prefixes were accepted, the jp-agent service
// was still missing `runtimeIsAndroid` — the one field an off-device process cannot honestly
// produce, and the control that caught a real Windows bridge asserting
// heartbeatAuth='termux-phone', sourceType='live_termux' and liveDeviceVerified=true about
// itself. The dashboard refused that bridge; device_ping reported it as both device_online
// and heartbeat_authenticated.
//
// Neither drift was caught by a test, because each side tested its own copy against its own
// fixture. So the assertions here are about AGREEMENT between the two callers, not about
// either one in isolation: the same document fed to both must produce the same verdict.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sha256 = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');

const CANONICAL = 'Backend/lib/s24-attestation.js';
const SERVICE_COPY = 'Server/jp-agent/s24-attestation.js';
const DASHBOARD = 'Backend/jp-devices.js';
const SERVICE = 'Server/jp-agent/device-health.mjs';

const {
  S24_AGENT_VERSION_PREFIXES,
  S24_RUNTIME_EVIDENCE,
  S24_ACK_MAX_AGE_SECONDS,
  s24AttestationChecks,
} = await import('../../Backend/lib/s24-attestation.js');
const { strictS24Liveness, computeS24Liveness } = await import('../../Backend/jp-devices.js');
const { deviceHealth } = await import('../../Server/jp-agent/device-health.mjs');
const { runPython } = await import('./python-harness.mjs');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// A document that satisfies every check except the one an off-device process cannot fake.
// Every caller reads the evidence top-level, where the broker heartbeat writes it; the
// nested samsungS24DirectSync copy is legacy and deliberately ignored.
//
// One timestamp, not one Date.now() per field: the jp-agent service requires
// commandQueue[lastCommandAckId].completedAt === lastCommandAckAt as exact strings, so two
// separate calls that straddle a millisecond tick make a genuine phone fail at random.
const fresh = 30;
const bridgeDoc = () => {
  const at = new Date(Date.now() - fresh * 1000).toISOString();
  return {
    online: true,
    lastSeen: at,
    agentVersion: 's24-direct-cloud-2026-09-07.1',
    heartbeatAuth: 'termux-phone',
    connectionMethod: 'signed-broker-v2',
    liveDeviceVerified: true,
    sourceType: 'live_termux',
    runtimeIsAndroid: false, // the tell
    lastCommandAckAt: at,
    lastCommandAckId: 'c1',
    lastCommandAckStatus: 'completed',
    commandQueue: { c1: { status: 'completed', completedAt: at } },
    enrollment: {
      activeKeyId: 'a'.repeat(32),
      keyType: 'android-keystore-p256',
      lastSignedHeartbeatAt: at,
      lastSignedHeartbeatKeyId: 'a'.repeat(32),
      lastSignedHeartbeatProtocol: '2',
    },
    samsungS24DirectSync: {
      liveDeviceVerified: true,
      heartbeatAuth: 'termux-phone',
      sourceType: 'live_termux',
    },
  };
};
const phoneDoc = () => ({ ...bridgeDoc(), runtimeIsAndroid: true });

// ------------------------------------------------------- the copy cannot drift --

t('the jp-agent service copy is byte-identical to the canonical module', () => {
  // .vercelignore excludes Server/, so neither caller can import the other's path.
  // The copy is unavoidable; making it machine-checked is not.
  assert.equal(sha256(SERVICE_COPY), sha256(CANONICAL),
    `${SERVICE_COPY} has drifted from ${CANONICAL} - edit the Backend/lib original and re-copy`);
});

// ------------------------------------------- neither caller may keep a local copy --

t('neither caller re-declares the attestation policy locally', () => {
  const banned = [
    /const\s+S24_AGENT_VERSION_PREFIXES\s*=/,
    /const\s+S24_RUNTIME_EVIDENCE\s*=/,
    /const\s+S24_SOURCE_TYPES\s*=/,
    /const\s+S24_CONNECTION_METHODS\s*=/,
    /const\s+S24_ACK_MAX_AGE_SECONDS\s*=/,
    /'s24-termux-'\s*,\s*'s24-direct-cloud-'/,
    /=\s*'runtimeIsAndroid'/,
  ];
  for (const file of [DASHBOARD, SERVICE]) {
    const src = read(file);
    assert.match(src, /s24-attestation\.js/, `${file} does not import the shared module`);
    for (const re of banned) {
      assert.equal(re.test(src), false,
        `${file} re-declares ${re} locally - that is how the two copies drifted before`);
    }
  }
});

t('the shared module is the only JS source of the accepted prefixes', () => {
  assert.deepEqual(S24_AGENT_VERSION_PREFIXES, ['s24-termux-', 's24-direct-cloud-']);
  assert.equal(S24_RUNTIME_EVIDENCE, 'runtimeIsAndroid');
  assert.equal(S24_ACK_MAX_AGE_SECONDS, 300);
});

// --------------------------------------------- the two callers must AGREE. This is
// the assertion that would have caught both historical drifts. --

t('both callers accept a genuinely attested phone', () => {
  const doc = phoneDoc();
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, true, 'dashboard rejected a real phone');
  const h = deviceHealth('samsung-s24-ultra', doc);
  assert.equal(h.device_online, true, 'jp-agent service rejected a real phone');
  assert.equal(h.heartbeat_authenticated, true);
});

t('both callers reject an off-device bridge that fakes everything else', () => {
  const doc = bridgeDoc();
  const dash = strictS24Liveness(doc, fresh, fresh);
  assert.equal(dash.live, false, 'dashboard accepted a bridge');
  assert.equal(dash.checks.androidRuntime, false);
  assert.equal(dash.reason, 'androidRuntime is missing or stale');

  const h = deviceHealth('samsung-s24-ultra', doc);
  assert.equal(h.device_online, false, 'jp-agent service accepted a bridge the dashboard refused');
  assert.equal(h.heartbeat_authenticated, false);
  // The stored flag is still surfaced honestly so a caller can see the disagreement.
  assert.equal(h.stored_online, true);
});

t('both callers reject a bridge that omits the runtime evidence entirely', () => {
  const doc = bridgeDoc();
  delete doc.runtimeIsAndroid;
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, false);
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, false);
});

t('both callers reject every agentVersion prefix neither accepts', () => {
  for (const agentVersion of ['s24-bridge-win32-2026-09-07.1', 'channel-sandbox-2.0',
    's24-laptop-keepalive', 'not-s24-direct-cloud-x', 's24-direct-cloud']) {
    const doc = { ...phoneDoc(), agentVersion };
    assert.equal(strictS24Liveness(doc, fresh, fresh).live, false, agentVersion);
    assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, false, agentVersion);
  }
});

t('both callers treat a stale heartbeat the same way', () => {
  const doc = phoneDoc();
  assert.equal(strictS24Liveness(doc, 301, fresh).live, false);
  assert.equal(deviceHealth('samsung-s24-ultra',
    { ...doc, lastSeen: new Date(Date.now() - 301000).toISOString() }).device_online, false);
});

// --------------------------- the two deliberate asymmetries, pinned so they stay deliberate --

t('both callers keep command execution proof separate from heartbeat liveness', () => {
  const doc = phoneDoc();
  delete doc.lastCommandAckAt;
  delete doc.commandQueue;
  delete doc.lastCommandAckId;
  delete doc.lastCommandAckStatus;

  const dashboard = strictS24Liveness(doc, fresh, null);
  assert.equal(dashboard.live, true);
  assert.equal(dashboard.commandExecutionRecentlyProven, false);
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, true,
    'a fresh signed heartbeat is basic liveness even before command execution');
  assert.equal(deviceHealth('samsung-s24-ultra', doc).command_execution_recently_proven, false);
});

t('both callers read the signed top-level telemetry rather than a legacy nested copy', () => {
  const doc = { ...phoneDoc(), samsungS24DirectSync: {} };
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, true);
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, true);
});

t('both callers reject self-asserted telemetry without the server broker stamp', () => {
  const doc = phoneDoc();
  delete doc.enrollment;
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, false);
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, false);
});

t('both callers retain the ACK-gated legacy direct-cloud fallback', () => {
  const doc = { ...phoneDoc(), connectionMethod: 'termux-direct-cloud' };
  delete doc.enrollment;
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, true);
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, true);
  assert.equal(strictS24Liveness(doc, fresh, 301).live, false);
});

t('both callers refuse a legacy doc whose fresh ACK no completed queue entry backs', () => {
  const doc = { ...phoneDoc(), connectionMethod: 'termux-direct-cloud', lastCommandAckId: 'gone', commandQueue: {} };
  delete doc.enrollment;
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, false, 'dashboard accepted an orphan ACK');
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, false, 'jp-agent service accepted an orphan ACK');
});

t('both callers agree a rejected command proves nothing about execution', () => {
  const doc = phoneDoc();
  doc.lastCommandAckStatus = 'rejected';
  doc.commandQueue = { c1: { status: 'rejected', completedAt: doc.lastCommandAckAt } };
  assert.equal(strictS24Liveness(doc, fresh, fresh).commandExecutionRecentlyProven, false);
  assert.equal(deviceHealth('samsung-s24-ultra', doc).command_execution_recently_proven, false);
});

// --------------------------------------------- all four implementations stay in step --

t('the Python mirrors reach the same verdict as this module on every evidence shape', () => {
  // Integrations/s24-connect-mcp/server.py and Devices/S24/pull_direct_cloud.py once
  // rejected connectionMethod='signed-broker-v2' outright, read evidence from a nested map
  // the broker never writes, and (the puller) demanded sourceType 'live_termux' while the
  // broker writes 'live_daemon'. A healthy phone read live on the dashboard and jp-agent service and
  // offline/unattested in both. So they are executed here, not pattern-matched.
  const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
  const legacy = (overrides = {}) => {
    const doc = { ...phoneDoc(), connectionMethod: 'termux-direct-cloud', ...overrides };
    delete doc.enrollment;
    return doc;
  };
  const staleAck = ago(301);
  const staleSeen = ago(301);
  const cases = {
    'attested broker phone': phoneDoc(),
    'broker phone writing live_daemon': { ...phoneDoc(), sourceType: 'live_daemon' },
    'off-device bridge': bridgeDoc(),
    'broker telemetry without the server stamp': (() => { const d = phoneDoc(); delete d.enrollment; return d; })(),
    'broker stamp for a software key': { ...phoneDoc(), enrollment: { ...phoneDoc().enrollment, keyType: 'software-p256' } },
    'broker stamp from a superseded key': { ...phoneDoc(), enrollment: { ...phoneDoc().enrollment, activeKeyId: 'b'.repeat(32) } },
    'broker phone whose last command was rejected': {
      ...phoneDoc(), lastCommandAckStatus: 'rejected',
      commandQueue: { c1: { status: 'rejected', completedAt: phoneDoc().lastCommandAckAt } },
    },
    'stale broker heartbeat': {
      ...phoneDoc(), lastSeen: staleSeen, enrollment: { ...phoneDoc().enrollment, lastSignedHeartbeatAt: staleSeen },
    },
    'future-dated heartbeat': (() => {
      const at = new Date(Date.now() + 60000).toISOString();
      return { ...phoneDoc(), lastSeen: at, enrollment: { ...phoneDoc().enrollment, lastSignedHeartbeatAt: at } };
    })(),
    'unknown agent version': { ...phoneDoc(), agentVersion: 's24-bridge-win32-2026-09-07.1' },
    'laptop broker connection method': { ...phoneDoc(), connectionMethod: 'channel-sandbox-broker' },
    'legacy phone with a consistent fresh ACK': legacy(),
    'legacy phone with an orphan ACK': legacy({ lastCommandAckId: 'gone', commandQueue: {} }),
    'legacy phone with a stale ACK': legacy({
      lastCommandAckAt: staleAck, commandQueue: { c1: { status: 'completed', completedAt: staleAck } },
    }),
  };
  const python = runPython(`
connect = load("Integrations/s24-connect-mcp/server.py")
puller = load("Devices/S24/pull_direct_cloud.py")
print(json.dumps({
    name: {"connect": connect._s24_liveness_evidence(doc), "puller": puller.phone_attestation(doc)[0]}
    for name, doc in INPUT.items()
}))
`, cases);
  for (const [name, doc] of Object.entries(cases)) {
    const expected = computeS24Liveness(doc, Date.now()).liveness.evidenceMode;
    assert.equal(python[name].connect, expected, `connect MCP disagrees on "${name}"`);
    assert.equal(python[name].puller, expected !== null, `puller disagrees on "${name}"`);
  }
  assert.equal(python['attested broker phone'].connect, 'signed-broker-v2', 'the matrix must include a live broker verdict');
  assert.equal(python['legacy phone with a consistent fresh ACK'].connect, 'legacy-strict');
});

t('the Python mirrors accept exactly the prefixes this module exports', () => {
  // s24-source-mirrors.test.mjs asserts the literal tuples; this ties them to the JS
  // module so changing one side without the other fails somewhere.
  const expected = S24_AGENT_VERSION_PREFIXES.map((p) => `"${p}"`).join(', ');
  for (const [file, re] of [
    ['Integrations/s24-connect-mcp/server.py', /S24_PHONE_AGENT_PREFIXES\s*=\s*\(([^)]*)\)/],
    ['Devices/S24/pull_direct_cloud.py', /\.startswith\(\(([^)]*)\)\)/],
  ]) {
    const m = read(file).match(re);
    assert.ok(m, `${file}: could not find the prefix tuple`);
    assert.equal(m[1].replace(/\s+/g, ' '), expected.replace(/\s+/g, ' '),
      `${file} disagrees with ${CANONICAL}`);
  }
});

console.log(`\n${pass}/${total} passed`);
