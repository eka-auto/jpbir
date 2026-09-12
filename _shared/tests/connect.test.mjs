import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  buildAuthorizeParams,
  buildOptions,
  buildParams,
  buildSubject,
  mapConnectError,
} from '../../Backend/connect.js';

test('buildSubject defaults to app', () => {
  deepStrictEqual(buildSubject({}), { type: 'app' });
});

test('buildSubject user variant', () => {
  deepStrictEqual(buildSubject({ subject: 'user', subjectId: 'u_1' }), { type: 'user', id: 'u_1' });
  deepStrictEqual(buildSubject({ subject: 'user' }), { type: 'user', id: 'admin-jayti' });
});

test('buildSubject jwt-bearer variant', () => {
  deepStrictEqual(buildSubject({ subject: 'jwt-bearer', subjectId: 'sub_9' }), { type: 'jwt-bearer', sub: 'sub_9' });
});

test('buildParams assembles scopes, audience, resources, installationId', () => {
  const params = buildParams({
    subject: 'app',
    scopes: 'chat:write,repo:read',
    audience: 'a1,a2',
    resources: 'r1',
    installationId: 'inst_1',
    validityBufferMs: '60000',
  });
  deepStrictEqual(params, {
    subject: { type: 'app' },
    scopes: ['chat:write', 'repo:read'],
    audience: ['a1', 'a2'],
    resources: ['r1'],
    installationId: 'inst_1',
    validityBufferMs: 60000,
  });
});

test('buildParams omits unset optional fields', () => {
  deepStrictEqual(buildParams({}), { subject: { type: 'app' } });
});

test('buildOptions maps forceRefresh and region', () => {
  deepStrictEqual(buildOptions({ forceRefresh: '1', region: 'sfo1' }), { forceRefresh: true, region: 'sfo1' });
  deepStrictEqual(buildOptions({ forceRefresh: 'true' }), { forceRefresh: true });
  deepStrictEqual(buildOptions({ forceRefresh: '0' }), {});
  deepStrictEqual(buildOptions({}), {});
});

test('mapConnectError maps every documented error class', () => {
  const cases = [
    ['NoValidTokenError', 502, 'no-valid-token'],
    ['UserAuthorizationRequiredError', 400, 'user-authorization-required'],
    ['ConnectorInstallationRequiredError', 400, 'connector-installation-required'],
    ['ConnectorNotFoundError', 404, 'connector-not-found'],
    ['ClientNotLinkedToProjectError', 403, 'client-not-linked'],
    ['ClientNotEnabledForEnvironmentError', 403, 'client-not-enabled'],
  ];
  for (const [name, status, code] of cases) {
    const mapped = mapConnectError({ name, message: 'x' });
    strictEqual(mapped.status, status, name);
    strictEqual(mapped.code, code, name);
  }
});

test('mapConnectError falls back to generic 502', () => {
  const mapped = mapConnectError(new Error('boom'));
  strictEqual(mapped.status, 502);
  strictEqual(mapped.code, 'connect-error');
  strictEqual(mapped.message, 'boom');
});

test('mapConnectError handles null', () => {
  const mapped = mapConnectError(null);
  strictEqual(mapped.status, 502);
  strictEqual(mapped.code, 'connect-error');
});

test('buildAuthorizeParams coerces app subject to user', () => {
  const coerced = buildAuthorizeParams({ subject: { type: 'app' } }, {});
  deepStrictEqual(coerced, { subject: { type: 'user', id: 'admin-jayti' } });
});

test('buildAuthorizeParams honors explicit subjectId', () => {
  const coerced = buildAuthorizeParams({ subject: { type: 'app' } }, { subjectId: 'u_42' });
  deepStrictEqual(coerced, { subject: { type: 'user', id: 'u_42' } });
});

test('buildAuthorizeParams leaves user subject untouched', () => {
  const params = { subject: { type: 'user', id: 'u_7' }, scopes: ['a'] };
  deepStrictEqual(buildAuthorizeParams(params, {}), params);
});
