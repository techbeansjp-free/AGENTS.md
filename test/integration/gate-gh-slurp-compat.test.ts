import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { evidencePromptDigest } from '../../src/lib/review-evidence.js';
import { packageRoot } from '../../src/lib/paths.js';

// Issue #774: gh 2.63.0 未満はページ一括オプションを未知フラグとして拒否する。
// 本ファイルは、そのような gh の下でも gate の取得経路が全ページを取得して機能すること
// （AC-1・AC-2・AC-5）、取得・解釈の失敗が利用者に見えること（AC-4・AC-6）、
// ページ一括オプションを受け付ける gh でも結果が変わらないこと（AC-8）を検証する。
// 実行環境の gh の実体・バージョン・設定は一切変更せず、テスト専用スタブだけを使う（AC-9）。

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PAGE_BUNDLING_FLAG = ['--', 'slurp'].join('');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('AC-1: src配下のgh起動引数からページ一括オプションが全廃され、--paginateは保たれている', () => {
  const files = sourceFiles(path.join(PACKAGE_ROOT, 'src'));
  const offenders = files.filter((file) => fs.readFileSync(file, 'utf8').includes(PAGE_BUNDLING_FLAG));
  assert.deepEqual(offenders, [], 'src配下にページ一括オプションの残存が無いこと');

  // 変更前にページ一括オプションを与えていた12箇所は、いずれも --paginate を保っていること。
  const paginateCounts = new Map(
    ['src/commands/gate.ts', 'src/lib/gate-round.ts', 'src/lib/review-light.ts'].map((relative) => [
      relative,
      fs.readFileSync(path.join(PACKAGE_ROOT, relative), 'utf8').split('--paginate').length - 1,
    ]),
  );
  assert.equal(paginateCounts.get('src/commands/gate.ts'), 10);
  assert.equal(paginateCounts.get('src/lib/gate-round.ts'), 1);
  assert.equal(paginateCounts.get('src/lib/review-light.ts'), 1);
});

test('AC-6: ラウンド履歴の取得失敗と解釈失敗だけを標準エラー出力へ提示し、終了コードと本文を変えない', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-slurp-diag-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: 診断\n', 'utf8');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add diagnostic target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);

  // gh が非0終了する場合。
  stub.writeState({ ...stub.readState(), failApiPaths: ['/reviews'] });
  const ghFailed = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', 'attempt-diag-1'],
    { cwd: repo.dir, env },
  );
  assert.equal(ghFailed.status, 0, ghFailed.stderr);
  assert.match(ghFailed.stderr, /警告: 過去ラウンドの判定記録を取得できませんでした（理由: PR review evidence の取得に失敗しました）/);
  assert.doesNotMatch(ghFailed.stdout, /^警告: /m);
  assert.match(ghFailed.stdout, /過去ラウンドの判定記録を耐久記録から取得できなかった/);
  assert.doesNotMatch(ghFailed.stdout, /本ラウンドは初回（ラウンド 0）/);

  // gh が終了コード0のままJSONとして解釈できない出力を返す場合（空出力を0件として扱わない）。
  for (const rawStdout of ['', '   \n', '[{"id":1}']) {
    const stubState = stub.readState();
    stubState.failApiPaths = [];
    stubState.rawApiResponses = [{ fragment: '/reviews', stdout: rawStdout }];
    stub.writeState(stubState);
    const unparsable = runCli(
      ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', 'attempt-diag-2'],
      { cwd: repo.dir, env },
    );
    assert.equal(unparsable.status, 0, unparsable.stderr);
    assert.match(unparsable.stderr, /警告: 過去ラウンドの判定記録を取得できませんでした（理由: PR review evidence の応答を解釈できませんでした）/);
    assert.doesNotMatch(unparsable.stdout, /^警告: /m);
    assert.doesNotMatch(unparsable.stdout, /本ラウンドは初回（ラウンド 0）/);
  }
});

test('AC-6: 失敗ではない運用形態（ローカルモード・PR番号未指定）では診断を出さない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: 正常形態\n', 'utf8');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add local mode target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);

  const result = runCli(['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /警告: 過去ラウンドの判定記録/);
  assert.equal(result.stderr, '');
});

test('AC-5/AC-8: ページ一括オプションを拒否するghでもラウンド履歴が構築され、受け付けるghと判定プロンプトが一致する', (t) => {
  // Issue #759: 証跡投稿は launcher token の trusted_root と procurement を必須にし、調達モードを
  // base SHA のコミット内容から再導出して照合する。本 fixture は clone_build 経路の形状で組む。
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-slurp-round-'));
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
  git(repo.dir, ['checkout', '-b', 'bugfix/774-slurp-compat']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: ラウンド履歴\n', 'utf8');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add round history target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const attemptId = 'attempt-slurp-round-1';
  const firstPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', attemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(firstPrompt.status, 0, firstPrompt.stderr);
  assert.match(firstPrompt.stdout, /本ラウンドは初回（ラウンド 0）/);
  const promptDigest = evidencePromptDigest(firstPrompt.stdout.trimEnd());

  const state = stub.readState();
  state.pullMetadata = {
    number: 779,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'bugfix/774-slurp-compat' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{ author: { login: 'adachi-tatsuru' }, committer: { login: 'adachi-tatsuru' } }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);

  const rawVerdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: attemptId,
    expected_count: 2,
    profile: 'strict',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '779',
    nonce: 'a'.repeat(48),
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [
      { slot: 1, run_id: 'review-slurp-round-1' },
      { slot: 2, run_id: 'review-slurp-round-2' },
    ],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  for (const [runId, slot] of [['review-slurp-round-1', '1'], ['review-slurp-round-2', '2']] as const) {
    const submitted = runCli(
      [
        'gate', 'submit-evidence', 'ISSUE-774', 'spec', 'strict', targetSha, baseSha, baseSha, '779',
        attemptId, '2', runId, slot, 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
      ],
      { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
    );
    assert.equal(submitted.status, 0, submitted.stderr);
  }
  assert.equal(stub.readState().pullReviews?.length, 2);

  const nextAttempt = 'attempt-slurp-round-2';
  // 古い gh: ページ一括オプションを非0終了で拒否し、`--paginate` のみの取得へ連結文書を返す。
  stub.setRejectSlurp(true);
  stub.setListResponseShape('concatenated', 3);
  const oldGh = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', nextAttempt],
    { cwd: repo.dir, env },
  );
  assert.equal(oldGh.status, 0, oldGh.stderr);
  assert.match(oldGh.stdout, /現在のラウンド番号: 1/);
  assert.doesNotMatch(oldGh.stdout, /過去ラウンドの判定記録を耐久記録から取得できなかった/);
  assert.doesNotMatch(oldGh.stdout, /本ラウンドは初回（ラウンド 0）/);
  assert.doesNotMatch(oldGh.stderr, /警告: 過去ラウンドの判定記録/);

  // 実際にページ一括オプションを渡していないこと（渡していれば上の実行は失敗している）。
  const reviewCalls = (stub.readState().apiCalls ?? []).filter(
    (call) => call.method === 'GET' && call.path.includes('/pulls/779/reviews'),
  );
  assert.ok(reviewCalls.length > 0);
  for (const call of reviewCalls) {
    assert.ok(call.args?.includes('--paginate'), '全ページ取得の意図が保たれていること');
    assert.ok(!call.args?.includes(PAGE_BUNDLING_FLAG), 'ページ一括オプションを渡さないこと');
  }

  // 新しい gh: ページ一括オプションを受け付け、同じ内容をページ配列（出力形 (iii)）で返す。
  stub.setRejectSlurp(false);
  stub.setListResponseShape('pages', 2);
  const newGh = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', nextAttempt],
    { cwd: repo.dir, env },
  );
  assert.equal(newGh.status, 0, newGh.stderr);
  assert.equal(newGh.stdout, oldGh.stdout);
  assert.equal(evidencePromptDigest(newGh.stdout.trimEnd()), evidencePromptDigest(oldGh.stdout.trimEnd()));

  // 出力形 (i)（平坦な単一配列）でも同一であること。
  stub.setListResponseShape('single');
  const flatGh = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-774', 'spec', targetSha, baseSha, '779', nextAttempt],
    { cwd: repo.dir, env },
  );
  assert.equal(flatGh.status, 0, flatGh.stderr);
  assert.equal(flatGh.stdout, oldGh.stdout);
});
