#!/usr/bin/env node
import crypto from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.BROKER_SANDBOX_PORT || 0);
const controlToken = String(process.env.BROKER_SANDBOX_CONTROL_TOKEN || '');
const seedEncoded = String(process.env.BROKER_SANDBOX_SEED_B64 || '');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('BROKER_SANDBOX_PORT must be a valid TCP port');
}
if (!controlToken || !seedEncoded) {
  throw new Error('sandbox control token and seed are required');
}

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'broker-v2-sandbox',
  client_email: 'broker-v2-sandbox@example.invalid',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});
process.env.FIRESTORE_DB = 'sandbox-broker-v2';

const {
  dec,
  encodeDocumentFields,
} = await import('../../jayti-dashboard/lib/broker.js');

const projectId = 'broker-v2-sandbox';
const database = 'sandbox-broker-v2';
const firestorePath = `/v1/projects/${projectId}/databases/${database}/documents`;
const resourcePrefix = `projects/${projectId}/databases/${database}/documents/`;
const documents = new Map();
let version = 0;
let auditCounter = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nextUpdateTime() {
  version += 1;
  return new Date(Date.now() + version).toISOString();
}

function decodeFields(fields) {
  return dec({ mapValue: { fields: fields || {} } }) || {};
}

function makeDocument(path, value, prior) {
  const now = nextUpdateTime();
  return {
    name: `${resourcePrefix}${path}`,
    fields: encodeDocumentFields(value),
    createTime: prior ? prior.createTime : now,
    updateTime: now,
  };
}

function getPath(value, fieldPath) {
  let cursor = value;
  for (const part of fieldPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setPath(value, fieldPath, nextValue) {
  const parts = fieldPath.split('.');
  let cursor = value;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = clone(nextValue);
}

function applyWrite(store, path, incomingFields, fieldPaths, precondition) {
  const prior = store.get(path);
  if (precondition && precondition.exists === false && prior) {
    const error = new Error('document already exists');
    error.conflict = true;
    throw error;
  }
  if (precondition && precondition.updateTime &&
      (!prior || prior.updateTime !== precondition.updateTime)) {
    const error = new Error('update time conflict');
    error.conflict = true;
    throw error;
  }

  const incoming = decodeFields(incomingFields);
  let merged;
  if (fieldPaths && fieldPaths.length) {
    merged = prior ? decodeFields(prior.fields) : {};
    for (const fieldPath of fieldPaths) {
      const value = getPath(incoming, fieldPath);
      if (value === undefined) throw new Error(`masked field is absent: ${fieldPath}`);
      setPath(merged, fieldPath, value);
    }
  } else {
    merged = incoming;
  }
  const document = makeDocument(path, merged, prior);
  store.set(path, document);
  return document;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function conflictResponse(message) {
  return jsonResponse(409, {
    error: { code: 409, status: 'ABORTED', message },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = String(init.method || 'GET').toUpperCase();

  if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
    return jsonResponse(200, { access_token: 'sandbox-access-token', expires_in: 3600 });
  }
  if (url.origin !== 'https://firestore.googleapis.com' ||
      !url.pathname.startsWith(firestorePath)) {
    return jsonResponse(502, { error: 'sandbox blocked an unexpected outbound request' });
  }

  const tail = decodeURIComponent(url.pathname.slice(firestorePath.length));
  if (method === 'POST' && tail === ':beginTransaction') {
    return jsonResponse(200, { transaction: `sandbox-transaction-${version + 1}` });
  }
  if (method === 'POST' && tail === ':rollback') {
    return jsonResponse(200, {});
  }
  if (method === 'POST' && tail === ':commit') {
    const payload = JSON.parse(String(init.body || '{}'));
    const working = new Map([...documents].map(([key, value]) => [key, clone(value)]));
    const written = [];
    try {
      for (const write of payload.writes || []) {
        if (!write.update || !String(write.update.name || '').startsWith(resourcePrefix)) {
          throw new Error('invalid sandbox transaction write');
        }
        const path = write.update.name.slice(resourcePrefix.length);
        written.push(applyWrite(
          working,
          path,
          write.update.fields,
          write.updateMask && write.updateMask.fieldPaths,
          write.currentDocument,
        ));
      }
    } catch (error) {
      if (error.conflict) return conflictResponse(error.message);
      return jsonResponse(400, { error: error.message });
    }
    documents.clear();
    for (const [key, value] of working) documents.set(key, value);
    return jsonResponse(200, {
      writeResults: written.map((document) => ({ updateTime: document.updateTime })),
      commitTime: nextUpdateTime(),
    });
  }

  const path = tail.replace(/^\/+/, '');
  if (method === 'GET') {
    const document = documents.get(path);
    return document ? jsonResponse(200, document) : jsonResponse(404, {
      error: { code: 404, status: 'NOT_FOUND' },
    });
  }
  if (method === 'PATCH') {
    const payload = JSON.parse(String(init.body || '{}'));
    try {
      const document = applyWrite(
        documents,
        path,
        payload.fields,
        url.searchParams.getAll('updateMask.fieldPaths'),
        url.searchParams.has('currentDocument.updateTime')
          ? { updateTime: url.searchParams.get('currentDocument.updateTime') }
          : url.searchParams.get('currentDocument.exists') === 'false'
            ? { exists: false }
            : undefined,
      );
      return jsonResponse(200, document);
    } catch (error) {
      return error.conflict
        ? conflictResponse(error.message)
        : jsonResponse(400, { error: error.message });
    }
  }
  if (method === 'POST' && path === 'auditLog') {
    auditCounter += 1;
    const payload = JSON.parse(String(init.body || '{}'));
    const document = applyWrite(
      documents,
      `auditLog/sandbox-${auditCounter}`,
      payload.fields,
      [],
      { exists: false },
    );
    return jsonResponse(200, document);
  }
  return jsonResponse(405, { error: 'unsupported sandbox Firestore operation' });
};

const seed = JSON.parse(Buffer.from(seedEncoded, 'base64').toString('utf8'));
delete process.env.BROKER_SANDBOX_SEED_B64;

const codePaths = {};
for (const item of seed.codes || []) {
  const codeHash = crypto.createHash('sha256').update(item.code.toLowerCase()).digest('hex');
  codePaths[item.label] = `enrollmentCodes/${codeHash}`;
  documents.set(codePaths[item.label], makeDocument(codePaths[item.label], item.fields));
}
documents.set(`devices/${seed.deviceId}`, makeDocument(`devices/${seed.deviceId}`, {
  online: false,
  commandQueue: seed.commandQueue,
}));

const handlers = {
  '/api/device-enroll': (await import('../../jayti-dashboard/api/device-enroll.js')).default,
  '/api/device-heartbeat': (await import('../../jayti-dashboard/api/device-heartbeat.js')).default,
  '/api/device-commands-poll': (await import('../../jayti-dashboard/api/device-commands-poll.js')).default,
  '/api/device-command-claim': (await import('../../jayti-dashboard/api/broker-command-claim.js')).default,
  '/api/device-command-complete': (await import('../../jayti-dashboard/api/broker-command-complete.js')).default,
};

function authorized(req) {
  const presented = String(req.headers['x-sandbox-token'] || '');
  if (presented.length !== controlToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(controlToken));
}

function controlState() {
  const device = decodeFields(documents.get(`devices/${seed.deviceId}`)?.fields);
  const enrollment = device.enrollment || {};
  const codes = {};
  for (const [label, path] of Object.entries(codePaths)) {
    const value = decodeFields(documents.get(path)?.fields);
    codes[label] = {
      attempts: value.attempts,
      consumed: value.consumed,
      revoked: value.revoked,
    };
  }
  const keys = [];
  for (const [path, document] of documents) {
    if (!path.startsWith('deviceKeys/')) continue;
    const value = decodeFields(document.fields);
    keys.push({
      keyId: path.slice('deviceKeys/'.length),
      deviceId: value.deviceId,
      keyType: value.keyType,
      status: value.status,
    });
  }
  return {
    codes,
    device: {
      online: device.online,
      lastSeen: device.lastSeen,
      enrollment: {
        activeKeyId: enrollment.activeKeyId,
        seq: enrollment.seq,
        requestIdCount: Array.isArray(enrollment.lastRequestIds)
          ? enrollment.lastRequestIds.length
          : 0,
      },
      commandQueue: device.commandQueue || {},
    },
    keys,
    auditCount: [...documents.keys()].filter((path) => path.startsWith('auditLog/')).length,
  };
}

const server = http.createServer(async (req, res) => {
  res.status = (status) => {
    res.statusCode = status;
    return res;
  };
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
    return res;
  };

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/__sandbox/health') {
    return res.status(200).json({ ready: true });
  }
  if (url.pathname === '/__sandbox/state') {
    if (!authorized(req)) return res.status(403).json({ error: 'forbidden' });
    return res.status(200).json(controlState());
  }
  if (url.pathname === '/__sandbox/shutdown') {
    if (!authorized(req)) return res.status(403).json({ error: 'forbidden' });
    res.status(200).json({ stopping: true });
    return setImmediate(() => server.close());
  }

  let route = url.pathname;
  let commandId = url.searchParams.get('commandId');
  for (const prefix of ['/api/device-command-claim/', '/api/device-command-complete/']) {
    if (route.startsWith(prefix)) {
      commandId = decodeURIComponent(route.slice(prefix.length));
      route = prefix.slice(0, -1);
      break;
    }
  }
  const handler = handlers[route];
  if (!handler) return res.status(404).json({ error: 'sandbox route not found' });
  req.query = commandId ? { commandId } : {};
  try {
    await handler(req, res);
  } catch (error) {
    if (!res.writableEnded) res.status(500).json({ error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ ready: true, port })}\n`);
});

server.on('close', () => process.exit(0));
