// Create the synthetic fixture used by probe-run.mjs next to this file: probe/{repo,outside,external-target}.
// Copy this directory to a disposable location first; markers are random harmless values.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const P = path.join(path.dirname(new URL(import.meta.url).pathname), 'probe');
const repo = path.join(P, 'repo'), target = path.join(repo, '.worktrees/target'), outside = path.join(P, 'outside');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], {stdio: 'ignore'});
const marker = (file, prefix) => fs.writeFileSync(file, `${prefix}-${randomBytes(8).toString('hex')}\n`);
fs.rmSync(P, {recursive: true, force: true});
fs.mkdirSync(outside, {recursive: true});
fs.mkdirSync(repo);
git('init', '-q', '-b', 'main');
git('-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', 'commit', '-q', '--allow-empty', '-m', 'init');
git('worktree', 'add', '-q', '.worktrees/target', '-b', 'target');
// A worktree outside the primary checkout: reachable only through --add-dir.
git('worktree', 'add', '-q', path.join(P, 'external-target'), '-b', 'external');
marker(path.join(outside, 'marker.txt'), 'OUTSIDE');
marker(path.join(target, 'inside.txt'), 'INSIDE');
marker(path.join(repo, 'root-only.txt'), 'ROOT');
marker(path.join(P, 'external-target', 'inside.txt'), 'EXTERNAL');
fs.symlinkSync(outside, path.join(target, 'link-dir'));
fs.symlinkSync(path.join(outside, 'marker.txt'), path.join(target, 'link-file.txt'));
