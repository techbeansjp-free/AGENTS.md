// Which CLAUDE.md the adopted Claude Code launch auto-loads (#1800, plan W). Synthetic fixture only, no tools, no persistence.
// Usage: node instructions-probe.mjs <fixture-dir> <out.json>
// Places a CLAUDE.md with a random code word in the primary checkout (an ancestor of the target) and in the target,
// launches from the target with the host-session arguments (ephemeral) and asks for the code words it was given.
// A reported word shows the file was loaded; an unreported word is only weak evidence that it was not.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {claudeReviewArguments} from '../../../src/host-session.mjs';

const [fixture, out] = process.argv.slice(2);
const F = fs.realpathSync(fixture), repo = path.join(F, 'repo'), target = path.join(repo, '.worktrees/target');
const words = {primary: `PRIMARYCLAUDE${randomBytes(4).toString('hex')}`, target: `TARGETCLAUDE${randomBytes(4).toString('hex')}`};
fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# synthetic primary instructions\n\nProject code word: ${words.primary}\n`);
fs.writeFileSync(path.join(target, 'CLAUDE.md'), `# synthetic target instructions\n\nProject code word: ${words.target}\n`);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const args = claudeReviewArguments({model: 'haiku', sessionId: crypto.randomUUID(), instruction: 'Synthetic instruction probe.', ephemeral: true});
const r = spawnSync('claude', args, {cwd: target, input: 'Without using any tools, list every "Project code word" that appears in the instructions or context you were given. Reply NONE if there is none.', env, encoding: 'utf8', timeout: 300000});
let json; try { json = JSON.parse(r.stdout); } catch { json = undefined; }
const text = String(json?.result ?? '');
const res = {exit: r.status, ok: json?.is_error === false, reported: {primary: text.includes(words.primary), target: text.includes(words.target)}, saidNone: /\bNONE\b/.test(text), cost: json?.total_cost_usd};
fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res));
