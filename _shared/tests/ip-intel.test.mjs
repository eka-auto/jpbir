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

const whois = org => json({ success: true, connection: { asn: 133275, org, isp: 'Gigantic Infotel Pvt Ltd' } });
const ipinfo = org => json({ org });

clearIpIntelCache();

await t('parseAsnOrg reads the ipinfo "AS<n> <org>" form', () => {
  assert.deepStrictEqual(parseAsnOrg('AS133275 Gigantic Infotel Pvt Ltd'), {
    asn: 133275,
    asOrganization: 'Gigantic Infotel Pvt Ltd'
  });
});

await t('parseAsnOrg keeps a bare AS number', () => {
  assert.deepStrictEqual(parseAsnOrg('AS55836'), { asn: 55836, asOrganization: null });
});

await t('parseAsnOrg treats a plain string as an org with no ASN', () => {
  assert.deepStrictEqual(parseAsnOrg('Reliance Jio Infocomm Limited'), {
    asn: null,
    asOrganization: 'Reliance Jio Infocomm Limited'
  });
});

await t('normalizeIp folds IPv4-mapped IPv6 and rejects the unknown sentinel', () => {
  assert.strictEqual(normalizeIp('::ffff:103.196.54.59'), '103.196.54.59');
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
  const fetchImpl = mockFetch(() => whois('Gaurika Internet Private limited'));
  const intel = await lookupIp('103.196.54.59', { fetch: fetchImpl });
  assert.deepStrictEqual(intel, { asn: 133275, asOrganization: 'Gaurika Internet Private limited' });
  assert.ok(urls[0].startsWith('https://ipwho.is/103.196.54.59'));
});

await t('a resolved address is cached instead of looked up again', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Gaurika Internet Private limited'));
  await lookupIp('103.196.54.59', { fetch: fetchImpl });
  await lookupIp('103.196.54.59', { fetch: fetchImpl });
  assert.strictEqual(urls.length, 1);
});

await t('ipinfo is used when ipwho.is fails', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(url => {
    if (url.startsWith('https://ipwho.is/')) return Promise.reject(new Error('down'));
    return ipinfo('AS133275 Gigantic Infotel Pvt Ltd');
  });
  const intel = await lookupIp('103.196.54.59', { fetch: fetchImpl });
  assert.deepStrictEqual(intel, { asn: 133275, asOrganization: 'Gigantic Infotel Pvt Ltd' });
  assert.strictEqual(urls.length, 2);
});

await t('a failed lookup is negatively cached', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => Promise.reject(new Error('down')));
  assert.strictEqual(await lookupIp('103.196.54.60', { fetch: fetchImpl }), null);
  assert.strictEqual(await lookupIp('103.196.54.60', { fetch: fetchImpl }), null);
  assert.strictEqual(urls.length, 2);
});

await t('enrichEvents fills missing network fields and leaves existing ones alone', async () => {
  clearIpIntelCache();
  const fetchImpl = mockFetch(() => whois('Gaurika Internet Private limited'));
  const events = [
    { server_location: { ip: '103.196.54.59', city: 'Sonipat' } },
    { server_location: { ip: '103.196.54.59', asn: 64500, asOrganization: 'Existing Network' } }
  ];
  const changed = await enrichEvents(events, { fetch: fetchImpl });
  assert.strictEqual(changed, 1);
  assert.deepStrictEqual(events[0].server_location, {
    ip: '103.196.54.59',
    city: 'Sonipat',
    asn: 133275,
    asOrganization: 'Gaurika Internet Private limited'
  });
  assert.strictEqual(events[1].server_location.asn, 64500);
  assert.strictEqual(events[1].server_location.asOrganization, 'Existing Network');
});

await t('enrichGeo resolves the summary network object', async () => {
  clearIpIntelCache();
  const fetchImpl = mockFetch(() => whois('Gaurika Internet Private limited'));
  const geo = await enrichGeo({ ip: '103.196.54.59', city: 'Sonipat' }, { fetch: fetchImpl });
  assert.strictEqual(geo.asn, 133275);
  assert.strictEqual(geo.asOrganization, 'Gaurika Internet Private limited');
  assert.strictEqual(geo.city, 'Sonipat');
});

await t('applyIntel does nothing without an address match', () => {
  const geo = { ip: '103.196.54.59' };
  assert.strictEqual(applyIntel(geo, null), geo);
});

await t('resolveIps deduplicates repeated addresses', async () => {
  clearIpIntelCache();
  urls.length = 0;
  const fetchImpl = mockFetch(() => whois('Gaurika Internet Private limited'));
  const intel = await resolveIps(
    ['103.196.54.59', '103.196.54.59', '::ffff:103.196.54.59', '10.0.0.1'],
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
    'fe80::1', 'fc00::1', 'fd00::1'
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

console.log(`\n${pass} passed`);
