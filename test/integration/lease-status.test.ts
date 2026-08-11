import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { allLeasesFor, acquireLeaseRef, renewLeaseRef, type WriterLease } from '../../src/lib/github-lease.js';
import { readLeaseCredential } from '../../src/lib/lease-credential.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

// `lease status <issue_id> [segment] [--json]`（src/commands/lease.ts）の結合テスト。
// 読み取り専用であること（正本の値・Issueコメント・credentialが実行前後で不変であること）を含め、
// SPEC.md の AC-1〜AC-6 を検証する。AC-7（既存lease系サブコマンドの回帰無し）は既存の
// lease-reclaim.test.ts / lease-renew.test.ts / lease-resume.test.ts / lease-concurrency.test.ts /
// test/unit/github-lease.test.ts を無変更のまま実行することで別途担保する（PLAN.md #6）。

function makeStub() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-lease-status-'));
  const stub = createGhStub(scratch);
  return {
    stub,
    env: stub.env(process.env),
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

function leaseFilePathFor(repoDir: string, issueNumber: string): string {
  return path.join(repoDir, 'issues', issueNumber, '.agent-skill-chain', 'lease.yaml');
}

test('lease status (github): 有効なleaseの現在状態を副作用無しで表示する（AC-1）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const acquired = runCli(['lease', 'acquire', 'ISSUE-201', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const before = allLeasesFor('201', repo.dir)[0];
  const commentsBefore = JSON.stringify(stub.readState().comments['201'] ?? []);

  const result = runCli(['lease', 'status', 'ISSUE-201', 'implementation'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: active/);
  assert.match(result.stdout, new RegExp(`holder: ${before.lease.writer_lease.holder}`));
  assert.match(result.stdout, /segment: implementation/);
  assert.match(result.stdout, new RegExp(`acquired_at: ${before.lease.writer_lease.acquired_at}`));
  assert.match(result.stdout, new RegExp(`expires_at: ${before.lease.writer_lease.expires_at}`));
  assert.match(result.stdout, /remaining_seconds: \d+/);
  assert.doesNotMatch(result.stdout, /token/);

  const after = allLeasesFor('201', repo.dir)[0];
  assert.equal(after.sha, before.sha, '実行前後でlease refのSHAが変化しないこと（副作用無し）');
  const commentsAfter = JSON.stringify(stub.readState().comments['201'] ?? []);
  assert.equal(commentsAfter, commentsBefore, '実行前後でIssueコメント一覧が変化しないこと（副作用無し）');
});

test('lease status (github): Issueコメントの古い記載ではなくgit ref上の実際の値を返す（AC-2）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const acquired = runCli(['lease', 'acquire', 'ISSUE-202', 'validation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  // acquire時に投稿された可視性コメントに記載のexpires_atは初回acquire時点のまま（renderLeaseCommentは
  // renewのたびに再投稿されない設計、SPEC.md 目的・背景参照）。
  const staleComment = (stub.readState().comments['202'] ?? []).find((c) =>
    c.body.includes('<!-- agent-skill-chain:lease -->'),
  );
  assert.ok(staleComment);
  const staleExpiresAt = /expires_at:\s*(\S+)/.exec(staleComment!.body)![1];

  const held = allLeasesFor('202', repo.dir)[0];
  const renewedExpiresAt = new Date(Date.now() + 7_200_000).toISOString();
  const renewed: WriterLease = {
    ...held.lease,
    writer_lease: { ...held.lease.writer_lease, expires_at: renewedExpiresAt },
  };
  const outcome = renewLeaseRef('202', 'validation', renewed, repo.dir, held.sha);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.notEqual(renewedExpiresAt, staleExpiresAt, '検証前提: renew後のexpires_atはコメント記載と異なること');

  const result = runCli(['lease', 'status', 'ISSUE-202', 'validation'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`expires_at: ${renewedExpiresAt}`));
  assert.doesNotMatch(
    result.stdout,
    new RegExp(`expires_at: ${staleExpiresAt}(?!.*${renewedExpiresAt})`),
  );
});

test('lease status (github): leaseが存在しない場合と期限切れの場合を区別可能な形で出力する（AC-3）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const notFound = runCli(['lease', 'status', 'ISSUE-203', 'implementation'], { cwd: repo.dir, env });
  assert.equal(notFound.status, 0, notFound.stderr);
  assert.match(notFound.stdout, /status: not_found/);
  assert.doesNotMatch(notFound.stdout, /status: expired|status: active/);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-203', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const held = allLeasesFor('203', repo.dir)[0];
  const expired: WriterLease = {
    ...held.lease,
    writer_lease: { ...held.lease.writer_lease, expires_at: new Date(Date.now() - 60_000).toISOString() },
  };
  const outcome = renewLeaseRef('203', 'implementation', expired, repo.dir, held.sha);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));

  const expiredResult = runCli(['lease', 'status', 'ISSUE-203', 'implementation'], { cwd: repo.dir, env });
  assert.equal(expiredResult.status, 0, expiredResult.stderr);
  assert.match(expiredResult.stdout, /status: expired/);
  assert.doesNotMatch(expiredResult.stdout, /status: not_found|status: active/);
});

test('lease status (github): Coordination Backendへの接続失敗はコマンド自体の異常終了として区別される（AC-3）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  execFileSync('git', ['remote', 'set-url', 'origin', '/nonexistent/agent-skill-chain-remote-does-not-exist'], {
    cwd: repo.dir,
  });

  const result = runCli(['lease', 'status', 'ISSUE-204', 'implementation'], { cwd: repo.dir, env });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /status: not_found|status: expired|status: active/);
  assert.match(result.stderr, /接続に失敗しました/);
});

test('lease status (github): --jsonで機械可読な構造化出力を返す（AC-4）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const acquired = runCli(['lease', 'acquire', 'ISSUE-205', 'design'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const held = allLeasesFor('205', repo.dir)[0];

  const result = runCli(['lease', 'status', 'ISSUE-205', 'design', '--json'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, 'active');
  assert.equal(parsed[0].holder, held.lease.writer_lease.holder);
  assert.equal(parsed[0].segment, 'design');
  assert.equal(parsed[0].acquired_at, held.lease.writer_lease.acquired_at);
  assert.equal(parsed[0].expires_at, held.lease.writer_lease.expires_at);
  assert.equal(typeof parsed[0].remaining_seconds, 'number');
  assert.equal('token' in parsed[0], false);
});

test('lease status (github): segment省略時は対象Issueの有効なwriter leaseを全件返す（AC-5）', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const acquiredSpec = runCli(['lease', 'acquire', 'ISSUE-206', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquiredSpec.status, 0, acquiredSpec.stderr);
  const held = allLeasesFor('206', repo.dir)[0];
  const expiredDesign: WriterLease = {
    ...held.lease,
    writer_lease: {
      ...held.lease.writer_lease,
      segment: 'design',
      holder: 'run-expired-design',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    },
  };
  assert.equal(acquireLeaseRef('206', 'design', expiredDesign, repo.dir).ok, true);

  const withSegment = runCli(['lease', 'status', 'ISSUE-206', 'spec', '--json'], { cwd: repo.dir, env });
  const omitted = runCli(['lease', 'status', 'ISSUE-206', '--json'], { cwd: repo.dir, env });
  assert.equal(withSegment.status, 0, withSegment.stderr);
  assert.equal(omitted.status, 0, omitted.stderr);
  const parsedOmitted = JSON.parse(omitted.stdout) as Array<Record<string, unknown>>;
  const parsedWithSegment = JSON.parse(withSegment.stdout) as Array<Record<string, unknown>>;
  // 期限切れdesignは除外され、有効なspecのみが残ること（segment指定時と同等の情報量）。
  // remaining_secondsは別プロセス呼び出しごとに実時刻から算出されるため、他フィールドのみ比較する
  // （remaining_secondsそのものの正当性はAC-1のunit test/integration testで別途検証済み）。
  assert.equal(parsedOmitted.length, 1);
  assert.equal(parsedWithSegment.length, 1);
  assert.equal(parsedOmitted[0].segment, 'spec');
  assert.equal(parsedOmitted[0].status, 'active');
  const { remaining_seconds: _omittedRemaining, ...omittedRest } = parsedOmitted[0];
  const { remaining_seconds: _segmentRemaining, ...withSegmentRest } = parsedWithSegment[0];
  assert.deepEqual(omittedRest, withSegmentRest);
});

test('lease status (github): 対象Issueに有効leaseが複数存在する場合はいずれも欠落せず表示する（AC-5）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  // 同一Issueへの複数segment同時acquireはCLI（1 Issue同時1 lease制約）では作れないため、
  // github-lease.ts のref操作を直接使い複数の有効leaseが存在する状態を作る（既存挙動を変更しない
  // 読み取り専用コマンドの検証目的に限定した直接操作）。
  const now = Date.now();
  const future = (ms: number) => new Date(now + ms).toISOString();
  const specLease: WriterLease = {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: 'ISSUE-207',
      holder: 'run-spec',
      segment: 'spec',
      acquired_at: new Date(now).toISOString(),
      expires_at: future(3600_000),
      token: 'token-spec',
    },
  };
  const designLease: WriterLease = {
    ...specLease,
    writer_lease: { ...specLease.writer_lease, holder: 'run-design', segment: 'design', expires_at: future(1800_000) },
  };
  assert.equal(acquireLeaseRef('207', 'spec', specLease, repo.dir).ok, true);
  assert.equal(acquireLeaseRef('207', 'design', designLease, repo.dir).ok, true);

  const result = runCli(['lease', 'status', 'ISSUE-207', '--json'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, 2);
  const segments = parsed.map((p) => p.segment).sort();
  assert.deepEqual(segments, ['design', 'spec']);
});

test('lease status (github): writer lease credentialを保持しない実行主体でも現在状態を返し、credentialを新規作成しない（AC-6）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  // CLI経由のacquireを使わずgithub-lease.tsのref操作を直接使うことで、この実行主体が
  // writer lease credentialを一切保持していない状態（AC-6のGiven）を再現する。
  const lease: WriterLease = {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: 'ISSUE-208',
      holder: 'run-no-credential',
      segment: 'implementation',
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      token: 'token-no-credential',
    },
  };
  assert.equal(acquireLeaseRef('208', 'implementation', lease, repo.dir).ok, true);
  assert.equal(readLeaseCredential(repo.dir, '208'), undefined, '検証前提: credentialを保持していないこと');

  const result = runCli(['lease', 'status', 'ISSUE-208', 'implementation'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: active/);
  assert.match(result.stdout, /holder: run-no-credential/);

  assert.equal(readLeaseCredential(repo.dir, '208'), undefined, 'lease statusはcredentialを新規作成しないこと');
});

test('lease status (local): 有効なleaseの現在状態を副作用無しで表示する（AC-1, AC-6）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquired = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);
  const leasePath = leaseFilePathFor(repo.dir, '1');
  const before = fs.readFileSync(leasePath, 'utf8');

  const result = runCli(['lease', 'status', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: active/);
  assert.match(result.stdout, /segment: spec/);
  assert.doesNotMatch(result.stdout, /token/);

  const after = fs.readFileSync(leasePath, 'utf8');
  assert.equal(after, before, '実行前後でlease.yamlの内容が変化しないこと（副作用無し）');
});

test('lease status (local): leaseが存在しない場合と期限切れの場合を区別可能な形で出力する（AC-3）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const notFound = runCli(['lease', 'status', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(notFound.status, 0, notFound.stderr);
  assert.match(notFound.stdout, /status: not_found/);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);
  const leasePath = leaseFilePathFor(repo.dir, '1');
  const lease = parse(fs.readFileSync(leasePath, 'utf8')) as WriterLease;
  lease.writer_lease.expires_at = new Date(Date.now() - 60_000).toISOString();
  fs.writeFileSync(leasePath, stringify(lease), 'utf8');

  const expired = runCli(['lease', 'status', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(expired.status, 0, expired.stderr);
  assert.match(expired.stdout, /status: expired/);
});

test('lease status (local): segmentがlease.yamlの記録と一致しない場合はnot_foundを返す（AC-3）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquired = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);

  const result = runCli(['lease', 'status', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: not_found/);
});

test('lease status (local): segment省略時は対象Issueの有効なwriter leaseを返す（AC-5）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquired = runCli(['lease', 'acquire', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);

  const result = runCli(['lease', 'status', 'ISSUE-1', '--json'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].segment, 'validation');
  assert.equal(parsed[0].status, 'active');
});

test('lease status (local): --jsonで機械可読な構造化出力を返す（AC-4）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquired = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);

  const result = runCli(['lease', 'status', 'ISSUE-1', 'spec', '--json'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, 'active');
  assert.equal(parsed[0].segment, 'spec');
});

test('lease status: -h/--helpで使い方を表示し、副作用を発生させない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['lease', 'status', '--help'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lease status/);
});

test('lease status: issue_id省略時は使い方エラーで終了する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['lease', 'status'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /issue_id は必須です/);
});
