// The shared migration ledger: who else writes it, and which of our own
// migrations are retired.
//
// The schema_migrations table lives in one Neon database and two repositories
// write to it. A row naming a migration this repository does not ship is
// normally the other owner's work — not a divergence — and the reconciliation
// has to be able to tell the two apart. The failure it must never make is
// treating an unrecorded RENAME of one of our files as foreign, because then
// the runner would apply a migration that has already run.
//
// These pin the manifest, the rules that load it, and the guard that keeps the
// manifest from silencing a real divergence.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listMigrations, loadAliases, loadSharedLedger, explainableNames, assertManifestAgreesWithTree,
} from '../../Database/scripts/lib/migration-plan.mjs';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Database', 'schema');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const files = listMigrations(await readdir(SCHEMA_DIR));
const aliases = await loadAliases(SCHEMA_DIR);
const shared = await loadSharedLedger(SCHEMA_DIR);

t('the manifest names the other repository that writes the shared ledger', () => {
  assert.equal(shared.owners.length, 1);
  assert.equal(shared.owners[0].repository, 'jaytipargal/jaytibirthday-site');
  assert.ok(shared.owners[0].migrations.length > 0);
});

t('the manifest explains every name the production ledger actually holds', () => {
  // These eleven names were read out of the shared production ledger on
  // 2026-10-22, when the reconciliation failed with "production has applied
  // migrations this repository cannot explain". Ten of them belong to the
  // sibling repository; the eleventh is this repository's own retired
  // Telegram migration. If a rename or a retirement is ever forgotten, this
  // fails with the names that stopped being explainable.
  const { explainable } = explainableNames(files, aliases, shared);
  const known = [
    '001_init.sql',
    '002_enrich_events.sql',
    '003_fix_city_decode.sql',
    '007_site_api_enrichment.sql',
    '008_slide_dwell_and_device_network.sql',
    '009_device_telemetry.sql',
    '010_normalize_event_telemetry.sql',
    '010_session_duration.sql',
    '010_telegram.sql',
    '011_web_vitals_and_client_probe.sql',
    '012_reclean_whatsapp_senders.sql',
  ];
  for (const name of known) {
    assert.ok(explainable.has(name), name + ' is in the shared ledger but nothing explains it');
  }
});

t('the retired Telegram migration is retired for a stated reason', () => {
  assert.ok(shared.retired['010_telegram.sql'], '010_telegram.sql must be recorded as retired');
  assert.match(shared.retired['010_telegram.sql'], /013_drop_telegram\.sql/,
    'the reason must name the migration that superseded it');
  assert.ok(!files.includes('010_telegram.sql'), 'a retired migration must not still be in the tree');
});

t('the manifest never claims a migration this repository owns', () => {
  // The guard that stops the manifest from silencing a real divergence: if it
  // listed one of our own files, an unrecorded rename of ours would be
  // accepted as "the sibling's" and the runner would re-apply it.
  assert.equal(assertManifestAgreesWithTree(files, aliases, shared), true);
  for (const name of files) {
    assert.ok(!shared.owners[0].migrations.includes(name), name + ' is ours and must not be in the manifest');
    for (const aliasNames of Object.values(aliases)) {
      assert.ok(!shared.owners[0].migrations.includes(aliasNames[0]) || !aliasNames.includes(name),
        name + ' is an alias of ours and must not be in the manifest');
    }
  }
});

t('a manifest that claims one of our own files is refused', () => {
  const bad = { owners: [{ repository: 'someone-else', migrations: ['004_whatsapp.sql'] }], retired: {} };
  assert.throws(() => assertManifestAgreesWithTree(files, aliases, bad), /cannot be both/);
});

t('a manifest that retires a file still in the tree is refused', () => {
  const bad = { owners: [], retired: { '004_whatsapp.sql': 'because' } };
  assert.throws(() => assertManifestAgreesWithTree(files, aliases, bad), /still ships it/);
});

t('the explainable set covers our files, our aliases, the other owner and the retired', () => {
  const { ours, explainable } = explainableNames(files, aliases, shared);
  for (const name of files) assert.ok(explainable.has(name));
  for (const names of Object.values(aliases)) for (const name of names) assert.ok(explainable.has(name));
  for (const name of shared.owners[0].migrations) assert.ok(explainable.has(name));
  for (const name of Object.keys(shared.retired)) assert.ok(explainable.has(name));
  assert.ok(ours.size < explainable.size, 'the explainable set must be larger than just our own names');
});

console.log('\n  ' + pass + '/' + total + ' passed');
