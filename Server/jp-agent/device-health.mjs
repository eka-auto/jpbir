// Keep S24 liveness consistent with s24-connect-mcp/server.py.
//
// That file lives OUTSIDE this repo (C:\Users\abcom\s24-connect-mcp\server.py), so
// it cannot be aligned from here. It still accepts only the s24-termux- prefix,
// which the collector shipped to the phone does not write — see
// S24_AGENT_VERSION_PREFIXES in Backend/jp-devices.js for the full story. Until
// it is updated, the MCP's device_ping will call a genuinely live S24
// unauthenticated while this module and the dashboard judge it correctly.
// Devices/S24/pull_direct_cloud.py:76 has the same stale prefix check and is
// inside a pinned bundle, so it is deliberately left alone.
const S24_AGENT_VERSION_PREFIXES = ['s24-termux-', 's24-direct-cloud-'];

export function deviceHealth(deviceId, doc, now = Date.now()) {
  const age = value => {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.round((now - timestamp) / 1000) : null;
  };
  const lastSeenAge = age(doc.lastSeen);
  const ackAge = age(doc.lastCommandAckAt);
  const fresh = value => value !== null && value >= 0 && value <= 300;
  const sync = doc.samsungS24DirectSync || {};
  const ack = doc.commandQueue?.[doc.lastCommandAckId];
  const agentVersion = String(doc.agentVersion || '');
  const authenticated = doc.online === true && fresh(lastSeenAge)
    && S24_AGENT_VERSION_PREFIXES.some(p => agentVersion.startsWith(p))
    && ['termux-direct-cloud', 'direct-daemon'].includes(doc.connectionMethod)
    && doc.heartbeatAuth === 'termux-phone'
    && sync.liveDeviceVerified === true && sync.heartbeatAuth === 'termux-phone'
    && ['live_termux', 'live_daemon'].includes(sync.sourceType)
    && ((doc.lastCommandAckStatus === 'completed' && ack?.status === 'completed'
      && ack.completedAt === doc.lastCommandAckAt && fresh(ackAge))
      || ackAge === null);
  return {
    device_online: deviceId === 'samsung-s24-ultra' ? authenticated
      : Boolean(doc.online || doc.effectiveOnline) && fresh(lastSeenAge),
    heartbeat_authenticated: deviceId === 'samsung-s24-ultra' ? authenticated : false,
    stored_online: Boolean(doc.online || doc.effectiveOnline),
    last_command_ack_at: doc.lastCommandAckAt ?? null,
    last_command_ack_age_seconds: ackAge,
    freshness_window_seconds: 300,
  };
}

export function commandItem(action, priority, params, requestedAt) {
  // Extra parameters must never forge a completed command or change its action.
  const reserved = ['action', 'status', 'priority', 'requestedAt', 'requestedBy',
    'source', 'completedAt', 'ackAt', 'claimedAt', 'processedAt', 'result'];
  for (const key of reserved) {
    if (Object.hasOwn(params, key)) throw new Error(`Reserved command parameter: ${key}`);
  }
  return { ...params, action, status: 'pending', priority, requestedAt,
    requestedBy: 'jp-agent-s24-tools', source: 'commandQueue' };
}
