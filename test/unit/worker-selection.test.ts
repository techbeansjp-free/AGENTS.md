import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorkerSegment,
  resolveWorkerSelection,
  resolveModelForTier,
  type WorkerConfig,
} from '../../src/lib/worker-selection.js';

// ISSUE-307 SPEC.md AC-1, AC-2, AC-3, AC-5, AC-9: 選択解決（resolveWorkerSelection）とティア解決
// （resolveModelForTier）は config・セグメント名・ティア名・アダプタ名だけから結果を決める
// 純粋関数である。ファイル入出力・環境変数・プロセス起動を経由せず直接検証する。

function worker(config: WorkerConfig): { worker: WorkerConfig } {
  return { worker: config };
}

test('resolveWorkerSelection (AC-1): セグメント別上書きのadapterが最優先で解決される', () => {
  const config = worker({
    adapter: 'claude',
    segment_overrides: { implementation: { adapter: 'codex', model_tier: 'highest_capability', reasoning_effort: 'high' } },
  });

  assert.deepEqual(resolveWorkerSelection(config, 'implementation'), {
    adapter: 'codex',
    agentToolDispatch: false,
    model_tier: 'highest_capability',
    reasoning_effort: 'high',
  });
});

test('resolveWorkerSelection (AC-1): 上書きの無いセグメントはworker.adapter（スカラー）へフォールバックする', () => {
  const config = worker({
    adapter: 'claude',
    segment_overrides: { implementation: { adapter: 'codex', model_tier: 'highest_capability', reasoning_effort: 'high' } },
  });

  for (const segment of ['spec', 'design', 'validation'] as const) {
    assert.deepEqual(resolveWorkerSelection(config, segment), { adapter: 'claude', agentToolDispatch: false });
  }
});

test('resolveWorkerSelection (AC-3): セグメント別上書きを持たないスカラーのみの設定は全セグメントでスカラー値に解決される', () => {
  const config = worker({ adapter: 'codex' });

  for (const segment of ['spec', 'design', 'implementation', 'validation'] as const) {
    assert.deepEqual(resolveWorkerSelection(config, segment), { adapter: 'codex', agentToolDispatch: false });
  }
});

test('resolveWorkerSelection (AC-3): worker.adapterも未設定の場合は最終フォールバックのhumanになる', () => {
  const config = worker({});

  assert.deepEqual(resolveWorkerSelection(config, 'spec'), { adapter: 'human', agentToolDispatch: false });
});

test('resolveWorkerSelection: model_tier/reasoning_effortは上書きが無い場合キー自体を含めない（未解決を空文字にしない）', () => {
  const config = worker({ adapter: 'codex', segment_overrides: { implementation: { adapter: 'codex' } } });

  const selection = resolveWorkerSelection(config, 'implementation');
  assert.deepEqual(selection, { adapter: 'codex', agentToolDispatch: false });
  assert.ok(!('model_tier' in selection));
  assert.ok(!('reasoning_effort' in selection));
});

test('resolveWorkerSelection: 上書きのadapterがscalarと異なっても上書きが優先される（AC-1双方向）', () => {
  const config = worker({
    adapter: 'human',
    segment_overrides: { validation: { adapter: 'claude' } },
  });

  assert.deepEqual(resolveWorkerSelection(config, 'validation'), { adapter: 'claude', agentToolDispatch: false });
  assert.deepEqual(resolveWorkerSelection(config, 'spec'), { adapter: 'human', agentToolDispatch: false });
});

test('resolveWorkerSelection (ISSUE-448 AC-8): agent_tool_dispatch未設定はfalseへ安全側フォールバックする', () => {
  assert.equal(resolveWorkerSelection(worker({ adapter: 'claude' }), 'spec').agentToolDispatch, false);
});

test('resolveWorkerSelection (ISSUE-448 AC-8): agent_tool_dispatch.enabled=falseをfalseとして解決する', () => {
  assert.equal(
    resolveWorkerSelection(worker({ adapter: 'claude', agent_tool_dispatch: { enabled: false } }), 'spec').agentToolDispatch,
    false,
  );
});

test('resolveWorkerSelection (ISSUE-448 AC-8): agent_tool_dispatch.enabled=trueをtrueとして解決する', () => {
  assert.equal(
    resolveWorkerSelection(worker({ adapter: 'claude', agent_tool_dispatch: { enabled: true } }), 'spec').agentToolDispatch,
    true,
  );
});

test('isWorkerSegment: 4セグメントのみを真として扱う', () => {
  for (const segment of ['spec', 'design', 'implementation', 'validation']) {
    assert.equal(isWorkerSegment(segment), true);
  }
  for (const invalid of ['review', 'implementation ', 'SPEC', '']) {
    assert.equal(isWorkerSegment(invalid), false);
  }
});

// --- resolveModelForTier（ティア対応表からの具体モデル解決、AC-2・AC-9） --------------------

test('resolveModelForTier (AC-2, AC-9): worker.model_tiers.<tier>.<adapter>から具体的なモデル文字列を解決する', () => {
  const config = worker({ model_tiers: { highest_capability: { codex: 'gpt-5.6-sol' } } });

  assert.deepEqual(resolveModelForTier(config, 'highest_capability', 'codex'), { ok: true, model: 'gpt-5.6-sol' });
});

test('resolveModelForTier: 対応表そのものが無い場合は解決失敗として返す（推測しない）', () => {
  const config = worker({});

  const result = resolveModelForTier(config, 'highest_capability', 'codex');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /worker\.model_tiers\.highest_capability/);
});

test('resolveModelForTier: 当該ティアのエントリが無い場合は解決失敗として返す', () => {
  const config = worker({ model_tiers: {} });

  const result = resolveModelForTier(config, 'highest_capability', 'codex');
  assert.equal(result.ok, false);
});

test('resolveModelForTier: 当該アダプタ用のモデルが無い場合は解決失敗として返す（未知のアダプタへ推測しない）', () => {
  // codex以外のアダプタ（claude/human）はスキーマ上model_tiersの値に現れないため、
  // 型が許容しない組み合わせを直接想定するテストとして any 経由で検証する。
  const config = worker({ model_tiers: { highest_capability: {} } });

  const result = resolveModelForTier(config, 'highest_capability', 'codex');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /worker\.model_tiers\.highest_capability\.codex/);
});

test('resolveModelForTier: adapterがcodex以外の場合は常に解決失敗になる（本Issueでclaude/human用モデルを追加しない）', () => {
  const config = worker({ model_tiers: { highest_capability: { codex: 'gpt-5.6-sol' } } });

  const result = resolveModelForTier(config, 'highest_capability', 'claude');
  assert.equal(result.ok, false);
});
