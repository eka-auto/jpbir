// Unit tests for the pure staleness evaluator. Run: node _shared/stale.test.mjs
import { evaluate, evaluateSyncPipeline } from '../../Backend/lib/stale.js';
import assert from 'assert';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const THRESH = 600 * 1000; // 10 min
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// 1. Fresh, healthy device (seen 30s ago) -> nothing.
t('fresh healthy -> none/no-change', () => {
  const r = evaluate({ lastSeen: iso(30_000), staleAlertState: 'healthy' }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'none', newState: 'healthy', changed: false });
});

// 2. Just went stale (11 min), no prior state -> DOWN, becomes alerted.
t('stale first time (no state) -> down/alerted', () => {
  const r = evaluate({ lastSeen: iso(11 * 60_000), staleAlertState: undefined }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'down', newState: 'alerted', changed: true });
});

// 3. Still stale AND already alerted -> none (no repeat email).
t('stale + already alerted -> none/no-change', () => {
  const r = evaluate({ lastSeen: iso(30 * 60_000), staleAlertState: 'alerted' }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'none', newState: 'alerted', changed: false });
});

// 4. Recovered: fresh again but was alerted -> RECOVERED, becomes healthy.
t('recovered (fresh + was alerted) -> recovered/healthy', () => {
  const r = evaluate({ lastSeen: iso(20_000), staleAlertState: 'alerted' }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'recovered', newState: 'healthy', changed: true });
});

// 5. Never seen (S24, lastSeen null) -> skipped, no write.
t('lastSeen null -> none/no-change (skip S24)', () => {
  const r = evaluate({ lastSeen: null, staleAlertState: undefined }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'none', newState: null, changed: false });
});

// 6. Unparseable lastSeen -> skipped, never throws.
t('unparseable lastSeen -> none/no-change', () => {
  const r = evaluate({ lastSeen: 'not-a-date', staleAlertState: 'healthy' }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'none', newState: null, changed: false });
});

// 7. Exactly at threshold is NOT stale (strict >).
t('exactly at threshold -> not stale', () => {
  const r = evaluate({ lastSeen: iso(THRESH), staleAlertState: 'healthy' }, NOW, THRESH);
  assert.strictEqual(r.action, 'none');
  assert.strictEqual(r.changed, false);
});

// 8. Healthy + fresh, no prior state at all -> none, defaults healthy.
t('fresh + no state -> none, defaults healthy', () => {
  const r = evaluate({ lastSeen: iso(5_000) }, NOW, THRESH);
  assert.deepStrictEqual(r, { action: 'none', newState: 'healthy', changed: false });
});


// ── the EXPORT PIPELINE, which fails independently of the device ────────
// The device evaluator above cannot see these: the phone can heartbeat
// perfectly while the Firestore-export -> signed-push half has been dead for
// days. Nothing watched that half until these were written.
const PIPE = { maxAgeMs: 26 * 3600 * 1000, stuckMs: 3600 * 1000 };
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

t('a run inside the window with nothing stuck is healthy', () => {
  const r = evaluateSyncPipeline({ newestStartedAt: hoursAgo(6), stuckCount: 0 }, NOW, PIPE);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.newestAgeSeconds, 6 * 3600);
});

t('one missed run does not alert — GitHub may delay or drop a scheduled run, so 13h is routine', () => {
  const r = evaluateSyncPipeline({ newestStartedAt: hoursAgo(13), stuckCount: 0 }, NOW, PIPE);
  assert.strictEqual(r.ok, true, '13h is a single miss on a twice-daily schedule');
});

t('two consecutive missed runs alert, and the message carries both the age and the threshold', () => {
  const r = evaluateSyncPipeline({ newestStartedAt: hoursAgo(27), stuckCount: 0 }, NOW, PIPE);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /27h ago/);
  assert.match(r.problems[0], /26h threshold/);
});

t('a pipeline that has never delivered is a problem, not "fresh because there is no age to compare"', () => {
  const r = evaluateSyncPipeline({ newestStartedAt: null, stuckCount: 0 }, NOW, PIPE);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /has ever been recorded/);
  assert.strictEqual(r.newestAgeSeconds, null, 'must not invent an age');
});

t('an unparseable started_at is reported rather than silently treated as fresh', () => {
  const r = evaluateSyncPipeline({ newestStartedAt: 'garbage', stuckCount: 0 }, NOW, PIPE);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /unparseable started_at/);
});

t('a run stuck mid-upload alerts even when a newer run started on time — they are different failures', () => {
  const r = evaluateSyncPipeline(
    { newestStartedAt: hoursAgo(2), stuckCount: 3, stuckOldestStartedAt: hoursAgo(40) }, NOW, PIPE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stuckCount, 3);
  assert.match(r.problems[0], /3 s24 sync run\(s\) stuck/);
  assert.match(r.problems[0], /uploading/);
});

t('stale and stuck are reported together, not one masking the other', () => {
  const r = evaluateSyncPipeline(
    { newestStartedAt: hoursAgo(50), stuckCount: 1, stuckOldestStartedAt: hoursAgo(50) }, NOW, PIPE);
  assert.strictEqual(r.problems.length, 2, 'an operator needs both facts to know where to look');
});

t('a missing snapshot does not throw — an unmigrated database must not take the cron down', () => {
  const r = evaluateSyncPipeline(null, NOW, PIPE);
  assert.strictEqual(r.ok, false);
  assert.match(r.problems[0], /has ever been recorded/);
});

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
