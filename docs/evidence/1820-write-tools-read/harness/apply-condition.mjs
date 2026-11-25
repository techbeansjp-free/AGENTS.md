// #1820: reduced from docs/evidence/1817-skill-application/harness/apply-condition.mjs. Every cell keeps the CLAUDE.md the
// product's adoption produced (make-fixture.mjs, #1814 condition I), so the pointer and hook paths of #1814 are gone; what
// stays is the one commit with the same neutral subject in every trial copy (#1814 review M1: the Host shows recent commit
// subjects in its git context). No model call.
// Usage: node apply-condition.mjs <fixture-copy>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git, gitEnv} from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
export const NEUTRAL_SUBJECT = 'Update project files';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const loadConditions = () => JSON.parse(fs.readFileSync(path.join(ev, 'conditions.json'), 'utf8'));

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
