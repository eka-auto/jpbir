// Neon is the telemetry source of truth. These checks keep the ingestion path
// direct and prevent the retired copy-through architecture returning.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  siteFor, insertEvent, botLike,
  readSyncCursor, writeSyncCursor, clearSyncCursor,
} from '../../Backend/lib/warehouse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const track = readFileSync(join(ROOT, 'Backend', 'jp-track.js'), 'utf8');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

check('known property is normalized', siteFor('https://www.jaytipargal.tech/path') === 'jaytipargal.tech');
check('preview deployment is rejected', siteFor('https://example.vercel.app/path') === null);
check('bot filter remains conservative', botLike('Mozilla/5.0') === false && botLike('Googlebot/2.1') === true);

const calls = [];
await insertEvent({
  id: 'test-event', eventType: 'pageview', timestamp: '2026-10-08T00:00:00.000Z', epoch: 1791417600000,
  sessionId: 'session', visitorId: 'visitor', pageUrl: 'https://jaytipargal.tech/', eventData: {},
}, { site: 'jaytipargal.tech', sourceSystem: 'test', db: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } });
check('event rows are keyed by property and source id', calls[0]?.params?.[0] === 'jaytipargal.tech:test-event');
check('event insert is idempotent', /ON CONFLICT \(id\) DO NOTHING/.test(calls[0]?.sql || ''));

const cursorCalls = [];
const cursorDb = async (sql, params) => {
  cursorCalls.push({ sql, params });
  return { rows: [{ cursor: { id: 'after-page-eight' } }] };
};
const checkpoint = await readSyncCursor('dynamodb-telemetry-repair', { db: cursorDb });
await writeSyncCursor('dynamodb-telemetry-repair', checkpoint, { db: cursorDb });
await clearSyncCursor('dynamodb-telemetry-repair', { db: cursorDb });
check('bounded import state is read from the warehouse',
  checkpoint?.id === 'after-page-eight' && /SELECT cursor FROM warehouse_sync_state/.test(cursorCalls[0]?.sql || ''));
check('bounded import state is upserted and cleared after a complete pass',
  /ON CONFLICT \(name\) DO UPDATE/.test(cursorCalls[1]?.sql || '') &&
  /DELETE FROM warehouse_sync_state/.test(cursorCalls[2]?.sql || ''));
const dbPush = readFileSync(join(ROOT, 'Backend', 'db-push.js'), 'utf8');
const stateSchema = readFileSync(join(ROOT, 'Database', 'schema', '009_dynamodb_repair_state.sql'), 'utf8');
check('scheduled DynamoDB repair resumes from a durable cursor',
  /readSyncCursor\(REPAIR_CURSOR\)/.test(dbPush) && /writeSyncCursor\(REPAIR_CURSOR, key\)/.test(dbPush) &&
  /clearSyncCursor\(REPAIR_CURSOR\)/.test(dbPush) && /warehouse_sync_state/.test(stateSchema));
check('tracker writes directly through the warehouse', /await recordEvent\(item, \{ site, sourceSystem: 'site-api' \}\)/.test(track));
check('tracker contains no AWS client or copy job', !/@aws-sdk|dynamodb|PutCommand|db-push/i.test(track));
for (const origin of ['https://jaytipargal.tech', 'https://www.jaytipargal.tech', 'https://jaytibirthday.in']) {
  check(`${origin} remains a permitted origin`, track.includes(`'${origin}'`));
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
