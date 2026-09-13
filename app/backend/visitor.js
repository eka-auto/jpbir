import { list, get, put } from '@vercel/blob';
import { requireKey } from './_auth.js';
import { decodeGeo } from '../lib/geo.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TOKEN = _env['BLOB_' + 'READ_WRITE_TOKEN'];
const RECENT_EVENTS_CAP = 200;
const SCAN_BUDGET_MS = 15000;
const INDEX_BUDGET_MS = 12000;

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

/* ===== per-visitor index (written by track.js at ingest time) ===== */

function indexPathForVisitor(visitorId) {
  return `index/visitor/${encodeURIComponent(visitorId)}.json`;
}

function indexPathForSession(sessionId) {
  return `index/session/${encodeURIComponent(sessionId)}.json`;
}

async function fetchJsonBlob(pathname) {
  const r = await get(pathname, { access: 'private', token: TOKEN });
  if (!r) return null;
  const text = await new Response(r.stream).text();
  try { return JSON.parse(text); } catch { return null; }
}

function projectEvent(d) {
  return {
    event_type: d.event_type,
    page_url: d.page_url,
    page_title: d.page_title,
    // The tracker has always sent the real document.referrer and the UTM set,
    // but this projection dropped them - so the drawer fell back to
    // server_request_meta.referer, which is the Referer of the tracker's own
    // POST to /api/track and therefore always the page itself. That is why
    // every visitor appeared to be a self-referral.
    referrer: d.referrer,
    referrer_hostname: d.referrer_hostname,
    utm: [d.utm_source, d.utm_medium, d.utm_campaign, d.utm_term, d.utm_content].some(Boolean)
      ? { source: d.utm_source, medium: d.utm_medium, campaign: d.utm_campaign, term: d.utm_term, content: d.utm_content }
      : undefined,
    timestamp: d.timestamp,
    receivedAt: d.receivedAt,
    time_on_page: d.time_on_page,
    scroll_percent: d.scroll_percent,
    session_id: d.session_id,
    visitor_id: d.visitor_id,
    device_fingerprint: d.device_fingerprint,
    // Decoded on read: rows written before the ingestion fix still hold
    // percent-encoded geo ("Son%C4%ABpat"), and they cannot be rewritten.
    server_location: decodeGeo(d.server_location),
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
  };
}

function summarize(events, fallbackVisitor) {
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

  return {
    visitor_id: fallbackVisitor || (events[0] && events[0].visitor_id) || null,
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
    // Raw blob rows, not projectEvent output, so decode here or the drawer
    // shows the city decoded in the timeline and encoded in Network & location.
    // Once after the loop, not inside it - only the last row survives anyway.
    network: decodeGeo(latestNetwork),
  };
}

function summaryFromIndex(idx) {
  return {
    visitor_id: idx.visitor_id,
    device_fingerprints: idx.fingerprints || [],
    sessions: idx.sessions || [],
    ips: idx.ips || [],
    countries: Object.entries(idx.countries || {}).sort((a, b) => b[1] - a[1]),
    user_agents: idx.user_agents || [],
    pages: Object.keys(idx.pages || {}),
    first_seen: idx.first_seen || null,
    last_seen: idx.last_seen || null,
    total_events: idx.total_events || 0,
    max_time_on_page: idx.max_time_on_page || 0,
    // The index fast path is the default drawer route, and every blob written
    // before this change holds an encoded network, so decode on the way out
    // rather than needing a backfill.
    network: decodeGeo(idx.network) || null,
  };
}

async function downloadByPathname(refs, budgetMs) {
  const events = [];
  const start = Date.now();
  let i = 0;
  let timedOut = false;
  async function run() {
    while (i < refs.length) {
      if (Date.now() - start > budgetMs) { timedOut = true; return; }
      const idx = i++;
      try {
        const d = await fetchJsonBlob(refs[idx].pathname);
        if (d) events.push(d);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(40, refs.length) }, run));
  return { events, timedOut };
}

async function loadViaIndex({ visitor, session, cutoffIso }) {
  let visitorId = visitor || null;
  let sessionScoped = false;
  if (!visitorId) {
    const pointer = await fetchJsonBlob(indexPathForSession(session)).catch(() => null);
    if (!pointer || !pointer.visitor_id) return null;
    visitorId = pointer.visitor_id;
    sessionScoped = true;
  }
  const idx = await fetchJsonBlob(indexPathForVisitor(visitorId)).catch(() => null);
  if (!idx || idx.visitor_id !== visitorId || !Array.isArray(idx.recent_events)) return null;

  let refs = idx.recent_events.filter(r => r && r.pathname && (!r.receivedAt || r.receivedAt >= cutoffIso));
  if (session) refs = refs.filter(r => r.session_id === session);
  const capped = refs.length >= RECENT_EVENTS_CAP;

  const { events, timedOut } = await downloadByPathname(refs, INDEX_BUDGET_MS);
  events.sort((a, b) => (a.receivedAt || '').localeCompare(b.receivedAt || ''));

  return {
    success: true,
    partial: timedOut || capped,
    source: 'index',
    query: { visitor, session },
    summary: sessionScoped || session ? summarize(events, visitorId) : summaryFromIndex(idx),
    events: events.map(projectEvent),
  };
}

async function writeIndexFromEvents(visitorId, events) {
  const s = summarize(events, visitorId);
  const idx = {
    visitor_id: visitorId,
    first_seen: s.first_seen,
    last_seen: s.last_seen,
    total_events: s.total_events,
    ips: s.ips.slice(0, 25),
    countries: Object.fromEntries(s.countries),
    sessions: s.sessions.slice(0, 50),
    fingerprints: s.device_fingerprints.slice(0, 10),
    user_agents: s.user_agents.slice(0, 25),
    pages: Object.fromEntries(s.pages.slice(0, 100).map(p => [p, 1])),
    max_time_on_page: s.max_time_on_page,
    network: s.network,
    recent_events: events.slice(-RECENT_EVENTS_CAP).map(d => ({
      pathname: `analytics/${d.event_type || 'event'}/${d.eventId}.json`,
      event_type: d.event_type,
      page_url: d.page_url,
      timestamp: d.timestamp,
      receivedAt: d.receivedAt,
      time_on_page: d.time_on_page,
      session_id: d.session_id,
    })),
    updated_at: new Date().toISOString(),
  };
  await put(indexPathForVisitor(visitorId), JSON.stringify(idx), {
    access: 'private',
    contentType: 'application/json',
    token: TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  for (const sid of s.sessions.slice(0, 50)) {
    await put(indexPathForSession(sid), JSON.stringify({ visitor_id: visitorId }), {
      access: 'private',
      contentType: 'application/json',
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  const visitor = req.query.visitor;
  const session = req.query.session;
  if (!visitor && !session) {
    return res.status(400).json({ success: false, error: 'visitor or session required' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const cutoff = Date.now() - days * 86400000;
  const cutoffIso = new Date(cutoff).toISOString();

  try {
    const indexed = await loadViaIndex({ visitor, session, cutoffIso });
    if (indexed) {
      return res.status(200).json(indexed);
    }

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
        if (Date.now() - start > SCAN_BUDGET_MS) { timedOut = true; return; }
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

    // Backfill the per-visitor index so the next lookup takes the fast path.
    if (!timedOut && events.length) {
      const vid = visitor || events[0].visitor_id;
      if (vid) {
        await writeIndexFromEvents(vid, events)
          .catch(err => console.error('[visitor] index backfill failed:', err));
      }
    }

    return res.status(200).json({
      success: true,
      partial: timedOut,
      source: 'scan',
      query: { visitor, session },
      summary: summarize(events, visitor),
      events: events.map(projectEvent),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'visitor lookup failed' });
  }
}
