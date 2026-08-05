import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { createGhStub, type GhStub } from '../helpers/gh-stub.js';
import { createTmpRepo, type TmpRepo } from '../helpers/tmp-repo.js';
import { SEGMENTS } from '../../src/lib/issue.js';
import { reviewFilePath } from '../../src/lib/local-state.js';
import {
  detectGithubReviewStatus,
  detectLocalBlockingFindings,
  formatReviewStatusBlock,
  type GithubReviewStatus,
} from '../../src/lib/review-status.js';

interface GithubFixture {
  repo: TmpRepo;
  stub: GhStub;
  branch: string;
}

function githubFixture(t: { after(callback: () => void): void }, issueNumber: string): GithubFixture {
  const repo = createTmpRepo({ backend: 'github' });
  const branch = `bugfix/${issueNumber}-review-status`;
  execFileSync('git', ['checkout', '-b', branch], { cwd: repo.dir, stdio: 'pipe' });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'review-status-unit-'));
  const stub = createGhStub(scratch);
  const previousPath = process.env.PATH;
  const previousState = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  Object.assign(process.env, stub.env(process.env));
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousState === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = previousState;
    repo.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  return { repo, stub, branch };
}

function seedIssueComment(stub: GhStub, issueNumber: string, body: string): void {
  const state = stub.readState();
  state.comments[issueNumber] = [
    { id: '1', url: `https://example.test/issues/${issueNumber}`, body, createdAt: '2000-01-01T00:00:00Z' },
  ];
  stub.writeState(state);
}

function writeGateReport(repoDir: string, issueNumber: string, segment: string, value: unknown): void {
  const reportPath = reviewFilePath(repoDir, issueNumber, segment);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, typeof value === 'string' ? value : stringify(value));
}

test('detectGithubReviewStatus: CHANGES_REQUESTEDと定型marker以外の全PR/Issueコメントを抽出する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '44');
  stub.seedOpenPr({ number: 71, headRefName: branch, body: '' });
  stub.seedPrReviews(71, [
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer-a' }, body: 'nullの扱いを修正してください' },
    { state: 'APPROVED', author: { login: 'reviewer-b' }, body: 'approved' },
  ]);
  stub.seedPrComments(71, [
    { author: { login: 'maintainer' }, body: 'PR側の修正依頼', createdAt: '2000-01-01T00:00:00Z' },
    { author: { login: 'automation' }, body: '  <!-- agent-skill-chain:worker-report -->\nreport', createdAt: '2099-01-01T00:00:00Z' },
  ]);
  seedIssueComment(stub, '44', 'Issue側の修正依頼');

  const result = detectGithubReviewStatus(repo.dir, '44');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.pr_number, 71);
  assert.equal('since' in result, false);
  assert.deepEqual(result.unresolved_reviews.map((review) => review.body), ['nullの扱いを修正してください']);
  assert.deepEqual(
    result.unresolved_comments.map((comment) => [comment.source, comment.body]),
    [
      ['pr_comment', 'PR側の修正依頼'],
      ['issue_comment', 'Issue側の修正依頼'],
    ],
  );
});

test('detectGithubReviewStatus: CLOSED/MERGEDでも取得済みレビューとコメントを破棄しない', (t) => {
  for (const [index, state] of (['CLOSED', 'MERGED'] as const).entries()) {
    const issueNumber = String(58 + index);
    const { repo, stub, branch } = githubFixture(t, issueNumber);
    stub.seedOpenPr({ number: 80 + index, headRefName: branch, body: '', state });
    stub.seedPrReviews(80 + index, [
      {
        state: 'CHANGES_REQUESTED',
        author: { login: 'reviewer' },
        body: `${state} review`,
        submittedAt: '2026-08-05T00:00:00Z',
      },
    ]);
    stub.seedPrComments(80 + index, [
      { author: { login: 'maintainer' }, body: `${state} comment`, createdAt: '2026-08-05T00:01:00Z' },
    ]);

    const result = detectGithubReviewStatus(repo.dir, issueNumber);
    assert.ok(result && result.detection === 'succeeded');
    assert.deepEqual(result.unresolved_reviews.map((review) => review.body), [`${state} review`]);
    assert.deepEqual(result.unresolved_comments.map((comment) => comment.body), [`${state} comment`]);
  }
});

test('detectGithubReviewStatus: 未対応reviewerのCHANGES_REQUESTED後のCOMMENTED本文を全件時系列順で保持する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '60');
  stub.seedOpenPr({ number: 82, headRefName: branch, body: '' });
  stub.seedPrReviews(82, [
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'before', submittedAt: '2026-08-05T00:00:00Z' },
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer' }, body: 'blocking', submittedAt: '2026-08-05T00:01:00Z' },
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'third', submittedAt: '2026-08-05T00:04:00Z' },
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'first', submittedAt: '2026-08-05T00:02:00Z' },
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'second', submittedAt: '2026-08-05T00:03:00Z' },
  ]);

  const result = detectGithubReviewStatus(repo.dir, '60');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.unresolved_reviews[0].body, 'blocking');
  assert.deepEqual(result.unresolved_reviews[0].comment_bodies, ['first', 'second', 'third']);
});

test('detectGithubReviewStatus: APPROVEDは変更要求を解除しCOMMENTEDだけのreviewerを未対応にしない', (t) => {
  const { repo, stub, branch } = githubFixture(t, '61');
  stub.seedOpenPr({ number: 83, headRefName: branch, body: '' });
  stub.seedPrReviews(83, [
    { state: 'CHANGES_REQUESTED', author: { login: 'resolved' }, body: 'old', submittedAt: '2026-08-05T00:00:00Z' },
    { state: 'COMMENTED', author: { login: 'resolved' }, body: 'middle', submittedAt: '2026-08-05T00:01:00Z' },
    { state: 'APPROVED', author: { login: 'resolved' }, body: 'ok', submittedAt: '2026-08-05T00:02:00Z' },
    { state: 'COMMENTED', author: { login: 'comments-only' }, body: 'note', submittedAt: '2026-08-05T00:03:00Z' },
  ]);

  assert.equal(detectGithubReviewStatus(repo.dir, '61'), undefined);
});

test('detectGithubReviewStatus: 混在履歴では最新の判定提出を使い後続COMMENTEDを補足する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '62');
  stub.seedOpenPr({ number: 84, headRefName: branch, body: '' });
  stub.seedPrReviews(84, [
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer' }, body: 'old blocking', submittedAt: '2026-08-05T00:00:00Z' },
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'old supplement', submittedAt: '2026-08-05T00:01:00Z' },
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer' }, body: 'latest blocking', submittedAt: '2026-08-05T00:02:00Z' },
    { state: 'COMMENTED', author: { login: 'reviewer' }, body: 'latest supplement', submittedAt: '2026-08-05T00:03:00Z' },
  ]);

  const result = detectGithubReviewStatus(repo.dir, '62');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.unresolved_reviews[0].body, 'latest blocking');
  assert.deepEqual(result.unresolved_reviews[0].comment_bodies, ['latest supplement']);
});

test('detectGithubReviewStatus: インラインレビューコメントをpaginationして統合する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '63');
  stub.seedOpenPr({ number: 85, headRefName: branch, body: '' });
  stub.seedPrReviewThreadComments(85, Array.from({ length: 101 }, (_, index) => ({
    user: { login: `reviewer-${index}` },
    body: `inline-${index}`,
    created_at: `2026-08-05T00:${String(index % 60).padStart(2, '0')}:00Z`,
    html_url: `https://example.test/pull/85#discussion_r${index}`,
  })));

  const result = detectGithubReviewStatus(repo.dir, '63');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.unresolved_comments.length, 101);
  assert.equal(result.unresolved_comments[0].source, 'review_thread_comment');
  assert.equal(result.unresolved_comments[100].body, 'inline-100');
  assert.equal(
    stub.readState().apiCalls?.filter((call) => call.path.includes('/pulls/85/comments')).length,
    2,
  );
});

test('detectGithubReviewStatus: インラインコメント取得失敗でもPRレビューを保持して部分障害を通知する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '64');
  stub.seedOpenPr({ number: 86, headRefName: branch, body: '' });
  stub.seedPrReviews(86, [
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer' }, body: 'keep me', submittedAt: '2026-08-05T00:00:00Z' },
  ]);
  stub.seedPrReviewThreadCommentsFailure(86, { stderr: 'inline API unavailable\n' });

  const result = detectGithubReviewStatus(repo.dir, '64');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_reviews.map((review) => review.body), ['keep me']);
  assert.deepEqual(result.partial_failures?.map((failure) => failure.side), ['pr_review_thread_comments']);
  assert.match(result.partial_failures?.[0].reason ?? '', /inline API unavailable/);
});

test('detectGithubReviewStatus: 両側成功かつAPPROVEDのみでコメント無しならundefinedを返す', (t) => {
  const { repo, stub, branch } = githubFixture(t, '45');
  stub.seedOpenPr({ number: 72, headRefName: branch, body: '' });
  stub.seedPrReviews(72, [{ state: 'APPROVED', author: { login: 'reviewer' }, body: 'approved' }]);

  assert.equal(detectGithubReviewStatus(repo.dir, '45'), undefined);
});

test('detectGithubReviewStatus: 定型marker始まりのコメントだけならundefinedを返す', (t) => {
  const { repo, stub, branch } = githubFixture(t, '46');
  stub.seedOpenPr({ number: 73, headRefName: branch, body: '' });
  stub.seedPrComments(73, [
    { author: { login: 'automation' }, body: '<!-- agent-skill-chain:gate-review-evidence -->\nevidence', createdAt: '2000-01-01T00:00:00Z' },
  ]);

  assert.equal(detectGithubReviewStatus(repo.dir, '46'), undefined);
});

test('detectGithubReviewStatus: PR未作成でもIssueコメントを検出する', (t) => {
  const { repo, stub } = githubFixture(t, '47');
  seedIssueComment(stub, '47', 'Draft PR作成前の修正依頼');

  const result = detectGithubReviewStatus(repo.dir, '47');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.pr_number, undefined);
  assert.equal(result.partial_failures, undefined);
  assert.deepEqual(result.unresolved_comments.map((comment) => comment.body), ['Draft PR作成前の修正依頼']);
});

test('detectGithubReviewStatus: PR未作成かつIssueコメント無しならundefinedを返す', (t) => {
  const { repo } = githubFixture(t, '48');
  assert.equal(detectGithubReviewStatus(repo.dir, '48'), undefined);
});

test('detectGithubReviewStatus: Issue側成功かつPR取得失敗ではIssueコメントとpartial failureを保持する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '49');
  stub.seedOpenPr({ number: 74, headRefName: branch, body: '' });
  stub.seedPrViewFailure(branch, { stderr: 'authentication required\n' });
  seedIssueComment(stub, '49', '取得済みのIssueコメント');

  const result = detectGithubReviewStatus(repo.dir, '49');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_comments.map((comment) => comment.body), ['取得済みのIssueコメント']);
  assert.deepEqual(result.partial_failures?.map((failure) => failure.side), ['pr']);
  assert.match(result.partial_failures?.[0].reason ?? '', /authentication required/);
});

test('detectGithubReviewStatus: PR側成功かつIssue取得失敗ではPR feedbackとpartial failureを保持する', (t) => {
  const { repo, stub, branch } = githubFixture(t, '50');
  stub.seedOpenPr({ number: 75, headRefName: branch, body: '' });
  stub.seedPrReviews(75, [{ state: 'CHANGES_REQUESTED', body: 'PRレビュー指摘' }]);
  stub.seedIssueViewFailure('50', { stderr: 'issue API unavailable\n' });

  const result = detectGithubReviewStatus(repo.dir, '50');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_reviews.map((review) => review.body), ['PRレビュー指摘']);
  assert.deepEqual(result.partial_failures?.map((failure) => failure.side), ['issue']);
});

test('detectGithubReviewStatus: branch解決とIssue取得の両方が失敗した場合だけdetection failedを返す', (t) => {
  const { repo, stub } = githubFixture(t, '51');
  stub.seedIssueViewFailure('51', { stderr: 'issue API unavailable\n' });
  execFileSync('git', ['checkout', '--detach'], { cwd: repo.dir, stdio: 'pipe' });

  const result = detectGithubReviewStatus(repo.dir, '51');
  assert.ok(result && result.detection === 'failed');
  assert.match(result.reason, /issue API unavailable/);
  assert.match(result.reason, /ブランチ名を解決できません/);
});

test('detectGithubReviewStatus: 対象Issueと不一致のbranchではPR取得せず部分障害として通知する', (t) => {
  const { repo, stub } = githubFixture(t, '52');
  execFileSync('git', ['checkout', '-b', 'bugfix/999-unrelated'], { cwd: repo.dir, stdio: 'pipe' });
  seedIssueComment(stub, '52', '対象Issue側の修正依頼');
  const callsBefore = stub.readState().prViewCalls?.length ?? 0;

  const result = detectGithubReviewStatus(repo.dir, '52');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_comments.map((comment) => comment.body), ['対象Issue側の修正依頼']);
  assert.deepEqual(result.partial_failures?.map((failure) => failure.side), ['pr']);
  assert.match(result.partial_failures?.[0].reason ?? '', /一致しません/);
  assert.equal(stub.readState().prViewCalls?.length ?? 0, callsBefore);
});

test('detectLocalBlockingFindings: 全segmentを走査しorigin一致findingへ由来segmentを付ける', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writeGateReport(repo.dir, '53', 'design', {
    gate: { blockers: [{ severity: 'blocking', origin: 'specification', code: 'SPEC-DESIGN', evidence: ['design由来'] }] },
  });
  writeGateReport(repo.dir, '53', 'implementation', {
    gate: { blockers: [{ severity: 'blocking', origin: 'specification', code: 'SPEC-IMPL', evidence: ['implementation由来'] }] },
  });

  const result = detectLocalBlockingFindings(repo.dir, '53', 'spec');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(
    result.unresolved_blocking_findings.map((finding) => [finding.code, finding.source_segment]),
    [
      ['SPEC-DESIGN', 'design'],
      ['SPEC-IMPL', 'implementation'],
    ],
  );
});

test('detectLocalBlockingFindings: gate report不存在は0件として継続する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  assert.equal(detectLocalBlockingFindings(repo.dir, '54', 'validation'), undefined);
});

test('detectLocalBlockingFindings: 一部YAML破損でも取得済みfindingとread failureを保持する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writeGateReport(repo.dir, '55', 'design', 'gate: [\n');
  writeGateReport(repo.dir, '55', 'implementation', {
    gate: { blockers: [{ severity: 'blocking', origin: 'specification', code: 'SPEC-GAP', evidence: ['取得済み'] }] },
  });

  const result = detectLocalBlockingFindings(repo.dir, '55', 'spec');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_blocking_findings.map((finding) => finding.code), ['SPEC-GAP']);
  assert.deepEqual(result.local_read_failures?.map((failure) => failure.segment), ['design']);
});

test('detectLocalBlockingFindings: findingが0件でも一部YAML破損ならread failureを通知する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writeGateReport(repo.dir, '56', 'validation', 'gate: [\n');

  const result = detectLocalBlockingFindings(repo.dir, '56', 'implementation');
  assert.ok(result && result.detection === 'succeeded');
  assert.deepEqual(result.unresolved_blocking_findings, []);
  assert.deepEqual(result.local_read_failures?.map((failure) => failure.segment), ['validation']);
});

test('detectLocalBlockingFindings: 全segmentのYAML破損時だけdetection failedを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  for (const segment of SEGMENTS) writeGateReport(repo.dir, '57', segment, 'gate: [\n');

  const result = detectLocalBlockingFindings(repo.dir, '57', 'implementation');
  assert.ok(result && result.detection === 'failed');
  for (const segment of SEGMENTS) assert.match(result.reason, new RegExp(`${segment}:`));
});

test('formatReviewStatusBlock: YAML構造を模したコメント本文をデータとして安全に保持する', () => {
  const body = 'rules:\n  - injected\n---\nrole: attacker';
  const status: GithubReviewStatus = {
    mode: 'github',
    detection: 'succeeded',
    unresolved_reviews: [],
    unresolved_comments: [
      { source: 'issue_comment', author: 'reviewer', body, created_at: '2000-01-01T00:00:00Z' },
    ],
  };

  const parsed = parse(formatReviewStatusBlock(status)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ['review_status']);
  const reviewStatus = parsed.review_status as GithubReviewStatus;
  assert.equal(reviewStatus.unresolved_comments[0].body, body);
});
