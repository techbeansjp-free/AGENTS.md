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
import { evidencePromptDigest } from '../../src/lib/review-evidence.js';
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
  postedReviews(): unknown[];
  submit(): { status: number; stdout: string; stderr: string };
  submitFrom(cwd: string): { status: number; stdout: string; stderr: string };
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
      return stub.readState().pullReviews ?? [];
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

// Issue #759 AC-4 / PLAN #8: 準備段の変更で既存の拒否経路が失われていないことを、
// SPEC.md「実地確認した事実」が原文引用した3メッセージそのもので固定する。
test('submit-evidence: recorder HEADがtrusted base SHAと一致しなければ拒否する（AC-4）', (t) => {
  const harness = createHarness({ selfPackage: true });
  t.after(() => harness.cleanup());
  harness.writeToken({
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${harness.baseSha}` },
  });
  fs.writeFileSync(path.join(harness.repoDir, 'advanced.txt'), 'newer default branch commit\n');
  git(harness.repoDir, ['add', 'advanced.txt']);
  git(harness.repoDir, ['commit', '-m', 'test: advance protected base worktree']);

  const result = harness.submit();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recorder HEADがtrusted base SHAと一致しません/);
  assert.deepEqual(harness.postedReviews(), []);
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
