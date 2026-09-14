// Load .env.local into process.env.
//
// Not `node --env-file=.env.local`: that flag needs Node 20.6+, while this
// project supports Node >= 18, so the flag fails before the script it is
// meant to configure ever runs.
//
// An existing environment variable always wins, so a value exported in the
// shell (or injected by CI) is never clobbered by the file.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnv(file = '.env.local') {
  const path = join(ROOT, file);
  if (!existsSync(path)) return 0;

  let loaded = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    // Vercel writes KEY="value"; strip one matched pair of quotes, not more.
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) { process.env[m[1]] = value; loaded++; }
  }
  return loaded;
}
