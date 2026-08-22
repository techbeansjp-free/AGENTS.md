import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub, type GhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { packageRoot } from '../../src/lib/paths.js';
import { evidencePromptDigest } from '../../src/lib/review-evidence.js';
import type { GateReport } from '../../src/commands/gate.js';

const BRANCH = 'process/786-round-budget-convergence';
const PR_NUMBER = '791';
/** cutoff=2 まで進めた完了attempt。次のreviewが最終roundになる。 */
const COMPLETED_ATTEMPT_IDS = ['attempt-round-budget-0', 'attempt-round-budget-1'];
const FINAL_ATTEMPT_ID = 'attempt-round-budget-final';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface Fixture {
  repoDir: string;
  stub: GhStub;
  env: NodeJS.ProcessEnv;
  baseSha: string;
  targetSha: string;
}

/**
 * 最終round（cutoff=2）の直前状態を組み立てる。round 0・round 1 の完了attemptを実際の
 * submit-evidence 経路で作るため、ラウンド導出はtrusted verifierの検証を通った結果になる。
 */
function prepareFinalRound(t: TestContext): Fixture {
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-round-budget-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', BRANCH]);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: 最終roundの収束\n', 'utf8');
  // 最終roundへ到達するまでのattempt数を抑えるため、cutoffを既定の4から2へ下げる。
  const configPath = path.join(repo.dir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const baseConfig = fs.readFileSync(configPath, 'utf8');
  const targetConfig = baseConfig.replace(
    'round_limit: {narrowing_threshold: 2, cutoff_threshold: 4}',
    'round_limit: {narrowing_threshold: 1, cutoff_threshold: 2}',
  );
  assert.notEqual(targetConfig, baseConfig);
  fs.writeFileSync(configPath, targetConfig);
  git(repo.dir, ['add', 'SPEC.md', '.agent-skill-chain/config/agent-skill-chain.yaml']);
  git(repo.dir, ['commit', '-m', 'test: add round budget convergence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const state = stub.readState();
  state.pullMetadata = {
    number: Number(PR_NUMBER),
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: BRANCH },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{ author: { login: 'adachi-tatsuru' }, committer: { login: 'adachi-tatsuru' } }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);
  stub.seedIssueLabels('786', ['risk:normal', 'autonomy:gated']);

  const rawVerdict = {
    conformance: 'pass',
    falsification: 'fail',
    blockers: [{
      severity: 'blocking',
      origin: 'specification',
      code: 'STILL_BLOCKING',
      evidence: ['SPEC.md の AC-1 に対する反例'],
    }],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };

  for (const [index, attemptId] of COMPLETED_ATTEMPT_IDS.entries()) {
    const prompt = runCli(
      ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, PR_NUMBER, attemptId],
      { cwd: repo.dir, env },
    );
    assert.equal(prompt.status, 0, prompt.stderr);
    const promptDigest = evidencePromptDigest(prompt.stdout.trimEnd());
    const runIds = [`review-round-budget-${index}-1`, `review-round-budget-${index}-2`];
    fs.writeFileSync(tokenPath, `${JSON.stringify({
      schema_version: 'agent-skill-chain/launcher-token/v1',
      attempt_id: attemptId,
      expected_count: 2,
      profile: 'strict',
      target_sha: targetSha,
      base_sha: baseSha,
      pr_number: PR_NUMBER,
      nonce: String(index).repeat(48),
      trusted_root: packageRoot(),
      procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
      slots: runIds.map((run_id, slotIndex) => ({ slot: slotIndex + 1, run_id })),
      consumed_slots: [],
    })}\n`, { mode: 0o600 });
    for (const [slotIndex, runId] of runIds.entries()) {
      const submitted = runCli(
        [
          'gate', 'submit-evidence', 'ISSUE-786', 'spec', 'strict', targetSha, baseSha, baseSha, PR_NUMBER,
          attemptId, '2', runId, String(slotIndex + 1), 'codex', 'gpt-5.6-sol', 'high', promptDigest,
        ],
        { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
      );
      assert.equal(submitted.status, 0, submitted.stderr);
    }
  }
  assert.equal(stub.readState().pullReviews?.length, 4);
  return { repoDir: repo.dir, stub, env, baseSha, targetSha };
}

/**
 * Issue #786 反例経路（`FINAL_ROUND_UNDECLARABLE_AFTER_NONREJECTED_ATTEMPT`）。
 *
 * 宣言を作成できない最終roundで review() が例外終了すると、gate-reportを1件も書かないまま
 * launcherが `set -euo pipefail` の下で異常終了し、reviewer起動・証跡投稿・verify-evidenceの
 * いずれにも到達しない。新しいattemptが作られずroundも進まないため、当該gateのreviewが
 * 恒久的に実行不能になる。SPEC.md AC-6 は未収束の帰結を「最終判定が human_required となり」と
 * 定めており、判定記録として収束させなければならない。
 */
test('AC-6: 最終roundの事前宣言を解決できない経路はコマンド失敗ではなくhuman_requiredとして記録される', (t) => {
  const { repoDir, env, baseSha, targetSha } = prepareFinalRound(t);

  git(repoDir, ['checkout', BRANCH]);
  const review = runCli(
    ['gate', 'review', 'ISSUE-786', 'spec', 'strict', targetSha],
    {
      cwd: repoDir,
      env: {
        ...env,
        ASC_REVIEW_ATTEMPT_ID: FINAL_ATTEMPT_ID,
        ASC_EVIDENCE_PR_NUMBER: PR_NUMBER,
        ASC_EVIDENCE_BASE_SHA: baseSha,
      },
    },
  );
  assert.notEqual(review.status, 0, 'reviewer起動へは進ませないこと');
  assert.match(review.stderr, /最終roundの事前宣言を検証できません/);
  const reportPath = /^gate_report_path: (.+)$/m.exec(review.stderr)?.[1];
  assert.ok(reportPath, `gate-reportの記録先が提示されていること: ${review.stderr}`);
  assert.ok(fs.existsSync(reportPath), 'gate-reportが記録されていること');
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as GateReport;
  assert.equal(report.gate.final, 'human_required');
  assert.equal(report.gate.target_sha, targetSha);
  // レビュアのsub-verdictは推測しない。判定記録としてのhuman_requiredだけを残す。
  assert.equal(report.gate.conformance, 'pending');
  assert.equal(report.gate.falsification, 'pending');
  assert.equal(report.gate.round_budget_declaration, undefined);
});

/**
 * Issue #786 反例経路（`FINAL_ROUND_DECLARATION_BREAKS_ROUND_DERIVATION_AND_LOCKS_GATE`）。
 *
 * 宣言を載せた過去attemptがtrusted verifierの検証に落ちてラウンド計数から除外されると、
 * 最終round到達後もroundが増えず、宣言が required かつ解決可能なまま固定される。
 * DESIGN.md D1 は宣言をround導出元にしないことを求めており、宣言をevidenceへ載せたこと自体で
 * 既存の導出結果が変わってはならない。
 */
test('D1: round budget宣言をevidenceへ載せた最終round attemptもラウンド計数から外れない', (t) => {
  const { repoDir, stub, env, baseSha, targetSha } = prepareFinalRound(t);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');
  t.after(() => fs.rmSync(tokenDir, { recursive: true, force: true }));

  const beforeDeclaration = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, PR_NUMBER, FINAL_ATTEMPT_ID],
    { cwd: repoDir, env },
  );
  assert.equal(beforeDeclaration.status, 0, beforeDeclaration.stderr);
  assert.match(beforeDeclaration.stdout, /現在のラウンド番号: 2/);

  // 直前attemptの差し戻しを確定する状態遷移で最終roundを宣言する。
  // 解決済みcutoffは作業ツリーのconfigから読むため、対象branchで実行する。
  git(repoDir, ['checkout', BRANCH]);
  const declared = runCli(
    ['gate', 'declare-final-round', 'ISSUE-786', 'spec', PR_NUMBER],
    { cwd: repoDir, env },
  );
  assert.equal(declared.status, 0, declared.stderr);

  // 最終roundのreviewは宣言を解決し、gate-reportとevidenceへ実行attestationとして載せる。
  const review = runCli(
    ['gate', 'review', 'ISSUE-786', 'spec', 'strict', targetSha],
    {
      cwd: repoDir,
      env: {
        ...env,
        ASC_REVIEW_ATTEMPT_ID: FINAL_ATTEMPT_ID,
        ASC_EVIDENCE_PR_NUMBER: PR_NUMBER,
        ASC_EVIDENCE_BASE_SHA: baseSha,
      },
    },
  );
  assert.equal(review.status, 0, review.stderr);
  const reportPath = /^gate_report_path: (.+)$/m.exec(review.stdout)?.[1];
  assert.ok(reportPath);
  const scaffold = parse(fs.readFileSync(reportPath, 'utf8')) as GateReport;
  assert.ok(scaffold.gate.round_budget_declaration, '宣言がscaffoldへ結線されていること');

  git(repoDir, ['checkout', 'main']);
  const finalPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, PR_NUMBER, FINAL_ATTEMPT_ID],
    { cwd: repoDir, env },
  );
  assert.equal(finalPrompt.status, 0, finalPrompt.stderr);
  const promptDigest = evidencePromptDigest(finalPrompt.stdout.trimEnd());
  const runIds = ['review-round-budget-final-1', 'review-round-budget-final-2'];
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: FINAL_ATTEMPT_ID,
    expected_count: 2,
    profile: 'strict',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: PR_NUMBER,
    nonce: 'f'.repeat(48),
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: runIds.map((run_id, slotIndex) => ({ slot: slotIndex + 1, run_id })),
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  const finalVerdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  for (const [slotIndex, runId] of runIds.entries()) {
    const submitted = runCli(
      [
        'gate', 'submit-evidence', 'ISSUE-786', 'spec', 'strict', targetSha, baseSha, baseSha, PR_NUMBER,
        FINAL_ATTEMPT_ID, '2', runId, String(slotIndex + 1), 'codex', 'gpt-5.6-sol', 'high', promptDigest,
      ],
      { cwd: repoDir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(finalVerdict) },
    );
    assert.equal(submitted.status, 0, submitted.stderr);
  }
  assert.equal(stub.readState().pullReviews?.length, 6);

  // 宣言付きattemptが計数へ残るため、人間が明示指示した追加の修正ラウンドはround 3として進む。
  // 除外されるとroundが2のまま固定され、宣言がrequiredかつ解決可能なまま動かなくなる。
  const nextRound = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, PR_NUMBER, 'attempt-round-budget-next'],
    { cwd: repoDir, env },
  );
  assert.equal(nextRound.status, 0, nextRound.stderr);
  assert.match(nextRound.stdout, /現在のラウンド番号: 3/);
});
