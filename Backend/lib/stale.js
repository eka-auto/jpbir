/**
 * Pure staleness evaluator — no I/O, unit-tested independently of the endpoint.
 *
 * device: { lastSeen: ISO string | null, staleAlertState: 'healthy'|'alerted'|undefined }
 * Returns { action: 'none'|'down'|'recovered', newState: 'healthy'|'alerted'|null, changed: bool }.
 *
 * - A device with no (or unparseable) lastSeen is skipped: a never-seen device
 *   isn't "stale", which is what keeps the offline S24 from alerting until it
 *   actually starts heartbeating.
 * - Edge-triggered: only healthy<->alerted transitions produce an action, so
 *   nothing re-emails while the state is unchanged.
 */
export function evaluate(device, nowMs, thresholdMs) {
  const lastSeen = device && device.lastSeen;
  if (!lastSeen) return { action: 'none', newState: null, changed: false };
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return { action: 'none', newState: null, changed: false };
  const stale = nowMs - t > thresholdMs;
  const prev = device.staleAlertState === 'alerted' ? 'alerted' : 'healthy';
  if (stale && prev === 'healthy') return { action: 'down', newState: 'alerted', changed: true };
  if (!stale && prev === 'alerted') return { action: 'recovered', newState: 'healthy', changed: true };
  return { action: 'none', newState: prev, changed: false };
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
