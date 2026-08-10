import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(repoRoot, '.agent-skill-chain', 'scripts', 'codex-hang-check.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('bash', [script, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

function withTempDir(run_: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hang-check-test-'));
  try {
    run_(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #336 検証観点1: ハング状態（経過時間>>CPU時間）を模擬し、定めた閾値・手順で検知できること。
test('codex-hang-check check: 経過時間>=閾値かつCPU時間がほぼ増加していないプロセスのみをハング候補として検知する', () => {
  withTempDir((dir) => {
    const psFile = path.join(dir, 'ps.txt');
    fs.writeFileSync(
      psFile,
      [
        '  PID ELAPSED    TIME COMMAND',
        '99001     650       0 node /opt/codex/app-server-broker.mjs --foo', // hung: 650s elapsed, 0s cpu
        '99002     650     420 codex app-server --active', // busy: cpu grew, not hung
        '99003     100       0 node /opt/codex/app-server-broker.mjs --fresh', // too fresh: under threshold
        '99004     650       0 some-other-unrelated-daemon --x', // unrelated process, pattern must not match
      ].join('\n') + '\n',
    );

    const result = run(['check', '--ps-output', psFile]);
    assert.equal(result.status, 1, 'ハング候補が1件以上あるため終了コード1');
    assert.match(result.stdout, /HANG候補 pid=99001/);
    assert.doesNotMatch(result.stdout, /pid=99002/);
    assert.doesNotMatch(result.stdout, /pid=99003/);
    assert.doesNotMatch(result.stdout, /pid=99004/);
  });
});

test('codex-hang-check check: ハング候補が無ければ終了コード0で報告する', () => {
  withTempDir((dir) => {
    const psFile = path.join(dir, 'ps.txt');
    fs.writeFileSync(psFile, '  PID ELAPSED    TIME COMMAND\n99002     650     420 codex app-server --active\n');
    const result = run(['check', '--ps-output', psFile]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ハング候補なし/);
  });
});

test('codex-hang-check compare: 2回のサンプルでCPU時間の増分が無いプロセスのみをハング確定として検知する', () => {
  withTempDir((dir) => {
    const before = path.join(dir, 'before.txt');
    const after = path.join(dir, 'after.txt');
    fs.writeFileSync(
      before,
      ['  PID ELAPSED    TIME COMMAND', '88001      10       2 codex-code-mode-host --session a', '88002      10       1 codex-code-mode-host --session b'].join(
        '\n',
      ) + '\n',
    );
    fs.writeFileSync(
      after,
      [
        '  PID ELAPSED    TIME COMMAND',
        '88001     700       2 codex-code-mode-host --session a', // elapsed +690s, cpu +0s -> hang
        '88002     700      55 codex-code-mode-host --session b', // elapsed +690s, cpu +54s -> busy
      ].join('\n') + '\n',
    );

    const result = run(['compare', '--before', before, '--after', after]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /HANG確定 pid=88001/);
    assert.doesNotMatch(result.stdout, /pid=88002/);
  });
});

// Issue #336 検証観点2: 検知後のプロセス終了手順が、同一ホスト上の無関係な別プロセス
// （他セッション）を誤って停止させないこと。
test('codex-hang-check kill: --cwd に一致するプロセスのみを対象とし、他cwd（他セッション）のプロセスは対象から除外する', () => {
  withTempDir((dir) => {
    const psFile = path.join(dir, 'ps.txt');
    const cwdMap = path.join(dir, 'cwdmap.txt');
    fs.writeFileSync(
      psFile,
      [
        '  PID ELAPSED    TIME COMMAND',
        '77001     700       0 codex app-server --a', // 対象worktree
        '77002     700       0 codex app-server --b', // 別セッションのworktree
      ].join('\n') + '\n',
    );
    fs.writeFileSync(cwdMap, ['77001 /work/target-worktree', '77002 /work/other-session-worktree'].join('\n') + '\n');

    const result = run(['kill', '--cwd', '/work/target-worktree', '--ps-output', psFile, '--cwd-map', cwdMap, '--dry-run']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /対象 pid=77001/);
    assert.doesNotMatch(result.stdout, /対象 pid=77002/);
  });
});

test('codex-hang-check kill: cwdが一致するプロセスが無ければ何も対象にせず終了コード1（安全側no-op）', () => {
  withTempDir((dir) => {
    const psFile = path.join(dir, 'ps.txt');
    const cwdMap = path.join(dir, 'cwdmap.txt');
    fs.writeFileSync(psFile, '  PID ELAPSED    TIME COMMAND\n77002     700       0 codex app-server --b\n');
    fs.writeFileSync(cwdMap, '77002 /work/other-session-worktree\n');

    const result = run(['kill', '--cwd', '/work/no-such-worktree', '--ps-output', psFile, '--cwd-map', cwdMap, '--dry-run']);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /対象 pid=/);
  });
});

test('codex-hang-check kill: --cwd 省略時は使い方エラー（無関係セッションの巻き込み事故を防ぐ必須ガード）', () => {
  const result = run(['kill', '--dry-run']);
  assert.equal(result.status, 2);
});

// Issue #542 AC-1: pattern一致プロセスがbefore/afterいずれにも1件も無い場合、set -euo pipefail下の
// grep非ゼロ終了によりハング判定ロジックへ到達する前に打ち切られ「ハング確定あり」と誤検知しないこと。
test('codex-hang-check compare: pattern一致プロセスがbefore/afterいずれにも無ければ誤検知せず終了コード0', () => {
  withTempDir((dir) => {
    const before = path.join(dir, 'before.txt');
    const after = path.join(dir, 'after.txt');
    const noMatch = '  PID ELAPSED    TIME COMMAND\n99999      10       2 some-unrelated-daemon --x\n';
    fs.writeFileSync(before, noMatch);
    fs.writeFileSync(after, noMatch);

    const result = run(['compare', '--before', before, '--after', after]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ハング確定なし/);
  });
});
