// The console coverage records must stay real: the schema has to exist in the
// migration, the readers have to name their columns instead of selecting the
// row wholesale, and nothing may hand a stored JSON blob straight to a panel.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  displayRefs, displayDetails,
  upsertLiveFeedRecord, recordProviderSnapshot, startAgentRun, appendAgentMessage,
  finishAgentRun, recordEvidence, upsertTelegramChat, appendTelegramMessage,
  readLiveFeed, readProviderSnapshots, readAgentRuns, readAgentMessages,
  readEngineeringEvidence, readTelegramChats, readTelegramMessages
} from '../../Backend/lib/console-records.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(join(ROOT, 'Database', 'schema', '017_console_coverage.sql'), 'utf8');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

for (const table of ['live_feed_records', 'provider_snapshots', 'agent_runs', 'agent_messages', 'engineering_evidence', 'telegram_chats', 'telegram_messages']) {
  check(`migration creates ${table}`, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(migration));
}
check('the migration is idempotent', !/DROP TABLE/i.test(migration) && /IF NOT EXISTS/.test(migration));
check('verdicts and statuses are constrained', /CHECK \(verdict IN/.test(migration) && /CHECK \(status IN/.test(migration));

const calls = [];
const db = async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; };

await upsertLiveFeedRecord({ feed: 'devices', kind: 'status', title: 'S24 online', summary: 'reported', sourceRef: 'devices/samsung-s24-ultra' }, { db });
check('a live feed row is upserted, not appended twice', /ON CONFLICT \(id\) DO UPDATE/.test(calls.at(-1).sql));
check('a live feed row keeps a reference to its source', calls.at(-1).params.includes('devices/samsung-s24-ultra'));

await recordProviderSnapshot({ provider: 'firestore', status: 'ok', summary: 'reachable', details: { count: 4, secret: 'do-not-leak' } }, { db });
check('provider details are stored as jsonb', /details/.test(calls.at(-1).sql));

await startAgentRun({ agent: 'jayti', title: 'ask', inputSummary: 'question' }, { db });
check('an agent run starts as running', calls.at(-1).params.includes('running'));
await appendAgentMessage({ runId: 'run-1', seq: 1, role: 'assistant', text: 'answer' }, { db });
check('an agent message keeps its order', /ON CONFLICT \(run_id, seq\)/.test(calls.at(-1).sql));
await finishAgentRun('run-1', { status: 'succeeded', outputText: 'done' }, { db });
check('finishing a run records how long it took', /duration_ms/.test(calls.at(-1).sql));

await recordEvidence({ checkName: 'lint', verdict: 'pass', summary: 'green' }, { db });
check('evidence records a verdict and a reference', /evidence_ref/.test(calls.at(-1).sql));
await upsertTelegramChat({ id: 'tg-1', title: 'channel' }, { db });
await appendTelegramMessage({ chatId: 'tg-1', seq: 1, direction: 'in', text: 'hi' }, { db });
check('telegram messages belong to a telegram chat', /ON CONFLICT \(chat_id, seq\)/.test(calls.at(-1).sql));

// Nothing may select the row wholesale.
for (const [name, fn, args] of [
  ['readLiveFeed', readLiveFeed, {}],
  ['readProviderSnapshots', readProviderSnapshots, {}],
  ['readAgentRuns', readAgentRuns, {}],
  ['readAgentMessages', readAgentMessages, { runId: 'r' }],
  ['readEngineeringEvidence', readEngineeringEvidence, {}],
  ['readTelegramChats', readTelegramChats, {}],
  ['readTelegramMessages', readTelegramMessages, { chatId: 'c' }]
]) {
  calls.length = 0;
  await fn({ ...args, db });
  check(`${name} names its columns`, !/SELECT \*/i.test(calls.at(-1).sql), calls.at(-1).sql);
}

// The stored JSONB must not survive into what a panel receives: the reader maps
// it onto known keys and drops the rest.
const rowsDb = (rows) => async () => ({ rows });
const agentRuns = await readAgentRuns({ db: rowsDb([{ id: 'a', agent: 'jayti', status: 'succeeded', title: 't', input_summary: 'i', output_text: 'o', error_text: null, refs: [{ kind: 'image', url: 'u', secret: 'x' }], started_at: 's', ended_at: 'e', duration_ms: 5 }]) });
check('agent run refs are mapped, not forwarded', JSON.stringify(agentRuns[0].refs) === JSON.stringify([{ kind: 'image', url: 'u' }]), JSON.stringify(agentRuns[0].refs));
check('agent run keeps its numbers as numbers', agentRuns[0].durationMs === 5);

const snapshots = await readProviderSnapshots({ db: rowsDb([{ id: 's', provider: 'firestore', status: 'ok', summary: 'fine', source_ref: 'devices/x', details: { count: 2, secret: 'x' }, captured_at: 'c' }]) });
check('provider details keep only known keys', JSON.stringify(snapshots[0].details) === JSON.stringify({ count: 2 }), JSON.stringify(snapshots[0].details));

check('unknown keys in a stored ref are dropped', JSON.stringify(displayRefs({ kind: 'image', url: 'u', secret: 'x' })) === JSON.stringify([{ kind: 'image', url: 'u' }]));
check('a ref list survives as a list', Array.isArray(displayRefs([{ kind: 'image', url: 'u' }])));
check('provider details keep only known keys', JSON.stringify(displayDetails({ count: 2, secret: 'x' })) === JSON.stringify({ count: 2 }));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
if (failures) process.exitCode = 1;
