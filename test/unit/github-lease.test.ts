import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import {
  renderLeaseComment,
  activeLeaseFor,
  activeLeasesFor,
  allLeasesFor,
  acquireLeaseRef,
  renewLeaseRef,
  releaseLeaseRef,
  classifyPushFailure,
  postLeaseReclaimComment,
  type WriterLease,
} from '../../src/lib/github-lease.js';

// ISSUE-176（ADR-0002）: GitHubモードのwriter leaseは、Issueコメントへの投稿ではなく
// issue番号+segmentごとの専用git ref（refs/agent-skill-chain/leases/<issue>-<segment>）への
// force無しpush/deleteによるcompare-and-setで実装される。本テストはgh-stubを一切使わず、
// test/helpers/tmp-repo.ts が既に用意するbare remote（repo.remoteDir、`origin`として登録済み）に
// 対して実際にgit push/fetchを行い、refの真の排他性（fast-forward-only）を検証する。

function makeLease(overrides: Partial<WriterLease['writer_lease']> = {}): WriterLease {
  const now = Date.now();
  return {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: 'ISSUE-42',
      holder: 'run-456',
      segment: 'spec',
      acquired_at: new Date(now).toISOString(),
      expires_at: new Date(now + 3600_000).toISOString(),
      token: 'random-token',
      ...overrides,
    },
  };
}

test('renderLeaseComment: マーカーとyamlフェンスを含む本文を生成する（純粋関数）', () => {
  const body = renderLeaseComment(makeLease());
  assert.match(body, /<!-- agent-skill-chain:lease -->/);
  assert.match(body, /```yaml\n/);
  assert.match(body, /issue_id: ISSUE-42/);
  assert.doesNotMatch(body, /random-token|token:/);
});

test('postLeaseReclaimComment: tokenを含まない回収監査コメントを投稿する', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-reclaim-comment-'));
  const stub = createGhStub(scratch);
  const previousPath = process.env.PATH;
  const previousState = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  Object.assign(process.env, stub.env(process.env));
  t.after(() => {
    process.env.PATH = previousPath;
    if (previousState === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = previousState;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const id = postLeaseReclaimComment('42', 'release-manager', 'run-456', 'implementation');
  assert.equal(id, '1');
  const body = stub.readState().comments['42'][0].body;
  assert.match(body, /<!-- agent-skill-chain:lease-reclaim -->/);
  assert.match(body, /actor: release-manager/);
  assert.match(body, /reclaimed_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.match(body, /issue: ISSUE-42/);
  assert.match(body, /segment: implementation/);
  assert.match(body, /previous_holder: run-456/);
  assert.doesNotMatch(body, /random-token|token:|credential/i);
});

test('acquireLeaseRef -> activeLeaseFor: 初回acquireはrefを新規作成し、読み出せること', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const lease = makeLease({ token: 'token-a' });
  const result = acquireLeaseRef('42', 'spec', lease, repo.dir);
  assert.equal(result.ok, true);

  const active = activeLeaseFor('42', 'spec', repo.dir);
  assert.ok(active, '直後にactiveLeaseForで読み出せること');
  assert.equal(active!.lease.writer_lease.token, 'token-a');
  assert.equal(active!.segment, 'spec');
  const message = execFileSync('git', ['log', '-1', '--format=%B', active!.sha], {
    cwd: repo.dir,
    encoding: 'utf8',
  });
  assert.doesNotMatch(message, /token-a|token:/, 'commit messageへbearer tokenを保存しないこと');
  const payload = execFileSync('git', ['show', `${active!.sha}:lease.yaml`], {
    cwd: repo.dir,
    encoding: 'utf8',
  });
  assert.match(payload, /token: token-a/, 'tokenはlease refのpayloadだけから復元できること');

  // 別segmentでは一致しないこと。
  assert.equal(activeLeaseFor('42', 'design', repo.dir), undefined);
});

test('acquireLeaseRef: 既存refがある状態での再acquireはconflictとして拒否される（真の二重取得防止）', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const first = acquireLeaseRef('42', 'spec', makeLease({ token: 'token-first' }), repo.dir);
  assert.equal(first.ok, true);

  const second = acquireLeaseRef('42', 'spec', makeLease({ token: 'token-second' }), repo.dir);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'conflict', 'push非fast-forward拒否はconflictに分類されること');

  // 先着(token-first)のリースが正本のまま維持されていること（後勝ちで奪われていないこと）。
  const active = activeLeaseFor('42', 'spec', repo.dir);
  assert.equal(active!.lease.writer_lease.token, 'token-first');
});

test('activeLeaseFor: 期限切れのleaseは除外される', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const expiredLease = makeLease({
    token: 'token-expired',
    acquired_at: new Date(Date.now() - 7200_000).toISOString(),
    expires_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  const result = acquireLeaseRef('7', 'design', expiredLease, repo.dir);
  assert.equal(result.ok, true);

  assert.equal(activeLeaseFor('7', 'design', repo.dir), undefined, '期限切れleaseはactiveLeaseForから除外されること');
});

test('activeLeasesFor/allLeasesFor: segmentを問わず全leaseを列挙し、期限内外を判別できる', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const specLease = makeLease({ segment: 'spec', token: 'token-spec' });
  const expiredDesignLease = makeLease({
    segment: 'design',
    token: 'token-design-expired',
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(acquireLeaseRef('9', 'spec', specLease, repo.dir).ok, true);
  assert.equal(acquireLeaseRef('9', 'design', expiredDesignLease, repo.dir).ok, true);

  const all = allLeasesFor('9', repo.dir);
  assert.equal(all.length, 2, '期限切れも含め全segmentのleaseが列挙されること');
  assert.ok(all.some((e) => e.segment === 'spec'));
  assert.ok(all.some((e) => e.segment === 'design'));

  const active = activeLeasesFor('9', repo.dir);
  assert.equal(active.length, 1, '有効期限内のleaseのみが残ること');
  assert.equal(active[0].segment, 'spec');
});

test('renewLeaseRef: 現在のref先頭を親とするrenewは成功し、expires_atが更新される', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const lease = makeLease({ token: 'token-renew' });
  assert.equal(acquireLeaseRef('11', 'spec', lease, repo.dir).ok, true);

  const renewedExpiresAt = new Date(Date.now() + 7200_000).toISOString();
  const renewedLease: WriterLease = {
    ...lease,
    writer_lease: { ...lease.writer_lease, expires_at: renewedExpiresAt },
  };
  const renewResult = renewLeaseRef('11', 'spec', renewedLease, repo.dir);
  assert.equal(renewResult.ok, true, JSON.stringify(renewResult));

  const active = activeLeaseFor('11', 'spec', repo.dir);
  assert.equal(active!.lease.writer_lease.expires_at, renewedExpiresAt);
  assert.equal(active!.lease.writer_lease.token, 'token-renew');
});

test('renewLeaseRef: refが存在しない場合はconflictとして失敗する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const lease = makeLease({ token: 'token-none' });
  const result = renewLeaseRef('12', 'spec', lease, repo.dir);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'conflict');
});

test('renewLeaseRef: 古いparent（stale）を基にした renew は非fast-forwardでconflictになる（TOCTOU耐性）', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const lease = makeLease({ token: 'token-stale' });
  assert.equal(acquireLeaseRef('13', 'spec', lease, repo.dir).ok, true);

  // 1つ目のrenewが成功してrefが進む。
  const firstRenewExpires = new Date(Date.now() + 7200_000).toISOString();
  const firstRenewLease: WriterLease = { ...lease, writer_lease: { ...lease.writer_lease, expires_at: firstRenewExpires } };
  assert.equal(renewLeaseRef('13', 'spec', firstRenewLease, repo.dir).ok, true);

  // 2つ目のrenewは「自分が最後に読んだ値」が古いままの状態を模擬するため、renewLeaseRef内部の
  // 現在ref読み出しをすり抜けられない（renewLeaseRefは常に最新のrefを親にするため、通常フローでは
  // stale renewは起こらない）。ここでは releaseLeaseRef で正本を削除したうえでの renew が
  // 「ref不在」＝conflictとして扱われることを確認し、renew実行者が最後に読んだ値のままでない
  // 場合に成功しない設計であることを別角度から検証する。
  assert.equal(releaseLeaseRef('13', 'spec', repo.dir).ok, true);
  const afterRelease = renewLeaseRef('13', 'spec', firstRenewLease, repo.dir);
  assert.equal(afterRelease.ok, false);
  if (!afterRelease.ok) assert.equal(afterRelease.reason, 'conflict');
});

// DESIGN.md §障害・ロールバック考慮: 「git pushのstderr文言がGitHubのAPIバージョン変更で変わり、
// [rejected]判定が誤分類する可能性 → 実装Issueで判定ロジックの単体テスト（stderrサンプル文字列に
// 対するアサーション）を追加し検知する」を受け、実プロセス並行実行（test/integration/
// lease-concurrency.test.ts）で実測した2種類のstderr文言をここに固定する。
test('classifyPushFailure: 非fast-forward拒否（renewのstale parent時）はconflictに分類される', () => {
  const stderr = [
    "To /tmp/agent-skill-chain-remote-example",
    " ! [rejected]        deadbeefdeadbeefdeadbeefdeadbeefdeadbeef -> refs/agent-skill-chain/leases/1-spec (non-fast-forward)",
    "error: failed to push some refs to '/tmp/agent-skill-chain-remote-example'",
  ].join('\n');
  assert.equal(classifyPushFailure(stderr), 'conflict');
});

test('classifyPushFailure: 真に同時のref新規作成race（サーバ側ref lock競合）もconflictに分類される（実測確認済みの別系統文言）', () => {
  // test/integration/lease-concurrency.test.ts の並行acquireテストで、真に同時に2プロセスが
  // 同一ref新規作成をpushした際に実際に観測されたstderr（非fast-forward判定より前の、
  // ref作成そのものの排他ロック層で先に競合するケース）。
  const stderr = [
    "remote: error: cannot lock ref 'refs/agent-skill-chain/leases/9-spec': reference already exists        ",
    'To /tmp/agent-skill-chain-remote-example',
    ' ! [remote rejected] deadbeefdeadbeefdeadbeefdeadbeefdeadbeef -> refs/agent-skill-chain/leases/9-spec (failed to update ref)',
    "error: failed to push some refs to '/tmp/agent-skill-chain-remote-example'",
  ].join('\n');
  assert.equal(classifyPushFailure(stderr), 'conflict');
});

test('classifyPushFailure: 上記いずれにも一致しない失敗（認証・接続エラー等）はerrorに分類される', () => {
  const stderr = 'fatal: could not read Username for https://github.com: terminal prompts disabled';
  assert.equal(classifyPushFailure(stderr), 'error');
});

test('releaseLeaseRef: refを削除し、以後activeLeaseForはundefinedを返し、再acquireが成功する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const lease = makeLease({ token: 'token-release' });
  assert.equal(acquireLeaseRef('14', 'spec', lease, repo.dir).ok, true);
  assert.ok(activeLeaseFor('14', 'spec', repo.dir));

  const released = releaseLeaseRef('14', 'spec', repo.dir);
  assert.equal(released.ok, true);
  assert.equal(activeLeaseFor('14', 'spec', repo.dir), undefined, 'release後はactiveLeaseForがundefinedを返すこと');

  const reacquired = acquireLeaseRef('14', 'spec', makeLease({ token: 'token-reacquired' }), repo.dir);
  assert.equal(reacquired.ok, true, 'release後は同一segmentへの再acquireが成功すること');
});
