// Guards the s24-mcp service contract.
//
// s24-mcp-server.mjs and its systemd unit sat in the repo for weeks as dead code:
// the deploy script shipped neither, the unit's ExecStart named server.mjs (the
// file is s24-mcp-server.mjs, so `systemctl start` would fail even once shipped),
// package.json never declared @modelcontextprotocol/sdk, and no deploy path ever
// generated S24_MCP_TOKEN — which the server treats as fatal.
//
// None of it was caught because the module imported device-health.mjs by an
// ABSOLUTE path ('/opt/jp-agent/device-health.mjs'), so no test could import it
// and every suite had to regex the source instead of executing it.
//
// The service now deploys from git to Render, so there is no deploy script to pin.
// The assertions below cover what a git-based deploy must still get right: the
// relative import that makes the module executable at all, the dependencies and
// lock entry `npm ci` needs, the import closure that must sit beside it, and
// failing closed with no token.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MCP_SERVER = 'Server/jp-agent/s24-mcp-server.mjs';
const PKG = 'Server/jp-agent/package.json';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ------------------------------------------------- the module can actually be run --

t('s24-mcp-server.mjs imports device-health relatively, not by an absolute path', () => {
  const src = read(MCP_SERVER);
  assert.doesNotMatch(src, /from\s+['"]\//,
    'an absolute import pins this module to one directory and makes it impossible to import from a test');
  assert.match(src, /from\s+['"]\.\/device-health\.mjs['"]/,
    'device-health.mjs must be a relative import so it resolves both when deployed and in tests');
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
      `${pkgName} is imported by ${MCP_SERVER} but missing from package.json - the service would fail at runtime`);
  }
  const lock = JSON.parse(read('Server/jp-agent/package-lock.json'));
  assert.ok(lock.packages['node_modules/@modelcontextprotocol/sdk'],
    'package-lock.json has no @modelcontextprotocol/sdk entry, so `npm ci` installs nothing for it');
});

// ---------------------------------------- the import closure must sit beside it --

t('every module in the s24-mcp import closure exists next to s24-mcp-server.mjs', () => {
  // A git deploy uploads the directory, so the only way the closure can be
  // incomplete is a missing or renamed file in the repo. This replaces the old
  // "the deploy script scps each file" guard, which has nothing left to read now
  // that the service deploys from git.
  const src = read(MCP_SERVER);
  const relatives = [...src.matchAll(/from\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(relatives.length > 0, 'expected s24-mcp-server.mjs to import at least one sibling module');
  for (const rel of relatives) {
    assert.ok(existsSync(join(ROOT, 'Server/jp-agent', rel)),
      `${rel} is imported by ${MCP_SERVER} but does not exist beside it - the service would fail with ERR_MODULE_NOT_FOUND`);
  }
});

t('the MCP server refuses to serve unauthenticated', () => {
  const src = read(MCP_SERVER);
  assert.match(src, /S24_MCP_TOKEN/,
    's24-mcp-server.mjs no longer reads S24_MCP_TOKEN');
  assert.match(src, /process\.exit\(1\)/,
    's24-mcp-server.mjs no longer fails closed when S24_MCP_TOKEN is unset');
});

console.log(`${pass}/${total} checks passed`);
