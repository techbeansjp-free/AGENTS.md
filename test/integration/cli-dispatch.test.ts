import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// src/agents-md.ts のトップレベルルーティングを検証する。個々のコマンドの業務ロジックは
// test/integration/issue-lifecycle.test.ts・github-backend.test.ts が担い、ここでは
// 「引数の並びがどのハンドラへ振り分けられるか」「未知コマンド・ヘルプの扱い」のみを見る。
// -h/--help は各ハンドラで repoRoot() 呼び出しより前に判定される（isHelp() が先頭でreturnする）ため、
// git repo であれば任意のcwdで実行できるが、実運用に近い形として一時repoのcwdで統一する。

test('引数無し・-h・--help: トップレベル使用方法が出力され終了コード0であること', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    for (const args of [[], ['-h'], ['--help']]) {
      const result = runCli(args, { cwd: repo.dir });
      assert.equal(result.status, 0, `${JSON.stringify(args)}: ${result.stderr}`);
      assert.match(result.stdout, /使い方: agent-skill-chain <command> \[subcommand\] \[args\.\.\.\]/);
      assert.match(result.stdout, /利用可能なコマンド:/);
      // 代表的な2トークン・1トークンコマンドが一覧に含まれること
      assert.match(result.stdout, /^ {2}issue start$/m);
      assert.match(result.stdout, /^ {2}checkpoint$/m);
    }
  } finally {
    repo.cleanup();
  }
});

test('未知のコマンド: 終了コード1、標準エラーに理由、使用方法も併記されること', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    const result = runCli(['foo', 'bar'], { cwd: repo.dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知のコマンドです: 'foo bar'/);
    // 未知コマンド時も使用方法（コマンド一覧）が併記されること
    assert.match(result.stdout, /利用可能なコマンド:/);
    assert.match(result.stdout, /^ {2}gate publish$/m);
  } finally {
    repo.cleanup();
  }
});

test('1トークンのみの未知コマンド: 終了コード1、標準エラーに理由が出ること', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    const result = runCli(['nope'], { cwd: repo.dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知のコマンドです: 'nope'/);
  } finally {
    repo.cleanup();
  }
});

test('2トークンルーティング: issue start / lease acquire / gate review / verify branch-name が対応ハンドラへ振り分けられること', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    // Given/When: 各コマンドを引数不足のまま実行する（-hではなく実行してCliErrorのUSAGE誘導を見る）
    // Then: 未知コマンド扱い（"未知のコマンドです"）にはならず、そのハンドラ固有の必須引数エラーになること
    // （= 正しいハンドラへ到達している証拠）。
    const issueStart = runCli(['issue', 'start'], { cwd: repo.dir });
    assert.equal(issueStart.status, 1);
    assert.doesNotMatch(issueStart.stderr, /未知のコマンドです/);
    assert.match(issueStart.stderr, /issue_id, type, slug, issue_created_at はすべて必須です/);

    const leaseAcquire = runCli(['lease', 'acquire'], { cwd: repo.dir });
    assert.equal(leaseAcquire.status, 1);
    assert.doesNotMatch(leaseAcquire.stderr, /未知のコマンドです/);
    assert.match(leaseAcquire.stderr, /issue_id, segment はすべて必須です/);

    const gateReview = runCli(['gate', 'review'], { cwd: repo.dir });
    assert.equal(gateReview.status, 1);
    assert.doesNotMatch(gateReview.stderr, /未知のコマンドです/);
    assert.match(gateReview.stderr, /issue_id, gate_id, profile はすべて必須です/);

    // verify branch-name は引数省略可（現在のHEADブランチを見る）なので、代わりに -h で
    // ハンドラ到達を確認する。
    const verifyBranchName = runCli(['verify', 'branch-name', '-h'], { cwd: repo.dir });
    assert.equal(verifyBranchName.status, 0, verifyBranchName.stderr);
    assert.match(verifyBranchName.stdout, /使い方: agent-skill-chain verify branch-name/);
  } finally {
    repo.cleanup();
  }
});

test('1トークンルーティング: checkpoint / cleanup / doctor / reconcile / setup が対応ハンドラへ振り分けられること', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    const checkpoint = runCli(['checkpoint'], { cwd: repo.dir });
    assert.equal(checkpoint.status, 1);
    assert.doesNotMatch(checkpoint.stderr, /未知のコマンドです/);
    assert.match(checkpoint.stderr, /message は必須です/);

    const cleanup = runCli(['cleanup'], { cwd: repo.dir });
    assert.equal(cleanup.status, 1);
    assert.doesNotMatch(cleanup.stderr, /未知のコマンドです/);
    assert.match(cleanup.stderr, /issue_id は必須です/);

    // doctor は引数無しで実行できるコマンドなので、正常終了そのものがハンドラ到達の証拠。
    const doctor = runCli(['doctor'], { cwd: repo.dir });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /OK {2}git\n/);

    // reconcile も引数無しで実行できる（全Issueを走査する）ため、正常終了で到達を確認する。
    const reconcile = runCli(['reconcile'], { cwd: repo.dir });
    assert.equal(reconcile.status, 0, reconcile.stderr);
  } finally {
    repo.cleanup();
  }
});

test('各コマンドの -h/--help は終了コード0でUSAGE文字列を出すこと（代表例）', () => {
  const repo = createTmpRepo({ backend: 'local' });
  try {
    const cases: { args: string[]; usagePattern: RegExp }[] = [
      { args: ['issue', 'start', '-h'], usagePattern: /使い方: agent-skill-chain issue start/ },
      { args: ['issue', 'resume', '--help'], usagePattern: /使い方: agent-skill-chain issue resume/ },
      { args: ['lease', 'acquire', '-h'], usagePattern: /使い方: agent-skill-chain lease acquire/ },
      { args: ['lease', 'release', '-h'], usagePattern: /使い方: agent-skill-chain lease release/ },
      { args: ['gate', 'publish', '-h'], usagePattern: /使い方: agent-skill-chain gate publish/ },
      { args: ['pr', 'create', '-h'], usagePattern: /使い方: agent-skill-chain pr create/ },
      { args: ['setup', '-h'], usagePattern: /使い方: agent-skill-chain setup/ },
      { args: ['setup', 'github', '-h'], usagePattern: /使い方: agent-skill-chain setup github/ },
      { args: ['checkpoint', '--help'], usagePattern: /使い方: agent-skill-chain checkpoint/ },
      { args: ['cleanup', '-h'], usagePattern: /使い方: agent-skill-chain cleanup/ },
      { args: ['doctor', '-h'], usagePattern: /使い方: agent-skill-chain doctor/ },
      { args: ['reconcile', '-h'], usagePattern: /使い方: agent-skill-chain reconcile/ },
    ];
    for (const { args, usagePattern } of cases) {
      const result = runCli(args, { cwd: repo.dir });
      assert.equal(result.status, 0, `${JSON.stringify(args)}: ${result.stderr}`);
      assert.match(result.stdout, usagePattern, `${JSON.stringify(args)}`);
    }
  } finally {
    repo.cleanup();
  }
});
