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
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { query, isConfigured } from '../Integrations/postgres.js';
import {
  siteFor, insertEvent, rollupVisitors, rollupSessions,
  readSyncCursor, writeSyncCursor, clearSyncCursor, TRACKED_PROPERTY,
} from './lib/warehouse.js';
import { cronAuthorized, secretEquals } from './lib/cron-auth.js';

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
const REPAIR_CURSOR = 'dynamodb-telemetry-repair';

// One row, one definition. Backend/lib/warehouse.js owns the INSERT and the
// rollups so this bulk re-import and jp-track's live mirror cannot disagree
// about the row id, the site, or what a visitor's event_count means.
//
// A row is imported ONLY if it belongs to the tracked property. The DynamoDB
// table is a journal of every host that ever posted here, including the
// operator console's own sessions and the fleet's device probes — none of
// which the warehouse tracks any more. Importing them would put back, every
// night, exactly the rows the purge removed, and a nightly job that
// re-creates what an operator deleted is worse than no job at all.
//
// Rows that name no page URL are skipped rather than guessed for. The old
// fallback filed them under jaytipargal.com, which is how a page-less beacon
// ended up attributed to a site that never sent it.
async function insertItem(it) {
  const site = it.site || siteFor(it.pageUrl, null);
  if (site !== TRACKED_PROPERTY) return null;
  return insertEvent(it, { site, sourceSystem: 'dynamodb' });
}

// visitors/sessions are rollups over `events`, recomputed rather than
// incremented. Scoped to the tracked property, so a rebuild cannot put back
// a session for a site the warehouse no longer tracks.
async function rebuildRollups() {
  await rollupVisitors({ site: TRACKED_PROPERTY });
  await rollupSessions({ site: TRACKED_PROPERTY });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Either credential gets in, nothing else does: the admin key a human
  // presents, or the CRON_SECRET bearer Vercel sends on a scheduled run.
  //
  // The schedule is the point. This migration shipped as something someone had
  // to remember to trigger, nothing triggered it, and the warehouse drifted
  // behind DynamoDB from 2026-09-13 until a person went looking. jp-track now
  // mirrors straight into Postgres, but that mirror is deliberately non-fatal —
  // a Postgres outage leaves the row in DynamoDB and nowhere else. A nightly
  // run turns that journal into a repair path instead of a silent loss.
  const expected = process.env.DB_ADMIN_KEY;
  const given = req.headers['x-db-admin-key'] || '';
  // 404 rather than 401, so the route is not discoverable without a credential.
  if (!cronAuthorized(req) && !secretEquals(given, expected)) {
    return res.status(404).json({ error: 'not found' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(503).json({ ok: false, error: 'JP_AWS_* read credentials not configured' });
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

    // Remove every property except the tracked one, from the warehouse AND
    // from the journal that feeds it.
    //
    // The console at jaytipargal.tech tracked itself, so the warehouse held a
    // property whose "visitors" were the owner's own sessions and the fleet's
    // own device probes. The owner asked for that data to be removed
    // completely rather than merely hidden.
    //
    // This lives HERE, in the application, for one reason: the credential that
    // opens the live warehouse is a Vercel Secret in this project and cannot be
    // pulled to a laptop or read by CI. The only thing that can delete from
    // the production database is the running application itself.
    //
    // Both ends are purged, because one end is not enough. The journal is what
    // the nightly repair copies FROM: purging only the warehouse would put the
    // rows back at the next repair, and a purge that undoes itself every
    // night is not a purge.
    if (action === 'purge') {
      const before = (await query(
        `SELECT site, COUNT(*)::int n FROM events GROUP BY site ORDER BY n DESC`
      )).rows;
      const events = await query(`DELETE FROM events WHERE site <> $1`, [TRACKED_PROPERTY]);
      const sessions = await query(`DELETE FROM sessions WHERE site <> $1`, [TRACKED_PROPERTY]);
      const visitors = await query(`DELETE FROM visitors WHERE site <> $1`, [TRACKED_PROPERTY]);
      // The migration is recorded so the shared ledger says the purge happened
      // rather than leaving the next runner to try it again.
      await query(
        `INSERT INTO schema_migrations (filename, applied_at)
           VALUES ($1, now()) ON CONFLICT (filename) DO NOTHING`,
        ['016_purge_non_birthday_analytics.sql'],
      );
      await rebuildRollups();

      let journalDeleted = 0, journalKept = 0;
      if (AWS_ACCESS_KEY_ID) {
        const client = DynamoDBDocumentClient.from(new DynamoDBClient({
          region: AWS_REGION,
          credentials: credsFor('read'),
        }));
        const out = await client.send(new ScanCommand({ TableName: TABLE }));
        for (const it of out.Items || []) {
          const url = it.pageUrl && (it.pageUrl.S || it.pageUrl);
          let host = null;
          try { host = url ? new URL(url).hostname : null; } catch { host = null; }
          if (host === TRACKED_PROPERTY || (host && host.endsWith('.' + TRACKED_PROPERTY))) { journalKept++; continue; }
          await client.send(new DeleteCommand({ TableName: TABLE, Key: { id: it.id } }));
          journalDeleted++;
        }
      }

      const after = (await query(
        `SELECT site, COUNT(*)::int n FROM events GROUP BY site ORDER BY n DESC`
      )).rows;
      return res.status(200).json({
        ok: true,
        tracked_property: TRACKED_PROPERTY,
        before,
        after,
        deleted: {
          events: events.rowCount,
          sessions: sessions.rowCount,
          visitors: visitors.rowCount,
          journal_items: journalDeleted,
        },
        journal_kept: journalKept,
      });
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
      // Which DATABASE are we talking to?
      //
      // The credential is a Vercel Secret, so nothing outside this deployment
      // can read it - which is how two different Neon copies came to look
      // authoritative: this machine's .env.local and the repository's
      // DATABASE_URL secret both pointed at a copy frozen on 2026-10-09,
      // while production read a live one. Every local analysis of "the
      // warehouse" was therefore an analysis of the wrong database, and it
      // looked like the product had stopped collecting.
      //
      // The database can answer for itself. Neon publishes its own project,
      // branch and endpoint as session settings, so the identity is a fact
      // read from the connection rather than a name somebody has to remember.
      const postgres = await (async () => {
        try {
          const r = await query(`SELECT current_setting('neon.project_id', true)  AS project_id,
                                       current_setting('neon.branch_id', true)   AS branch_id,
                                       current_setting('neon.endpoint_id', true) AS endpoint_id,
                                       current_database()                       AS database,
                                       version()                                AS server_version`);
          const row = r.rows[0] || {};
          return {
            configured: true,
            project_id: row.project_id || null,
            branch_id: row.branch_id || null,
            endpoint_id: row.endpoint_id || null,
            database: row.database || null,
            server_version: row.server_version ? String(row.server_version).split(' ')[0] : null,
          };
        } catch (e) {
          return { configured: false, error: String(e.message).slice(0, 120) };
        }
      })();
      return res.status(200).json({ ok: true, table: TABLE, region: AWS_REGION, credentials: out, postgres });
    }

    if (action === 'push') {
      const which = String(req.query.creds || 'read');
      const client = DynamoDBDocumentClient.from(new DynamoDBClient({
        region: AWS_REGION,
        credentials: credsFor(which),
      }));

      // An operator can still choose an explicit starting key, but the nightly
      // cron has no request body and no nextKey consumer. Its checkpoint lives
      // in Neon, so the next run resumes after the last bounded slice instead
      // of rereading the first eight pages forever.
      const requestedKey = req.query.nextKey ? JSON.parse(String(req.query.nextKey)) : null;
      const savedKey = requestedKey ? null : await readSyncCursor(REPAIR_CURSOR);
      let key = requestedKey || savedKey || undefined;
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
      if (done) {
        await clearSyncCursor(REPAIR_CURSOR);
        await rebuildRollups();
      } else {
        await writeSyncCursor(REPAIR_CURSOR, key);
      }

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
        resumedFromCheckpoint: Boolean(savedKey),
        nextKey: key ? JSON.stringify(key) : null,
      });
    }

    return res.status(400).json({ ok: false, error: `unknown action ${action}` });
  } catch (err) {
    console.error('[db-push] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
