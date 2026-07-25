import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { digestOf } from '../../src/lib/digest.js';
import { evidencePromptDigest, renderReviewEvidence, type ReviewEvidence } from '../../src/lib/review-evidence.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('GitHub evidence: Review API由来のStrict 2件を検証してsuccess Check Runへ結線する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-evidence-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'process/271-evidence-test']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: evidence\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add evidence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const artifact = {
    path: 'SPEC.md',
    // CLIのgit wrapperと同じく末尾改行を保持したblob内容でdigestする。
    digest: digestOf(execFileSync('git', ['show', `${targetSha}:SPEC.md`], { cwd: repo.dir, encoding: 'utf8' })),
  };
  const promptDigest = evidencePromptDigest('ISSUE-271', 'spec', targetSha, [artifact]);
  const makeEvidence = (slot: 1 | 2): ReviewEvidence => ({
    schema_version: 'agent-skill-chain/gate-review-evidence/v1',
    issue_id: 'ISSUE-271',
    gate: 'spec',
    profile: 'strict',
    target_sha: targetSha,
    reviewer: {
      run_id: `review-integration-${slot}`,
      slot,
      adapter: 'codex',
      model: 'gpt-5.6-sol',
      reasoning: 'xhigh',
      capability: {
        model_tier: 'frontier_coding',
        reasoning_tier: 'maximum_reasoning',
        read_only: true,
      },
    },
    prompt_digest: promptDigest,
    verdict: {
      conformance: 'pass',
      falsification: 'pass',
      blockers: [],
      approved_artifacts: [artifact],
      inconclusive: false,
    },
  });

  const state = stub.readState();
  state.pullMetadata = {
    user: { login: 'segment-writer' },
    head: { sha: targetSha },
    base: { sha: baseSha },
  };
  state.pullCommits = [{
    author: { login: 'segment-writer' },
    committer: { login: 'segment-writer' },
  }];
  state.pullReviews = [1, 2].map((slot) => ({
    id: slot,
    body: renderReviewEvidence(makeEvidence(slot as 1 | 2)),
    commit_id: targetSha,
    state: 'COMMENTED',
    user: { login: 'adachi-tatsuryu' },
  }));
  stub.writeState(state);

  const reportPath = path.join(repo.dir, 'verified-gate.yaml');
  const verified = runCli(
    ['gate', 'verify-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, '274', reportPath, 'ordinary'],
    { cwd: repo.dir, env },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /final: approved/);
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: { final: string; reviewers: unknown[] };
  };
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.reviewers.length, 2);

  const published = runCli(['gate', 'publish', 'ISSUE-271', reportPath], { cwd: repo.dir, env });
  assert.equal(published.status, 0, published.stderr);
  assert.equal((stub.readState() as unknown as { checkRuns: { conclusion: string }[] }).checkRuns[0].conclusion, 'success');
});
