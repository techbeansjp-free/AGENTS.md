import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGhStub } from '../helpers/gh-stub.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

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
  setPullBase(baseSha: string): void;
  repositoryDispatches(): unknown[];
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
  fs.mkdirSync(npmBin);
  fs.writeFileSync(
    path.join(npmBin, 'npm'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ASC_TEST_NPM_TRACE"\n',
    { mode: 0o755 },
  );

  const scriptsDir = path.join(repo.dir, '.agent-skill-chain', 'scripts');
  fs.writeFileSync(
    path.join(scriptsDir, 'gate-review.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "gate_report_path: %s/review.yaml\\n" "$PWD"\nprintf "review_profile: standard\\n"\n',
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
  git(repo.dir, ['add', '.agent-skill-chain/scripts/gate-review.sh', '.agent-skill-chain/scripts/gate-launch-reviewer.sh']);
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
    setPullBase,
    repositoryDispatches() {
      return stub.readState().repositoryDispatches ?? [];
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

test('gate-local-review: default branch HEADがbase_shaより前進していてもbase_shaの隔離cloneで実行する', (t) => {
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
  assert.deepEqual(fixture.repositoryDispatches(), [{
    event_type: 'agent-skill-chain-gate-record',
    client_payload: {
      pr_number: 652,
      gate: 'implementation',
      target_sha: fixture.targetSha,
    },
  }]);
});

test('gate-local-review: default branch以外のworktreeでは隔離clone作成前に拒否する', (t) => {
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

test('gate-local-review: base_shaがdefault branchから到達不能なら隔離clone作成前に拒否する', (t) => {
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
