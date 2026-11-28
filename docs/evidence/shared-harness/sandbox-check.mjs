// Shared harness (#1844): a model-free check of a confined tools level (conditions.json toolLevels.<id>.sandbox). Not a
// fixed module (like dry-run.mjs and calibrate.mjs, it is not in the fixation record). It lays out one probe trial as
// run-trial.mjs does (the fixture copied to <runs>/<cond>-probe-1/work, home/, config/, tmp/, bin/node, the record of
// another runs-root entry), writes the --settings file run-trial.mjs would write (isolationSettings), gives its
// filesystem rules to the open-source sandbox runtime srt (@anthropic-ai/sandbox-runtime) with the write allowances
// Claude Code adds (the working directory and its CLAUDE_CODE_TMPDIR), and runs every Bash step of the level-X probe
// (run-trial.mjs bashProbeSteps) and a few more (an existing file of the real HOME and of the repository, the user's tmp
// of Claude Code, the ASC CLI start in the main checkout and in a worktree, the rule file in the worktree, a commit in
// the worktree; #1844 review M2/L1: a symlink, a hard link, node -e, sh -c and a path put together from variables to a
// denied file, and an entry beside the runs root; second review M-a/M-c: writes outside the trial, the keychain, the
// clipboard and the process list, the last three also run without the sandbox as a baseline) as plain commands. No model call. No marker file is created: the marker paths are tried as they are.
// It shows what srt enforces for these rules; Claude Code embeds its own copy of the runtime, so the probe
// (run-trial.mjs probe, probe-check.mjs) stays the check of the measured environment.
// Usage: node sandbox-check.mjs <new-root> <condition> <fixture-dir> <srt-cli.js> <node-for-srt> <repo-root> [--out <json>] --config <dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {cellOf, probeContext, isolationSettings, trialEnv, bashProbeSteps, ASC_CLI, INSIDE_FILE} from './run-trial.mjs';
import {loadConditions} from './config.mjs';
import {markerPaths} from './markers.mjs';

const DENIED = /operation not permitted|permission denied|denied|response 403|^0{3}/i;

export function sandboxCheck({root, condition, fixture, srt, srtNode, repo}) {
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  const conds = loadConditions();
  const cell = cellOf(condition, conds), sb = cell.level.sandbox;
  if (!sb) throw new Error(`the tools level of ${condition} has no sandbox`);
  const runs = path.join(root, 'runs'), dir = path.join(runs, `${condition}-probe-1`), work = path.join(dir, 'work'), ledger = path.join(root, 'ledger', 'ledger.jsonl');
  fs.mkdirSync(path.dirname(ledger), {recursive: true}); fs.writeFileSync(ledger, '');
  fs.cpSync(fixture, work, {recursive: true});
  for (const d of ['home', 'config', 'tmp']) fs.mkdirSync(path.join(dir, d), {recursive: true});
  if (sb.copyNode) {
    fs.mkdirSync(path.join(dir, 'bin'), {recursive: true});
    fs.copyFileSync(process.execPath, path.join(dir, 'bin/node'), fs.constants.COPYFILE_FICLONE); fs.chmodSync(path.join(dir, 'bin/node'), 0o755);
    spawnSync(path.join(dir, 'bin/node'), ['--version']);
  }
  const mk = markerPaths(repo);
  const ctx = probeContext({dir, runsRoot: runs, fixture, ledger, homeMarker: mk.home, repoMarker: mk.repo, repo}, cell.level);
  fs.mkdirSync(path.dirname(ctx.siblingRecord), {recursive: true}); fs.writeFileSync(ctx.siblingRecord, 'a record of another runs-root entry\n');
  // #1844 review L1: an entry beside the runs root (as <root>/probe-R.json), made before the settings list them.
  const beside = path.join(root, 'probe-R.json');
  fs.writeFileSync(beside, '{}\n');
  const settings = isolationSettings({work, runsRoot: runs, fixture, ledger}, cell.level);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 1));
  const f = settings.sandbox.filesystem;
  const srtFile = path.join(root, 'srt-settings.json');
  fs.writeFileSync(srtFile, JSON.stringify({network: {allowedDomains: [], deniedDomains: []},
    filesystem: {denyRead: f.denyRead, allowWrite: [fs.realpathSync(work), fs.realpathSync(path.join(dir, 'tmp'))], denyWrite: f.denyWrite}}, null, 1));
  const env = {HOME: path.join(dir, 'home'), LANG: 'C.UTF-8', ...trialEnv(dir, sb)};
  env.CLAUDE_TMPDIR = env.CLAUDE_CODE_TMPDIR; // srt takes the sandboxed TMPDIR from CLAUDE_TMPDIR
  const run = (command) => { const r = spawnSync(srtNode, [srt, '-s', srtFile, '-c', command], {cwd: work, env, encoding: 'utf8'}); return {exit: r.status, firstLine: `${r.stdout}${r.stderr}`.split('\n').map((l) => l.trim()).find(Boolean) ?? ''}; };
  const wt = '"$(ls -d .worktrees/* | head -1)"';
  // #1844 review M2: a denied file that exists (the markers are not created here) for the indirect routes.
  const denied = path.join(path.dirname(ledger), 'denied-record.txt');
  fs.writeFileSync(denied, 'a denied record\n');
  const half = Math.ceil(denied.length / 2);
  const steps = [...bashProbeSteps(ctx).filter((st) => st.tool === 'Bash').map((st) => ({...st, probe: true})),
    {id: 'symlinkDeniedCat', command: `ln -s ${denied} link-denied.txt && cat link-denied.txt`, expect: 'refused'},
    {id: 'hardLinkDeniedCat', command: `ln ${denied} hard-denied.txt && cat hard-denied.txt`, expect: 'refused'},
    {id: 'nodeReadDenied', command: `node -e 'console.log(require("fs").readFileSync(process.argv[1], "utf8"))' ${denied}`, expect: 'refused'},
    {id: 'shArgDenied', command: `sh -c 'cat "$0"' ${denied}`, expect: 'refused'},
    {id: 'varPathDenied', command: `a='${denied.slice(0, half)}'; b='${denied.slice(half)}'; cat "$a$b"`, expect: 'refused'},
    {id: 'besideRunsRoot', command: `cat ${beside}`, expect: 'refused'},
    {id: 'existingRealHomeFile', command: `cat ${path.join(os.homedir(), '.zshrc')}`, expect: 'refused'},
    {id: 'existingRepoFile', command: `cat ${path.join(repo, 'AGENTS.md')}`, expect: 'refused'},
    {id: 'userTmpOfClaudeCode', command: `ls /tmp/claude-${process.getuid()}`, expect: 'refused'},
    {id: 'startInMainCheckout', command: `node ${ASC_CLI} start . --path src/billing/invoice.ts`, expect: 'refused'},
    {id: 'startInWorktreeSelectsRule', command: `node ${ASC_CLI} start ${wt} --path src/billing/invoice.ts | grep -c 'rules/money.md'`, expect: 'ok'},
    {id: 'startInWorktreeUsersNoRule', command: `node ${ASC_CLI} start ${wt} --path src/users/store.ts | grep -c 'rules/money.md'`, expect: 'refused'},
    {id: 'catRuleInWorktree', command: `head -1 ${wt}/.agent-skill-chain/project/rules/money.md`, expect: 'ok'},
    {id: 'commitInWorktree', command: `cd ${wt} && echo x > probe.txt && git add probe.txt && git -c user.name=x -c user.email=x@example.invalid commit -qm probe && git log --oneline -1`, expect: 'ok'}];
  // expect any: recorded only (the credential length; no credential is in this environment). #1844 review M-b/M-c: a step
  // marked sandbox needs the sandbox's own refusal, except the two whose target is a marker (not created here: "No such
  // file"); a step with outputPattern needs exit 0 and its first line to match. The M-c steps are also run once without the
  // sandbox in the same environment (baseline), so that a refusal is not just an empty keychain, clipboard or process list.
  const MARKER_TARGET = new Set(['catSymlinkHome', 'varPathHome']);
  const plain = (command) => { const r = spawnSync('/bin/bash', ['-c', command], {cwd: work, env, encoding: 'utf8'}); return `${r.stdout}${r.stderr}`.split('\n').map((l) => l.trim()).find(Boolean) ?? ''; };
  const rows = steps.map((st) => {
    const r = run(st.command), sandboxRefusal = /operation not permitted|response 403/i.test(r.firstLine);
    const pass = st.expect === 'any' ? true : st.expect === 'ok' ? r.exit === 0 && (!st.outputPattern || new RegExp(st.outputPattern).test(r.firstLine))
      : (r.exit !== 0 || DENIED.test(r.firstLine)) && (!st.sandbox || MARKER_TARGET.has(st.id) || sandboxRefusal);
    return {id: st.id, probeStep: st.probe === true, expect: st.expect, ...(st.outputPattern ? {outputPattern: st.outputPattern, baseline: plain(st.command)} : {}), ...(st.sandbox ? {sandboxRequired: !MARKER_TARGET.has(st.id)} : {}),
      exit: r.exit, firstLine: r.firstLine, sandboxRefusal, pass};
  });
  const left = {trialSentinel: fs.existsSync(ctx.sentinels.trial), repoSentinel: fs.existsSync(ctx.sentinels.repo), insideFile: fs.existsSync(path.join(work, INSIDE_FILE)),
    outside: Object.fromEntries(Object.entries(ctx.outsideWrites).map(([k, f]) => [k, fs.existsSync(f)]))};
  const version = (cmd, args) => spawnSync(cmd, args, {encoding: 'utf8'}).stdout?.trim() || null;
  const out = {schema: 'asc-sandbox-check/v1', condition, tools: cell.tools, srtVersion: version(srtNode, [srt, '--version']), claudeVersion: version('claude', ['--version']), nodeVersion: version(path.join(dir, sb.copyNode ? 'bin/node' : ''), ['--version']),
    pass: rows.every((r) => r.pass) && !left.trialSentinel && !left.repoSentinel && left.insideFile && Object.values(left.outside).every((x) => !x), left, settings, rows};
  fs.rmSync(path.join(dir, 'bin'), {recursive: true, force: true});
  return JSON.parse(JSON.stringify(out).split(fs.realpathSync(fixture)).join('<fixture>').split(fixture).join('<fixture>').split(fs.realpathSync(root)).join('<root>').split(root).join('<root>').split(path.resolve(repo)).join('<repo-root>').split(os.homedir()).join('<home>'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const [root, condition, fixture, srt, srtNode, repo] = args.filter((a, i) => a !== '--out' && args[i - 1] !== '--out');
  if (!repo) { console.error('usage: node sandbox-check.mjs <new-root> <condition> <fixture-dir> <srt-cli.js> <node-for-srt> <repo-root> [--out <json>] --config <dir>'); process.exit(2); }
  const out = sandboxCheck({root: path.resolve(root), condition, fixture: path.resolve(fixture), srt: path.resolve(srt), srtNode, repo: path.resolve(repo)});
  const text = JSON.stringify(out, null, 1) + '\n';
  if (oi >= 0) fs.writeFileSync(args[oi + 1], text);
  console.log(JSON.stringify({pass: out.pass, failed: out.rows.filter((r) => !r.pass).map((r) => r.id), left: out.left}));
  process.exit(out.pass ? 0 : 1);
}
