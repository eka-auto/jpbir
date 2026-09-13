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

// Brace-match to find where a helper ends, but match against a *masked* copy of
// the page in which every character inside a string, comment or regex literal
// has been blanked. Matching raw text meant a single unbalanced brace in a
// regex quantifier (`{1,}`) or a comment would close the function early, and
// `new Function` would then throw a SyntaxError that looks nothing like the
// "someone reshaped this helper" signal the extraction exists to give.
function maskLiterals(text) {
  const out = text.split('');
  let i = 0, prev = '';
  const blank = (from, to) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === '/' && next === '/') { const e = text.indexOf('\n', i); const end = e === -1 ? text.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && next === '*') { const e = text.indexOf('*/', i + 2); const end = e === -1 ? text.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      blank(i, j + 1); i = j + 1; prev = c; continue;
    }
    // A '/' starts a regex only where a value is expected, not after an operand.
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { blank(i, j + 1); i = j + 1; prev = '/'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

const masked = maskLiterals(html);

function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `helper ${name}() not found in Frontend/index.html`);
  let i = masked.indexOf('{', start), depth = 0;
  for (; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}()`);
}

const src = ['v4Prefix', 'hextets', 'ipv6Groups', 'ipPrefix', 'isRealIp', 'samePool', 'netLabel', 'ipNetworks', 'fmtNetworkGroup']
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
// The "::" run starting at hextet two is the ordinary short form for an Indian
// mobile handset; an earlier guard (`!h[1]`) rejected every one of them.
t('short form with :: at the second hextet parses', () => {
  assert.equal(ipPrefix('2409::1').key, 'v6:2409:0');
  assert.equal(ipPrefix('2405::1234').key, 'v6:2405:0');
  assert.equal(ipPrefix('2409::').key, 'v6:2409:0');
});
t('IPv4-mapped IPv6 folds onto its IPv4 block, compressed and expanded', () => {
  assert.equal(ipPrefix('::ffff:157.49.1.1').key, ipPrefix('157.49.1.1').key);
  assert.equal(ipPrefix('0:0:0:0:0:ffff:157.49.1.1').key, ipPrefix('157.49.1.1').key);
  assert.equal(ipPrefix('::157.49.1.1').key, ipPrefix('157.49.1.1').key);
});
t('a real IPv6 that embeds a quad stays IPv6', () =>
  assert.equal(ipPrefix('2001:db8::192.168.1.1').key, 'v6:2001:db8'));
t('every hextet is validated, not just the first two', () =>
  assert.equal(ipPrefix('dead:beef:this-is-not-an-address'), null));
t('malformed IPv6 is rejected', () => {
  assert.equal(ipPrefix('1:2::3::4'), null, 'two :: runs');
  assert.equal(ipPrefix('1:2:::3'), null, 'triple colon');
  assert.equal(ipPrefix('1:2:3:4:5:6:7:8:9:a:b:c'), null, 'too many hextets');
  assert.equal(ipPrefix('1:2:3'), null, 'too few, uncompressed');
  assert.equal(ipPrefix('gggg::1'), null, 'non-hex');
});
t('zone id is ignored', () => assert.equal(ipPrefix('fe80::1%eth0').key, 'v6:fe80:0'));
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
// A shared "unparseable" bucket merged genuinely unrelated addresses and
// asserted one network from no evidence at all.
t('unparseable addresses do not pool together', () => {
  const g = ipNetworks([ev('2409::1'), ev('2405::9'), ev('dead:beef:garbage')]).groups;
  assert.equal(g.length, 3, 'expected three separate groups, got: ' +
    JSON.stringify(g.map((x) => x.ips)));
});
t('unrelated IPv6 /32s stay separate', () =>
  assert.equal(ipNetworks([ev('2409:1::1'), ev('2405:2::1')]).groups.length, 2));

console.log(`\n  ${pass} passed${process.exitCode ? ', FAILURES above' : ''}`);
