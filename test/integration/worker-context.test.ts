import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTmpRepo,
  setWorkerAdapter,
  setWorkerAgentToolDispatch,
  unsetWorkerAdapter,
  removeWorkerSegmentOverrides,
  removeWorkerModelTiers,
  FIXED_TIMESTAMP,
} from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

test('worker context: issue start済みならissue_number直後にworktree_pathを出力する（ISSUE-442 AC-1）', () => {
  const repo = createTmpRepo();
  try {
    const started = runCli(['issue', 'start', 'ISSUE-442', 'bugfix', 'worker-launch-worktree-cd', FIXED_TIMESTAMP], {
      cwd: repo.dir,
    });
    assert.equal(started.status, 0, started.stderr);
    const [, worktreePath] = started.stdout.trim().split('\n');

    const result = runCli(['worker', 'context', 'ISSUE-442', 'spec'], { cwd: repo.dir });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'adapter=claude',
      'agent_tool_dispatch=false',
      'backend=local',
      'issue_number=442',
      `worktree_path=${worktreePath}`,
    ]);
  } finally {
    repo.cleanup();
  }
});

test('worker context: issue start未実行ならworktree_pathを出力しない（ISSUE-442 AC-4）', () => {
  const repo = createTmpRepo();
  try {
    const result = runCli(['worker', 'context', 'ISSUE-442', 'spec'], { cwd: repo.dir });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'adapter=claude',
      'agent_tool_dispatch=false',
      'backend=local',
      'issue_number=442',
    ]);
  } finally {
    repo.cleanup();
  }
});

// ISSUE-307 SPEC.md AC-1, AC-2, AC-3, AC-7: `agent-skill-chain worker context <issue_id> [segment]`
// の CLI 出力そのものを検証する（選択解決・ティア解決ロジック自体は
// test/unit/worker-selection.test.ts が担う）。createTmpRepo() はこのパッケージ自身の
// .agent-skill-chain/（本ワークツリーで変更したもの）を複製するため、本物のリポジトリの
// worker.segment_overrides.implementation・worker.model_tiers（AC-6）がそのまま前提として使える。

test('worker context <issue_id> implementation (AC-1, AC-2, AC-6): 本リポジトリ既定configでadapter=codex/model_tier/model/reasoning_effortが解決される', () => {
  const repo = createTmpRepo();
  try {
    const result = runCli(['worker', 'context', 'ISSUE-307', 'implementation'], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.deepEqual(lines, [
      'adapter=codex',
      'agent_tool_dispatch=false',
      'backend=local',
      'issue_number=307',
      'model_tier=highest_capability',
      'model=gpt-5.6-sol',
      'reasoning_effort=high',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('worker context <issue_id> spec/design/validation (AC-1): 上書きの無いセグメントはworker.adapter（claude）のままでmodel_tier/model/reasoning_effort行が出ない', () => {
  const repo = createTmpRepo();
  try {
    for (const segment of ['spec', 'design', 'validation']) {
      const result = runCli(['worker', 'context', 'ISSUE-307', segment], { cwd: repo.dir });
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.trim().split('\n');
      assert.deepEqual(
        lines,
        ['adapter=claude', 'agent_tool_dispatch=false', 'backend=local', 'issue_number=307'],
        `segment=${segment}`,
      );
    }
  } finally {
    repo.cleanup();
  }
});

test('worker context <issue_id> (segmentを省略): agent_tool_dispatchを含む4行を返す（ISSUE-448 AC-8）', () => {
  const repo = createTmpRepo();
  try {
    const result = runCli(['worker', 'context', 'ISSUE-307'], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'adapter=claude',
      'agent_tool_dispatch=false',
      'backend=local',
      'issue_number=307',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('worker context (ISSUE-448 AC-8): 明示opt-inをagent_tool_dispatch=trueとして常に出力する', () => {
  const repo = createTmpRepo();
  try {
    setWorkerAgentToolDispatch(repo.dir, true);
    const result = runCli(['worker', 'context', 'ISSUE-448', 'spec'], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^agent_tool_dispatch=true$/m);
  } finally {
    repo.cleanup();
  }
});

test('worker context <issue_id> <不正なsegment名>: 日本語の理由付きで失敗する（推測して既定値へ倒さない）', () => {
  const repo = createTmpRepo();
  try {
    const result = runCli(['worker', 'context', 'ISSUE-307', 'bogus-segment'], { cwd: repo.dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /segment は spec\|design\|implementation\|validation のいずれかである必要があります/);
  } finally {
    repo.cleanup();
  }
});

test('worker context (AC-3): セグメント別上書き・ティア対応表を持たない既存設定はworker.adapterがそのまま全セグメントへ解決される', () => {
  const repo = createTmpRepo();
  try {
    removeWorkerSegmentOverrides(repo.dir);
    removeWorkerModelTiers(repo.dir);
    setWorkerAdapter(repo.dir, 'codex');
    for (const segment of ['spec', 'design', 'implementation', 'validation']) {
      const result = runCli(['worker', 'context', 'ISSUE-1', segment], { cwd: repo.dir });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        result.stdout.trim().split('\n'),
        ['adapter=codex', 'agent_tool_dispatch=false', 'backend=local', 'issue_number=1'],
        `segment=${segment}`,
      );
    }
  } finally {
    repo.cleanup();
  }
});

test('worker context (AC-3): worker.adapterも未設定の場合はhumanへフォールバックする', () => {
  const repo = createTmpRepo();
  try {
    removeWorkerSegmentOverrides(repo.dir);
    removeWorkerModelTiers(repo.dir);
    unsetWorkerAdapter(repo.dir);
    const result = runCli(['worker', 'context', 'ISSUE-1', 'spec'], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'adapter=human',
      'agent_tool_dispatch=false',
      'backend=local',
      'issue_number=1',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('worker context (AC-2, AC-9): model_tierが指定されているのにworker.model_tiersが無い場合は推測せずエラーで終了する', () => {
  const repo = createTmpRepo();
  try {
    removeWorkerModelTiers(repo.dir);
    // 本物のconfigのsegment_overrides.implementation（model_tier: highest_capability）は
    // そのまま残るが、対応表だけが無い状態を作る。
    const result = runCli(['worker', 'context', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /worker\.model_tiers\.highest_capability が未定義です/);
  } finally {
    repo.cleanup();
  }
});

// AC-7: 恒久設定の変更操作・実行主体・タイミングが規範文書（ここではCLIヘルプ出力）から
// 一意に読み取れ、進行役の純粋性を侵さないことが確認できること。
test('worker context -h (AC-7): 恒久設定の変更操作・実行主体・タイミング・現在値の確認手段が記載される', () => {
  const repo = createTmpRepo();
  try {
    const result = runCli(['worker', 'context', '-h'], { cwd: repo.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent-skill-chain\.yaml の直接編集で更新する/, '変更操作（直接編集）が記載されること');
    assert.match(result.stdout, /専用の[\s\S]*書き換えコマンドは存在しない/, '専用コマンドが存在しないことが記載されること');
    assert.match(result.stdout, /具体的なモデル文字列を書いてよいのは[\s\S]*worker\.model_tiers/, 'モデル文字列の唯一の保持場所が記載されること');
    assert.match(result.stdout, /writer lease を保持する[\s\S]*セグメント作業[\s\S]*ワーカー/, '実行主体が記載されること');
    assert.match(result.stdout, /実装セグメントで編集/, 'タイミングが記載されること');
    assert.match(result.stdout, /進行役は[\s\S]*編集しない/, '進行役が編集しないこと（I5）が記載されること');
    assert.match(result.stdout, /不変条件I5/, 'I5への言及があること');
    assert.match(result.stdout, /worker context/, '現在の解決結果の確認手段（このコマンド自体）が案内されること');
  } finally {
    repo.cleanup();
  }
});
