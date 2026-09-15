import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

// Toy's published extension allowlist. Fail closed on unexpected build files.
const allowed = new Set('html htm css js json wasm data md csv tsv png jpg jpeg gif svg webp ico woff2 woff ttf eot mp3 wav ogg m4a mp4 webm atlas ani part nani unityweb'.split(' '));
const source = resolve('dist');
if (!process.argv[2]) throw new Error('Provide a new output directory');
const target = resolve(process.argv[2]);
await mkdir(target); // A new directory prevents stale files from entering a release.
let count = 0;
async function copy(relative = '') {
  for (const entry of await readdir(resolve(source, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (path === 'melody/python') continue; // Removed Partitura runtime, never shipped.
    if (entry.isDirectory()) { await copy(path); continue; }
    const extension = extname(path).slice(1).toLowerCase();
    if (extension === 'map') continue;
    if (['basic-pitch/group1-shard1of1.bin', 'melody/symbolic-pop.bin'].includes(path)) {
      await access(resolve(source, path.replace(/\.bin$/, '.data')));
      continue; // Superseded build artifacts, with a required .data replacement.
    }
    const output = extension === 'txt' ? path.replace(/\.txt$/i, '.md') : path;
    if (!allowed.has(extname(output).slice(1).toLowerCase())) throw new Error(`Unsupported Toy file: ${path}`);
    await mkdir(dirname(resolve(target, output)), { recursive: true });
    if (extension === 'txt') {
      const text = (await readFile(resolve(source, path), 'utf8')).replaceAll('LICENSE.txt', 'LICENSE.md');
      await writeFile(resolve(target, output), text);
    } else await copyFile(resolve(source, path), resolve(target, output));
    count += 1;
  }
}
await copy();
const model = JSON.parse(await readFile(resolve(target, 'basic-pitch/model.json'), 'utf8'));
for (const group of model.weightsManifest) for (const path of group.paths) {
  if (!path.endsWith('.data')) throw new Error(`Unsupported model shard: ${path}`);
  await access(resolve(target, 'basic-pitch', path));
}
await access(resolve(target, 'melody/symbolic-pop.data'));
console.log(JSON.stringify({ directory: target, files: count, whitelist: 'passed', modelPaths: 'passed' }));
