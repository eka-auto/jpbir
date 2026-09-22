/**
 * Pure staleness evaluator — no I/O, unit-tested independently of the endpoint.
 *
 * device: {
 *   lastSeen: ISO string | null,
 *   staleAlertState: 'healthy'|'alerted'|undefined,
 *   staleAlertNotifiedAt: ISO string | undefined,  // when we last emailed
 *   enrolledAt: ISO string | undefined,            // doc.createTime, for never-seen
 * }
 * opts: { reminderMs?: number }  // 0/absent = edge-triggered only (no reminders)
 * Returns { action: 'none'|'down'|'never-seen'|'reminder'|'recovered',
 *           newState: 'healthy'|'alerted'|null, changed: bool }.
 *   - changed=true means the stored state string flipped (patch it).
 *   - a 'reminder' notifies WITHOUT changing state (changed=false).
 *   - the caller emails on any action other than 'none'.
 *
 * Two behaviours were missing and are the reason a dead fleet went unnoticed
 * for ~8 days:
 *
 * - never-seen. A device with no lastSeen used to be skipped outright ("a
 *   never-seen device isn't stale"), which meant `jayti-asus-vivobook` —
 *   enrolled and never once heartbeating — was invisible forever. It is now
 *   `never-seen` (a down variant) ONCE it has been enrolled longer than the
 *   threshold. Before that it is genuinely new, not down; and with no
 *   enrolment time at all we still cannot tell the two apart, so we skip
 *   exactly as before.
 * - reminders. Alerting was a single edge trigger: one email on
 *   healthy→alerted, then silence for a week. With a reminder window a daily
 *   nudge fires while a device stays down, so the anti-spam intent (not every
 *   10-minute tick) is kept without the outage being forgotten after one mail.
 */
export function evaluate(device, nowMs, thresholdMs, opts = {}) {
  const d = device || {};
  const reminderMs = Number(opts.reminderMs) > 0 ? Number(opts.reminderMs) : 0;
  const prev = d.staleAlertState === 'alerted' ? 'alerted' : 'healthy';

  let down = false;
  let neverSeen = false;
  const t = Date.parse(d.lastSeen);
  if (Number.isFinite(t)) {
    down = nowMs - t > thresholdMs;
  } else {
    const enrolled = Date.parse(d.enrolledAt);
    if (Number.isFinite(enrolled) && nowMs - enrolled > thresholdMs) {
      down = true;
      neverSeen = true;
    } else {
      // Unjudgeable (never seen and either just enrolled or no enrolment time).
      // Preserve the old skip contract: newState null when we have never
      // alerted, so nothing is written and no email goes out.
      return { action: 'none', newState: prev === 'alerted' ? 'alerted' : null, changed: false };
    }
  }

  if (down && prev === 'healthy') {
    return { action: neverSeen ? 'never-seen' : 'down', newState: 'alerted', changed: true };
  }
  if (down && prev === 'alerted') {
    if (reminderMs) {
      const last = Date.parse(d.staleAlertNotifiedAt);
      if (!Number.isFinite(last) || nowMs - last > reminderMs) {
        return { action: 'reminder', newState: 'alerted', changed: false };
      }
    }
    return { action: 'none', newState: 'alerted', changed: false };
  }
  if (!down && prev === 'alerted') {
    return { action: 'recovered', newState: 'healthy', changed: true };
  }
  return { action: 'none', newState: 'healthy', changed: false };
}

/**
 * Pure freshness evaluator for the S24 EXPORT PIPELINE, as distinct from the
 * device.
 *
 * `evaluate` above answers "is the phone heartbeating?". It cannot answer "is
 * the archive still being filled?", and those fail independently: the daemon
 * can heartbeat happily while the Firestore-export -> signed-push half
 * (pull_direct_cloud.py | push_to_vercel.py, driven by
 * .github/workflows/s24-export-sync.yml) has been failing for days. Nothing
 * watched that half, so a broken export was only ever noticed by a human
 * looking at /db and thinking the numbers looked old.
 *
 * Two distinct failures, because they need different responses:
 *
 *   stale   — no run has STARTED recently. The scheduler is not firing, or the
 *             job dies before it can register a run. Look at GitHub Actions.
 *   stuck   — a run registered and never reached upload_status 'complete'.
 *             The ingest endpoint accepted the manifest and then the upload
 *             died partway. Look at /api/s24-ingest and the run's own row.
 *
 * @param {{newestStartedAt: string|null, stuckCount: number, stuckOldestStartedAt: string|null}} snapshot
 * @param {number} nowMs
 * @param {{maxAgeMs: number, stuckMs: number}} thresholds
 * @returns {{ok: boolean, problems: string[], newestAgeSeconds: number|null, stuckCount: number}}
 */
export function evaluateSyncPipeline(snapshot, nowMs, thresholds) {
  const s = snapshot || {};
  const problems = [];

  const parsed = s.newestStartedAt ? Date.parse(s.newestStartedAt) : NaN;
  const newestAgeSeconds = Number.isFinite(parsed) ? Math.round((nowMs - parsed) / 1000) : null;

  if (!s.newestStartedAt) {
    // No run has EVER landed. Distinct from "the last one is old": this is a
    // pipeline that has never worked, not one that stopped, and it must not be
    // reported as fresh just because there is no age to compare.
    problems.push('no s24 sync run has ever been recorded');
  } else if (!Number.isFinite(parsed)) {
    problems.push(`newest s24 sync run has an unparseable started_at (${String(s.newestStartedAt).slice(0, 40)})`);
  } else if (nowMs - parsed > thresholds.maxAgeMs) {
    const hours = Math.round((nowMs - parsed) / 3600_000);
    problems.push(`newest s24 sync run started ${hours}h ago, past the ${Math.round(thresholds.maxAgeMs / 3600_000)}h threshold`);
  }

  const stuckCount = Number(s.stuckCount) || 0;
  if (stuckCount > 0) {
    const detail = s.stuckOldestStartedAt ? `, oldest started ${s.stuckOldestStartedAt}` : '';
    problems.push(`${stuckCount} s24 sync run(s) stuck in upload_status 'uploading' for over ${Math.round(thresholds.stuckMs / 3600_000)}h${detail}`);
  }

  return { ok: problems.length === 0, problems, newestAgeSeconds, stuckCount };
}
