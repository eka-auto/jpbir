// The 2026-09-10 DynamoDB telemetry backup is the only surviving copy of those
// events. Backend/db-push.js mirrors LIVE DynamoDB into Postgres, so with the
// table gone -- or its credentials rotated away -- nothing else in this
// repository could put those rows back, and the dashboard would simply stop
// showing them: a property whose history silently shrinks.
//
// Database/scripts/import-telemetry-backup.mjs reads the file instead. This pins
// the two halves that fail quietly: DynamoDB's typed JSON has to unmarshal into
// the camelCase shape the warehouse inserts, and every item in the committed
// backup has to map to a row with a site and a timestamp -- a mapping that
// returns null would import nothing and still print a success line.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unmarshal, rowFor } from '../../Database/scripts/import-telemetry-backup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKUP = join(ROOT, 'Database', 'backups', 'dynamodb-telemetry-backup.json');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// ---- DynamoDB typed JSON -> the shape insertEvent reads -------------------
const typed = {
  id: { S: '2026-08-15T17:49:32.918Z_bb81361b2c92' },
  pageUrl: { S: 'https://jaytipargal.com/services/' },
  epoch: { N: '1786816172918' },
  latitude: { S: '28.45970' },
  city: { S: 'Gurugram' },
  eventData: { M: { element: { S: 'A' }, text: { S: 'Brand Strategy' } } },
  numbers: { L: [{ N: '1' }, { N: '2.5' }] },
  flags: { M: { seen: { BOOL: true }, gone: { NULL: true } } },
};
const plain = unmarshal(typed);
check('a typed string unwraps to its text', plain.pageUrl === 'https://jaytipargal.com/services/');
check('a typed number unwraps to a number', plain.epoch === 1786816172918);
check('a nested map unwraps all the way down', plain.eventData.element === 'A' && plain.eventData.text === 'Brand Strategy');
check('a list unwraps element by element', JSON.stringify(plain.numbers) === '[1,2.5]');
check('booleans and nulls survive the unwrap', plain.flags.seen === true && plain.flags.gone === null);

// ---- every committed item maps to an insertable row -----------------------
const raw = JSON.parse(readFileSync(BACKUP, 'utf8'));
const items = (raw.Items || []).map(unmarshal);
check('the committed backup has items', items.length > 0, `${items.length} items`);

const rows = items.map(rowFor);
const noSite = rows.filter((r) => !r.site);
const noTime = rows.filter((r) => !r.occurredAt);
const noId = rows.filter((r) => !r.id);
check('every backup item maps to a timestamp', noTime.length === 0, JSON.stringify(noTime.slice(0, 3)));
check('every backup item maps to a row id', noId.length === 0, JSON.stringify(noId.slice(0, 3)));
check('the rows are labelled as coming from the backup',
  rows.every((r) => r.sourceSystem === 'dynamodb-backup'),
  'the Health page groups on source_system, so an unlabelled import is invisible');
// The warehouse tracks ONE property, so a row from any other host — including
// the operator console's own sessions and the fleet's device probes, and
// including a row that names no page URL at all — is not imported. It is
// SKIPPED and COUNTED, which is the property that matters: a row that is
// dropped silently looks identical to a row that was never there.
const sites = [...new Set(rows.map((r) => r.site))];
check('an item from another property is not attributed to a property',
  rows.filter((r) => r.site && r.site !== 'jaytibirthday.in').length === 0,
  JSON.stringify(sites));
check('an item with no page URL is unattributed rather than guessed for',
  rowFor({ id: 'x', epoch: 1786816172918 }).site === null);
check('the importer reports what it skipped',
  /skipped\s+\$\{other\}/.test(readFileSync(join(ROOT, 'Database', 'scripts', 'import-telemetry-backup.mjs'), 'utf8')),
  'a skipped row must be counted, or a silent drop looks like a row that never existed');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
