// The agent proxy spends Anthropic credits on every forwarded call, so pin down:
// it refuses before touching the network, fails closed when unconfigured,
// forwards an authorised query to <AGENT_API_URL>/query, and the routes that put
// it on jaytipargal.tech/agent exist in vercel.json.
//
// The read-only Hub / devices readout (Backend/jp-hub-state.js, /agent/state)
// shares the same gate and config and is pinned the same way below.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

process.env.STATS_KEY = 'k-test';
delete process.env.AGENT_API_URL;
delete process.env.AGENT_API_KEY;

const mkRes = () => ({
  statusCode: null, payload: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.payload = b; return this; },
});

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  const body = url.endsWith('/health')
    ? { status: 'ok', model: 'claude-test' }
    : url.endsWith('/state')
      ? { hub: 'jayti-agent-db', status: { ok: true, devices_active: 2, items_total: 10, items_unprocessed: 1 },
          devices: [{ device_id: 's24', device_type: 'phone', os: 'android', is_active: true, items: 10, unprocessed: 1, last_ingest: '2026-09-24T00:00:00Z' }] }
      : { query: 'q', response: 'hello', sources: 2, model: 'claude-test' };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const { default: handler } = await import('../../Backend/jp-live-agent.js');
const run = async (req) => { const res = mkRes(); await handler({ headers: {}, query: {}, ...req }, res); return res; };

let res = await run({ method: 'POST', body: { query: 'hi' } });
check('no key → 401', res.statusCode === 401, JSON.stringify(res.payload));
res = await run({ method: 'POST', headers: { 'x-stats-key': 'wrong' }, body: { query: 'hi' } });
check('wrong key → 401', res.statusCode === 401, JSON.stringify(res.payload));
check('refused calls never reach upstream', calls.length === 0, `${calls.length} fetch call(s)`);

res = await run({ method: 'POST', headers: { 'x-stats-key': 'k-test' }, body: { query: 'hi' } });
check('unconfigured URL → 503 naming AGENT_API_URL',
  res.statusCode === 503 && res.payload.missing?.includes('AGENT_API_URL'), JSON.stringify(res.payload));

process.env.AGENT_API_URL = 'https://vps.example/agent/';
res = await run({ method: 'POST', headers: { 'x-stats-key': 'k-test' }, body: { query: '' } });
check('empty query → 400', res.statusCode === 400, JSON.stringify(res.payload));

res = await run({ method: 'POST', headers: { 'x-stats-key': 'k-test' }, body: { query: 'hi', top_k: 3 } });
const q = calls.at(-1);
check('authorised query → 200 with upstream response',
  res.statusCode === 200 && res.payload.response === 'hello', JSON.stringify(res.payload));
check('forwards to <AGENT_API_URL>/query without a double slash', q?.url === 'https://vps.example/agent/query', q?.url);
check('forwards query and top_k', JSON.parse(q.init.body).query === 'hi' && JSON.parse(q.init.body).top_k === 3, q.init.body);
check('no X-API-Key header when AGENT_API_KEY is unset', !('X-API-Key' in q.init.headers), JSON.stringify(q.init.headers));

res = await run({ method: 'GET', query: { key: 'k-test', op: 'health' } });
check('health → upstream /health', res.statusCode === 200 && calls.at(-1).url === 'https://vps.example/agent/health',
  `${res.statusCode} ${calls.at(-1).url}`);

/* ---------- hub state (jp-hub-state.js) ---------- */
delete process.env.AGENT_API_URL;
delete process.env.AGENT_API_KEY;
const { default: stateHandler } = await import('../../Backend/jp-hub-state.js');
const runState = async (req) => { const res = mkRes(); await stateHandler({ headers: {}, query: {}, ...req }, res); return res; };
const before = calls.length;

res = await runState({ method: 'GET' });
check('state: no key → 401', res.statusCode === 401, JSON.stringify(res.payload));
res = await runState({ method: 'GET', headers: { 'x-stats-key': 'wrong' } });
check('state: wrong key → 401', res.statusCode === 401, JSON.stringify(res.payload));
res = await runState({ method: 'GET', headers: { 'x-stats-key': 'k-test' } });
check('state: unconfigured URL → 503 naming AGENT_API_URL',
  res.statusCode === 503 && res.payload.missing?.includes('AGENT_API_URL'), JSON.stringify(res.payload));
check('state: refused and unconfigured calls never reach upstream', calls.length === before, `${calls.length - before} fetch call(s)`);

process.env.AGENT_API_URL = 'https://vps.example/agent/';
process.env.AGENT_API_KEY = 'upstream-secret';
res = await runState({ method: 'GET', query: { key: 'k-test' } });
const s = calls.at(-1);
check('state: authorised GET → 200 passthrough of upstream state',
  res.statusCode === 200 && res.payload.success === true && res.payload.status?.devices_active === 2
    && res.payload.devices?.[0]?.device_id === 's24' && res.payload.hub === 'jayti-agent-db', JSON.stringify(res.payload));
check('state: hits exactly <AGENT_API_URL>/state', s?.url === 'https://vps.example/agent/state', s?.url);
check('state: sends X-API-Key from AGENT_API_KEY', s?.init?.headers?.['X-API-Key'] === 'upstream-secret', JSON.stringify(s?.init?.headers));
check('state: upstream call is a GET', !s?.init?.method || s.init.method === 'GET', s?.init?.method);

res = await runState({ method: 'POST', headers: { 'x-stats-key': 'k-test' }, body: {} });
check('state: POST → 405 with Allow: GET', res.statusCode === 405 && res.headers.Allow === 'GET', `${res.statusCode} ${JSON.stringify(res.headers)}`);
check('state: 405 never reaches upstream', calls.at(-1) === s, `${calls.length} fetch call(s)`);

globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
res = await runState({ method: 'GET', headers: { 'x-stats-key': 'k-test' } });
check('state: upstream non-2xx → 502 with upstream_status', res.statusCode === 502 && res.payload.upstream_status === 500, JSON.stringify(res.payload));
globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
res = await runState({ method: 'GET', headers: { 'x-stats-key': 'k-test' } });
check('state: upstream network failure → 502', res.statusCode === 502 && res.payload.success === false, JSON.stringify(res.payload));
delete process.env.AGENT_API_KEY;

/* ---------- routing ---------- */
const routes = vercel.routes;
const idx = (pred) => routes.findIndex(pred);
// A header-only route intentionally runs first with continue:true; the actual
// catch-all is the route that supplies a destination.
const catchAll = idx((r) => r.src === '/(.*)' && r.dest);
const page = idx((r) => r.src === '/agent');
check('/agent serves the chat page before the catch-all',
  page !== -1 && page < catchAll && routes[page].dest === '/Frontend/agent.html', `index ${page} vs ${catchAll}`);
for (const src of ['/agent/query', '/agent/health']) {
  const i = idx((r) => r.src === src);
  check(`${src} routes to jp-live-agent.js before the catch-all`,
    i !== -1 && i < catchAll && routes[i].dest.startsWith('Backend/jp-live-agent.js'), `index ${i}`);
}
{
  const i = idx((r) => r.src === '/agent/state');
  check('/agent/state routes to jp-hub-state.js before the catch-all',
    i !== -1 && i < catchAll && routes[i].dest === 'Backend/jp-hub-state.js', `index ${i} vs ${catchAll}`);
  check('jp-hub-state.js has a builds entry',
    (vercel.builds || []).some((b) => b.src === 'Backend/jp-hub-state.js' && b.use === '@vercel/node'), 'no @vercel/node build for Backend/jp-hub-state.js');
}
const agentHtml = (() => { try { return readFileSync(join(root, 'Frontend', 'agent.html'), 'utf8'); } catch { return ''; } })();
check('the chat page exists', agentHtml.includes('/agent/query'), 'Frontend/agent.html missing or not calling /agent/query');
check('the chat page loads the Hub / devices readout from /agent/state', agentHtml.includes("api('/agent/state')"), 'Frontend/agent.html never calls /agent/state');
check('the chat page renders source_docs citations', agentHtml.includes('source_docs'), 'Frontend/agent.html ignores source_docs');
check('the dashboard links to /agent as "Jayti Agent"',
  /<a class="nav-item" href="\/agent">[^<]*(<span[^>]*>[^<]*<\/span>)?\s*Jayti Agent<\/a>/.test(readFileSync(join(root, 'Frontend', 'index.html'), 'utf8')),
  'Frontend/index.html has no nav link to /agent');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
