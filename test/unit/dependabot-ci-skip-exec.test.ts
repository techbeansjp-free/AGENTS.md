// Issue #219: Derive issue_id ステップの bash 実体を実行して判定挙動を実測検証する。
// 静的パーステスト（dependabot-ci-skip.test.ts）が YAML 構造を固定するのに対し、本テストは
// run スクリプト本文を抽出し GitHub Actions 相当（bash -e -o pipefail、GITHUB_OUTPUT）で実行し、
// 終了コードと出力を確認する。ci の ACTOR は YAML の env 式を解決して注入するため、
// env 由来を github.actor へ戻す退行はシナリオ(c)の失敗として検出される。
// ci workflowのgh apiはPATH上のモックgh（GH_MOCK_AUTHORを返す）で置換する。
// GH_MOCK_EXIT を非0に設定するとモック gh はレート制限等の API 障害を模擬して非0終了する。
// (reconcile workflow は削除されたため、reconcile向けの実行検証は本ファイルから除去済み)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CI_BODY = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-ci.yml');

interface Step {
  id?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  jobs: Record<string, { steps: Step[] }>;
}

function ctxStep(file: string, job: string): Step {
  const wf = readYamlFile<Workflow>(file);
  const step = wf.jobs[job].steps.find((s) => s.id === 'ctx');
  assert.ok(step?.run, `${job} に id 'ctx' の run ステップが存在すること`);
  return step as Step;
}

const DEPENDABOT = 'dependabot[bot]';
const HUMAN = 'adachi-tatsuru';

// YAML の env.ACTOR 式を解決する。push実行者とPR作成者のどちらを参照しているかで注入値が変わる。
function resolveActor(expr: string | undefined, pusher: string, prAuthor: string): string {
  if (expr === '${{ github.actor }}') return pusher;
  if (expr === '${{ github.event.pull_request.user.login }}') return prAuthor;
  assert.fail(`env.ACTOR の式が未知の形式です: ${expr}`);
}

interface RunResult {
  status: number;
  outputs: Record<string, string>;
  stderr: string;
}

function runStep(run: string, env: Record<string, string>, mockGhAuthor?: string): RunResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue219-exec-'));
  try {
    const script = path.join(dir, 'step.sh');
    const outFile = path.join(dir, 'github_output');
    fs.writeFileSync(script, run);
    fs.writeFileSync(outFile, '');
    let pathEnv = process.env.PATH ?? '';
    if (mockGhAuthor !== undefined) {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, 'gh'),
        `#!/usr/bin/env bash\nif [[ -n "$GH_MOCK_EXIT" && "$GH_MOCK_EXIT" != "0" ]]; then\n  echo "gh: HTTP 403: API rate limit exceeded" >&2\n  exit "$GH_MOCK_EXIT"\nfi\nif [[ -n "$GH_MOCK_AUTHOR" ]]; then echo "$GH_MOCK_AUTHOR"; fi\n`,
        { mode: 0o755 },
      );
      pathEnv = `${bin}:${pathEnv}`;
    }
    const res = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      env: {
        PATH: pathEnv,
        GITHUB_OUTPUT: outFile,
        GH_MOCK_AUTHOR: mockGhAuthor ?? '',
        ...env,
      },
      encoding: 'utf8',
    });
    const outputs: Record<string, string> = {};
    for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { status: res.status ?? -1, outputs, stderr: res.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- ci.yml: Derive issue_id ---

function runCi(branch: string, pusher: string, prAuthor: string, actorPermission?: string): RunResult {
  const step = ctxStep(CI_BODY, 'verify');
  const actor = resolveActor(step.env?.ACTOR, pusher, prAuthor);
  return runStep(
    step.run as string,
    { BRANCH: branch, ACTOR: actor, REPOSITORY: 'test/repo', GH_TOKEN: 'test-token' },
    actorPermission,
  );
}

test('ci実行(a): 通常Issueブランチは issue_id 抽出・skip_checks=false', () => {
  const r = runCi('feature/123-user-authentication', HUMAN, HUMAN);
  assert.equal(r.status, 0);
  assert.equal(r.outputs.issue_id, 'ISSUE-123');
  assert.equal(r.outputs.skip_checks, 'false');
});

test('ci実行(b): Dependabot が開いた直後の PR は skip_checks=true', () => {
  const r = runCi('dependabot/npm_and_yarn/typescript-5.5.4', DEPENDABOT, DEPENDABOT);
  assert.equal(r.status, 0);
  assert.equal(r.outputs.skip_checks, 'true');
});

test('ci実行(c): Dependabot PR へ人間が追加 push しても skip_checks=true（push実行者に非依存）', () => {
  const r = runCi('dependabot/npm_and_yarn/typescript-5.5.4', HUMAN, DEPENDABOT);
  assert.equal(r.status, 0, `exit=0 であること（stderr: ${r.stderr}）`);
  assert.equal(r.outputs.skip_checks, 'true');
});

test('ci実行(d): 人間が dependabot/ ブランチ名を偽装した PR は exit 1 で拒否される', () => {
  const r = runCi('dependabot/npm_and_yarn/fake', 'impostor-human', 'impostor-human');
  assert.equal(r.status, 1);
});

test('ci実行(e): branch.pattern と衝突する dependabot/223-fake は第1分岐で通常検査される', () => {
  // 偽装者が人間の場合も、仮に PR 作成者が dependabot[bot] の場合も、第1分岐が先に一致し
  // issue_id 抽出＋skip_checks=false（検査回避不可）となることを確認する。
  for (const prAuthor of [HUMAN, DEPENDABOT]) {
    const r = runCi('dependabot/223-fake', HUMAN, prAuthor);
    assert.equal(r.status, 0, `PR作成者=${prAuthor} で exit=0 であること（stderr: ${r.stderr}）`);
    assert.equal(r.outputs.issue_id, 'ISSUE-223');
    assert.equal(r.outputs.skip_checks, 'false');
  }
});

test('ci実行(f): adminが作成した機械生成root-cleanup PRは skip_checks=true', () => {
  const r = runCi('chore/root-cleanup-20260811T121848Z', HUMAN, HUMAN, 'admin');
  assert.equal(r.status, 0, `exit=0 であること（stderr: ${r.stderr}）`);
  assert.equal(r.outputs.issue_id, '');
  assert.equal(r.outputs.skip_checks, 'true');
});

test('ci実行(g): adminでない人間がroot-cleanupブランチ名を偽装したPRは exit 1 で拒否される', () => {
  const r = runCi('chore/root-cleanup-20260811T121848Z', HUMAN, HUMAN, 'write');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /admin権限を持たない/);
});

test('ci実行(h): root-cleanupの類似ブランチはadmin作成でも exit 1 で拒否される', () => {
  const malformed = [
    'chore/root-cleanup-',
    'chore/root-cleanup-manual',
    'chore/root-cleanup-20260811T121848Z-extra',
    'feature/root-cleanup-20260811T121848Z',
  ];
  for (const branch of malformed) {
    const r = runCi(branch, HUMAN, HUMAN, 'admin');
    assert.equal(r.status, 1, `${branch} は拒否されること`);
  }
});

test('ci実行(i): root-cleanup PR作成者の権限API確認が失敗した場合は exit 1 で安全側に停止する', () => {
  const step = ctxStep(CI_BODY, 'verify');
  const actor = resolveActor(step.env?.ACTOR, HUMAN, HUMAN);
  const r = runStep(
    step.run as string,
    { BRANCH: 'chore/root-cleanup-20260811T121848Z', ACTOR: actor, REPOSITORY: 'test/repo', GH_TOKEN: 'test-token', GH_MOCK_EXIT: '1' },
    'admin',
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /リポジトリ権限を確認できません/);
});
