// The telemetry client must use JP_AWS_* / JP_WRITE_AWS_* only, and must not
// attach an ambient session token to a long-lived key. That mix is what makes
// DynamoDB answer UnrecognizedClientException for an otherwise well-formed key.
import { credentialsFor, accessKeyClass, credentialMeta, explainDynamoError, telemetryRegion, telemetryTable } from '../../Backend/lib/ddb.js';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

const KEYS = [
  'JP_AWS_ACCESS_KEY_ID',
  'JP_AWS_SECRET_ACCESS_KEY',
  'JP_AWS_SESSION_TOKEN',
  'JP_WRITE_AWS_ACCESS_KEY_ID',
  'JP_WRITE_AWS_SECRET_ACCESS_KEY',
  'JP_WRITE_AWS_SESSION_TOKEN',
  'JP_AWS_REGION',
  'JP_TELEMETRY_TABLE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function wipe() {
  for (const k of KEYS) delete process.env[k];
}
function restore() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

wipe();
check('missing read credentials are null, not a fake client', credentialsFor('read') === null, 'returned credentials');
check('default region is us-west-2', telemetryRegion() === 'us-west-2', telemetryRegion());
check('default table is jaytipargal_telemetry', telemetryTable() === 'jaytipargal_telemetry', telemetryTable());

process.env.AWS_ACCESS_KEY_ID = 'AKIAAMBIENTONLY';
process.env.AWS_SECRET_ACCESS_KEY = 'ambient-secret';
process.env.AWS_SESSION_TOKEN = 'ambient-session';
check('ambient AWS_* keys are not used as telemetry credentials', credentialsFor('read') === null, JSON.stringify(credentialMeta('read')));

process.env.JP_AWS_ACCESS_KEY_ID = 'AKIAEXAMPLEKEY000000';
process.env.JP_AWS_SECRET_ACCESS_KEY = 'read-secret';
process.env.JP_AWS_REGION = 'us-west-2';
process.env.JP_TELEMETRY_TABLE = 'jaytipargal_telemetry';
const readCreds = credentialsFor('read');
check('a permanent key is sent without a session token',
  readCreds && readCreds.accessKeyId.startsWith('AKIA') && !('sessionToken' in readCreds),
  JSON.stringify(readCreds && Object.keys(readCreds)));
check('key class is permanent', accessKeyClass(readCreds.accessKeyId) === 'permanent', accessKeyClass(readCreds.accessKeyId));

process.env.JP_AWS_SESSION_TOKEN = 'should-not-attach';
let mismatch = null;
try { credentialsFor('read'); } catch (e) { mismatch = e; }
check('a session token on a permanent key is refused',
  mismatch && mismatch.code === 'aws_session_token_mismatch', mismatch && mismatch.code);

delete process.env.JP_AWS_SESSION_TOKEN;
process.env.JP_AWS_ACCESS_KEY_ID = 'ASIAEXAMPLEKEY000000';
let missingToken = null;
try { credentialsFor('read'); } catch (e) { missingToken = e; }
check('a temporary key without JP_AWS_SESSION_TOKEN is refused',
  missingToken && missingToken.code === 'aws_session_token_missing', missingToken && missingToken.code);

process.env.JP_AWS_SESSION_TOKEN = 'temp-session';
const temp = credentialsFor('read');
check('a temporary key includes its own session token',
  temp && temp.sessionToken === 'temp-session' && !('AWS_SESSION_TOKEN' in temp),
  'token missing or ambient token copied');

process.env.JP_WRITE_AWS_ACCESS_KEY_ID = 'AKIAWRITEKEY00000000';
process.env.JP_WRITE_AWS_SECRET_ACCESS_KEY = 'write-secret';
const write = credentialsFor('write');
check('the write role does not reuse the read key',
  write && write.accessKeyId.startsWith('AKIAWRITE') && write.accessKeyId !== readCreds.accessKeyId,
  write && write.accessKeyId);

const explained = explainDynamoError({ name: 'UnrecognizedClientException', message: 'The security token included in the request is invalid.' }, 'read');
check('the invalid-token error names the variable pair and not the key',
  /JP_AWS_ACCESS_KEY_ID/.test(explained) && !/ASIAEXAMPLE|AKIAEXAMPLE|temp-session|read-secret/.test(explained),
  explained);

restore();
console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
