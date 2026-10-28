// The six S24 sections: projection, missing-table honesty and the key gate.
//
// Every section is exercised through its own `load()`, which takes the query
// function as an argument, so the whole suite runs with no database. The
// handler paths that need no database (method guard, gate, index) are driven
// too. Nothing here reaches the network.

import assert from 'node:assert/strict';

const base = new URL('../../S24/', import.meta.url);

const ultra = (await import(new URL('S24 Ultra/section.js', base))).default;
const ultraMod = await import(new URL('S24 Ultra/section.js', base));
const dashboard = (await import(new URL('Device Dashboard/section.js', base))).default;
const dashboardMod = await import(new URL('Device Dashboard/section.js', base));
const whatsappMod = await import(new URL('WhatsApp/section.js', base));
const mediaMod = await import(new URL('Media/section.js', base));
const telegramMod = await import(new URL('Telegram/section.js', base));
const liveMod = await import(new URL('Live feed/section.js', base));
const group = await import(new URL('api.js', base));

const missing = () => {
  const err = new Error('relation does not exist');
  err.code = '42P01';
  throw err;
};

// A query stub: answers by the table the SQL names, or throws 42P01 for a
// table listed in `absent`.
function stub(tables, absent = []) {
  return async (sql) => {
    for (const name of absent) {
      if (sql.includes(`from ${name}`) || sql.includes(`${name})`)) missing();
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

// ---- the record the phone writes ------------------------------------------
{
  const data = await ultraMod.load(stub({
    'from devices': [{
      device_id: 'samsung-s24-ultra', display_name: 'S24 Ultra', online: true,
      last_seen_at: '2026-10-15T20:50:27Z', daemon_version: 's24-termux-https-worker-2026-07-27.1',
      platform: 'android', battery_level: 30, network_type: 'Cellular', carrier: 'AbuJeeAirtel',
      public_ip: '1.2.3.4', updated_at: '2026-10-15T20:50:27Z',
    }],
  }));
  assert.equal(data.device, 'samsung-s24-ultra');
  assert.equal(data.last_seen, '2026-10-15T20:50:27.000Z');
  assert.equal(data.battery, 30);
  assert.equal(data.carrier, 'AbuJeeAirtel');
  assert.equal(typeof data.age_seconds, 'number');
  assert.equal(data.stale, true, 'a record from 2026-10-15 is stale today');
  assert.equal('raw_payload' in data, false);

  const absent = await ultraMod.load(stub({}, ['devices']));
  assert.deepEqual(absent, { device: 'samsung-s24-ultra', migrated: false });
}

// ---- the dashboard adds the queue that explains a quiet device -------------
{
  const data = await dashboardMod.load(stub({
    'from devices': [{ device_id: 'samsung-s24-ultra', display_name: 'S24 Ultra', online: true, last_seen_at: '2026-10-15T20:50:27Z' }],
    'from device_telemetry': [{ kind: 'mobile', model: 'SM-S928B', battery_level: 30, cpu_temp_c: 31.5, observed_at: '2026-10-15T20:50:00Z' }],
    'from s24_commands': [{ waiting: 5 }],
  }));
  assert.equal(data.commands_waiting, 5, 'commands on record for the device are reported, not hidden');
  assert.equal(data.telemetry.length, 1);
  assert.equal(data.telemetry[0].model, 'SM-S928B');
  assert.equal(data.telemetry[0].cpu_temp_c, 31.5);

  const noTelemetry = await dashboardMod.load(stub({
    'from devices': [{ device_id: 'samsung-s24-ultra' }],
    'from s24_commands': [{ waiting: 0 }],
  }, ['device_telemetry']));
  assert.equal(noTelemetry.telemetry_missing, true);
  assert.deepEqual(noTelemetry.telemetry, []);
}

// ---- WhatsApp: exact counts and the busiest chats -------------------------
{
  const data = await whatsappMod.load(stub({
    'from wa_chats)': [{ chats: 863, messages: 113770, attachments: 33, newest_chat: '2026-10-04T10:00:00Z' }],
    'from wa_chats order': [{ name: 'Family', kind: 'group', msg_count: 4021, media_count: 12, last_at: '2026-10-04T10:00:00Z' }],
  }));
  assert.equal(data.chats, 863);
  assert.equal(data.messages, 113770);
  assert.equal(data.top_chats[0].chat, 'Family');
  assert.equal(data.top_chats[0].messages, 4021);

  const absent = await whatsappMod.load(stub({}, ['wa_chats']));
  assert.equal(absent.migrated, false);
  assert.equal(absent.messages, 0);
  assert.deepEqual(absent.top_chats, []);
}

// ---- Media: descriptions only, never a way to fetch the file --------------
{
  const data = await mediaMod.load(stub({
    'from wa_attachments order': [{ att_id: 'a1', file_name: 'photo.jpg', mime: 'image/jpeg', size_bytes: 2048, kind: 'image', sent_at: '2026-10-04T09:00:00Z' }],
    'from wa_attachments': [{ c: 33, b: 991232 }],
  }));
  assert.equal(data.count, 33);
  assert.equal(data.bytes, 991232);
  assert.deepEqual(Object.keys(data.attachments[0]).sort(), ['kind', 'mime', 'name', 'sent_at', 'size_bytes']);
  assert.equal(JSON.stringify(data).includes('blob'), false, 'no storage path may appear');

  const absent = await mediaMod.load(stub({}, ['wa_attachments']));
  assert.equal(absent.migrated, false);
  assert.deepEqual(absent.attachments, []);
}

// ---- Telegram: an empty table is legible, not blank -----------------------
{
  const data = await telegramMod.load(stub({
    'from tg_chats)': [{ chats: 0, messages: 0, runs: 0 }],
    'from tg_sync_runs': [],
  }));
  assert.deepEqual(data, { chats: 0, messages: 0, runs: 0, sync_runs: [] });

  const absent = await telegramMod.load(stub({}, ['tg_chats']));
  assert.equal(absent.migrated, false);
}

// ---- Live feed: the two tails ---------------------------------------------
{
  const data = await liveMod.load(stub({
    'from wa_messages': [{ sender: 'A', body: 'hello', sent_at: '2026-10-04T09:00:00Z' }],
    'from events': [{ event_type: 'pageview', occurred_at: '2026-10-28T14:00:00Z', country: 'IN', city: 'Patna' }],
  }));
  assert.equal(data.messages[0].text, 'hello');
  assert.equal(data.events[0].place, 'Patna, IN');

  const absent = await liveMod.load(stub({}, ['wa_messages', 'events']));
  assert.deepEqual(absent, { migrated: false, messages: [], events: [] });
}

// ---- the gate --------------------------------------------------------------
{
  const saved = process.env.STATS_KEY;
  try {
    delete process.env.STATS_KEY;
    assert.deepEqual(ultraMod.authorised({ query: {} }), {
      ok: false, status: 503, code: 'auth_not_configured', error: 'STATS_KEY is not configured on the server',
    }, 'an unconfigured server is 503, never 401');

    process.env.STATS_KEY = 'correct-horse';
    assert.equal(ultraMod.authorised({ query: { key: 'correct-horse' } }).ok, true);
    assert.equal(ultraMod.authorised({ headers: { 'x-stats-key': 'correct-horse' } }).ok, true, 'header form works');
    assert.equal(ultraMod.authorised({ query: { key: 'wrong' } }).code, 'auth_invalid');
    assert.equal(ultraMod.authorised({ query: {} }).code, 'auth_missing');
    assert.equal(ultraMod.authorised({ query: { key: 'correct-horse!' } }).code, 'auth_invalid');
  } finally {
    if (saved === undefined) delete process.env.STATS_KEY; else process.env.STATS_KEY = saved;
  }
}

// ---- the handler's database-free paths ------------------------------------
{
  const saved = process.env.STATS_KEY;
  try {
    delete process.env.STATS_KEY;
    const res = fakeRes();
    await ultra({ method: 'POST', query: {} }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');

    const unauth = fakeRes();
    await ultra({ method: 'GET', query: {} }, unauth);
    assert.equal(unauth.statusCode, 503);
    assert.equal(unauth.body.code, 'auth_not_configured');

    process.env.STATS_KEY = 'correct-horse';
    const wrong = fakeRes();
    await ultra({ method: 'GET', query: { key: 'nope' } }, wrong);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.body.code, 'auth_invalid');
  } finally {
    if (saved === undefined) delete process.env.STATS_KEY; else process.env.STATS_KEY = saved;
  }
}

// ---- the index -------------------------------------------------------------
{
  assert.deepEqual(group.SECTIONS, ['s24', 'device', 'whatsapp', 'media', 'telegram', 'live']);

  const res = fakeRes();
  await group.default({ method: 'GET', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group, 'S24');
  assert.equal(res.body.sections.length, 6);
  assert.ok(res.body.sections.every((s) => s.endpoint && s.title && Array.isArray(s.tables)));

  const bad = fakeRes();
  await group.default({ method: 'GET', query: { section: 'nope' } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.sections.length, 6);
}

console.log('S24 sections: projection, missing-table honesty, gate, handler and index checks passed');
