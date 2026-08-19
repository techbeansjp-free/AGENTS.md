import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { packageRoot } from '../../src/lib/paths.js';
import {
  evidencePromptDigest,
  parseReviewEvidence,
  renderReviewEvidence,
} from '../../src/lib/review-evidence.js';
import { createRoundBudgetDeclaration } from '../../src/lib/round-budget-policy.js';
import type { GateReport } from '../../src/commands/gate.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Issue #786: 最終roundの事前宣言機構が、ゲートを恒久的に判定不能へ固定しないことを固定する。
 *
 * 反例経路1（`FINAL_ROUND_UNDECLARABLE_AFTER_NONREJECTED_ATTEMPT`）:
 *   宣言を作成できない最終roundで review() が例外終了すると、gate-reportを1件も書かないまま
 *   launcherが `set -euo pipefail` の下で異常終了し、reviewer起動・証跡投稿・verify-evidenceの
 *   いずれにも到達しない。新しいattemptが作られずroundも進まないため、当該gateのreviewが
 *   恒久的に実行不能になる。SPEC.md AC-6 は未収束の帰結を「最終判定が human_required となり」と
 *   定めており、判定記録として収束させなければならない。
 *
 * 反例経路2（`FINAL_ROUND_DECLARATION_BREAKS_ROUND_DERIVATION_AND_LOCKS_GATE`）:
 *   宣言を載せた過去attemptがtrusted verifierの検証に落ちてラウンド計数から除外されると、
 *   最終round到達後もroundが増えず、宣言が required かつ解決可能なまま固定される。
 *   DESIGN.md D1 は宣言をround導出元にしないことを求めており、宣言の有無で既存の導出結果が
 *   変わってはならない。
 */
test('D1/AC-6: 最終roundの宣言不能はhuman_requiredとして記録され、宣言付きattemptもラウンド計数に残る', (t) => {
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
  const branch = 'process/786-round-budget-convergence';
  git(repo.dir, ['checkout', '-b', branch]);
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
    number: 791,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: branch },
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

  // round 0 と round 1 の完了attemptを作り、次のreviewを最終round（cutoff=2）にする。
  const attemptIds = ['attempt-round-budget-0', 'attempt-round-budget-1'];
  for (const [index, attemptId] of attemptIds.entries()) {
    const prompt = runCli(
      ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, '791', attemptId],
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
      pr_number: '791',
      nonce: String(index).repeat(48),
      trusted_root: packageRoot(),
      procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
      slots: runIds.map((run_id, slotIndex) => ({ slot: slotIndex + 1, run_id })),
      consumed_slots: [],
    })}\n`, { mode: 0o600 });
    for (const [slotIndex, runId] of runIds.entries()) {
      const submitted = runCli(
        [
          'gate', 'submit-evidence', 'ISSUE-786', 'spec', 'strict', targetSha, baseSha, baseSha, '791',
          attemptId, '2', runId, String(slotIndex + 1), 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
        ],
        { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
      );
      assert.equal(submitted.status, 0, submitted.stderr);
    }
  }
  assert.equal(stub.readState().pullReviews?.length, 4);

  const finalAttemptId = 'attempt-round-budget-final';
  const atFinalRound = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, '791', finalAttemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(atFinalRound.status, 0, atFinalRound.stderr);
  assert.match(atFinalRound.stdout, /現在のラウンド番号: 2/);

  // 反例経路1: 直前attemptがreject状態でも宣言コメントが1件も無ければ宣言は解決できない。
  // このとき review() はコマンド失敗で終わらず、gate-reportへ human_required を記録する。
  git(repo.dir, ['checkout', branch]);
  const review = runCli(
    ['gate', 'review', 'ISSUE-786', 'spec', 'strict', targetSha],
    {
      cwd: repo.dir,
      env: {
        ...env,
        ASC_REVIEW_ATTEMPT_ID: finalAttemptId,
        ASC_EVIDENCE_PR_NUMBER: '791',
        ASC_EVIDENCE_BASE_SHA: baseSha,
      },
    },
  );
  assert.notEqual(review.status, 0);
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

  // 反例経路2: round 1 のattemptへ宣言attestationを載せても、ラウンド計数から落ちない。
  // 落ちると round が 2 のまま固定され、最終round後に進めなくなる。
  const declaration = {
    ...createRoundBudgetDeclaration({
      issueId: 'ISSUE-786',
      gate: 'spec',
      previousAttemptId: attemptIds[0],
      finalRound: 2,
    }),
    declared_at: '2026-08-19T00:00:00.000Z',
    record_id: '4242',
  };
  const declaredState = stub.readState();
  declaredState.pullReviews = (declaredState.pullReviews ?? []).map((entry) => {
    const record = entry as { body: string } & Record<string, unknown>;
    const evidence = parseReviewEvidence(record.body);
    assert.ok(evidence);
    if (evidence.attempt_id !== attemptIds[1]) return record;
    return { ...record, body: renderReviewEvidence({ ...evidence, round_budget_declaration: declaration }) };
  });
  stub.writeState(declaredState);

  const afterDeclaration = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-786', 'spec', targetSha, baseSha, '791', finalAttemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(afterDeclaration.status, 0, afterDeclaration.stderr);
  assert.match(afterDeclaration.stdout, /現在のラウンド番号: 2/);
  assert.doesNotMatch(afterDeclaration.stdout, /現在のラウンド番号: 1/);
});
