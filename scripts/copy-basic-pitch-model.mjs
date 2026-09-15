import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(projectRoot, "node_modules/@spotify/basic-pitch");
const sourceModelDir = resolve(packageDir, "model");
const targetModelDir = resolve(projectRoot, "public/basic-pitch");
const targetLicenseDir = resolve(projectRoot, "public/licenses");

await Promise.all([
  mkdir(targetModelDir, { recursive: true }),
  mkdir(targetLicenseDir, { recursive: true })
]);

const model = JSON.parse(await readFile(resolve(sourceModelDir, "model.json"), "utf8"));
for (const group of model.weightsManifest) {
  group.paths = group.paths.map((path) => path.replace(/\.bin$/, ".data"));
}
await Promise.all([
  writeFile(resolve(targetModelDir, "model.json"), JSON.stringify(model)),
  copyFile(resolve(sourceModelDir, "group1-shard1of1.bin"), resolve(targetModelDir, "group1-shard1of1.data")),
  copyFile(resolve(packageDir, "LICENSE"), resolve(targetLicenseDir, "spotify-basic-pitch-LICENSE.txt"))
]);

console.log("[DFH] Basic Pitch model and license copied to public/");
