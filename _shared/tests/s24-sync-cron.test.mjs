// The scheduled sync tick had no test at all, which is how it kept a
// whole-map commandQueue replace for as long as it did.
//
// The bug it shipped with: `?updateMask.fieldPaths=commandQueue` plus a body
// carrying the entire decoded map, and no updateTime precondition. Firestore
// treats a bare-field mask as "replace this field", so every tick reverted any
// concurrent write and DELETED any entry created since its read. The phone
// daemon writes its own acks into that same map, and its docstring
// (Backend/s24_phone_direct_cloud.py:721-724) is explicit that an entry left
// `pending` re-executes on every poll — so a badly timed tick made the phone
// redo finished work.
//
// These assertions are the contract that stops it coming back:
//   - one dotted field path per entry, never the bare `commandQueue`
//   - a deletion names the path in the mask and omits it from the body
//   - a pending sync-now blocks a duplicate, pending entries are never pruned
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}
async function ta(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const {
  planSyncTick, summarizeAck,
  PENDING_STATUSES, TERMINAL_STATUSES, QUEUE_RETENTION_MS, MAX_TERMINAL_ENTRIES,
} = await import('../../Backend/s24-sync-cron.js');
const { DELETE_FIELD } = await import('../../Backend/broker.js');

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

// ── what the tick decides ───────────────────────────────────────────────

t('a sync-now the phone has not drained blocks a second one, so one missed poll cannot cause two syncs', () => {
  const plan = planSyncTick(
    { old1: { action: 'sync-now', status: 'pending', requestedAt: ago(7 * HOUR) } },
    NOW, 'new_id'
  );
  assert.equal(plan.skip, true);
  assert.match(plan.reason, /pending sync-now/);
  assert.equal(Object.keys(plan.writes).some((k) => k.endsWith('new_id')), false, 'must not queue a duplicate');
});

t('a command already claimed or running blocks too — only a terminal status frees the slot', () => {
  for (const status of ['claimed', 'running', 'in-progress', 'queued', 'requested']) {
    const plan = planSyncTick({ x: { action: 'sync-now', status } }, NOW, 'new_id');
    assert.equal(plan.skip, true, `status ${status} should block`);
  }
  for (const status of ['completed', 'failed', 'expired']) {
    const plan = planSyncTick({ x: { action: 'sync-now', status, requestedAt: ago(1 * HOUR) } }, NOW, 'new_id');
    assert.equal(plan.skip, false, `status ${status} should not block`);
  }
});

t('the new command is written as one dotted field path, never as a replacement of the whole commandQueue map', () => {
  const plan = planSyncTick({ keep: { action: 'heartbeat', status: 'pending' } }, NOW, 'cron_sync_1');
  const paths = Object.keys(plan.writes);
  assert.ok(paths.includes('commandQueue.cron_sync_1'), 'expected the dotted path');
  assert.equal(paths.includes('commandQueue'), false, 'a bare commandQueue path replaces the entire map');
  for (const p of paths) assert.match(p, /^commandQueue\.[^.]+$/, `unexpected write path ${p}`);
});

t('the queued entry carries the cron as its author, so an operator can tell a scheduled sync from a button press', () => {
  const plan = planSyncTick({}, NOW, 'cron_sync_1');
  const entry = plan.writes['commandQueue.cron_sync_1'];
  assert.equal(entry.action, 'sync-now');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.requestedBy, 'vercel-cron-s24-sync');
  assert.equal(entry.source, 'scheduled-sync');
  assert.equal(entry.requestedAt, new Date(NOW).toISOString());
});

// ── pruning: the queue used to grow without bound ───────────────────────

t('finished commands older than the retention window are deleted, and the deletion uses the sentinel not a null write', () => {
  const plan = planSyncTick({
    stale: { action: 'sync-now', status: 'completed', completedAt: ago(QUEUE_RETENTION_MS + HOUR) },
    fresh: { action: 'sync-now', status: 'completed', completedAt: ago(HOUR) },
  }, NOW, 'new_id');
  assert.deepEqual(plan.prunedIds, ['stale']);
  assert.equal(plan.writes['commandQueue.stale'], DELETE_FIELD);
  assert.equal('commandQueue.fresh' in plan.writes, false, 'a recent finished command is still useful for debugging');
});

t('a pending command is never pruned however old it is — an unexecuted command is outstanding work, not litter', () => {
  const plan = planSyncTick({
    ancient: { action: 'wakeup', status: 'pending', requestedAt: ago(90 * 24 * HOUR) },
  }, NOW, 'new_id');
  assert.deepEqual(plan.prunedIds, []);
  assert.deepEqual(plan.pendingIds, ['ancient']);
});

t('a finished command with an unparseable timestamp is pruned first, not kept forever', () => {
  const plan = planSyncTick({
    broken: { action: 'sync-now', status: 'completed', completedAt: 'not-a-date' },
    dated: { action: 'sync-now', status: 'completed', completedAt: ago(HOUR) },
  }, NOW, 'new_id');
  assert.deepEqual(plan.prunedIds, ['broken']);
});

t('the terminal-entry ceiling drops the oldest first when retention alone is not keeping up', () => {
  const cq = {};
  for (let i = 0; i < MAX_TERMINAL_ENTRIES + 5; i++) {
    cq[`c${String(i).padStart(3, '0')}`] = { action: 'sync-now', status: 'completed', completedAt: ago(i * 60_000) };
  }
  const plan = planSyncTick(cq, NOW, 'new_id');
  assert.equal(plan.prunedIds.length, 5, 'exactly the overflow should go');
  // ago(i*60s) means a HIGHER index is OLDER, so the last five ids are the oldest.
  assert.deepEqual(plan.prunedIds.sort(), ['c040', 'c041', 'c042', 'c043', 'c044']);
});

t('housekeeping still runs on a skipped tick — a blocked queue is exactly when it must not also stop pruning', () => {
  const plan = planSyncTick({
    blocker: { action: 'sync-now', status: 'pending', requestedAt: ago(HOUR) },
    stale: { action: 'wakeup', status: 'completed', completedAt: ago(QUEUE_RETENTION_MS + HOUR) },
  }, NOW, 'new_id');
  assert.equal(plan.skip, true);
  assert.deepEqual(plan.prunedIds, ['stale']);
  assert.equal(plan.writes['commandQueue.stale'], DELETE_FIELD);
});

t('an empty or absent queue is a normal first run, not a crash', () => {
  for (const empty of [undefined, null, {}, 'nonsense', 42]) {
    const plan = planSyncTick(empty, NOW, 'new_id');
    assert.equal(plan.skip, false);
    assert.ok(plan.writes['commandQueue.new_id']);
  }
});

t('status matching is case- and whitespace-insensitive, because four different writers produce these strings', () => {
  const plan = planSyncTick({ x: { action: 'sync-now', status: '  PENDING ' } }, NOW, 'new_id');
  assert.equal(plan.skip, true, 'a differently-cased pending must still block');
  assert.equal(PENDING_STATUSES.has('pending'), true);
  assert.equal(TERMINAL_STATUSES.has('completed'), true);
  assert.equal([...PENDING_STATUSES].some((s) => TERMINAL_STATUSES.has(s)), false,
    'a status that is both pending and terminal would make pruning eat live work');
});

// ── the ack the phone writes back ───────────────────────────────────────

t('the tick reports the last ack, because queued is not executed and a dead mailbox must be visible', () => {
  const ack = summarizeAck({
    lastCommandAckId: 'cron_sync_123',
    lastCommandAckStatus: 'completed',
    lastCommandAckAt: ago(2 * HOUR),
  }, NOW);
  assert.equal(ack.id, 'cron_sync_123');
  assert.equal(ack.status, 'completed');
  assert.equal(ack.ageSeconds, 7200);
});

t('a device that has never acked reports null rather than a fabricated age', () => {
  const ack = summarizeAck({}, NOW);
  assert.deepEqual(ack, { id: null, status: null, at: null, ageSeconds: null });
});

// ── the wire format: mask names a deletion, body omits it ───────────────

await ta('fsPatch quotes hyphenated command IDs while preserving Firestore delete semantics', async () => {
  // A real RSA key and a real signed assertion: the point is to drive the
  // actual fsPatch code path, not a reimplementation of it.
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'test-project',
    client_email: 'test@example.invalid',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  process.env.FIRESTORE_DB = 'eka-agent';

  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tkn', expires_in: 3600 }), { status: 200 });
    }
    seen.push({ url: u, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ name: 'doc' }), { status: 200 });
  };

  try {
    // Fresh module instance so the token cache and env are the ones set above.
    const broker = await import('../../Backend/broker.js?fsPatchDeleteCase');
    await broker.fsPatch('/devices/samsung-s24-ultra', {
      'commandQueue.sync-now_123': { action: 'sync-now', status: 'pending' },
      'commandQueue.550e8400-e29b-41d4-a716-446655440000': broker.DELETE_FIELD,
    }, { updateTime: '2026-09-20T11:59:00.000000Z' });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(seen.length, 1, 'expected exactly one PATCH');
  const { url, body } = seen[0];
  assert.ok(url.includes('updateMask.fieldPaths=commandQueue.%60sync-now_123%60'),
    'hyphenated written path must be quoted in the mask');
  assert.ok(url.includes('updateMask.fieldPaths=commandQueue.%60550e8400-e29b-41d4-a716-446655440000%60'),
    'hyphenated DELETED path must also be quoted in the mask');
  assert.ok(url.includes('currentDocument.updateTime='), 'the precondition must be on the wire');
  const queue = body.fields.commandQueue.mapValue.fields;
  assert.ok(queue['sync-now_123'], 'the written entry belongs in the body');
  assert.equal('550e8400-e29b-41d4-a716-446655440000' in queue, false,
    'the deleted entry must NOT be in the body — that is what makes it a delete');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
