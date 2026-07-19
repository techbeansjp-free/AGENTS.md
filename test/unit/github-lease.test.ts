import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGhStub } from '../helpers/gh-stub.js';
import {
  renderLeaseComment,
  listLeaseComments,
  activeLeaseFor,
  postLeaseComment,
  deleteLeaseComment,
  type WriterLease,
} from '../../src/lib/github-lease.js';

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
  assert.match(body, /token: random-token/);
});

test('github-lease: post -> list -> activeLeaseFor(期限切れ除外) -> delete の一連の流れ', (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-lease-test-'));
  const stub = createGhStub(scratchDir);
  const originalPath = process.env.PATH;
  const originalState = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  process.env.PATH = `${stub.binDir}${path.delimiter}${originalPath}`;
  process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = stub.statePath;

  t.after(() => {
    process.env.PATH = originalPath;
    if (originalState === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = originalState;
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  const issueNumber = '42';

  // 期限切れのleaseを1件、有効なleaseを1件、同一segmentで投稿する。
  const expiredLease = makeLease({
    holder: 'run-expired',
    token: 'token-expired',
    acquired_at: new Date(Date.now() - 7200_000).toISOString(),
    expires_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  const activeLease = makeLease({ holder: 'run-active', token: 'token-active' });

  const expiredCommentId = postLeaseComment(issueNumber, expiredLease);
  const activeCommentId = postLeaseComment(issueNumber, activeLease);
  assert.notEqual(expiredCommentId, activeCommentId);
  assert.match(expiredCommentId, /^\d+$/);

  const comments = listLeaseComments(issueNumber);
  assert.equal(comments.length, 2, '投稿した2件のleaseコメントが両方とも列挙されること');
  assert.ok(comments.some((c) => c.lease.writer_lease.token === 'token-expired'));
  assert.ok(comments.some((c) => c.lease.writer_lease.token === 'token-active'));

  const active = activeLeaseFor(issueNumber, 'spec');
  assert.ok(active, '有効期限内のleaseが見つかること');
  assert.equal(active!.lease.writer_lease.token, 'token-active', '期限切れのleaseは除外されること');
  assert.equal(active!.commentId, activeCommentId);

  // 別segmentでは一致しないこと。
  assert.equal(activeLeaseFor(issueNumber, 'design'), undefined);

  deleteLeaseComment(activeCommentId);

  const afterDelete = listLeaseComments(issueNumber);
  assert.equal(afterDelete.length, 1, 'delete後は残り1件のみ');
  assert.equal(afterDelete[0].lease.writer_lease.token, 'token-expired');

  assert.equal(activeLeaseFor(issueNumber, 'spec'), undefined, 'アクティブなleaseがdelete後は無いこと');
});
