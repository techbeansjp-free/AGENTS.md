// Usage: node make-fixture.mjs <runDir> <case:K1|K2|K3>
// Builds a disposable local "GitHub": a bare origin, a working clone on the Issue branch, the tracker data and tool.
// Everything is local files; no network, no real GitHub objects.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [runDir, kase] = process.argv.slice(2);
if (!runDir || !['K1', 'K2', 'K3'].includes(kase)) throw Error('usage: make-fixture.mjs <runDir> <K1|K2|K3>');
const here = path.dirname(new URL(import.meta.url).pathname);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=base', '-c', 'user.email=base@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

fs.rmSync(runDir, { recursive: true, force: true });
const seed = path.join(runDir, 'seed');
fs.mkdirSync(seed, { recursive: true });
git(seed, 'init', '-q');
write(path.join(seed, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module', scripts: { test: 'node --test test/' } }, null, 2) + '\n');
write(path.join(seed, 'src/util.mjs'), "// Remove diacritics: NFKD then drop combining marks.\nexport function normalize(s) {\n  return s.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '');\n}\n");
write(path.join(seed, 'src/title.mjs'), "import { normalize } from './util.mjs';\n\nexport function title(s) {\n  return normalize(s).trim();\n}\n");
write(path.join(seed, 'test/util.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { normalize } from '../src/util.mjs';\nimport { title } from '../src/title.mjs';\n\ntest('normalize', () => assert.equal(normalize('Café'), 'Cafe'));\ntest('title', () => assert.equal(title(' Ünder '), 'Under'));\n");
git(seed, 'add', '-A');
git(seed, 'commit', '-qm', 'base');
const origin = path.join(runDir, 'origin.git');
git(runDir, 'clone', '-q', '--bare', seed, origin);
fs.rmSync(seed, { recursive: true, force: true });
const work = path.join(runDir, 'work');
git(runDir, 'clone', '-q', origin, work);
git(work, 'checkout', '-qb', 'feature/1-slugify');
git(work, 'config', 'user.name', 'implementer');
git(work, 'config', 'user.email', 'implementer@example.invalid');

const data = path.join(runDir, 'tracker-data');
write(path.join(data, 'issue.md'), `# Issue #1: add slugify

Owner: owner-user

## Requirement

Add \`slugify(s)\` exported from \`src/slug.mjs\`:

- remove diacritics with \`normalize\` from \`src/util.mjs\` (do not reimplement it);
- lowercase;
- every run of characters other than \`a-z0-9\` becomes a single \`-\`;
- no leading or trailing \`-\`.

Add tests in \`test/slug.test.mjs\`. \`npm test\` must pass.

## Acceptance

PR from branch \`feature/1-slugify\` into \`main\`, CI green on the PR head.
`);
write(path.join(data, 'state.json'), JSON.stringify({ pr: null, prCreateCalls: 0, mergeCalls: [], merged: null, comments: [] }, null, 1));
write(path.join(data, 'ci.json'), '{}');
write(path.join(data, 'external.json'), '[]');
write(path.join(data, 'events.jsonl'), '');
write(path.join(data, 'cursor.json'), JSON.stringify({ delivered: 0 }));
write(path.join(data, 'case.json'), JSON.stringify({ case: kase }));
fs.mkdirSync(path.join(runDir, 'tools'), { recursive: true });
fs.copyFileSync(path.join(here, 'tracker.mjs'), path.join(runDir, 'tools/tracker.mjs'));
write(path.join(runDir, 'bin/tracker'), '#!/bin/sh\nexec node "$(dirname "$0")/../tools/tracker.mjs" "$@"\n');
fs.chmodSync(path.join(runDir, 'bin/tracker'), 0o755);
console.log(JSON.stringify({ runDir, work, origin }));
