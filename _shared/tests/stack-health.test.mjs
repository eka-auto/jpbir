// Contract tests for the Product engineering panel's status maths.
//
// The panel's only value is that a green light is earned. These assertions pin
// the four ways that could quietly stop being true: a layer averaging away a
// broken file, an unprobed subsystem rendering green, a red light shipping
// without the one-line reason the operator needs, and the cloud/device verdict
// split that lets CI gate on what a merge can break bleeding in either
// direction.

import assert from 'node:assert/strict';
import { worst, buildLayers, snapshot, probeAssets } from '../../Backend/jp-stack.js';
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
  // question a fetch answers, so they are probed like the droplet is.
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

t('a subsystem with genuinely no signal is still left grey', () => {
  // The point of the assets probe was to stop overusing `static`, not to
  // abolish it. A token piped over stdin on a droplet has no cloud-side
  // signal, and inventing one would be the exact lie rule 1 forbids.
  const stillStatic = allFiles().filter((f) => f.probe === 'static').map((f) => f.path);
  assert.ok(stillStatic.length > 0, 'static must survive for what truly cannot be probed');
  for (const p of ['Server/jp-agent/sync-auth-token.py', 'Devices/S24/runtime_contract.json']) {
    assert.ok(stillStatic.includes(p), p + ' has no live signal and must not have been made green');
  }
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

console.log('\n  ' + pass + '/' + total + ' passed');
