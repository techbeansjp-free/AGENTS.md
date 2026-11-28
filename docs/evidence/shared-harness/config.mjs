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

export const cfgPath = (f, dir = configDir()) => path.join(dir, f);
export const readCfg = (f, dir = configDir()) => JSON.parse(fs.readFileSync(cfgPath(f, dir), 'utf8'));
export const loadConditions = (dir) => readCfg('conditions.json', dir);
export const loadSpec = (dir) => readCfg('cases.json', dir);
export const loadOrder = (dir) => readCfg('run-order.json', dir);
export const loadRelease = (dir) => readCfg('release.json', dir);
// The files of a config that are fixed before any model run (fixation.mjs).
export const CONFIG_FIXED = ['decision-criteria.md', 'cases.json', 'conditions.json', 'release.json', 'run-order.json'];
// #1867: conditions.json fixedExtra [path] adds config files (relative to the config directory, e.g. the layer 1-3
// settings run outside the harness) to the fixed files. Without the field the list is CONFIG_FIXED, as before.
export function configFixed(dir = configDir()) {
  const extra = loadConditions(dir).fixedExtra ?? [];
  if (!Array.isArray(extra)) throw new Error('conditions.json fixedExtra must be an array of paths');
  for (const f of extra) {
    const abs = path.resolve(dir, String(f));
    if (typeof f !== 'string' || !f || path.isAbsolute(f) || !inside(abs, dir) || abs === path.resolve(dir)) throw new Error(`conditions.json fixedExtra: ${f} is not a path inside the config directory`);
    if (CONFIG_FIXED.includes(f) || f.startsWith('results/')) throw new Error(`conditions.json fixedExtra: ${f} is already fixed or a result`);
    if (!fs.existsSync(abs)) throw new Error(`conditions.json fixedExtra: ${f} does not exist`);
  }
  if (new Set(extra).size !== extra.length) throw new Error('conditions.json fixedExtra has a duplicate');
  return [...CONFIG_FIXED, ...extra];
}
