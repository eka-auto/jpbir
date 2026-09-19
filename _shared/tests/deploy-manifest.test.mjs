// The deploy manifest must describe a tree that actually exists.
//
// vercel.json lists 33 `builds` entries, and every route the site depends on
// resolves through them. Nothing checks that the files are real, and — the part
// that bites — nothing checks the files those files *import*.
//
// Shared modules are imported, never routed, so they never appear in `builds`:
// Backend/_auth.js, Backend/lib/stale.js, Backend/lib/geo.js,
// Integrations/postgres.js, Integrations/wa-store.js. Any cleanup rule shaped
// like "not in builds = dead" removes them, every route that imports them
// starts throwing at cold start, and the manifest still looks perfectly valid.
// _auth.js is the one that matters most: it is the gate on every read route.
//
// Six checks, cheapest first.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const vercelIgnore = readFileSync(join(ROOT, '.vercelignore'), 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// 1. Every builds[].src exists. A glob src (Frontend/**) is checked by its
//    directory prefix, since the glob itself is not a path.
const builds = manifest.builds || [];
check('vercel.json declares builds', builds.length > 0, 'no builds array');

for (const b of builds) {
  const src = b.src;
  const globAt = src.indexOf('*');
  const probe = globAt === -1 ? src : src.slice(0, globAt).replace(/\/$/, '');
  check(`build src exists: ${src}`, existsSync(join(ROOT, probe)), `missing on disk: ${probe}`);
}

// 2. Every relative import reachable from a built Backend file resolves.
//    Walks transitively, so a shared module imported only by another shared
//    module is covered too.
const IMPORT_RE = /(?:^|\s)(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*)['"](\.[^'"]+)['"]/gm;
const EXTS = ['', '.js', '.mjs', '.json', '/index.js', '/index.mjs'];

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const entries = builds
  .map((b) => b.src)
  .filter((s) => s.startsWith('Backend/') && s.endsWith('.js') && !s.includes('*'))
  .map((s) => join(ROOT, s));

const seen = new Set();
const queue = [...entries];
let edges = 0;

while (queue.length) {
  const file = queue.pop();
  if (seen.has(file) || !existsSync(file)) continue;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1];
    const target = resolveImport(file, spec);
    edges++;
    if (!target) {
      check(
        `import resolves: ${relative(ROOT, file)} -> ${spec}`,
        false,
        'imported file does not exist — a shared module was moved or deleted',
      );
      continue;
    }
    if (!seen.has(target)) queue.push(target);
  }
}
check(
  `every relative import resolves (${seen.size} files, ${edges} edges)`,
  true,
  '',
);

// 3. The Terminal still calls the route this pipeline is built around. If this
//    fails, the frontend was rewired and the backend half is now orphaned.
const indexHtml = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');
check(
  "Frontend/index.html calls /api/agent-run",
  indexHtml.includes("fetch('/api/agent-run"),
  'the Terminal no longer posts to /api/agent-run',
);

// 4. Explicitly-routed handlers must be built. A route pointing at a file with
//    no build entry is a 404 that only shows up in production.
const ROUTED = [
  'Backend/agent-run.js',
  'Backend/s24-command.js',
  'Backend/broker-command-claim.js',
  'Backend/broker-command-complete.js',
  'Backend/vercel-analytics.js',
];
const built = new Set(builds.map((b) => b.src));
for (const file of ROUTED) {
  check(`explicitly routed and built: ${file}`, built.has(file), 'route exists but no builds entry');
}

// 5. A CLI deploy uploads the working directory rather than the Git tree.
//    These local trees total tens of gigabytes and once kept production deploys
//    stuck before Vercel could even create a deployment.
for (const dir of ['runs/', '.venv/', 'venv/', 'vscode-office/', 'node_modules/']) {
  check(`CLI deploy ignores ${dir}`, vercelIgnore.split(/\r?\n/).includes(dir), `${dir} is missing from .vercelignore`);
}

// 6. The repo-root .vercelignore also applies to the Git builds of
//    `channel-sandbox`, the Vercel project whose Root Directory is
//    Devices/sandbox. Three rules stripped its files before the build ran: a
//    bare `Devices/`, an unanchored `dashboard/`, and an unanchored `Sandbox/`.
//    The deploy went green with no output and served NOT_FOUND on every path.
//    Git applies the same gitignore rules, so it answers "would Vercel strip
//    this?" for every tracked file under the directory, with one catch:
//    Vercel's matcher (node-ignore) is CASE-INSENSITIVE by default, and
//    `Sandbox/` matching `sandbox/` is exactly the rule a case-sensitive git
//    missed. Hence core.ignorecase=true. It reproduced Vercel's real build
//    counts (244 stripped on main@87ba028) against node-ignore 5, 6 and 7.
const strippedSandbox = execFileSync(
  'git',
  ['-c', 'core.ignorecase=true', 'ls-files', '--cached', '--ignored', '--exclude-from=.vercelignore', '--', 'Devices/sandbox'],
  { cwd: ROOT, encoding: 'utf8' },
).split('\n').filter(Boolean);
check(
  '.vercelignore keeps every tracked file under Devices/sandbox (channel-sandbox Root Directory)',
  strippedSandbox.length === 0,
  `stripped before the channel-sandbox build: ${strippedSandbox.join(', ')}`,
);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
