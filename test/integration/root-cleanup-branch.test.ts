import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP, type TmpRepo } from '../helpers/tmp-repo.js';
import { runCli, binPath } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// ISSUE-798 / ADR-0080 の受入検証: `agent-skill-chain root-cleanup branch <issue_id>` という
// CLI経路そのもの（実git操作の配線）を、ビルド後の bin/agents-md.js を子プロセスとして実際に
// 実行することで検証する。git は実バイナリを使い、tmp-repo.ts が作る bare remote に対して
// 本物のpush/ls-remoteを行う（test/integration/root-cleanup.test.ts と同一のテスト方式）。

const ARTIFACTS = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'] as const;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeGhStub(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-root-cleanup-branch-'));
  const stub = createGhStub(scratchDir);
  return { env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

interface IssueFixture {
  branch: string;
  worktree: string;
}

function startIssue(repo: TmpRepo, issueId = 'ISSUE-798', env?: NodeJS.ProcessEnv): IssueFixture {
  const result = runCli(['issue', 'start', issueId, 'bugfix', 'root-artifact-cleanup', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  const [branch, worktree] = result.stdout.trim().split('\n');
  return { branch, worktree };
}

function writeArtifacts(worktree: string, files: readonly string[] = ARTIFACTS): void {
  for (const file of files) {
    fs.writeFileSync(path.join(worktree, file), `# ${file}\n\nISSUE-798 fixture\n`);
  }
}

function checkpoint(worktree: string, message: string, env?: NodeJS.ProcessEnv): string {
  const result = runCli(['checkpoint', message], { cwd: worktree, env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** 対象4ファイルをcommit・push済みにした、正常系の共通前提を作る。 */
function seedCommittedArtifacts(repo: TmpRepo, env?: NodeJS.ProcessEnv, issueId = 'ISSUE-798'): IssueFixture {
  const fixture = startIssue(repo, issueId, env);
  writeArtifacts(fixture.worktree);
  checkpoint(fixture.worktree, 'docs: add root segment artifacts', env);
  return fixture;
}

/** 先頭commitが削除したパスの一覧（削除以外の変更が混ざっていれば例外で落とす）。 */
function deletedPathsOf(worktree: string): string[] {
  const raw = git(worktree, ['show', '--no-renames', '--format=', '--name-status', 'HEAD']);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split('\t');
      assert.equal(status, 'D', `削除以外の変更が含まれています: ${line}`);
      return filePath;
    })
    .sort();
}

function remoteTip(repo: TmpRepo, branch: string): string {
  return git(repo.dir, ['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0] ?? '';
}

function remoteHasFile(repo: TmpRepo, ref: string, file: string): boolean {
  const probe = spawnSync('git', ['--git-dir', repo.remoteDir, 'cat-file', '-e', `${ref}:${file}`], { stdio: 'pipe' });
  return probe.status === 0;
}

/** 先頭commitに対する `verify root-clean` を、通常チェックアウトの独立clone上で実行する。 */
function verifyRootCleanOnBranchTip(repo: TmpRepo, branch: string, t: { after(fn: () => void): void }): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-clean-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--branch', branch, repo.remoteDir, dir], { stdio: 'pipe' });
  return runCli(['verify', 'root-clean'], { cwd: dir }).status;
}

function run(repo: TmpRepo, issueId = 'ISSUE-798', env?: NodeJS.ProcessEnv) {
  return runCli(['root-cleanup', 'branch', issueId], { cwd: repo.dir, env });
}

// ---- AC-3 / AC-9: 正常系 ----

test('root-cleanup branch (AC-3/AC-9): 削除のみのcommitを作りpushし、SHAを出力して終了コード0', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);

  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/, '作成したcommitのSHAを標準出力へ返すこと');
  assert.doesNotMatch(result.stdout, /no-op/);

  const head = git(fixture.worktree, ['rev-parse', 'HEAD']);
  assert.equal(result.stdout.trim(), head);

  // 作られたcommitは対象4ファイルの削除のみで構成される（追加行・他パスへの変更を含まない）。
  assert.deepEqual(deletedPathsOf(fixture.worktree), [...ARTIFACTS].sort());
  for (const line of git(fixture.worktree, ['show', '--format=', '--numstat', 'HEAD']).split('\n').filter(Boolean)) {
    assert.equal(line.split('\t')[0], '0', `追加行を含まないこと: ${line}`);
  }

  for (const file of ARTIFACTS) {
    assert.equal(fs.existsSync(path.join(fixture.worktree, file)), false, `${file} が作業ツリーから消えていること`);
    assert.equal(remoteHasFile(repo, fixture.branch, file), false, `${file} がremote先頭からも消えていること`);
  }
  assert.equal(remoteTip(repo, fixture.branch), head, 'remote先頭がlocal HEADと一致すること');
  assert.equal(verifyRootCleanOnBranchTip(repo, fixture.branch, t), 0, '既存のroot残存検査が終了コード0を返すこと');
});

test('root-cleanup branch (AC-3境界): 起動時点で作業ツリーから消えていてもno-opにならない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);

  // index へ未記録の削除（SPEC.md/DESIGN.md）と、index へ記録済みの削除（PLAN.md）を混在させる。
  fs.rmSync(path.join(fixture.worktree, 'SPEC.md'));
  fs.rmSync(path.join(fixture.worktree, 'DESIGN.md'));
  git(fixture.worktree, ['rm', '--quiet', '--', 'PLAN.md']);

  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
  assert.doesNotMatch(result.stdout, /no-op/);
  for (const file of ARTIFACTS) {
    assert.equal(remoteHasFile(repo, fixture.branch, file), false, `${file} がremote先頭から消えていること`);
  }
});

// ---- AC-5: no-op ----

test('root-cleanup branch (AC-5): 対象4ファイルが全て不在のときだけcommitもpushもせず終了コード0', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = startIssue(repo);
  fs.mkdirSync(path.join(fixture.worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'src', 'keep.ts'), 'export const keep = true;\n');
  const seeded = checkpoint(fixture.worktree, 'feat: add unrelated source');

  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-op/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), seeded, 'ブランチの先頭commitが変化しないこと');
  assert.equal(remoteTip(repo, fixture.branch), seeded);
  assert.equal(verifyRootCleanOnBranchTip(repo, fixture.branch, t), 0);
});

// ---- AC-4: 対象外のステージ済み変更 ----

test('root-cleanup branch (AC-4): 対象4ファイル以外がindexへ記録されているときはcommitせず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);

  fs.mkdirSync(path.join(fixture.worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'src', 'extra.ts'), 'export const extra = 1;\n');
  git(fixture.worktree, ['add', 'src/extra.ts']);
  const statusBefore = git(fixture.worktree, ['status', '--porcelain']);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /対象4ファイル以外/);
  assert.match(result.stderr, /src\/extra\.ts/);
  assert.equal(git(fixture.worktree, ['status', '--porcelain']), statusBefore, 'worktreeとindexが起動前から変化しないこと');
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(remoteTip(repo, fixture.branch), headBefore, 'pushが発生していないこと');
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true);
});

// ---- AC-6: 内容喪失リスクあり ----

test('root-cleanup branch (AC-6): 内容が変更された対象ファイルがあるときは削除せず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  fs.appendFileSync(path.join(fixture.worktree, 'DESIGN.md'), '未commitの追記\n');
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Gitから復元できない内容/);
  assert.match(result.stderr, /DESIGN\.md/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

test('root-cleanup branch (AC-6): 未追跡の対象ファイルがあるときは削除せず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = startIssue(repo);
  writeArtifacts(fixture.worktree, ['SPEC.md']);
  checkpoint(fixture.worktree, 'docs: add SPEC.md');
  // VALIDATION.md は未追跡のまま置く（Gitから復元できない内容）。
  writeArtifacts(fixture.worktree, ['VALIDATION.md']);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VALIDATION\.md/);
  assert.match(result.stderr, /未追跡/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'SPEC.md')), true, '他の対象ファイルも削除されないこと');
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'VALIDATION.md')), true);
});

// ---- AC-7: 対象外パスの非巻き込み ----

test('root-cleanup branch (AC-7): 対象外パスの未記録の変更・未追跡ファイルを巻き込まず実行後も保持する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = startIssue(repo);
  writeArtifacts(fixture.worktree);
  fs.mkdirSync(path.join(fixture.worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'src', 'tracked.ts'), 'export const v = 1;\n');
  checkpoint(fixture.worktree, 'docs: add artifacts and source');

  const modified = 'export const v = 2; // 未commitの変更\n';
  fs.writeFileSync(path.join(fixture.worktree, 'src', 'tracked.ts'), modified);
  fs.writeFileSync(path.join(fixture.worktree, 'scratch-note.txt'), '未追跡のメモ\n');

  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(deletedPathsOf(fixture.worktree), [...ARTIFACTS].sort());
  assert.equal(fs.readFileSync(path.join(fixture.worktree, 'src', 'tracked.ts'), 'utf8'), modified);
  assert.equal(fs.readFileSync(path.join(fixture.worktree, 'scratch-note.txt'), 'utf8'), '未追跡のメモ\n');
  assert.equal(remoteHasFile(repo, fixture.branch, 'scratch-note.txt'), false);
});

// ---- AC-8(a): 実行文脈ガード ----

test('root-cleanup branch (AC-8a): 対象worktreeが既定ブランチをチェックアウトしている場合は拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  // 対象worktreeがチェックアウトしているブランチ自体を、リポジトリの既定ブランチにする。
  git(repo.dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${fixture.branch}`]);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /既定ブランチ/);
  assert.match(result.stderr, /root-cleanup run/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(remoteTip(repo, fixture.branch), headBefore, 'pushが発生していないこと');
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

test('root-cleanup branch (AC-8a): detached HEADの対象worktreeでは実行しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  git(fixture.worktree, ['checkout', '--detach', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /detached HEAD/);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

test('root-cleanup branch (AC-8a): remote先頭が存在しないときはcommitもpushもせず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = startIssue(repo);
  writeArtifacts(fixture.worktree);
  git(fixture.worktree, ['add', '--', ...ARTIFACTS]);
  git(fixture.worktree, ['commit', '-m', 'docs: add artifacts without push']);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /remote 先頭が存在しません/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(remoteTip(repo, fixture.branch), '');
});

test('root-cleanup branch (AC-8a): remoteが先行している場合はcommitもpushもせず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  // remoteだけを1コミット進める（local HEADはその祖先ではなくなる）。
  fs.writeFileSync(path.join(fixture.worktree, 'ahead.txt'), 'remote only\n');
  git(fixture.worktree, ['add', 'ahead.txt']);
  git(fixture.worktree, ['commit', '-m', 'chore: advance remote only']);
  git(fixture.worktree, ['push', 'origin', fixture.branch]);
  const aheadTip = remoteTip(repo, fixture.branch);
  git(fixture.worktree, ['reset', '--hard', 'HEAD~1']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /祖先ではありません/);
  assert.equal(remoteTip(repo, fixture.branch), aheadTip, 'remoteが変化しないこと');
});

test('root-cleanup branch (AC-8a): 対象外の未pushcommitがあるときはcommitもpushもせず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  const pushedTip = remoteTip(repo, fixture.branch);
  fs.mkdirSync(path.join(fixture.worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'src', 'unpushed.ts'), 'export const u = 1;\n');
  git(fixture.worktree, ['add', 'src/unpushed.ts']);
  git(fixture.worktree, ['commit', '-m', 'feat: unpushed work']);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root成果物の削除以外/);
  assert.match(result.stderr, /src\/unpushed\.ts/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(remoteTip(repo, fixture.branch), pushedTip);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

// ---- AC-8(b): writer lease の Issue 単位排他 ----

test('root-cleanup branch (AC-8b, ローカルモード): 他segmentの有効leaseがあれば削除・commit・pushせず停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'implementation'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);
  const leasePath = path.join(repo.dir, 'issues', '798', '.agent-skill-chain', 'lease.yaml');
  assert.equal(fs.existsSync(leasePath), true, '前提: lease正本が存在すること');

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /writer lease が存在するため/);
  assert.match(result.stderr, /segment=implementation/);
  assert.match(result.stderr, /holder=/);
  assert.match(result.stderr, /expires_at=/);
  assert.match(result.stderr, /待機・強制解放・期限切れleaseの回収のいずれも行わず/);
  assert.equal(fs.existsSync(leasePath), true, '他主体のleaseを回収しないこと');
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

test('root-cleanup branch (AC-8b, ローカルモード): 期限切れleaseでも停止し、回収しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'implementation'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);
  const leasePath = path.join(repo.dir, 'issues', '798', '.agent-skill-chain', 'lease.yaml');
  const expired = fs
    .readFileSync(leasePath, 'utf8')
    .replace(/expires_at: .*/, 'expires_at: "2000-01-01T00:00:00.000Z"');
  fs.writeFileSync(leasePath, expired);

  const result = run(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /writer lease が存在するため/);
  assert.match(result.stderr, /2000-01-01/);
  assert.equal(fs.existsSync(leasePath), true, '期限切れleaseを回収しないこと');
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

test('root-cleanup branch (AC-8b/AC-10): ワーカーがlease保持中にラッパーを起動しても削除は成立しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'implementation'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);

  // cli-resolve.sh が最優先で解決する `<repo>/bin/agents-md.js` へ、本物のCLIを起動するshimを置く。
  fs.mkdirSync(path.join(repo.dir, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, 'bin', 'agents-md.js'),
    [
      '#!/usr/bin/env node',
      "const cp = require('node:child_process');",
      `const result = cp.spawnSync(process.execPath, [${JSON.stringify(binPath)}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
      'process.exit(result.status ?? 1);',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const wrapper = path.join(repo.dir, '.agent-skill-chain', 'scripts', 'root-cleanup-branch.sh');
  const invoked = spawnSync('bash', [wrapper, 'ISSUE-798'], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: { ...process.env, AGENT_SKILL_CHAIN_AUTO_INSTALL: '0' },
  });
  assert.notEqual(invoked.status, 0, invoked.stdout);
  assert.match(invoked.stderr, /writer lease が存在するため/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
});

// ---- AC-9: push失敗後の再実行が回復経路になる ----

test('root-cleanup branch (AC-9): push失敗は非ゼロ終了し、ローカルだけがcleanな状態で0を返さない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);
  const pushedTip = remoteTip(repo, fixture.branch);

  const hookPath = path.join(repo.remoteDir, 'hooks', 'pre-receive');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, '#!/bin/sh\necho "pre-receive: rejected for ISSUE-798 test" >&2\nexit 1\n', {
    mode: 0o755,
  });

  const first = run(repo);
  assert.notEqual(first.status, 0, first.stdout);
  assert.match(first.stderr, /git push に失敗しました/);
  const afterFirst = git(fixture.worktree, ['rev-parse', 'HEAD']);
  assert.notEqual(afterFirst, pushedTip, 'ローカルには削除commitが残ること');
  assert.equal(remoteTip(repo, fixture.branch), pushedTip, 'remoteは未反映のままであること');
  for (const file of ARTIFACTS) {
    assert.equal(remoteHasFile(repo, fixture.branch, file), true, `${file} はremote先頭に残っていること`);
  }

  fs.rmSync(hookPath);

  const second = run(repo);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), afterFirst, '再実行が新たなcommitを作らないこと');
  assert.equal(remoteTip(repo, fixture.branch), afterFirst, '再実行がpushを完了させること');
  assert.match(second.stdout, /remoteへ未反映だった/);
  for (const file of ARTIFACTS) assert.equal(remoteHasFile(repo, fixture.branch, file), false, file);
  assert.equal(verifyRootCleanOnBranchTip(repo, fixture.branch, t), 0);
});

// ---- AC-2: 引数仕様と決定性 ----

test('root-cleanup branch (AC-2): 引数がissue_id 1個以外のときは使い方エラーで非ゼロ終了する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const none = runCli(['root-cleanup', 'branch'], { cwd: repo.dir });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /issue_id ちょうど1個/);

  const tooMany = runCli(['root-cleanup', 'branch', 'ISSUE-798', 'SPEC.md'], { cwd: repo.dir });
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /issue_id ちょうど1個/);

  const malformed = runCli(['root-cleanup', 'branch', 'ISSUE-x'], { cwd: repo.dir });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /ISSUE-<番号> 形式/);

  const help = runCli(['root-cleanup', 'branch', '-h'], { cwd: repo.dir });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /使い方: agent-skill-chain root-cleanup branch <issue_id>/);
});

test('root-cleanup branch (AC-2): 標準入力を与えても結果が変わらない（内容入力経路を持たない）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const fixture = seedCommittedArtifacts(repo);

  const withStdin = runCli(['root-cleanup', 'branch', 'ISSUE-798'], {
    cwd: repo.dir,
    input: '# 外部から与えた本文\nこの内容は成果物へ取り込まれてはならない\n',
  });
  assert.equal(withStdin.status, 0, withStdin.stderr);
  const message = git(fixture.worktree, ['log', '-1', '--format=%B']);
  assert.equal(message.trim(), 'chore(root-cleanup): remove root segment artifacts for ISSUE-798');
  assert.equal(git(fixture.worktree, ['show', '--format=', '--numstat', 'HEAD']).includes('外部から'), false);
});

// ---- GitHubモード（lease正本がsegmentごとのgit refである場合の同一判定） ----

test('root-cleanup branch (AC-8b, GitHubモード): 他segmentの有効leaseがあれば停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);
  const fixture = seedCommittedArtifacts(repo, env);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);

  const result = run(repo, 'ISSUE-798', env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /writer lease が存在するため/);
  assert.match(result.stderr, /segment=implementation/);
  assert.match(result.stderr, /expires_at=/);
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore);
  for (const file of ARTIFACTS) assert.equal(fs.existsSync(path.join(fixture.worktree, file)), true, file);
  // 他主体のleaseを回収しない。
  assert.match(
    git(repo.dir, ['ls-remote', 'origin', 'refs/agent-skill-chain/leases/798-implementation']),
    /798-implementation/,
  );
});

test('root-cleanup branch (GitHubモード): leaseが無ければ削除のみのcommitを作りpushする', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);
  const fixture = seedCommittedArtifacts(repo, env);

  const result = run(repo, 'ISSUE-798', env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
  for (const file of ARTIFACTS) assert.equal(remoteHasFile(repo, fixture.branch, file), false, file);
  // 自身のleaseは終了経路で必ず解放する。
  assert.equal(git(repo.dir, ['ls-remote', 'origin', 'refs/agent-skill-chain/leases/798-*']), '');
  assert.equal(verifyRootCleanOnBranchTip(repo, fixture.branch, t), 0);
});

test('root-cleanup branch (AC-8b, GitHubモード): 取得直後の再走査で他leaseを検出したら自leaseを解放して譲る', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);
  const fixture = seedCommittedArtifacts(repo, env);
  const headBefore = git(fixture.worktree, ['rev-parse', 'HEAD']);

  // 有効なlease commitを1つremoteへ用意し、参照だけ退避しておく（後でhookが復元する）。
  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'validation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const rivalSha = git(repo.dir, ['ls-remote', 'origin', 'refs/agent-skill-chain/leases/798-validation']).split(
    /\s+/,
  )[0];
  execFileSync('git', ['--git-dir', repo.remoteDir, 'update-ref', 'refs/issue798/rival', rivalSha], { stdio: 'pipe' });
  const released = runCli(['lease', 'release', 'ISSUE-798'], { cwd: repo.dir, env });
  assert.equal(released.status, 0, released.stderr);

  // 本コマンドが自身のlease refをpushした瞬間に、他segmentのleaseが現れる窓を再現する。
  const hookPath = path.join(repo.remoteDir, 'hooks', 'post-receive');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(
    hookPath,
    [
      '#!/bin/sh',
      'while read -r _old _new ref; do',
      '  case "$ref" in',
      '    refs/agent-skill-chain/leases/798-root_artifact_cleanup)',
      '      git update-ref refs/agent-skill-chain/leases/798-validation refs/issue798/rival',
      '      ;;',
      '  esac',
      'done',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const result = run(repo, 'ISSUE-798', env);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /writer lease が存在するため/);
  assert.match(result.stderr, /segment=validation/);
  assert.equal(
    git(repo.dir, ['ls-remote', 'origin', 'refs/agent-skill-chain/leases/798-root_artifact_cleanup']),
    '',
    '自身のleaseを解放して譲ること',
  );
  assert.equal(git(fixture.worktree, ['rev-parse', 'HEAD']), headBefore, 'commitが作られないこと');
  for (const file of ARTIFACTS) assert.equal(remoteHasFile(repo, fixture.branch, file), true, file);
});
