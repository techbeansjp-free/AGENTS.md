import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { allLeasesFor, renewLeaseRef, type WriterLease } from '../../src/lib/github-lease.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';

// Issue #692 の独立検証セグメントで追加した受入テスト。実装セグメントのテストが直接扱って
// いなかった次の3点を、コマンドの終了コードと副作用（worktree・lease.yaml・lease refの残存）
// で一体検証する。
//
// 1. upstream追跡refがIssueブランチ自身のremote refではなく統合先ブランチを指す構成でも、
//    保全済みworktreeの削除が誤ってブロックされないこと。追跡設定の有無・指し先は作業が
//    失われるかどうかの根拠ではない。
// 2. 未pushのcommit以外の3つの削除条件（有効なwriter lease・未commitの変更・PRまたは
//    Integration Recordの未完了）が、それぞれ既存の日本語拒否理由で削除を拒否し続けること。
// 3. 未pushのcommit判定を共有する他用途（期限切れwriter leaseの回収可否判定・作業継続の
//    ためのlease再取得時の残作業判定）で、ローカル限定commitが残るworktreeが「保全されて
//    いない作業が残る」側として扱われ、回収による作業消失が起きないこと。保全済み側の扱いも
//    定義された挙動（回収可・再開拒否）に一致すること。

function makeGhStub() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-cleanup-acceptance-'));
  const stub = createGhStub(scratch);
  return {
    stub,
    env: stub.env(process.env),
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

function localLeaseFilePath(repoDir: string, issueNumber: string): string {
  return path.join(repoDir, 'issues', issueNumber, '.agent-skill-chain', 'lease.yaml');
}

function expireLocalLease(repoDir: string, issueNumber: string): void {
  const leasePath = localLeaseFilePath(repoDir, issueNumber);
  const lease = parse(fs.readFileSync(leasePath, 'utf8')) as WriterLease;
  lease.writer_lease.expires_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  fs.writeFileSync(leasePath, stringify(lease), 'utf8');
}

function expireGithubLease(repoDir: string, issueNumber: string, segment: string): void {
  const held = allLeasesFor(issueNumber, repoDir).find((entry) => entry.segment === segment);
  assert.ok(held, '前提: 対象segmentのwriter leaseが存在すること');
  const expired: WriterLease = {
    ...held.lease,
    writer_lease: {
      ...held.lease.writer_lease,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
  };
  const outcome = renewLeaseRef(issueNumber, segment, expired, repoDir, held.sha);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
}

test('cleanup: upstream追跡refが統合先ブランチを指していてもsquash統合済みworktreeを削除できる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const gh = makeGhStub();
  t.after(() => {
    repo.cleanup();
    gh.cleanup();
  });

  // Given: Issueブランチの内容をpush後にsquash mergeで統合し、Issueブランチのupstream追跡refを
  // 統合先ブランチ（origin/main）へ向ける。upstream基準では統合先の先行commitが見えるため、
  // upstreamを判定根拠にする実装なら未pushと誤判定し得る構成になる。
  const branch = 'bugfix/692-upstream-points-to-base';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-bugfix-692-upstream-points-to-base`);
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'main'], { cwd: repo.dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(worktreePath, 'UPSTREAM_CASE.md'), '# upstream points to base\n');
  const checkpoint = runCli(['checkpoint', 'test: add upstream case content'], { cwd: worktreePath, env: gh.env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const pushedHead = checkpoint.stdout.trim();

  fs.writeFileSync(path.join(repo.dir, 'CONCURRENT_BASE.md'), '# concurrent base change\n');
  execFileSync('git', ['add', 'CONCURRENT_BASE.md'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: advance base before squash merge'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['merge', '--squash', branch], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: squash upstream case content'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', '--delete', branch], { cwd: repo.dir, stdio: 'pipe' });

  execFileSync('git', ['config', `branch.${branch}.remote`, 'origin'], { cwd: worktreePath, stdio: 'pipe' });
  execFileSync('git', ['config', `branch.${branch}.merge`, 'refs/heads/main'], { cwd: worktreePath, stdio: 'pipe' });
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    'origin/main',
    '前提: upstream追跡refが統合先ブランチを指していること',
  );
  assert.notEqual(
    execFileSync('git', ['rev-list', '--count', `${branch}..origin/main`], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    '0',
    '前提: upstream基準では統合先に先行commitが存在するように見えること',
  );
  gh.stub.seedPrList(branch, [{ state: 'MERGED', headRefOid: pushedHead }]);

  // When: 対象Issue IDを指定してworktree削除コマンドを実行する。
  const cleanup = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir, env: gh.env });

  // Then: 終了コード0で削除され、未push起因の拒否は発生しない。
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.stdout.trim(), worktreePath);
  assert.ok(!fs.existsSync(worktreePath), 'upstreamが統合先を指す保全済みworktreeが削除されること');
});

test('cleanup: 有効なwriter lease・未commitの変更・Integration Record未完了はそれぞれの理由で削除を拒否する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'other-conditions', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  // Given: 有効なwriter leaseが存在するworktree。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-692', 'validation'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  // When/Then: 有効なwriter leaseを理由に削除が拒否される。
  const withLease = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(withLease.status, 1);
  assert.match(withLease.stderr, /有効な writer lease が存在するため削除できません/);
  assert.ok(fs.existsSync(worktreePath), '有効leaseがあるworktreeを削除しないこと');

  const release = runCli(['lease', 'release', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(release.status, 0, release.stderr);

  // Given: 作業ツリーに未commitの変更が残るworktree。
  fs.writeFileSync(path.join(worktreePath, 'DIRTY.md'), '# uncommitted\n');

  // When/Then: 未commitの変更を理由に削除が拒否される。
  const withDirty = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(withDirty.status, 1);
  assert.match(withDirty.stderr, /未commitの変更があるため削除できません/);
  assert.ok(fs.existsSync(worktreePath), '未commitの変更が残るworktreeを削除しないこと');

  // Given: 未commitの変更を解消しpush済みだが、Integration Recordが完了していないworktree。
  const checkpoint = runCli(['checkpoint', 'test: commit and push dirty file'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const prCreate = runCli(['pr', 'create', 'ISSUE-692', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const record = parse(fs.readFileSync(prCreate.stdout.trim(), 'utf8')) as { status: string };
  assert.equal(record.status, 'draft', '前提: Integration Recordが未完了であること');

  // When/Then: Integration Record未完了を理由に削除が拒否される。
  const withDraftRecord = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(withDraftRecord.status, 1);
  assert.match(withDraftRecord.stderr, /Integration Record が完了済み（merged または closed）ではないため削除できません/);
  assert.ok(fs.existsSync(worktreePath), 'Integration Record未完了のworktreeを削除しないこと');
});

test('reconcile: ローカル限定commitが残るworktreeの期限切れleaseは回収せず人間判断へ昇格する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: remoteへ一度もpushされず統合先にも取り込まれていないcommitが残るworktreeと、
  // 期限切れのwriter lease。
  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'reclaim-unpreserved', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'LOCAL_ONLY.md'), '# never pushed\n');
  execFileSync('git', ['add', 'LOCAL_ONLY.md'], { cwd: worktreePath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: keep local-only work'], { cwd: worktreePath, stdio: 'pipe' });

  const acquire = runCli(['lease', 'acquire', 'ISSUE-692', 'implementation'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireLocalLease(repo.dir, '692');

  // When: 期限切れleaseの一括回収を実行する。
  const reconcile = runCli(['reconcile'], { cwd: repo.dir });

  // Then: 回収されず human_required として昇格し、lease.yamlもworktreeも残る。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reclaimed: \(none\)/);
  assert.match(reconcile.stdout, /escalated: ISSUE-692:implementation/);
  assert.match(reconcile.stdout, /human_required/);
  assert.ok(fs.existsSync(localLeaseFilePath(repo.dir, '692')), '昇格時はlease.yamlが残ること');
  assert.ok(fs.existsSync(worktreePath), '昇格時はworktreeが残ること');
});

test('reconcile: push済みで未保全commitが無いworktreeの期限切れleaseは回収される', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 全commitがremoteへpush済みで未commitの変更も無いworktreeと、期限切れのwriter lease。
  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'reclaim-preserved', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'PUSHED.md'), '# pushed\n');
  const checkpoint = runCli(['checkpoint', 'test: push preserved work'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-692', 'implementation'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireLocalLease(repo.dir, '692');

  // When: 期限切れleaseの一括回収を実行する。
  const reconcile = runCli(['reconcile'], { cwd: repo.dir });

  // Then: 保全済みのため回収され、lease.yamlだけが削除される（worktreeはreconcileの対象外）。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reclaimed: ISSUE-692:implementation/);
  assert.match(reconcile.stdout, /escalated: \(none\)/);
  assert.ok(!fs.existsSync(localLeaseFilePath(repo.dir, '692')), '回収時はlease.yamlが削除されること');
  assert.ok(fs.existsSync(worktreePath), 'reconcileはworktreeを削除しないこと');
});

test('lease resume: ローカル限定commitだけが残るworktreeは残作業ありとして再開できる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const gh = makeGhStub();
  t.after(() => {
    repo.cleanup();
    gh.cleanup();
  });

  // Given: 未commitの変更は無いが、remoteへ一度もpushされていないcommitだけが残るworktreeと、
  // 同一holderのcredentialを持つ期限切れwriter lease。
  const start = runCli(['issue', 'start', 'ISSUE-692', 'bugfix', 'resume-unpreserved', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env: gh.env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'LOCAL_ONLY.md'), '# never pushed\n');
  execFileSync('git', ['add', 'LOCAL_ONLY.md'], { cwd: worktreePath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: keep local-only work'], { cwd: worktreePath, stdio: 'pipe' });
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    '',
    '前提: 未commitの変更は残っていないこと',
  );

  const acquire = runCli(['lease', 'acquire', 'ISSUE-692', 'implementation'], { cwd: repo.dir, env: gh.env });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireGithubLease(repo.dir, '692', 'implementation');

  // When: 作業継続のためlease再取得を実行する。
  const resume = runCli(['lease', 'resume', 'ISSUE-692', 'implementation'], { cwd: repo.dir, env: gh.env });

  // Then: 残作業ありと判定され再開できる。ローカル限定commitは削除されず残る。
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(fs.readFileSync(path.join(worktreePath, 'LOCAL_ONLY.md'), 'utf8'), '# never pushed\n');
});

test('lease resume: push済みで未保全commitも未commitの変更も無いworktreeは再開を拒否する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const gh = makeGhStub();
  t.after(() => {
    repo.cleanup();
    gh.cleanup();
  });

  // Given: 全commitがremoteへpush済みで未commitの変更も無いworktreeと、期限切れwriter lease。
  const start = runCli(['issue', 'start', 'ISSUE-692', 'bugfix', 'resume-preserved', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env: gh.env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'PUSHED.md'), '# pushed\n');
  const checkpoint = runCli(['checkpoint', 'test: push preserved work'], { cwd: worktreePath, env: gh.env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-692', 'implementation'], { cwd: repo.dir, env: gh.env });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireGithubLease(repo.dir, '692', 'implementation');

  // When: 作業継続のためlease再取得を実行する。
  const resume = runCli(['lease', 'resume', 'ISSUE-692', 'implementation'], { cwd: repo.dir, env: gh.env });

  // Then: 残作業が無いため再開は拒否され、既存の日本語理由が出力される。
  assert.equal(resume.status, 1);
  assert.match(resume.stderr, /未commitまたは未pushの変更がありません/);
});
