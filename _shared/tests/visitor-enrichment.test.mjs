// Contract tests for the enrichment WIRING in the two visitor endpoints.
// The ip-intel suite proves the library; nothing else in the repo executes
// these handlers, so a dropped `await` or a reordered enrichment used to ship
// green. These assertions pin the order and the response block the drawer
// (and any operator probe) depends on. Run: node _shared/tests/visitor-enrichment.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const visitor = readFileSync(join(root, 'Backend', 'visitor.js'), 'utf8');
const jpVisitor = readFileSync(join(root, 'Backend', 'jp-visitor.js'), 'utf8');
const page = readFileSync(join(root, 'Frontend', 'index.html'), 'utf8');
const lib = await import('../../Backend/lib/ip-intel.js');

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.log('  FAIL ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

t('visitor.js awaits the enrichment before building the summary and projection', () => {
  const call = 'await enrichEvents(events, { stats: intelStats })';
  assert.ok(visitor.includes(call), 'the awaited enrichment call is missing');
  const at = visitor.indexOf(call);
  assert.ok(at < visitor.indexOf('summary: summarize('), 'enrichment must run before summarize()');
  assert.ok(at < visitor.indexOf('events: events.map(projectEvent)'), 'enrichment must run before projectEvent()');
});

t('visitor.js reports the intel stats block', () => {
  assert.match(visitor, /const intelStats = \{ attempted: 0, resolved: 0, over_budget: false \}/);
  assert.match(visitor, /intel: intelStats/);
});

t('jp-visitor.js resolves once, applies intel to the latest network and every event', () => {
  assert.match(jpVisitor, /resolveIps\(\[\.\.\.ips\], \{ stats \}\)/);
  assert.match(jpVisitor, /latestNetwork = applyIntel\(/);
  assert.match(jpVisitor, /server_location: applyIntel\(decodeGeo\(/);
  const at = jpVisitor.indexOf('resolveIps(');
  assert.ok(at > -1 && at < jpVisitor.indexOf('return res.status(200)'), 'resolution must finish before the response');
  assert.match(jpVisitor, /intel: stats/);
});

t('the drawer still renders asn/asOrganization and the unattributed fallback', () => {
  assert.match(page, /unattributed network/);
  assert.match(page, /asOrganization/);
  assert.match(page, /'ASN'/);
});

t('the ip-intel library exports every API the endpoints and tests use', () => {
  for (const name of ['enrichEvents', 'enrichGeo', 'resolveIps', 'lookupIp', 'normalizeIp', 'applyIntel', 'parseAsnOrg', 'clearIpIntelCache']) {
    assert.strictEqual(typeof lib[name], 'function', name + ' must stay exported');
  }
});

console.log(`\n${pass} passed`);
