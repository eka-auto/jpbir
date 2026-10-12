/**
 * Database Verification API Endpoint
 * 
 * GET /api/verify-db
 *
 * Verifies production database connectivity, one report per store:
 * 1. Neon Postgres — reachable, every table the read routes query exists,
 *    and how fresh the event stream is
 * 2. Firestore device read
 *
 * Returns JSON with verification status
 */

import crypto from 'crypto';
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { cronAuthorized, secretEquals } from './lib/cron-auth.js';
import { splitFleet } from './broker.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];

// Every table a deployed read route actually queries, extracted from the SQL in
// db-api.js (all 14 views), the four jp-wa-*/wa-* WhatsApp routes and the two
// ingest routes. Kept in sync by verify-db-postgres.test.mjs, which re-derives
// this list from those files and fails when a route starts using a table the
// health check does not know about.
//
// Ownership is split across two repos that share one Neon database: this one
// ships Database/schema/004-006 (the wa_* and s24_* tables), and the sibling
// jaytibirthday-site ships 001-003 (events, visitors, sessions, devices,
// letters, email_opens, video_events). That is why a missing table here is a
// real, reportable state rather than an impossibility — a database can be
// migrated by one project and not the other.
//
// `device_telemetry` is deliberately NOT here. It is the sibling repo's table
// (created by its 009_device_telemetry.sql against this shared Neon database),
// and since the Neon freshness overlay came out of jp-devices.js no read route
// in THIS repo touches it. Listing a table nobody here reads would make
// /api/verify-db report production as broken over a migration this project does
// not own and cannot apply.
export const REQUIRED_TABLES = [
  'devices', 'email_opens', 'events', 'letters', 'sessions', 'video_events', 'visitors',
  's24_agents', 's24_calls', 's24_commands', 's24_device_snapshots',
  's24_files', 's24_ingest_seen', 's24_locations', 's24_queue_items', 's24_records', 's24_sms',
  's24_sync_datasets', 's24_sync_runs',
  'wa_attachments', 'wa_chats', 'wa_messages', 'wa_sync_runs',
];

/**
 * Verifies the Neon warehouse — the store the dashboard reads on every page
 * load. It was absent from this endpoint, which checked only Firestore:
 * /api/verify-db could report `production_ready: true` while every
 * db-api view returned 500 because DATABASE_URL was unset or the schema had
 * never been migrated. That is exactly the failure jpbirrestructured.vercel.app
 * has been sitting in.
 *
 * `q` and `configured` are injectable so the suite can exercise the missing-
 * table and connection-failure branches without a database.
 */
export async function verifyPostgres(q = query, configured = isConfigured) {
  if (!configured()) {
    return { ok: false, error: 'DATABASE_URL not set on this deployment' };
  }

  try {
    const present = new Set(
      (await q(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [REQUIRED_TABLES]
      )).rows.map((r) => r.table_name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));

    // Reported even when a table is missing: "schema incomplete but the rows
    // that exist are current" and "schema fine, ingestion stopped a week ago"
    // are different incidents, and the caller cannot tell them apart from an
    // ok/not-ok flag alone.
    let freshness = null;
    if (!missing.includes('events')) {
      freshness = (await q(
        `SELECT COUNT(*)::int AS events,
                COUNT(DISTINCT site)::int AS sites,
                MAX(occurred_at) AS newest_event_at,
                MAX(ingested_at) AS last_write_at
           FROM events`
      )).rows[0];
    }

    return {
      ok: missing.length === 0,
      tables_expected: REQUIRED_TABLES.length,
      tables_present: present.size,
      missing,
      ...(freshness || {}),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function verifyFirestore() {
  if (!FIREBASE_SA_JSON) {
    return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' };
  }

  try {
    const sa = JSON.parse(FIREBASE_SA_JSON);
    const projectId = sa.project_id;
    
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const input = `${b64url(header)}.${b64url(claim)}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key);
    const jwt = `${input}.${sig.toString('base64url')}`;

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData).slice(0, 200)}`);
    }

    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/eka-agent/documents`;
    const devicesRes = await fetch(`${base}/devices`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!devicesRes.ok) {
      throw new Error(`Firestore read failed: ${devicesRes.status} ${devicesRes.statusText}`);
    }

    const devicesData = await devicesRes.json();
    return {
      ok: true,
      project: projectId,
      database: 'eka-agent',
      // The fleet, not every document in the collection (see DEVICE_IDS in
      // broker.js): this said 5 while there are three devices.
      devices_found: splitFleet(devicesData.documents).fleet.length,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  // Was "open dashboard - no authentication required". It answered 200 to
  // anyone with the GCP project id, the Firestore
  // database name and a live device count. The old CRON_SECRET check could not
  // stop that: it only ran when an Authorization header was present, so sending
  // no header at all skipped the branch entirely.
  //
  // Either credential now gets in, nothing else does: the dashboard key that
  // gates every other read route, or a CRON_SECRET bearer for scheduled checks.
  //
  // CI's health probe gets a third, narrower key: HEALTH_CHECK_KEY can only ask
  // whether Neon answers with the full schema. No table names, row counts or
  // other store detail, so the dashboard key never has to live in CI.
  if (secretEquals(req.headers['x-health-key'], _env['HEALTH_' + 'CHECK_KEY'])) {
    const pg = await verifyPostgres();
    return res.status(pg.ok ? 200 : 503).json({
      success: pg.ok,
      postgres: { ok: pg.ok, tables_present: pg.tables_present ?? null, tables_expected: pg.tables_expected ?? null },
    });
  }
  if (!cronAuthorized(req) && !requireKey(req, res)) return;

  const [postgresResult, firestoreResult] = await Promise.all([
    verifyPostgres(),
    verifyFirestore(),
  ]);

  const allOk = postgresResult.ok && firestoreResult.ok;

  res.status(allOk ? 200 : 500).json({
    success: allOk,
    verified_at: new Date().toISOString(),
    databases: {
      postgres: postgresResult,
      firestore: firestoreResult,
    },
    production_ready: allOk,
  });
}
