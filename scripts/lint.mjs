import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

for (const dir of ['Backend', 'Integrations', 'scripts']) {
  for (const file of walk(join(root, dir)).filter((path) => path.endsWith('.js') || path.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) failures.push(`${file}: ${result.stderr.trim()}`);
  }
}

const htmlFiles = [
  'Frontend/index.html', 'Frontend/agent.html', 'Frontend/db.html', 'Frontend/viewer.html',
  'Devices/sandbox/dashboard/index.html',
];
for (const relative of htmlFiles) {
  const source = readFileSync(join(root, relative), 'utf8');
  if (/transition\s*:\s*all\b/i.test(source)) failures.push(`${relative}: transition: all is forbidden`);
  if (/\sonclick\s*=/i.test(source)) failures.push(`${relative}: inline onclick is forbidden`);
  if (/wa-media\?[^'"\s>]*&key=/i.test(source)) failures.push(`${relative}: dashboard key appears in a media URL`);
  if (/localStorage\.setItem\(\s*(?:KEY_STORAGE|KEY_STORE|'jbt_stats_key'|"jbt_stats_key")/.test(source)) {
    failures.push(`${relative}: dashboard key must not persist in localStorage`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`lint verified JavaScript syntax and ${htmlFiles.length} security/accessibility surfaces`);
