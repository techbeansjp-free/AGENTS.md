import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { parseReviewEvidence } from '../../src/lib/review-evidence.js';
import { packageRoot } from '../../src/lib/paths.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('gate submit-evidence: recorderの前進を許容しつつ受理条件と入力をtrusted baseへ固定する（Issue #703 AC-1〜AC-7）', (t) => {
  // Issue #759: 準備段が生成する launcher token は trusted_root と procurement を必須にする。
  // 記録時の再検証は調達モードを base SHA のコミット内容から独立に再導出するため、本 fixture は
  // agent-skill-chain 本体を名乗る package.json を持つ形状（clone_build 経路）で組む。
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-evidence-reachability-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const issueWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-issue-worktree-'));
  fs.rmdirSync(issueWorktree);
  let issueWorktreeCreated = false;
  t.after(() => {
    if (issueWorktreeCreated) {
      execFileSync('git', ['worktree', 'remove', '--force', issueWorktree], { cwd: repo.dir, stdio: 'pipe' });
    }
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'bugfix/703-evidence-target']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: recorder reachability\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add recorder reachability target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const verdict = JSON.stringify({
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  });
  let invocation = 0;
  function submit(options: {
    cwd?: string;
    baseArg?: string;
    trustedBaseArg?: string;
    metadataBase?: string;
    metadataBaseRef?: string;
    metadataHead?: string;
  } = {}): ReturnType<typeof runCli> {
    invocation += 1;
    const attemptId = `attempt-reachability-${invocation}`;
    const runId = `review-reachability-${invocation}`;
    const baseArg = options.baseArg ?? baseSha;
    const trustedBaseArg = options.trustedBaseArg ?? baseSha;
    const state = stub.readState();
    state.pullMetadata = {
      number: 780,
      state: 'open',
      head: { sha: options.metadataHead ?? targetSha, ref: 'bugfix/703-evidence-target' },
      base: { sha: options.metadataBase ?? baseSha, ref: options.metadataBaseRef ?? 'main' },
    };
    stub.writeState(state);
    const tokenPath = path.join(tokenDir, `${attemptId}.json`);
    fs.writeFileSync(tokenPath, `${JSON.stringify({
      schema_version: 'agent-skill-chain/launcher-token/v1',
      attempt_id: attemptId,
      expected_count: 1,
      profile: 'standard',
      target_sha: targetSha,
      base_sha: baseArg,
      pr_number: '780',
      nonce: invocation.toString(16).padStart(48, '0'),
      trusted_root: packageRoot(),
      procurement: { mode: 'clone_build', source: `clone_build:${trustedBaseArg}` },
      slots: [{ slot: 1, run_id: runId }],
      consumed_slots: [],
    })}\n`, { mode: 0o600 });
    return runCli(
      [
        'gate', 'submit-evidence', 'ISSUE-703', 'spec', 'standard', targetSha, baseArg,
        trustedBaseArg, '780', attemptId, '1', runId, '1', 'codex', 'gpt-5.6-sol', 'high',
        `sha256:${'7'.repeat(64)}`,
      ],
      {
        cwd: options.cwd ?? repo.dir,
        env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath },
        input: verdict,
      },
    );
  }

  const atBase = submit();
  assert.equal(atBase.status, 0, atBase.stderr);

  const manifestPath = path.join(repo.dir, '.agent-skill-chain', 'project', 'manifest.yaml');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const changedManifest = manifest.replace('      exact_paths:\n        - AGENTS.md', '      exact_paths:\n        - SPEC.md\n        - AGENTS.md');
  assert.notEqual(changedManifest, manifest);
  fs.writeFileSync(manifestPath, changedManifest);
  const schemaPath = path.join(repo.dir, '.agent-skill-chain', 'schemas', 'project-policy.schema.yaml');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const changedSchema = schema.replace('required_profile: {const: strict}', 'required_profile: {const: unsupported}');
  assert.notEqual(changedSchema, schema);
  fs.writeFileSync(schemaPath, changedSchema);
  git(repo.dir, ['add', '.agent-skill-chain/project/manifest.yaml', '.agent-skill-chain/schemas/project-policy.schema.yaml']);
  git(repo.dir, ['commit', '-m', 'test: advance main and change current review policy inputs']);
  const advancedHead = git(repo.dir, ['rev-parse', 'HEAD']);
  assert.notEqual(advancedHead, baseSha);

  const advanced = submit();
  assert.equal(advanced.status, 0, advanced.stderr);
  const accepted = (stub.readState().pullReviews ?? []).map((review) => {
    const evidence = parseReviewEvidence((review as { body: string }).body);
    assert.ok(evidence);
    return evidence;
  });
  assert.equal(accepted.length, 2);
  assert.deepEqual(
    accepted.map((evidence) => evidence.verdict.approved_artifacts.map((artifact) => artifact.path)),
    [['SPEC.md'], ['SPEC.md']],
  );
  assert.deepEqual(
    accepted.map((evidence) => evidence.reviewer.capability.model_tier),
    ['explicit_selection', 'explicit_selection'],
  );

  const unreachableKnown = submit({ metadataBase: targetSha, baseArg: targetSha, trustedBaseArg: targetSha });
  assert.notEqual(unreachableKnown.status, 0);
  assert.match(unreachableKnown.stderr, /到達不能/);
  assert.match(unreachableKnown.stderr, /git fetchと早送り/);
  assert.doesNotMatch(unreachableKnown.stderr, /update-branch/);

  const missingSha = 'f'.repeat(40);
  const unreachableMissing = submit({ metadataBase: missingSha, baseArg: missingSha, trustedBaseArg: missingSha });
  assert.notEqual(unreachableMissing.status, 0);
  assert.match(unreachableMissing.stderr, /到達不能/);

  const wrongBase = submit({ baseArg: advancedHead, trustedBaseArg: baseSha });
  assert.notEqual(wrongBase.status, 0);
  assert.match(wrongBase.stderr, /PR metadata/);
  assert.match(wrongBase.stderr, /対象PR・target SHA・起動引数を確認/);

  const wrongTrustedBase = submit({ trustedBaseArg: advancedHead });
  assert.notEqual(wrongTrustedBase.status, 0);
  assert.match(wrongTrustedBase.stderr, /PR metadata/);

  const wrongBaseRef = submit({ metadataBaseRef: 'release' });
  assert.notEqual(wrongBaseRef.status, 0);
  assert.match(wrongBaseRef.stderr, /PR metadata/);

  const wrongHead = submit({ metadataHead: advancedHead });
  assert.notEqual(wrongHead.status, 0);
  assert.match(wrongHead.stderr, /PR metadata/);

  git(repo.dir, ['checkout', '-b', 'test/703-non-default']);
  const wrongBranch = submit();
  assert.notEqual(wrongBranch.status, 0);
  assert.match(wrongBranch.stderr, /repository default branchのworktreeから実行/);
  git(repo.dir, ['checkout', 'main']);

  git(repo.dir, ['checkout', '--detach', advancedHead]);
  const detached = submit();
  assert.notEqual(detached.status, 0);
  assert.match(detached.stderr, /current=detached/);
  git(repo.dir, ['checkout', 'main']);

  git(repo.dir, ['worktree', 'add', '-b', 'bugfix/703-issue-worktree', issueWorktree, advancedHead]);
  issueWorktreeCreated = true;
  const fromIssueWorktree = submit({ cwd: issueWorktree });
  assert.notEqual(fromIssueWorktree.status, 0);
  assert.match(fromIssueWorktree.stderr, /Issue worktreeのcandidate recorder/);
  assert.match(fromIssueWorktree.stderr, /default branch worktreeから実行/);

  fs.writeFileSync(path.join(repo.dir, 'README.md'), '# dirty recorder\n');
  const dirty = submit();
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /tracked fileがdirty/);
  assert.match(dirty.stderr, /変更を退避/);
  git(repo.dir, ['checkout', '--', 'README.md']);

  const distinctCauses = [
    fromIssueWorktree.stderr,
    wrongBase.stderr,
    wrongBranch.stderr,
    unreachableKnown.stderr,
    dirty.stderr,
  ].map((message) => message.trim());
  assert.equal(new Set(distinctCauses).size, 5);
});
