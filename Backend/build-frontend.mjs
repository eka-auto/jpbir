import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = fileURLToPath(new URL('../', import.meta.url));
const legacyDevicePages = new Set(['s24.html', 'vivobook.html']);

async function frontendFiles(directory, prefix = '') {
  const files = [];
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relativePath = join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Frontend source must not contain symlinks: ${join(directory, relativePath)}`);
    }
    if (entry.isDirectory()) files.push(...await frontendFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function buildFrontend(projectDirectory = currentDirectory) {
  const current = await realpath(projectDirectory);
  const sources = [
    { directory: join(current, 'Frontend'), page: 'index.html' },
    { directory: resolve(current, '../S24/frontend'), page: 's24.html' },
    { directory: resolve(current, '../Vivobook/frontend'), page: 'vivobook.html' },
  ];
  const output = new Map();

  // Validate every source before touching the previous generated build.
  for (const source of sources) {
    const entrypoint = join(source.directory, 'index.html');
    const entry = await lstat(entrypoint).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`Missing required frontend: ${entrypoint}`);
      throw error;
    });
    if (!entry.isFile() || (await lstat(source.directory)).isSymbolicLink()) {
      throw new Error(`Frontend entrypoint must be a regular file: ${entrypoint}`);
    }
    for (const relativePath of await frontendFiles(source.directory)) {
      // Retain Current's historical copies on disk, but build from the device sources.
      if (source.page === 'index.html' && legacyDevicePages.has(relativePath)) continue;
      const destination = relativePath === 'index.html' ? source.page : relativePath;
      const sourcePath = join(source.directory, relativePath);
      const contents = await readFile(sourcePath);
      const existing = output.get(destination);
      if (existing && !existing.contents.equals(contents)) {
        throw new Error(`Frontend output collision at ${destination}: ${existing.sourcePath} and ${sourcePath}`);
      }
      output.set(destination, { contents, sourcePath });
    }
  }
  for (const destination of output.keys()) {
    for (let parent = dirname(destination); parent !== '.'; parent = dirname(parent)) {
      if (output.has(parent)) throw new Error(`Frontend file/directory collision at ${parent}`);
    }
  }

  // The only directory removed is Current/dist, under the resolved project root.
  const outputDirectory = join(current, 'dist');
  const previous = await lstat(outputDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) {
    throw new Error(`Build output must be a regular directory: ${outputDirectory}`);
  }
  await rm(outputDirectory, { recursive: true, force: true });
  for (const [destination, { contents }] of output) {
    const outputPath = join(outputDirectory, destination);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents);
  }
  return { outputDirectory, fileCount: output.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { outputDirectory, fileCount } = await buildFrontend();
    console.log(`Built ${fileCount} frontend files in ${outputDirectory}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
