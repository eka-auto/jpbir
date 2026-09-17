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
import { siteFor, insertEvent, rollupVisitors, rollupSessions } from './lib/warehouse.js';

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

// Last resort only. Rows written before jp-track started stamping a site
// carry no page URL either, and 'jaytipargal.com' is the property this table
// collected for, so that is what they stay. Everything else derives its own.
const FALLBACK_SITE = 'jaytipargal.com';

// One row, one definition. Backend/lib/warehouse.js owns the INSERT and the
// rollups so this bulk re-import and jp-track's live mirror cannot disagree
// about the row id, the site, or what a visitor's event_count means.
async function insertItem(it) {
  const site = it.site || siteFor(it.pageUrl, null) || FALLBACK_SITE;
  return insertEvent(it, { site, sourceSystem: 'dynamodb' });
}

// visitors/sessions are rollups over `events`, recomputed rather than
// incremented. Scoped to nothing here, so this rebuilds every key.
async function rebuildRollups() {
  await rollupVisitors();
  await rollupSessions();
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

      // Was a single count for the hardcoded site. Rows now carry whichever
      // property their page URL names, so one number would hide the split.
      const totals = (await query(
        `SELECT site, COUNT(*)::int n FROM events WHERE source_system = 'dynamodb'
          GROUP BY site ORDER BY n DESC`
      )).rows;

      return res.status(200).json({
        ok: true,
        table: TABLE,
        region: AWS_REGION,
        scannedThisCall: scanned,
        insertedThisCall: inserted,
        totalsBySite: totals,
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
