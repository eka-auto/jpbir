import { list } from '@vercel/blob';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TOKEN = _env['BLOB_' + 'READ_WRITE_TOKEN'];
async function listAll(prefix) {
  let cursor;
  const out = [];
  let page = 0;
  do {
    const opts = { token: TOKEN, limit: 1000, prefix };
    if (cursor) opts.cursor = cursor;
    const res = await list(opts);
    out.push(...res.blobs);
    cursor = res.cursor;
    if (++page > 200) break;
  } while (cursor);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const visitor = req.query.visitor;
  const session = req.query.session;
  if (!visitor && !session) {
    return res.status(400).json({ success: false, error: 'visitor or session required' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const cutoff = Date.now() - days * 86400000;

  try {
    const blobs = await listAll('analytics/');
    const inWindow = blobs
      .filter(b => b.uploadedAt && b.uploadedAt.getTime() >= cutoff)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    const events = [];
    const start = Date.now();
    let i = 0;
    let timedOut = false;
    async function run() {
      while (i < inWindow.length) {
        if (Date.now() - start > 15000) { timedOut = true; return; }
        const idx = i++;
        try {
          const r = await fetch(inWindow[idx].url, { headers: { authorization: `Bearer ${TOKEN}` } });
          if (!r.ok) continue;
          const d = await r.json();
          if ((visitor && d.visitor_id === visitor) || (session && d.session_id === session)) {
            events.push(d);
          }
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(40, inWindow.length) }, run));

    events.sort((a, b) => (a.receivedAt || '').localeCompare(b.receivedAt || ''));

    const ips = new Set();
    const countries = {};
    const sessions = new Set();
    const fingerprints = new Set();
    const uas = new Set();
    const pages = new Set();
    let first = null;
    let last = null;
    let maxTimeOnPage = 0;
    let latestNetwork = null;

    for (const d of events) {
      const ip = d.server_location && d.server_location.ip;
      if (ip) ips.add(ip);
      const c = d.server_location && d.server_location.country;
      if (c) countries[c] = (countries[c] || 0) + 1;
      if (d.session_id) sessions.add(d.session_id);
      if (d.device_fingerprint) fingerprints.add(d.device_fingerprint);
      const ua = d.server_request_meta && d.server_request_meta.userAgent;
      if (ua) uas.add(ua);
      if (d.page_url) pages.add(d.page_url);
      if (typeof d.time_on_page === 'number' && d.time_on_page > maxTimeOnPage) maxTimeOnPage = d.time_on_page;
      if (d.receivedAt) {
        if (!first || d.receivedAt < first) first = d.receivedAt;
        if (!last || d.receivedAt > last) last = d.receivedAt;
        latestNetwork = d.server_location || latestNetwork;
      }
    }

    return res.status(200).json({
      success: true,
      partial: timedOut,
      query: { visitor, session },
      summary: {
        visitor_id: visitor || (events[0] && events[0].visitor_id) || null,
        device_fingerprints: [...fingerprints],
        sessions: [...sessions],
        ips: [...ips],
        countries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
        user_agents: [...uas],
        pages: [...pages],
        first_seen: first,
        last_seen: last,
        total_events: events.length,
        max_time_on_page: maxTimeOnPage,
        network: latestNetwork,
      },
      events: events.map(d => ({
        event_type: d.event_type,
        page_url: d.page_url,
        timestamp: d.timestamp,
        receivedAt: d.receivedAt,
        time_on_page: d.time_on_page,
        scroll_percent: d.scroll_percent,
        session_id: d.session_id,
        visitor_id: d.visitor_id,
        device_fingerprint: d.device_fingerprint,
        server_location: d.server_location,
        server_request_meta: d.server_request_meta,
        ua_client_hints: d.ua_client_hints,
        storage_estimate: d.storage_estimate,
        refresh_rate: d.refresh_rate,
        frame_rate: d.frame_rate,
        memory_info: d.memory_info,
        input_type: d.input_type,
        pwa_state: d.pwa_state,
        advanced_capabilities: d.advanced_capabilities,
        network_info: d.network_info,
        browser_info: d.browser_info,
        screen_info: d.screen_info,
        battery_info: d.battery_info,
        web_vitals: d.event_type === 'web_vitals' ? {
          lcp: d.lcp, cls: d.cls, inp: d.inp, fid: d.fid, ttfb: d.ttfb, reason: d.reason
        } : undefined,
        interactions: d.interactions,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'visitor lookup failed' });
  }
}
