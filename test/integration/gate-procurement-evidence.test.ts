// Issue #759 PLAN #7 / DESIGN E8: 証跡投稿時に調達の事実を独立に再検証する経路を固定する。
// 準備段の申告（launcher token）をそのまま信用せず、実行中のCLI実体の所在・base SHA から
// 再導出した調達モード・base SHA の期待値との digest 一致を記録時に確かめ、
// いずれか不成立なら証跡を投稿しない（AGENTS.md 不変条件I8 の安全側ラチェット）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { packageRoot } from '../../src/lib/paths.js';
import { evidencePromptDigest, parseReviewEvidence, type ReviewEvidence } from '../../src/lib/review-evidence.js';
import { TRUSTED_CLI_MARKER_SCHEMA } from '../../src/lib/trusted-cli-marker.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const ATTEMPT_ID = 'attempt-procurement-1';
const RUN_ID = 'review-procurement-1';
const VERDICT = JSON.stringify({
  conformance: 'pass',
  falsification: 'pass',
  blockers: [],
  approved_artifacts: [{ path: 'SPEC.md' }],
  inconclusive: false,
});

interface Harness {
  repoDir: string;
  baseSha: string;
  targetSha: string;
  tokenPath: string;
  writeToken(procurement: Record<string, unknown>): void;
  postedReviews(): { body: string }[];
  submit(): { status: number; stdout: string; stderr: string };
  submitFrom(cwd: string): { status: number; stdout: string; stderr: string };
  /** PR metadata の base と起動引数の base/trusted base を同時に差し替えて投稿する。 */
  submitWithBase(sha: string): { status: number; stdout: string; stderr: string };
  cleanup(): void;
}

function createHarness(options: { selfPackage: boolean; marker?: { tree_digest: string } }): Harness {
  const repo = createTmpRepo({ backend: 'github', selfPackage: options.selfPackage });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-procurement-'));
  const stub = createGhStub(stubDir);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');

  if (options.marker) {
    fs.writeFileSync(
      path.join(repo.dir, '.agent-skill-chain', '.trusted-cli.json'),
      `${JSON.stringify({
        schema_version: TRUSTED_CLI_MARKER_SCHEMA,
        package: 'agent-skill-chain',
        version: '0.0.0-fixture',
        tree_digest: options.marker.tree_digest,
      })}\n`,
    );
    git(repo.dir, ['add', '-A']);
    git(repo.dir, ['commit', '-m', 'test: install trusted cli marker']);
  }
  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);

  git(repo.dir, ['checkout', '-q', '-b', 'process/759-procurement']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: procurement\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add evidence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-q', 'main']);

  const state = stub.readState();
  state.pullMetadata = {
    number: 759,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/759-procurement' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{ author: { login: 'adachi-tatsuru' }, committer: { login: 'adachi-tatsuru' } }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);
  const env = stub.env(process.env);

  return {
    repoDir: repo.dir,
    baseSha,
    targetSha,
    tokenPath,
    writeToken(procurement) {
      fs.writeFileSync(
        tokenPath,
        `${JSON.stringify({
          schema_version: 'agent-skill-chain/launcher-token/v1',
          attempt_id: ATTEMPT_ID,
          expected_count: 1,
          profile: 'standard',
          target_sha: targetSha,
          base_sha: baseSha,
          pr_number: '759',
          nonce: 'a'.repeat(48),
          ...procurement,
          slots: [{ slot: 1, run_id: RUN_ID }],
          consumed_slots: [],
        })}\n`,
        { mode: 0o600 },
      );
    },
    postedReviews() {
      return (stub.readState().pullReviews ?? []) as { body: string }[];
    },
    submit() {
      return this.submitFrom(repo.dir);
    },
    submitFrom(cwd: string) {
      return runCli(
        [
          'gate', 'submit-evidence', 'ISSUE-759', 'spec', 'standard', targetSha, baseSha, baseSha, '759',
          ATTEMPT_ID, '1', RUN_ID, '1', 'human', 'human', 'manual',
          evidencePromptDigest('procurement fixture prompt'),
        ],
        { cwd, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: VERDICT },
      );
    },
    submitWithBase(sha: string) {
      const current = stub.readState();
      current.pullMetadata = {
        number: 759,
        state: 'open',
        user: { login: 'adachi-tatsuru' },
        head: { sha: targetSha, ref: 'process/759-procurement' },
        base: { sha, ref: 'main' },
      };
      stub.writeState(current);
      return runCli(
        [
          'gate', 'submit-evidence', 'ISSUE-759', 'spec', 'standard', targetSha, sha, sha, '759',
          ATTEMPT_ID, '1', RUN_ID, '1', 'human', 'human', 'manual',
          evidencePromptDigest('procurement fixture prompt'),
        ],
        { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: VERDICT },
      );
    },
    cleanup() {
      repo.cleanup();
      fs.rmSync(stubDir, { recursive: true, force: true });
      fs.rmSync(tokenDir, { recursive: true, force: true });
    },
  };
}

test('submit-evidence: trusted_rootとprocurementを持たないlauncher tokenは受け付けない', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());
  harness.writeToken({});

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /launcher tokenがattempt\/run\/slot契約と一致しないか既に消費済みです/);
  assert.deepEqual(harness.postedReviews(), []);
});

test('submit-evidence: 実行中のCLI実体が隔離clone配下でなければ証跡を投稿しない', (t) => {
  const harness = createHarness({ selfPackage: true });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-not-trusted-root-'));
  t.after(() => {
    harness.cleanup();
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  harness.writeToken({
    trusted_root: elsewhere,
    procurement: { mode: 'clone_build', source: `clone_build:${harness.baseSha}` },
  });

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /実行中のCLI実体が隔離clone配下にありません/);
  assert.deepEqual(harness.postedReviews(), []);
});

test('submit-evidence: 調達モードがbase SHAから再導出した値と一致しなければ証跡を投稿しない', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'package_copy', source: 'candidate-a:/tmp/fake#agent-skill-chain@0.0.0', digest: `sha256:${'b'.repeat(64)}` },
  });

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /調達モードがtrusted baseから再導出した値と一致しません: token=package_copy, derived=clone_build/);
  assert.deepEqual(harness.postedReviews(), []);
});

test('submit-evidence: package_copyで導入マーカーがbase SHAに無ければ証跡を投稿しない', (t) => {
  const harness = createHarness({ selfPackage: false });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'package_copy', source: 'candidate-a:/tmp/fake#agent-skill-chain@0.0.0', digest: `sha256:${'b'.repeat(64)}` },
  });

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trusted baseの信頼CLI導入マーカーを読めません/);
  assert.deepEqual(harness.postedReviews(), []);
});

test('submit-evidence: package_copyで調達実体のdigestが期待値と一致しなければ証跡を投稿しない', (t) => {
  const harness = createHarness({ selfPackage: false, marker: { tree_digest: `sha256:${'c'.repeat(64)}` } });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'package_copy', source: 'candidate-a:/tmp/fake#agent-skill-chain@0.0.0', digest: `sha256:${'c'.repeat(64)}` },
  });

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /調達実体のdigestがtrusted baseの期待値またはlauncher tokenの値と一致しません/);
  assert.deepEqual(harness.postedReviews(), []);
});

// Issue #759 AC-4 / PLAN #8: 準備段の変更で既存の拒否経路が失われていないことを固定する。
// recorder と trusted base SHA の関係を検査する経路は Issue #703 が「HEAD の完全一致」から
// 「trusted base SHA が recorder HEAD から到達可能であること」へ置き換えた（default branch が
// 進むたびに他 PR のゲートが止まる欠陥の是正）。本 Issue はその判定を弱めず、到達不能な
// trusted base SHA を拒否し続けることを固定する。
test('submit-evidence: trusted base SHAがrecorder HEADから到達不能なら拒否する（AC-4）', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${harness.baseSha}` },
  });
  fs.writeFileSync(path.join(harness.repoDir, 'advanced.txt'), 'newer default branch commit\n');
  git(harness.repoDir, ['add', 'advanced.txt']);
  git(harness.repoDir, ['commit', '-m', 'test: advance protected base worktree']);

  // recorder が default branch 上で前進しただけの状態は拒否しない（Issue #703）。
  const advanced = harness.submit();
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.equal(harness.postedReviews().length, 1);

  // default branch から到達できない SHA を trusted base とする実行は拒否し続ける。
  const unreachable = harness.submitWithBase(harness.targetSha);
  assert.notEqual(unreachable.status, 0);
  assert.match(unreachable.stderr, /trusted base SHAがrecorder HEADから到達不能です/);
  assert.equal(harness.postedReviews().length, 1, '拒否時に証跡を増やさないこと');
});

test('submit-evidence: Issue worktreeのcandidate recorderからは投稿できない（AC-4）', (t) => {
  const harness = createHarness({ selfPackage: true });
  const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-candidate-recorder-'));
  t.after(() => {
    harness.cleanup();
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  });
  const issueWorktree = path.join(worktreeParent, 'issue');
  execFileSync('git', ['worktree', 'add', '--quiet', '--detach', issueWorktree, harness.targetSha], {
    cwd: harness.repoDir,
    stdio: 'pipe',
  });
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${harness.baseSha}` },
  });

  const result = harness.submitFrom(issueWorktree);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Issue worktreeのcandidate recorderからevidenceを投稿できません/);
  assert.deepEqual(harness.postedReviews(), []);
});

// Issue #759 要件7(c) / AC-13: 調達元識別子と実体 digest の記録を必須とする対象は
// 「本要件の充足によって新規に投稿される証跡」に限る。したがって、証跡形式（DESIGN E8 が
// 後方互換のため任意フィールドとした側）ではなく記録経路の側で必須性が担保されていなければ
// ならない。以下は「調達情報なしの証跡が新規に投稿される」経路が存在しないことを固定する。
test('submit-evidence: 調達情報を欠くlauncher tokenでは証跡を新規投稿できない（要件7(c), AC-13）', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());

  const malformed: Record<string, unknown>[] = [
    // procurement 自体が無い。
    { trusted_root: packageRoot() },
    // mode が未登録値。
    { trusted_root: packageRoot(), procurement: { mode: 'unknown', source: 'x' } },
    // 調達元識別子が空値。
    { trusted_root: packageRoot(), procurement: { mode: 'clone_build', source: '' } },
    // package_copy なのに実体 digest が無い。
    { trusted_root: packageRoot(), procurement: { mode: 'package_copy', source: 'candidate-a:/tmp/x#agent-skill-chain@1.0.0' } },
    // digest の形式が不正。
    {
      trusted_root: packageRoot(),
      procurement: { mode: 'package_copy', source: 'candidate-a:/tmp/x#agent-skill-chain@1.0.0', digest: 'sha256:zz' },
    },
  ];

  for (const token of malformed) {
    harness.writeToken(token);
    const result = harness.submit();
    assert.notEqual(result.status, 0, JSON.stringify(token));
    assert.match(result.stderr, /launcher tokenがattempt\/run\/slot契約と一致しないか既に消費済みです/);
    assert.deepEqual(harness.postedReviews(), [], JSON.stringify(token));
  }
});

test('submit-evidence: 新規に投稿される証跡には必ず調達元識別子が非空値で記録される（要件7(c), AC-13(i)）', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${harness.baseSha}` },
  });

  const result = harness.submit();

  assert.equal(result.status, 0, result.stderr);
  const reviews = harness.postedReviews();
  assert.equal(reviews.length, 1);
  const evidence = parseReviewEvidence(reviews[0].body) as ReviewEvidence;
  const procurement = evidence.execution.procurement;
  assert.ok(procurement, '新規投稿の証跡は調達の事実を必ず持つこと');
  assert.equal(procurement.mode, 'clone_build');
  assert.equal(procurement.source, `clone_build:${harness.baseSha}`);
  assert.ok(procurement.source.length > 0);
});
