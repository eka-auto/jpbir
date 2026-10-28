// The VivoBook section: projection, staleness at the laptop's own cadence, the
// missing-table path, the key gate, the handler's database-free paths and the
// index. Runs with no database and no network.

import assert from 'node:assert/strict';

const base = new URL('../../VivoBook/', import.meta.url);
const section = await import(new URL('VivoBook/section.js', base));
const group = await import(new URL('api.js', base));

const missing = () => {
  const err = new Error('relation does not exist');
  err.code = '42P01';
  throw err;
};

function stub(tables, absent = []) {
  return async (sql) => {
    for (const name of absent) {
      if (sql.includes(`from ${name}`)) missing();
    }
    for (const [needle, rows] of Object.entries(tables)) {
      if (sql.includes(needle)) return { rows };
    }
    return { rows: [] };
  };
}

const fakeRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

// ---- the record the laptop writes -----------------------------------------
{
  const fresh = await section.load(stub({
    'from devices': [{
      device_id: 'jayti-asus-vivobook', display_name: 'ASUS VivoBook', online: true,
      last_seen_at: new Date(Date.now() - 20_000).toISOString(), daemon_version: 'laptop-telemetry-1',
      platform: 'windows',
    }],
    'from device_telemetry': [{ kind: 'laptop', model: 'X515', os_version: 'Windows 11', battery_level: 88, cpu_temp_c: 41.2, public_ip: '5.6.7.8', observed_at: new Date().toISOString() }],
  }));
  assert.equal(fresh.device, 'jayti-asus-vivobook');
  assert.equal(fresh.present, true);
  assert.equal(fresh.stale, false, '20 seconds old is fresh for a 30-second writer');
  assert.equal(fresh.telemetry[0].os, 'Windows 11');
  assert.equal(fresh.telemetry[0].battery, 88);

  const old = await section.load(stub({
    'from devices': [{ device_id: 'jayti-asus-vivobook', last_seen_at: new Date(Date.now() - 600_000).toISOString() }],
    'from device_telemetry': [],
  }));
  assert.equal(old.stale, true, 'ten minutes old is stale for a 30-second writer');
  assert.ok(old.age_seconds >= 599);

  const absent = await section.load(stub({}, ['devices']));
  assert.deepEqual(absent, { device: 'jayti-asus-vivobook', migrated: false });

  const noRow = await section.load(stub({ 'from devices': [] }));
  assert.equal(noRow.present, false);
}

// ---- the gate --------------------------------------------------------------
{
  const saved = process.env.STATS_KEY;
  try {
    delete process.env.STATS_KEY;
    assert.equal(section.authorised({ query: {} }).status, 503, 'unconfigured server is 503, never 401');
    process.env.STATS_KEY = 'correct-horse';
    assert.equal(section.authorised({ query: { key: 'correct-horse' } }).ok, true);
    assert.equal(section.authorised({ headers: { 'x-stats-key': 'correct-horse' } }).ok, true);
    assert.equal(section.authorised({ query: { key: 'wrong' } }).code, 'auth_invalid');
    assert.equal(section.authorised({ query: {} }).code, 'auth_missing');
  } finally {
    if (saved === undefined) delete process.env.STATS_KEY; else process.env.STATS_KEY = saved;
  }
}

// ---- the handler's database-free paths ------------------------------------
{
  const saved = process.env.STATS_KEY;
  try {
    process.env.STATS_KEY = 'correct-horse';
    const post = fakeRes();
    await section.default({ method: 'POST', query: { key: 'correct-horse' } }, post);
    assert.equal(post.statusCode, 405);

    const bad = fakeRes();
    await section.default({ method: 'GET', query: { key: 'nope' } }, bad);
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.body.code, 'auth_invalid');
    assert.equal(bad.headers['Cache-Control'], 'private, no-store');

    delete process.env.STATS_KEY;
    const unconfigured = fakeRes();
    await section.default({ method: 'GET', query: {} }, unconfigured);
    assert.equal(unconfigured.statusCode, 503);
    assert.equal(unconfigured.body.code, 'auth_not_configured');
  } finally {
    if (saved === undefined) delete process.env.STATS_KEY; else process.env.STATS_KEY = saved;
  }
}

// ---- the index -------------------------------------------------------------
{
  assert.deepEqual(group.SECTIONS, ['vivobook']);

  const res = fakeRes();
  await group.default({ method: 'GET', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group, 'VivoBook');
  assert.equal(res.body.sections.length, 1);
  assert.equal(res.body.sections[0].endpoint, '/api/vivobook');

  const bad = fakeRes();
  await group.default({ method: 'GET', query: { section: 'nope' } }, bad);
  assert.equal(bad.statusCode, 400);
}

console.log('VivoBook section: projection, cadence staleness, missing-table, gate, handler and index checks passed');
