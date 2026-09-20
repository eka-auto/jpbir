import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { scanBounded } from './lib/ddb-scan.js';
import { decodeGeo } from './lib/geo.js';
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

// The bounded scan this file introduced now lives in lib/ddb-scan.js, so
// jp-stats, jp-device and jp-agent -- which each carried an UNBOUNDED copy of
// the same loop -- share one implementation instead of three that can drift.
async function scanAll(client, extra) {
  return scanBounded(client, TABLE, extra);
}

/**
 * Lift the tracker's telemetry sub-objects out of `eventData` to the top level.
 *
 * Mirrors the field set Backend/visitor.js:89-101 emits, so the dashboard's one
 * drawer renderer sees the same shape from both endpoints. Unknown keys are not
 * spread wholesale: an allowlist keeps a tracker change from silently widening
 * this response, which is a PII surface behind requireKey.
 */
const TELEMETRY_FIELDS = [
  'browser_info', 'network_info', 'screen_info', 'battery_info', 'input_type',
  'memory_info', 'storage_estimate', 'refresh_rate', 'frame_rate',
  'pwa_state', 'advanced_capabilities', 'interactions',
];

function projectTelemetry(eventData) {
  if (!eventData || typeof eventData !== 'object') return {};
  const out = {};
  for (const k of TELEMETRY_FIELDS) {
    if (eventData[k] !== undefined) out[k] = eventData[k];
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Same dossier as /api/visitor - IP, fingerprint, user agent, geolocation and
  // the full interaction trail - so it needs the same gate. The dashboard has
  // always sent ?key= for both endpoints and already renders the 401 inside the
  // drawer, so this is a server-side gap only.
  if (!requireKey(req, res)) return;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(503).json({ success: false, error: 'AWS credentials not configured' });
  }

  const visitor = req.query.visitor;
  const session = req.query.session;
  if (!visitor && !session) {
    return res.status(400).json({ success: false, error: 'visitor or session required' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const cutoff = Date.now() - days * 86400000;

  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));

    // Keep the epoch window server-side alongside the id match. DynamoDB
    // compares across types as never-equal, so a bare `#epoch >= :cutoff` would
    // silently drop a row that stored epoch as a String; the attribute_type arm
    // lets those through to the JS filter below instead of losing them. Pushing
    // the window down matters: jp-track writes Number epochs, so for a visitor
    // with years of history this is the difference between returning the 30-day
    // window and returning everything and discarding it in the function - which
    // burns the scan budget and makes a `partial` truncation far likelier.
    const names = { '#epoch': 'epoch' };
    const values = { ':cutoff': cutoff, ':stringType': 'S' };
    const idMatch = [];
    if (visitor) { names['#visitorId'] = 'visitorId'; values[':visitor'] = visitor; idMatch.push('#visitorId = :visitor'); }
    if (session) { names['#sessionId'] = 'sessionId'; values[':session'] = session; idMatch.push('#sessionId = :session'); }
    const scan = await scanAll(client, {
      FilterExpression: `(#epoch >= :cutoff OR attribute_type(#epoch, :stringType)) AND (${idMatch.join(' OR ')})`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    });
    // Second pass in JS: coerces the String-typed stragglers the filter let by.
    const events = scan.items.filter(i => i.epoch && Number(i.epoch) >= cutoff);

    events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

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
      if (d.ip) ips.add(d.ip);
      if (d.country) countries[d.country] = (countries[d.country] || 0) + 1;
      if (d.sessionId) sessions.add(d.sessionId);
      if (d.fingerprint) fingerprints.add(d.fingerprint);
      if (d.userAgent) uas.add(d.userAgent);
      if (d.pageUrl) pages.add(d.pageUrl);
      if (typeof d.timeOnPage === 'number' && d.timeOnPage > maxTimeOnPage) maxTimeOnPage = d.timeOnPage;
      if (d.timestamp) {
        if (!first || d.timestamp < first) first = d.timestamp;
        if (!last || d.timestamp > last) last = d.timestamp;
        // Needs the same decode the event projection gets, or the drawer shows
        // the city decoded in the timeline and encoded in Network & location.
        // The panel reads `countryRegion` (index.html), not `region`, so name
        // it that here too - as `region` it rendered blank for every visitor.
        latestNetwork = decodeGeo({
          ip: d.ip, country: d.country, countryRegion: d.region, city: d.city,
          latitude: d.latitude, longitude: d.longitude, timezone: d.timezone,
          postalCode: d.postalCode
        });
      }
    }

    return res.status(200).json({
      success: true,
      source: 'dynamodb',
      // The scan can stop on either limit, and the drawer states an IP and
      // network count. Without this flag it would state a truncated count as
      // fact - visitor.js returns the same signal for the same reason.
      partial: scan.truncated,
      query: { visitor, session },
      summary: {
        visitor_id: visitor || (events[0] && events[0].visitorId) || null,
        device_fingerprints: [...fingerprints],
        sessions: [...sessions],
        ips: [...ips],
        ips_truncated: false,   // this endpoint never slices the address list

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
        event_type: d.eventType,
        page_url: d.pageUrl,
        timestamp: d.timestamp,
        receivedAt: d.timestamp,
        time_on_page: d.timeOnPage,
        scroll_percent: d.scrollPercent,
        session_id: d.sessionId,
        visitor_id: d.visitorId,
        device_fingerprint: d.fingerprint,
        // jp-track stores the `x-vercel-ip-*` headers verbatim, so these are
        // percent-encoded on the way in and need the same read-side decode the
        // blob-backed /api/visitor applies.
        server_location: decodeGeo({
          ip: d.ip, country: d.country, countryRegion: d.region, city: d.city,
          latitude: d.latitude, longitude: d.longitude, timezone: d.timezone
        }),
        server_request_meta: { userAgent: d.userAgent, referer: d.referrer },
        event_data: d.eventData,
        // The drawer's "Device & network" and "Device probe" panels read these
        // off the EVENT, because that is the shape /api/visitor returns
        // (Backend/visitor.js:89-101). jp-track stores the tracker's whole
        // payload under `eventData` instead, so on the jp side every one of
        // them was undefined and both panels rendered as a grid of dashes --
        // not an error, just silently empty, on data that was present the whole
        // time one level down.
        //
        // Projected here rather than taught to the frontend: Frontend/jp-tracker.js
        // is embedded on a third-party origin and cannot be redeployed in
        // lockstep, so the two endpoints must converge on the server side.
        ...projectTelemetry(d.eventData),
        raw: d.rawPayload,
        web_vitals: d.eventType === 'web_vitals' ? d.eventData : undefined,
        interactions: d.eventType === 'interaction_batch' && d.eventData ? d.eventData.interactions : undefined,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp visitor lookup failed' });
  }
}
