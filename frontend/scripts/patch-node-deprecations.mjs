import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const filesToPatch = [
  'node_modules/http-proxy/lib/http-proxy/index.js',
  'node_modules/http-proxy/lib/http-proxy/common.js'
];

const needle = "require('util')._extend";
const replacement = 'Object.assign';

async function patchFile(relativePath) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  let content;

  try {
    content = await readFile(fullPath, 'utf8');
  } catch {
    console.warn(`[postinstall] Skipping missing file: ${relativePath}`);
    return;
  }

  if (!content.includes(needle)) {
    console.log(`[postinstall] No util._extend usage found in: ${relativePath}`);
    return;
  }

  const patched = content.replaceAll(needle, replacement);
  await writeFile(fullPath, patched, 'utf8');
  console.log(`[postinstall] Patched Node DEP0060 util._extend in: ${relativePath}`);
}

await Promise.all(filesToPatch.map((file) => patchFile(file)));
