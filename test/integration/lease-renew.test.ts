import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// `lease renew <issue_id> <token>`（src/commands/lease.ts）の結合テスト。
// lease acquire で取得したwriter leaseのexpires_atを延長できること、tokenが一致しない場合に
// 失敗することに加え、ローカルバックエンド実装固有の仕様上の非対称性
// （後述コメント参照）を実際の挙動としてそのまま固定する。
//
// lease acquire/renewはissue_id・segmentのみに依存し、worktree（issue start）の存在を前提と
// しないため、ここでは issue start を行わずrepo.dirに対して直接コマンドを実行する。

interface WriterLease {
  writer_lease: { expires_at: string; segment: string; token: string };
}

function leaseFilePathFor(repoDir: string, issueNumber: string): string {
  return path.join(repoDir, 'issues', issueNumber, '.agent-skill-chain', 'lease.yaml');
}

test('lease renew: 正しいtokenでexpires_atが延長される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: writer leaseを取得する。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  const token = /token:\s*(\S+)/.exec(acquire.stdout)![1];
  const originalExpiresAt = /expires_at:\s*(\S+)/.exec(acquire.stdout)![1];

  // When: 正しいtokenで renew を呼ぶ。
  const renew = runCli(['lease', 'renew', 'ISSUE-1', token], { cwd: repo.dir });

  // Then: 成功し、出力されたexpires_atが未来の時刻であり、lease.yaml側にも反映されていること。
  assert.equal(renew.status, 0, renew.stderr);
  const renewedExpiresAt = renew.stdout.trim();
  assert.match(renewedExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(new Date(renewedExpiresAt).getTime() > Date.now(), 'renew後のexpires_atは現在時刻より未来であること');
  assert.ok(
    new Date(renewedExpiresAt).getTime() >= new Date(originalExpiresAt).getTime(),
    'renew後のexpires_atはacquire直後のexpires_at以上であること',
  );

  const lease = parse(fs.readFileSync(leaseFilePathFor(repo.dir, '1'), 'utf8')) as WriterLease;
  assert.equal(lease.writer_lease.expires_at, renewedExpiresAt);
});

test('lease renew (異常系): tokenが一致しない場合は失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: writer leaseを取得する。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  // When: 誤ったtokenで renew を呼ぶ。
  const renew = runCli(['lease', 'renew', 'ISSUE-1', 'not-the-real-token'], { cwd: repo.dir });

  // Then: token不一致で失敗し、lease.yamlのexpires_atは変化しないこと。
  assert.equal(renew.status, 1);
  assert.match(renew.stderr, /token/);
});

test(
  'lease renew (ISSUE-176 AC-6): ローカルバックエンドも期限切れ後はtokenが一致してもrenewを拒否する',
  async (t) => {
    const repo = createTmpRepo({ backend: 'local' });
    t.after(() => repo.cleanup());

    // Given: writer leaseを取得したうえで、expires_atを直接過去日時へ書き換え「既に期限切れ」の状態を作る。
    const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
    assert.equal(acquire.status, 0, acquire.stderr);
    const token = /token:\s*(\S+)/.exec(acquire.stdout)![1];

    const leasePath = leaseFilePathFor(repo.dir, '1');
    const lease = parse(fs.readFileSync(leasePath, 'utf8')) as WriterLease;
    const pastExpiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    lease.writer_lease.expires_at = pastExpiresAt;
    fs.writeFileSync(leasePath, stringify(lease), 'utf8');

    // When: 期限切れ状態のまま、正しいtokenで renew を呼ぶ。
    const renew = runCli(['lease', 'renew', 'ISSUE-1', token], { cwd: repo.dir });

    // Then: バックエンド間の非対称性を解消済み（ISSUE-176）。githubバックエンドと同一の理由
    // （lease は既に期限切れです）で失敗し、expires_atは書き換えられないこと。
    assert.equal(renew.status, 1);
    assert.match(renew.stderr, /期限切れ/);
    const after = parse(fs.readFileSync(leasePath, 'utf8')) as WriterLease;
    assert.equal(after.writer_lease.expires_at, pastExpiresAt, '失敗時はexpires_atが変化しないこと');
  },
);
