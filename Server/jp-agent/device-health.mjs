// Keep S24 liveness consistent with s24-connect-mcp/server.py.
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
  const authenticated = doc.online === true && fresh(lastSeenAge)
    && String(doc.agentVersion || '').startsWith('s24-termux-')
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
