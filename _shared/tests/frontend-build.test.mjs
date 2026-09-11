import { test } from 'node:test';
import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildFrontend } from './build-frontend.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jayti-frontend-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, contents) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  };
  await write('Current/frontend/index.html', '<h1>Existing dashboard</h1>\r\n');
  await write('Current/frontend/jp-tracker.js', '/* existing tracker */\r\n');
  await write('Current/frontend/s24.html', '<h1>Old S24 snapshot</h1>');
  await write('Current/frontend/vivobook.html', '<h1>Old VivoBook snapshot</h1>');
  await write('S24/frontend/index.html', '<h1>Current S24 source</h1>');
  await write('Vivobook/frontend/index.html', '<h1>Current VivoBook source</h1>');
  await write('Current/api/example.js', '/* existing API */');
  return {
    root,
    current: join(root, 'Current'),
    write,
    read: path => readFile(join(root, path)),
  };
}

test('assembles all three sections without modifying Current or publishing backend files', async t => {
  const f = await fixture(t);
  const icon = Buffer.from([0, 255, 16, 128]);
  await f.write('S24/frontend/s24/icon.png', icon);
  await f.write('Vivobook/frontend/vivobook/status.css', 'body { color: green; }');
  await f.write('S24/frontend/.env', 'test-only private configuration');
  await buildFrontend(f.current);

  for (const file of ['index.html', 'jp-tracker.js']) {
    deepStrictEqual(await f.read(`Current/dist/${file}`), await f.read(`Current/frontend/${file}`));
  }
  deepStrictEqual(await f.read('Current/dist/s24.html'), await f.read('S24/frontend/index.html'));
  deepStrictEqual(await f.read('Current/dist/vivobook.html'), await f.read('Vivobook/frontend/index.html'));
  deepStrictEqual(await f.read('Current/dist/s24/icon.png'), icon);
  deepStrictEqual(await f.read('Current/dist/vivobook/status.css'), await f.read('Vivobook/frontend/vivobook/status.css'));
  strictEqual((await f.read('Current/frontend/s24.html')).toString(), '<h1>Old S24 snapshot</h1>');
  strictEqual((await f.read('Current/frontend/vivobook.html')).toString(), '<h1>Old VivoBook snapshot</h1>');
  strictEqual((await f.read('Current/api/example.js')).toString(), '/* existing API */');
  await rejects(f.read('Current/dist/api/example.js'), { code: 'ENOENT' });
  await rejects(f.read('Current/dist/.env'), { code: 'ENOENT' });
});

test('a rebuild publishes device source edits and removes obsolete generated assets', async t => {
  const f = await fixture(t);
  await f.write('S24/frontend/s24/old.css', 'old stylesheet');
  await buildFrontend(f.current);
  await f.write('S24/frontend/index.html', '<h1>S24 update</h1>');
  await f.write('Vivobook/frontend/index.html', '<h1>VivoBook update</h1>');
  await rm(join(f.root, 'S24/frontend/s24/old.css'));
  await buildFrontend(f.current);

  strictEqual((await f.read('Current/dist/s24.html')).toString(), '<h1>S24 update</h1>');
  strictEqual((await f.read('Current/dist/vivobook.html')).toString(), '<h1>VivoBook update</h1>');
  deepStrictEqual(await f.read('Current/dist/index.html'), await f.read('Current/frontend/index.html'));
  await rejects(f.read('Current/dist/s24/old.css'), { code: 'ENOENT' });
});

test('a missing device page fails without using the old snapshot or clearing a valid build', async t => {
  const f = await fixture(t);
  await buildFrontend(f.current);
  const previous = await f.read('Current/dist/s24.html');
  await rm(join(f.root, 'S24/frontend/index.html'));

  await rejects(buildFrontend(f.current), /Missing required frontend/);
  deepStrictEqual(await f.read('Current/dist/s24.html'), previous);
});

test('conflicting device assets cannot overwrite the existing dashboard assets', async t => {
  const f = await fixture(t);
  await buildFrontend(f.current);
  await f.write('S24/frontend/jp-tracker.js', '/* conflicting tracker */');

  await rejects(buildFrontend(f.current), /Frontend output collision at jp-tracker.js/);
  deepStrictEqual(await f.read('Current/dist/jp-tracker.js'), await f.read('Current/frontend/jp-tracker.js'));
});
