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

console.log(`\n${pass} passed`);
