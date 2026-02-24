import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isPathWithinRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPathWithinRoot(rootPath, candidatePath, label) {
  const candidate = path.resolve(candidatePath);
  if (!isPathWithinRoot(rootPath, candidate)) {
    throw new Error(`[i18n] Refusing ${label} outside allowed root: ${candidate}`);
  }
  return candidate;
}

function flattenKeys(value, prefix = '', out = new Set()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenKeys(nested, nextPrefix, out);
    }
    return out;
  }

  if (prefix) out.add(prefix);
  return out;
}

function listFiles(rootDir, dir, exts, out = []) {
  const scanDir = assertPathWithinRoot(rootDir, dir, 'scan directory');
  for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
    const fullPath = assertPathWithinRoot(rootDir, path.join(scanDir, entry.name), `entry "${entry.name}"`);
    if (entry.isDirectory()) {
      listFiles(rootDir, fullPath, exts, out);
      continue;
    }
    if (entry.isFile() && exts.includes(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

function readJson(rootDir, filePath) {
  const safeFilePath = assertPathWithinRoot(rootDir, filePath, 'JSON file');
  return JSON.parse(fs.readFileSync(safeFilePath, 'utf8'));
}

function uniqSorted(items) {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function looksLikeKey(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > 200) return false;
  if (/\s/.test(trimmed)) return false;
  if (trimmed.includes('{{') || trimmed.includes('}}')) return false;
  return /^[A-Za-z0-9_.-]+$/.test(trimmed);
}

function collectKeyMatches(contents, regex) {
  const keys = [];
  let match;
  while ((match = regex.exec(contents)) !== null) {
    const candidate = match[2];
    if (looksLikeKey(candidate)) keys.push(candidate);
  }
  return keys;
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptsDir, '..');
const i18nDir = assertPathWithinRoot(frontendRoot, path.join(frontendRoot, 'src', 'assets', 'i18n'), 'i18n directory');
const appDir = assertPathWithinRoot(frontendRoot, path.join(frontendRoot, 'src', 'app'), 'app directory');

const i18nFiles = fs.existsSync(i18nDir)
  ? fs
      .readdirSync(i18nDir)
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b))
  : [];

if (i18nFiles.length === 0) {
  console.log('[i18n] No translation files found; skipping.');
  process.exit(0);
}

const baseLangFile = i18nFiles.includes('en.json') ? 'en.json' : i18nFiles[0];
const translations = new Map();

for (const name of i18nFiles) {
  const filePath = assertPathWithinRoot(i18nDir, path.join(i18nDir, name), `i18n file "${name}"`);
  const json = readJson(i18nDir, filePath);
  translations.set(name, flattenKeys(json));
}

const baseKeys = translations.get(baseLangFile);
if (!baseKeys) {
  console.error(`[i18n] Missing base language file: ${baseLangFile}`);
  process.exit(1);
}

let hasErrors = false;

for (const [name, keys] of translations.entries()) {
  if (name === baseLangFile) continue;
  const missing = uniqSorted(Array.from(baseKeys).filter((key) => !keys.has(key)));
  const extra = uniqSorted(Array.from(keys).filter((key) => !baseKeys.has(key)));

  if (missing.length > 0) {
    hasErrors = true;
    console.error(`[i18n] ${name} is missing ${missing.length} keys compared to ${baseLangFile}:`);
    for (const key of missing.slice(0, 50)) console.error(`  - ${key}`);
    if (missing.length > 50) console.error(`  …and ${missing.length - 50} more`);
  }

  if (extra.length > 0) {
    hasErrors = true;
    console.error(`[i18n] ${name} has ${extra.length} extra keys not present in ${baseLangFile}:`);
    for (const key of extra.slice(0, 50)) console.error(`  - ${key}`);
    if (extra.length > 50) console.error(`  …and ${extra.length - 50} more`);
  }
}

const codeFiles = fs.existsSync(appDir) ? listFiles(appDir, appDir, ['.ts', '.html']) : [];
const codeKeys = [];

for (const filePath of codeFiles) {
  const safeFilePath = assertPathWithinRoot(appDir, filePath, 'code file');
  const contents = fs.readFileSync(safeFilePath, 'utf8');

  codeKeys.push(...collectKeyMatches(contents, /\bthis\.t\(\s*(['"])(.*?)\1\s*\)/g));
  codeKeys.push(...collectKeyMatches(contents, /\btranslate\.instant\(\s*(['"])(.*?)\1\s*\)/g));
  codeKeys.push(...collectKeyMatches(contents, /\btranslate\.get\(\s*(['"])(.*?)\1\s*\)/g));
  codeKeys.push(...collectKeyMatches(contents, /(['"])(.*?)\1\s*\|\s*translate\b/g));
}

const missingFromBase = uniqSorted(codeKeys.filter((key) => !baseKeys.has(key)));
if (missingFromBase.length > 0) {
  hasErrors = true;
  console.error(
    `[i18n] Found ${missingFromBase.length} translation keys referenced in code but missing from ${baseLangFile}:`
  );
  for (const key of missingFromBase.slice(0, 50)) console.error(`  - ${key}`);
  if (missingFromBase.length > 50) console.error(`  …and ${missingFromBase.length - 50} more`);
}

const unusedInBase = uniqSorted(Array.from(baseKeys).filter((key) => !new Set(codeKeys).has(key)));
if (unusedInBase.length > 0) {
  console.warn(`[i18n] Note: ${unusedInBase.length} keys in ${baseLangFile} were not detected in static code usage.`);
  console.warn('[i18n] This is informational only (dynamic keys/templates may not be detected).');
}

if (hasErrors) process.exit(1);

console.log(
  `[i18n] OK (${baseLangFile}: ${baseKeys.size} keys; scanned ${codeFiles.length} files, found ${uniqSorted(codeKeys).length} static keys)`
);
