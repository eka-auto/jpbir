// Live subsystem map for the dashboard's Product engineering panel. A light
// reflects a real probe, never merely that a source file exists in a bundle.
export const DEVICES_NOTE =
  'Device-initiated only: nothing here can pull from a phone. A stale light means the daemon stopped, and no cloud-side change fixes it.';

export const PROBES = ['dns', 'tls', 'postgres', 'firestore', 'blob', 'env', 'devices', 'assets', 'static'];

export const LAYERS = [
  {
    id: 'devices', title: 'Devices', subtitle: 'Daemons push out', kind: 'flow', note: DEVICES_NOTE,
    files: [
      { path: 'Devices/S24/runtime_contract.json', probe: 'static', why: 'Bans inbound listeners; hash-pinned bundle' },
      { path: 'Backend/device-heartbeat.js', probe: 'devices', why: 'Receives the daemon heartbeat' },
      { path: 'Backend/device-enroll.js', probe: 'devices', why: 'Enrols a device and its Keystore key' },
      { path: 'Backend/device-commands-poll.js', probe: 'devices', why: 'Daemon reads its command queue here' },
      { path: 'Backend/lib/s24-attestation.js', probe: 'devices', why: 'Writer-honest liveness signals' },
      { path: 'Backend/s24-ingest.js', probe: 'devices', why: 'Accepts signed device payloads' },
      { path: 'Backend/check-stale.js', probe: 'devices', why: 'Cron that flags a daemon gone quiet' },
    ],
  },
  {
    id: 'browser', title: 'You', subtitle: 'Browser', kind: 'flow',
    files: [
      { path: 'Frontend/index.html', probe: 'assets', url: '/', why: 'This dashboard' },
      { path: 'Frontend/s24.html', probe: 'assets', url: '/s24', rewrite: true, why: 'S24 device page' },
      { path: 'Frontend/vivobook.html', probe: 'assets', url: '/vivobook', rewrite: true, why: 'VivoBook device page' },
      { path: 'Frontend/agent.html', probe: 'assets', url: '/agent', rewrite: true, why: 'Analytics assistant' },
      { path: 'Frontend/db.html', probe: 'assets', url: '/db', rewrite: true, why: 'Database browser' },
      { path: 'Frontend/jteka.html', probe: 'assets', url: '/jteka', rewrite: true, why: 'Jteka page' },
      { path: 'Frontend/viewer.html', probe: 'assets', url: '/viewer', rewrite: true, why: 'Media viewer' },
      { path: 'Frontend/template.html', probe: 'assets', url: '/template.html', why: 'Page template' },
      { path: 'Frontend/jp-tracker.js', probe: 'assets', url: '/jp-tracker.js', why: 'Analytics beacon to Neon' },
    ],
  },
  {
    id: 'dns', title: 'DNS', subtitle: 'Address lookup', kind: 'flow',
    files: [{ path: 'vercel.json', probe: 'dns', why: 'Routes the apex domain' }],
  },
  {
    id: 'web', title: 'Web server', subtitle: 'Vercel edge', kind: 'flow',
    files: [{ path: 'vercel.json', probe: 'assets', why: 'Vercel edge routing table' }],
  },
  {
    id: 'app', title: 'Your app', subtitle: 'Functions / Node', kind: 'flow',
    files: [
      { path: 'Backend/_auth.js', probe: 'env', why: 'Dashboard key gate' },
      { path: 'Backend/jp-devices.js', probe: 'firestore', why: 'Device telemetry read' },
      { path: 'Backend/jp-device.js', probe: 'postgres', why: 'Per-device analytics' },
      { path: 'Backend/jp-stats.js', probe: 'postgres', why: 'Site analytics' },
      { path: 'Backend/jp-track.js', probe: 'postgres', why: 'Event ingest' },
      { path: 'Backend/jp-visitor.js', probe: 'postgres', why: 'Visitor dossier' },
      { path: 'Backend/jp-live-content.js', probe: 'postgres', why: 'Recent media + messages' },
      { path: 'Backend/jp-whatsapp.js', probe: 'postgres', why: 'WhatsApp chat index' },
    ],
  },
  {
    id: 'db', title: 'Database', subtitle: 'Neon, Firestore, Blob', kind: 'flow',
    files: [
      { path: 'Integrations/postgres.js', probe: 'postgres', why: 'Pooled Neon client' },
      { path: 'Integrations/wa-store.js', probe: 'postgres', why: 'WhatsApp tables' },
      { path: 'Integrations/s24-store.js', probe: 'postgres', why: 'Device telemetry tables' },
      { path: 'Backend/verify-db.js', probe: 'postgres', why: 'Schema presence check' },
      { path: 'Backend/lib/warehouse.js', probe: 'postgres', why: 'Neon analytics warehouse' },
      { path: 'Backend/wa-blob-upload.js', probe: 'blob', why: 'Media bytes to Vercel Blob' },
      { path: 'Backend/wa-media.js', probe: 'blob', why: 'Serves media from Blob' },
      { path: 'Database/scripts/migrate.mjs', probe: 'static', why: 'Migration runner' },
    ],
  },
  {
    id: 'ssl', title: 'SSL cert', subtitle: 'The padlock', kind: 'support',
    files: [{ path: 'vercel.json', probe: 'tls', why: 'Public apex certificate' }],
  },
  {
    id: 'env', title: 'Env vars', subtitle: 'Secrets & config', kind: 'support',
    files: [
      { path: 'Backend/_auth.js', probe: 'env', why: 'Reads STATS_KEY' },
      { path: 'Backend/lib/cron-auth.js', probe: 'env', why: 'Reads CRON_SECRET' },
    ],
  },
];

export const REQUIRED_ENV = [
  { name: 'STATS_KEY', layer: 'env', why: 'Dashboard auth; 503 when unset' },
  { name: 'DATABASE_URL', layer: 'db', why: 'Neon pooled endpoint', alt: 'POSTGRES_URL' },
  { name: 'FIREBASE_SERVICE_ACCOUNT_JSON', layer: 'db', why: 'Firestore access', alt: 'FIREBASE_SA_JSON' },
  { name: 'BLOB_READ_WRITE_TOKEN', layer: 'db', why: 'Vercel Blob media', alt: ['BLOB_TOKEN', 'BLOB_STORE_ID'] },
  { name: 'CRON_SECRET', layer: 'env', why: 'Authenticates Vercel crons' },
];

export const HOSTS = { apex: 'jaytipargal.tech' };
export const TLS_WARN_DAYS = 21;
export const PROBE_TIMEOUT_MS = 4000;

export function allFiles() {
  return LAYERS.flatMap((layer) => layer.files.map((file) => ({ ...file, layer: layer.id })));
}
