// Contract tests for the Product engineering panel's status maths.
//
// The panel's only value is that a green light is earned. These assertions pin
// the four ways that could quietly stop being true: a layer averaging away a
// broken file, an unprobed subsystem rendering green, a red light shipping
// without the one-line reason the operator needs, and the cloud/device verdict
// split that lets CI gate on what a merge can break bleeding in either
// direction.

import assert from 'node:assert/strict';
import { worst, buildLayers, snapshot, probeAssets, probeRepair, deviceFreshness, logVerdict } from '../../Backend/jp-stack.js';
import { evaluateStack, failureLines, alertBody } from '../../Backend/stack-cron.js';
import { LAYERS, REQUIRED_ENV, allFiles } from '../../Backend/lib/stack-map.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// A probe set where everything succeeded, used as the baseline to mutate.
function allOk() {
  const probes = {};
  for (const f of allFiles()) probes[f.probe] = { status: 'ok', detail: 'fine' };
  return probes;
}

t('a layer is only as green as its weakest file', () => {
  assert.equal(worst(['ok', 'ok', 'ok']), 'ok');
  assert.equal(worst(['ok', 'unknown']), 'unknown');
  assert.equal(worst(['ok', 'warn', 'unknown']), 'warn');
  assert.equal(worst(['ok', 'warn', 'fail']), 'fail');
  assert.equal(worst([]), 'ok', 'an empty layer has nothing to be unhealthy about');
});

t('a row with no verifiable evidence never renders green', () => {
  // The two evidence-backed rows (the S24 runtime contract and the migration
  // tooling) are proved by a SIGNED CI receipt, not by a hand-written
  // constant. Until such a receipt exists, verifies, and is bound to this
  // revision, the row must stay grey. A probe that answered 'ok' because the
  // file happens to exist would be the exact lie rule 1 forbids.
  const probes = allOk();
  probes['runtime-contract'] = { status: 'unknown', problem: 'no CI evidence has been published for runtime-contract' };
  probes['migration-tooling'] = { status: 'unknown', problem: 'the evidence signature does not verify' };
  const layers = buildLayers(probes);
  const unproven = layers.flatMap((l) => l.files).filter((f) => f.probe === 'runtime-contract' || f.probe === 'migration-tooling');
  assert.ok(unproven.length >= 2, 'expected the two evidence-backed rows');
  for (const f of unproven) {
    assert.notEqual(f.status, 'ok', f.path + ' claimed green without usable evidence');
    assert.ok(f.problem && f.problem.length > 0, f.path + ' is not green but gives the operator no reason');
  }
});

t('every non-green file carries a one-line problem the operator can act on', () => {
  const probes = allOk();
  probes.agent = { status: 'fail', problem: 'agent /health returned HTTP 502' };
  probes.postgres = { status: 'fail', problem: 'DATABASE_URL not set on this deployment' };
  probes.tls = { status: 'warn', problem: 'certificate expires in 9 days' };
  for (const f of buildLayers(probes).flatMap((l) => l.files)) {
    if (f.status === 'ok') continue;
    assert.ok(f.problem && f.problem.length > 0, f.path + ' is not green but has no problem line');
    assert.ok(!f.problem.includes('\n'), f.path + ' problem must stay one line');
  }
});

t('a green file carries no problem line', () => {
  for (const f of buildLayers(allOk()).flatMap((l) => l.files)) {
    if (f.status !== 'ok') continue;
    assert.equal(f.problem, '', f.path + ' is green but still reports a problem');
  }
});

t('an unregistered probe degrades to unknown rather than throwing or passing', () => {
  // A file added to stack-map.js with a typo'd probe name must not take the
  // whole panel down, and must not be rewarded with a green light either.
  const layers = buildLayers({});
  const statuses = new Set(layers.flatMap((l) => l.files).map((f) => f.status));
  assert.deepEqual([...statuses], ['unknown']);
});

t('the devices tier is present and states the device-initiated-only constraint', () => {
  // The reference diagram has no box for devices. Dropping ours would hide the
  // one failure that every other probe stays green through.
  const devices = LAYERS.find((l) => l.id === 'devices');
  assert.ok(devices, 'devices layer is missing from the stack map');
  assert.match(devices.note, /pull from a phone/i);
});

t('required env vars are declared by name only, never with a value', () => {
  // A value or example reaching this manifest would put a secret in the repo
  // and then in the API response.
  for (const v of REQUIRED_ENV) {
    assert.ok(v.name && v.why, 'env entry needs a name and a reason');
    assert.ok(!('value' in v) && !('example' in v) && !('default' in v),
      v.name + ' must not carry a value in the manifest');
  }
});

t('every file in the map names a probe that the handler can resolve', () => {
  const probes = allOk();
  for (const f of allFiles()) {
    assert.ok(f.probe, f.path + ' has no probe');
    assert.ok(probes[f.probe], f.path + ' names probe "' + f.probe + '" which nothing provides');
  }
});

// ---- the unattended watchdog (stack-cron.js) ----

t('the cron alerts on a state change, never once per tick', () => {
  // At a 5-minute cadence, alerting every tick is 288 mails a day for one
  // broken thing, and the ninth identical mail is where a human stops reading.
  const down = evaluateStack('fail', 'healthy');
  assert.equal(down.action, 'down');
  assert.equal(down.newState, 'alerted');
  assert.equal(down.changed, true);
  assert.equal(evaluateStack('fail', 'alerted').changed, false, 'still failing must stay silent');
  const recovered = evaluateStack('pass', 'alerted');
  assert.equal(recovered.action, 'recovered');
  assert.equal(recovered.newState, 'healthy');
  assert.equal(recovered.changed, true);
  assert.equal(evaluateStack('pass', 'healthy').changed, false, 'still healthy must stay silent');
});

t('a failure that becomes unproven never produces a recovery message', () => {
  // The sharp end. "Every check is passing again" is a claim about evidence.
  // A dependency whose evidence went missing has NOT been shown to pass, so
  // the panel must not say it has — and the operator must not be told the
  // outage is over when it may still be running.
  const transition = evaluateStack('unproven', 'alerted');
  assert.notEqual(transition.action, 'recovered', 'a missing proof is not a recovery');
  assert.equal(transition.changed, false, 'the alert state must stay as it was');
  assert.equal(transition.newState, 'alerted');
});

t('missing evidence alerts, because silence is the failure mode', () => {
  // Unproven is not "probably fine". It is "we cannot show that it is fine",
  // and a responder needs to know that at 03:00 exactly as much as for a
  // failure.
  const transition = evaluateStack('unproven', 'healthy');
  assert.equal(transition.action, 'down');
  assert.equal(transition.newState, 'alerted');
  assert.equal(transition.changed, true);
});

t('a first-ever run with no stored state is treated as healthy, not as a recovery', () => {
  // Otherwise the very first cron tick on a fresh deployment emails RECOVERED
  // for an outage that never happened.
  assert.equal(evaluateStack('pass', null).changed, false);
  assert.equal(evaluateStack('pass', undefined).changed, false);
  // ...but a first run that is genuinely failing must still alert.
  assert.equal(evaluateStack('fail', null).action, 'down');
});

t('a warning does not wake anyone at 03:00', () => {
  // A cert with 20 days left earns a colour in the panel, not an email. An
  // alert nobody must act on tonight is how the real red ones get ignored.
  assert.equal(evaluateStack('warn', 'healthy').changed, false);
  // A warning while already alerted counts as recovered — the failure cleared.
  assert.equal(evaluateStack('warn', 'alerted').action, 'recovered');
});

t('the alert email names every failing probe and its reason', () => {
  const snap = {
    fetched_at: '2026-09-20T03:00:00.000Z',
    overall: 'fail',
    readiness: { verdict: 'fail', reason: '2 required row(s) failed', scope: { rows_unproven: 0 } },
    summary: { ok: 40, warn: 0, fail: 2, unknown: 6, total: 48 },
    probes: {
      agent: { status: 'fail', problem: 'agent /health returned HTTP 502' },
      postgres: { status: 'fail', problem: 'DATABASE_URL not set on this deployment' },
      dns: { status: 'ok', problem: '' },
    },
  };
  const lines = failureLines(snap);
  assert.equal(lines.length, 2, 'only failing probes are listed');
  const body = alertBody('down', snap).text;
  assert.match(body, /HTTP 502/);
  assert.match(body, /DATABASE_URL not set/);
  assert.doesNotMatch(body, /dns/, 'a healthy probe must not appear in a failure mail');
  assert.match(alertBody('down', snap).subject, /DOWN/);
  assert.match(alertBody('recovered', snap).subject, /RECOVERED/);
});

t('an unproven verdict produces its own message, not a failure message', () => {
  // The two are different incidents. "Something failed" and "we cannot show
  // that anything passed" call for different readings and different fixes,
  // and an operator who is told "DOWN" when the real problem is missing
  // evidence will go looking in the wrong place.
  const snap = {
    fetched_at: '2026-09-20T03:00:00.000Z',
    overall: 'unknown',
    readiness: { verdict: 'unproven', reason: '2 required row(s) have no usable evidence', scope: { rows_unproven: 2 } },
    summary: { ok: 36, warn: 0, fail: 0, unknown: 2, total: 38 },
    probes: {
      'runtime-contract': { status: 'unknown', problem: 'no CI evidence has been published for runtime-contract' },
      postgres: { status: 'ok', problem: '' },
    },
  };
  const body = alertBody('down', snap);
  assert.match(body.subject, /UNPROVEN/);
  assert.match(body.text, /no CI evidence has been published/);
  assert.doesNotMatch(body.text, /postgres/, 'a healthy probe must not appear in the mail');
});

t('a stopped device daemon reddens the panel but never the cloud verdict', () => {
  // CI gating on device freshness turns every push red for an outage no
  // deploy can fix — phones phone home or they are silent, and
  // Devices/S24/runtime_contract.json forbids any inbound listener. The
  // cloud_fail split is what lets the git check stay meaningful while the
  // panel keeps the dead daemon red, so it must count everything but devices.
  const probes = allOk();
  probes.devices = { status: 'fail', problem: 'newest device heartbeat is 9,500 min old' };
  const dead = snapshot(probes);
  assert.equal(dead.overall, 'fail', 'the panel must still call a dead fleet red');
  assert.ok(dead.summary.fail > 0, 'device files count in the headline fail tally');
  assert.equal(dead.cloud_fail, 0, 'device freshness must never enter the cloud gate');

  probes.postgres = { status: 'fail', problem: 'schema incomplete — missing wa_messages' };
  const broken = snapshot(probes);
  assert.ok(broken.cloud_fail > dead.cloud_fail, 'a failing Neon does gate CI');
});

t('a per-file probe result overrides the probe-wide one, in both directions', () => {
  // `assets` HEADs nine separate URLs, so it answers per path. One 404 must
  // redden exactly the page that 404'd: a layer-wide verdict would either
  // paint eight served pages red or hide the missing one behind them, and
  // both are the "light that tells you nothing" this panel exists to avoid.
  const probes = allOk();
  // As the real probe answers: every governed path present, one of them down.
  const byPath = {};
  for (const f of allFiles().filter((f) => f.probe === 'assets')) {
    byPath[f.path] = { status: 'ok', detail: 'HTTP 200 from ' + (f.url || 'rewrites') };
  }
  byPath['Frontend/viewer.html'] = { status: 'fail', problem: 'https://jaytipargal.tech/viewer returned HTTP 404' };
  probes.assets = { status: 'fail', problem: '1 of 10 paths did not serve — see each file', byPath };
  const files = buildLayers(probes).flatMap((l) => l.files).filter((f) => f.probe === 'assets');
  const viewer = files.find((f) => f.path === 'Frontend/viewer.html');
  const index = files.find((f) => f.path === 'Frontend/index.html');
  assert.equal(viewer.status, 'fail', 'the 404 page must carry the failure');
  assert.match(viewer.problem, /HTTP 404/, 'and the status it actually returned');
  assert.equal(index.status, 'ok', 'a page that is served must not inherit another page\'s 404');

  // A path the probe did not get to has no per-file truth, so it must fall
  // back to the probe-wide verdict rather than defaulting to green.
  delete probes.assets.byPath['Frontend/index.html'];
  const unreported = buildLayers(probes).flatMap((l) => l.files).find((f) => f.path === 'Frontend/index.html');
  assert.notEqual(unreported.status, 'ok', 'an unreported path must not be assumed served');
});

t('the pages the browser loads are attested by a request, not assumed', () => {
  // These nine were `static` — permanently grey — because a function cannot
  // stat the repo. It never needed to: whether a page reaches a browser is a
  // question a fetch answers, so they are probed like the jp-agent is.
  const served = allFiles().filter((f) => f.probe === 'assets' && f.url);
  assert.ok(served.length >= 9, 'every dashboard page should be fetched, got ' + served.length);
  for (const f of served) {
    assert.ok(f.url.startsWith('/'), f.path + ' needs the path the edge serves it at, not its repo path');
  }
  // vercel.json is the routing table, so it cannot verify itself with a URL —
  // the rewrites resolving is its evidence, and some must actually be marked.
  const routing = allFiles().find((l) => l.layer === 'web' && l.path === 'vercel.json');
  assert.equal(routing.probe, 'assets');
  assert.ok(!routing.url, 'the routing table must not claim a green from one fetch of its own');
  assert.ok(served.some((f) => f.rewrite), 'no rewritten path is marked, so vercel.json has nothing to stand on');
});

t('the two rows that had no live signal are now bound to verified CI evidence', () => {
  // These used to sit on the `static` probe, permanently grey, because a
  // serverless function cannot stat the repository. They are now proved from
  // outside: a protected CI job runs the checks and publishes a signed
  // receipt, and the panel verifies it before the row may go green. The rows
  // themselves must still exist, and must still be governed by a probe that
  // runs — a proof that is not wired to a row proves nothing.
  const contract = allFiles().find((f) => f.path === 'Devices/S24/runtime_contract.json');
  const migration = allFiles().find((f) => f.path === 'Database/scripts/migrate.mjs');
  assert.ok(contract, 'the S24 runtime contract is no longer in the stack map');
  assert.ok(migration, 'the migration runner is no longer in the stack map');
  assert.equal(contract.probe, 'runtime-contract');
  assert.equal(migration.probe, 'migration-tooling');
  const probes = allOk();
  assert.ok(probes['runtime-contract'], 'the runtime-contract probe is not registered');
  assert.ok(probes['migration-tooling'], 'the migration-tooling probe is not registered');
  // The static probe is gone for good: a row that can never be proven is not a
  // row, it is a decoration.
  assert.equal(allFiles().filter((f) => f.probe === 'static').length, 0,
    'the static probe still governs a row');
});

// One async case: probeAssets is driven against a stubbed edge rather than the
// real one, so the suite stays hermetic and does not depend on the network.
async function ta(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

await ta('a 200 that declares no content-length is served, not empty', async () => {
  // `content-length` is absent on a chunked or compressed response, and
  // Number(null) is 0 rather than NaN. Reading it naively reported every
  // perfectly served page as an empty body — a false red that would have
  // reached cloud_fail and reddened the health-check gate in CI.
  globalThis.fetch = async () => new Response(null, { status: 200 });
  const r = await probeAssets();
  assert.equal(r.status, 'ok', 'a length nobody declared must not read as zero');
  for (const [path, v] of Object.entries(r.byPath)) {
    assert.equal(v.status, 'ok', path + ' was called broken on a 200');
    assert.doesNotMatch(v.problem || '', /empty body/, path + ' reported an empty body it never saw');
  }
});

// ── deviceFreshness must judge per device, never fleet-max ──────────────
// The old code took the single newest lastSeen across the whole fleet, so one
// live device painted the tier green while three were dead for days. These pin
// that a fresh device can never hide a stale one again.
function fsDocs(entries) {
  // entries: [id, minutesAgo|null] or [id, minutesAgo|null, extraFields].
  // Shapes the Firestore REST doc deviceFreshness reads.
  const now = Date.now();
  const _docs = entries.map(([id, minAgo, extra]) => ({
    name: 'projects/x/databases/eka-agent/documents/devices/' + id,
    fields: {
      ...(minAgo == null ? {} : { lastSeen: { timestampValue: new Date(now - minAgo * 60000).toISOString() } }),
      ...(extra || {}),
    },
  }));
  return { status: 'ok', _docs };
}

/**
 * The S24 as the broker stamps it after accepting a signed heartbeat.
 *
 * The S24 is the one device whose liveness is ATTESTED rather than assumed:
 * the panel judges it with the shared policy in Backend/lib/s24-attestation.js,
 * so a fixture that carries only a timestamp is not a phone — it is a document
 * that claims to be one, and it must not be green.
 */
function attestedS24(minAgo, overrides = {}) {
  const lastSeen = new Date(Date.now() - minAgo * 60000).toISOString();
  return {
    // The signed timestamp must exactly match the same heartbeat's lastSeen.
    lastSeen: { timestampValue: lastSeen },
    agentVersion: { stringValue: 's24-termux-broker-2026-09-21.2' },
    connectionMethod: { stringValue: 'signed-broker-v2' },
    heartbeatAuth: { stringValue: 'termux-phone' },
    liveDeviceVerified: { booleanValue: true },
    sourceType: { stringValue: 'live_termux' },
    runtimeIsAndroid: { booleanValue: true },
    enrollment: {
      mapValue: {
        fields: {
          lastSignedHeartbeatAt: { stringValue: lastSeen },
          lastSignedHeartbeatKeyId: { stringValue: 'key-1' },
          lastSignedHeartbeatProtocol: { stringValue: '2' },
          activeKeyId: { stringValue: 'key-1' },
          keyType: { stringValue: 'android-keystore-p256' },
        },
      },
    },
    ...overrides,
  };
}

// Fixtures use the fleet's own ids: deviceFreshness judges only the three
// fleet devices (DEVICE_IDS in Backend/broker.js), so any other id is ignored
// and _shared/tests/device-fleet.test.mjs pins that.
t('one fresh device does not mask two dead ones', () => {
  const r = deviceFreshness(fsDocs([
    ['jayti-asus-vivobook', null],       // never reported
    ['samsung-s24-ultra', 11000],        // ~7.6 days
    ['g4g-lenovo-laptop', 3],            // the one live device
  ]));
  assert.equal(r.status, 'fail', 'a live device must not green the tier while others are dead');
  assert.match(r.problem, /samsung-s24-ultra/, 'the dead devices are named, not just counted');
  assert.match(r.problem, /jayti-asus-vivobook/, 'a never-reported device is surfaced too');
  assert.equal(r.byDevice['g4g-lenovo-laptop'].status, 'ok', 'the live device is still individually green');
  assert.equal(r.byDevice['samsung-s24-ultra'].status, 'fail');
});

t('an all-fresh fleet is green and reports the newest heartbeat', () => {
  const r = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 5],
    ['samsung-s24-ultra', 9, attestedS24(9)],
  ]));
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /^all 3 device\(s\) fresh; newest heartbeat 2 min/);
});

t('a device seen 20 min ago warns but does not fail', () => {
  const r = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 20],
    ['samsung-s24-ultra', 3, attestedS24(3)],
  ]));
  assert.equal(r.status, 'warn', '15<age<=60 min is a warn, not a hard fail');
  assert.equal(r.byDevice['jayti-asus-vivobook'].status, 'warn', 'and the warn is the 20-minute device');
});

t('an unreadable Firestore probe leaves devices unknown, never green', () => {
  const r = deviceFreshness({ status: 'fail' });
  assert.equal(r.status, 'unknown');
});

t('the S24 is green only when the broker has attested it', () => {
  // A document that merely carries a fresh timestamp is not a phone. The
  // panel uses the shared attestation policy, so a laptop writer, a legacy
  // collector or a hand-edited document cannot make the S24 look alive.
  const unauthenticated = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 2],
    ['samsung-s24-ultra', 2],
  ]));
  assert.equal(unauthenticated.byDevice['samsung-s24-ultra'].status, 'fail',
    'a timestamp alone must not make the S24 green');
  assert.equal(unauthenticated.status, 'fail');

  const attested = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 2],
    ['samsung-s24-ultra', 2, attestedS24(2)],
  ]));
  assert.equal(attested.byDevice['samsung-s24-ultra'].status, 'ok');
  assert.equal(attested.status, 'ok');
});

t('the S24 running the legacy collector is not the attested device', () => {
  // This is the live state of the fleet: on 2026-10-21 the S24 reported
  // agentVersion "s24-termux-https-worker-2026-07-27.1" over
  // connectionMethod "termux-direct-cloud" — the old collector, not the
  // signed broker daemon the runtime contract requires. It must be red, and
  // the reason must name what it is actually running.
  const legacy = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 2],
    ['samsung-s24-ultra', 2, {
      agentVersion: { stringValue: 's24-termux-https-worker-2026-07-27.1' },
      connectionMethod: { stringValue: 'termux-direct-cloud' },
      heartbeatAuth: { stringValue: 'termux-phone' },
      liveDeviceVerified: { booleanValue: true },
      sourceType: { stringValue: 'live_termux' },
      runtimeIsAndroid: { booleanValue: true },
    }],
  ]));
  const s24 = legacy.byDevice['samsung-s24-ultra'];
  assert.equal(s24.status, 'fail');
  assert.match(legacy.problem, /s24-termux-https-worker-2026-07-27\.1/,
    'the reason must name what the device is actually running');
});

t('a heartbeat dated in the future is a failure, not a fresh reading', () => {
  // The old arithmetic produced a negative age and every threshold below it
  // was "not exceeded", so a writer that set its own timestamp to tomorrow
  // read as perfectly alive.
  const future = new Date(Date.now() + 3600000).toISOString();
  const r = deviceFreshness(fsDocs([
    ['g4g-lenovo-laptop', 2],
    ['jayti-asus-vivobook', 2],
    ['samsung-s24-ultra', 2, { lastSeen: { timestampValue: future } }],
  ]));
  assert.equal(r.byDevice['samsung-s24-ultra'].status, 'fail');
  assert.match(r.problem, /future/);
});

// ── the nightly DynamoDB -> Neon repair is watched ──────────────────────
// On 2026-10-14 the backfill run answered 503 "JP_AWS_* read credentials not
// configured" and nothing said so: no probe governed Backend/db-push.js, and
// health-check.yml never calls the cron route. Every read the dashboard serves
// for the jaytibirthday.in property comes through that repair, so its silence
// was the operator's missing-data report. These pin the light that was absent.
const REPAIR_ENV_NAMES = [
  'JP_AWS_ACCESS_KEY_ID', 'JP_AWS_SECRET_ACCESS_KEY',
  'JP_WRITE_AWS_ACCESS_KEY_ID', 'JP_WRITE_AWS_SECRET_ACCESS_KEY',
];

function withoutRepairEnv(fn) {
  const saved = {};
  for (const name of REPAIR_ENV_NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try { return fn(); }
  finally {
    for (const name of REPAIR_ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

t('an unconfigured warehouse repair is red and names the vars, never green', () => {
  const r = withoutRepairEnv(() => probeRepair());
  assert.equal(r.status, 'fail', 'a repair that cannot start must not read green');
  assert.match(r.problem, /JP_AWS_ACCESS_KEY_ID/);
  assert.match(r.problem, /JP_AWS_SECRET_ACCESS_KEY/);
  assert.ok(!r.problem.includes('\n'), 'the panel renders one line per problem');
  // Names only: a value in this string would end up in the API response.
  assert.doesNotMatch(r.problem, /fixture/, 'a credential value reached the problem line');
});

t('a configured repair is green, and reports a read-only pair honestly', () => {
  const r = withoutRepairEnv(() => {
    process.env.JP_AWS_ACCESS_KEY_ID = 'fixture';
    process.env.JP_AWS_SECRET_ACCESS_KEY = 'fixture';
    return probeRepair();
  });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /read credentials present/);
  assert.match(r.detail, /JP_WRITE_AWS_ACCESS_KEY_ID/,
    'a read-only pair must say the write-credential scan is not configured');
});

t('Backend/db-push.js is governed by a probe that runs, so the light is earned', () => {
  const file = allFiles().find((f) => f.path === 'Backend/db-push.js');
  assert.ok(file, 'the nightly repair is not in the stack map at all');
  assert.equal(file.probe, 'repair');
  assert.ok(allOk().repair, 'the repair probe is not registered in runProbes');
});

// ── a health-check 503 explains itself in the runtime log ───────────────
// The health-key response is verdict and counts only, and nothing was logged
// either, so Vercel showed a bare 503 on /api/jp-stack for every health-check
// run, with no way to tell a dead dependency from a stopped phone. logVerdict
// is that missing line; these pin what it says, at which level, and what it
// never says.
function capture() {
  const lines = [];
  return { lines, warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) };
}

t('a stopped daemon logs one warning naming the probe and each stale device, never an error', () => {
  const probes = allOk();
  probes.devices = deviceFreshness(fsDocs([
    ['samsung-s24-ultra', 1500], ['jayti-asus-vivobook', null], ['g4g-lenovo-laptop', 3],
  ]));
  const log = capture();
  logVerdict(snapshot(probes), log);
  assert.equal(log.lines.length, 1, 'one line per verdict');
  const [level, line] = log.lines[0];
  assert.equal(level, 'warn', 'a device CI does not gate on must not log at error level');
  assert.match(line, /^\[jp-stack\] health verdict fail verdict=fail cloud_fail=0 /);
  assert.match(line, / failing=devices /, 'the failing probe is named');
  assert.match(line, /samsung-s24-ultra:1500m/, 'each stale device is named with its heartbeat age');
  assert.match(line, /jayti-asus-vivobook:never/, 'a device that never reported says so');
  assert.doesNotMatch(line, /g4g-lenovo-laptop/, 'a fresh device is not noise in the line');
  // Six stack-map files hang off the devices probe, so the file counts must
  // say they are files; the device tally is separate and names the fleet size.
  assert.match(line, / files_fail=6 files_warn=0 files_unknown=\d+ /, 'file counts are labelled as files');
  assert.doesNotMatch(line, / fail=\d/, 'a bare fail=6 beside three devices reads as six devices');
  assert.match(line, / devices_not_ok=2\/3 /, 'two of the three fleet devices are down');
});

t('a failing cloud probe logs at error level, and no problem or detail text reaches the log', () => {
  // problem/detail strings name hosts, tables and env vars; a log drain can
  // ship this line anywhere, so only probe ids and counts may appear.
  const probes = allOk();
  probes.postgres = { status: 'fail', problem: 'ECONNREFUSED ep-quiet-sea.neon.tech — DATABASE_URL rejected', detail: 'db.internal:5432' };
  probes.dynamo = { status: 'warn', problem: 'AWS_REGION unset, defaulting' };
  const log = capture();
  logVerdict(snapshot(probes), log);
  assert.equal(log.lines.length, 1);
  const [level, line] = log.lines[0];
  assert.equal(level, 'error', 'a cloud failure is what CI gates on, so it logs as an error');
  assert.match(line, / cloud_fail=[1-9]/);
  assert.match(line, / failing=postgres /);
  assert.match(line, / warning=dynamo(?: |$)/);
  assert.doesNotMatch(line, /neon\.tech|DATABASE_URL|ECONNREFUSED|db\.internal|AWS_REGION/);
});

t('a green stack logs nothing; a warn-only stack logs one warning', () => {
  const quiet = capture();
  logVerdict(snapshot(allOk()), quiet);
  assert.equal(quiet.lines.length, 0, 'a healthy run must not write a line every time CI asks');

  const probes = allOk();
  probes.dns = { status: 'warn', problem: 'certificate expires in 20 days' };
  const warned = capture();
  logVerdict(snapshot(probes), warned);
  assert.deepEqual(warned.lines.map(([level]) => level), ['warn']);
  assert.match(warned.lines[0][1], /health verdict warn .* warning=dns(?: |$)/);
});

t('a device id cannot forge a second log line', () => {
  // byDevice holds fleet ids today, but logVerdict formats whatever snapshot it
  // is handed, and a Firestore document id may hold any character but "/",
  // newlines included.
  const snap = snapshot(allOk());
  snap.overall = 'fail';
  snap.probes.devices = { status: 'fail', byDevice: { 'evil\n[jp-stack] health verdict ok': { status: 'fail', mins: 900 } } };
  const log = capture();
  logVerdict(snap, log);
  const line = log.lines[0][1];
  assert.doesNotMatch(line, /[\r\n]/, 'the id broke the line in two');
  assert.equal(line.split('[jp-stack]').length, 2, 'the id carried a second [jp-stack] prefix into the log');
  assert.match(line, /:900m$/);
});

t('only the scheduled health-key branch logs; the 10 s dashboard poll never does', () => {
  // The handler cannot run hermetically (every probe goes to the network), so
  // this pins its wiring by source, the way the index.html cases below do.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Backend', 'jp-stack.js'), 'utf8');
  const body = src.slice(src.indexOf('export default async function handler'));
  const healthBranch = body.slice(0, body.indexOf('requireKey('));
  assert.match(healthBranch, /x-health-key/, 'handler layout changed: the health-key branch is no longer first');
  assert.match(healthBranch, /logVerdict\(snap\)/, 'the health-key verdict is no longer logged');
  assert.doesNotMatch(body.slice(body.indexOf('requireKey(')), /logVerdict|console\./, 'the dashboard poll must not log');
});

// ── the dashboard's all-offline banner is wired, not just declared ──────
// Frontend is tested by source assertion here, the same way wa-message-view
// and stats-session-parity pin the index.html contract without a browser.
const INDEX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Frontend', 'index.html'), 'utf8');

t('index.html carries the all-devices-offline banner element', () => {
  assert.match(INDEX, /id="allDevicesStaleBanner"/, 'the banner element is missing');
});

t('the banner is driven by every device being offline and named as such', () => {
  assert.match(INDEX, /function renderAllStaleBanner/, 'the toggle function is missing');
  assert.match(INDEX, /\.every\(function \(d\) \{ return !\(d && d\.live\); \}\)/, 'the all-offline predicate changed shape');
  assert.match(INDEX, /Queued commands cannot execute/, 'the banner no longer states the operational consequence');
  assert.match(INDEX, /renderAllStaleBanner\(devices\)/, 'loadLiveDevices no longer calls the banner');
});

t('a deep-linked protected view waits for the dashboard key and reloads after unlock', () => {
  const loader = INDEX.slice(INDEX.indexOf('function loadActiveView()'), INDEX.indexOf('/* ===== WHATSAPP ====='));
  assert.match(loader, /if \(!KEY\) return;/, 'a locked deep link can still poll protected endpoints');
  assert.match(loader, /page === 'stack'.*loadStack\(\)/, 'the Stack view is not part of the shared reload path');
  assert.match(loader, /page === 'device'.*loadDeviceHistory\(\)/, 'the Device view is not part of the shared reload path');
  const unlock = INDEX.slice(INDEX.indexOf("$('unlockBtn').addEventListener"), INDEX.indexOf("$('keyInput').addEventListener"));
  assert.match(unlock, /loadActiveView\(\);/, 'unlock leaves the selected deep link stale');
  const stack = INDEX.slice(INDEX.indexOf('async function loadStack()'), INDEX.indexOf('// Expand/collapse is delegated'));
  assert.match(stack, /if \(!KEY\) return;/, 'the 10-second Stack timer still polls while locked');
});

console.log('\n  ' + pass + '/' + total + ' passed');
