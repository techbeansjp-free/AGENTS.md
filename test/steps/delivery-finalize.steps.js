import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { createPullRequest, authorizeMerge } from '../../src/domain/delivery.js';
import { buildFinalizeReport, applyFinalize } from '../../src/domain/finalize.js';
import { github } from '../../src/adapters/github.js';

const safeState = () => ({
  repository: 'o/r', worktree: '/tmp/specific-worktree', branch: 'feature/x', base: 'main',
  headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), dirty: false, untracked: [], stashes: [],
  temporaryArtifacts: [], ignoredArtifacts: [], pushed: true, remoteBranch: true, prMerged: true,
  specConsistent: true, testsPassed: true, reviewApproved: true,
  recoveryRef: 'refs/agent-skill-chain/recovery/feature-x', recoveryReachable: true,
});

const safeDeliveryEvidence = () => {
  const headSha = 'a'.repeat(40);
  return {
    headSha,
    review: { approved: true, headSha },
    tests: { passed: true, headSha, scenarioIds: ['SCN-DELIVERY-001'] },
    spec: { consistent: true, headSha, impact: 'updated', trace: { requirements: ['FR-01'], scenarios: ['SCN-DELIVERY-001'], tests: ['test/features/integration/delivery-finalize.feature'] } },
  };
};

const trustedDeliveryPolicy = () => ({
  schemaVersion: 'agent-skill-chain/project-policy/v0.3.1', delivery: { stopAt: 'pull_request' },
  merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 0 }, budgets: { localFeedbackMs: 100, prGateMs: 1000 },
  rules: [{ ruleId: 'ASC-TRUST-TEST-001', purpose: 'PRで自己緩和を防止する', riskClass: 'authority', scope: ['pull_request'], enforcement: 'deny', activation: 'active', owner: 'policy owner', targetLayer: 'package', evidence: 'trusted comparison', remediation: 'trusted条件を維持する', overridePolicy: 'never', rollback: 'PRを作成しない' }],
});

Given('review、test、spec evidenceがすべてpassである', function () { this.evidence = safeDeliveryEvidence(); });
Given('PR単位のexternal writeが承認済みである', function () { this.authorization = 'approved'; });
Given('{word} evidenceをfailにする', function (name) { if (name === 'review') this.evidence.review.approved = false; else if (name === 'tests') this.evidence.tests.passed = false; else this.evidence.spec.consistent = false; });
Given('test evidenceのHEADだけが異なる', function () { this.evidence.tests.headSha = 'b'.repeat(40); });
Given('spec evidenceからscenario traceを除く', function () { this.evidence.spec.trace.scenarios = []; });
Given('PR inputの{word}を{string}にする', function (field, value) { this.prOverrides = { [field]: value }; });
When('PR createをdry-runする', function () { this.result = createPullRequest({ apply: false, evidence: this.evidence, headSha: this.evidence.headSha, issue: 824, head: 'feature', base: 'main', repository: 'o/r' }, () => { this.calls.push('unexpected'); }); });
When('PR createをapplyする', function () {
  try {
    this.result = createPullRequest({ apply: true, authorization: this.authorization, evidence: this.evidence, headSha: this.evidence.headSha, issue: 824, head: 'feature', base: 'main', repository: 'o/r', trustedPolicy: this.omitTrustedPolicy ? undefined : trustedDeliveryPolicy() }, (operation) => { this.calls.push(operation); return { url: 'https://example.invalid/pr/1' }; });
  } catch (error) { this.error = error; }
});
When('PR createをdry-runして失敗を確認する', function () {
  try {
    createPullRequest({ apply: false, evidence: this.evidence, headSha: this.evidence.headSha, issue: 824, head: 'feature', base: 'main', repository: 'o/r', ...this.prOverrides }, () => { this.calls.push('unexpected'); });
  } catch (error) { this.error = error; }
});
Then('delivery stateはpreviewである', function () { assert.equal(this.result.state, 'preview'); assert.equal(this.result.preview.authorityStatus, 'unverified-preview'); });
Then('delivery stateはwaiting_for_human_reviewである', function () { assert.equal(this.result.state, 'waiting_for_human_review'); });
Then('external operation callは0件である', function () { assert.equal(this.calls.length, 0); });
Then('external operationは{string}だけである', function (operation) { assert.deepEqual(this.calls, [operation]); });
Then('PR createは失敗する', function () { assert.ok(this.error instanceof Error); });
Given('trusted policyをPR inputから除く', function () { this.omitTrustedPolicy = true; });

/** @param {any} world @param {boolean} matchingBody @param {string} [permission] */
function prepareGhStub(world, matchingBody, permission = 'WRITE') {
  const directory = world.temp('asc-gh-adapter-');
  world.ghLog = path.join(directory, 'operations.log');
  world.bodyFile = path.join(directory, 'body.md');
  fs.writeFileSync(world.bodyFile, '# 同期本文\n');
  const stub = path.join(directory, 'gh');
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:${JSON.stringify(permission)}}));if(args[0]==='issue'&&args[1]==='view')process.stdout.write(${JSON.stringify(matchingBody ? '# 同期本文\n' : '# 不一致\n')});\n`);
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
}

Given('exact repositoryと同じbodyを返すgh stubがある', function () { prepareGhStub(this, true); });
Given('exact repositoryだが異なるbodyを返すgh stubがある', function () { prepareGhStub(this, false); });
Given('read権限だけを返すgh stubがある', function () { prepareGhStub(this, true, 'READ'); });
When('Issue sync adapterを実行する', function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try { this.result = github('issue.sync', { repository: 'o/r', issue: 824, bodyFile: this.bodyFile }, process.cwd()); } catch (error) { this.error = error; }
  finally { process.env.PATH = original; }
});
Then('Issue syncは成功する', function () { assert.equal(this.result.url, 'https://github.com/o/r/issues/824'); });
Then('gh操作順にauth、repo確認、edit、read-backが含まれる', function () {
  const lines = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map((line) => line.split(' ').slice(0, 2).join(' ')), ['auth status', 'repo view', 'issue edit', 'issue view']);
});
Then('Issue syncは失敗する', function () { assert.ok(this.error instanceof Error); });
Then('errorにwrite権限不足が含まれる', function () { assert.match(this.error.message, /書き込み権限/); });
Then('Issue edit操作は呼ばれない', function () { assert.equal(fs.readFileSync(this.ghLog, 'utf8').includes('issue edit'), false); });

/** @param {any} world @param {'pr'|'protection'|'reviews'} operation */
function prepareGhReadStub(world, operation) {
  const directory = world.temp('asc-gh-read-');
  world.ghLog = path.join(directory, 'operations.log');
  const stub = path.join(directory, 'gh');
  const payload = operation === 'pr'
    ? JSON.stringify({ number: 1, url: 'https://github.com/o/r/pull/1', headRefName: 'feature/x', baseRefName: 'main', headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), statusCheckRollup: [], latestReviews: [] })
    : operation === 'reviews'
      ? JSON.stringify([Array.from({ length: 31 }, (_, index) => ({ id: index + 1, state: 'APPROVED', commit_id: 'a'.repeat(40), user: { node_id: `reviewer-${index}` }, submitted_at: `2026-08-23T12:00:${String(index).padStart(2, '0')}Z` })), [{ id: 32, state: 'CHANGES_REQUESTED', commit_id: 'a'.repeat(40), user: { node_id: 'reviewer-0' }, submitted_at: '2026-08-23T13:00:00Z' }]])
    : JSON.stringify({ required_status_checks: null });
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'READ'}));if(args[0]==='pr')process.stdout.write(${JSON.stringify(payload)});if(args[0]==='api')process.stdout.write(${JSON.stringify(payload)});\n`);
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
}

Given('PR状態を返すexact repositoryのgh stubがある', function () { prepareGhReadStub(this, 'pr'); });
Given('branch protectionを返すexact repositoryのgh stubがある', function () { prepareGhReadStub(this, 'protection'); });
Given('複数pageのreviewを返すexact repositoryのgh stubがある', function () { prepareGhReadStub(this, 'reviews'); });
When('PR inspect adapterを実行する', function () {
  const original = process.env.PATH; process.env.PATH = this.stubPath;
  try { this.result = github('pr.inspect', { repository: 'o/r', pr: 1 }, process.cwd()); } finally { process.env.PATH = original; }
});
When('branch protection adapterを実行する', function () {
  const original = process.env.PATH; process.env.PATH = this.stubPath;
  try { this.result = github('branch.protection', { repository: 'o/r', branch: 'main' }, process.cwd()); } finally { process.env.PATH = original; }
});
When('PR reviews adapterを実行する', function () {
  const original = process.env.PATH; process.env.PATH = this.stubPath;
  try { this.result = github('pr.reviews', { repository: 'o/r', pr: 1 }, process.cwd()); } finally { process.env.PATH = original; }
});
Then('PR状態を取得できる', function () { assert.equal(this.result.headRefName, 'feature/x'); });
Then('branch protection状態を取得できる', function () { assert.equal(this.result.known, true); assert.equal(this.result.protected, true); });
Then('全pageのreviewと順序根拠を取得できる', function () { assert.equal(this.result.length, 32); assert.deepEqual(this.result.at(-1), { state: 'CHANGES_REQUESTED', commitSha: 'a'.repeat(40), actorId: 'reviewer-0', submittedAt: '2026-08-23T13:00:00Z', reviewId: '32' }); const log = fs.readFileSync(this.ghLog, 'utf8'); assert.match(log, /api --paginate --slurp repos\/o\/r\/pulls\/1\/reviews\?per_page=100/u); });
Then('PR読取前にauthとrepository確認が行われる', function () {
  const operations = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(operations, ['auth status', 'repo view', 'pr view']);
});
Then('protection読取前にauthとrepository確認が行われる', function () {
  const operations = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(operations, ['auth status', 'repo view', 'api repos/o/r/branches/main/protection']);
});

/** `matchingBase` reproduces a base-branch OID change between preflight and PR read-back. @param {any} world @param {boolean} matchingHead @param {boolean} [matchingBase] */
function prepareGhCreateStub(world, matchingHead, matchingBase = true) {
  const directory = world.temp('asc-gh-create-');
  world.ghLog = path.join(directory, 'operations.log');
  const stub = path.join(directory, 'gh');
  const expected = 'a'.repeat(40);
  const observed = matchingHead ? expected : 'b'.repeat(40);
  const base = 'c'.repeat(40); const observedBase = matchingBase ? base : 'd'.repeat(40);
  const pr = JSON.stringify({ url: 'https://github.com/o/r/pull/9', headRefName: 'feature/x', baseRefName: 'main', headRefOid: expected, baseRefOid: observedBase });
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'WRITE'}));if(args[0]==='api')process.stdout.write((args[1].includes('feature%2Fx')?${JSON.stringify(observed)}:${JSON.stringify(base)})+'\\n');if(args[0]==='pr'&&args[1]==='create')process.stdout.write('https://github.com/o/r/pull/9\\n');if(args[0]==='pr'&&args[1]==='view')process.stdout.write(${JSON.stringify(pr)});\n`);
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
}

Given('一致するremote HEADとPR状態を返すgh stubがある', function () { prepareGhCreateStub(this, true); });
Given('異なるremote HEADを返すgh stubがある', function () { prepareGhCreateStub(this, false); });
Given('作成中にremote base OIDが変更されるgh stubがある', function () { prepareGhCreateStub(this, true, false); });
When('PR create adapterを実行する', function () {
  const original = process.env.PATH; process.env.PATH = this.stubPath;
  try { this.result = github('pr.create', { repository: 'o/r', issue: 824, head: 'feature/x', headSha: 'a'.repeat(40), base: 'main', bodyLink: 'Relates to #824' }, process.cwd()); } catch (error) { this.error = error; }
  finally { process.env.PATH = original; }
});
Then('PR create adapterは成功する', function () { assert.equal(this.result.url, 'https://github.com/o/r/pull/9'); });
Then('PR create adapterは失敗する', function () { assert.ok(this.error instanceof Error); });
Then('PR作成順にauth、repository、remote HEAD、create、read-backが含まれる', function () {
  const operations = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(operations, ['auth status', 'repo view', 'api repos/o/r/commits/feature%2Fx', 'api repos/o/r/commits/main', 'pr create', 'pr view']);
});
Then('PR create操作は呼ばれない', function () {
  const operations = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n');
  assert.equal(operations.some((line) => line.startsWith('pr create')), false);
});

Given('trusted policyはdisabledでcandidate policyはautomaticである', function () {
  this.mergeInput = { trustedPolicy: { merge: { mode: 'disabled' } }, candidatePolicy: { merge: { mode: 'automatic', methods: ['squash'] } }, method: 'squash', checks: [], reviews: 0, branch: 'feature/a', humanApproval: false };
});
Given('trusted policyがautomaticでcheck {string}とreview 1件を要求する', function (check) {
  this.mergeInput = { trustedPolicy: { merge: { mode: 'automatic', branches: ['feature/*'], methods: ['squash'], requiredChecks: [check], requiredReviews: 1 } }, method: 'squash', checks: [], approvals: [], headSha: 'a'.repeat(40), prAuthorActorId: 'author', implementationAuthorActorId: 'implementer', branch: 'feature/a', repositoryVerified: true, shaVerified: true, protectionVerified: true, mergeableVerified: true };
});
Given('branch、method、check、reviewがすべて条件を満たす', function () { this.mergeInput.checks = ['ci']; this.mergeInput.approvals = [{ state: 'APPROVED', commitSha: this.mergeInput.headSha, actorId: 'independent-reviewer', submittedAt: '2026-08-23T12:00:00Z', reviewId: '1' }]; });
Given('trusted policyがassistedである', function () { this.trustedPolicy = { merge: { mode: 'assisted', branches: ['feature/*'], methods: ['merge'], requiredChecks: [], requiredReviews: 0 } }; });
Given('trusted automatic policyがrequired check {string}を持つ', function (check) { this.mergeInput = { trustedPolicy: { merge: { mode: 'automatic', branches: ['*'], methods: ['squash'], requiredChecks: [check], requiredReviews: 0 } }, method: 'squash', checks: undefined, approvals: [], headSha: 'a'.repeat(40), branch: 'x', repositoryVerified: true, shaVerified: true, protectionVerified: true, mergeableVerified: true }; });
When('candidate branchのmerge authorizationを評価する', function () { this.result = authorizeMerge(this.mergeInput); });
When('merge authorizationを評価する', function () { this.result = authorizeMerge(this.mergeInput); });
When('human approvalなしとありでmerge authorizationを評価する', function () {
  const headSha = 'a'.repeat(40);
  const base = { trustedPolicy: this.trustedPolicy, method: 'merge', checks: [], approvals: [], headSha, prAuthorActorId: 'author', implementationAuthorActorId: 'implementer', branch: 'feature/a', repositoryVerified: true, shaVerified: true, protectionVerified: true, mergeableVerified: true };
  this.withoutApproval = authorizeMerge(base);
  this.withApproval = authorizeMerge({ ...base, approvals: [{ state: 'APPROVED', commitSha: headSha, actorId: 'independent-reviewer', submittedAt: '2026-08-23T12:00:00Z', reviewId: '1' }] });
});
When('check state unknownでmerge authorizationを評価する', function () { this.result = authorizeMerge(this.mergeInput); });
Given('reviewが旧HEADまたは実装者自身による承認である', function () {
  const headSha = 'a'.repeat(40);
  this.mergeInput = { trustedPolicy: { merge: { mode: 'automatic', branches: ['feature/*'], methods: ['squash'], requiredChecks: [], requiredReviews: 1 } }, method: 'squash', checks: [], approvals: [{ state: 'APPROVED', commitSha: 'b'.repeat(40), actorId: 'reviewer', submittedAt: '2026-08-23T11:00:00Z', reviewId: '1' }, { state: 'APPROVED', commitSha: headSha, actorId: 'implementer', submittedAt: '2026-08-23T12:00:00Z', reviewId: '2' }], headSha, prAuthorActorId: 'author', implementationAuthorActorId: 'implementer', branch: 'feature/a', repositoryVerified: true, shaVerified: true, protectionVerified: true, mergeableVerified: true };
});
Given('repository、SHA、保護設定のtrusted観測が欠けている', function () {
  this.mergeInput = { trustedPolicy: { merge: { mode: 'automatic', branches: ['feature/*'], methods: ['squash'], requiredChecks: [], requiredReviews: 0 } }, method: 'squash', checks: [], approvals: [], headSha: 'a'.repeat(40), branch: 'feature/a' };
});
Given('同一reviewerが承認後に変更要求へ更新している', function () {
  const headSha = 'a'.repeat(40);
  this.mergeInput = { trustedPolicy: { merge: { mode: 'automatic', branches: ['feature/*'], methods: ['squash'], requiredChecks: [], requiredReviews: 1 } }, method: 'squash', checks: [], approvals: [{ state: 'CHANGES_REQUESTED', commitSha: headSha, actorId: 'reviewer', submittedAt: '2026-08-23T13:00:00Z', reviewId: '2' }, { state: 'APPROVED', commitSha: headSha, actorId: 'reviewer', submittedAt: '2026-08-23T12:00:00Z', reviewId: '1' }], headSha, prAuthorActorId: 'author', implementationAuthorActorId: 'implementer', branch: 'feature/a', repositoryVerified: true, shaVerified: true, protectionVerified: true, mergeableVerified: true };
});
Given('reviewのsubmittedAtが不正である', function () { this.mergeInput.approvals[0].submittedAt = 'sometime'; });
Then('mergeは許可されない', function () { assert.equal(this.result.allowed, false); });
Then('mergeは許可される', function () { assert.equal(this.result.allowed, true); });
Then('許可operationは{string}だけである', function (operation) { assert.deepEqual(this.result.operations, [operation]); });
Then('approvalなしは拒否され、approvalありだけ許可される', function () { assert.equal(this.withoutApproval.allowed, false); assert.equal(this.withApproval.allowed, true); });

Given('merged、clean、pushed、recoveryありのworktree stateがある', function () { this.state = safeState(); });
Given('finalize stateを{word}にする', function (condition) {
  const changes = {
    dirty: { dirty: true }, untracked: { untracked: ['secret.txt'] }, unpushed: { pushed: false }, unmerged: { prMerged: false },
    'recovery-unknown': { recoveryReachable: false }, 'spec-unknown': { specConsistent: 'unknown' }, 'ignored-artifact': { ignoredArtifacts: ['output.bin'] },
  };
  Object.assign(this.state, changes[/** @type {keyof typeof changes} */ (condition)]);
});
Given('safe finalize reportを作成済みである', function () { this.report = buildFinalizeReport(this.state); });
When('finalize reportを作成する', function () { this.report = buildFinalizeReport(this.state); });
When('report hashを承認してfinalize applyを試みる', function () {
  this.report = buildFinalizeReport(this.state);
  try { applyFinalize({ report: this.report, approvedHash: this.report.hash, currentState: this.state }, (operation) => this.calls.push(operation)); } catch (error) { this.error = error; }
});
When('current HEADを変更してfinalize applyする', function () { try { applyFinalize({ report: this.report, approvedHash: this.report.hash, currentState: { ...this.state, headSha: 'c'.repeat(40) } }, (operation) => this.calls.push(operation)); } catch (error) { this.error = error; } });
When('同一stateと承認hashでfinalize applyする', function () { this.result = applyFinalize({ report: this.report, approvedHash: this.report.hash, currentState: this.state }, (operation) => this.calls.push(operation)); });
Then('reportはsafeで64桁hashを持つ', function () { assert.equal(this.report.safe, true); assert.match(this.report.hash, /^[a-f0-9]{64}$/); });
Then('destructive operation callは0件である', function () { assert.equal(this.calls.length, 0); });
Then('finalize applyは失敗する', function () { assert.ok(this.error instanceof Error); });
Then('lifecycle stateはfinalizedである', function () { assert.equal(this.result.state, 'finalized'); });
Then('destructive operationは{string}だけである', function (operation) { assert.deepEqual(this.calls, [operation]); });
