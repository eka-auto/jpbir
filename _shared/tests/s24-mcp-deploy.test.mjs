// Guards the s24-mcp droplet deployment.
//
// s24-mcp-server.mjs and s24-mcp.service sat in the repo for weeks as dead code:
// deploy.sh never shipped either one, the unit's ExecStart named server.mjs
// (the file is s24-mcp-server.mjs, so systemctl start would fail even once
// shipped), package.json never declared @modelcontextprotocol/sdk, and
// deploy.sh never generated S24_MCP_TOKEN — which the server treats as fatal.
//
// None of it was caught because the module imported device-health.mjs by
// ABSOLUTE path ('/opt/jp-agent/device-health.mjs'), so no test could import
// it and every suite had to regex the source instead of executing it. These
// assertions check the deployment contract, and the relative-import invariant
// that makes real execution possible at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DEPLOY = 'Server/jp-agent/deploy.sh';
const UNIT = 'Server/jp-agent/s24-mcp.service';
const MCP_SERVER = 'Server/jp-agent/s24-mcp-server.mjs';
const PKG = 'Server/jp-agent/package.json';
const TOKEN_SYNC = 'Server/jp-agent/sync-auth-token.py';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ------------------------------------------------- the module can actually be run --

t('s24-mcp-server.mjs imports device-health relatively, not by absolute droplet path', () => {
  const src = read(MCP_SERVER);
  assert.doesNotMatch(src, /from\s+['"]\//,
    'an absolute import pins this module to one droplet directory and makes it impossible to import from a test');
  assert.match(src, /from\s+['"]\.\/device-health\.mjs['"]/,
    'device-health.mjs must be a relative import so it resolves both on the droplet and in tests');
});

t('the MCP SDK the server imports is a declared dependency', () => {
  const src = read(MCP_SERVER);
  const pkg = JSON.parse(read(PKG));
  const imported = [...src.matchAll(/from\s+'(@modelcontextprotocol\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(imported.length > 0, 'expected s24-mcp-server.mjs to import the MCP SDK');
  for (const spec of imported) {
    // The SDK exposes subpaths (server/mcp.js) under one package name.
    const pkgName = spec.split('/').slice(0, 2).join('/');
    assert.ok(pkg.dependencies?.[pkgName],
      `${pkgName} is imported by ${MCP_SERVER} but missing from package.json - the droplet would fail at runtime`);
  }
  const lock = JSON.parse(read('Server/jp-agent/package-lock.json'));
  assert.ok(lock.packages['node_modules/@modelcontextprotocol/sdk'],
    'package-lock.json has no @modelcontextprotocol/sdk entry, so `npm ci` on the droplet installs nothing for it');
});

// --------------------------------------------------- deploy.sh must ship it all --

t('deploy.sh ships s24-mcp-server.mjs and installs its unit', () => {
  const sh = read(DEPLOY);
  assert.match(sh, /s24-mcp-server\.mjs/,
    'deploy.sh never scps s24-mcp-server.mjs, so the unit can never start');
  assert.match(sh, /s24-mcp\.service/,
    'deploy.sh never installs s24-mcp.service, so systemd has no unit to enable');
  assert.match(sh, /\/opt\/s24-mcp/,
    'deploy.sh never creates /opt/s24-mcp, the unit WorkingDirectory');
});

t('deploy.sh ships device-health.mjs alongside the MCP server that imports it', () => {
  // s24-mcp-server.mjs imports ./device-health.mjs, so both files must land in
  // the same directory. Shipping only the server yields ERR_MODULE_NOT_FOUND.
  const sh = read(DEPLOY);
  const toMcpDir = sh.match(/scp[^\n]*(?:\n\s+[^\n]*)*?\/opt\/s24-mcp\//);
  assert.ok(toMcpDir, 'deploy.sh has no scp targeting /opt/s24-mcp/');
  assert.match(toMcpDir[0], /device-health\.mjs/,
    'device-health.mjs is not shipped to /opt/s24-mcp, so the relative import cannot resolve');
});

t('deploy.sh ships the whole relative-import closure into /opt/s24-mcp', () => {
  // The direct import is not the whole story: device-health.mjs itself imports
  // ./s24-attestation.js. Shipping only server + device-health leaves node
  // failing at startup with ERR_MODULE_NOT_FOUND on s24-attestation.js. This
  // walks the real import graph instead of hardcoding a list of files.
  const sh = read(DEPLOY);
  const block = sh.match(/scp[^\n]*(?:\n\s+[^\n]*)*?\/opt\/s24-mcp\//);
  assert.ok(block, 'deploy.sh has no scp targeting /opt/s24-mcp/');
  const shipped = new Set(
    [...block[0].matchAll(/"([^"\n]+\.(?:mjs|js))"?/g)].map((m) => m[1].split('/').pop()),
  );

  // Walk ./ relative imports transitively from the entrypoint.
  const seen = new Set();
  const queue = ['s24-mcp-server.mjs'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(`Server/jp-agent/${file}`).matchAll(/from\s+'\.\/([^']+)'/g)) {
      const dep = m[1];
      assert.ok(shipped.has(dep),
        `${file} imports ./${dep}, but deploy.sh does not ship ${dep} to /opt/s24-mcp - node fails at startup with ERR_MODULE_NOT_FOUND (ships: ${[...shipped].join(', ')})`);
      queue.push(dep);
    }
  }
  assert.ok(seen.size > 1, 'expected s24-mcp-server.mjs to have relative imports to walk');
});

t("the unit's ExecStart names a file deploy.sh actually ships", () => {
  const unit = read(UNIT);
  const sh = read(DEPLOY);
  const execStart = unit.match(/^ExecStart=.*$/m);
  assert.ok(execStart, 's24-mcp.service has no ExecStart');
  const execPath = execStart[0].replace(/^ExecStart=\S*\s*/, '').trim();
  // The unit's target must be among the files this deploy actually ships, and
  // that shipment must be INTO /opt/s24-mcp. Comparing the basename against a
  // substring of deploy.sh is not enough: 's24-mcp-server.mjs'.includes(
  // 'server.mjs') is true, and Server/jp-agent/server.mjs really does exist as
  // jp-agent's own entrypoint, so both a substring check and an existence check
  // pass while the unit still points at a file that is never sent to
  // /opt/s24-mcp. That was the original bug, undetected for weeks.
  const basename = execPath.split('/').pop();
  const shipped = [...sh.matchAll(/"?\$\(dirname "\$0"\)\/([^\s"]+)"?/g)].map((m) => m[1]);
  assert.ok(shipped.includes(basename),
    `deploy.sh never ships ${basename} (ships: ${shipped.join(', ')}), so ExecStart has nothing to run`);
  // Find the scp that lands files in /opt/s24-mcp and confirm this basename is
  // among its sources.
  let landsInMcpDir = false;
  for (const m of sh.matchAll(/scp[^\n]*(?:\n\s+[^\n]*?)*?\/opt\/s24-mcp\//g)) {
    // Sources look like "$(dirname "$0")/s24-mcp-server.mjs". Match the trailing
    // basename of each quoted argument rather than the whole $(dirname ...)
    // expression, which contains "$0" and is easy to get wrong.
    const sources = [...m[0].matchAll(/"([^"\n]+\.(?:mjs|js|py|json))"?/g)]
      .map((s) => s[1].split('/').pop());
    if (sources.includes(basename)) landsInMcpDir = true;
  }
  assert.ok(landsInMcpDir,
    `${basename} is shipped somewhere, but never into /opt/s24-mcp - the unit's ExecStart cannot find it`);
});

t('s24-mcp is installed with its own dependencies and enabled at boot', () => {
  const sh = read(DEPLOY);
  assert.match(sh, /enable\s+s24-mcp/, 'deploy.sh never runs `systemctl enable s24-mcp`');
  assert.match(sh, /restart\s+s24-mcp/, 'deploy.sh never restarts s24-mcp');
  assert.match(sh, /npm\s+ci[\s\S]*?s24-mcp|s24-mcp[\s\S]*?npm\s+ci/,
    'deploy.sh never runs `npm ci` for /opt/s24-mcp, so its node_modules is never installed');
});

// ------------------------------------------------------------- the token contract --

t('deploy.sh generates S24_MCP_TOKEN on both the fresh and upgrade paths', () => {
  const sh = read(DEPLOY);
  // The server exits 1 without it, so a box that never gets one has a dead unit
  // whose failure looks like a missing file rather than a missing token.
  assert.match(sh, /S24_MCP_TOKEN=/,
    'deploy.sh never writes S24_MCP_TOKEN, so s24-mcp refuses to start');
  const upgrade = sh.match(/jp-agent\.env already present[\s\S]*?\nfi/);
  assert.ok(upgrade, 'deploy.sh has no env upgrade path');
  assert.match(upgrade[0], /S24_MCP_TOKEN=/,
    'the upgrade path does not backfill S24_MCP_TOKEN, so an existing box stays broken after redeploy');
});

t('rotating the Anthropic token restarts every unit that reads it', () => {
  const src = read(TOKEN_SYNC);
  // Both units share /etc/jp-agent.env; restarting only one leaves the other on
  // the rotated-away credential. jp-agent must be a checked, mandatory restart
  // (the new token never takes effect without it); s24-mcp must be restarted
  // too, but tolerantly, so a box whose unit is not installed yet can still
  // rotate its token instead of failing the whole sync.
  assert.match(src, /'restart',\s*'jp-agent'\],\s*check=True/,
    'sync-auth-token.py no longer performs a checked restart of jp-agent');
  assert.match(src, /'restart',\s*'s24-mcp'/,
    'sync-auth-token.py never restarts s24-mcp, which shares /etc/jp-agent.env');
  const mcpRestart = src.match(/systemctl',\s*'restart',\s*'s24-mcp'[^\n]*\n(?:[^\n]*\n)?/);
  assert.ok(mcpRestart, 'expected a subprocess call restarting s24-mcp');
  assert.doesNotMatch(mcpRestart[0], /check=True/,
    'the s24-mcp restart must not be check=True: an un-redeployed box has no such unit and would fail token rotation entirely');
});

t('the MCP server refuses to serve unauthenticated', () => {
  const src = read(MCP_SERVER);
  assert.match(src, /S24_MCP_TOKEN/,
    's24-mcp-server.mjs no longer reads S24_MCP_TOKEN');
  assert.match(src, /process\.exit\(1\)/,
    's24-mcp-server.mjs no longer fails closed when S24_MCP_TOKEN is unset');
});

console.log(`${pass}/${total} checks passed`);
