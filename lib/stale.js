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
