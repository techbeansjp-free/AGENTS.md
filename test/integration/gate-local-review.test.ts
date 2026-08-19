import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGhStub } from '../helpers/gh-stub.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { canonicalTreeDigest } from '../../src/lib/tree-digest.js';
import { TRUSTED_CLI_MARKER_SCHEMA } from '../../src/lib/trusted-cli-marker.js';
import { evidencePromptDigest, parseReviewEvidence, type ReviewEvidence } from '../../src/lib/review-evidence.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// npm 代替コマンド。呼び出しを記録し、consumer 側の依存導入・build script の失敗を再現する。
// 準備段が consumer の依存導入・build を起動しないこと（AC-1・AC-2・AC-9）は、この記録と
// 痕跡ファイルの不在で観測する。
const NPM_STUB = [
  '#!/bin/sh',
  'printf "%s\\n" "$*" >> "$ASC_TEST_NPM_TRACE"',
  'case "$1" in',
  '  ci|install)',
  '    if [ -n "${ASC_TEST_NPM_INSTALL_FAILS:-}" ]; then exit 1; fi',
  '    ;;',
  '  run)',
  '    if [ "$2" = "build" ] && [ -n "${ASC_TEST_BUILD_TRACE_NAME:-}" ]; then',
  '      : > "$PWD/$ASC_TEST_BUILD_TRACE_NAME"',
  '      exit 1',
  '    fi',
  '    ;;',
  '  root)',
  '    if [ "$2" = "-g" ]; then printf "%s\\n" "${ASC_TEST_NPM_GLOBAL_ROOT:-}"; fi',
  '    ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

const GATE_REVIEW_STUB = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'printf "trusted_cli_root_at_gate_review=%s\\n" "${ASC_TRUSTED_CLI_ROOT:-}" >> "$ASC_TEST_REVIEW_TRACE"',
  'printf "gate_report_path: %s/review.yaml\\n" "$PWD"',
  'printf "review_profile: standard\\n"',
  '',
].join('\n');

// レビュア起動段の観測点。解決元（AC-3）・remote 不在（AC-11）・実行された CLI 実体（AC-10）を
// 実行時の値として記録し、必要なら実際に証跡を投稿する（AC-13(i)・AC-14）。
const GATE_LAUNCH_REVIEWER_STUB = [
  '#!/usr/bin/env bash',
  'set -uo pipefail',
  'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
  'REVIEW_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"',
  '{',
  '  printf "review_root=%s\\n" "$REVIEW_ROOT"',
  '  printf "launcher_script=%s\\n" "${BASH_SOURCE[0]}"',
  '  printf "adapters_dir=%s\\n" "$REVIEW_ROOT/.agent-skill-chain/adapters"',
  '  printf "head=%s\\n" "$(git -C "$REVIEW_ROOT" rev-parse HEAD)"',
  '  printf "remotes=%s\\n" "$(git -C "$REVIEW_ROOT" remote)"',
  '  printf "trusted_base=%s\\n" "$ASC_TRUSTED_BASE_SHA"',
  '  printf "trusted_cli_root=%s\\n" "${ASC_TRUSTED_CLI_ROOT:-}"',
  '} >> "$ASC_TEST_REVIEW_TRACE"',
  'if [[ -n "${ASC_TEST_RESOLVE_CLI:-}" ]]; then',
  '  source "$REVIEW_ROOT/.agent-skill-chain/scripts/cli-resolve.sh"',
  '  if ! asc_resolve_cli; then',
  '    printf "cli_resolve=failed\\n" >> "$ASC_TEST_REVIEW_TRACE"',
  '    exit 1',
  '  fi',
  '  printf "cli=%s\\n" "${ASC_CLI[*]}" >> "$ASC_TEST_REVIEW_TRACE"',
  '  if [[ -n "${ASC_TEST_SUBMIT_EVIDENCE:-}" ]]; then',
  '    if printf "%s" "$ASC_TEST_VERDICT" | "${ASC_CLI[@]}" gate submit-evidence \\',
  '      "$1" "$2" "$3" "$5" "$ASC_EVIDENCE_BASE_SHA" "$ASC_TRUSTED_BASE_SHA" "$ASC_EVIDENCE_PR_NUMBER" \\',
  '      "$ASC_REVIEW_ATTEMPT_ID" "$ASC_REVIEW_EXPECTED_COUNT" "$ASC_REVIEWER_RUN_ID" "$ASC_REVIEWER_SLOT" \\',
  '      human human manual "$ASC_TEST_PROMPT_DIGEST" >> "$ASC_TEST_REVIEW_TRACE" 2>&1; then',
  '      printf "submit=ok\\n" >> "$ASC_TEST_REVIEW_TRACE"',
  '    else',
  '      printf "submit=failed\\n" >> "$ASC_TEST_REVIEW_TRACE"',
  '      exit 1',
  '    fi',
  '  fi',
  'fi',
  'rm -f -- "$ASC_LAUNCHER_TOKEN_FILE"',
  '',
].join('\n');

/** 実行されたら痕跡を残すだけの非正規 CLI 実体（AC-10 の「実行されないこと」を観測するため）。 */
function writeForeignCli(file: string, label: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(label)} >> "$ASC_TEST_FOREIGN_TRACE"\nexit 0\n`,
    { mode: 0o755 },
  );
}

/**
 * consumer が導入時に用いた配布パッケージ相当（npm 導入形状の agent-skill-chain）を作る。
 * 本物の CLI 実体を含むため、隔離 clone 配下へ調達されたあとは実際に verdict を証跡へ投稿できる。
 */
function createDistributedPackage(packageDir: string): void {
  fs.mkdirSync(packageDir, { recursive: true });
  fs.cpSync(path.join(packageRoot, 'bin'), path.join(packageDir, 'bin'), { recursive: true });
  fs.cpSync(path.join(packageRoot, '.agent-skill-chain'), path.join(packageDir, '.agent-skill-chain'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-skill-chain',
        version: '0.0.0-distributed',
        bin: { 'agent-skill-chain': './bin/agents-md.js' },
      },
      null,
      2,
    )}\n`,
  );
  // 依存モジュールの実体は隔離 clone 配下へ複製しない設計のため、導入形状と同じく
  // パッケージの隣（同じ node_modules 直下）へ実体への参照だけを置く。
  const parent = path.dirname(packageDir);
  for (const entry of fs.readdirSync(path.join(packageRoot, 'node_modules'))) {
    if (entry.startsWith('.')) continue;
    const link = path.join(parent, entry);
    if (fs.existsSync(link)) continue;
    fs.symlinkSync(path.join(packageRoot, 'node_modules', entry), link);
  }
}

interface ConsumerOptions {
  supply?: 'node_modules' | 'path' | 'none' | 'cache_only';
  tamper?: boolean;
  consumerNode?: 'none' | 'failing_build' | 'failing_install';
  trackNodeModules?: boolean;
  foreignEntities?: boolean;
  resolveCli?: boolean;
  submitEvidence?: boolean;
  omitMarker?: boolean;
}

interface Fixture {
  repoDir: string;
  env: NodeJS.ProcessEnv;
  baseSha: string;
  targetSha: string;
  reviewTrace: string;
  npmTrace: string;
  foreignTrace: string;
  buildTraceName: string;
  npmTraceLines(): string[];
  reviewTraceText(): string;
  foreignTraceText(): string;
  postedReviews(): { body: string }[];
  run(): { status: number; stdout: string; stderr: string };
  cleanup(): void;
}

function installReviewStubs(repoDir: string): void {
  const scriptsDir = path.join(repoDir, '.agent-skill-chain', 'scripts');
  fs.writeFileSync(path.join(scriptsDir, 'gate-review.sh'), GATE_REVIEW_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(scriptsDir, 'gate-launch-reviewer.sh'), GATE_LAUNCH_REVIEWER_STUB, { mode: 0o755 });
}

/** 自リポジトリ形状（agent-skill-chain 本体のソースと build 定義を持つ）の fixture。 */
function createSelfFixture(): Fixture & { mainHead: string; setPullBase(sha: string): void; repositoryDispatches(): unknown[] } {
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-local-review-test-'));
  const stub = createGhStub(scratchDir);
  const npmBin = path.join(scratchDir, 'npm-bin');
  const reviewTrace = path.join(scratchDir, 'review-trace.txt');
  const npmTrace = path.join(scratchDir, 'npm-trace.txt');
  const foreignTrace = path.join(scratchDir, 'foreign-trace.txt');
  fs.mkdirSync(npmBin);
  fs.writeFileSync(path.join(npmBin, 'npm'), NPM_STUB, { mode: 0o755 });

  installReviewStubs(repo.dir);
  git(repo.dir, ['add', '-A']);
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
    ASC_TEST_FOREIGN_TRACE: foreignTrace,
  });
  let currentPullBaseSha = baseSha;
  const setPullBase = (pullBaseSha: string): void => {
    currentPullBaseSha = pullBaseSha;
    const state = stub.readState();
    state.pullMetadata = { base: { ref: 'main', sha: pullBaseSha }, head: { sha: targetSha } };
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
    foreignTrace,
    buildTraceName: 'consumer-build-ran.txt',
    npmTraceLines() {
      return fs.existsSync(npmTrace) ? fs.readFileSync(npmTrace, 'utf8').trim().split('\n').filter(Boolean) : [];
    },
    reviewTraceText() {
      return fs.existsSync(reviewTrace) ? fs.readFileSync(reviewTrace, 'utf8') : '';
    },
    foreignTraceText() {
      return fs.existsSync(foreignTrace) ? fs.readFileSync(foreignTrace, 'utf8') : '';
    },
    postedReviews() {
      return (stub.readState().pullReviews ?? []) as { body: string }[];
    },
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
      return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
    cleanup() {
      repo.cleanup();
      fs.rmSync(scratchDir, { recursive: true, force: true });
    },
  };
}

/** consumer 形状（配布集合と導入マーカーだけを持ち、本体のソースもビルド定義も持たない）の fixture。 */
function createConsumerFixture(options: ConsumerOptions = {}): Fixture {
  const {
    supply = 'node_modules',
    tamper = false,
    consumerNode = 'none',
    trackNodeModules = false,
    foreignEntities = false,
    resolveCli = false,
    submitEvidence = false,
    omitMarker = false,
  } = options;

  const repo = createTmpRepo({ backend: 'github' });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-local-review-consumer-'));
  const stub = createGhStub(scratchDir);
  const npmBin = path.join(scratchDir, 'npm-bin');
  const pathDir = path.join(scratchDir, 'path-bin');
  const reviewTrace = path.join(scratchDir, 'review-trace.txt');
  const npmTrace = path.join(scratchDir, 'npm-trace.txt');
  const foreignTrace = path.join(scratchDir, 'foreign-trace.txt');
  const buildTraceName = 'consumer-build-ran.txt';
  fs.mkdirSync(npmBin);
  fs.mkdirSync(pathDir);
  fs.writeFileSync(path.join(npmBin, 'npm'), NPM_STUB, { mode: 0o755 });

  // 配布パッケージの実体を作り、その正準ツリー digest を導入マーカーの期待値にする。
  const sourceDir = path.join(scratchDir, 'distributed', 'node_modules', 'agent-skill-chain');
  createDistributedPackage(sourceDir);
  const expectedDigest = canonicalTreeDigest(sourceDir);

  if (supply === 'node_modules') {
    fs.cpSync(path.join(scratchDir, 'distributed', 'node_modules'), path.join(repo.dir, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
    });
  } else if (supply === 'path') {
    fs.symlinkSync(path.join(sourceDir, 'bin', 'agents-md.js'), path.join(pathDir, 'agent-skill-chain'));
  } else if (supply === 'cache_only') {
    // ローカルの package キャッシュにのみ配布物がある状態（node_modules 配下にも PATH 上にも実体が無い）。
    fs.cpSync(sourceDir, path.join(scratchDir, 'npm-cache', '_cacache', 'agent-skill-chain'), { recursive: true });
  }

  if (tamper) {
    const target =
      supply === 'node_modules'
        ? path.join(repo.dir, 'node_modules', 'agent-skill-chain', '.agent-skill-chain', 'config', 'roles.yaml')
        : path.join(sourceDir, '.agent-skill-chain', 'config', 'roles.yaml');
    fs.appendFileSync(target, '#');
  }

  if (foreignEntities) {
    writeForeignCli(path.join(repo.dir, 'node_modules', '.bin', 'agent-skill-chain'), 'node_modules-bin');
    writeForeignCli(path.join(pathDir, 'agent-skill-chain'), 'path-entry');
  }

  const gitignore = trackNodeModules ? '' : 'node_modules/\n';
  if (gitignore) fs.writeFileSync(path.join(repo.dir, '.gitignore'), gitignore);
  if (trackNodeModules) {
    fs.mkdirSync(path.join(repo.dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, 'node_modules', 'vendored.txt'), 'tracked dependency\n');
  }

  if (consumerNode !== 'none') {
    fs.writeFileSync(
      path.join(repo.dir, 'package.json'),
      `${JSON.stringify(
        { name: 'consumer-app', version: '1.0.0', private: true, scripts: { build: 'webpack --mode production' } },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(repo.dir, 'package-lock.json'),
      `${JSON.stringify({ name: 'consumer-app', lockfileVersion: 3, packages: {} }, null, 2)}\n`,
    );
  }

  if (!omitMarker) {
    fs.writeFileSync(
      path.join(repo.dir, '.agent-skill-chain', '.trusted-cli.json'),
      `${JSON.stringify(
        {
          schema_version: TRUSTED_CLI_MARKER_SCHEMA,
          package: 'agent-skill-chain',
          version: '0.0.0-distributed',
          tree_digest: expectedDigest,
        },
        null,
        2,
      )}\n`,
    );
  }
  // AC-7: consumer 形状は配布集合の外にある project 固有文書を必ずしも持たない。
  fs.rmSync(path.join(repo.dir, '.agent-skill-chain', 'project', 'MODEL_TIER_TABLE.md'), { force: true });

  installReviewStubs(repo.dir);
  git(repo.dir, ['add', '-A']);
  git(repo.dir, ['commit', '-m', 'test: consumer shape with distribution set only']);
  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);

  git(repo.dir, ['checkout', '-q', '-b', 'bugfix/759-review-target']);
  fs.writeFileSync(path.join(repo.dir, 'target.txt'), 'candidate\n');
  git(repo.dir, ['add', 'target.txt']);
  git(repo.dir, ['commit', '-m', 'test: add review target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-q', 'main']);

  const env = stub.env({
    ...process.env,
    PATH: `${pathDir}${path.delimiter}${npmBin}${path.delimiter}${process.env.PATH}`,
    ASC_TEST_NPM_TRACE: npmTrace,
    ASC_TEST_REVIEW_TRACE: reviewTrace,
    ASC_TEST_FOREIGN_TRACE: foreignTrace,
    ...(consumerNode === 'failing_build' ? { ASC_TEST_BUILD_TRACE_NAME: buildTraceName } : {}),
    ...(consumerNode === 'failing_install' ? { ASC_TEST_NPM_INSTALL_FAILS: '1' } : {}),
    ...(resolveCli ? { ASC_TEST_RESOLVE_CLI: '1' } : {}),
    ...(submitEvidence
      ? {
          ASC_TEST_SUBMIT_EVIDENCE: '1',
          ASC_TEST_PROMPT_DIGEST: evidencePromptDigest('gate-local-review consumer fixture prompt'),
          ASC_TEST_VERDICT: JSON.stringify({
            conformance: 'pass',
            falsification: 'pass',
            blockers: [],
            approved_artifacts: [{ path: 'target.txt' }],
            inconclusive: false,
          }),
        }
      : {}),
  });

  const state = stub.readState();
  state.pullMetadata = {
    number: 764,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'bugfix/759-review-target' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{ author: { login: 'adachi-tatsuru' }, committer: { login: 'adachi-tatsuru' } }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);

  return {
    repoDir: repo.dir,
    env,
    baseSha,
    targetSha,
    reviewTrace,
    npmTrace,
    foreignTrace,
    buildTraceName,
    npmTraceLines() {
      return fs.existsSync(npmTrace) ? fs.readFileSync(npmTrace, 'utf8').trim().split('\n').filter(Boolean) : [];
    },
    reviewTraceText() {
      return fs.existsSync(reviewTrace) ? fs.readFileSync(reviewTrace, 'utf8') : '';
    },
    foreignTraceText() {
      return fs.existsSync(foreignTrace) ? fs.readFileSync(foreignTrace, 'utf8') : '';
    },
    postedReviews() {
      return (stub.readState().pullReviews ?? []) as { body: string }[];
    },
    run() {
      const result = spawnSync(
        path.join(repo.dir, '.agent-skill-chain', 'scripts', 'gate-local-review.sh'),
        ['ISSUE-759', 'implementation', 'standard', targetSha, baseSha, '764', 'human'],
        { cwd: repo.dir, env, encoding: 'utf8' },
      );
      if (result.error) throw result.error;
      return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
    cleanup() {
      repo.cleanup();
      fs.rmSync(scratchDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// PLAN #8: 自リポジトリ形状（clone_build 経路）
// ---------------------------------------------------------------------------

test('gate-local-review: 自リポジトリ形状ではclone_build経路で従来どおりbuildし、隔離cloneのremoteが空である（AC-3, AC-4, AC-6, AC-11 / Issue #703 AC-9）', (t) => {
  const fixture = createSelfFixture();
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
  assert.deepEqual(fixture.npmTraceLines(), ['ci --ignore-scripts', 'run build']);
  const trace = fixture.reviewTraceText();
  assert.match(trace, new RegExp(`head=${fixture.baseSha}`));
  assert.match(trace, /remotes=\n/, '隔離cloneに登録remoteが1件も無いこと');
  assert.match(trace, new RegExp(`trusted_base=${fixture.baseSha}`));
  // AC-3: レビュア起動スクリプトと adapter の解決元が隔離 clone であること。
  assert.match(trace, /review_root=.*agent-skill-chain-local-review\.[^/]+\/repo/);
  assert.match(trace, /launcher_script=.*agent-skill-chain-local-review\.[^/]+\/repo\/\.agent-skill-chain\/scripts\//);
  assert.match(trace, /adapters_dir=.*agent-skill-chain-local-review\.[^/]+\/repo\/\.agent-skill-chain\/adapters/);
  assert.match(trace, /trusted_cli_root=.*agent-skill-chain-local-review\.[^/]+\/repo/);
  assert.match(trace, /trusted_cli_root_at_gate_review=.*agent-skill-chain-local-review\.[^/]+\/repo/);
  assert.deepEqual(fixture.repositoryDispatches(), []);
});

test('gate-local-review: default branch以外のworktreeでは隔離clone作成前に拒否する（AC-4 / Issue #703 AC-9）', (t) => {
  const fixture = createSelfFixture();
  t.after(() => fixture.cleanup());
  git(fixture.repoDir, ['checkout', 'bugfix/643-review-target']);

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository default branchのworktreeから実行してください/);
  assert.doesNotMatch(result.stderr, /expected=/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

test('gate-local-review: base_shaがdefault branchから到達不能なら隔離clone作成前に拒否する（AC-4 / Issue #703 AC-9）', (t) => {
  const fixture = createSelfFixture();
  t.after(() => fixture.cleanup());
  fixture.setPullBase(fixture.targetSha);

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /指定base_shaはrepository default branchから到達不能です/);
  assert.doesNotMatch(result.stderr, /expected=/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

test('gate-local-review: protected base worktreeがdirtyなら引き続き拒否する（AC-4）', (t) => {
  const fixture = createSelfFixture();
  t.after(() => fixture.cleanup());
  fs.writeFileSync(path.join(fixture.repoDir, 'uncommitted.txt'), 'dirty\n');

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protected base worktreeがdirtyです/);
  assert.equal(fs.existsSync(fixture.npmTrace), false, '拒否後に隔離cloneのbuildへ進まないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false, '拒否後にreviewerを起動しないこと');
});

// ---------------------------------------------------------------------------
// PLAN #9: consumer 形状（package_copy 経路）
// ---------------------------------------------------------------------------

test('gate-local-review: package.jsonもlockfileも持たないconsumerで準備段が成立する（AC-1, AC-14）', (t) => {
  const fixture = createConsumerFixture({ resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  const npmCalls = fixture.npmTraceLines();
  assert.equal(npmCalls.includes('ci --ignore-scripts'), false, 'consumerの依存導入を起動しないこと');
  assert.equal(npmCalls.includes('run build'), false, 'consumerのbuildを起動しないこと');
  const trace = fixture.reviewTraceText();
  assert.match(trace, /review_root=.*agent-skill-chain-local-review\.[^/]+\/repo/);
  assert.match(trace, /remotes=\n/);
  // AC-10: 実行された CLI 実体が隔離 clone のディレクトリ配下にあること。
  assert.match(trace, /cli=.*agent-skill-chain-local-review\.[^/]+\/repo\/node_modules\/\.bin\/agent-skill-chain/);
});

test('gate-local-review: consumerのbuild scriptを起動せず痕跡も残さない（AC-2, AC-14）', (t) => {
  const fixture = createConsumerFixture({ consumerNode: 'failing_build', resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  assert.equal(fixture.npmTraceLines().includes('run build'), false);
  const trustedRoot = /review_root=(\S+)/.exec(fixture.reviewTraceText())?.[1];
  assert.ok(trustedRoot, 'レビュア起動段へ到達していること');
  assert.equal(
    fs.existsSync(path.join(trustedRoot, fixture.buildTraceName)),
    false,
    'build scriptの痕跡ファイルが隔離clone内に生じないこと（終了コードの握り潰しでは充足しない）',
  );
});

test('gate-local-review: consumerの依存導入が必ず失敗する構成でも準備段が成立する（AC-9, AC-14）', (t) => {
  const fixture = createConsumerFixture({ consumerNode: 'failing_install', resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  const npmCalls = fixture.npmTraceLines();
  assert.equal(npmCalls.includes('ci --ignore-scripts'), false);
  assert.equal(npmCalls.includes('install'), false);
  assert.match(fixture.reviewTraceText(), /review_root=.*agent-skill-chain-local-review\./);
});

test('gate-local-review: 隔離clone外の非正規実体は実行されず隔離clone配下の実体だけが実行される（AC-3, AC-10）', (t) => {
  const fixture = createConsumerFixture({ foreignEntities: true, resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  const trace = fixture.reviewTraceText();
  assert.match(trace, /cli=.*agent-skill-chain-local-review\.[^/]+\/repo\/node_modules\/\.bin\/agent-skill-chain/);
  assert.equal(trace.includes(fixture.repoDir + '/node_modules/.bin/agent-skill-chain'), false);
  assert.equal(fixture.foreignTraceText(), '', '隔離clone外の2実体がいずれも実行されないこと');
  // AC-3: 起動スクリプトと adapter の解決元が隔離 clone 配下であること（consumer 形状でも確認する）。
  assert.match(trace, /launcher_script=.*agent-skill-chain-local-review\.[^/]+\/repo\/\.agent-skill-chain\/scripts\//);
  assert.match(trace, /adapters_dir=.*agent-skill-chain-local-review\.[^/]+\/repo\/\.agent-skill-chain\/adapters/);
});

test('gate-local-review: 調達元の実体を1バイト改変するとレビュアを起動せず証跡も投稿しない（AC-13(ii)）', (t) => {
  const fixture = createConsumerFixture({ tamper: true, resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /調達候補の完全性検証に失敗しました/);
  assert.match(result.stderr, /探索した候補と探索先:/);
  assert.equal(fs.existsSync(fixture.reviewTrace), false, 'レビュアを起動しないこと');
  assert.deepEqual(fixture.postedReviews(), [], '証跡を投稿しないこと');
});

test('gate-local-review: 供給元が存在しない実行環境では探索した候補と探索先を全件示して非0終了する（AC-5）', (t) => {
  const fixture = createConsumerFixture({ supply: 'none', resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /信頼実行コードの供給元が実行環境に存在しません/);
  assert.match(result.stderr, /是正: 配布パッケージ agent-skill-chain@0\.0\.0-distributed を/);
  assert.match(result.stderr, /\(a\) protected base worktree root 直下の依存ディレクトリ:/);
  assert.match(result.stderr, /\(b\) npm root -g が返すディレクトリ配下:/);
  assert.match(result.stderr, /\(c\) PATH上の実行ファイルから辿るパッケージ root:/);
  assert.equal(fs.existsSync(fixture.reviewTrace), false, 'レビュアを起動しないこと');
  assert.deepEqual(fixture.postedReviews(), []);
});

test('gate-local-review: ローカルpackageキャッシュにのみ配布物がある実行環境は供給元なしとして扱う（AC-5）', (t) => {
  const fixture = createConsumerFixture({ supply: 'cache_only', resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /信頼実行コードの供給元が実行環境に存在しません/);
  assert.equal(result.stderr.includes('_cacache'), false, 'キャッシュ構造を候補として扱わないこと');
  assert.equal(fs.existsSync(fixture.reviewTrace), false);
});

test('gate-local-review: 導入マーカーがbase SHAに無ければ調達せず是正手段を示して非0終了する（AC-5）', (t) => {
  const fixture = createConsumerFixture({ omitMarker: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /信頼実行コードの期待値（\.agent-skill-chain\/\.trusted-cli\.json）がbase SHAのコミット内容にありません/);
  assert.match(result.stderr, /是正: upgrade を実行し/);
  assert.equal(fs.existsSync(fixture.reviewTrace), false);
});

test('gate-local-review: PATH上の実体からも調達でき、node_modules/をtrackしないconsumerで隔離cloneがdirtyにならない（AC-14）', (t) => {
  const fixture = createConsumerFixture({ supply: 'path', resolveCli: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  assert.equal(fixture.npmTraceLines().includes('root -g'), true, '候補(b)の所在問い合わせは導入でもbuildでもない');
  assert.equal(fixture.npmTraceLines().includes('ci --ignore-scripts'), false);
  assert.match(fixture.reviewTraceText(), /cli=.*agent-skill-chain-local-review\.[^/]+\/repo\/node_modules\/\.bin\/agent-skill-chain/);
});

test('gate-local-review: base SHAがnode_modules/をtrackしている場合は調達へ進まず停止する', (t) => {
  const fixture = createConsumerFixture({ supply: 'path', trackNodeModules: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /base SHAが node_modules\/ 配下をtrackしているため信頼実行環境を用意できません/);
  assert.equal(fs.existsSync(fixture.reviewTrace), false, 'レビュアを起動しないこと');
  assert.deepEqual(fixture.postedReviews(), []);
});

test('gate-local-review: consumer形状でレビュア起動段へ到達し、調達元と実体digestを含む証跡が投稿される（AC-7, AC-13(i), AC-14）', (t) => {
  const fixture = createConsumerFixture({ resolveCli: true, submitEvidence: true });
  t.after(() => fixture.cleanup());

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());
  assert.match(fixture.reviewTraceText(), /submit=ok/);
  const reviews = fixture.postedReviews();
  assert.equal(reviews.length, 1, '証跡が投稿されること');
  const evidence = parseReviewEvidence(reviews[0].body) as ReviewEvidence;

  // AC-7: consumer 形状（.agent-skill-chain/project/MODEL_TIER_TABLE.md を持たない）でも execution が埋まる。
  assert.equal(evidence.execution.trusted_base_sha, fixture.baseSha);
  assert.match(evidence.execution.launcher_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.execution.isolation, 'ephemeral_clone');

  // AC-13(i): 調達元の識別子と調達した実体の digest が非空値で記録される。
  const procurement = evidence.execution.procurement;
  assert.ok(procurement, 'execution.procurement が記録されること');
  assert.equal(procurement.mode, 'package_copy');
  assert.equal(typeof procurement.source, 'string');
  assert.ok(procurement.source.length > 0, '調達元識別子が非空値であること');
  assert.match(procurement.source, /^candidate-[abc]:.+#agent-skill-chain@0\.0\.0-distributed$/);
  assert.equal(typeof procurement.digest, 'string');
  assert.ok((procurement.digest ?? '').length > 0, '調達実体のdigestが非空値であること');
  assert.match(procurement.digest ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('gate-local-review: prompt生成が読み込むassetの解決元が審査対象でない（AC-15）', (t) => {
  const fixture = createConsumerFixture({ resolveCli: true, submitEvidence: true });
  t.after(() => fixture.cleanup());
  const assetTrace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asc-asset-trace-')), 'assets.txt');
  t.after(() => fs.rmSync(path.dirname(assetTrace), { recursive: true, force: true }));

  // Issue worktree（target SHA の作業ツリー）側に、同一相対パスの改変 asset を置いた状態を作る。
  // linked worktree として登録する（調達候補の所在による除外規則も同時に効く状態にする）。
  // 撤去は fixture.cleanup（repo 自体の削除）に委ね、ここではディレクトリだけを片付ける。
  const issueWorktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-issue-worktree-'));
  const issueWorktree = path.join(issueWorktreeParent, 'issue');
  t.after(() => fs.rmSync(issueWorktreeParent, { recursive: true, force: true }));
  execFileSync('git', ['worktree', 'add', '--quiet', '--detach', issueWorktree, fixture.targetSha], {
    cwd: fixture.repoDir,
    stdio: 'pipe',
  });
  const tamperedMarker = '# ISSUE-WORKTREE-TAMPERED-ASSET-MARKER';
  const issueRoles = path.join(issueWorktree, '.agent-skill-chain', 'config', 'roles.yaml');
  fs.appendFileSync(issueRoles, `\n${tamperedMarker}\n`);

  const result = spawnSync(
    path.join(fixture.repoDir, '.agent-skill-chain', 'scripts', 'gate-local-review.sh'),
    ['ISSUE-759', 'implementation', 'standard', fixture.targetSha, fixture.baseSha, '764', 'human'],
    { cwd: fixture.repoDir, env: { ...fixture.env, ASC_ASSET_TRACE_FILE: assetTrace }, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr + fixture.reviewTraceText());

  const resolved = fs.readFileSync(assetTrace, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(resolved.length > 0, '解決されたassetのパスが観測できること');
  // AC-15 連言の第1項: 解決された各 asset のパスがいずれも Issue worktree 配下でないこと。
  for (const entry of resolved) {
    assert.equal(entry.startsWith(issueWorktree + path.sep), false, `${entry} が Issue worktree 配下でないこと`);
  }
  // AC-15 連言の第2項: 生成された成果（証跡本文）に Issue worktree 側の改変内容が現れないこと。
  const reviews = fixture.postedReviews();
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].body.includes(tamperedMarker), false);
});
