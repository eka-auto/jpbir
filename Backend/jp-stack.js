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
import { getFirestoreToken, decodeFirestoreDocument, computeS24Liveness } from './jp-devices.js';
import { DEVICE_IDS, splitFleet } from './broker.js';
import { LAYERS, REQUIRED_ENV, HOSTS, TLS_WARN_DAYS, PROBE_TIMEOUT_MS, DEVICES_NOTE, allFiles } from './lib/stack-map.js';
import { readinessOf, overallFor, scheduleState, VERDICT_PASS, VERDICT_UNPROVEN } from './lib/stack-readiness.js';
import { verifyReceipt, EVIDENCE_DOC, SUBJECTS } from './lib/stack-evidence.js';
import { S24_DEVICE_ID } from './lib/s24-attestation.js';
import { S24_CONTRACT } from './lib/stack-subjects.js';
import { promises as dnsp } from 'node:dns';
import tls from 'node:tls';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] || _env['FIREBASE_' + 'SA_JSON'];

const OK = 'ok';
const FAIL = 'fail';
const WARN = 'warn';
const UNKNOWN = 'unknown';

/**
 * How stale the S24's heartbeat may be before it stops counting as fresh.
 *
 * Two periods of the device's own JobScheduler schedule. The runtime contract
 * launches the broker daemon every jobSchedulerPeriodMs (15 minutes) and the
 * daemon heartbeats every 45 s while it runs, so the phone is silent for up
 * to a full period between two launches. The shared attestation module's own
 * five-minute bound (S24_ACK_MAX_AGE_SECONDS) was written for a continuously
 * reporting device and would call a phone that is exactly following its
 * contract offline for two thirds of every cycle.
 *
 * The value comes from the pinned contract facts in `stack-subjects.js`, which
 * the generator lifts out of Devices/S24/runtime_contract.json — so the panel's
 * expectation of the device cannot drift from the contract the device runs.
 */
const S24_FRESHNESS_BOUND_SECONDS = Math.ceil((S24_CONTRACT.job_scheduler_period_ms / 1000) * 2);

/** The unattended schedule, as declared in vercel.json. */
export const CRON_CADENCE_MINUTES = 5;
/** A native receipt older than this means the scheduler stopped. */
export const CRON_MAX_AGE_MINUTES = 20;

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
  const names = [HOSTS.apex];
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
 * explicitly so the public dashboard certificate is measured directly.
 */
function probeTls() {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: HOSTS.apex, port: 443, servername: HOSTS.apex, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          return resolve({ status: UNKNOWN, problem: 'handshake produced no peer certificate' });
        }
        const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
        if (days < 0) return resolve({ status: FAIL, problem: 'certificate expired ' + Math.abs(days) + ' days ago' });
        if (days <= TLS_WARN_DAYS) {
          return resolve({ status: WARN, problem: 'certificate expires in ' + days + ' days' });
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
  // One page must hold every document: deviceFreshness looks each fleet device
  // up by id, and a fleet document pushed onto a second page would read as a
  // device that never enrolled.
  const url =
    'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents/devices?pageSize=100';
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
  });
  if (!res.ok) return { status: FAIL, problem: 'Firestore read returned HTTP ' + res.status };
  const data = await res.json().catch(() => ({}));
  const docs = data.documents || [];
  // Documents, not devices: the collection holds more than the fleet (see
  // DEVICE_IDS in broker.js), and this line once said "5 device docs".
  return {
    status: OK,
    detail: docs.length + ' documents in ' + FIRESTORE_DB + '/devices; ' + splitFleet(docs).fleet.length
      + ' of ' + DEVICE_IDS.length + ' fleet devices present',
    _docs: docs,
  };
}

/**
 * Device freshness, derived from the same Firestore read the `firestore` probe
 * already made — a second read would double the latency for the same bytes.
 * Deliberately separate from the Firestore light: the store being reachable and
 * a daemon still reporting are different facts, and conflating them is how a
 * dead phone hides behind a healthy database.
 *
 * Judged PER DEVICE, never fleet-max. The old code took the single newest
 * lastSeen across every device and reported one verdict, so one live device
 * painted the whole tier green while the other three were dead for days — the
 * same masking the `byPath` split fixed for the assets probe. Here each device
 * earns its own light and the tier takes the worst (`worst()` below), so a dead
 * daemon can never hide behind a live one. `byDevice` carries the per-device
 * breakdown for the panel; the top-line `problem` names the ones that are down.
 *
 * Three rules make a light earnable:
 *
 *   1. A heartbeat dated in the FUTURE is a failure, not a fresh reading. The
 *      old arithmetic produced a negative age, and every threshold below it
 *      was "not exceeded", so a writer that set its own timestamp to tomorrow
 *      read as perfectly alive.
 *   2. The S24 is judged by the shared attestation policy in
 *      `lib/s24-attestation.js`, not by this file's own idea of liveness. The
 *      panel, the dashboard and the jp-agent must never disagree about
 *      whether the phone is alive.
 *   3. Every fleet device is judged even when it has no document at all, so a
 *      device that never enrolled cannot drop out of the denominator.
 */
export function deviceFreshness(firestoreResult, options = {}) {
  if (firestoreResult.status !== OK) {
    return { status: UNKNOWN, problem: 'cannot read device docs — Firestore probe did not succeed' };
  }
  // The fleet, not the collection. The collection also holds a test agent and
  // a stray watcher doc (DEVICE_IDS in broker.js says why neither is a
  // device), and judging every document made this verdict speak of five
  // devices when there are three.
  const docById = new Map(splitFleet(firestoreResult._docs).fleet.map((d) => [d.name.split('/').pop(), d]));

  const now = Number(options.nowMs) || Date.now();

  const per = DEVICE_IDS.map((id) => {
    const d = docById.get(id);
    if (!d) return { id, status: WARN, mins: null, reason: id + ' has no device document (never enrolled)' };
    const fields = decodeFirestoreDocument(d);
    const raw = fields.lastSeen;
    const t = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(t)) {
      return { id, status: WARN, mins: null, reason: id + ' has no readable lastSeen (never reported)' };
    }
    if (t > now) {
      return {
        id, status: FAIL, mins: null, future: true,
        reason: id + ' reports a heartbeat in the future (' + raw + ') — a clock that runs ahead is not evidence of life',
      };
    }
    const mins = Math.floor((now - t) / 60000);

    // The S24 is the one device whose liveness is attested rather than
    // assumed. Everything else in the fleet writes its own document and the
    // broker accepts it only after verifying the device's signature against
    // the enrolled hardware, so freshness plus the document's identity is the
    // whole of its evidence.
    if (id === S24_DEVICE_ID) {
      const live = computeS24Liveness(fields, now, { heartbeatMaxAgeSeconds: S24_FRESHNESS_BOUND_SECONDS });
      const liveness = live.liveness;
      const base = {
        id,
        mins,
        agentVersion: fields.agentVersion || null,
        evidence: liveness.evidenceMode,
        failedCheck: liveness.failedCheck,
      };
      if (liveness.live) {
        return { ...base, status: OK, reason: null };
      }
      // The heartbeat is authentic but older than the attestation's own
      // five-minute bound. That is a staleness question, not an identity
      // question, so it is banded like any other stale device rather than
      // called a broken one.
      const identityOnly = liveness.failedCheck === 'heartbeatFresh';
      if (identityOnly && mins <= 60) {
        return {
          ...base,
          status: mins > 15 ? WARN : OK,
          reason: id + ' heartbeat ' + mins + ' min old — attested, but outside the reporting window',
        };
      }
      return {
        ...base,
        status: FAIL,
        reason: id + ' is not proven live — ' + (liveness.reason || 'attestation failed') +
          ' (reported as "' + (fields.agentVersion || 'unknown') + '" over ' + (fields.connectionMethod || 'an unknown channel') + ')',
      };
    }

    if (mins > 60) return { id, status: FAIL, mins, reason: id + ' heartbeat ' + mins + ' min old' };
    if (mins > 15) return { id, status: WARN, mins, reason: id + ' heartbeat ' + mins + ' min old' };
    return { id, status: OK, mins, agentVersion: fields.agentVersion || null, evidence: 'broker-signed', failedCheck: null };
  });

  const byDevice = {};
  for (const p of per) {
    byDevice[p.id] = {
      status: p.status,
      mins: p.mins,
      agentVersion: p.agentVersion || null,
      evidence: p.evidence || null,
      failedCheck: p.failedCheck || null,
    };
  }
  const status = worst(per.map((p) => p.status));
  const down = per.filter((p) => p.status !== OK);

  if (status === FAIL) {
    return {
      status: FAIL,
      problem: down.length + ' of ' + per.length + ' device(s) not reporting — ' + down.map((p) => p.reason).join('; ')
        + '; a daemon has stopped and no cloud-side change fixes this',
      byDevice,
    };
  }
  if (status === WARN) {
    return {
      status: WARN,
      problem: down.map((p) => p.reason).join('; ') + ' — may be throttled or sleeping',
      byDevice,
    };
  }
  const newestMins = per.reduce((a, p) => (p.mins != null && p.mins < a ? p.mins : a), Infinity);
  return { status: OK, detail: 'all ' + per.length + ' device(s) fresh; newest heartbeat ' + newestMins + ' min ago', byDevice };
}

async function probeBlob() {
  const token = _env['BLOB_' + 'READ_WRITE_TOKEN'] || _env['BLOB_' + 'TOKEN'];
  const storeId = _env['BLOB_' + 'STORE_ID'];
  if (!token && !storeId) {
    return { status: UNKNOWN, problem: 'no Blob token or OIDC store connection is configured on this deployment' };
  }
  try {
    const { list } = await import('@vercel/blob');
    // OIDC-connected projects receive a short-lived credential at runtime. Keep
    // the token branch for legacy/local deployments, but never require it here.
    const res = await list(token ? { token, limit: 1 } : { limit: 1 });
    const sample = res && res.blobs ? res.blobs.length : 0;
    const more = res && res.hasMore ? ' (more paginated)' : '';
    return { status: OK, detail: 'Vercel Blob reachable' + (token ? '' : ' through OIDC') + ' — sample of ' + sample + more };
  } catch (e) {
    const name = e && e.name ? e.name : 'Error';
    const msg = String((e && e.message) || e).slice(0, 140);
    return { status: FAIL, problem: 'Vercel Blob list failed: ' + name + ' - ' + msg };
  }
}

/**
 * Are the dashboard's own pages actually reaching a browser?
 *
 * These nine files used to be `static` — permanently grey — on the reasoning in
 * stack-map.js that a function cannot prove a file exists, because Vercel
 * traces each handler into a bundle and `fs` inside one sees that bundle, not
 * the repo. That is true, and it was answering the wrong question. Nobody cares
 * whether those bytes sit on a disk; they care whether the page loads. That is
 * a request, and a request is exactly what this function can make — the same
 * class of evidence as `probeAgent`, which believes the jp-agent only when nginx
 * answers it.
 *
 * So each file carries the URL the edge serves it at and the probe HEADs it:
 * 200 with a non-empty body is the light, anything else is reported with the
 * status it actually returned. Six of those paths are rewrites declared in
 * vercel.json (/s24, /vivobook, /agent, /db, /jteka, /viewer). Drop the routing
 * table and those 404 while /template.html still answers through the catch-all,
 * which is why vercel.json takes its light from the rewrites rather than from a
 * fetch of its own.
 *
 * Failures are per path, not per probe. One layer-wide verdict would paint all
 * nine red because /viewer 404'd, and a red light on index.html that means
 * "some other page is missing" is the same lie as a green one that means
 * nothing — so `byPath` gives each file its own status and buildLayers prefers
 * it when present.
 *
 * The target is the production apex, never VERCEL_URL. Preview deployments sit
 * behind Vercel's deployment protection and answer 302 to vercel.com/sso-api on
 * every path, so a probe pointed at its own deployment would paint the whole
 * tier red on each preview while production was serving perfectly well.
 *
 * Cached for ASSETS_TTL_MS: the panel polls every 10 s, and this is the one
 * probe whose answer cannot change between deploys — a page served now is
 * served until the next one, unlike a database connection that can drop at any
 * moment. Without it every open dashboard tab would put a steady 1 req/s of
 * HEADs on the origin to re-learn a constant.
 */
const ASSETS_TTL_MS = 30000;
let _assetsCache = null;

/**
 * `content-length` is absent on a chunked or compressed response, and
 * `Number(null)` is 0, not NaN — so reading it naively makes a perfectly well
 * served page report itself as an empty body, which would redden the file and,
 * through `cloud_fail`, the health-check gate in CI. A length nobody declared
 * has to stay unknown rather than collapse to zero.
 */
function declaredLength(res) {
  const raw = res.headers.get('content-length');
  return raw === null ? NaN : Number(raw);
}

async function fetchStatus(url) {
  const opts = {
    redirect: 'follow',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
    headers: { 'user-agent': 'jpbir-stack-probe' },
  };
  let res = await fetch(url, { ...opts, method: 'HEAD' });
  // A 405 is a verdict on the method, not on the asset. Re-ask with GET before
  // calling a served page broken; cancel the body so nothing is downloaded.
  if (res.status === 405) {
    res = await fetch(url, opts);
    const length = declaredLength(res);
    if (res.body) await res.body.cancel().catch(() => {});
    return { status: res.status, length };
  }
  return { status: res.status, length: declaredLength(res) };
}

export async function probeAssets() {
  if (_assetsCache && Date.now() - _assetsCache.at < ASSETS_TTL_MS) return _assetsCache.result;

  const origin = 'https://' + HOSTS.apex;
  const targets = allFiles().filter((f) => f.probe === 'assets' && f.url);
  const byPath = {};

  const checked = await Promise.all(
    targets.map(async (f) => {
      try {
        const { status, length } = await fetchStatus(origin + f.url);
        if (status !== 200) {
          return { f, status: FAIL, problem: origin + f.url + ' returned HTTP ' + status };
        }
        // A 200 that carries nothing is a broken deploy wearing a success code.
        if (Number.isFinite(length) && length === 0) {
          return { f, status: FAIL, problem: origin + f.url + ' served 200 with an empty body' };
        }
        const size = Number.isFinite(length) ? ' (' + Math.max(1, Math.round(length / 1024)) + ' KB)' : '';
        return { f, status: OK, detail: 'HTTP 200 from ' + f.url + size };
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 140);
        return { f, status: FAIL, problem: 'GET ' + origin + f.url + ' failed: ' + msg };
      }
    })
  );

  for (const c of checked) {
    byPath[c.f.path] = { status: c.status, problem: c.problem || '', detail: c.detail || '' };
  }

  // vercel.json has no URL of its own — the rewrites resolving IS its evidence.
  const rewrites = checked.filter((c) => c.f.rewrite);
  const brokenRewrites = rewrites.filter((c) => c.status !== OK);
  byPath['vercel.json'] = brokenRewrites.length
    ? {
        status: FAIL,
        problem:
          brokenRewrites.length +
          ' of ' +
          rewrites.length +
          ' routed paths did not resolve (' +
          brokenRewrites.map((c) => c.f.url).join(', ') +
          ') — check the routes table',
        detail: '',
      }
    : { status: OK, problem: '', detail: rewrites.length + ' rewritten paths resolve' };

  const statuses = Object.values(byPath).map((v) => v.status);
  const failed = statuses.filter((s) => s !== OK).length;
  const result = {
    status: worst(statuses),
    detail: statuses.length - failed + '/' + statuses.length + ' served by ' + HOSTS.apex,
    problem: failed ? failed + ' of ' + statuses.length + ' paths did not serve — see each file' : '',
    byPath,
  };

  _assetsCache = { at: Date.now(), result };
  return result;
}

function probeEnv() {
  const isPresent = (v) => [v.name, ...(Array.isArray(v.alt) ? v.alt : [v.alt])]
    .filter(Boolean)
    .some((name) => Boolean(_env[name]));
  const missing = REQUIRED_ENV.filter((v) => !isPresent(v));
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

/**
 * The nightly DynamoDB -> Neon warehouse repair (`/api/db-push`, cron 18:30 UTC).
 *
 * It is the only path that carries telemetry still journalled in DynamoDB into
 * the Neon warehouse every dashboard read is served from, and nothing watched
 * it: health-check.yml probes `/`, `/api/jp-devices`, `/api/jp-stats`,
 * `/api/verify-db` and `/api/jp-stack`, so a cron handler that refuses to start
 * is invisible from CI — the gap INSPECTION_2026-09-19 §3.3 recorded as "a
 * silent `db-push` failure is undetectable". On 2026-10-14 the backfill run
 * answered 503 `JP_AWS_* read credentials not configured`, and the committed env
 * manifest shows those names absent from the deployment while `JP_AWS_REGION`
 * and `JP_TELEMETRY_TABLE` are set. The repair had been failing nightly with no
 * light on any panel and no failing check.
 *
 * Configuration, not freshness, is what a serverless function can prove here: a
 * completed pass DELETES its checkpoint row (`clearSyncCursor`), so "no
 * checkpoint" cannot be told apart from "finished this morning". The credential
 * pair the cron's `action=push` reads is the honest signal, and an unset one is
 * a red light, not a warning — the job cannot run at all.
 */
const REPAIR_READ_CREDS = ['JP_AWS_' + 'ACCESS_KEY_ID', 'JP_AWS_' + 'SECRET_ACCESS_KEY'];
const REPAIR_WRITE_CREDS = ['JP_WRITE_AWS_' + 'ACCESS_KEY_ID', 'JP_WRITE_AWS_' + 'SECRET_ACCESS_KEY'];

export function probeRepair() {
  const missing = REPAIR_READ_CREDS.filter((name) => !_env[name]);
  if (missing.length) {
    return {
      status: FAIL,
      // Names only, never a value.
      problem: missing.join(', ') +
        ' unset — the nightly DynamoDB -> Neon repair cannot run, so rows still journalled in DynamoDB (the jaytibirthday.in property among them) never reach the warehouse the dashboard reads',
    };
  }
  const writeMissing = REPAIR_WRITE_CREDS.filter((name) => !_env[name]);
  return {
    status: OK,
    detail: 'read credentials present' + (writeMissing.length
      ? '; ' + writeMissing.join(', ') + ' unset, so only the read-credential scan runs'
      : ' and write credentials present'),
  };
}

// ---------------------------------------------------------------- assembly

/**
 * The CI evidence store.
 *
 * `Devices/S24/runtime_contract.json` and `Database/scripts/migrate.mjs` used
 * to sit on a probe that returned `unknown` forever, with the reason "no live
 * signal reachable from a serverless function". The proof for those two rows
 * does not have to come from a request handler: a protected CI job runs the
 * checks that can be run outside one and publishes a signed receipt. This
 * reads those receipts; `lib/stack-evidence.js` decides whether they are
 * trustworthy.
 */
async function readEvidenceBundle() {
  const base = firestoreBase();
  if (!base) {
    return { available: false, reason: 'FIREBASE_SERVICE_ACCOUNT_JSON is not set on this deployment', receipts: {} };
  }
  try {
    const token = await getFirestoreToken();
    const res = await fetch(base + '/' + EVIDENCE_DOC, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
    });
    if (!res.ok) return { available: false, reason: 'the CI evidence store answered HTTP ' + res.status, receipts: {} };
    const doc = await res.json().catch(() => ({}));
    return { available: true, reason: null, receipts: decodeFirestoreDocument(doc) };
  } catch (e) {
    return {
      available: false,
      reason: 'the CI evidence store could not be read: ' + String((e && e.message) || e).slice(0, 120),
      receipts: {},
    };
  }
}

/** The revision this deployment is running, when the platform tells us. */
function runningRevision() {
  return _env['VERCEL_' + 'GIT_COMMIT_SHA'] || _env['STACK_' + 'SOURCE_REVISION'] || null;
}

/**
 * The CI receipt for this subject AND this source revision.
 *
 * Receipts are kept per revision rather than as one current document, because
 * a receipt for revision Y says nothing about revision X. A single slot would
 * mean that publishing evidence for a new commit silently invalidated the
 * evidence of the commit still running in production — and the production
 * row would go unproven for a reason that has nothing to do with the
 * product.
 */
function receiptFor(evidence, subjectKey, revision) {
  const bundle = (evidence.receipts || {})[subjectKey];
  if (!bundle || !bundle.revisions) return null;
  if (!revision) return null;
  return bundle.revisions[revision] || null;
}

/**
 * The S24 runtime contract: the contract in this repository, AND the device
 * actually running it.
 *
 * A contract file in a repo proves that a file exists. It does not prove the
 * phone runs it — and on 2026-10-21 the live S24 reported
 * `s24-termux-https-worker-2026-07-27.1` over `termux-direct-cloud`, which is
 * the legacy collector, not the signed broker daemon the contract requires.
 * So this probe needs both halves: CI evidence that the contract and its
 * bundle are what this build ships, and a live attested device reporting the
 * contracted release.
 */
export function probeRuntimeContract(input = {}) {
  const evidence = input.evidence || {};
  if (!evidence.available) {
    return { status: UNKNOWN, problem: 'the CI evidence store is unreachable: ' + (evidence.reason || 'unknown') };
  }
  if (!input.revision) {
    return { status: UNKNOWN, problem: 'the running source revision is unknown, so no CI evidence can be bound to it' };
  }
  const receipt = receiptFor(evidence, 'runtimeContract', input.revision);
  const verdict = verifyReceipt(receipt, 'runtime-contract', {
    nowMs: input.nowMs,
    key: _env['STACK_EVIDENCE_' + 'KEY'],
    expectedRevision: input.revision,
  });
  if (!verdict.valid) {
    return { status: UNKNOWN, problem: verdict.reason };
  }

  const device = (input.devices && input.devices.byDevice) || {};
  const s24 = device[S24_DEVICE_ID];
  if (!s24 || s24.status !== OK) {
    return {
      status: UNKNOWN,
      problem: 'the device has not attested the runtime contract (the S24 is ' + (s24 ? s24.status : 'absent') + ')',
    };
  }
  const reported = s24.agentVersion || '';
  if (reported !== S24_CONTRACT.release) {
    return {
      status: UNKNOWN,
      problem: 'the device reports "' + reported + '", not the contracted release "' + S24_CONTRACT.release + '"',
    };
  }
  return {
    status: OK,
    detail: 'CI evidence verified and the device reports the contracted release ' + S24_CONTRACT.release,
  };
}

/**
 * The migration tooling: the runner, its plan library and the schema it
 * applies, proven by a CI run against an isolated database.
 *
 * A receipt alone is not enough, and neither is a green schema: the proof is
 * a fresh apply followed by a second run that changes nothing, plus the
 * ledger reconciliation for the target. All three are named checks in the
 * receipt, so a receipt missing one of them leaves the row unproven.
 */
export function probeMigrationTooling(input = {}) {
  const evidence = input.evidence || {};
  if (!evidence.available) {
    return { status: UNKNOWN, problem: 'the CI evidence store is unreachable: ' + (evidence.reason || 'unknown') };
  }
  if (!input.revision) {
    return { status: UNKNOWN, problem: 'the running source revision is unknown, so no CI evidence can be bound to it' };
  }
  const receipt = receiptFor(evidence, 'migrationTooling', input.revision);
  const verdict = verifyReceipt(receipt, 'migration-tooling', {
    nowMs: input.nowMs,
    key: _env['STACK_EVIDENCE_' + 'KEY'],
    expectedRevision: input.revision,
  });
  if (!verdict.valid) {
    return { status: UNKNOWN, problem: verdict.reason };
  }
  return {
    status: OK,
    detail: 'CI evidence verified: fresh apply, second-run no-op and ledger reconciliation passed',
  };
}

/** Worst-of, so a layer is only as green as its weakest file. */
const RANK = { [FAIL]: 3, [WARN]: 2, [UNKNOWN]: 1, [OK]: 0 };
export function worst(statuses) {
  return statuses.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), OK);
}

export function buildLayers(probes) {
  return LAYERS.map((layer) => {
    const files = layer.files.map((f) => {
      const registered = probes[f.probe] || { status: UNKNOWN, problem: 'no probe registered for "' + f.probe + '"' };
      // A probe may answer per file rather than with one verdict for all of
      // them (`assets` does). Where it has, that entry is the more specific
      // truth — one 404 must not repaint the eight pages that are being served.
      const p = (registered.byPath && registered.byPath[f.path]) || registered;
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
  const [dns, tlsR, postgres, firestore, blob, assets] = await Promise.all([
    withTimeout('DNS', probeDns()),
    withTimeout('TLS', probeTls()),
    withTimeout('Postgres', probePostgres()),
    withTimeout('Firestore', probeFirestore()),
    withTimeout('Blob', probeBlob()),
    withTimeout('assets', probeAssets()),
  ]);

  const now = Date.now();
  const devices = deviceFreshness(firestore, { nowMs: now });
  const evidenceRaw = await withTimeout('evidence', readEvidenceBundle());
  // withTimeout answers with a probe-shaped object when it gives up; the
  // evidence readers below expect their own shape, so normalise it here
  // rather than letting a timeout look like an empty receipt store.
  const evidence = evidenceRaw && evidenceRaw.available !== undefined
    ? evidenceRaw
    : { available: false, reason: (evidenceRaw && evidenceRaw.problem) || 'the CI evidence store did not answer', receipts: {} };
  const revision = runningRevision();

  const probes = {
    dns,
    tls: tlsR,
    postgres,
    firestore,
    blob,
    assets,
    env: probeEnv(),
    repair: probeRepair(),
    devices,
    'runtime-contract': probeRuntimeContract({ evidence, devices, revision, nowMs: now }),
    'migration-tooling': probeMigrationTooling({ evidence, revision, nowMs: now }),
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
  // Device freshness is the one red this stack cannot fix from the cloud —
  // devices phone home or they don't (see Devices/S24/runtime_contract.json:
  // no inbound listener exists by design). Counting it separately lets CI gate
  // on what a merge could actually have broken, while the panel and the alert
  // cron keep painting the stopped daemon red, loudly.
  const cloud_fail = flat.filter((f) => f.status === FAIL && f.probe !== 'devices').length;
  const fetched_at = new Date().toISOString();

  // The strict verdict, and the headline that no longer hides it.
  //
  // `overall` used to be `fail ? fail : warn ? warn : ok`, so a snapshot with
  // unproven rows and no failures read as "ok" — the panel painted itself
  // green over eight rows it could not prove. It is now the worst status any
  // row carries, unknown included, and `readiness` carries the release-facing
  // answer with the rows that are holding it up.
  const readiness = readinessOf(flat, { asOf: fetched_at });

  return {
    // Not "synced": this is when the server answered THIS poll.
    fetched_at,
    devices_note: DEVICES_NOTE,
    overall: readiness.overall,
    cloud_fail,
    summary,
    readiness,
    probes: Object.fromEntries(
      // byDevice, when a probe reports per device (deviceFreshness does), rides
      // along so the panel can show which daemon is down, not just that one is.
      Object.entries(probes).map(([k, v]) => [k, {
        status: v.status, problem: v.problem || '', detail: v.detail || '',
        ...(v.byDevice ? { byDevice: v.byDevice } : {}),
      }])
    ),
    layers,
  };
}

/**
 * The runtime-log line that says why a health-key verdict was not ok.
 *
 * The health-key response is bare on purpose (verdict and counts, see the
 * handler), and until this line existed nothing else was written either, so
 * every 503 in Vercel's logs was unexplained: on 2026-09-23 there was one per
 * health-check run on /api/jp-stack, and nothing to tell a dead cloud
 * dependency from a stopped phone daemon without opening the key-gated panel.
 * This names the failing and warning probe ids and
 * each non-ok device with its heartbeat age, which is enough to point at the
 * dependency. It still never carries a probe's `problem` or `detail` text:
 * those name hosts, tables and env vars, and a log drain can ship this line
 * anywhere. The device ids are the fleet's own (DEVICE_IDS in broker.js), but
 * this formats whatever snapshot it is handed, and a Firestore document id may
 * hold any character but "/", so ids are reduced to a safe alphabet before one
 * can forge a second log line.
 *
 * Error level only when a cloud probe failed. A stopped daemon is a device
 * fault no deploy can fix (see cloud_fail in snapshot), CI already reports it
 * as a warning, and paging on it at error level is how real errors get ignored.
 *
 * The summary counts are stack-map files, not devices: six files are bound to
 * the devices probe, so one stopped daemon reads fail=6. Printed as a bare
 * `fail=6` beside a list of three devices, that invites "six devices", so the
 * counts are named files_* and the device tally is its own field,
 * `devices_not_ok=<n>/<fleet size>`, which states the fleet size on every line.
 */
export function logVerdict(snap, log = console) {
  if (snap.overall === OK) return;
  const probes = snap.probes || {};
  const ids = (status) => Object.keys(probes).filter((k) => probes[k].status === status).join(',') || '-';
  const byDevice = (probes.devices && probes.devices.byDevice) || {};
  const fleet = Object.keys(byDevice);
  const notOk = fleet.filter((id) => byDevice[id].status !== OK);
  const devices = notOk
    .map((id) => id.replace(/[^\w.-]/g, '?') + ':' + (byDevice[id].mins == null ? 'never' : byDevice[id].mins + 'm'));
  log[snap.cloud_fail ? 'error' : 'warn']('[jp-stack] health verdict ' + snap.overall
    + ' verdict=' + ((snap.readiness && snap.readiness.verdict) || 'unproven')
    + ' cloud_fail=' + snap.cloud_fail
    + ' files_fail=' + snap.summary.fail + ' files_warn=' + snap.summary.warn + ' files_unknown=' + snap.summary.unknown
    + ' failing=' + ids(FAIL) + ' warning=' + ids(WARN)
    + (fleet.length ? ' devices_not_ok=' + notOk.length + '/' + fleet.length : '')
    + (devices.length ? ' devices=' + devices.join(',') : ''));
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

/**
 * The receipt only the SCHEDULER writes.
 *
 * `system/stackHealth` holds the last run of any kind, and the dashboard's
 * manual "check now" button writes to it too. That was how a browser could
 * refresh the proof that something runs unattended: the panel showed "24x7
 * cron ran 2 minutes ago" after a human had pressed the button, and the
 * outside monitor read the same field. A manual run cannot prove a schedule,
 * so the scheduler writes its own document and the manual run does not.
 */
export const CRON_NATIVE_DOC = 'system/stackHealthNative';

function firestoreBase() {
  if (!FIREBASE_SA_JSON) return null;
  const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents';
}

async function readReceipt(docName) {
  const base = firestoreBase();
  if (!base) return null;
  const token = await getFirestoreToken();
  const res = await fetch(base + '/' + docName, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS - 200),
  });
  if (!res.ok) return null;
  const fields = (await res.json()).fields || {};
  return {
    checked_at: fields.checkedAt?.timestampValue || fields.checkedAt?.stringValue || null,
    completed_at: fields.completedAt?.timestampValue || fields.completedAt?.stringValue || null,
    overall: fields.overall?.stringValue || null,
    verdict: fields.verdict?.stringValue || null,
    ready: fields.ready?.booleanValue === true,
    fail_count: Number(fields.failCount?.integerValue ?? 0),
    warn_count: Number(fields.warnCount?.integerValue ?? 0),
    unknown_count: Number(fields.unknownCount?.integerValue ?? 0),
    source: fields.source?.stringValue || 'cron',
    notification: fields.notification?.stringValue || null,
    executor: fields.executor?.stringValue || null,
  };
}

/**
 * Last run the SCHEDULER recorded, so the panel shows round-the-clock state
 * and not merely what this one browser has watched since it opened. Never
 * throws: a deployment with no Firestore still gets a live panel, it just
 * cannot prove the unattended loop is running — which the UI then says, rather
 * than implying coverage it does not have.
 */
export async function lastCronRun() {
  try {
    return await readReceipt(CRON_NATIVE_DOC);
  } catch {
    return null;
  }
}

/** Last run of any kind, including one a person started by hand. */
export async function lastRun() {
  try {
    return await readReceipt(CRON_DOC);
  } catch {
    return null;
  }
}

/**
 * The state of the unattended schedule.
 *
 * Judged from the NATIVE receipt only, so a manual run cannot make a dead
 * scheduler look alive.
 */
export async function scheduleSnapshot(nowMs = Date.now()) {
  const native = await lastCronRun();
  return scheduleState(native, nowMs, {
    cadenceMinutes: CRON_CADENCE_MINUTES,
    maxAgeMinutes: CRON_MAX_AGE_MINUTES,
  });
}

/**
 * Writes one run.
 *
 * Called only by stack-cron.js. `source` decides where it lands: 'cron' means
 * the platform scheduler drove this, anything else was started by a person.
 * Only the scheduler's run updates the native receipt, and only that receipt
 * is proof that the schedule is alive.
 *
 * The notification outcome is written WITH the run, not before it: a receipt
 * that says "the run happened" while the alert it triggered was never
 * delivered is exactly the half-truth this whole change exists to remove.
 */
export async function recordCronRun(snap, source, extra = {}) {
  const base = firestoreBase();
  if (!base) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured — cannot record the run');
  const token = await getFirestoreToken();
  const fields = {
    checkedAt: { timestampValue: snap.fetched_at },
    completedAt: { timestampValue: extra.completed_at || new Date().toISOString() },
    overall: { stringValue: snap.overall },
    verdict: { stringValue: (snap.readiness && snap.readiness.verdict) || 'unproven' },
    ready: { booleanValue: Boolean(snap.readiness && snap.readiness.ready) },
    failCount: { integerValue: String(snap.summary.fail) },
    warnCount: { integerValue: String(snap.summary.warn) },
    unknownCount: { integerValue: String(snap.summary.unknown) },
    okCount: { integerValue: String(snap.summary.ok) },
    source: { stringValue: source || 'cron' },
    notification: { stringValue: extra.notification || 'none' },
    executor: { stringValue: extra.executor || source || 'cron' },
  };
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const write = async (docName) => {
    const res = await fetch(base + '/' + docName + '?' + mask, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error('failed to record run: HTTP ' + res.status);
  };
  await write(CRON_DOC);
  if ((source || 'cron') === 'cron') await write(CRON_NATIVE_DOC);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Third, narrower credential, mirroring verify-db.js: CI may ask whether the
  // stack is healthy without the dashboard key ever living in a workflow. It
  // gets a verdict and counts — no file paths, no problem strings, since those
  // name internal hosts and env vars.
  if (secretEquals(req.headers['x-health-key'], _env['HEALTH_' + 'CHECK_KEY'])) {
    const snap = snapshot(await runProbes());
    // Only this branch logs. The dashboard branch below is polled every 10 s
    // while the panel is open and would bury the line; the health check runs on
    // a schedule, so one line per run is the useful rate.
    logVerdict(snap);
    const schedule = await scheduleSnapshot();
    return res.status(snap.overall === FAIL ? 503 : 200).json({
      success: snap.overall !== FAIL,
      overall: snap.overall,
      // cloud_fail is a bare count — no probe names, no reasons — so the CI
      // gate can stay green over a device nobody can reach from the cloud
      // without this response ever describing which device or why.
      cloud_fail: snap.cloud_fail,
      summary: snap.summary,
      // The strict verdict, and the schedule's own age. Both are non-sensitive
      // (counts, verdict names and timestamps) and both are what an outside
      // monitor needs to tell "the product is broken" from "the scheduler
      // stopped" — two different incidents with two different responders.
      readiness: {
        ready: snap.readiness.ready,
        verdict: snap.readiness.verdict,
        reason: snap.readiness.reason,
        scope: snap.readiness.scope,
      },
      schedule,
    });
  }

  if (!cronAuthorized(req) && !requireKey(req, res)) return;

  const [snap, cron, schedule, anyRun] = await Promise.all([
    runProbes().then(snapshot),
    lastCronRun(),
    scheduleSnapshot(),
    lastRun(),
  ]);
  res.status(200).json({ success: true, ...snap, last_cron_run: cron, last_run: anyRun, schedule });
}
