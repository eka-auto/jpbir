// Scheduled S24 sync trigger — Vercel Cron queues a sync-now command for the
// S24 Ultra so the phone daemon picks it up on its next poll. When the daemon
// is offline the command sits in the queue until it comes back; when it is
// online, the next poll processes the command and pushes fresh telemetry.
//
// Auth: Vercel Cron (CRON_SECRET bearer) or dashboard key (STATS_KEY).
//
// ---------------------------------------------------------------------------
// Why this file reads the way it does.
//
// It used to carry its own copy of getFirestoreToken/enc/dec and PATCH with
// `?updateMask.fieldPaths=commandQueue` and a body holding the WHOLE decoded
// map. A bare-field mask makes Firestore replace the entire field, and there
// was no `currentDocument.updateTime` precondition, so it was an unguarded
// lost update: anything written to commandQueue between the read and the PATCH
// was reverted, and any entry created in that window was deleted outright,
// because a whole-map replace drops keys the body does not mention.
//
// That is not theoretical. commandQueue has four concurrent writers — this
// cron, Backend/s24-command.js (the dashboard button), the claim/complete
// broker routes, and the phone daemon writing its own acks. Reverting a
// daemon's completed ack back to `pending` is specifically harmful: the
// daemon's own docstring (Backend/s24_phone_direct_cloud.py:721-724) says a
// pending entry means "the same command re-executes on every poll cycle", so a
// badly timed cron tick makes the phone redo work it had already finished.
//
// Every other writer already avoids this by patching the dotted path
// `commandQueue.<id>`, which puts one entry per key in the update mask. This
// file now does the same, through the shared broker helpers, with an
// updateTime precondition and a single retry — so a genuine collision loses
// the race loudly instead of silently eating an ack.
//
// The second thing it now does is PRUNE. Nothing ever deleted finished entries,
// so the map grew without bound: every tick re-read, re-decoded and re-sent a
// permanently larger document, and the daemon re-scanned it on every poll.
import { fsGet, fsPatch, dec, DELETE_FIELD } from './broker.js';
import { cronAuthorized } from './lib/cron-auth.js';
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];

export const S24_DEVICE_ID = 'samsung-s24-ultra';
export const S24_DEVICE_PATH = `/devices/${S24_DEVICE_ID}`;

// A command the daemon may still act on. Anything in this set blocks a new
// sync-now (queueing a second one would make the phone sync twice) and is
// never pruned, however old it is — an unexecuted command is work outstanding,
// not litter.
export const PENDING_STATUSES = new Set([
  'pending', 'queued', 'requested', 'claimed', 'running', 'in-progress', 'in_progress',
]);

// A command the daemon has finished with, in either direction. Only these are
// eligible for pruning.
export const TERMINAL_STATUSES = new Set([
  'done', 'complete', 'completed', 'success', 'succeeded', 'ok',
  'failed', 'failure', 'error', 'cancelled', 'canceled', 'expired', 'rejected',
]);

// Keep a day of finished commands so an operator debugging "did the 05:23 run
// fire?" can still see it on /db, then drop them.
export const QUEUE_RETENTION_MS = 24 * 60 * 60 * 1000;

// Hard ceiling regardless of age. If terminal entries are arriving faster than
// retention clears them, the oldest go first — the alternative is the unbounded
// growth this exists to stop.
export const MAX_TERMINAL_ENTRIES = 40;

// Firestore caps an update mask at 100 field paths. Stay well under it: the new
// command plus prunes must fit in one atomic PATCH, because two PATCHes would
// reintroduce a window where the queue is half-written.
export const MAX_PRUNES_PER_TICK = 50;

function statusOf(entry) {
  return String((entry && entry.status) || '').trim().toLowerCase();
}

function timestampOf(entry) {
  const raw = entry && (entry.completedAt || entry.ackedAt || entry.requestedAt);
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide what this tick should write, given the queue as it was just read.
 *
 * Pure on purpose. The IO around it needs a live Firestore and a service
 * account; the decisions — skip or queue, prune what, cap at what — are the
 * part that can actually be wrong, so they are separated out and driven
 * directly by _shared/tests/s24-sync-cron.test.mjs. Same reasoning as
 * verifyPostgres(q, configured) in Backend/verify-db.js.
 *
 * @param {object} commandQueue decoded commandQueue map (id -> entry)
 * @param {number} nowMs        wall clock for this tick
 * @param {string} commandId    id to use for the new sync-now entry
 * @returns {{skip: boolean, reason: string, writes: object, prunedIds: string[],
 *            pendingIds: string[], queueDepth: number}}
 */
export function planSyncTick(commandQueue, nowMs, commandId) {
  const cq = commandQueue && typeof commandQueue === 'object' ? commandQueue : {};
  const entries = Object.entries(cq);

  const pendingIds = entries
    .filter(([, e]) => PENDING_STATUSES.has(statusOf(e)))
    .map(([id]) => id);

  // Prune candidates: terminal only, oldest first. An entry with an
  // unparseable timestamp sorts oldest — it is malformed and carries no
  // debugging value, so it is the first thing to go rather than the last.
  const terminal = entries
    .filter(([, e]) => TERMINAL_STATUSES.has(statusOf(e)))
    .map(([id, e]) => ({ id, at: timestampOf(e) }))
    .sort((a, b) => (a.at === null ? -1 : b.at === null ? 1 : a.at - b.at));

  const tooOld = terminal.filter((t) => t.at === null || nowMs - t.at > QUEUE_RETENTION_MS);
  const overflow = terminal.slice(0, Math.max(0, terminal.length - MAX_TERMINAL_ENTRIES));
  const prunedIds = [...new Set([...tooOld, ...overflow].map((t) => t.id))].slice(0, MAX_PRUNES_PER_TICK);

  const writes = {};
  for (const id of prunedIds) writes[`commandQueue.${id}`] = DELETE_FIELD;

  // A sync-now already waiting means the phone has not drained the last one.
  // Queueing another would make it sync twice for one missed poll. Still emit
  // the prune — housekeeping is not conditional on there being new work.
  const blocking = entries.filter(
    ([, e]) => String((e && e.action) || '') === 'sync-now' && PENDING_STATUSES.has(statusOf(e))
  );
  if (blocking.length > 0) {
    return {
      skip: true,
      reason: 'pending sync-now already in queue',
      writes,
      prunedIds,
      pendingIds,
      queueDepth: entries.length - prunedIds.length,
    };
  }

  writes[`commandQueue.${commandId}`] = {
    action: 'sync-now',
    status: 'pending',
    requestedAt: new Date(nowMs).toISOString(),
    requestedBy: 'vercel-cron-s24-sync',
    source: 'scheduled-sync',
  };

  return {
    skip: false,
    reason: '',
    writes,
    prunedIds,
    pendingIds,
    queueDepth: entries.length - prunedIds.length + 1,
  };
}

/**
 * The ack the phone last wrote back, surfaced so a tick is not blind.
 *
 * Queued is not executed — that is the standing constraint of this
 * architecture, since nothing cloud-side can reach the device. The cron cannot
 * make the phone run anything, but it CAN report whether the previous command
 * was ever acknowledged, which is the difference between "the schedule is
 * healthy" and "we have been queueing into a dead mailbox for two days".
 */
export function summarizeAck(fields, nowMs) {
  const id = fields.lastCommandAckId || null;
  const status = fields.lastCommandAckStatus || null;
  const at = fields.lastCommandAckAt || fields.lastSeen || null;
  const parsed = at ? Date.parse(at) : NaN;
  const ageSeconds = Number.isFinite(parsed) ? Math.round((nowMs - parsed) / 1000) : null;
  return { id, status, at, ageSeconds };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAuthorized(req) && !requireKey(req, res)) return;
  // 503, not 500: an unconfigured deployment is not a bug in this handler, and
  // Backend/_auth.js already draws that line so an operator can tell "nothing
  // is set up here" from "something threw". Frontend/db.html keys off it.
  if (!FIREBASE_SA_JSON) {
    return res.status(503).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  try {
    const nowMs = Date.now();
    let attempt = 0;
    let lastConflict = null;

    // Two attempts. A precondition conflict means a real concurrent writer
    // landed between our read and our write; re-reading and replanning is
    // correct because the plan depends on the queue we just lost sight of.
    // Two is enough: a third collision inside one tick means the queue is
    // being hammered, and the next scheduled tick is six hours of slack away.
    while (attempt < 2) {
      attempt += 1;
      const doc = await fsGet(S24_DEVICE_PATH);
      if (!doc) {
        return res.status(404).json({ success: false, error: `device document ${S24_DEVICE_ID} not found` });
      }

      const fields = {};
      for (const [k, v] of Object.entries(doc.fields || {})) fields[k] = dec(v);

      const commandId = `cron_sync_${nowMs}_${attempt}`;
      const plan = planSyncTick(fields.commandQueue, nowMs, commandId);
      const ack = summarizeAck(fields, nowMs);

      if (Object.keys(plan.writes).length === 0) {
        return res.status(200).json({
          success: true, action: 'skipped', reason: plan.reason || 'nothing to do',
          pruned: 0, queueDepth: plan.queueDepth, pendingCommands: plan.pendingIds.length, lastAck: ack,
        });
      }

      try {
        await fsPatch(S24_DEVICE_PATH, plan.writes, { updateTime: doc.updateTime });
      } catch (err) {
        if (err && err.conflict && attempt < 2) { lastConflict = err; continue; }
        throw err;
      }

      return res.status(200).json({
        success: true,
        action: plan.skip ? 'skipped' : 'queued',
        reason: plan.reason || undefined,
        commandId: plan.skip ? undefined : commandId,
        requestedAt: new Date(nowMs).toISOString(),
        pruned: plan.prunedIds.length,
        queueDepth: plan.queueDepth,
        pendingCommands: plan.pendingIds.length,
        attempts: attempt,
        lastAck: ack,
      });
    }

    // Both attempts lost the race. Report it rather than pretending success:
    // a 409 here is the signal that something else is writing the queue hard.
    return res.status(409).json({
      success: false,
      error: 'commandQueue changed under us twice; no command queued',
      detail: lastConflict ? lastConflict.message : undefined,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 's24-sync-cron failed' });
  }
}
