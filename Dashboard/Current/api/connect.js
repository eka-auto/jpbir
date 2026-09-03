import {
  deleteTokenCacheEntry,
  getConnectorMetadata,
  getToken,
  getTokenResponse,
  revokeToken,
  startAuthorization,
} from '@vercel/connect';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const CONNECTOR_UID = _env['CONNECT_' + 'CONNECTOR_UID'] || 'vercel/red-marble';
const CONNECT_CLIENT_ID = _env['CONNECT_' + 'CLIENT_ID'] || null;

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function sendError(res, status, message, code) {
  res.status(status).json({ error: message, code });
}

const ERROR_MAP = [
  ['NoValidTokenError', 502, 'no valid token for this request', 'no-valid-token'],
  ['UserAuthorizationRequiredError', 400, 'user authorization required', 'user-authorization-required'],
  ['ConnectorInstallationRequiredError', 400, 'connector installation required', 'connector-installation-required'],
  ['ConnectorNotFoundError', 404, 'connector not found', 'connector-not-found'],
  ['ClientNotLinkedToProjectError', 403, 'project not linked to connector', 'client-not-linked'],
  ['ClientNotEnabledForEnvironmentError', 403, 'connector not enabled for this environment', 'client-not-enabled'],
];

export function mapConnectError(err) {
  for (const [name, status, message, code] of ERROR_MAP) {
    if (err && err.name === name) {
      return { status, message, code };
    }
  }
  return { status: 502, message: err && err.message ? err.message : 'connect failed', code: 'connect-error' };
}

export function buildSubject(query) {
  const type = query.subject || 'app';
  if (type === 'user') {
    return { type: 'user', id: query.subjectId || 'admin-jayti' };
  }
  if (type === 'jwt-bearer') {
    return { type: 'jwt-bearer', sub: query.subjectId || '' };
  }
  return { type: 'app' };
}

export function buildParams(query) {
  const params = { subject: buildSubject(query) };
  if (query.installationId) params.installationId = query.installationId;
  if (query.scopes) params.scopes = String(query.scopes).split(',');
  if (query.audience) params.audience = String(query.audience).split(',');
  if (query.resources) params.resources = String(query.resources).split(',');
  if (query.validityBufferMs) params.validityBufferMs = Number(query.validityBufferMs);
  return params;
}

export function buildOptions(query) {
  const options = {};
  if (query.forceRefresh === '1' || query.forceRefresh === 'true') options.forceRefresh = true;
  if (query.region) options.region = query.region;
  return options;
}

export function buildAuthorizeParams(params, query) {
  if (params.subject.type === 'app') {
    return { ...params, subject: { type: 'user', id: query.subjectId || 'admin-jayti' } };
  }
  return params;
}

export default async function handler(req, res) {
  const presented = req.query.key || req.headers['x-stats-key'] || '';
  if (!STATS_KEY || !timingSafeEqual(presented, STATS_KEY)) {
    return sendError(res, 401, 'unauthorized', 'unauthorized');
  }

  const action = req.query.action || 'status';
  const params = buildParams(req.query);
  const options = buildOptions(req.query);

  try {
    if (action === 'authorize') {
      const authParams = buildAuthorizeParams(params, req.query);
      const auth = await startAuthorization(CONNECTOR_UID, authParams, options);
      return res.status(200).json({
        connector: CONNECTOR_UID,
        authorization: { url: auth.url, request: auth.request, expiresAt: auth.expiresAt || null },
      });
    }

    if (action === 'token') {
      const token = await getToken(CONNECTOR_UID, params, options);
      return res.status(200).json({ connector: CONNECTOR_UID, token });
    }

    if (action === 'token-response') {
      const response = await getTokenResponse(CONNECTOR_UID, params, options);
      return res.status(200).json({ connector: CONNECTOR_UID, tokenResponse: response });
    }

    if (action === 'revoke') {
      await revokeToken(CONNECTOR_UID, params, options);
      return res.status(200).json({ connector: CONNECTOR_UID, revoked: true });
    }

    if (action === 'cache-delete') {
      deleteTokenCacheEntry(CONNECTOR_UID, params);
      return res.status(200).json({ connector: CONNECTOR_UID, cacheEntryDeleted: true });
    }

    if (action === 'metadata') {
      const metadata = await getConnectorMetadata(CONNECTOR_UID, options);
      return res.status(200).json({ connector: metadata });
    }

    const metadata = await getConnectorMetadata(CONNECTOR_UID, options);
    let token = null;
    let tokenError = null;
    try {
      const tokenResponse = await getTokenResponse(CONNECTOR_UID, params, options);
      token = {
        tokenId: tokenResponse.tokenId || null,
        expiresAt: tokenResponse.expiresAt,
        installationId: tokenResponse.installationId || null,
        tenantId: tokenResponse.tenantId || null,
        externalSubject: tokenResponse.externalSubject || null,
        claims: tokenResponse.claims || null,
      };
    } catch (err) {
      tokenError = { name: err && err.name, message: err && err.message, code: err && err.code };
    }

    return res.status(200).json({
      connector: {
        uid: metadata.uid,
        id: metadata.id,
        name: metadata.name,
        type: metadata.type,
        service: metadata.service,
        clientUrl: metadata.clientUrl || null,
        clientId: CONNECT_CLIENT_ID,
      },
      token,
      tokenError,
    });
  } catch (err) {
    const mapped = mapConnectError(err);
    return sendError(res, mapped.status, mapped.message, mapped.code);
  }
}
