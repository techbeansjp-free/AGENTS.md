import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createTmpRepo, setIssueSync } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub, type GhStub } from '../helpers/gh-stub.js';
import { SYNC_BEGIN_MARKER, SYNC_END_MARKER } from '../../src/lib/issue-sync.js';

// Issue #354 / ADR-0021: GitHubモードで `issue_sync` を有効化した場合に、ゲート通過ごとに
// 成果物全文とゲート状態を Issue/PR 本文の固定マーカー区間へ一方向転記する挙動を検証する。
// 実 GitHub API へは一切アクセスせず、gh-stub 経由の模擬のみで完結する。

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ISSUE_NUMBER = '7';
const HUMAN_BODY = ['# 人間が書いた説明', '', '## 背景', 'この段落はマーカー区間の外にある。'].join('\n');

const SPEC_TEXT = '# SPEC\n\nAC-1: 成果物全文をIssue本文へ転記する\n';
const DESIGN_TEXT = '# DESIGN\n\nマーカー区間のみを機械が書き換える。\n';

interface Fixture {
  stub: GhStub;
  env: NodeJS.ProcessEnv;
  repoDir: string;
  targetSha: string;
}

function setupRepo(
  t: TestContext,
  options: {
    issueSync?: { enabled: boolean; target?: 'issue_body' | 'pr_body' | 'both'; maxBodyChars?: number };
    specText?: string;
  } = {},
): Fixture {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-issue-sync-'));
  const stub = createGhStub(scratchDir);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), options.specText ?? SPEC_TEXT, 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'DESIGN.md'), DESIGN_TEXT, 'utf8');
  execFileSync('git', ['add', 'SPEC.md', 'DESIGN.md'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: add artifacts'], { cwd: repo.dir, stdio: 'pipe' });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  if (options.issueSync) setIssueSync(repo.dir, options.issueSync);
  stub.seedIssueBody(ISSUE_NUMBER, HUMAN_BODY);

  return { stub, env: stub.env(process.env), repoDir: repo.dir, targetSha };
}

function publishApprovedGate(fixture: Fixture, gateId = 'spec'): { status: number; stdout: string; stderr: string } {
  const report = {
    schema_version: 'agent-skill-chain/gate-report/v1',
    gate: {
      id: gateId,
      target_sha: fixture.targetSha,
      conformance: 'pass',
      falsification: 'pass',
      final: 'approved',
      blockers: [],
      approved_digest: ZERO_DIGEST,
      approved_artifacts: [],
    },
  };
  const reportPath = path.join(fixture.repoDir, `${gateId}-report.yaml`);
  fs.writeFileSync(reportPath, stringify(report), 'utf8');
  return runCli(['gate', 'publish', `ISSUE-${ISSUE_NUMBER}`, reportPath], {
    cwd: fixture.repoDir,
    env: fixture.env,
  });
}

function issueBody(stub: GhStub): string {
  return (stub.readState().issueBodies ?? {})[ISSUE_NUMBER] ?? '';
}

test('issue-sync: 明示的に issue_sync.enabled: false を設定した場合は Issue 本文が一切変更されない', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: false } });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);

  const state = fixture.stub.readState();
  assert.equal(issueBody(fixture.stub), HUMAN_BODY, '本文は投入時のまま保持されること');
  assert.equal(state.issueEditBodyCalls, undefined, '本文の書込みが一度も呼ばれないこと');
  assert.doesNotMatch(published.stderr, /issue-sync/);
});

test('issue-sync: 設定ファイルを一切上書きしない場合、実際の既定値（enabled: true）でマーカー区間へ転記される（ISSUE-567）', async (t) => {
  const fixture = setupRepo(t);

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);

  const body = issueBody(fixture.stub);
  assert.ok(body.startsWith(HUMAN_BODY), 'マーカー外の人間記述部分が先頭にそのまま残ること');
  assert.ok(body.includes(SYNC_BEGIN_MARKER) && body.includes(SYNC_END_MARKER), 'マーカー区間が存在すること');
  assert.ok(body.includes('AC-1: 成果物全文をIssue本文へ転記する'), 'SPEC.md の全文が既定値のまま転記されること');
});

test('issue-sync: 有効時はマーカー区間へ成果物全文が書かれ、マーカー外の人間記述は保持される', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'issue_body' } });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);

  const body = issueBody(fixture.stub);
  assert.ok(body.startsWith(HUMAN_BODY), 'マーカー外の人間記述部分が先頭にそのまま残ること');
  assert.ok(body.includes(SYNC_BEGIN_MARKER) && body.includes(SYNC_END_MARKER), 'マーカー区間が存在すること');

  const block = body.slice(body.indexOf(SYNC_BEGIN_MARKER), body.indexOf(SYNC_END_MARKER));
  assert.ok(block.includes('AC-1: 成果物全文をIssue本文へ転記する'), 'SPEC.md の全文が区間内にあること');
  assert.ok(block.includes('マーカー区間のみを機械が書き換える。'), 'DESIGN.md の全文が区間内にあること');
  assert.ok(block.includes(fixture.targetSha), '最終同期 commit が記録されること');
  assert.match(block, /spec-gate: approved/);
  assert.match(block, /validation-gate: 未到達/);

  // 同一内容の再転記は本文を変えず、マーカー区間も増殖しない。
  const second = publishApprovedGate(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(issueBody(fixture.stub), body, '内容に変化が無ければ本文は同一のままであること');
  assert.equal(body.split(SYNC_BEGIN_MARKER).length - 1, 1, 'マーカー区間は1つだけであること');
});

test('issue-sync: 対象PRが0件でも publish は失敗せず、理由を出してスキップする', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'pr_body' } });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stderr, /open な PR が見つからない/);
  assert.equal(fixture.stub.readState().prEditBodyCalls, undefined, 'PR 本文の書込みが呼ばれないこと');
});

test('issue-sync: 対象PRが複数該当する場合は一意に定まらないためスキップする', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'pr_body' } });
  fixture.stub.seedOpenPr({
    number: 11,
    headRefName: `feature/${ISSUE_NUMBER}-first`,
    body: `Closes #${ISSUE_NUMBER}`,
  });
  fixture.stub.seedOpenPr({
    number: 12,
    headRefName: `feature/${ISSUE_NUMBER}-second`,
    body: `Closes #${ISSUE_NUMBER}`,
  });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stderr, /2 件あり一意に定まらない/);
  assert.equal(fixture.stub.readState().prEditBodyCalls, undefined, 'PR 本文の書込みが呼ばれないこと');
});

test('issue-sync: 対象PRが一意なら PR 本文のマーカー区間へ転記する', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'pr_body' } });
  fixture.stub.seedOpenPr({
    number: 21,
    headRefName: `feature/${ISSUE_NUMBER}-only`,
    body: `PR の説明\n\nCloses #${ISSUE_NUMBER}`,
  });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);

  const state = fixture.stub.readState();
  assert.deepEqual(state.prEditBodyCalls, [{ number: '21' }]);
  const prBody = (state.prBodies ?? {})['21'] ?? '';
  assert.ok(prBody.startsWith('PR の説明'), 'マーカー外の記述が保持されること');
  assert.ok(prBody.includes('AC-1: 成果物全文をIssue本文へ転記する'), 'SPEC.md の全文が転記されること');
  assert.equal(issueBody(fixture.stub), HUMAN_BODY, 'target: pr_body では Issue 本文は変更されないこと');
});

test('issue-sync: 書込み直前の競合を検知したらリトライののちスキップし、publish は成功のまま', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'issue_body' } });
  // 読み取りのたびに別プロセスがマーカー区間を書き換える状態にし、再取得後も不一致を継続させる。
  fixture.stub.simulateConcurrentBodyWrites(3);

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stderr, /別プロセスから更新されたため転記をスキップ/);

  const state = fixture.stub.readState();
  assert.equal(state.issueEditBodyCalls, undefined, '競合検知時は本文を書き込まないこと');
  assert.ok(issueBody(fixture.stub).includes('concurrent write #'), '別プロセスの書込みが残っていること');
});

test('gate publish (ISSUE-593): Check Run発行が失敗してもissue-syncは独立して試行され、失敗理由と転記結果の両方が出力に含まれる', async (t) => {
  const fixture = setupRepo(t, { issueSync: { enabled: true, target: 'issue_body' } });
  fixture.stub.failCheckRunPost('gh-stub: simulated check-run failure (personal account token)');

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 1, '個人アカウント認証相当のCheck Run発行失敗はpublish失敗として伝播すること');
  assert.match(published.stderr, /Check Run 発行に失敗しました/);

  const body = issueBody(fixture.stub);
  assert.ok(body.startsWith(HUMAN_BODY), 'マーカー外の人間記述部分が先頭にそのまま残ること');
  assert.ok(
    body.includes(SYNC_BEGIN_MARKER) && body.includes('AC-1: 成果物全文をIssue本文へ転記する'),
    'Check Run発行失敗とは独立してissue-syncのIssue本文転記が実行されること',
  );
});

test('issue-sync: 本文上限を超える場合は全文ではなく Git 側参照の案内文へ切り替える', async (t) => {
  const bulkyLine = 'この行は本文上限超過を再現するための繰り返し行である。\n';
  const fixture = setupRepo(t, {
    issueSync: { enabled: true, target: 'issue_body', maxBodyChars: 600 },
    specText: `# SPEC\n\nAC-1: 上限超過の再現\n\n${bulkyLine.repeat(40)}`,
  });

  const published = publishApprovedGate(fixture);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stderr, /上限 600 文字を超えるため/);

  const body = issueBody(fixture.stub);
  assert.ok(body.startsWith(HUMAN_BODY), 'マーカー外の人間記述部分が保持されること');
  assert.ok(body.length <= 600, `本文が上限内に収まること（実測 ${body.length} 文字）`);
  assert.ok(!body.includes(bulkyLine), '全文は転記されないこと');
  assert.match(body, /全文は .* を Git 側で参照してください/);
  assert.ok(body.includes(fixture.targetSha), '案内文に最終同期 commit が含まれること');
  assert.match(body, /spec-gate: approved/, '上限超過時もゲート状態は残ること');
});
