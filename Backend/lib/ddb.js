// One DynamoDB client path for telemetry.
//
// Readers use JP_AWS_ACCESS_KEY_ID / JP_AWS_SECRET_ACCESS_KEY.
// jp-track writes with JP_WRITE_AWS_ACCESS_KEY_ID / JP_WRITE_AWS_SECRET_ACCESS_KEY.
// Region and table are shared: JP_AWS_REGION (default us-west-2) and
// JP_TELEMETRY_TABLE (default jaytipargal_telemetry).
//
// Ambient AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN are
// ignored on purpose. A laptop AWS login and this deployment are different
// accounts; mixing a leftover session token into these static keys makes
// DynamoDB return UnrecognizedClientException ("The security token included
// in the request is invalid") even when the access key itself is fine.
//
// Temporary keys (prefix ASIA) are sent only with an explicit
// JP_AWS_SESSION_TOKEN or JP_WRITE_AWS_SESSION_TOKEN. Long-lived keys (AKIA)
// are sent with no session token. There is no localhost or fake-table fallback.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

function read(name) {
  const value = _env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function telemetryRegion() {
  return read('JP_AWS_' + 'REGION') || 'us-west-2';
}

export function telemetryTable() {
  return read('JP_TELEMETRY_' + 'TABLE') || 'jaytipargal_telemetry';
}

function prefixFor(role) {
  return role === 'write' ? 'JP_WRITE_AWS_' : 'JP_AWS_';
}

/** 'temporary' | 'permanent' | 'unknown' | 'missing' — never the key itself. */
export function accessKeyClass(accessKeyId) {
  if (!accessKeyId) return 'missing';
  if (accessKeyId.startsWith('ASIA')) return 'temporary';
  if (accessKeyId.startsWith('AKIA')) return 'permanent';
  return 'unknown';
}

/**
 * Static credentials for one role, or null when that pair is unset.
 * Throws when a temporary key has no matching session token, or when a
 * session token is configured for a key that is not temporary.
 */
export function credentialsFor(role = 'read') {
  const prefix = prefixFor(role);
  const accessKeyId = read(prefix + 'ACCESS_KEY_ID');
  const secretAccessKey = read(prefix + 'SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) return null;

  const sessionToken = read(prefix + 'SESSION_TOKEN');
  const keyClass = accessKeyClass(accessKeyId);
  if (keyClass === 'temporary') {
    if (!sessionToken) {
      const err = new Error(
        prefix + 'ACCESS_KEY_ID is a temporary key and ' + prefix + 'SESSION_TOKEN is not set'
      );
      err.code = 'aws_session_token_missing';
      throw err;
    }
    return { accessKeyId, secretAccessKey, sessionToken };
  }
  if (sessionToken) {
    const err = new Error(
      prefix + 'SESSION_TOKEN is set but ' + prefix + 'ACCESS_KEY_ID is not a temporary key'
    );
    err.code = 'aws_session_token_mismatch';
    throw err;
  }
  return { accessKeyId, secretAccessKey };
}

/** Null when this role can build a client. Otherwise a message safe to return. */
export function credentialRefusal(role = 'read') {
  try {
    if (!credentialsFor(role)) {
      return role === 'write' ? 'AWS write credentials not configured' : 'AWS credentials not configured';
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

export function dynamoClient(role = 'read') {
  const credentials = credentialsFor(role);
  if (!credentials) {
    const err = new Error(
      role === 'write' ? 'AWS write credentials not configured' : 'AWS credentials not configured'
    );
    err.code = 'aws_credentials_missing';
    throw err;
  }
  return new DynamoDBClient({ region: telemetryRegion(), credentials });
}

export function documentClient(role = 'read') {
  return DynamoDBDocumentClient.from(dynamoClient(role));
}

/** Safe metadata for a probe. Does not include key material. */
export function credentialMeta(role = 'read') {
  const prefix = prefixFor(role);
  const accessKeyId = read(prefix + 'ACCESS_KEY_ID');
  const secretAccessKey = read(prefix + 'SECRET_ACCESS_KEY');
  return {
    role,
    configured: Boolean(accessKeyId && secretAccessKey),
    keyClass: accessKeyClass(accessKeyId),
    sessionTokenSet: Boolean(read(prefix + 'SESSION_TOKEN')),
    region: telemetryRegion(),
    table: telemetryTable(),
  };
}

/**
 * Operator-facing text for a DynamoDB failure. Never includes credential values.
 */
export function explainDynamoError(error, role = 'read') {
  const name = error && error.name ? error.name : 'Error';
  const message = String((error && error.message) || error || '').slice(0, 180);
  const meta = credentialMeta(role);
  if (
    name === 'UnrecognizedClientException'
    || /security token included in the request is invalid/i.test(message)
  ) {
    const pair = role === 'write' ? 'JP_WRITE_AWS_ACCESS_KEY_ID / JP_WRITE_AWS_SECRET_ACCESS_KEY' : 'JP_AWS_ACCESS_KEY_ID / JP_AWS_SECRET_ACCESS_KEY';
    return name + ' - ' + pair + ' was rejected (keyClass=' + meta.keyClass
      + ', sessionTokenSet=' + meta.sessionTokenSet
      + '). The key is invalid, expired, or paired with the wrong secret. Replace that pair on the Vercel project. Do not copy a local AWS login; that profile is a different account.';
  }
  if (error && error.code === 'aws_session_token_missing') return message;
  if (error && error.code === 'aws_session_token_mismatch') return message;
  return name + ' - ' + message;
}
