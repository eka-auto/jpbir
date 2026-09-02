import crypto from 'crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

export const PROTO_VERSION = '2';
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RESULT_BYTES = 32 * 1024;
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
export const MAX_RECENT_REQUESTS = 50;
export const CLAIM_LEASE_MS = 120 * 1000;
export const MAX_CLAIM_ATTEMPTS = 3;
export const RATE_LIMIT_PER_MIN = 30;

export const HARDWARE_RULES = {
  'g4g-lenovo-laptop': {
    manufacturer: /^LENOVO$/i,
    model: /^82KA/,
  },
  'jayti-asus-vivobook': {
    manufacturer: /ASUSTeK|ASUS/i,
    model: /VivoBook/i,
  },
  'samsung-s24-ultra': {
    model: /^SM-S928/i,
  },
};

export const ALLOWED_KEY_TYPES = new Set([
  'tpm-cng-p256',
  'android-keystore-p256',
  'software-p256',
]);

export function firestoreConfig() {
  const saJson = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
  if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured');
  const sa = JSON.parse(saJson);
  return {
    sa,
    projectId: sa.project_id,
    db: _env['FIRESTORE_' + 'DB'] || 'eka-agent',
  };
}

let _tokenCache = { token: null, exp: 0 };

export async function getFirestoreToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
  const { sa } = firestoreConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64url(header)}.${b64url(claim)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key);
  const jwt = `${input}.${sig.toString('base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange failed: ' + JSON.stringify(data).slice(0, 200));
  _tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

export function baseUri() {
  const { projectId, db } = firestoreConfig();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${db}/documents`;
}

export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = enc(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function encodeDocumentFields(values) {
  const fields = {};
  for (const [key, value] of Object.entries(values || {})) fields[key] = enc(value);
  return fields;
}

export function expandFieldPaths(values) {
  const expanded = {};
  for (const [fieldPath, value] of Object.entries(values || {})) {
    const parts = fieldPath.split('.');
    if (parts.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error(`invalid Firestore field path: ${fieldPath}`);
    }
    let cursor = expanded;
    for (const part of parts.slice(0, -1)) {
      if (Object.prototype.hasOwnProperty.call(cursor, part) &&
          (typeof cursor[part] !== 'object' || cursor[part] === null || Array.isArray(cursor[part]))) {
        throw new Error(`conflicting Firestore field path: ${fieldPath}`);
      }
      if (!Object.prototype.hasOwnProperty.call(cursor, part)) cursor[part] = {};
      cursor = cursor[part];
    }
    const leaf = parts.at(-1);
    if (Object.prototype.hasOwnProperty.call(cursor, leaf)) {
      throw new Error(`duplicate Firestore field path: ${fieldPath}`);
    }
    cursor[leaf] = value;
  }
  return expanded;
}

export function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = dec(val);
    return out;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}

async function fsFetch(path, init) {
  const token = await getFirestoreToken();
  const r = await fetch(`${baseUri()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init && init.headers) },
  });
  return r;
}

export async function fsGet(path) {
  const r = await fsFetch(path, {});
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore read failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function fsPatch(path, fields, precondition) {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  let qs = mask;
  if (precondition && precondition.updateTime) {
    qs += `&currentDocument.updateTime=${encodeURIComponent(precondition.updateTime)}`;
  } else if (precondition && precondition.exists === false) {
    qs += '&currentDocument.exists=false';
  }
  const r = await fsFetch(`${path}?${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeDocumentFields(expandFieldPaths(fields)) }),
  });
  if (r.status === 409 || r.status === 412) {
    const err = new Error('firestore precondition conflict');
    err.conflict = true;
    err.status = r.status;
    await r.text();
    throw err;
  }
  if (!r.ok) throw new Error('firestore patch failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function fsCreateAutoId(collection, fields) {
  const token = await getFirestoreToken();
  const r = await fetch(`${baseUri()}/${collection}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeDocumentFields(fields) }),
  });
  if (!r.ok) throw new Error('firestore create failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function fsBeginTransaction() {
  const token = await getFirestoreToken();
  const r = await fetch(`${baseUri()}:beginTransaction`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error('beginTransaction failed: ' + (await r.text()).slice(0, 300));
  const data = await r.json();
  return data.transaction;
}

export async function fsCommit(transaction, writes) {
  const token = await getFirestoreToken();
  const { projectId, db } = firestoreConfig();
  const named = writes.map((w) => {
    const out = { ...w };
    out.update = {
      name: `${baseUri()}/${w.path}`,
      fields: encodeDocumentFields(expandFieldPaths(w.fields)),
    };
    if (w.updateMask) out.updateMask = { fieldPaths: w.updateMask };
    if (w.precondition && w.precondition.updateTime) {
      out.currentDocument = { updateTime: w.precondition.updateTime };
    } else if (w.precondition && w.precondition.exists === false) {
      out.currentDocument = { exists: false };
    }
    delete out.path;
    delete out.fields;
    delete out.precondition;
    return out;
  });
  const r = await fetch(`${baseUri()}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: named, transaction }),
  });
  if (r.status === 409) {
    const err = new Error('transaction conflict');
    err.conflict = true;
    await r.text();
    throw err;
  }
  if (!r.ok) throw new Error('commit failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function fsRollback(transaction) {
  try {
    const token = await getFirestoreToken();
    await fetch(`${baseUri()}:rollback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction }),
    });
  } catch {
    // best effort
  }
}

export function keyIdFromPem(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
}

export function canonicalString(e, bodySha256Hex) {
  return ['v' + PROTO_VERSION, e.keyId, e.method, e.path, e.seq, e.timestamp, e.requestId, bodySha256Hex].join('\n');
}

export function verifyP256(publicKeyPem, canonical, signatureB64) {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonical);
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

const _rateBuckets = new Map();

export function rateLimitOk(keyId) {
  const now = Date.now();
  let b = _rateBuckets.get(keyId);
  if (!b || now - b.windowStart >= 60000) {
    b = { windowStart: now, count: 0 };
    _rateBuckets.set(keyId, b);
  }
  b.count += 1;
  return b.count <= RATE_LIMIT_PER_MIN;
}

export function audit(actor, action, deviceId, detail) {
  fsCreateAutoId('auditLog', {
    at: new Date().toISOString(),
    actor: actor || 'unknown',
    action,
    deviceId: deviceId || '',
    detail: detail || '',
  }).catch(() => {});
}

export function slog(event, fields) {
  const safe = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (['signature', 'code', 'publicKeyPem', 'body'].includes(k)) continue;
    safe[k] = v;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...safe }));
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { httpStatus: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseEnvelope(req, rawBody, canonicalPath) {
  const h = req.headers;
  const proto = String(h['x-broker-proto'] || '');
  const keyId = String(h['x-key-id'] || '');
  const seqRaw = String(h['x-device-seq'] || '');
  const timestampRaw = String(h['x-timestamp'] || '');
  const requestId = String(h['x-request-id'] || '');
  const signature = String(h['x-signature'] || '');

  if (proto !== PROTO_VERSION) return { error: 'unsupported protocol version', httpStatus: 400 };
  if (!/^[a-f0-9]{32}$/.test(keyId)) return { error: 'malformed keyId', httpStatus: 400 };
  if (!/^\d{1,15}$/.test(seqRaw)) return { error: 'malformed seq', httpStatus: 400 };
  if (!/^\d{1,15}$/.test(timestampRaw)) return { error: 'malformed timestamp', httpStatus: 400 };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return { error: 'malformed requestId', httpStatus: 400 };
  }
  if (!signature) return { error: 'missing signature', httpStatus: 400 };

  const seq = Number(seqRaw);
  const timestamp = Number(timestampRaw);
  const skew = Math.abs(Date.now() - timestamp);
  if (skew > TIMESTAMP_WINDOW_MS) return { error: 'timestamp outside window', httpStatus: 401 };

  const bodySha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
  const canonical = canonicalString(
    { keyId, method: req.method.toUpperCase(), path: canonicalPath, seq, timestamp, requestId },
    bodySha256,
  );
  return { keyId, seq, timestamp, requestId, signature, canonical, bodySha256 };
}

export function verifyHardwareFingerprint(deviceId, hardware, expected) {
  const rules = expected || HARDWARE_RULES[deviceId];
  if (!rules) return `no hardware rules for device ${deviceId}`;
  for (const [attr, re] of Object.entries(rules)) {
    const value = String((hardware && hardware[attr]) || '');
    const rx = re instanceof RegExp ? re : new RegExp(re);
    if (!rx.test(value)) {
      return `hardware mismatch: ${attr} does not match expected pattern`;
    }
  }
  return null;
}

export function normalizeHardwareFingerprint(hardware) {
  const out = {};
  for (const key of ['manufacturer', 'model', 'serialHash']) {
    const value = String((hardware && hardware[key]) || '').trim();
    if (value) out[key] = value.slice(0, 256);
  }
  return out;
}

export function verifyEnrolledHardware(enrolled, presented) {
  const expected = normalizeHardwareFingerprint(enrolled);
  const actual = normalizeHardwareFingerprint(presented);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return `hardware mismatch: ${key} changed after enrollment`;
  }
  return null;
}

export function verifySignerAttestation(keyType, attestation) {
  const a = attestation && typeof attestation === 'object' ? attestation : {};
  if (keyType === 'tpm-cng-p256') {
    if (a.provider !== 'Microsoft Platform Crypto Provider' || a.exportable !== false) {
      return 'TPM CNG signer metadata is missing or invalid';
    }
  } else if (keyType === 'android-keystore-p256') {
    if (a.provider !== 'AndroidKeyStore' || a.insideSecureHardware !== true || a.algorithm !== 'EC' || a.keySize !== 256) {
      return 'AndroidKeyStore secure-hardware metadata is missing or invalid';
    }
  }
  return null;
}

export function sendError(res, status, error, event, extra) {
  slog(event || 'request-rejected', { status, error, ...(extra || {}) });
  return res.status(status).json({ success: false, error });
}
