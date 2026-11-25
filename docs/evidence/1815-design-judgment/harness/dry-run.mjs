// End-to-end dry run of the #1815 harness without any model call and without starting the generator:
//  1. pairing: each tarball is accepted for its own condition; the other condition's tarball and an unpinned one are
//     refused (by run-trial.mjs itself, exit 3);
//  2. the two unpacked packages differ exactly in release.json S.differsOnly;
//  3. for every case, builds the B and S sample projects (make-sample.mjs, ASC from the tarball, read trigger adopted),
//     checks installedReferences, the CLAUDE.md block, placement, a clean tree, and that the two sample projects differ
//     only in the two references and the distribution record that lists their hashes;
//  4. docker: the images are present locally, and the docker CLI works with an empty HOME and the resolved DOCKER_HOST
//     (as the CLI's MCP child will run it) - `docker version` only;
//  5. prints the trial order, one trial's docker commands, MCP config and claude command, and the planning cost.
// Output has no absolute local paths (<scratch>, <repo>).
// Usage: node dry-run.mjs <tarball-B> <tarball-S> <new-scratch-root> [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {placementProblems} from '../../1814-skill-invocation/harness/guard.mjs';
import {ev, loadJson, fileSha256, tarballProblems, installedProblems, packageDiff, READ_TRIGGER_MARK} from './pairing.mjs';
import {makeSample} from './make-sample.mjs';
import {plan, IMAGE, PROXY_IMAGE, childEnv, resolveDockerHost} from './run-trial.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(ev, '../../..');
// Planning cost per generation trial: #1807 run2 A 0.15-0.20 USD, AP (2 designs + both widths) 0.28-0.50 USD; reading the
// ASC body and references adds input tokens (#1814 condition I 0.08-0.15 USD with read-only tools).
export const PLAN = {perTrialLowUsd: 0.25, perTrialHighUsd: 0.6, fableRoundUsd: 2.0};

export function trialOrder(cases, runs) {
  const order = [];
  for (let r = 1; r <= runs; r++) for (const c of cases) for (const cond of (r % 2 ? ['B', 'S'] : ['S', 'B'])) order.push(`${c}/${cond}-r${r}`);
  return order;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [tbB, tbS, rootArg] = args.map((a, i) => (i < 3 ? path.resolve(a) : a));
  const root = path.resolve(rootArg);
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  fs.mkdirSync(root, {recursive: true});
  const conds = loadJson('conditions.json'), release = loadJson('release.json'), cases = loadJson('cases.json').cases;
  const report = {label: 'dry run (no model call, generator not started)', checks: {}, samples: {}};
  const add = (k, pass, detail = null) => { report.checks[k] = {pass: Boolean(pass), detail}; };
  const tb = {B: tbB, S: tbS};
  const dg = {B: fileSha256(tbB), S: fileSha256(tbS)};
  report.tarballs = dg;
  add('pairingAccepted', tarballProblems(release, conds, 'B', dg.B).length === 0 && tarballProblems(release, conds, 'S', dg.S).length === 0);
  const fake = path.join(root, 'unpinned.tgz'); fs.writeFileSync(fake, 'not a release');
  const runTrial = (cond, tarball) => spawnSync(process.execPath, [path.join(here, 'run-trial.mjs'), path.join(root, 'runs'), 'ui03-dashboard', cond, '1', '--tarball', tarball], {encoding: 'utf8'});
  const refusals = [['B', tbS], ['S', tbB], ['B', fake], ['S', fake]].map(([c, t]) => { const r = runTrial(c, t); return {condition: c, tarball: t === fake ? 'unpinned' : t === tbB ? 'B' : 'S', exit: r.status, message: r.stderr.trim()}; });
  report.refusals = refusals;
  add('pairingRefused', refusals.every((r) => r.exit === 3 && r.message.startsWith('refused:')));
  // 2. package trees
  for (const c of ['B', 'S']) {
    fs.mkdirSync(path.join(root, 'unpack', c), {recursive: true});
    const x = spawnSync('tar', ['-xzf', tb[c], '-C', path.join(root, 'unpack', c)], {encoding: 'utf8'});
    if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  }
  const pkgDiff = packageDiff(path.join(root, 'unpack', 'B'), path.join(root, 'unpack', 'S'));
  report.packageDiff = pkgDiff;
  add('packageDiffersOnly', JSON.stringify(pkgDiff) === JSON.stringify([...release.S.differsOnly].sort()), pkgDiff);
  // 3. sample projects
  const expectSampleDiff = [...Object.keys(release.installedReferences.B), '.agent-skill-chain/distribution.json'].sort();
  for (const caseId of Object.keys(cases)) {
    const row = {};
    for (const c of ['B', 'S']) {
      const dir = path.join(root, 'samples', caseId, c, 'fixture');
      const tmp = path.join(root, 'samples', caseId, c, 'tmp'); fs.mkdirSync(tmp, {recursive: true});
      const s = makeSample(caseId, tb[c], dg[c], dir, tmp, {adopt: conds.adopt});
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      row[c] = {caseFiles: s.caseFiles, sampleHead: s.sampleHead, clean: s.status === '', runtimeVersion: s.install.runtimeVersion, adopted: s.install.adopted,
        installProblems: installedProblems(release, c, dir), claudeMdHasBlock: md.includes(READ_TRIGGER_MARK), claudeMdSha256: fileSha256(path.join(dir, 'CLAUDE.md')),
        projectSettings: fs.existsSync(path.join(dir, '.claude/settings.json')) ? JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) : null,
        entries: s.install.entries.length, outDir: fs.existsSync(path.join(dir, 'out')), placement: placementProblems(dir, {repoRoot})};
    }
    row.diffBS = packageDiff(path.join(root, 'samples', caseId, 'B', 'fixture'), path.join(root, 'samples', caseId, 'S', 'fixture'), {skip: ['.git']});
    row.sameClaudeMd = row.B.claudeMdSha256 === row.S.claudeMdSha256;
    row.ok = ['B', 'S'].every((c) => row[c].clean && row[c].installProblems.length === 0 && row[c].claudeMdHasBlock && row[c].placement.length === 0 && row[c].outDir)
      && JSON.stringify(row.diffBS) === JSON.stringify(expectSampleDiff) && row.sameClaudeMd;
    report.samples[caseId] = row;
  }
  add('samplesBuilt', Object.values(report.samples).every((r) => r.ok), expectSampleDiff);
  // 4. docker
  const img = (n) => spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', n], {encoding: 'utf8'});
  report.images = Object.fromEntries([IMAGE, PROXY_IMAGE].map((n) => { const r = img(n); return [n, r.status === 0 ? r.stdout.trim() : null]; }));
  const emptyHome = path.join(root, 'empty-home'); fs.mkdirSync(emptyHome);
  const dockerHost = resolveDockerHost();
  const env = childEnv({home: emptyHome, config: emptyHome, token: 'unused-in-dry-run', dockerHost});
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const dv = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {env, encoding: 'utf8'});
  report.dockerWithEmptyHome = {exit: dv.status, serverVersion: dv.stdout.trim() || null, dockerHostResolved: Boolean(dockerHost)};
  add('dockerCliWithEmptyHome', dv.status === 0);
  add('imagesPresent', Object.values(report.images).every(Boolean), report.images);
  // The two network commands of the plan, run and removed (no container is started).
  const np = plan(path.join(root, 'runs'), 'ui03-dashboard', 'S', 99).docker;
  const nets = np.setup.filter((a) => a[0] === 'network' && a[1] === 'create').map((a) => spawnSync('docker', a, {env, encoding: 'utf8'}).status);
  const removed = spawnSync('docker', np.cleanup.find((a) => a[0] === 'network'), {env, encoding: 'utf8'}).status;
  report.networks = {created: nets, removed};
  add('dockerNetworksCreateRemove', nets.every((s) => s === 0) && removed === 0, report.networks);
  // 5. plan
  const order = trialOrder(Object.keys(cases), conds.runs);
  const p = plan(path.join(root, 'runs'), 'ui03-dashboard', 'B', 1);
  report.plan = {order, trials: order.length, perTrialBudgetUsd: conds.budget.perTrialUsd,
    worstCaseUsd: Number((order.length * conds.budget.perTrialUsd + 2 * conds.budget.rankingReserveUsd).toFixed(2)),
    planningUsd: {low: Number((order.length * PLAN.perTrialLowUsd + 2 * PLAN.fableRoundUsd).toFixed(2)), high: Number((order.length * PLAN.perTrialHighUsd + 2 * PLAN.fableRoundUsd * 1.5).toFixed(2))},
    capUsd: conds.budget.capUsd, stopAboveUsd: conds.budget.capUsd - conds.budget.safetyMarginUsd, codexCost: 'not Host-computed (missing, as #1807)'};
  report.example = {trial: 'ui03-dashboard/B-r1', docker: p.docker.setup.map((a) => ['docker', ...a].join(' ')), mcpConfig: p.docker.mcpConfig,
    claude: ['claude', ...p.claude].join(' '), cleanup: p.docker.cleanup.map((a) => ['docker', ...a].join(' ')), cwd: 'fixture/', env: Object.keys(childEnv({home: 'h', config: 'c', token: 't', dockerHost: 'd'}))};
  report.pass = Object.entries(report.checks).filter(([k]) => k !== 'imagesPresent').every(([, c]) => c.pass);
  let text = JSON.stringify(report, null, 1).split(root).join('<scratch>').split(fs.realpathSync(root)).join('<scratch>').split(repoRoot).join('<repo>');
  for (const [c, t] of Object.entries(tb)) text = text.split(path.dirname(t)).join(`<tarball-${c}-dir>`);
  text = text.replace(/\/(Users|home)\/[^/"\s\\]+/g, '/<local>');
  if (opt('--out')) fs.writeFileSync(opt('--out'), text + '\n');
  console.log(JSON.stringify({pass: report.pass, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])), trials: report.plan.trials, worstCaseUsd: report.plan.worstCaseUsd, planningUsd: report.plan.planningUsd}));
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
