// Issue #215: Dependabot PR で追跡系CI検査を skip_checks ガードにより回避する構造を固定化する。
// Issue #219: 許可判定の基準を push 実行者（github.actor）から PR/ブランチの起源（実PR作成者）へ
// 是正した構造を固定化する。本テストは、①ガードが必要な追跡系ステップに存在すること、
// ②存在してはならないステップ（verify-template-sync）には skip_checks が存在しないこと、
// ③ci の判定が PR 作成者（pull_request.user.login）由来であること、④本体ファイルと
// テンプレート正本ファイルが完全一致することを、ワークフローYAMLの実体を直接パースして検証する。
// Issue #536: npm ci / npm run build は consumerの技術構成（package.json・lockfile・build
// scriptの有無）に応じた個別の if 条件（Detect npm build prerequisitesステップの出力）を持つ。
// npm run build の直後には、CLI解決3経路（bin/agents-md.js・node_modules/.bin/agent-skill-chain・
// PATH）のいずれでも見つからない場合にのみ npm install -g で導入する「Ensure agent-skill-chain
// CLI」ステップを置く。verify-template-sync はDependabot skip_checks時も実行されるため、この
// ステップはskip_checksでガードしない（無条件に実行する）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const CI_BODY = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-ci.yml');
const TEMPLATE_DIR = path.join(REPO_ROOT, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows');
const CI_TEMPLATE = path.join(TEMPLATE_DIR, 'agent-skill-chain-ci.yml');

const SKIP_GUARD = "steps.ctx.outputs.skip_checks != 'true'";

// コメント行（YAML/bash とも '#' 始まり）を除いた本文。説明コメント中の語ではなく、
// env 式・if 式など実際の参照としての github.actor 残存を検査するために用いる。
function nonCommentContent(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

interface CiWorkflow {
  jobs: { verify: { steps: Step[] } };
}

function ciSteps(): Step[] {
  const wf = readYamlFile<CiWorkflow>(CI_BODY);
  assert.ok(Array.isArray(wf.jobs?.verify?.steps), 'jobs.verify.steps が配列であること');
  return wf.jobs.verify.steps;
}

function findByName(steps: Step[], nameSubstr: string): Step {
  const found = steps.find((s) => typeof s.name === 'string' && s.name.includes(nameSubstr));
  assert.ok(found, `name に '${nameSubstr}' を含むステップが存在すること`);
  return found as Step;
}

// --- ① ガードが必要な追跡系ステップに skip_checks ガードが存在すること ---

const GUARDED_STEP_NAMES = [
  'verify-branch-name',
  'verify-worktree-path',
  'verify-artifacts',
  'verify-ac-coverage',
  'verify-adr',
  'lint-vocab',
  'lint-references',
  'adr-lint',
];

for (const stepName of GUARDED_STEP_NAMES) {
  test(`ci: '${stepName}' ステップは skip_checks ガードを if 条件に含む`, () => {
    const step = findByName(ciSteps(), stepName);
    assert.equal(typeof step.if, 'string', `'${stepName}' に if 条件が存在すること`);
    assert.ok(
      (step.if as string).includes(SKIP_GUARD),
      `'${stepName}' の if 条件に "${SKIP_GUARD}" が含まれること（実際: ${step.if}）`,
    );
  });
}

test('ci: lint-secrets ステップは base_ref 条件に加えて skip_checks ガードを含む', () => {
  const step = findByName(ciSteps(), 'lint-secrets');
  assert.equal(typeof step.if, 'string');
  assert.ok((step.if as string).includes(SKIP_GUARD), 'lint-secrets が skip_checks ガードを含むこと');
  assert.ok((step.if as string).includes('github.base_ref'), 'lint-secrets が base_ref 条件を維持すること');
});

// --- ② ガードが存在してはならないステップ ---

test("ci: verify-template-sync ステップは skip_checks を参照しない（Dependabot時も挙動不変）", () => {
  const step = findByName(ciSteps(), 'verify-template-sync');
  const guard = step.if ?? '';
  assert.ok(
    !guard.includes('skip_checks'),
    `verify-template-sync は skip_checks を参照しないこと（実際の if: ${JSON.stringify(step.if)}）`,
  );
});

test('ci: Detect npm build prerequisites ステップが npm ci/build 双方の判定を出力する', () => {
  const step = findByName(ciSteps(), 'Detect npm build prerequisites');
  const run = step.run ?? '';
  assert.ok(run.includes('ci=true') && run.includes('ci=false'), 'ci 判定の出力分岐を持つこと');
  assert.ok(run.includes('build=true') && run.includes('build=false'), 'build 判定の出力分岐を持つこと');
  assert.ok(run.includes('package.json'), 'package.json の存在を検査すること');
  assert.ok(
    run.includes('package-lock.json') && run.includes('npm-shrinkwrap.json'),
    'lockfile（package-lock.json または npm-shrinkwrap.json）の存在を検査すること',
  );
});

test('ci: npm ci ステップは Detect npm build prerequisites の ci 出力を if 条件に持つ', () => {
  const step = findByName(ciSteps(), 'npm ci');
  assert.equal(step.run?.trim(), 'npm ci');
  assert.equal(step.if, "steps.npm-prereq.outputs.ci == 'true'");
});

test('ci: npm run build ステップは Detect npm build prerequisites の build 出力を if 条件に持つ', () => {
  const step = findByName(ciSteps(), 'npm run build');
  assert.equal(step.run?.trim(), 'npm run build');
  assert.equal(step.if, "steps.npm-prereq.outputs.build == 'true'");
});

test('ci: Ensure agent-skill-chain CLI ステップが npm run build の直後、Fetch base branch for diff-based checks の直前に存在する', () => {
  const steps = ciSteps();
  const buildIdx = steps.findIndex((s) => s.name === 'npm run build');
  const ensureIdx = steps.findIndex((s) => s.name === 'Ensure agent-skill-chain CLI');
  const fetchIdx = steps.findIndex((s) => s.name === 'Fetch base branch for diff-based checks');
  assert.ok(buildIdx >= 0 && ensureIdx >= 0 && fetchIdx >= 0, '3ステップとも存在すること');
  assert.equal(ensureIdx, buildIdx + 1, "'Ensure agent-skill-chain CLI' は 'npm run build' の直後に配置されること");
  assert.equal(fetchIdx, ensureIdx + 1, "'Ensure agent-skill-chain CLI' の直後が 'Fetch base branch for diff-based checks' であること");
});

test('ci: Ensure agent-skill-chain CLI ステップは skip_checks でガードしない（verify-template-syncもCLIを要するため無条件実行）', () => {
  const step = findByName(ciSteps(), 'Ensure agent-skill-chain CLI');
  assert.equal(step.if, undefined, "'Ensure agent-skill-chain CLI' に if 条件が存在しないこと（常に実行）");
});

test('ci: Ensure agent-skill-chain CLI ステップは3経路の検出後、いずれも無い場合のみ npm install -g でフォールバック導入する', () => {
  const step = findByName(ciSteps(), 'Ensure agent-skill-chain CLI');
  const run = step.run ?? '';
  assert.ok(run.includes('bin/agents-md.js'), 'bin/agents-md.js の存在を検出すること');
  assert.ok(run.includes('node_modules/.bin/agent-skill-chain'), 'node_modules/.bin/agent-skill-chain の存在を検出すること');
  assert.ok(run.includes('command -v agent-skill-chain'), 'PATH上のagent-skill-chainの存在を検出すること');
  assert.ok(run.includes('npm install -g agent-skill-chain@latest'), '未検出時のフォールバックにnpm install -g agent-skill-chain@latestを持つこと');
});

// --- ③ ctx（Derive issue_id）に Dependabot 許可リスト分岐が存在すること ---

test('ci: Derive issue_id ステップは Dependabot 許可リストで skip_checks=true を出力する', () => {
  const steps = ciSteps();
  const ctx = steps.find((s) => s.id === 'ctx');
  assert.ok(ctx, "id 'ctx' のステップ（Derive issue_id）が存在すること");
  const run = (ctx as Step).run ?? '';
  assert.ok(run.includes('dependabot[bot]'), 'ctx が dependabot[bot] アクターを判定すること');
  assert.ok(run.includes('dependabot/*') || run.includes('dependabot/'), 'ctx が dependabot/ ブランチを判定すること');
  assert.ok(run.includes('skip_checks=true'), 'ctx が skip_checks=true を出力する分岐を持つこと');
  assert.ok(run.includes('skip_checks=false'), 'ctx が通常Issueブランチで skip_checks=false を出力すること');
});

test('ci: Derive issue_id ステップは厳密なroot-cleanupブランチとadminのPR作成者だけを許可する', () => {
  const steps = ciSteps();
  const ctx = steps.find((s) => s.id === 'ctx');
  assert.ok(ctx, "id 'ctx' のステップ（Derive issue_id）が存在すること");
  const run = (ctx as Step).run ?? '';
  assert.ok(run.includes('^chore/root-cleanup-[0-9]{8}T[0-9]{6}Z$'), 'root-cleanup生成ブランチの厳密な形式を判定すること');
  assert.ok(run.includes('collaborators/$ACTOR/permission'), 'PR作成者のリポジトリ権限をGitHub APIで確認すること');
  assert.ok(run.includes('"$ACTOR_PERMISSION" != "admin"'), 'admin以外のPR作成者をfail-closedで拒否すること');
  assert.equal((ctx as Step).env?.GH_TOKEN, '${{ github.token }}');
  assert.equal((ctx as Step).env?.REPOSITORY, '${{ github.repository }}');
});

test('ci: Derive issue_id の env.ACTOR は PR 作成者（pull_request.user.login）由来であり github.actor を参照しない', () => {
  const steps = ciSteps();
  const ctx = steps.find((s) => s.id === 'ctx');
  assert.ok(ctx, "id 'ctx' のステップ（Derive issue_id）が存在すること");
  assert.equal(
    (ctx as Step).env?.ACTOR,
    '${{ github.event.pull_request.user.login }}',
    'env.ACTOR が追加pushで変化しない PR 作成者コンテキストを参照すること',
  );
  assert.ok(!nonCommentContent(CI_BODY).includes('github.actor'), 'ci.yml が github.actor を一切参照しないこと');
});

// --- ④ 本体ファイルとテンプレート正本ファイルの完全一致（verify-template-sync とは独立に固定化）---

test('本体 agent-skill-chain-ci.yml とテンプレート正本が完全一致する', () => {
  assert.equal(fs.readFileSync(CI_BODY, 'utf8'), fs.readFileSync(CI_TEMPLATE, 'utf8'));
});
