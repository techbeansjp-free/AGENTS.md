// ISSUE-590（root直下混入マージ前予防ゲート、ADR-0046）AC-1・AC-2の構造検証。
//
// 「verify-root-clean (merge-ready)」ステップは、既存の .agent-skill-chain/ci/verify-root-clean.sh
// （verify root-clean CLI、Issue #208で導入済み・無変更のまま再利用）を、マージ準備完了状態
// （draft == false）のPRに限定して呼び出す必須checkである。draft中（Issue進行中の正常な中間
// 状態、root直下に対象4ファイルが存在すること自体が正常）を誤ってブロックしないことが本ステップの
// if条件で機械的に保証されているかを、agent-skill-chain-ci.yml の実体を直接パースして検証する
// （dependabot-ci-skip.test.ts と同一方式）。GitHub Actions の if 式評価自体（実行時のワークフロー
// エンジンの挙動）を単体テストで再現するのは既存踏襲の限界であり、その等価性確認は設計・実装
// レビューに委ねる（DESIGN.md・PLAN.md参照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CI_BODY = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-ci.yml');
const CI_TEMPLATE = path.join(
  REPO_ROOT,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-ci.yml',
);

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
}

interface CiWorkflow {
  jobs: { verify: { steps: Step[] } };
}

function ciSteps(file: string): Step[] {
  const wf = readYamlFile<CiWorkflow>(file);
  assert.ok(Array.isArray(wf.jobs?.verify?.steps), 'jobs.verify.steps が配列であること');
  return wf.jobs.verify.steps;
}

const STEP_NAME = 'verify-root-clean (merge-ready)';

for (const file of [CI_BODY, CI_TEMPLATE]) {
  test(`ci (${path.relative(REPO_ROOT, file)}): '${STEP_NAME}' ステップが存在し、既存の verify-root-clean.sh を無変更のまま呼び出す`, () => {
    const steps = ciSteps(file);
    const step = steps.find((s) => s.name === STEP_NAME);
    assert.ok(step, `'${STEP_NAME}' ステップが存在すること`);
    assert.equal(step?.run?.trim(), './.agent-skill-chain/ci/verify-root-clean.sh');
  });

  test(`ci (${path.relative(REPO_ROOT, file)}): '${STEP_NAME}' の if 条件は skip_checks ガードと draft == false の両方を含む（AC-1・AC-2）`, () => {
    const steps = ciSteps(file);
    const step = steps.find((s) => s.name === STEP_NAME);
    assert.equal(typeof step?.if, 'string', `'${STEP_NAME}' に if 条件が存在すること`);
    const ifCond = step?.if as string;
    assert.ok(ifCond.includes("steps.ctx.outputs.skip_checks != 'true'"), 'skip_checksガードを含むこと');
    assert.ok(
      ifCond.includes('github.event.pull_request.draft == false'),
      'draft == false 条件を含むこと（AC-2: Issue進行中の誤検知防止）',
    );
  });

  test(`ci (${path.relative(REPO_ROOT, file)}): '${STEP_NAME}' は verify-worktree-path の直後、verify-template-sync の直前に配置される`, () => {
    const steps = ciSteps(file);
    const worktreeIdx = steps.findIndex((s) => s.name === 'verify-worktree-path');
    const rootCleanIdx = steps.findIndex((s) => s.name === STEP_NAME);
    const templateSyncIdx = steps.findIndex((s) => s.name === 'verify-template-sync');
    assert.ok(worktreeIdx >= 0 && rootCleanIdx >= 0 && templateSyncIdx >= 0, '3ステップとも存在すること');
    assert.equal(rootCleanIdx, worktreeIdx + 1);
    assert.equal(templateSyncIdx, rootCleanIdx + 1);
  });
}
