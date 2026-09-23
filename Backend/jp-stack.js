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
import { LAYERS, REQUIRED_ENV, HOSTS, TLS_WARN_DAYS, PROBE_TIMEOUT_MS, DEVICES_NOTE, allFiles } from './lib/stack-map.js';
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
 *
 * Judged PER DEVICE, never fleet-max. The old code took the single newest
 * lastSeen across every device and reported one verdict, so one live device
 * painted the whole tier green while the other three were dead for days — the
 * same masking the `byPath` split fixed for the assets probe. Here each device
 * earns its own light and the tier takes the worst (`worst()` below), so a dead
 * daemon can never hide behind a live one. `byDevice` carries the per-device
 * breakdown for the panel; the top-line `problem` names the ones that are down.
 */
export function deviceFreshness(firestoreResult) {
  if (firestoreResult.status !== OK) {
    return { status: UNKNOWN, problem: 'cannot read device docs — Firestore probe did not succeed' };
  }
  const docs = firestoreResult._docs || [];
  if (!docs.length) return { status: WARN, problem: 'no device documents found in the devices collection' };

  const now = Date.now();
  const per = docs.map((d) => {
    const id = (d.name || '').split('/').pop() || 'unknown';
    const raw = d.fields?.lastSeen?.timestampValue || d.fields?.lastSeen?.stringValue;
    const t = raw ? new Date(raw).getTime() : 0;
    if (!t) return { id, status: WARN, mins: null, reason: id + ' has no readable lastSeen (never reported)' };
    const mins = Math.floor((now - t) / 60000);
    if (mins > 60) return { id, status: FAIL, mins, reason: id + ' heartbeat ' + mins + ' min old' };
    if (mins > 15) return { id, status: WARN, mins, reason: id + ' heartbeat ' + mins + ' min old' };
    return { id, status: OK, mins };
  });

  const byDevice = {};
  for (const p of per) byDevice[p.id] = { status: p.status, mins: p.mins };
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

/**
 * Real reachability probes for DynamoDB and Vercel Blob.
 *
 * These used to be credential-presence checks that returned UNKNOWN even when
 * the store was healthy - the Product engineering panel then rendered every
 * dynamo/blob file grey and the operator could not tell "credentials never
 * configured" from "table gone". Both stores expose a cheap catalog call that
 * does not depend on any fixture (DescribeTable and list-limit-1), so the
 * honest signal is now the round trip itself: OK on 200, FAIL on auth /
 * network error, UNKNOWN only when the credential is unset.
 *
 * The SDKs are imported lazily so a deployment with no DynamoDB or no Blob
 * still boots the handler in the cold path - the packages are optional-at-runtime
 * from this file's perspective (they are hard deps of jp-track / wa-blob-upload).
 */
async function probeDynamo() {
  const accessKeyId = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
  const secretAccessKey = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
  const region = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
  const table = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';
  if (!accessKeyId || !secretAccessKey) {
    return { status: UNKNOWN, problem: 'JP_AWS_ACCESS_KEY_ID / JP_AWS_SECRET_ACCESS_KEY not set on this deployment' };
  }
  try {
    const { DynamoDBClient, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({ region, credentials: { accessKeyId, secretAccessKey } });
    const res = await client.send(new DescribeTableCommand({ TableName: table }));
    const state = res.Table && res.Table.TableStatus;
    if (state !== 'ACTIVE') {
      return { status: WARN, problem: 'DynamoDB table ' + table + ' status is ' + (state || 'unknown') };
    }
    const items = res.Table && res.Table.ItemCount;
    return { status: OK, detail: table + ' ACTIVE in ' + region + (typeof items === 'number' ? ' (' + items + ' items)' : '') };
  } catch (e) {
    const name = e && e.name ? e.name : 'Error';
    const msg = String((e && e.message) || e).slice(0, 140);
    return { status: FAIL, problem: 'DynamoDB DescribeTable(' + table + ') failed: ' + name + ' - ' + msg };
  }
}

async function probeBlob() {
  const token = _env['BLOB_' + 'READ_WRITE_TOKEN'] || _env['BLOB_' + 'TOKEN'];
  if (!token) {
    return { status: UNKNOWN, problem: 'BLOB_READ_WRITE_TOKEN is not set on this deployment' };
  }
  try {
    const { list } = await import('@vercel/blob');
    const res = await list({ token, limit: 1 });
    const sample = res && res.blobs ? res.blobs.length : 0;
    const more = res && res.hasMore ? ' (more paginated)' : '';
    return { status: OK, detail: 'Vercel Blob reachable — sample of ' + sample + more };
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
 * class of evidence as `probeAgent`, which believes the droplet only when nginx
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
  const [dns, tlsR, agent, postgres, firestore, dynamo, blob, assets] = await Promise.all([
    withTimeout('DNS', probeDns()),
    withTimeout('TLS', probeTls()),
    withTimeout('agent', probeAgent()),
    withTimeout('Postgres', probePostgres()),
    withTimeout('Firestore', probeFirestore()),
    withTimeout('DynamoDB', probeDynamo()),
    withTimeout('Blob', probeBlob()),
    withTimeout('assets', probeAssets()),
  ]);

  const probes = {
    dns,
    tls: tlsR,
    agent,
    postgres,
    firestore,
    dynamo,
    blob,
    assets,
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
  // Device freshness is the one red this stack cannot fix from the cloud —
  // devices phone home or they don't (see Devices/S24/runtime_contract.json:
  // no inbound listener exists by design). Counting it separately lets CI gate
  // on what a merge could actually have broken, while the panel and the alert
  // cron keep painting the stopped daemon red, loudly.
  const cloud_fail = flat.filter((f) => f.status === FAIL && f.probe !== 'devices').length;
  return {
    // Not "synced": this is when the server answered THIS poll.
    fetched_at: new Date().toISOString(),
    devices_note: DEVICES_NOTE,
    overall: summary.fail ? FAIL : summary.warn ? WARN : OK,
    cloud_fail,
    summary,
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
 * anywhere. Device ids are Firestore document ids, which any character but "/"
 * may form, so they are reduced to a safe alphabet before they can forge a
 * second log line.
 *
 * Error level only when a cloud probe failed. A stopped daemon is a device
 * fault no deploy can fix (see cloud_fail in snapshot), CI already reports it
 * as a warning, and paging on it at error level is how real errors get ignored.
 */
export function logVerdict(snap, log = console) {
  if (snap.overall === OK) return;
  const probes = snap.probes || {};
  const ids = (status) => Object.keys(probes).filter((k) => probes[k].status === status).join(',') || '-';
  const byDevice = (probes.devices && probes.devices.byDevice) || {};
  const devices = Object.keys(byDevice)
    .filter((id) => byDevice[id].status !== OK)
    .map((id) => id.replace(/[^\w.-]/g, '?') + ':' + (byDevice[id].mins == null ? 'never' : byDevice[id].mins + 'm'));
  log[snap.cloud_fail ? 'error' : 'warn']('[jp-stack] health verdict ' + snap.overall
    + ' cloud_fail=' + snap.cloud_fail
    + ' fail=' + snap.summary.fail + ' warn=' + snap.summary.warn + ' unknown=' + snap.summary.unknown
    + ' failing=' + ids(FAIL) + ' warning=' + ids(WARN)
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
    // Only this branch logs. The dashboard branch below is polled every 10 s
    // while the panel is open and would bury the line; the health check runs on
    // a schedule, so one line per run is the useful rate.
    logVerdict(snap);
    return res.status(snap.overall === FAIL ? 503 : 200).json({
      success: snap.overall !== FAIL,
      overall: snap.overall,
      // cloud_fail is a bare count — no probe names, no reasons — so the CI
      // gate can stay green over a device nobody can reach from the cloud
      // without this response ever describing which device or why.
      cloud_fail: snap.cloud_fail,
      summary: snap.summary,
    });
  }

  if (!cronAuthorized(req) && !requireKey(req, res)) return;

  const [snap, cron] = await Promise.all([runProbes().then(snapshot), lastCronRun()]);
  res.status(200).json({ success: true, ...snap, last_cron_run: cron });
}
