// The architecture map behind the dashboard's "Product engineering" section.
//
// WHY A BAKED MANIFEST AND NOT A DIRECTORY WALK
//
// A serverless function cannot honestly answer "does Frontend/index.html exist
// right now?" — Vercel traces and bundles only the files a handler imports, so
// `fs` inside a function sees a bundle, not the repo. A walk would report
// "missing" for files that are deployed and fine, which is worse than no light
// at all. So the file list is committed here, and each file's light reports the
// LIVE health of the subsystem that file configures.
//
// That distinction is the whole contract of this module and the UI states it:
// a green light on `nginx-jp-agent.conf` means the droplet's nginx answered a
// request, NOT that those bytes are on disk. A file whose subsystem cannot be
// probed from a serverless function at all is `static` — rendered grey, never
// green, because a light that is always green is a light that tells you
// nothing. This is the same reasoning as `strictS24Liveness`: a status has to
// be attested by an independent signal or it does not get to claim health.
//
// Layer `kind` mirrors the operator's reference diagram: `flow` layers sit on
// the request path left-to-right, `support` layers are the "also needed" row.
// `devices` is ours and has no box in that diagram — see DEVICES_NOTE below.

// The reference diagram starts at "You / Browser". For jpbir that is wrong in a
// way that matters: the hardest input is not a browser, it is three device
// daemons pushing telemetry OUTBOUND on their own schedule. Nothing cloud-side
// can pull from them (`Devices/S24/runtime_contract.json` sets
// `transport.inboundListener: false`), so a dead daemon is invisible to every
// other probe here — nginx, TLS, Postgres and the functions all stay green
// while no new data arrives. That is exactly the failure this section exists to
// surface, so the tier gets a box even though the diagram has none.
export const DEVICES_NOTE =
  'Device-initiated only: nothing here can pull from a phone. A stale light means the daemon stopped, and no cloud-side change fixes it.';

/**
 * Probe ids. Each file below names the probe that governs its light.
 * `static` means "no live signal reachable from a function" — deliberately
 * never green.
 *
 * `assets` is the narrow exception to the walk-is-dishonest rule above. It does
 * not ask the filesystem anything; it asks the public edge for the file over
 * HTTPS and believes only the response. That is the same class of evidence as
 * `agent` (an HTTP round trip to the droplet), so the files it governs carry a
 * `url` — the path the edge serves them at, not the path they live at. Six of
 * those URLs are rewrites that exist only because `vercel.json` says so, which
 * is what lets that file leave `static` too.
 */
export const PROBES = ['dns', 'tls', 'agent', 'postgres', 'firestore', 'dynamo', 'blob', 'env', 'devices', 'assets', 'static'];

export const LAYERS = [
  {
    id: 'devices',
    title: 'Devices',
    subtitle: 'Daemons push out',
    kind: 'flow',
    note: DEVICES_NOTE,
    files: [
      { path: 'Devices/S24/runtime_contract.json', probe: 'static', why: 'Bans inbound listeners; hash-pinned bundle' },
      { path: 'Backend/device-heartbeat.js', probe: 'devices', why: 'Receives the daemon heartbeat' },
      { path: 'Backend/device-enroll.js', probe: 'devices', why: 'Enrols a device and its Keystore key' },
      { path: 'Backend/device-commands-poll.js', probe: 'devices', why: 'Daemon reads its command queue here' },
      { path: 'Backend/lib/s24-attestation.js', probe: 'devices', why: 'Writer-honest liveness signals' },
      { path: 'Backend/s24-ingest.js', probe: 'devices', why: 'Accepts telemetry + WhatsApp payloads' },
      { path: 'Backend/check-stale.js', probe: 'devices', why: 'Cron that flags a daemon gone quiet' },
    ],
  },
  {
    id: 'browser',
    title: 'You',
    subtitle: 'Browser',
    kind: 'flow',
    files: [
      // `rewrite: true` marks a URL that only resolves because vercel.json
      // routes it — the evidence that file's own light is built from.
      { path: 'Frontend/index.html', probe: 'assets', url: '/', why: 'This dashboard' },
      { path: 'Frontend/s24.html', probe: 'assets', url: '/s24', rewrite: true, why: 'S24 device page' },
      { path: 'Frontend/vivobook.html', probe: 'assets', url: '/vivobook', rewrite: true, why: 'VivoBook device page' },
      { path: 'Frontend/agent.html', probe: 'assets', url: '/agent', rewrite: true, why: 'Agent console' },
      { path: 'Frontend/db.html', probe: 'assets', url: '/db', rewrite: true, why: 'Database browser' },
      { path: 'Frontend/jteka.html', probe: 'assets', url: '/jteka', rewrite: true, why: 'Jteka page' },
      { path: 'Frontend/viewer.html', probe: 'assets', url: '/viewer', rewrite: true, why: 'Media viewer' },
      { path: 'Frontend/template.html', probe: 'assets', url: '/template.html', why: 'Page template' },
      { path: 'Frontend/jp-tracker.js', probe: 'assets', url: '/jp-tracker.js', why: 'Analytics beacon → DynamoDB' },
    ],
  },
  {
    id: 'dns',
    title: 'DNS',
    subtitle: 'Address lookup',
    kind: 'flow',
    files: [
      { path: 'vercel.json', probe: 'dns', why: 'Routes the apex domain' },
      { path: 'Server/jp-agent/README.md', probe: 'dns', why: 'Records the runner. A-record procedure' },
    ],
  },
  {
    id: 'web',
    title: 'Web server',
    subtitle: 'Vercel edge / nginx',
    kind: 'flow',
    files: [
      // No `url` of its own: this file IS the routing table, so what attests it
      // is that the clean paths it invents (/s24, /db, /viewer …) resolve at all.
      // `probeAssets` derives this entry from those rewritten fetches.
      { path: 'vercel.json', probe: 'assets', why: 'Vercel edge routing table' },
      { path: 'Server/jp-agent/nginx-jp-agent.conf', probe: 'agent', why: 'Sole ingress to the droplet' },
    ],
  },
  {
    id: 'app',
    title: 'Your app',
    subtitle: 'Functions / Node',
    kind: 'flow',
    files: [
      { path: 'Backend/_auth.js', probe: 'env', why: 'Dashboard key gate (fails closed)' },
      { path: 'Backend/jp-devices.js', probe: 'firestore', why: 'Device telemetry read' },
      { path: 'Backend/jp-device.js', probe: 'dynamo', why: 'Per-device analytics' },
      { path: 'Backend/jp-stats.js', probe: 'dynamo', why: 'Site analytics' },
      { path: 'Backend/jp-track.js', probe: 'dynamo', why: 'Event ingest' },
      { path: 'Backend/jp-visitor.js', probe: 'dynamo', why: 'Visitor dossier' },
      { path: 'Backend/jp-live-content.js', probe: 'postgres', why: 'Recent media + messages' },
      { path: 'Backend/jp-whatsapp.js', probe: 'postgres', why: 'WhatsApp chat index' },
      { path: 'Backend/agent-run.js', probe: 'agent', why: 'Proxies to the droplet' },
      { path: 'Server/jp-agent/server.mjs', probe: 'agent', why: 'Agent runtime, binds 127.0.0.1' },
      { path: 'Server/jp-agent/s24-tools.mjs', probe: 'agent', why: 'Firestore mailbox client' },
    ],
  },
  {
    id: 'db',
    title: 'Database',
    subtitle: 'Four stores',
    kind: 'flow',
    files: [
      { path: 'Integrations/postgres.js', probe: 'postgres', why: 'Pooled Neon client' },
      { path: 'Integrations/wa-store.js', probe: 'postgres', why: 'WhatsApp tables' },
      { path: 'Integrations/s24-store.js', probe: 'postgres', why: 'Device telemetry tables' },
      { path: 'Backend/verify-db.js', probe: 'postgres', why: 'Schema presence check' },
      { path: 'Backend/lib/ddb-scan.js', probe: 'dynamo', why: 'Bounded DynamoDB scan' },
      { path: 'Backend/lib/warehouse.js', probe: 'dynamo', why: 'Analytics table access' },
      { path: 'Backend/wa-blob-upload.js', probe: 'blob', why: 'Media bytes → Vercel Blob' },
      { path: 'Backend/wa-media.js', probe: 'blob', why: 'Serves media from Blob' },
      { path: 'Database/scripts/migrate.mjs', probe: 'static', why: 'Migration runner' },
    ],
  },
  {
    id: 'ssl',
    title: 'SSL cert',
    subtitle: 'The padlock',
    kind: 'support',
    files: [
      { path: 'Server/jp-agent/nginx-jp-agent.conf', probe: 'tls', why: "certbot rewrites this vhost's :443 block" },
    ],
  },
  {
    id: 'process',
    title: 'systemd',
    subtitle: 'Auto-restart',
    kind: 'support',
    files: [
      { path: 'Server/jp-agent/jp-agent.service', probe: 'agent', why: 'Restart=always, ProtectSystem=strict' },
      { path: 'Server/jp-agent/s24-mcp.service', probe: 'static', why: 'MCP server unit' },
      { path: 'Server/jp-agent/deploy.sh', probe: 'static', why: 'Installs the unit + vhost' },
    ],
  },
  {
    id: 'env',
    title: 'Env vars',
    subtitle: 'Secrets & config',
    kind: 'support',
    files: [
      { path: 'Backend/_auth.js', probe: 'env', why: 'Reads STATS_KEY' },
      { path: 'Backend/lib/cron-auth.js', probe: 'env', why: 'Reads CRON_SECRET' },
      { path: 'Server/jp-agent/sync-auth-token.py', probe: 'static', why: 'Token over stdin, never argv' },
    ],
  },
  {
    id: 'port',
    title: 'Open port',
    subtitle: 'Firewall rule',
    kind: 'support',
    files: [
      { path: 'Server/jp-agent/nginx-jp-agent.conf', probe: 'agent', why: 'ufw allows 22/80/443 only' },
    ],
  },
];

/**
 * Env vars whose PRESENCE this endpoint reports.
 *
 * Hardcoded on purpose. CLAUDE.md records that some env var NAMES in this
 * Vercel team embed secrets, so enumerating `Object.keys(process.env)` would
 * leak through the name alone. Only these names are ever named, and only as a
 * boolean — no value, no prefix, no length, not even masked.
 */
export const REQUIRED_ENV = [
  { name: 'STATS_KEY', layer: 'env', why: 'Dashboard auth; 503 when unset' },
  { name: 'DATABASE_URL', layer: 'db', why: 'Neon pooled endpoint', alt: 'POSTGRES_URL' },
  { name: 'FIREBASE_SERVICE_ACCOUNT_JSON', layer: 'db', why: 'Firestore access', alt: 'FIREBASE_SA_JSON' },
  { name: 'JP_AWS_ACCESS_KEY_ID', layer: 'db', why: 'DynamoDB analytics' },
  { name: 'JP_AWS_SECRET_ACCESS_KEY', layer: 'db', why: 'DynamoDB analytics' },
  { name: 'BLOB_READ_WRITE_TOKEN', layer: 'db', why: 'Vercel Blob media', alt: 'BLOB_TOKEN' },
  { name: 'JP_AGENT_TOKEN', layer: 'app', why: 'Droplet bearer token' },
  { name: 'CRON_SECRET', layer: 'env', why: 'Authenticates Vercel crons' },
];

/** Hostnames resolved by the `dns` probe. */
export const HOSTS = {
  apex: 'jaytipargal.tech',
  runner: 'runner.jaytipargal.tech',
};

/** Warn this many days before the TLS cert expires. Certbot renews at 30. */
export const TLS_WARN_DAYS = 21;

/** Every probe gets the same ceiling so one dead host cannot stall the poll. */
export const PROBE_TIMEOUT_MS = 4000;

/** Flat file list, deduplicated, with the layers each path appears in. */
export function allFiles() {
  const seen = new Map();
  for (const layer of LAYERS) {
    for (const f of layer.files) {
      const key = layer.id + '::' + f.path;
      seen.set(key, { ...f, layer: layer.id });
    }
  }
  return [...seen.values()];
}
