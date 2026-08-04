import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createGhStub, type GhStub } from '../helpers/gh-stub.js';
import { createTmpRepo, type TmpRepo } from '../helpers/tmp-repo.js';
import { reviewFilePath } from '../../src/lib/local-state.js';
import {
  detectGithubReviewStatus,
  detectLocalBlockingFindings,
  formatReviewStatusBlock,
} from '../../src/lib/review-status.js';

interface GithubFixture {
  repo: TmpRepo;
  stub: GhStub;
}

function githubFixture(t: { after(callback: () => void): void }): GithubFixture {
  const repo = createTmpRepo({ backend: 'github' });
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
  return { repo, stub };
}

function commitTime(repoDir: string): string {
  return execFileSync('git', ['log', '-1', '--format=%cI', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}

test('detectGithubReviewStatus: CHANGES_REQUESTEDと直近commit後のPR/Issueコメントだけを抽出する', (t) => {
  const { repo, stub } = githubFixture(t);
  stub.seedOpenPr({ number: 71, headRefName: 'main', body: '' });
  const since = commitTime(repo.dir);
  const after = new Date(Date.parse(since) + 1000).toISOString();
  const before = new Date(Date.parse(since) - 1000).toISOString();

  stub.seedPrReviews(71, [
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer-a' }, body: 'nullの扱いを修正してください' },
    { state: 'APPROVED', author: { login: 'reviewer-b' }, body: 'approved' },
  ]);
  stub.seedPrComments(71, [
    { author: { login: 'maintainer' }, body: 'PR側の修正依頼', createdAt: after, url: 'https://example.test/pr' },
    { author: { login: 'maintainer' }, body: '古いコメント', createdAt: before },
    { author: { login: 'automation' }, body: '  <!-- agent-skill-chain:worker-report -->\nreport', createdAt: after },
  ]);
  const state = stub.readState();
  state.comments['44'] = [
    { id: '1', url: 'https://example.test/issue', body: 'Issue側の修正依頼', createdAt: after },
  ];
  stub.writeState(state);

  const result = detectGithubReviewStatus(repo.dir, '44');
  assert.ok(result && result.detection === 'succeeded');
  assert.equal(result.pr_number, 71);
  assert.equal(result.since, since);
  assert.deepEqual(result.unresolved_reviews.map((review) => review.body), ['nullの扱いを修正してください']);
  assert.deepEqual(
    result.unresolved_comments.map((comment) => [comment.source, comment.body]),
    [
      ['pr', 'PR側の修正依頼'],
      ['issue', 'Issue側の修正依頼'],
    ],
  );
  assert.match(formatReviewStatusBlock(result), /^review_status:\n {2}mode: github/m);
});

test('detectGithubReviewStatus: APPROVEDと直近commit以前のコメントだけなら未検出にする', (t) => {
  const { repo, stub } = githubFixture(t);
  stub.seedOpenPr({ number: 72, headRefName: 'main', body: '' });
  const before = new Date(Date.parse(commitTime(repo.dir)) - 1000).toISOString();
  stub.seedPrReviews(72, [{ state: 'APPROVED', author: { login: 'reviewer' }, body: 'approved' }]);
  stub.seedPrComments(72, [{ author: { login: 'maintainer' }, body: '対応済み', createdAt: before }]);

  assert.equal(detectGithubReviewStatus(repo.dir, '45'), undefined);
});

test('detectGithubReviewStatus: PR未作成時はundefinedを返す', (t) => {
  const { repo } = githubFixture(t);
  assert.equal(detectGithubReviewStatus(repo.dir, '46'), undefined);
});

test('detectGithubReviewStatus: gh取得失敗をレビュー無しとして握りつぶさない', (t) => {
  const { repo, stub } = githubFixture(t);
  stub.seedOpenPr({ number: 73, headRefName: 'main', body: '' });
  const state = stub.readState();
  state.failPrReviewStatusView = true;
  stub.writeState(state);

  const result = detectGithubReviewStatus(repo.dir, '47');
  assert.deepEqual(result?.mode, 'github');
  assert.deepEqual(result?.detection, 'failed');
  assert.match(result && result.detection === 'failed' ? result.reason : '', /review status view failure/);
});

test('detectLocalBlockingFindings: origin付きblocking findingだけを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const reportPath = reviewFilePath(repo.dir, '48', 'design');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    stringify({
      gate: {
        blockers: [
          { severity: 'blocking', origin: 'design', code: 'AC-2', evidence: ['設計要素が欠落'] },
          { severity: 'warning', origin: 'design', code: 'WARN-1', evidence: ['表現を改善できる'] },
        ],
      },
    }),
  );

  const result = detectLocalBlockingFindings(repo.dir, '48', 'design');
  assert.ok(result);
  assert.equal(result.unresolved_blocking_findings.length, 1);
  assert.equal(result.unresolved_blocking_findings[0].code, 'AC-2');
});

test('detectLocalBlockingFindings: 壊れたYAMLはworker起動をクラッシュさせずundefinedを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const reportPath = reviewFilePath(repo.dir, '49', 'implementation');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, 'gate: [\n');

  assert.equal(detectLocalBlockingFindings(repo.dir, '49', 'implementation'), undefined);
});
