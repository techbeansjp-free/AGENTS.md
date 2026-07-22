import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Issue #169 T6: .agent-skill-chain/hooks/claude-pretooluse.sh（PreToolUse hook本体）の結合テスト。
// ADR-2（tool_name=="Bash"限定の狭い安全網）・ADR-4（enforce off自体が非交差であること）を
// 実際にbashでスクリプトを駆動して検証する（2026-07-15ロックアウト事故の再発防止の核心部分）。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const HOOK_PATH = path.join(packageRoot, '.agent-skill-chain', 'hooks', 'claude-pretooluse.sh');

interface HookResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runHook(input: Record<string, unknown>, cwd: string = packageRoot): HookResult {
  const result = spawnSync('bash', [HOOK_PATH], { cwd, input: JSON.stringify(input), encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('ADR-2の核心: 非Bashツール（Agent）は常にexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Agent', tool_input: { prompt: 'do something' } });
  assert.equal(result.status, 0, result.stderr);
});

test('非Bashツール（Task）も常にexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Task', tool_input: {} });
  assert.equal(result.status, 0, result.stderr);
});

test('cleanupを経由しないgit worktree remove直接実行はexit 2で拒否される', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git worktree remove .worktrees/foo' } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /git worktree remove の直接実行は禁止されています/);
});

test('agent-skill-chain cleanup経由のコマンドはexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'agent-skill-chain cleanup ISSUE-1' } });
  assert.equal(result.status, 0, result.stderr);
});

test('命名規約に違反するブランチ作成（git checkout -b）はexit 2で拒否される', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git checkout -b bad-name' } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /命名規約/);
});

test('命名規約に適合するブランチ作成（git checkout -b）はexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git checkout -b feature/1-sample-feature' } });
  assert.equal(result.status, 0, result.stderr);
});

test('ADR-4: agent-skill-chain enforce off 自体はいずれの拒否パターンにも一致せずexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'agent-skill-chain enforce off' } });
  assert.equal(result.status, 0, result.stderr);
});

test('無関係な通常のBashコマンドはexit 0で通過する（fail-open）', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  assert.equal(result.status, 0, result.stderr);
});

test('tool_inputにcommandが無い場合はexit 0で通過する', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: {} });
  assert.equal(result.status, 0, result.stderr);
});

test('不正なJSON入力に対してもfail-openでexit 0になる', () => {
  const result = spawnSync('bash', [HOOK_PATH], { cwd: packageRoot, input: '{ not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('git switch -c での命名規約違反ブランチもexit 2で拒否される', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git switch -c not-valid' } });
  assert.equal(result.status, 2);
});

test('プロジェクト側のallowed_typesを読み取り、type未定義のブランチ名は拒否される', () => {
  const targetDir = mkScratch('pretooluse-config');
  try {
    fs.mkdirSync(path.join(targetDir, '.agent-skill-chain', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'),
      'issue:\n  allowed_types: [feature]\n',
    );

    const okResult = runHook({ tool_name: 'Bash', tool_input: { command: 'git checkout -b feature/2-ok' } }, targetDir);
    assert.equal(okResult.status, 0, okResult.stderr);

    const rejected = runHook({ tool_name: 'Bash', tool_input: { command: 'git checkout -b bugfix/2-not-allowed' } }, targetDir);
    assert.equal(rejected.status, 2, 'config側allowed_typesに無いtypeは拒否されること');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});
