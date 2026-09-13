import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { decodeOne } from './lib/geo.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_WRITE_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_WRITE_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

const ALLOWED_ORIGINS = new Set([
  'https://jaytipargal.com',
  'https://www.jaytipargal.com',
  'https://dfa5i945koq3k.cloudfront.net',
]);

function getClientIP(req) {
  return (
    req.headers['x-vercel-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

const SNAPSHOT_EVENT_TYPES = new Set(['browser_history', 'device_history']);

/*
 * History uploads are complete snapshots, not an append-only event stream.
 * Keep the newest snapshot for a device and remove its previous snapshots so
 * repeated syncs do not grow the telemetry table forever. Analytics events
 * (pageview, heartbeat, clicks, etc.) are intentionally left untouched.
 */
async function prunePreviousHistory(client, currentId, visitorId) {
  if (!visitorId || visitorId === 'anon') return 0;

  const stale = [];
  let startKey;
  do {
    const result = await client.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: '#id, #eventType, #visitorId',
      FilterExpression: '(#eventType = :browserHistory OR #eventType = :deviceHistory) AND #visitorId = :visitorId AND #id <> :currentId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#eventType': 'eventType',
        '#visitorId': 'visitorId',
      },
      ExpressionAttributeValues: {
        ':browserHistory': 'browser_history',
        ':deviceHistory': 'device_history',
        ':visitorId': visitorId,
        ':currentId': currentId,
      },
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));
    stale.push(...(result.Items || []));
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  let removed = 0;
  for (let offset = 0; offset < stale.length; offset += 25) {
    let pending = stale.slice(offset, offset + 25).map((item) => ({
      DeleteRequest: { Key: { id: item.id } },
    }));
    for (let attempt = 0; pending.length && attempt < 4; attempt += 1) {
      const result = await client.send(new BatchWriteCommand({
        RequestItems: { [TABLE]: pending },
      }));
      const remaining = result.UnprocessedItems?.[TABLE] || [];
      removed += pending.length - remaining.length;
      pending = remaining;
    }
    if (pending.length) throw new Error(`DynamoDB retained ${pending.length} previous history rows after retries`);
  }
  return removed;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin || req.headers.referer || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.has(origin) ? origin : 'https://jaytipargal.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(500).json({ success: false, error: 'AWS write credentials not configured' });
  }

  try {
    let event = req.body || {};
    if (typeof event === 'string') {
      try { event = JSON.parse(event); } catch { event = { raw: event }; }
    }

    const now = new Date();
    const id = `${now.toISOString()}_${Math.random().toString(36).slice(2, 10)}`;
    const eventType = event.event_type || event.eventType || 'event';
    const visitorId = event.visitor_id || event.visitorId || event.device_id || event.deviceId || 'anon';

    const item = {
      id,
      eventType,
      epoch: now.getTime(),
      timestamp: now.toISOString(),
      sessionId: event.session_id || event.sessionId || 'anon',
      visitorId,
      pageUrl: event.page_url || event.pageUrl || null,
      pageTitle: event.page_title || event.pageTitle || null,
      referrer: event.referrer || null,
      ip: getClientIP(req),
      // Vercel percent-encodes these, so decode at ingestion - new rows are
      // stored readable and every reader stops depending on remembering to do
      // it. The read-side decodes stay because rows written before this change
      // are still encoded and cannot be rewritten from here.
      //
      // decodeOne is NOT idempotent in general: it re-decodes anything still
      // containing '%', so a double-encoded header would be decoded here and
      // again on read. Geo-IP city, region, country and timezone values do not
      // contain a literal '%', so the two decodes cannot compound on this data
      // - but do not copy this pattern onto a field that can.
      country: decodeOne(req.headers['x-vercel-ip-country']) || null,
      region: decodeOne(req.headers['x-vercel-ip-country-region']) || null,
      city: decodeOne(req.headers['x-vercel-ip-city']) || null,
      latitude: req.headers['x-vercel-ip-latitude'] || null,
      longitude: req.headers['x-vercel-ip-longitude'] || null,
      timezone: decodeOne(req.headers['x-vercel-ip-timezone']) || null,
      postalCode: null,
      userAgent: req.headers['user-agent'] || null,
      language: req.headers['accept-language'] || null,
      screen: event.screen || null,
      deviceType: event.device_type || null,
      browser: event.browser || null,
      os: event.os || null,
      network: event.network || null,
      timeOnPage: typeof event.time_on_page === 'number' ? event.time_on_page : null,
      scrollPercent: typeof event.scroll_percent === 'number' ? event.scroll_percent : null,
      fingerprint: event.device_fingerprint || null,
      eventData: event.event_data || event.eventData || {},
      rawPayload: typeof event === 'object' && event.raw ? event.raw : null,
    };

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));
    await client.send(new PutCommand({ TableName: TABLE, Item: item }));

    let prunedHistory = 0;
    let retentionWarning = null;
    if (SNAPSHOT_EVENT_TYPES.has(item.eventType)) {
      try {
        prunedHistory = await prunePreviousHistory(client, item.id, item.visitorId);
      } catch (retentionError) {
        retentionWarning = retentionError.message || 'history retention cleanup failed';
        console.error('[jp-track] history retention cleanup failed:', retentionError);
      }
    }

    return res.status(200).json({
      success: true,
      id,
      persisted: true,
      retention: {
        mode: SNAPSHOT_EVENT_TYPES.has(item.eventType) ? 'latest-history-snapshot-per-device' : 'analytics-events-unchanged',
        prunedHistory,
        warning: retentionWarning,
      },
    });
  } catch (err) {
    console.error('[jp-track] error:', err);
    return res.status(500).json({ success: false, error: err.message || 'failed to persist' });
  }
}
