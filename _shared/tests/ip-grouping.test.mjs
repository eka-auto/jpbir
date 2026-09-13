// Unit tests for the visitor drawer's IP-grouping helpers.
// Run: node _shared/tests/ip-grouping.test.mjs
//
// The helpers live inside the <script> block of Frontend/index.html, so this
// extracts them from the file and evaluates them. That is deliberate: it means
// the tests exercise the code that actually ships, and they break if someone
// renames or reshapes a function in the page. If these ever move to their own
// module, replace the extraction with a plain import - the assertions stay.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', '..', 'Frontend', 'index.html'), 'utf8');

// Pull `function <name>(...) { ... }` out of the page by brace matching, so the
// test does not depend on a particular indentation or trailing-blank-line shape.
function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `helper ${name}() not found in Frontend/index.html`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}()`);
}

const IP_LIST_CAP = 25;
const src = ['v4Prefix', 'ipPrefix', 'isRealIp', 'samePool', 'netLabel', 'ipNetworks', 'fmtNetworkGroup']
  .map(extract).join('\n');
const { ipPrefix, isRealIp, samePool, ipNetworks, fmtNetworkGroup } =
  new Function(src + '\nreturn { ipPrefix, isRealIp, samePool, ipNetworks, fmtNetworkGroup };')();

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const ev = (ip, extra) => ({ server_location: Object.assign({ ip }, extra || {}) });
const render = (events) => ipNetworks(events).groups.map(fmtNetworkGroup).join(' · ');

// --- ipPrefix ---------------------------------------------------------------
t('IPv4 gives a /16', () => assert.equal(ipPrefix('157.49.159.18').label, '157.49.0.0/16'));
t('IPv6 gives a /32', () => assert.equal(ipPrefix('2405:201:1:2::9').label, '2405:201::/32'));
t('IPv6 hextets normalise leading zeros', () =>
  assert.equal(ipPrefix('2409:0042::').key, ipPrefix('2409:42::').key));
t('IPv4-mapped IPv6 folds onto its IPv4 block', () =>
  assert.equal(ipPrefix('::ffff:157.49.1.1').key, ipPrefix('157.49.1.1').key));
t('every hextet is validated, not just the first two', () =>
  assert.equal(ipPrefix('dead:beef:this-is-not-an-address'), null));
t('octets over 255 rejected', () => assert.equal(ipPrefix('999.1.1.1'), null));
t('junk and empties rejected', () => {
  assert.equal(ipPrefix('unknown'), null);
  assert.equal(ipPrefix(''), null);
  assert.equal(ipPrefix(null), null);
});

// --- sentinels --------------------------------------------------------------
t("'unknown' is not a real address", () => {
  assert.equal(isRealIp('unknown'), false);
  assert.equal(isRealIp('157.49.1.1'), true);
});
t("'unknown' never becomes its own network", () => {
  const g = ipNetworks([ev('unknown', { city: 'Delhi' }), ev('157.49.1.1')]).groups;
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].ips, ['157.49.1.1']);
});

// --- grouping ---------------------------------------------------------------
t('attributed same-pool collapses to the block', () =>
  assert.equal(render([ev('157.49.159.18', { asn: 55836, asOrganization: 'Jio' }),
                       ev('157.49.129.175', { asn: 55836, asOrganization: 'Jio' })]),
    'Jio (AS55836): 2 IPs in 157.49.0.0/16 (rotated - expected on mobile)'));
t('IPv6 carrier pool collapses too', () =>
  assert.equal(render([ev('2405:201:1:2::9', { asn: 55836, asOrganization: 'Jio' }),
                       ev('2405:201:3:4::7', { asn: 55836, asOrganization: 'Jio' })]),
    'Jio (AS55836): 2 IPs in 2405:201::/32 (rotated - expected on mobile)'));
t('unattributed group lists its addresses instead of guessing', () =>
  assert.equal(render([ev('49.37.1.2'), ev('49.37.3.4')]),
    'unattributed network: 49.37.1.2, 49.37.3.4'));
t('org carries the ASN to addresses whose lookup failed', () => {
  const g = ipNetworks([ev('157.49.159.18', { asn: 55836, asOrganization: 'Jio' }),
                        ev('157.49.129.175', { asOrganization: 'Jio', asn_source: 'db_unavailable' })]).groups;
  assert.equal(g.length, 1);
});
t('distinct blocks stay distinct when nothing is attributed', () =>
  assert.equal(ipNetworks([ev('157.49.1.1'), ev('203.88.4.9'), ev('117.200.1.1')]).groups.length, 3));
t('one rotating carrier does not excuse an unrelated one', () => {
  const out = render([ev('157.49.1.2', { asn: 55836, asOrganization: 'Jio' }),
                      ev('157.49.9.8', { asn: 55836, asOrganization: 'Jio' }),
                      ev('117.200.1.1', { asn: 9829, asOrganization: 'BSNL' }),
                      ev('203.88.4.9', { asn: 9829, asOrganization: 'BSNL' })]);
  assert.match(out, /Jio \(AS55836\): 2 IPs in 157\.49\.0\.0\/16 \(rotated/);
  assert.ok(!/BSNL[^·]*rotated/.test(out), 'BSNL wrongly marked rotated: ' + out);
});
t('a prototype key cannot break grouping', () => {
  const g = ipNetworks([ev('__proto__', { city: 'X' })]).groups;
  assert.equal(g.length, 1);
  assert.equal({}.asn, undefined, 'Object.prototype was polluted');
});
t('cities survive an event carrying no IP', () =>
  assert.deepEqual(ipNetworks([{ server_location: { city: 'Sonipat' } }]).cities, ['Sonipat']));
t('samePool refuses unparseable addresses', () =>
  assert.equal(samePool(['nope', 'also-nope']), null));

console.log(`\n  ${pass} passed${process.exitCode ? ', FAILURES above' : ''}`);
