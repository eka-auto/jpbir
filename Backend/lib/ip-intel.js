const LOOKUP_TIMEOUT_MS = 1500;
const LOOKUP_BUDGET_MS = 2500;
const LOOKUP_CONCURRENCY = 6;
const CACHE_TTL_MS = 7 * 86400000;
const NEGATIVE_TTL_MS = 3600000;
const MAX_CACHE_ENTRIES = 500;

const cache = globalThis.__jpIpIntelCache || (globalThis.__jpIpIntelCache = new Map());

export function normalizeIp(value) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s || s === 'unknown') return null;
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

function isNonPublic(ip) {
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(ip)) return true;
    return false;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return true;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

export function parseAsnOrg(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const withOrg = text.match(/^AS(\d+)\s+(.+)$/i);
  if (withOrg) return { asn: Number(withOrg[1]), asOrganization: withOrg[2].trim() };
  const asnOnly = text.match(/^AS(\d+)$/i);
  if (asnOnly) return { asn: Number(asnOnly[1]), asOrganization: null };
  return { asn: null, asOrganization: text };
}

function readCache(ip) {
  const hit = cache.get(ip);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(ip);
    return undefined;
  }
  return hit.value;
}

function writeCache(ip, value, ttl) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(ip, { value, expires: Date.now() + ttl });
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function lookupRemote(ip, fetchImpl) {
  try {
    const body = await fetchJson(
      'https://ipwho.is/' + encodeURIComponent(ip) + '?fields=success,connection',
      fetchImpl
    );
    if (body && body.success && body.connection) {
      const asn = Number(body.connection.asn);
      const org = body.connection.org || body.connection.isp || null;
      if (Number.isInteger(asn) && asn > 0) return { asn, asOrganization: org };
      if (org) return { asn: null, asOrganization: org };
    }
  } catch {}

  try {
    const body = await fetchJson('https://ipinfo.io/' + encodeURIComponent(ip) + '/json', fetchImpl);
    const parsed = parseAsnOrg(body && body.org);
    if (parsed && (parsed.asn != null || parsed.asOrganization)) return parsed;
  } catch {}

  return null;
}

export async function lookupIp(value, opts = {}) {
  const ip = normalizeIp(value);
  if (!ip || isNonPublic(ip)) return null;
  const cached = readCache(ip);
  if (cached !== undefined) return cached;
  const result = await lookupRemote(ip, opts.fetch || globalThis.fetch);
  writeCache(ip, result, result ? CACHE_TTL_MS : NEGATIVE_TTL_MS);
  return result;
}

export async function resolveIps(values, opts = {}) {
  const ips = [];
  for (const value of values || []) {
    const ip = normalizeIp(value);
    if (!ip || isNonPublic(ip) || ips.includes(ip)) continue;
    ips.push(ip);
  }

  const out = new Map();
  const start = Date.now();
  let index = 0;

  async function run() {
    while (index < ips.length) {
      if (Date.now() - start > LOOKUP_BUDGET_MS) return;
      const ip = ips[index++];
      const intel = await lookupIp(ip, opts).catch(() => null);
      if (intel) out.set(ip, intel);
    }
  }

  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, ips.length) }, run));
  return out;
}

export function applyIntel(geo, intel) {
  if (!geo || typeof geo !== 'object' || !intel) return geo;
  if (geo.asn != null || geo.asOrganization) return geo;
  return { ...geo, ...intel };
}

export async function enrichEvents(events, opts = {}) {
  if (!Array.isArray(events) || !events.length) return 0;
  const ips = events.map(e => e && e.server_location && e.server_location.ip);
  const intel = await resolveIps(ips, opts);
  if (!intel.size) return 0;

  let changed = 0;
  for (const event of events) {
    const geo = event && event.server_location;
    if (!geo || !geo.ip) continue;
    const merged = applyIntel(geo, intel.get(normalizeIp(geo.ip)));
    if (merged !== geo) {
      event.server_location = merged;
      changed++;
    }
  }
  return changed;
}

export async function enrichGeo(geo, opts = {}) {
  if (!geo || !geo.ip) return geo;
  const intel = await resolveIps([geo.ip], opts);
  return applyIntel(geo, intel.get(normalizeIp(geo.ip)));
}

export function clearIpIntelCache() {
  cache.clear();
}
