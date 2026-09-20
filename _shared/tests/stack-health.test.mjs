// Contract tests for the Product engineering panel's status maths.
//
// The panel's only value is that a green light is earned. These assertions pin
// the four ways that could quietly stop being true: a layer averaging away a
// broken file, an unprobed subsystem rendering green, a red light shipping
// without the one-line reason the operator needs, and the cloud/device verdict
// split that lets CI gate on what a merge can break bleeding in either
// direction.

import assert from 'node:assert/strict';
import { worst, buildLayers, snapshot } from '../../Backend/jp-stack.js';
import { evaluateStack, failureLines, alertBody } from '../../Backend/stack-cron.js';
import { LAYERS, REQUIRED_ENV, allFiles } from '../../Backend/lib/stack-map.js';

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

t('a subsystem with no live signal never renders green', () => {
  // The `static` probe is the one that cannot be attested from a function.
  // If it ever returns ok, every hand-written config file in the panel would
  // claim health nobody verified — the exact failure strictS24Liveness exists
  // to prevent.
  const probes = allOk();
  probes.static = { status: 'unknown', detail: 'no live signal' };
  const layers = buildLayers(probes);
  const staticFiles = layers.flatMap((l) => l.files).filter((f) => f.probe === 'static');
  assert.ok(staticFiles.length > 0, 'expected at least one static-probed file');
  for (const f of staticFiles) {
    assert.notEqual(f.status, 'ok', f.path + ' claimed green from an unprobed subsystem');
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
  assert.deepEqual(evaluateStack('fail', 'healthy'), { action: 'down', newState: 'alerted', changed: true });
  assert.equal(evaluateStack('fail', 'alerted').changed, false, 'still failing must stay silent');
  assert.deepEqual(evaluateStack('ok', 'alerted'), { action: 'recovered', newState: 'healthy', changed: true });
  assert.equal(evaluateStack('ok', 'healthy').changed, false, 'still healthy must stay silent');
});

t('a first-ever run with no stored state is treated as healthy, not as a recovery', () => {
  // Otherwise the very first cron tick on a fresh deployment emails RECOVERED
  // for an outage that never happened.
  assert.equal(evaluateStack('ok', null).changed, false);
  assert.equal(evaluateStack('ok', undefined).changed, false);
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

console.log('\n  ' + pass + '/' + total + ' passed');
