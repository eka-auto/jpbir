// One-way migration: DynamoDB `jaytipargal_telemetry` -> Neon Postgres.
//
// This lives in THIS project rather than a local script because the AWS
// credentials for the telemetry account exist only as Vercel Secrets here and
// cannot be pulled to a laptop. A local profile resolves the same table name
// to a different, near-empty account, so running the migration anywhere else
// would quietly import the wrong rows.
//
// Resumable by design: DynamoDB Scan hands back a LastEvaluatedKey, which is
// returned to the caller and passed back on the next call, so the migration is
// driven in chunks that each finish well inside the function timeout. Inserts
// are ON CONFLICT DO NOTHING keyed on the item id, so a retried chunk is a
// no-op rather than a duplicate.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { query, isConfigured } from '../Integrations/postgres.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
// jp-track.js writes with JP_WRITE_AWS_*, every reader uses JP_AWS_*. If those
// are different accounts the table name resolves to two different tables, and
// the dashboard reads an empty one while the writes land elsewhere.
const WRITE_ACCESS_KEY_ID = _env['JP_WRITE_AWS_' + 'ACCESS_KEY_ID'];
const WRITE_SECRET_ACCESS_KEY = _env['JP_WRITE_AWS_' + 'SECRET_ACCESS_KEY'];

function credsFor(which) {
  return which === 'write'
    ? { accessKeyId: WRITE_ACCESS_KEY_ID, secretAccessKey: WRITE_SECRET_ACCESS_KEY }
    : { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
}
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

const SITE = 'jaytipargal.com';

const iso = (v) => {
  if (!v) return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (v == null ? null : String(v));

async function insertItem(it) {
  const at = iso(it.timestamp || it.epoch);
  if (!at) return false;
  await query(
    `INSERT INTO events (
       id, site, event_type, occurred_at, epoch_ms, session_id, visitor_id,
       page_url, page_title, referrer, ip, country, region, city, latitude,
       longitude, timezone, postal_code, user_agent, language, screen,
       device_type, browser, os, network, time_on_page, scroll_percent,
       fingerprint, event_data, raw_payload, source_system)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     ON CONFLICT (id) DO NOTHING`,
    [
      `${SITE}:${it.id}`, SITE, it.eventType || 'event', at,
      Number.isFinite(it.epoch) ? it.epoch : Date.parse(at),
      str(it.sessionId), str(it.visitorId), str(it.pageUrl), str(it.pageTitle),
      str(it.referrer), str(it.ip), str(it.country), str(it.region), str(it.city),
      str(it.latitude), str(it.longitude), str(it.timezone), str(it.postalCode),
      str(it.userAgent), str(it.language),
      typeof it.screen === 'string' ? it.screen : it.screen ? JSON.stringify(it.screen) : null,
      str(it.deviceType), str(it.browser), str(it.os),
      it.network ? JSON.stringify(it.network) : null,
      num(it.timeOnPage), num(it.scrollPercent), str(it.fingerprint),
      JSON.stringify(it.eventData || {}), JSON.stringify(it), 'dynamodb',
    ]
  );
  return true;
}

// visitors/sessions are rollups. COUNT(DISTINCT ...) is not allowed as a
// window function in Postgres, so the aggregate is a plain GROUP BY and the
// "last known" attributes come from a LATERAL pick of the newest row.
async function rebuildRollups() {
  await query(`
    INSERT INTO visitors (visitor_id, site, first_seen_at, last_seen_at, event_count,
                          session_count, country, region, city, timezone, user_agent,
                          device_type, browser, os, fingerprint)
    SELECT a.visitor_id, a.site, a.first_seen_at, a.last_seen_at, a.event_count,
           a.session_count, l.country, l.region, l.city, l.timezone, l.user_agent,
           l.device_type, l.browser, l.os, l.fingerprint
      FROM (
        SELECT site, visitor_id,
               MIN(occurred_at) AS first_seen_at,
               MAX(occurred_at) AS last_seen_at,
               COUNT(*)::int    AS event_count,
               COUNT(DISTINCT session_id)::int AS session_count
          FROM events WHERE visitor_id IS NOT NULL
         GROUP BY site, visitor_id
      ) a
      JOIN LATERAL (
        SELECT country, region, city, timezone, user_agent, device_type,
               browser, os, fingerprint
          FROM events e
         WHERE e.site = a.site AND e.visitor_id = a.visitor_id
         ORDER BY e.occurred_at DESC LIMIT 1
      ) l ON true
    ON CONFLICT (site, visitor_id) DO UPDATE SET
      first_seen_at = LEAST(visitors.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at  = GREATEST(visitors.last_seen_at, EXCLUDED.last_seen_at),
      event_count   = EXCLUDED.event_count,
      session_count = EXCLUDED.session_count`);

  await query(`
    INSERT INTO sessions (session_id, site, visitor_id, started_at, last_event_at,
                          event_count, entry_page, exit_page)
    SELECT session_id, site, MIN(visitor_id), MIN(occurred_at), MAX(occurred_at), COUNT(*),
           (ARRAY_AGG(page_url ORDER BY occurred_at ASC))[1],
           (ARRAY_AGG(page_url ORDER BY occurred_at DESC))[1]
      FROM events WHERE session_id IS NOT NULL
     GROUP BY site, session_id
    ON CONFLICT (site, session_id) DO UPDATE SET
      last_event_at = GREATEST(sessions.last_event_at, EXCLUDED.last_event_at),
      event_count   = EXCLUDED.event_count,
      exit_page     = EXCLUDED.exit_page`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const expected = process.env.DB_ADMIN_KEY;
  const given = req.headers['x-db-admin-key'] || '';
  // 404 rather than 401, so the route is not discoverable without the key.
  if (!expected || given !== expected) return res.status(404).json({ error: 'not found' });

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(500).json({ ok: false, error: 'JP_AWS_* read credentials not configured' });
  }

  const action = String(req.query.action || 'push');

  try {
    if (action === 'counts') {
      const rows = {};
      for (const t of ['events', 'visitors', 'sessions', 'letters', 'email_opens', 'video_events', 'devices']) {
        rows[t] = (await query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
      }
      const bySite = (await query('SELECT site, COUNT(*)::int n FROM events GROUP BY site ORDER BY n DESC')).rows;
      return res.status(200).json({ ok: true, postgres: rows, eventsBySite: bySite, table: TABLE, region: AWS_REGION });
    }

    if (action === 'rollups') {
      await rebuildRollups();
      return res.status(200).json({ ok: true, rebuilt: true });
    }

    if (action === 'identity') {
      // Which account does each credential pair actually resolve to?
      const out = {};
      for (const which of ['read', 'write']) {
        const c = credsFor(which);
        if (!c.accessKeyId) { out[which] = { configured: false }; continue; }
        try {
          const sts = new STSClient({ region: AWS_REGION, credentials: c });
          const id = await sts.send(new GetCallerIdentityCommand({}));
          const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION, credentials: c }));
          let items = 0;
          let key;
          do {
            const r = await ddb.send(new ScanCommand({ TableName: TABLE, Select: 'COUNT', ...(key ? { ExclusiveStartKey: key } : {}) }));
            items += r.Count || 0;
            key = r.LastEvaluatedKey;
          } while (key);
          out[which] = { configured: true, account: id.Account, arn: id.Arn, itemsInTable: items };
        } catch (e) {
          out[which] = { configured: true, error: e.message };
        }
      }
      return res.status(200).json({ ok: true, table: TABLE, region: AWS_REGION, credentials: out });
    }

    if (action === 'push') {
      const which = String(req.query.creds || 'read');
      const client = DynamoDBDocumentClient.from(new DynamoDBClient({
        region: AWS_REGION,
        credentials: credsFor(which),
      }));

      // The caller hands back the previous response's `nextKey` to continue.
      let key = req.query.nextKey ? JSON.parse(String(req.query.nextKey)) : undefined;
      const pages = Math.min(Number(req.query.pages) || 8, 40);

      let scanned = 0;
      let inserted = 0;
      let page = 0;
      let identity = null;

      do {
        const out = await client.send(new ScanCommand({
          TableName: TABLE,
          ...(key ? { ExclusiveStartKey: key } : {}),
        }));
        if (identity === null) identity = out.$metadata?.requestId || 'scan-ok';
        for (const it of out.Items || []) {
          scanned++;
          if (await insertItem(it)) inserted++;
        }
        key = out.LastEvaluatedKey;
        page++;
      } while (key && page < pages);

      const done = !key;
      if (done) await rebuildRollups();

      const total = (await query("SELECT COUNT(*)::int n FROM events WHERE site = $1", [SITE])).rows[0].n;

      return res.status(200).json({
        ok: true,
        table: TABLE,
        region: AWS_REGION,
        scannedThisCall: scanned,
        insertedThisCall: inserted,
        totalForSite: total,
        done,
        nextKey: key ? JSON.stringify(key) : null,
      });
    }

    return res.status(400).json({ ok: false, error: `unknown action ${action}` });
  } catch (err) {
    console.error('[db-push] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
