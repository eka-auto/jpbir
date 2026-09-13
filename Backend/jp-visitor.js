import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { decodeGeo } from './lib/geo.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

const MAX_SCAN_PAGES = 200;

// Filter server-side and cap pagination, the way visitor.js's listAll does.
// This is still a Scan, so read capacity is unchanged - the real fix is a GSI
// on visitorId - but shipping the entire table into the function on every
// drawer open, only to discard all but one visitor in JS, made payload and
// latency scale with total table size instead of with the row count asked for,
// with no ceiling before the function timeout.
async function scanAll(client, extra) {
  const out = [];
  let key, pages = 0;
  do {
    const cmd = new ScanCommand({
      TableName: TABLE,
      ...(extra || {}),
      ...(key ? { ExclusiveStartKey: key } : {})
    });
    const res = await client.send(cmd);
    out.push(...(res.Items || []));
    key = res.LastEvaluatedKey;
    if (++pages >= MAX_SCAN_PAGES) break;
  } while (key);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(500).json({ success: false, error: 'AWS credentials not configured' });
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

    const names = { '#epoch': 'epoch' };
    const values = { ':cutoff': cutoff };
    const idMatch = [];
    if (visitor) { names['#visitorId'] = 'visitorId'; values[':visitor'] = visitor; idMatch.push('#visitorId = :visitor'); }
    if (session) { names['#sessionId'] = 'sessionId'; values[':session'] = session; idMatch.push('#sessionId = :session'); }
    const events = await scanAll(client, {
      FilterExpression: `#epoch >= :cutoff AND (${idMatch.join(' OR ')})`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    });

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
      query: { visitor, session },
      summary: {
        visitor_id: visitor || (events[0] && events[0].visitorId) || null,
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
        raw: d.rawPayload,
        web_vitals: d.eventType === 'web_vitals' ? d.eventData : undefined,
        interactions: d.eventType === 'interaction_batch' && d.eventData ? d.eventData.interactions : undefined,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp visitor lookup failed' });
  }
}
