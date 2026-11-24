// Create the synthetic fixture for probe-run.mjs and codex-probe.mjs.
// Usage: node setup-fixture.mjs <new-or-empty-directory>
// Layout: <dir>/{repo (primary checkout), repo/.worktrees/{target,other}, outside, external-target}.
// Markers are random harmless values; nothing here is a real secret or user setting.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const P = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('fixture directory required');
const repo = path.join(P, 'repo'), target = path.join(repo, '.worktrees/target'), other = path.join(repo, '.worktrees/other'), outside = path.join(P, 'outside');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', ...args], {stdio: 'ignore', env});
const marker = (file, prefix) => fs.writeFileSync(file, `${prefix}-${randomBytes(8).toString('hex')}\n`);
// Never delete: the directory must be new (or empty) so a mistyped path cannot remove existing files.
if (fs.existsSync(P) && fs.readdirSync(P).length) throw Error('fixture directory must be new or empty');
fs.mkdirSync(outside, {recursive: true});
fs.mkdirSync(repo);
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, '.gitignore'), '.worktrees/\nuntracked.txt\nAGENTS.md\n');
marker(path.join(repo, 'tracked.txt'), 'ROOTTRACKED');
git('add', '.gitignore', 'tracked.txt');
git('commit', '-q', '-m', 'init');
git('worktree', 'add', '-q', '.worktrees/target', '-b', 'target');
git('worktree', 'add', '-q', '.worktrees/other', '-b', 'other');
git('worktree', 'add', '-q', path.join(P, 'external-target'), '-b', 'external');
marker(path.join(outside, 'marker.txt'), 'OUTSIDE');
marker(path.join(repo, 'untracked.txt'), 'ROOTUNTRACKED');
marker(path.join(target, 'inside.txt'), 'INSIDE');
marker(path.join(other, 'other.txt'), 'OTHERWT');
marker(path.join(P, 'external-target', 'inside.txt'), 'EXTERNAL');
// Project instructions in both checkouts: Codex loads them from its cwd (the primary checkout) at thread start.
fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# synthetic primary instructions\n');
fs.writeFileSync(path.join(target, 'AGENTS.md'), '# synthetic target instructions\n');
fs.symlinkSync(outside, path.join(target, 'link-dir'));
fs.symlinkSync(path.join(outside, 'marker.txt'), path.join(target, 'link-file.txt'));
fs.symlinkSync(path.join(repo, 'untracked.txt'), path.join(target, 'link-root.txt'));
console.log(P);
