// Guards the extracted S24 attestation module.
//
// The dashboard and the droplet each had their own copy of this policy and they drifted
// twice in one day. First the droplet accepted only the `s24-termux-` agentVersion prefix
// while the collector shipped to the phone writes `s24-direct-cloud-<date>.<n>`, so
// authenticatedAgent could never pass. Then, after both prefixes were accepted, the droplet
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
const DROPLET_COPY = 'Server/jp-agent/s24-attestation.js';
const DASHBOARD = 'Backend/jp-devices.js';
const DROPLET = 'Server/jp-agent/device-health.mjs';

const {
  S24_AGENT_VERSION_PREFIXES,
  S24_RUNTIME_EVIDENCE,
  S24_ACK_MAX_AGE_SECONDS,
  s24AttestationChecks,
} = await import('../../Backend/lib/s24-attestation.js');
const { strictS24Liveness } = await import('../../Backend/jp-devices.js');
const { deviceHealth } = await import('../../Server/jp-agent/device-health.mjs');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// A document that satisfies every check except the one an off-device process cannot fake.
// Field placement follows each caller's own convention: the dashboard reads everything
// top-level, the droplet reads liveDeviceVerified/sourceType from the nested sub-map.
//
// One timestamp, not one Date.now() per field: the droplet requires
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
    connectionMethod: 'termux-direct-cloud',
    liveDeviceVerified: true,
    sourceType: 'live_termux',
    runtimeIsAndroid: false, // the tell
    lastCommandAckAt: at,
    lastCommandAckId: 'c1',
    lastCommandAckStatus: 'completed',
    commandQueue: { c1: { status: 'completed', completedAt: at } },
    samsungS24DirectSync: {
      liveDeviceVerified: true,
      heartbeatAuth: 'termux-phone',
      sourceType: 'live_termux',
    },
  };
};
const phoneDoc = () => ({ ...bridgeDoc(), runtimeIsAndroid: true });

// ------------------------------------------------------- the copy cannot drift --

t('the droplet copy is byte-identical to the canonical module', () => {
  // deploy.sh ships files flat into /opt/jp-agent, and .vercelignore excludes Server/, so
  // neither caller can import the other's path. The copy is unavoidable; making it
  // machine-checked is not.
  assert.equal(sha256(DROPLET_COPY), sha256(CANONICAL),
    `${DROPLET_COPY} has drifted from ${CANONICAL} - edit the Backend/lib original and re-copy`);
});

t('deploy.sh actually ships the module to the droplet', () => {
  const sh = read('Server/jp-agent/deploy.sh');
  assert.match(sh, /s24-attestation\.js/,
    'deploy.sh does not scp s24-attestation.js, so the droplet would fail with ERR_MODULE_NOT_FOUND');
  assert.match(sh, /device-health\.mjs/, 'deploy.sh stopped shipping device-health.mjs');
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
  for (const file of [DASHBOARD, DROPLET]) {
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
  assert.equal(h.device_online, true, 'droplet rejected a real phone');
  assert.equal(h.heartbeat_authenticated, true);
});

t('both callers reject an off-device bridge that fakes everything else', () => {
  const doc = bridgeDoc();
  const dash = strictS24Liveness(doc, fresh, fresh);
  assert.equal(dash.live, false, 'dashboard accepted a bridge');
  assert.equal(dash.checks.androidRuntime, false);
  assert.equal(dash.reason, 'androidRuntime is missing or stale');

  const h = deviceHealth('samsung-s24-ultra', doc);
  assert.equal(h.device_online, false, 'droplet accepted a bridge the dashboard refused');
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

t('only the droplet grants a boot grace, and that stays intentional', () => {
  const doc = phoneDoc();
  delete doc.lastCommandAckAt;
  delete doc.commandQueue;
  delete doc.lastCommandAckId;
  delete doc.lastCommandAckStatus;

  assert.equal(strictS24Liveness(doc, fresh, null).live, false,
    'the dashboard must NOT grant a boot grace - a phone that never acknowledged a command is unproven');
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, true,
    'the droplet must grant it, so a freshly rebooted phone is not reported dead before its first ACK');
});

t('the droplet reads liveDeviceVerified and sourceType from the nested sub-map', () => {
  // Documented divergence, not drift: emptying the sub-map must fail the droplet even though
  // the top-level fields the dashboard reads are still valid.
  const doc = { ...phoneDoc(), samsungS24DirectSync: {} };
  assert.equal(deviceHealth('samsung-s24-ultra', doc).device_online, false);
  assert.equal(strictS24Liveness(doc, fresh, fresh).live, true,
    'the dashboard reads those fields top-level, so it is unaffected by the sub-map');
});

// --------------------------------------------- all four implementations stay in step --

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
