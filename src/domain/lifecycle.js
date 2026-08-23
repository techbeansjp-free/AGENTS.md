import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../lib/atomic.js';
import { resolveContained } from '../lib/security.js';
import { PACKAGE_VERSION } from '../lib/version.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_ASSETS = ['AGENTS.md'];
const NAMESPACE_ROOT_ASSETS = ['00_利用案内.md'];
const NAMESPACE_ASSETS = ['docs', 'skills', 'templates', 'schemas', 'policy'];

/** @param {string} relative */
function isPackageOwnedPath(relative) {
  const normalized = relative.replaceAll('\\', '/');
  return normalized === 'AGENTS.md' || NAMESPACE_ROOT_ASSETS.some((file) => normalized === `.agent-skill-chain/${file}`) || NAMESPACE_ASSETS.some((directory) => normalized.startsWith(`.agent-skill-chain/${directory}/`));
}

/** @param {string} file */
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/** @param {string} directory @returns {string[]} */
function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(resolved) : entry.isFile() ? [resolved] : [];
  });
}

/** @param {string} target */
function mappings(target) {
  const result = ROOT_ASSETS.map((name) => ({ src: path.join(packageRoot, name), dest: path.join(target, name) }));
  for (const file of NAMESPACE_ROOT_ASSETS) result.push({ src: path.join(packageRoot, '.agent-skill-chain', file), dest: path.join(target, '.agent-skill-chain', file) });
  for (const directory of NAMESPACE_ASSETS) {
    const source = path.join(packageRoot, '.agent-skill-chain', directory);
    if (!fs.existsSync(source)) continue;
    for (const file of walkFiles(source)) {
      const relative = path.relative(source, file);
      result.push({ src: path.join(source, relative), dest: path.join(target, '.agent-skill-chain', directory, relative) });
    }
  }
  return result;
}

/** @param {string} target @param {{apply: boolean}} options */
export function init(target, options) {
  const assets = mappings(target);
  const conflicts = assets.filter(({ src, dest }) => fs.existsSync(dest) && digest(src) !== digest(dest)).map(({ dest }) => dest);
  if (conflicts.length > 0) throw new Error(`初期導入先が競合しています。ファイルは書き込んでいません: ${conflicts.join(', ')}`);
  if (!options.apply) return { applied: false, assets: assets.map(({ dest }) => dest) };
  /** @type {{version: string, files: Record<string, string>}} */
  const record = { version: PACKAGE_VERSION, files: {} };
  for (const { src, dest } of assets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    record.files[path.relative(target, dest)] = digest(dest);
  }
  writeFileAtomic(path.join(target, '.agent-skill-chain', 'managed-assets.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { applied: true, assets: Object.keys(record.files) };
}

/** @param {string} target @param {{apply: boolean}} options */
export function upgrade(target, options) {
  const recordPath = path.join(target, '.agent-skill-chain', 'managed-assets.json');
  if (!fs.existsSync(recordPath)) throw new Error('未導入です。先にinstallを実行してください');
  const old = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const current = mappings(target);
  const retained = [];
  const planned = [];
  for (const item of current) {
    const key = path.relative(target, item.dest);
    if (fs.existsSync(item.dest) && (!old.files?.[key] || digest(item.dest) !== old.files[key])) retained.push(key);
    else planned.push(item);
  }
  if (!options.apply) return { applied: false, planned: planned.map((item) => path.relative(target, item.dest)), retained };
  const next = { version: PACKAGE_VERSION, files: { ...old.files } };
  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    fs.copyFileSync(item.src, item.dest);
    next.files[path.relative(target, item.dest)] = digest(item.dest);
  }
  writeFileAtomic(recordPath, `${JSON.stringify(next, null, 2)}\n`);
  return { applied: true, retained };
}

/** @param {string} target @param {{apply: boolean}} options */
export function uninstall(target, options) {
  const recordPath = path.join(target, '.agent-skill-chain', 'managed-assets.json');
  if (!fs.existsSync(recordPath)) throw new Error('未導入です');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const removable = [];
  const retained = [];
  for (const [relative, expected] of Object.entries(record.files ?? {})) {
    if (!isPackageOwnedPath(relative) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`managed asset recordが不正です: ${relative}`);
    const file = resolveContained(target, relative, { allowMissingLeaf: true });
    if (fs.existsSync(file) && digest(file) === expected) removable.push(file);
    else if (fs.existsSync(file)) retained.push(relative);
  }
  if (!options.apply) return { applied: false, removable, retained };
  for (const file of removable) fs.rmSync(file);
  fs.rmSync(recordPath);
  return { applied: true, retained, consumerAssetsPreserved: ['.agent-skill-chain/tmp', '.agent-skill-chain/project-policy.json', '.agent-skill-chain/project', 'docs/specs'] };
}

/** @param {string} target */
export function doctor(target) {
  const legacy = ['.agents', '.workflow'].filter((name) => fs.existsSync(path.join(target, name)));
  const installed = fs.existsSync(path.join(target, '.agent-skill-chain', 'managed-assets.json'));
  return { healthy: installed, installed, legacyDetected: legacy, legacyRuntimeEnabled: false, migration: legacy.length ? '診断のみ。旧資産は実行も変換もしません' : 'なし' };
}
