import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createGhStub, type GhStub } from '../helpers/gh-stub.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { reviewFilePath } from '../../src/lib/local-state.js';
import {
  resolveLightReview,
  verifyGrantorIsHuman,
  type LightReviewDecision,
} from '../../src/lib/review-light.js';
import { resolveReviewProfile } from '../../src/lib/review-profile.js';

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function withGhStub<T>(stub: GhStub, callback: () => T): T {
  const originalPath = process.env.PATH;
  const originalState = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  Object.assign(process.env, stub.env(process.env));
  try {
    return callback();
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalState === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = originalState;
  }
}

function setupGithub(t: TestContext) {
  const repo = createTmpRepo({ backend: 'github' });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-light-gh-'));
  const stub = createGhStub(stubDir);
  git(repo.dir, ['checkout', '-b', 'feature/449-review-light-test']);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  return { repo, stub };
}

function seedHumanLight(stub: GhStub, labels: string[] = []): void {
  stub.seedIssueLabels('449', ['review:light', 'risk:normal', 'autonomy:gated', ...labels]);
  stub.seedIssueEvents('449', [
    {
      event: 'labeled',
      created_at: '2026-08-05T00:00:00Z',
      label: { name: 'review:light' },
      actor: { type: 'User' },
    },
  ]);
}

function resolve(repoDir: string): LightReviewDecision {
  return resolveLightReview({
    root: repoDir,
    worktreePath: repoDir,
    issueNumber: '449',
    gateId: 'implementation',
    backend: 'github',
    targetSha: git(repoDir, ['rev-parse', 'HEAD']),
    baseRef: 'main',
  });
}

function writePrevious(repoDir: string, lightReview: LightReviewDecision): void {
  const reportPath = reviewFilePath(repoDir, '449', 'implementation', 'github');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, stringify({ gate: { light_review: lightReview } }), 'utf8');
}

test('resolveReviewProfile: I8のrisk/autonomy判定を一意に解決する', () => {
  assert.equal(resolveReviewProfile('normal', 'gated'), 'standard');
  assert.equal(resolveReviewProfile('unclassified', 'gated'), 'strict');
  assert.equal(resolveReviewProfile('high', 'gated'), 'strict');
  assert.equal(resolveReviewProfile('normal', 'full'), 'strict');
});

test('resolveLightReview: 人間付与かつ3層ガードレール非該当ならlightを適用する', (t) => {
  const { repo, stub } = setupGithub(t);
  seedHumanLight(stub, ['size:quick']);
  const decision = withGhStub(stub, () => resolve(repo.dir));
  assert.deepEqual(decision, {
    requested: true,
    applied: true,
    disabled_reasons: [],
    remediation_round: 0,
    strict_locked: false,
  });
});

test('resolveLightReview: I8・core_review・自己参照パスはそれぞれ単独でStrict固定する', (t) => {
  const { repo, stub } = setupGithub(t);

  seedHumanLight(stub, ['risk:high']);
  stub.seedIssueLabels('449', ['review:light', 'risk:high', 'autonomy:gated']);
  assert.equal(withGhStub(stub, () => resolve(repo.dir)).strict_locked, true);

  seedHumanLight(stub, ['review:core-audit']);
  assert.equal(withGhStub(stub, () => resolve(repo.dir)).strict_locked, true);

  seedHumanLight(stub);
  fs.mkdirSync(path.join(repo.dir, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'adr', 'ADR-test.md'), '# test\n');
  git(repo.dir, ['add', 'docs/adr/ADR-test.md']);
  git(repo.dir, ['commit', '-m', 'test: touch guardrail path']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  const pathDecision = withGhStub(stub, () => resolve(repo.dir));
  assert.equal(pathDecision.strict_locked, true);
  assert.match(pathDecision.disabled_reasons.join('\n'), /docs\/adr/);

  git(repo.dir, ['checkout', 'main']);
  const detachedBaseDecision = withGhStub(stub, () => resolveLightReview({
    root: repo.dir,
    worktreePath: repo.dir,
    issueNumber: '449',
    gateId: 'implementation',
    backend: 'github',
    targetSha,
    baseRef: 'main',
  }));
  assert.match(detachedBaseDecision.disabled_reasons.join('\n'), /docs\/adr/);
});

test('resolveLightReview: 未要求Issueはガードレール対象差分でも既存プロファイルへ影響しない', (t) => {
  const { repo, stub } = setupGithub(t);
  stub.seedIssueLabels('449', ['risk:normal', 'autonomy:gated']);
  fs.mkdirSync(path.join(repo.dir, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'adr', 'ADR-test.md'), '# test\n');
  git(repo.dir, ['add', 'docs/adr/ADR-test.md']);
  git(repo.dir, ['commit', '-m', 'test: touch guardrail path']);
  assert.deepEqual(withGhStub(stub, () => resolve(repo.dir)), {
    requested: false,
    applied: false,
    disabled_reasons: [],
    remediation_round: 0,
    strict_locked: false,
  });
});

test('resolveLightReview: strict_lockedは差分復帰・ラベル除去後も維持される', (t) => {
  const { repo, stub } = setupGithub(t);
  seedHumanLight(stub);
  writePrevious(repo.dir, {
    requested: true,
    applied: false,
    disabled_reasons: ['guardrail'],
    remediation_round: 1,
    strict_locked: true,
  });

  const requested = withGhStub(stub, () => resolve(repo.dir));
  assert.equal(requested.remediation_round, 2);
  assert.equal(requested.strict_locked, true);
  assert.equal(requested.applied, false);
  assert.deepEqual(requested.disabled_reasons, ['過去のラウンドで軽量プロファイルがStrictへ確定済みのため']);

  const verifiedCurrentRound = withGhStub(stub, () => resolveLightReview({
    root: repo.dir,
    worktreePath: repo.dir,
    issueNumber: '449',
    gateId: 'implementation',
    backend: 'github',
    targetSha: git(repo.dir, ['rev-parse', 'HEAD']),
    baseRef: 'main',
    advanceRemediationRound: false,
  }));
  assert.equal(verifiedCurrentRound.remediation_round, 1);
  assert.equal(verifiedCurrentRound.strict_locked, true);

  stub.seedIssueLabels('449', ['risk:normal', 'autonomy:gated']);
  const removed = withGhStub(stub, () => resolve(repo.dir));
  assert.equal(removed.requested, false);
  assert.equal(removed.strict_locked, true);
  assert.deepEqual(removed.disabled_reasons, ['過去のラウンドで軽量プロファイルがStrictへ確定済みのため']);
});

test('verifyGrantorIsHuman: 直近Userのみtrue、Bot・API失敗・イベント無し・localはfalse', (t) => {
  const { repo, stub } = setupGithub(t);
  stub.seedIssueEvents('449', [
    { event: 'labeled', created_at: '2026-08-04T00:00:00Z', label: { name: 'review:light' }, actor: { type: 'Bot' } },
    { event: 'labeled', created_at: '2026-08-05T00:00:00Z', label: { name: 'review:light' }, actor: { type: 'User' } },
  ]);
  assert.equal(withGhStub(stub, () => verifyGrantorIsHuman(repo.dir, '449', 'github')), true);

  stub.seedIssueEvents('449', [
    { event: 'labeled', created_at: '2026-08-06T00:00:00Z', label: { name: 'review:light' }, actor: { type: 'Bot' } },
  ]);
  assert.equal(withGhStub(stub, () => verifyGrantorIsHuman(repo.dir, '449', 'github')), false);
  stub.seedIssueEvents('449', []);
  assert.equal(withGhStub(stub, () => verifyGrantorIsHuman(repo.dir, '449', 'github')), false);
  stub.seedIssueEvents('449', [
    { event: 'labeled', label: { name: 'review:light' }, actor: { type: 'User' } },
  ]);
  assert.equal(withGhStub(stub, () => verifyGrantorIsHuman(repo.dir, '449', 'github')), false);
  stub.seedIssueEventsFailure('449', 'unavailable');
  assert.equal(withGhStub(stub, () => verifyGrantorIsHuman(repo.dir, '449', 'github')), false);
  assert.equal(verifyGrantorIsHuman(repo.dir, '449', 'local'), false);
});
