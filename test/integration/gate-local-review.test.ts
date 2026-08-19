import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGhStub } from '../helpers/gh-stub.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { parseReviewAttemptStart } from '../../src/lib/review-evidence.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface Fixture {
  repoDir: string;
  env: NodeJS.ProcessEnv;
  baseSha: string;
  targetSha: string;
  mainHead: string;
  reviewTrace: string;
  npmTrace: string;
  reportPath: string;
  cliTrace: string;
  setPullBase(baseSha: string): void;
  failReviewApi(): void;
  repositoryDispatches(): unknown[];
  reviews(): unknown[];
  cliInvocations(): string[];
  run(): { status: number; stdout: string; stderr: string };
  cleanup(): void;
}

function createFixture(): Fixture {
  const repo = createTmpRepo({ backend: 'github' });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-local-review-test-'));
  const stub = createGhStub(scratchDir);
  const npmBin = path.join(scratchDir, 'npm-bin');
  const reviewTrace = path.join(scratchDir, 'review-trace.txt');
  const npmTrace = path.join(scratchDir, 'npm-trace.txt');
  const cliTrace = path.join(scratchDir, 'cli-trace.txt');
  const reportPath = path.join(scratchDir, 'gate-report.yaml');
  fs.mkdirSync(npmBin);
  fs.writeFileSync(
    path.join(npmBin, 'npm'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ASC_TEST_NPM_TRACE"\n',
    { mode: 0o755 },
  );

  const scriptsDir = path.join(repo.dir, '.agent-skill-chain', 'scripts');
  // scaffold は protected base worktree の外へ書く（共有worktreeを汚さないため）。
  // 実物と同じく conformance/falsification/final がすべて pending の状態で生成する。
  fs.writeFileSync(
    path.join(scriptsDir, 'gate-review.sh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'cat > "$ASC_TEST_REPORT_PATH" <<YAML',
      'schema_version: agent-skill-chain/gate-report/v1',
      'gate:',
      '  id: $2',
      '  target_sha: $4',
      '  conformance: pending',
      '  falsification: pending',
      '  final: pending',
      'YAML',
      'printf "gate_report_path: %s\\n" "$ASC_TEST_REPORT_PATH"',
      'printf "review_profile: standard\\n"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(scriptsDir, 'gate-launch-reviewer.sh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
      'REVIEW_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"',
      '{',
      '  printf "review_root=%s\\n" "$REVIEW_ROOT"',
      '  printf "head=%s\\n" "$(git -C "$REVIEW_ROOT" rev-parse HEAD)"',
      '  printf "remotes=%s\\n" "$(git -C "$REVIEW_ROOT" remote)"',
      '  printf "trusted_base=%s\\n" "$ASC_TRUSTED_BASE_SHA"',
      '} >> "$ASC_TEST_REVIEW_TRACE"',
      'rm -f -- "$ASC_LAUNCHER_TOKEN_FILE"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  // 隔離clone内のCLI実体。gate-local-review.sh のフェイルセーフはこれを起動する。
  // 追跡対象にしておくことで clone 後の dirty 判定に掛からない。
  fs.mkdirSync(path.join(repo.dir, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, 'bin', 'agents-md.js'),
    [
      "const fs = require('node:fs');",
      'const argv = process.argv.slice(2);',
      "fs.appendFileSync(process.env.ASC_TEST_CLI_TRACE, process.argv[1] + ' :: ' + argv.join(' ') + '\\n');",
      "if (argv[0] === 'gate' && argv[1] === 'mark-human-required') {",
      '  const target = argv[2];',
      "  const text = fs.readFileSync(target, 'utf8');",
      "  fs.writeFileSync(target, text.replace(/^([ \\t]*final:).*$/m, '$1 human_required'));",
      '}',
      '',
    ].join('\n'),
  );
  git(repo.dir, [
    'add',
    '.agent-skill-chain/scripts/gate-review.sh',
    '.agent-skill-chain/scripts/gate-launch-reviewer.sh',
    'bin/agents-md.js',
  ]);
  git(repo.dir, ['commit', '-m', 'test: install isolated review stubs']);
  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);

  git(repo.dir, ['checkout', '-b', 'bugfix/643-review-target']);
  fs.writeFileSync(path.join(repo.dir, 'target.txt'), 'candidate\n');
  git(repo.dir, ['add', 'target.txt']);
  git(repo.dir, ['commit', '-m', 'test: add review target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);
  fs.writeFileSync(path.join(repo.dir, 'main-advanced.txt'), 'newer default branch commit\n');
  git(repo.dir, ['add', 'main-advanced.txt']);
  git(repo.dir, ['commit', '-m', 'test: advance protected base worktree']);
  const mainHead = git(repo.dir, ['rev-parse', 'HEAD']);

  const env = stub.env({
    ...process.env,
    PATH: `${npmBin}${path.delimiter}${process.env.PATH}`,
    ASC_TEST_NPM_TRACE: npmTrace,
    ASC_TEST_REVIEW_TRACE: reviewTrace,
    ASC_TEST_CLI_TRACE: cliTrace,
    ASC_TEST_REPORT_PATH: reportPath,
  });
  let currentPullBaseSha = baseSha;
  const setPullBase = (pullBaseSha: string): void => {
    currentPullBaseSha = pullBaseSha;
    const state = stub.readState();
    state.pullMetadata = {
      base: { ref: 'main', sha: pullBaseSha },
      head: { sha: targetSha },
    };
    stub.writeState(state);
  };
  setPullBase(baseSha);

  return {
    repoDir: repo.dir,
    env,
    baseSha,
    targetSha,
    mainHead,
    reviewTrace,
    npmTrace,
    reportPath,
    cliTrace,
    setPullBase,
    failReviewApi() {
      stub.writeState({ ...stub.readState(), failApiPaths: ['/reviews'] });
    },
    repositoryDispatches() {
      return stub.readState().repositoryDispatches ?? [];
    },
    reviews() {
      return stub.readState().pullReviews ?? [];
    },
    cliInvocations() {
      if (!fs.existsSync(cliTrace)) return [];
      return fs.readFileSync(cliTrace, 'utf8').trim().split('\n').filter(Boolean);
    },
    run() {
      const result = spawnSync(
        path.join(repo.dir, '.agent-skill-chain', 'scripts', 'gate-local-review.sh'),
        ['ISSUE-643', 'implementation', 'standard', targetSha, currentPullBaseSha, '652', 'human'],
        { cwd: repo.dir, env, encoding: 'utf8' },
      );
      if (result.error) throw result.error;
      return {
        status: result.status ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    cleanup() {
      repo.cleanup();
      fs.rmSync(scratchDir, { recursive: true, force: true });
    },
  };
}

test('gate-local-review: default branch HEADがbase_shaより前進していてもbase_shaの隔離cloneで実行し、不要なdispatchを送らない（Issue #703 AC-9）', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const rootHeadBefore = git(fixture.repoDir, ['rev-parse', 'HEAD']);
  const rootRemoteBefore = git(fixture.repoDir, ['remote', '-v']);

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(rootHeadBefore, fixture.mainHead);
  assert.notEqual(rootHeadBefore, fixture.baseSha);
  assert.equal(git(fixture.repoDir, ['rev-parse', 'HEAD']), rootHeadBefore, '共有worktreeのHEADが変化しないこと');
  assert.equal(git(fixture.repoDir, ['remote', '-v']), rootRemoteBefore, '共有worktreeのremoteが変化しないこと');
  assert.equal(git(fixture.repoDir, ['status', '--porcelain']), '', '共有worktreeの内容が変化しないこと');
  assert.deepEqual(fs.readFileSync(fixture.npmTrace, 'utf8').trim().split('\n'), ['ci --ignore-scripts', 'run build']);
  const trace = fs.readFileSync(fixture.reviewTrace, 'utf8');
  assert.match(trace, new RegExp(`head=${fixture.baseSha}`));
  assert.match(trace, /remotes=\n/);
  assert.match(trace, new RegExp(`trusted_base=${fixture.baseSha}`));
  assert.match(trace, /review_root=.*agent-skill-chain-local-review\.[^/]+\/repo/);
  const reviews = fixture.reviews() as { body: string; commit_id: string }[];
  assert.equal(reviews.length, 1);
  const attempt = parseReviewAttemptStart(reviews[0].body);
  assert.ok(attempt);
  assert.equal(attempt.target_sha, fixture.targetSha);
  assert.equal(attempt.execution.trusted_base_sha, fixture.baseSha);
  assert.equal(attempt.expected_count, 1);
  assert.match(attempt.execution.launcher_token_digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(fixture.repositoryDispatches(), []);
  assert.deepEqual(fixture.cliInvocations(), [], '正常系でフェイルセーフを発火させないこと');
});

test('gate-local-review: default branch以外のworktreeでは隔離clone作成前に拒否する（Issue #703 AC-9）', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  git(fixture.repoDir, ['checkout', 'bugfix/643-review-target']);

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository default branchのworktreeから実行してください/);
  assert.doesNotMatch(result.stderr, /expected=/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

test('gate-local-review: base_shaがdefault branchから到達不能なら隔離clone作成前に拒否する（Issue #703 AC-9）', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  fixture.setPullBase(fixture.targetSha);

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /指定base_shaはrepository default branchから到達不能です/);
  assert.doesNotMatch(result.stderr, /expected=/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

test('gate-local-review: protected base worktreeがdirtyなら引き続き拒否する', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  fs.writeFileSync(path.join(fixture.repoDir, 'uncommitted.txt'), 'dirty\n');

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protected base worktreeがdirtyです/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

test('gate-local-review (ISSUE-733 AC-24): attempt記録POSTが非ゼロ終了してもgate-reportをpendingのまま残さない', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  // レビュアが示した到達経路: PR metadata検査・隔離clone・buildを通過した後、
  // レビュアループより前のattempt記録POSTだけがGitHub Review APIの一時障害で失敗する。
  fixture.failReviewApi();

  const result = fixture.run();

  assert.notEqual(result.status, 0, 'attempt記録を残せないまま成功終了しないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, 'attempt記録POST失敗後にレビュアを起動しないこと');
  assert.deepEqual(fixture.reviews(), [], 'attempt記録が投稿されていないこと');

  // AC-24 (a): レビュアが1体も起動されずverdictが存在しないattemptのfinalはhuman_requiredとして
  // 導出され、未導出（pending）のまま放置されない。
  const report = fs.readFileSync(fixture.reportPath, 'utf8');
  assert.match(report, /^\s*final: human_required$/m);
  assert.doesNotMatch(report, /^\s*final: pending$/m);
  assert.match(report, /^\s*conformance: pending$/m, 'sub-verdictは据え置くこと');

  const invocations = fixture.cliInvocations();
  assert.equal(invocations.length, 1);
  assert.match(
    invocations[0],
    new RegExp(`agent-skill-chain-local-review\\.[^/]+/repo/bin/agents-md\\.js :: gate mark-human-required ${fixture.reportPath}$`),
    'フェイルセーフは隔離clone内のCLIで実行すること',
  );
  assert.match(result.stderr, /human_required へ倒します/);
});
