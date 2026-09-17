// The agent proxy spends Anthropic credits on every forwarded call, so pin down:
// it refuses before touching the network, fails closed when unconfigured,
// forwards an authorised query to <AGENT_API_URL>/query, and the routes that put
// it on agent.jaytipargal.tech exist in vercel.json.
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

/* ---------- routing ---------- */
const routes = vercel.routes;
const idx = (pred) => routes.findIndex(pred);
const catchAll = idx((r) => r.src === '/(.*)' && !r.has);
const hostRoot = idx((r) => r.src === '/' && r.has?.some((h) => h.type === 'host' && h.value === 'agent.jaytipargal.tech'));
check('agent.jaytipargal.tech / serves the chat page before the catch-all',
  hostRoot !== -1 && hostRoot < catchAll && routes[hostRoot].dest === '/Frontend/agent.html', `index ${hostRoot} vs ${catchAll}`);
for (const src of ['/agent/query', '/agent/health']) {
  const i = idx((r) => r.src === src);
  check(`${src} routes to jp-live-agent.js before the catch-all`,
    i !== -1 && i < catchAll && routes[i].dest.startsWith('Backend/jp-live-agent.js'), `index ${i}`);
}
check('the chat page exists', (() => { try { return readFileSync(join(root, 'Frontend', 'agent.html'), 'utf8').includes('/agent/query'); } catch { return false; } })(), 'Frontend/agent.html missing or not calling /agent/query');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
