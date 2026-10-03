import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const frontend = join(root, 'Frontend');
const required = ['index.html', 'agent.html', 'db.html', 's24.html', 'vivobook.html', 'jteka.html', 'viewer.html'];

for (const file of required) {
  const path = join(frontend, file);
  if (!existsSync(path)) throw new Error(`missing frontend entrypoint: ${file}`);
}

const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
for (const build of vercel.builds || []) {
  if (build.src.includes('*')) continue;
  if (!existsSync(join(root, build.src))) throw new Error(`vercel build source does not exist: ${build.src}`);
}

let scripts = 0;
for (const file of readdirSync(frontend).filter((name) => name.endsWith('.html'))) {
  const html = readFileSync(join(frontend, file), 'utf8');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    new vm.Script(match[1], { filename: `${file}:inline-script` });
    scripts++;
  }
}

console.log(`build verified ${required.length} routes and ${scripts} inline scripts`);
