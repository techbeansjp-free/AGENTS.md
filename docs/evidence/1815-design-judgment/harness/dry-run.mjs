// End-to-end dry run of the #1815 harness without any model call and without starting the generator:
//  1. pairing: each tarball is accepted for its own condition; the other condition's tarball and an unpinned one are
//     refused (by run-trial.mjs itself, exit 3);
//  2. the two unpacked packages differ exactly in release.json S.differsOnly;
//  3. for every case, builds the B and S sample projects (make-sample.mjs, ASC from the tarball, read trigger adopted),
//     checks installedReferences, the CLAUDE.md block, placement, a clean tree, and that the two sample projects differ
//     only in the two references and the distribution record that lists their hashes;
//  4. docker: the local images have the pinned ids, the docker CLI works with an empty HOME and the resolved DOCKER_HOST
//     (as the CLI's MCP child will run it), and the plan's two networks can be created and removed;
//  5. image-dependent checks (skipped with --skip-image): rendering, the #1807 gold check and first-view.mjs in the
//     pinned image on synthetic pages with known answers;
//  6. the fixed order (run-order.json) and run-all's dry run, one trial's and one probe's commands, the planning cost.
// Output has no absolute local paths (<scratch>, <repo>).
// Usage: node dry-run.mjs <tarball-B> <tarball-S> <new-scratch-root> [--out <json>] [--skip-image]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {placementProblems} from '../../1814-skill-invocation/harness/guard.mjs';
import {ev, loadJson, fileSha256, tarballProblems, installedProblems, packageDiff, READ_TRIGGER_MARK} from './pairing.mjs';
import {makeSample} from './make-sample.mjs';
import {plan, childEnv, resolveDockerHost, imageProblems} from './run-trial.mjs';
import {plannedTrials, orderProblems, loadOrder} from './order.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(ev, '../../..');
// Planning cost per generation trial: #1807 run2 A 0.15-0.20 USD, AP (2 designs + both widths) 0.28-0.50 USD; reading the
// ASC body and references adds input tokens (#1814 condition I 0.08-0.15 USD with read-only tools).
export const PLAN = {perTrialLowUsd: 0.25, perTrialHighUsd: 0.6, fableRoundUsd: 2.0};

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [tbB, tbS, rootArg] = args.slice(0, 3).map((a) => path.resolve(a));
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
  report.images = Object.fromEntries(Object.values(loadJson('conditions.json').images).map((im) => { const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', im.name], {encoding: 'utf8'}); return [im.name, {local: r.status === 0 ? r.stdout.trim() : null, pinned: im.id}]; }));
  add('imagesPinned', imageProblems().length === 0, imageProblems());
  const emptyHome = path.join(root, 'empty-home'); fs.mkdirSync(emptyHome);
  const dockerHost = resolveDockerHost();
  const env = childEnv({home: emptyHome, config: emptyHome, token: 'unused-in-dry-run', dockerHost});
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const dv = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {env, encoding: 'utf8'});
  report.dockerWithEmptyHome = {exit: dv.status, serverVersion: dv.stdout.trim() || null, dockerHostResolved: Boolean(dockerHost)};
  add('dockerCliWithEmptyHome', dv.status === 0);
  // The two network commands of the plan, run and removed (no container is started).
  const np = plan(path.join(root, 'runs'), 'ui03-dashboard', 'S', 99).docker;
  const nets = np.setup.filter((a) => a[0] === 'network' && a[1] === 'create').map((a) => spawnSync('docker', a, {env, encoding: 'utf8'}).status);
  const removed = spawnSync('docker', np.cleanup.find((a) => a[0] === 'network'), {env, encoding: 'utf8'}).status;
  report.networks = {created: nets, removed};
  add('dockerNetworksCreateRemove', nets.every((s) => s === 0) && removed === 0, report.networks);
  // 5. image-dependent checks on synthetic pages (#1807 harness/dryrun good/bad, #1815 harness/dryrun/ui07-hidden):
  // run-indicators.mjs = #1807 run-render.mjs (render.mjs + gold-check.mjs) and first-view.mjs in the pinned image,
  // --network none. The synthetic pages are placed in the runs layout as <case>/<B|S>-r<n>/fixture/out/index.html.
  if (!opt('--skip-image')) {
    const synth = {'ui07-bus-mobile': {'B-r1': 'ui07-good', 'S-r1': 'ui07-bad', 'S-r2': 'ui07-hidden'}, 'ui04-parts-search': {'B-r1': 'ui04-good', 'S-r1': 'ui04-bad'}};
    const sr = path.join(root, 'synthetic-runs'), rr = path.join(root, 'synthetic-render');
    const src = (n) => (n === 'ui07-hidden' ? path.join(here, 'dryrun', `${n}.html`) : path.join(ev, '..', '1807-design-eval-browser', 'harness', 'dryrun', `${n}.html`));
    report.imageChecks = {};
    for (const [caseId, trials] of Object.entries(synth)) {
      for (const [t, n] of Object.entries(trials)) { const d = path.join(sr, caseId, t, 'fixture', 'out'); fs.mkdirSync(d, {recursive: true}); fs.copyFileSync(src(n), path.join(d, 'index.html')); }
      const r = spawnSync(process.execPath, [path.join(here, 'run-indicators.mjs'), sr, caseId, rr], {encoding: 'utf8'});
      const rj = JSON.parse(fs.existsSync(path.join(rr, caseId, 'render.json')) ? fs.readFileSync(path.join(rr, caseId, 'render.json'), 'utf8') : '[]');
      report.imageChecks[caseId] = {exit: r.status, pages: Object.fromEntries(Object.entries(trials).map(([t, n]) => {
        const j = (f) => { try { return JSON.parse(fs.readFileSync(path.join(rr, caseId, t, f), 'utf8')); } catch { return null; } };
        const g = j('gold.json'), fv = j('first-view.json'), re = rj.find((x) => x.id === t);
        return [n, {gold: g && {coverage: g.coverage, missing: g.missing, narrowOverflow: g.narrowOverflow, firstViewportMissing: g.firstViewportMissing, interactions: g.interactions?.map((x) => x.ok), error: g.error ?? null},
          firstView: fv && {error: fv.error ?? null, narrow: {answerAll: fv.widths?.narrow?.answerAll, missing: fv.widths?.narrow?.answerMissing, hiddenRequired: fv.widths?.narrow?.hiddenRequired},
            wide: {answerAll: fv.widths?.wide?.answerAll, missing: fv.widths?.wide?.answerMissing, hiddenRequired: fv.widths?.wide?.hiddenRequired}},
          render: re && {viewports: Object.keys(re.viewports ?? {}), renderErrors: Object.values(re.viewports ?? {}).filter((v) => v.renderError).length, axeSeriousCritical: Object.values(re.viewports ?? {}).map((v) => v.axeSeriousCritical)}}];
      }))};
    }
    const pg = (c, n) => report.imageChecks[c]?.pages?.[n];
    const exp = [
      pg('ui07-bus-mobile', 'ui07-good')?.firstView?.narrow.answerAll === true && pg('ui07-bus-mobile', 'ui07-good')?.firstView?.wide.answerAll === true,
      pg('ui07-bus-mobile', 'ui07-bad')?.firstView?.narrow.answerAll === false,
      pg('ui07-bus-mobile', 'ui07-hidden')?.firstView?.narrow.missing?.includes('中央通り') && pg('ui07-bus-mobile', 'ui07-hidden')?.firstView?.narrow.hiddenRequired?.includes('200円'),
      pg('ui04-parts-search', 'ui04-good')?.firstView?.wide.answerAll === true && pg('ui04-parts-search', 'ui04-bad')?.firstView?.wide.answerAll === false,
      ['ui07-good', 'ui04-good'].every((n) => (pg(n.startsWith('ui07') ? 'ui07-bus-mobile' : 'ui04-parts-search', n)?.gold?.coverage ?? 0) > 0.9),
      Object.values(report.imageChecks).every((c) => c.exit === 0 && Object.values(c.pages).every((x) => x.render && x.render.renderErrors === 0 && x.gold && !x.gold.error && x.firstView && !x.firstView.error)),
    ];
    report.imageChecks.expectations = exp;
    add('imageChecks', exp.every(Boolean), exp);
  }
  // 6. plan: the fixed order, the runner's dry run, one trial's and one probe's commands
  const order = plannedTrials().map((t) => t.name);
  const ra = spawnSync(process.execPath, [path.join(here, 'run-all.mjs'), 'planned', path.join(root, 'runs'), '--tarball-B', tbB, '--tarball-S', tbS, '--ledger', path.join(root, 'no-ledger.jsonl')], {encoding: 'utf8'});
  report.runAll = {exit: ra.status, trials: ra.status === 0 ? JSON.parse(ra.stdout).trials : ra.stderr.trim()};
  add('runAllFollowsOrder', ra.status === 0 && JSON.stringify(report.runAll.trials) === JSON.stringify(order));
  add('orderValid', orderProblems(loadOrder(), cases, conds).length === 0, orderProblems(loadOrder(), cases, conds));
  const p = plan(path.join(root, 'runs'), 'ui03-dashboard', 'B', 1);
  const pr = plan(path.join(root, 'runs'), 'probe', 'B', 1);
  const worst = order.length * conds.budget.perTrialUsd + 2 * conds.budget.probeUsd + 2 * conds.budget.rankingReserveUsd;
  report.plan = {order, trials: order.length, probes: loadOrder().probeConditions.length, perTrialBudgetUsd: conds.budget.perTrialUsd,
    worstCaseWithoutReplacementsUsd: Number(worst.toFixed(2)),
    planningUsd: {low: Number((order.length * PLAN.perTrialLowUsd + 2 * 0.15 + 2 * PLAN.fableRoundUsd).toFixed(2)), high: Number((order.length * PLAN.perTrialHighUsd + 2 * 0.3 + 2 * PLAN.fableRoundUsd * 1.5).toFixed(2))},
    capUsd: conds.budget.capUsd, stopAboveUsd: conds.budget.capUsd - conds.budget.safetyMarginUsd, codexCost: 'not Host-computed (missing, as #1807)'};
  report.example = {trial: 'ui03-dashboard/B-r1', docker: p.docker.setup.map((a) => ['docker', ...a].join(' ')), mcpConfig: p.docker.mcpConfig,
    claude: ['claude', ...p.claude].join(' '), cleanup: p.docker.cleanup.map((a) => ['docker', ...a].join(' ')), cwd: 'fixture/', env: Object.keys(childEnv({home: 'h', config: 'c', token: 't', dockerHost: 'd'})),
    probe: {trial: pr.name, sampleCase: pr.sampleCase, claude: ['claude', ...pr.claude].join(' '), budgetUsd: pr.budget}};
  report.pass = Object.values(report.checks).every((c) => c.pass);
  let text = JSON.stringify(report, null, 1).split(root).join('<scratch>').split(fs.realpathSync(root)).join('<scratch>').split(repoRoot).join('<repo>');
  for (const [c, t] of Object.entries(tb)) text = text.split(path.dirname(t)).join(`<tarball-${c}-dir>`);
  text = text.replace(/\/(Users|home)\/[^/"\s\\]+/g, '/<local>');
  if (opt('--out')) fs.writeFileSync(opt('--out'), text + '\n');
  console.log(JSON.stringify({pass: report.pass, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])), trials: report.plan.trials, worstCaseWithoutReplacementsUsd: report.plan.worstCaseWithoutReplacementsUsd, planningUsd: report.plan.planningUsd}));
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
