// Shared harness: the one commit with the same neutral subject in every trial copy (#1814 review M1: the Host shows recent
// commit subjects in its git context). From docs/evidence/1820-write-tools-read/stage2/harness/apply-condition.mjs; the
// conditions come from the config directory (config.mjs). No model call.
// Usage: node apply-condition.mjs <fixture-copy>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {git, gitEnv} from './make-fixture.mjs';
import {loadConditions as loadCfgConditions} from './config.mjs';

export const NEUTRAL_SUBJECT = 'Update project files';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const loadConditions = () => loadCfgConditions();
export const loadRawConditions = loadConditions;

export function applyCondition(fixture) {
  const md = path.join(fixture, 'CLAUDE.md');
  const out = {claudeMdSha256: fs.existsSync(md) ? sha256(fs.readFileSync(md)) : null};
  git(['add', '-A'], fixture);
  out.changedFiles = spawnSync('git', ['diff', '--cached', '--name-only'], {cwd: fixture, env: gitEnv(fixture), encoding: 'utf8'}).stdout.split('\n').filter(Boolean);
  git(['commit', '-q', '--allow-empty', '-m', NEUTRAL_SUBJECT], fixture);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(applyCondition(path.resolve(process.argv[2]))));
}
