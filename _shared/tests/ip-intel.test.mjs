import assert from 'node:assert';
import {
  applyIntel,
  clearIpIntelCache,
  enrichEvents,
  enrichGeo,
  lookupIp,
  normalizeIp,
  parseAsnOrg,
  resolveIps
} from '../../Backend/lib/ip-intel.js';

let pass = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('  ok  ' + name); })
    .catch(e => { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; });
}

const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
const urls = [];

function mockFetch(handler) {
  return (url) => {
    urls.push(url);
    return handler(url);
  };
}

const whois = org => json({ success: true, connection: { asn: 133275, org, isp: 'Example ISP' } });
const ipinfo = org => json({ org });

clearIpIntelCache();

await t('parseAsnOrg reads the ipinfo "AS<n> <org>" form', () => {
  assert.deepStrictEqual(parseAsnOrg('AS133275 Example ISP'), {
    asn: 133275,
    asOrganization: 'Example ISP'
  });
});

await t('parseAsnOrg keeps a bare AS number', () => {
  assert.deepStrictEqual(parseAsnOrg('AS55836'), { asn: 55836, asOrganization: null });
});

await t('parseAsnOrg treats a plain string as an org with no ASN', () => {
  assert.deepStrictEqual(parseAsnOrg('Example Carrier Ltd'), {
    asn: null,
    asOrganization: 'Example Carrier Ltd'
  });
});

await t('normalizeIp folds IPv4-mapped IPv6 and rejects the unknown sentinel', () => {
  assert.strictEqual(normalizeIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.strictEqual(normalizeIp('  8.8.8.8 '), '8.8.8.8');
  assert.strictEqual(normalizeIp('unknown'), null);
  assert.strictEqual(normalizeIp(''), null);
});

await t('private and reserved addresses are never sent to a lookup service', async () => {
  clearIpIntelCache();
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.1.4', '169.254.1.1', '100.64.0.1', '::1', 'fe80::1', 'fc00::1']) {
    assert.strictEqual(await lookupIp(ip), null);
  }
  assert.strictEqual(urls.length, 0);
});

await t('lookupIp resolves ASN and org through ipwho.is', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const intel = await lookupIp('8.8.8.8', { fetch: fetchImpl });
  assert.deepStrictEqual(intel, { asn: 133275, asOrganization: 'Example Network' });
  assert.ok(urls[0].startsWith('https://ipwho.is/8.8.8.8'));
});

await t('a resolved address is cached instead of looked up again', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  await lookupIp('8.8.8.8', { fetch: fetchImpl });
  await lookupIp('8.8.8.8', { fetch: fetchImpl });
  assert.strictEqual(urls.length, 1);
});

await t('ipinfo is used when ipwho.is fails', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(url => {
    if (url.startsWith('https://ipwho.is/')) return Promise.reject(new Error('down'));
    return ipinfo('AS133275 Example ISP');
  });
  const intel = await lookupIp('8.8.8.8', { fetch: fetchImpl });
  assert.deepStrictEqual(intel, { asn: 133275, asOrganization: 'Example ISP' });
  assert.strictEqual(urls.length, 2);
});

await t('a definitive no-data answer from both providers is negatively cached', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => json({ success: false, message: 'Reserved range' }));
  assert.strictEqual(await lookupIp('8.8.4.4', { fetch: fetchImpl }), null);
  assert.strictEqual(await lookupIp('8.8.4.4', { fetch: fetchImpl }), null);
  assert.strictEqual(urls.length, 2, 'the providers ANSWERED; the second call needs no request');
});

await t('transport faults are never recorded as completed failures', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const faulty = (url) => {
    urls.push(url);
    if (url.includes('ipinfo')) {
      return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
    }
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }));
  };
  assert.strictEqual(await lookupIp('9.8.7.6', { fetch: faulty }), null);
  assert.strictEqual(urls.length, 2, 'both providers tried');
  assert.strictEqual(await lookupIp('9.8.7.6', { fetch: faulty }), null);
  assert.strictEqual(urls.length, 4, 'a 429/DNS fault must not poison the cache for an hour');
});

await t('enrichEvents fills missing network fields and leaves existing ones alone', async () => {
  clearIpIntelCache();
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const events = [
    { server_location: { ip: '8.8.8.8', city: 'Test City' } },
    { server_location: { ip: '8.8.8.8', asn: 64500, asOrganization: 'Existing Network' } }
  ];
  const changed = await enrichEvents(events, { fetch: fetchImpl });
  assert.strictEqual(changed, 1);
  assert.deepStrictEqual(events[0].server_location, {
    ip: '8.8.8.8',
    city: 'Test City',
    asn: 133275,
    asOrganization: 'Example Network'
  });
  assert.strictEqual(events[1].server_location.asn, 64500);
  assert.strictEqual(events[1].server_location.asOrganization, 'Existing Network');
});

await t('enrichGeo resolves the summary network object', async () => {
  clearIpIntelCache();
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const geo = await enrichGeo({ ip: '8.8.8.8', city: 'Test City' }, { fetch: fetchImpl });
  assert.strictEqual(geo.asn, 133275);
  assert.strictEqual(geo.asOrganization, 'Example Network');
  assert.strictEqual(geo.city, 'Test City');
});

await t('applyIntel does nothing without an address match', () => {
  const geo = { ip: '8.8.8.8' };
  assert.strictEqual(applyIntel(geo, null), geo);
});

await t('resolveIps deduplicates repeated addresses', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const intel = await resolveIps(
    ['8.8.8.8', '8.8.8.8', '::ffff:8.8.8.8', '10.0.0.1'],
    { fetch: fetchImpl }
  );
  assert.strictEqual(intel.size, 1);
  assert.strictEqual(urls.length, 1);
});

await t('IPv6 multicast, expanded loopback and expanded mapped-private addresses are never sent', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const neverSent = [
    'ff02::1', 'ff00::fb', '0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', '::1',
    'fec0::1', '0:0:0:0:0:ffff:192.168.1.1', '::ffff:10.0.0.1',
    'fe80::1', 'fc00::1', 'fd00::1',
    '64:ff9b::10.0.0.1', '64:ff9b::192.168.1.1',
    '2002:0a00:1::', '2002:c0a8:101::1',
    '2001:db8::1', '100::1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1'
  ];
  for (const ip of neverSent) {
    assert.strictEqual(await lookupIp(ip), null, ip);
  }
  assert.strictEqual(urls.length, 0);
});

await t('unparseable IPv6 fails closed instead of being looked up', async () => {
  clearIpIntelCache();
  urls.length = 0;
  assert.strictEqual(await lookupIp('1::2::3'), null);
  assert.strictEqual(await lookupIp('fe80::zzzz'), null);
  assert.strictEqual(urls.length, 0);
});

await t('an expanded IPv4-mapped address folds onto its IPv4 lookup', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const intel = await lookupIp('0:0:0:0:0:ffff:8.8.8.8', { fetch: fetchImpl });
  assert.deepStrictEqual(intel, { asn: 133275, asOrganization: 'Example Network' });
  assert.ok(urls[0].includes('8.8.8.8'), urls[0]);
  assert.strictEqual(normalizeIp('0:0:0:0:0:ffff:8.8.8.8'), '8.8.8.8');
});

await t('the budget caps the whole run, and skipped addresses are not poisoned', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const slowFetch = () => new Promise(resolve => setTimeout(() => resolve({
    ok: true, status: 200,
    json: async () => ({ success: true, connection: { asn: 133275, org: 'Slow Net' } })
  }), 400));
  const ips = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '104.16.0.1', '1.2.3.4', '5.6.7.8'];
  const started = Date.now();
  const first = await resolveIps(ips, { fetch: slowFetch, budgetMs: 300 });
  const elapsed = Date.now() - started;
  assert.ok(first.size <= 6, 'only in-flight workers may be fetched, got ' + first.size);
  assert.ok(first.size < ips.length, 'the budget must cut the run short');
  assert.ok(elapsed < 3000, 'the run took ' + elapsed + 'ms');
  const second = await resolveIps(ips, { fetch: slowFetch });
  assert.strictEqual(second.size, ips.length, 'addresses skipped by the budget resolve normally later');
});

await t('an aborted attempt is never recorded as a completed failure', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const aborting = (url) => {
    urls.push(url);
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
  };
  assert.strictEqual(await lookupIp('7.7.7.7', { fetch: aborting }), null);
  assert.strictEqual(urls.length, 2, 'both providers were tried');
  assert.strictEqual(await lookupIp('7.7.7.7', { fetch: aborting }), null);
  assert.strictEqual(urls.length, 4, 'an aborted lookup must not be negative-cached for an hour');
});

await t('a NAT64 address of a public IPv4 is looked up while its private twin is not', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const intel = await lookupIp('64:ff9b::8.8.8.8', { fetch: fetchImpl });
  assert.strictEqual(intel && intel.asn, 133275);
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(await lookupIp('64:ff9b::10.0.0.1', { fetch: fetchImpl }), null);
  assert.strictEqual(urls.length, 1, 'the private embed never reaches a provider');
});

await t('one host has exactly one cache key across every spelling', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  await resolveIps(
    ['8.8.8.8', '008.8.8.8', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:8.8.8.8', '::ffff:808:808'],
    { fetch: fetchImpl }
  );
  assert.strictEqual(urls.length, 1, 'five spellings, one request');
  assert.strictEqual(normalizeIp('008.8.8.8'), '8.8.8.8');
  assert.strictEqual(normalizeIp('::ffff:808:808'), '8.8.8.8');
  await resolveIps(['2001:4860:4860::8888%eth0', '2001:4860:4860::8888'], { fetch: fetchImpl });
  assert.strictEqual(urls.length, 2, 'a zone id is not a second host');
  assert.strictEqual(normalizeIp('2001:4860:4860::8888%eth0'), '2001:4860:4860::8888');
});

await t('a warm cache entry is still served inside a starved budget', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  await lookupIp('8.8.8.8', { fetch: fetchImpl });
  assert.strictEqual(urls.length, 1);
  const stats = {};
  const result = await resolveIps(['1.1.1.1', '1.0.0.1', '9.9.9.9', '8.8.8.8'], { fetch: fetchImpl, budgetMs: 0, stats });
  assert.strictEqual(stats.attempted, 4);
  assert.strictEqual(stats.resolved, 1, 'the free warm read must not be dropped');
  assert.strictEqual(stats.over_budget, true);
  assert.strictEqual(urls.length, 1, 'past the deadline no new request is issued');
  assert.ok(result.has('8.8.8.8'));
});

await t('concurrent lookups of one address share a single in-flight request', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const slow = (url) => {
    urls.push(url);
    return new Promise(resolve => setTimeout(() => resolve({
      ok: true, status: 200,
      json: async () => ({ success: true, connection: { asn: 133275, org: 'Race Net' } })
    }), 60));
  };
  const [a, b] = await Promise.all([
    lookupIp('5.5.5.5', { fetch: slow }),
    lookupIp('5.5.5.5', { fetch: slow })
  ]);
  assert.strictEqual(urls.length, 1, 'both callers share one request');
  assert.deepStrictEqual(a, { asn: 133275, asOrganization: 'Race Net' });
  assert.deepStrictEqual(b, a, 'no late writer can clobber the shared success');
  const third = await lookupIp('5.5.5.5', { fetch: slow });
  assert.deepStrictEqual(third, a, 'and the shared result is what the cache holds');
  assert.strictEqual(urls.length, 1);
});

await t('every attempt carries a real AbortSignal and a hanging provider is cut', async () => {
  clearIpIntelCache();
  urls.length = 0;
  let sawSignal = null;
  const hanging = (url, opts) => {
    urls.push(url);
    sawSignal = opts.signal;
    return new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    });
  };
  // AbortSignal.timeout's timer is unref'd, and this harness has no other
  // handles: without one ref'd timer the process would exit mid-lookup before
  // the abort ever fires (production fetch holds a ref'd socket instead).
  const keepAlive = setTimeout(() => {}, 3000);
  const started = Date.now();
  const result = await lookupIp('6.6.6.6', { fetch: hanging, deadline: Date.now() + 400 });
  const elapsed = Date.now() - started;
  assert.strictEqual(result, null);
  assert.ok(sawSignal instanceof AbortSignal, 'fetchJson must hand its timeout to fetch');
  assert.ok(elapsed < 1200, 'cut at the deadline, took ' + elapsed + 'ms');
  assert.strictEqual(urls.length, 1, 'the fallback is refused once the deadline passed');
  await lookupIp('6.6.6.6', { fetch: hanging, deadline: Date.now() + 400 });
  clearTimeout(keepAlive);
  assert.strictEqual(urls.length, 2, 'an unanswering provider is not negative-cached');
});

await t('resolveIps fills the stats block the API reports', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Example Network'));
  const stats = {};
  await resolveIps(['8.8.8.8', '10.0.0.1', '8.8.8.8'], { fetch: fetchImpl, stats });
  assert.deepStrictEqual(stats, { attempted: 1, resolved: 1, over_budget: false });
});

console.log(`\n${pass} passed`);
