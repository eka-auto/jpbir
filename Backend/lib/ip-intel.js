const LOOKUP_TIMEOUT_MS = 1500;
const LOOKUP_BUDGET_MS = 2500;
const LOOKUP_CONCURRENCY = 6;
const MIN_ATTEMPT_MS = 150;
const CACHE_TTL_MS = 7 * 86400000;
const NEGATIVE_TTL_MS = 3600000;
const MAX_CACHE_ENTRIES = 500;

const cache = globalThis.__jpIpIntelCache || (globalThis.__jpIpIntelCache = new Map());

class DeadlineExceeded extends Error {
  constructor() {
    super('lookup deadline exceeded');
    this.deadlineExceeded = true;
  }
}

class AttemptAborted extends Error {
  constructor() {
    super('lookup attempt aborted before the provider answered');
    this.attemptAborted = true;
  }
}

const isDeadline = (err) => err instanceof DeadlineExceeded || (err && err.deadlineExceeded === true);
const isAbort = (err) => err instanceof AttemptAborted ||
  (err && (err.name === 'TimeoutError' || err.name === 'AbortError'));

function expandIpv6(ip) {
  let s = ip;
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  if (s.indexOf('.') !== -1 && lastColon !== -1) {
    const quad = s.slice(lastColon + 1);
    if (quad.indexOf('.') !== -1) {
      const parts = quad.split('.');
      if (parts.length !== 4) return null;
      const nums = parts.map(Number);
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      s = s.slice(0, lastColon + 1) +
        ((nums[0] << 8) | nums[1]).toString(16) + ':' +
        ((nums[2] << 8) | nums[3]).toString(16);
    }
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (seg) => {
    if (seg === '') return [];
    const parts = seg.split(':');
    if (parts.some(p => !/^[0-9a-f]{1,4}$/.test(p))) return null;
    return parts.map(p => parseInt(p, 16));
  };
  const head = parse(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parse(halves[1]);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return head.concat(new Array(missing).fill(0), tail);
}

const dotted = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function embedToV4(groups) {
  if (groups[0] !== 0 || groups[1] !== 0 || groups[2] !== 0 || groups[3] !== 0 || groups[4] !== 0) return null;
  if (groups[5] === 0xffff) return dotted(groups[6], groups[7]);
  if (groups[5] === 0 && (groups[6] !== 0 || groups[7] !== 0)) return dotted(groups[6], groups[7]);
  return null;
}

export function normalizeIp(value) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s || s === 'unknown') return null;
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (s.indexOf(':') !== -1) {
    const groups = expandIpv6(s);
    if (groups) {
      const mapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
        groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff;
      if (s.indexOf('.') !== -1 || mapped) {
        const embedded = embedToV4(groups);
        if (embedded) return embedded;
      }
    }
    return s;
  }
  const parts = s.split('.');
  if (parts.length === 4 && parts.every(p => /^[0-9]{1,3}$/.test(p))) {
    const nums = parts.map(Number);
    if (nums.every(n => n <= 255)) return nums.join('.');
  }
  return s;
}

function isNonPublic(ip) {
  if (ip.includes(':')) {
    const groups = expandIpv6(ip);
    if (!groups) return true;
    const embedded = embedToV4(groups);
    if (embedded) return isNonPublic(embedded);
    if (groups[0] === 0x0064 && groups[1] === 0xff9b &&
      groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
      return isNonPublic(dotted(groups[6], groups[7]));
    }
    if (groups[0] === 0x2002) return isNonPublic(dotted(groups[1], groups[2]));
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
    if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;
    if (groups[0] >= 0xff00) return true;
    if ((groups[0] & 0xfe00) === 0xfc00) return true;
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
    if ((groups[0] & 0xffc0) === 0xfec0) return true;
    if (groups[7] === 1 && groups.slice(0, 7).every(z => z === 0)) return true;
    if (groups.every(z => z === 0)) return true;
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
  if (a === 192 && b === 0 && nums[2] === 2) return true;
  if (a === 198 && b === 51 && nums[2] === 100) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 203 && b === 0 && nums[2] === 113) return true;
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

async function fetchJson(url, fetchImpl, deadline) {
  const remaining = deadline - Date.now();
  if (remaining < MIN_ATTEMPT_MS) throw new DeadlineExceeded();
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(LOOKUP_TIMEOUT_MS, remaining))
    });
  } catch (err) {
    if (isAbort(err)) throw new AttemptAborted();
    throw err;
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function lookupRemote(ip, fetchImpl, deadline) {
  // Anything that stops before the provider gives a usable answer - abort,
  // HTTP fault, DNS failure, unparseable body - told us nothing about the
  // address and must never become the one-hour negative cache entry. Only a
  // provider that ANSWERED with no usable data counts as a completed failure.
  let uninformative = false;
  try {
    const body = await fetchJson(
      'https://ipwho.is/' + encodeURIComponent(ip) + '?fields=success,connection',
      fetchImpl,
      deadline
    );
    if (body && body.success && body.connection) {
      const asn = Number(body.connection.asn);
      const org = body.connection.org || body.connection.isp || null;
      if (Number.isInteger(asn) && asn > 0) return { asn, asOrganization: org };
      if (org) return { asn: null, asOrganization: org };
    }
  } catch (err) {
    if (isDeadline(err)) return undefined;
    uninformative = true;
  }

  try {
    const body = await fetchJson(
      'https://ipinfo.io/' + encodeURIComponent(ip) + '/json',
      fetchImpl,
      deadline
    );
    const parsed = parseAsnOrg(body && body.org);
    if (parsed && (parsed.asn != null || parsed.asOrganization)) return parsed;
    // A parsed 200 with no org at all is a completed "this provider has
    // nothing", unless the other attempt already failed uninformatively.
  } catch (err) {
    if (isDeadline(err)) return undefined;
    uninformative = true;
  }

  return uninformative ? undefined : null;
}

const pending = globalThis.__jpIpIntelPending || (globalThis.__jpIpIntelPending = new Map());

export async function lookupIp(value, opts = {}) {
  const ip = normalizeIp(value);
  if (!ip || isNonPublic(ip)) return null;
  const cached = readCache(ip);
  if (cached !== undefined) return cached;
  const inFlight = pending.get(ip);
  if (inFlight) {
    // The joiner keeps its OWN deadline: waiting on someone else's work must
    // not outlast this caller's budget. Whoever is owed the result on the
    // original promise still gets it - only the late joiner may walk away.
    const deadline = opts.deadline || Date.now() + 2 * LOOKUP_TIMEOUT_MS;
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
      if (typeof timer.unref === 'function') timer.unref();
    });
    try {
      return await Promise.race([inFlight, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  const work = (async () => {
    const deadline = opts.deadline || Date.now() + 2 * LOOKUP_TIMEOUT_MS;
    const result = await lookupRemote(ip, opts.fetch || globalThis.fetch, deadline);
    if (result === undefined) return null;
    writeCache(ip, result, result ? CACHE_TTL_MS : NEGATIVE_TTL_MS);
    return result;
  })();
  pending.set(ip, work);
  try {
    return await work;
  } finally {
    pending.delete(ip);
  }
}

export async function resolveIps(values, opts = {}) {
  const ips = [];
  for (const value of values || []) {
    const ip = normalizeIp(value);
    if (!ip || isNonPublic(ip) || ips.includes(ip)) continue;
    ips.push(ip);
  }

  const out = new Map();
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : LOOKUP_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let index = 0;

  async function run() {
    while (index < ips.length) {
      const ip = ips[index++];
      const intel = await lookupIp(ip, { ...opts, deadline }).catch(() => null);
      if (intel) out.set(ip, intel);
    }
  }

  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, ips.length) }, run));
  if (opts.stats && typeof opts.stats === 'object') {
    opts.stats.attempted = ips.length;
    opts.stats.resolved = out.size;
    opts.stats.over_budget = ips.length > 0 && Date.now() >= deadline;
  }
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
