// The one place where the shared harness learns which measurement it runs. Every Issue-specific file (conditions.json,
// release.json, cases.json, run-order.json, decision-criteria.md, README.md, results/) lives in a config directory given
// by `--config <dir>` on the command line or by the environment variable ASC_EVAL_CONFIG. On import, `--config <dir>` is
// taken out of process.argv and stored in ASC_EVAL_CONFIG, so the positional arguments of every command stay as they were
// and child processes (run-all -> run-trial) get the same config. No harness file reads Issue-specific files from its
// own directory: a config directory inside the harness directory is refused. No model call.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_ROOT = path.resolve(HARNESS_DIR, '..');
export const REPO_ROOT = path.resolve(HARNESS_DIR, '../../..');

{
  const i = process.argv.indexOf('--config');
  if (i >= 2 && process.argv[i + 1]) {
    process.env.ASC_EVAL_CONFIG = path.resolve(process.argv[i + 1]);
    process.argv.splice(i, 2);
  }
}

const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// The config directory. Throws when none is given, when it has no conditions.json, or when it lies in the harness
// directory (the test config under test/ is the one exception: it is not an Issue's config).
export function configDir() {
  const d = process.env.ASC_EVAL_CONFIG;
  if (!d) throw new Error('no config directory: pass --config <dir> or set ASC_EVAL_CONFIG');
  const abs = path.resolve(d);
  if (inside(abs, HARNESS_DIR) && !inside(abs, path.join(HARNESS_DIR, 'test'))) throw new Error('the config directory must not be the harness directory');
  if (!fs.existsSync(path.join(abs, 'conditions.json'))) throw new Error(`no conditions.json in the config directory ${abs}`);
  return abs;
}

// #1866: a config may extend another config directory instead of copying its files (the Issue forbids copying #1844's
// config): its own conditions.json names the base with "extends" (a directory relative to the config, outside the
// harness, holding a conditions.json, itself extending nothing). Then
// - conditions.json is the base's, merged with the own one (objects key by key, recursively; any other value, an array
//   included, replaces the base's; null removes the key; "extends" itself is not kept);
// - every other config file (cases.json, run-order.json, release.json, decision-criteria.md, calibration.json) is the
//   own one when present, else the base's (cfgPath);
// - README.md and results/ are always the config's own (they are read by path, never through cfgPath).
// fixation.mjs fixes the files as read (config/<f>) and the base's own fixed files (base/<f>), so a change of the base
// after the fixation is caught. A config without "extends" is read as before.
const ownConditions = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'conditions.json'), 'utf8'));
export function baseDirOf(dir = configDir()) {
  const own = ownConditions(dir);
  if (own.extends === undefined) return null;
  if (typeof own.extends !== 'string' || !own.extends) throw new Error('conditions.json extends must be a directory relative to the config');
  const base = path.resolve(dir, own.extends);
  if (base === path.resolve(dir)) throw new Error('conditions.json extends names the config itself');
  if (inside(base, HARNESS_DIR)) throw new Error('conditions.json extends must not name the harness directory');
  if (!fs.existsSync(path.join(base, 'conditions.json'))) throw new Error(`no conditions.json in the base config ${base}`);
  if (ownConditions(base).extends !== undefined) throw new Error('the base config extends another config (one level only)');
  return base;
}
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export function mergeConditions(base, own) {
  const out = {...base};
  for (const [k, v] of Object.entries(own)) {
    if (k === 'extends') continue;
    if (v === null) delete out[k];
    else if (plain(v) && plain(out[k])) out[k] = mergeConditions(out[k], v);
    else out[k] = v;
  }
  return out;
}
export function cfgPath(f, dir = configDir()) {
  const own = path.join(dir, f);
  if (f === 'conditions.json' || fs.existsSync(own)) return own;
  const base = baseDirOf(dir);
  return base ? path.join(base, f) : own;
}
export function readCfg(f, dir = configDir()) {
  if (f === 'conditions.json') { const base = baseDirOf(dir); return base ? mergeConditions(ownConditions(base), ownConditions(dir)) : ownConditions(dir); }
  return JSON.parse(fs.readFileSync(cfgPath(f, dir), 'utf8'));
}
export const loadConditions = (dir) => readCfg('conditions.json', dir);
export const loadSpec = (dir) => readCfg('cases.json', dir);
export const loadOrder = (dir) => readCfg('run-order.json', dir);
export const loadRelease = (dir) => readCfg('release.json', dir);
// The files of a config that are fixed before any model run (fixation.mjs).
export const CONFIG_FIXED = ['decision-criteria.md', 'cases.json', 'conditions.json', 'release.json', 'run-order.json'];
