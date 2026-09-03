// Unit tests for the pure staleness evaluator. Run: node test/stale.test.mjs
import { evaluate } from '../../lib/stale.js';
import assert from 'assert';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const THRESH = 600 * 1000; // 10 min
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

let pass = 0;
function t(name, fn) {
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

console.log(`\n${pass}/8 passed`);
