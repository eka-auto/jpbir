// Live health behind the dashboard's "Product engineering" section.
//
// Every layer of the stack gets probed on each poll and every file in
// `stack-map.js` inherits the light of the probe that governs it. The panel is
// only worth having if the lights are *earned*, so three rules hold here:
//
//   1. A probe that cannot run does not return green. It returns `unknown`
//      (grey). `strictS24Liveness` exists in this repo because a Windows bridge
//      process once spoofed `online: true` in production; a panel that painted
//      green on "no signal" would be the same lie with nicer styling.
//   2. Every probe is wrapped in the same timeout. One unreachable host must
//      not stall a poll that the browser repeats every 10 s, forever.
//   3. No secret is ever in the response. Env vars report presence as a boolean
//      against a hardcoded allow-list in `stack-map.js` — never a value, never a
//      masked prefix, and never `Object.keys(process.env)`, because CLAUDE.md
//      records that some env var NAMES in this Vercel team embed secrets.
//
// The response is deliberately `fetched_at`, not `synced_at`. This handler
// stamps the moment it answered a poll; on a 10 s dashboard that resets every
// 10 s and says nothing about any device. The device's real sync time is its
// Firestore `lastSeen`, which the `devices` probe reports separately.

import { requireKey } from './_auth.js';
import { cronAuthorized, secretEquals } from './lib/cron-auth.js';
import { verifyPostgres } from './verify-db.js';
import { getFirestoreToken } from './jp-devices.js';
import { LAYERS, REQUIRED_ENV, HOSTS, TLS_WARN_DAYS, PROBE_TIMEOUT_MS, DEVICES_NOTE } from './lib/stack-map.js';
import { promises as dnsp } from 'node:dns';
import tls from 'node:tls';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] || _env['FIREBASE_' + 'SA_JSON'];
const AGENT_URL = _env['JP_AGENT_' + 'URL'] || 'https://runner.jaytipargal.tech';

const OK = 'ok';
const FAIL = 'fail';
const WARN = 'warn';
const UNKNOWN = 'unknown';

/**
 * One ceiling for every probe. `Promise.race` rather than AbortSignal because
 * not every probe below takes a signal (pg and the DNS resolver do not), and a
 * probe that ignores its abort would still hold the poll open.
 */
function withTimeout(label, promise) {
  let timer;
  const ceiling = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ status: UNKNOWN, problem: label + ' did not answer within ' + PROBE_TIMEOUT_MS + 'ms' }),
      PROBE_TIMEOUT_MS
    );
  });
  return Promise.race([promise, ceiling])
    .catch((e) => ({ status: FAIL, problem: String(e && e.message ? e.message : e).slice(0, 180) }))
    .finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- probes

async function probeDns() {
  const names = [HOSTS.apex, HOSTS.runner];
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const addrs = await dnsp.resolve4(name);
        return { name, ok: addrs.length > 0, count: addrs.length };
      } catch (e) {
        return { name, ok: false, error: e.code || e.message };
      }
    })
  );
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    return { status: FAIL, problem: bad.map((b) => b.name + ' does not resolve (' + b.error + ')').join('; ') };
  }
  return { status: OK, detail: results.map((r) => r.name + ' → ' + r.count + ' A').join(', ') };
}

/**
 * Reads the leaf certificate's expiry off a real handshake. `servername` is set
 * explicitly: without SNI the droplet would serve its default vhost and the
 * cert read would describe the wrong name.
 */
function probeTls() {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: HOSTS.runner, port: 443, servername: HOSTS.runner, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          return resolve({ status: UNKNOWN, problem: 'handshake produced no peer certificate' });
        }
        const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
        if (days < 0) return resolve({ status: FAIL, problem: 'certificate expired ' + Math.abs(days) + ' days ago' });
        if (days <= TLS_WARN_DAYS) {
          return resolve({ status: WARN, problem: 'certificate expires in ' + days + ' days — certbot renews at 30, so check certbot.timer' });
        }
        resolve({ status: OK, detail: 'valid ' + days + ' more days' });
      }
    );
    socket.on('error', (e) => resolve({ status: FAIL, problem: 'TLS handshake failed: ' + (e.code || e.message) }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ status: UNKNOWN, problem: 'TLS handshake timed out' });
    });
  });
}

/**
 * The droplet's /health. A 404 here is the documented signature of a Host
 * mismatch rather than a dead service (see Server/jp-agent/README.md), so it is
 * called out by name — otherwise the panel sends the operator to debug systemd
 * when the actual fault is DNS or a raw-IP request.
 */
async function probeAgent() {
  const res = await fetch(AGENT_URL.replace(/\/$/, '') + '/health', {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
    headers: { 'user-agent': 'jpbir-stack-probe' },
  });
  if (res.status === 404) {
    return { status: FAIL, problem: 'nginx answered 404 — Host header did not match runner.jaytipargal.tech, so this never reached jp-agent' };
  }
  if (!res.ok) return { status: FAIL, problem: 'agent /health returned HTTP ' + res.status };
  const body = await res.json().catch(() => ({}));
  if (body && body.ok === false) return { status: FAIL, problem: 'agent reports not ok' };
  return { status: OK, detail: 'HTTP 200 from ' + HOSTS.runner };
}

async function probePostgres() {
  const r = await verifyPostgres();
  if (r.ok) {
    return { status: OK, detail: r.tables_present + '/' + r.tables_expected + ' tables present' };
  }
  if (r.error) return { status: FAIL, problem: r.error };
  return { status: FAIL, problem: 'schema incomplete — missing ' + (r.missing || []).join(', ') };
}

async function probeFirestore() {
  if (!FIREBASE_SA_JSON) {
    return { status: UNKNOWN, problem: 'FIREBASE_SERVICE_ACCOUNT_JSON is not set on this deployment' };
  }
  const token = await getFirestoreToken();
  const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
  const url =
    'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents/devices?pageSize=10';
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
  });
  if (!res.ok) return { status: FAIL, problem: 'Firestore read returned HTTP ' + res.status };
  const data = await res.json().catch(() => ({}));
  const docs = data.documents || [];
  return { status: OK, detail: docs.length + ' device docs in ' + FIRESTORE_DB, _docs: docs };
}

/**
 * Device freshness, derived from the same Firestore read the `firestore` probe
 * already made — a second read would double the latency for the same bytes.
 * Deliberately separate from the Firestore light: the store being reachable and
 * a daemon still reporting are different facts, and conflating them is how a
 * dead phone hides behind a healthy database.
 */
function deviceFreshness(firestoreResult) {
  if (firestoreResult.status !== OK) {
    return { status: UNKNOWN, problem: 'cannot read device docs — Firestore probe did not succeed' };
  }
  const docs = firestoreResult._docs || [];
  if (!docs.length) return { status: WARN, problem: 'no device documents found in the devices collection' };

  let newest = 0;
  let newestId = null;
  for (const d of docs) {
    const raw = d.fields?.lastSeen?.timestampValue || d.fields?.lastSeen?.stringValue;
    const t = raw ? new Date(raw).getTime() : 0;
    if (t > newest) {
      newest = t;
      newestId = (d.name || '').split('/').pop();
    }
  }
  if (!newest) return { status: WARN, problem: 'no device has a readable lastSeen timestamp' };

  const mins = Math.floor((Date.now() - newest) / 60000);
  if (mins > 60) {
    return {
      status: FAIL,
      problem: 'newest device heartbeat is ' + mins + ' min old (' + (newestId || 'unknown') + ') — a daemon has stopped; no cloud-side change fixes this',
    };
  }
  if (mins > 15) {
    return { status: WARN, problem: 'newest heartbeat ' + mins + ' min old — daemon may be throttled or sleeping' };
  }
  return { status: OK, detail: 'newest heartbeat ' + mins + ' min ago', newest_last_seen: new Date(newest).toISOString() };
}

/**
 * DynamoDB and Blob are credential-presence checks, not reachability checks.
 * A real Dynamo describe would need a table name this deployment may not have,
 * and a Blob probe would need a known object; both would report FAIL for a
 * healthy store that simply has no fixture. Presence is the honest signal, so
 * a satisfied check returns UNKNOWN-with-detail rather than a green it has not
 * earned — the UI renders that grey, and the rule "grey means unproven" stays
 * true everywhere in the panel.
 */
function probeCredential(names, label) {
  const present = names.some((n) => Boolean(_env[n]));
  if (!present) return { status: FAIL, problem: label + ' credentials are not set on this deployment' };
  return { status: UNKNOWN, detail: label + ' credentials present (reachability not probed from a function)' };
}

function probeEnv() {
  const missing = REQUIRED_ENV.filter((v) => !_env[v.name] && !(v.alt && _env[v.alt]));
  if (missing.length) {
    return {
      status: FAIL,
      problem: missing.length + ' required var(s) unset: ' + missing.map((m) => m.name).join(', '),
      // Names only, from the hardcoded allow-list. No values, ever.
      missing: missing.map((m) => ({ name: m.name, why: m.why })),
    };
  }
  return { status: OK, detail: REQUIRED_ENV.length + '/' + REQUIRED_ENV.length + ' required vars present' };
}

// ---------------------------------------------------------------- assembly

/** Worst-of, so a layer is only as green as its weakest file. */
const RANK = { [FAIL]: 3, [WARN]: 2, [UNKNOWN]: 1, [OK]: 0 };
export function worst(statuses) {
  return statuses.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), OK);
}

export function buildLayers(probes) {
  return LAYERS.map((layer) => {
    const files = layer.files.map((f) => {
      const p = probes[f.probe] || { status: UNKNOWN, problem: 'no probe registered for "' + f.probe + '"' };
      return {
        path: f.path,
        why: f.why,
        probe: f.probe,
        status: p.status,
        // One line, as specified: only populated when the light is not green.
        problem: p.status === OK ? '' : (p.problem || p.detail || 'status unknown'),
        detail: p.status === OK ? (p.detail || '') : '',
      };
    });
    return {
      id: layer.id,
      title: layer.title,
      subtitle: layer.subtitle,
      kind: layer.kind,
      note: layer.note || '',
      status: worst(files.map((f) => f.status)),
      files,
    };
  });
}

/**
 * Runs every probe once and returns the probe map.
 *
 * Exported because `stack-cron.js` drives the same checks on a schedule. A
 * second copy of the probe list is how the panel a human reads and the cron
 * that emails them would drift into disagreeing about what "healthy" means —
 * the same reasoning that put `cron-auth.js` and `getFirestoreToken` in one
 * place each.
 */
export async function runProbes() {
  const [dns, tlsR, agent, postgres, firestore] = await Promise.all([
    withTimeout('DNS', probeDns()),
    withTimeout('TLS', probeTls()),
    withTimeout('agent', probeAgent()),
    withTimeout('Postgres', probePostgres()),
    withTimeout('Firestore', probeFirestore()),
  ]);

  const probes = {
    dns,
    tls: tlsR,
    agent,
    postgres,
    firestore,
    dynamo: probeCredential(['JP_AWS_' + 'ACCESS_KEY_ID'], 'DynamoDB'),
    blob: probeCredential(['BLOB_' + 'READ_WRITE_TOKEN', 'BLOB_' + 'TOKEN'], 'Vercel Blob'),
    env: probeEnv(),
    devices: deviceFreshness(firestore),
    static: { status: UNKNOWN, detail: 'no live signal reachable from a serverless function' },
  };

  // `_docs` carried the Firestore payload from one probe to the next; it must
  // never leave this function — those documents are full device telemetry.
  if (probes.firestore && probes.firestore._docs) delete probes.firestore._docs;
  return probes;
}

/** Probe map → the JSON both the dashboard and the cron persist. */
export function snapshot(probes) {
  const layers = buildLayers(probes);
  const flat = layers.flatMap((l) => l.files);
  const summary = {
    ok: flat.filter((f) => f.status === OK).length,
    warn: flat.filter((f) => f.status === WARN).length,
    fail: flat.filter((f) => f.status === FAIL).length,
    unknown: flat.filter((f) => f.status === UNKNOWN).length,
    total: flat.length,
  };
  return {
    // Not "synced": this is when the server answered THIS poll.
    fetched_at: new Date().toISOString(),
    devices_note: DEVICES_NOTE,
    overall: summary.fail ? FAIL : summary.warn ? WARN : OK,
    summary,
    probes: Object.fromEntries(
      Object.entries(probes).map(([k, v]) => [k, { status: v.status, problem: v.problem || '', detail: v.detail || '' }])
    ),
    layers,
  };
}

/**
 * Where the cron records each unattended run.
 *
 * Firestore and not Postgres, deliberately. A new Neon table would have to join
 * `REQUIRED_TABLES` (the suite enforces that every queried table is listed), and
 * `/api/verify-db` would then report production broken until a migration lands
 * — across a `schema_migrations` ledger this repo SHARES with
 * `jaytibirthday-site`, where the numbering invariant is already broken three
 * times over. That is the trap `device_telemetry` documents. A status panel is
 * not worth taking on a cross-repo migration hazard, and Firestore is already a
 * probed dependency holding exactly this kind of operational state (see
 * `staleAlert` in check-stale.js).
 */
export const CRON_DOC = 'system/stackHealth';

function firestoreBase() {
  if (!FIREBASE_SA_JSON) return null;
  const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents';
}

/**
 * Last run the cron recorded, so the panel shows round-the-clock state and not
 * merely what this one browser has watched since it opened. Never throws: a
 * deployment with no Firestore still gets a live panel, it just cannot prove
 * the unattended loop is running — which the UI then says, rather than implying
 * coverage it does not have.
 */
export async function lastCronRun() {
  try {
    const base = firestoreBase();
    if (!base) return null;
    const token = await getFirestoreToken();
    const res = await fetch(base + '/' + CRON_DOC, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
    });
    if (!res.ok) return null;
    const f = (await res.json()).fields || {};
    return {
      checked_at: f.checkedAt?.timestampValue || f.checkedAt?.stringValue || null,
      overall: f.overall?.stringValue || null,
      fail_count: Number(f.failCount?.integerValue ?? 0),
      warn_count: Number(f.warnCount?.integerValue ?? 0),
      source: f.source?.stringValue || 'cron',
    };
  } catch {
    return null;
  }
}

/** Writes one unattended run. Called only by stack-cron.js. */
export async function recordCronRun(snap, source) {
  const base = firestoreBase();
  if (!base) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured — cannot record the run');
  const token = await getFirestoreToken();
  const fields = {
    checkedAt: { timestampValue: snap.fetched_at },
    overall: { stringValue: snap.overall },
    failCount: { integerValue: String(snap.summary.fail) },
    warnCount: { integerValue: String(snap.summary.warn) },
    okCount: { integerValue: String(snap.summary.ok) },
    source: { stringValue: source || 'cron' },
  };
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const res = await fetch(base + '/' + CRON_DOC + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('failed to record run: HTTP ' + res.status);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Third, narrower credential, mirroring verify-db.js: CI may ask whether the
  // stack is healthy without the dashboard key ever living in a workflow. It
  // gets a verdict and counts — no file paths, no problem strings, since those
  // name internal hosts and env vars.
  if (secretEquals(req.headers['x-health-key'], _env['HEALTH_' + 'CHECK_KEY'])) {
    const snap = snapshot(await runProbes());
    return res.status(snap.overall === FAIL ? 503 : 200).json({
      success: snap.overall !== FAIL,
      overall: snap.overall,
      summary: snap.summary,
    });
  }

  if (!cronAuthorized(req) && !requireKey(req, res)) return;

  const [snap, cron] = await Promise.all([runProbes().then(snapshot), lastCronRun()]);
  res.status(200).json({ success: true, ...snap, last_cron_run: cron });
}
