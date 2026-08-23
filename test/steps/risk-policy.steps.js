import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Given, When, Then } from '@cucumber/cucumber';
import { main } from '../../src/cli.js';
import {
  aggregateMetrics, applyMigration, classifyPackageAssets, compareTrustedPolicy, evaluateRule,
  enforceOperation, enforceTrustedBoundary, evidenceFingerprint, planMigration, planOfflineGates, planValidation, resolveEffectivePolicy, retryMigration,
  rollbackMigration, serializeDiagnostic, validateEnforcementPolicy, validateOverride, validateOwnershipBoundary, validatePackageManifest,
} from '../../src/domain/enforcement.js';
import { applyFileMigration, planFileMigration, recoverFileMigration, retryFileMigration, rollbackFileMigration } from '../../src/domain/migration.js';
import { loadEffectiveTrustedPolicySet, loadOperationPolicy, loadProjectPolicySet, loadTrustedProjectPolicySet, validatePolicy } from '../../src/domain/policy.js';
import { validateConformanceContract } from '../../src/domain/conformance.js';
import { evaluateReview } from '../../src/domain/review.js';

const SHA = 'a'.repeat(40);
const baseRule = (changes = {}) => ({
  ruleId: 'ASC-TEST-001', purpose: '安全な境界を守る', riskClass: 'authority', scope: ['policy'],
  enforcement: 'deny', activation: 'active', owner: 'policy owner', targetLayer: 'package', evidence: '検証証拠',
  remediation: '信頼済み条件を維持して再実行する', overridePolicy: 'never', rollback: 'trusted policyへ戻す', ...changes,
});
const basePolicy = (rules = [baseRule()]) => ({
  schemaVersion: 'agent-skill-chain/project-policy/v0.4', delivery: { stopAt: 'pull_request' },
  merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 1 },
  budgets: { localFeedbackMs: 100, prGateMs: 1000 }, rules,
});
/** @param {string} file @param {any} value */
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
/** @param {string} root @param {any} candidate */
const migrationEntries = (root, candidate) => {
  const entries = [
    { kind: 'policy', path: '.agent-skill-chain/project-policy.json', after: `${JSON.stringify(candidate, null, 2)}\n` },
    { kind: 'schema', path: '.agent-skill-chain/schemas/example.schema.json', after: `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }, null, 2)}\n` },
    { kind: 'runtime', path: 'src/domain/example.js', after: 'export const migrated = true;\n' },
    { kind: 'CI', path: '.github/workflows/example.yml', after: 'name: example\non: push\njobs:\n  verify:\n    runs-on: ubuntu-latest\n' },
    { kind: 'template', path: '.agent-skill-chain/templates/example.md', after: '# Generic hook\n' },
  ];
  for (const entry of entries) { const file = path.join(root, entry.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `before-${entry.kind}\n`); }
  return entries;
};
/** @param {string[]} args */
const execute = async (args) => {
  let stdout = '';
  let stderr = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  try {
    return { status: await main(args), stdout, stderr };
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
    return { status: 1, stdout, stderr };
  } finally {
    process.stdout.write = originalWrite;
  }
};
/** @param {string[]} args */
const executeBin = (args) => spawnSync(process.execPath, [path.resolve('bin/agent-skill-chain.js'), ...args], { cwd: process.cwd(), encoding: 'utf8' });
/** @param {string} root @param {string[]} args */
const executeBinIn = (root, args, env = process.env) => spawnSync(process.execPath, [path.resolve('bin/agent-skill-chain.js'), ...args], { cwd: root, encoding: 'utf8', env });
/** @param {any} world @param {string} variant */
const prepareReviewGhStub = (world, variant) => {
  const directory = world.temp('asc-review-gh-'); world.ghLog = path.join(directory, 'operations.log');
  const observedRepo = variant === 'wrong-repository' ? 'x/r' : 'o/r'; const observedPr = variant === 'wrong-pr' ? 999 : 835;
  const observedRun = variant === 'wrong-run' ? 999 : 32635972969; const observedReview = variant === 'wrong-review' ? 999 : 9001;
  const observedHead = variant === 'wrong-head' ? 'f'.repeat(40) : world.finalCommitSha;
  const prAuthor = variant === 'bot-pr-implementation-self-review' ? 'actor-bot' : 'actor-implementer';
  const implementationAuthor = variant === 'null-implementation-author' ? null : 'actor-implementer';
  const reviewer = ['self-review', 'bot-pr-implementation-self-review'].includes(variant) ? 'actor-implementer' : 'actor-reviewer'; const state = variant === 'commented' ? 'COMMENTED' : 'APPROVED';
  const pullRequests = variant === 'empty-run-pr' ? [] : [{ number: variant === 'wrong-run-pr' ? 999 : 835 }];
  const stub = path.join(directory, 'gh');
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);const endpoint=args[1]||'';fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:${JSON.stringify(observedRepo)},viewerPermission:'READ'}));if(args[0]==='pr')process.stdout.write(JSON.stringify({number:${observedPr},headRefOid:${JSON.stringify(observedHead)},author:{id:${JSON.stringify(prAuthor)}}}));if(args[0]==='api'&&endpoint.includes('/commits/'))process.stdout.write(JSON.stringify({sha:${JSON.stringify(world.implementationCommitSha)},author:${implementationAuthor === null ? 'null' : `{node_id:${JSON.stringify(implementationAuthor)}}`}}));if(args[0]==='api'&&endpoint.includes('/actions/runs/'))process.stdout.write(JSON.stringify({id:${observedRun},repository:{full_name:'o/r'},head_sha:${JSON.stringify(observedHead)},conclusion:'success',event:'pull_request',pull_requests:${JSON.stringify(pullRequests)}}));if(args[0]==='api'&&endpoint.includes('/reviews/'))process.stdout.write(JSON.stringify({id:${observedReview},commit_id:${JSON.stringify(observedHead)},user:{node_id:${JSON.stringify(reviewer)}},submitted_at:'2026-08-23T12:00:00Z',state:${JSON.stringify(state)}}));\n`);
  fs.chmodSync(stub, 0o755); world.reviewCliEnv = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}` }; world.reviewVariant = variant;
};
/** @param {string} headSha @param {any} evidence */
const completeReview = (headSha, evidence) => ({
  round: 1, headSha, tests: 'pass', specConsistency: 'pass', findings: [], ...evidence,
  affirmative: { correctness: 'pass', value: 'pass', feasibility: 'pass', consistency: 'pass', maintainability: 'pass' },
  adversarial: { counterexamples: 'pass', failures: 'pass', boundaries: 'pass', abuse: 'pass', security: 'pass', dataLoss: 'pass', rollback: 'pass', scope: 'pass' },
});

Given('secret保護のactive deny ruleがある', function () { this.rule = baseRule({ ruleId: 'ASC-SECRET-001', purpose: '秘密情報の混入を防ぐ', riskClass: 'secret', scope: ['artifact'] }); });
Given('表記統一のactive assist ruleがある', function () {
  this.rule = baseRule({ ruleId: 'ASC-STYLE-001', purpose: '表記を統一する', riskClass: 'quality', scope: ['docs'], enforcement: 'assist', overridePolicy: 'bound', remediation: 'dry-run差分を確認して修正する' });
});
When('違反を検出してruleを評価する', function () {
  this.result = evaluateRule(this.rule, { violated: true, reasons: ['対象fileで違反を検出した'], checks: ['scopeとriskを確認した'], autoFixes: [{ description: '表記を修正する', dryRunDiff: '- old\n+ new' }] });
});
Then('判定はblockedである', function () { assert.equal(this.result.status, 'blocked'); assert.equal(this.result.blocked, true); });
Then('日本語diagnosticにrule ID、根拠、解決経路、authority、rollbackがある', function () {
  const diagnostic = this.result.diagnostic;
  for (const key of ['ruleId', 'purpose', 'risk', 'reasons', 'scope', 'checks', 'next', 'requiredAuthority', 'rollback']) assert.ok(diagnostic[key] && diagnostic[key].length !== 0, key);
  assert.match(JSON.stringify(diagnostic), /[ぁ-んァ-ヶ一-龯]/u);
});
Then('判定はassistedである', function () { assert.equal(this.result.status, 'assisted'); assert.equal(this.result.blocked, false); });
Then('自動修正候補にdry-run差分がある', function () { assert.ok(this.result.diagnostic.autoFixes[0].dryRunDiff.includes('+ new')); });

Given('任意最適化をdenyにしたpolicyがある', function () { this.policy = basePolicy([baseRule({ riskClass: 'optimization' })]); });
When('risk比例policyを検証する', function () { this.result = validateEnforcementPolicy(this.policy); });
Then('日本語diagnosticはstagedへの修正案を返す', function () { assert.ok(this.result.diagnostics[0].autoFixes.some((/** @type {any} */ fix) => fix.dryRunDiff.includes('staged'))); });

Given('trusted policyのactive deny ruleをcandidateがwarnへ緩和する', function () {
  this.trusted = basePolicy(); this.candidate = basePolicy([baseRule({ enforcement: 'warn', overridePolicy: 'bound' })]);
});
When('trusted policyとcandidate policyを比較する', function () { this.result = compareTrustedPolicy(this.trusted, this.candidate); });
Then('自己緩和をnon-overrideで拒否する', function () { assert.equal(this.result.allowed, false); assert.equal(this.result.rejected[0].ruleId, 'ASC-TRUST-001'); assert.equal(this.result.rejected[0].requiredAuthority, 'default branch policy owner'); });

Given('override可能なruleと正しいoverrideがある', function () {
  this.rule = baseRule({ enforcement: 'require', overridePolicy: 'bound' });
  this.expectedOverride = { ruleId: this.rule.ruleId, issue: 834, scope: 'policy', actor: 'maintainer', sha: SHA, now: '2026-08-23T00:00:00Z' };
  this.override = { ruleId: this.rule.ruleId, issue: 834, scope: 'policy', actor: 'maintainer', reason: '障害復旧のため一時的に必要', expiresAt: '2026-08-24T00:00:00Z', sha: SHA };
});
Given('overrideの{word}が一致しない', function (attribute) {
  if (attribute === 'scope') this.override.scope = 'outside';
  if (attribute === 'actor') this.override.actor = 'unknown';
  if (attribute === 'expiry') this.override.expiresAt = '2026-08-22T00:00:00Z';
  if (attribute === 'sha') this.override.sha = 'b'.repeat(40);
});
When('overrideを検証する', function () { this.result = validateOverride(this.rule, this.override, this.expectedOverride); });
Then('overrideは拒否される', function () { assert.equal(this.result.valid, false); assert.ok(this.result.reasons.length > 0); assert.equal(this.result.audit, undefined); });

Given('local gateと外部service必須gateがある', function () { this.gates = [{ id: 'local-test', requiresExternal: false }, { id: 'github-check', requiresExternal: true }]; });
When('offlineでgateを計画する', function () { this.result = planOfflineGates(this.gates, { online: false }); });
Then('local gateはreadyである', function () { assert.equal(this.result.find((/** @type {any} */ gate) => gate.id === 'local-test').status, 'ready'); });
Then('外部service必須gateだけがpendingである', function () { assert.deepEqual(this.result.filter((/** @type {any} */ gate) => gate.status === 'pending').map((/** @type {any} */ gate) => gate.id), ['github-check']); });

Given('同じ差分とriskと合格証跡がある', function () {
  this.validationInput = { changedFiles: ['src/domain/enforcement.js'], risk: ['authority'], evidence: { sha: SHA, policyHash: 'c'.repeat(64), tool: 'cucumber-js', scope: ['unit'], passed: true } };
  this.fingerprint = evidenceFingerprint(this.validationInput);
});
When('targeted gateとfinal gateを計画する', function () {
  const input = { ...this.validationInput, successfulFingerprints: [this.fingerprint], successfulEvidence: [{ fingerprint: this.fingerprint, passed: true, sha: this.validationInput.evidence.sha, policyHash: this.validationInput.evidence.policyHash, tool: this.validationInput.evidence.tool, scope: this.validationInput.evidence.scope }] };
  this.targeted = planValidation({ ...input, kind: 'targeted' }); this.final = planValidation({ ...input, kind: 'final' });
});
Then('targeted gateはdeduplicatedである', function () { assert.equal(this.targeted.status, 'deduplicated'); assert.deepEqual(this.targeted.checks, []); });
Then('final gateはsecurity、受け入れ条件、独立reviewを含むfullである', function () { assert.equal(this.final.scope, 'full'); assert.deepEqual(this.final.checks, ['security', 'acceptance', 'independentReview', 'fullTest']); });

Given('wait、duplicate、false block、override、rollback、missのeventがある', function () {
  this.events = [
    { kind: 'gateWaitMs', value: 150, secret: 'TOKEN=never-log-this' }, { kind: 'duplicate' }, { kind: 'falseBlock' },
    { kind: 'override' }, { kind: 'rollback' }, { kind: 'miss' },
  ];
});
When('policy metricsを集計する', function () { this.result = aggregateMetrics(this.events, { localFeedbackMs: 100, prGateMs: 1000 }); });
Then('6指標とbudget超過を機械可読に返す', function () { assert.deepEqual(Object.keys(this.result.metrics).sort(), ['duplicate', 'falseBlock', 'gateWaitMs', 'miss', 'override', 'rollback']); assert.equal(this.result.exceeded.localFeedback, true); });
Then('metricsに秘密値は含まれない', function () { assert.equal(JSON.stringify(this.result).includes('never-log-this'), false); });

Given('v0.3のtrusted policyとv0.4のcandidate policyがある', function () {
  this.trusted = { schemaVersion: 'agent-skill-chain/project-policy/v0.3', delivery: { stopAt: 'pull_request' }, merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 0 } };
  this.candidate = basePolicy([baseRule({ activation: 'staged' })]); this.before = structuredClone(this.trusted); this.root = this.temp('asc-v03-v04-');
  this.entries = migrationEntries(this.root, this.candidate);
  this.beforeFiles = this.entries.map((/** @type {any} */ entry) => fs.readFileSync(path.join(this.root, entry.path), 'utf8'));
});
When('migrationをdry-runする', function () { this.result = this.entries ? planFileMigration(this.root, this.trusted, this.candidate, this.entries) : planMigration(this.trusted, this.candidate); });
Then('staged planにschema、runtime、CI、templateの変更がある', function () { assert.equal(this.result.state, 'staged', JSON.stringify(this.result)); assert.deepEqual(this.result.changes, ['policy', 'schema', 'runtime', 'CI', 'template']); });
Then('書き込みは行われない', function () { assert.deepEqual(this.trusted, this.before); for (const [index, entry] of this.entries.entries()) assert.equal(fs.readFileSync(path.join(this.root, entry.path), 'utf8'), this.beforeFiles[index]); });

Given('適用済みmigrationと適用前snapshotがある', function () {
  this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-NEW-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  const plan = planMigration(this.trusted, this.candidate); this.approvedPlanHash = plan.planFingerprint; this.applied = applyMigration(plan, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 0 });
});
When('migrationをrollbackしてretryする', function () { this.result = retryMigration(rollbackMigration(this.applied, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 1 }), this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 2 }); });
Then('rollbackと再適用の状態遷移を記録する', function () { assert.deepEqual(this.result.history, ['staged', 'applied', 'rolled_back', 'applied']); });
Then('最終policyはcandidateと一致する', function () { assert.deepEqual(this.result.policy, this.candidate); });

Given('candidateに正当なstaged rule追加とtrusted rule緩和がある', function () {
  this.trusted = basePolicy();
  this.candidate = basePolicy([baseRule({ enforcement: 'warn', overridePolicy: 'bound' }), baseRule({ ruleId: 'ASC-NEW-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
});
When('migration compatibilityを検査する', function () { this.result = compareTrustedPolicy(this.trusted, this.candidate); });
Then('staged rule追加は許可される', function () { assert.deepEqual(this.result.stagedAdditions, ['ASC-NEW-001']); });
Then('trusted rule緩和だけが拒否される', function () { assert.equal(this.result.rejected.length, 1); assert.equal(this.result.rejected[0].ruleId, 'ASC-TRUST-001'); });

Given('dogfooding policy、role log、metrics、test fixture、秘密fixtureがある', function () {
  this.assets = ['.agent-skill-chain/project-policy.json', '.agent-skill-chain/role-log/implementer.jsonl', '.agent-skill-chain/metrics/run.json', 'test/fixtures/policy.json', 'secret-fixtures/token.txt'];
});
When('package allowlistを評価する', function () { this.result = classifyPackageAssets(this.assets, ['.agent-skill-chain/project-policy.json', '.agent-skill-chain/role-log/', '.agent-skill-chain/metrics/', 'test/', 'secret-fixtures/']); });
Then('すべての開発assetが明示的に除外される', function () { assert.deepEqual(this.result.excluded, this.assets); assert.deepEqual(this.result.allowed, []); });

Given('dogfooding用のtrusted policyと通常拡張candidateがある', function () {
  this.root = this.temp('asc-risk-cli-'); this.trusted = basePolicy();
  this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-NORMAL-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  this.trustedFile = path.join(this.root, 'trusted.json'); this.candidateFile = path.join(this.root, 'candidate.json');
  writeJson(this.trustedFile, this.trusted); writeJson(this.candidateFile, this.candidate);
});
When('policy migrate CLIをdry-runする', async function () { this.cliResult = await execute(['policy', 'migrate', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, '--dry-run']); });
Then('CLIは書き込まずstaged migrationを表示する', function () { assert.equal(this.cliResult.status, 0, this.cliResult.stderr); assert.ok(this.cliResult.stdout.length > 0, JSON.stringify({ stderr: this.cliResult.stderr })); const output = JSON.parse(this.cliResult.stdout); assert.equal(output.state, 'staged'); assert.equal(output.dryRun, true); assert.equal(fs.readdirSync(this.root).length, 2); });

Given('dogfooding用のtrusted policyと自己緩和candidateがある', function () {
  this.root = this.temp('asc-risk-cli-'); this.trusted = basePolicy(); this.candidate = basePolicy([baseRule({ enforcement: 'warn', overridePolicy: 'bound' })]);
  this.trustedFile = path.join(this.root, 'trusted.json'); this.candidateFile = path.join(this.root, 'candidate.json');
  writeJson(this.trustedFile, this.trusted); writeJson(this.candidateFile, this.candidate);
});
When('policy evaluate CLIを実行する', async function () { this.cliResult = await execute(['policy', 'evaluate', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`]); });
Then('CLIは非0で終了する', function () { assert.notEqual(this.cliResult.status, 0); });
Then('stdoutにASC-TRUST-001と日本語解決経路がある', function () { assert.ok(this.cliResult.stdout.includes('ASC-TRUST-001')); assert.ok(this.cliResult.stdout.includes('独立review')); assert.ok(this.cliResult.stdout.includes('candidateの緩和差分を取り消す')); });

Given('一時projectにmigration入力とsnapshotがある', function () {
  this.root = this.temp('asc-risk-cli-'); this.trusted = basePolicy();
  this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-RETRY-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  this.trustedFile = path.join(this.root, 'trusted.json'); this.candidateFile = path.join(this.root, 'candidate.json'); this.stateFile = path.join(this.root, 'state.json');
  writeJson(this.trustedFile, this.trusted); writeJson(this.candidateFile, this.candidate);
  this.repositoryHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
  this.repositoryRemotes = spawnSync('git', ['remote', '-v'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
});
When('policy migrate CLIをapply、rollback、retryする', async function () {
  const preview = await execute(['policy', 'migrate', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, '--dry-run']);
  const approval = `--approved-plan-hash=${JSON.parse(preview.stdout).planFingerprint}`;
  this.cliResults = [
    await execute(['policy', 'migrate', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, `--state=${this.stateFile}`, approval, '--expected-revision=0', '--apply']),
    await execute(['policy', 'migrate', '--operation=rollback', `--state=${this.stateFile}`, approval, '--expected-revision=1', '--apply']),
    await execute(['policy', 'migrate', '--operation=retry', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, `--state=${this.stateFile}`, approval, '--expected-revision=2', '--apply']),
  ];
});
Then('すべての状態遷移が成功する', function () { for (const result of this.cliResults) assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(fs.readFileSync(this.stateFile, 'utf8')).history, ['staged', 'applied', 'rolled_back', 'applied']); });
Then('実repositoryとremoteは変更されない', function () { assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout, this.repositoryHead); assert.equal(spawnSync('git', ['remote', '-v'], { cwd: process.cwd(), encoding: 'utf8' }).stdout, this.repositoryRemotes); });

Given('delivery証拠をrequireするactive ruleがある', function () {
  this.rule = baseRule({ ruleId: 'ASC-DELIVERY-REQUIRE-001', purpose: 'delivery証拠を要求する', riskClass: 'quality', scope: ['delivery'], enforcement: 'require', overridePolicy: 'bound', targetLayer: 'project' });
  this.policy = basePolicy([this.rule]);
  this.overrideExpected = { ruleId: this.rule.ruleId, issue: 834, scope: 'delivery', actor: 'maintainer', sha: SHA, now: '2026-08-23T00:00:00Z' };
  this.validOverride = { ruleId: this.rule.ruleId, issue: 834, scope: 'delivery', actor: 'maintainer', reason: '復旧中の一時的authority', expiresAt: '2026-08-24T00:00:00Z', sha: SHA };
});
When('条件未達のoperationをenforceする', function () { this.result = enforceOperation({ policy: this.policy, ruleId: this.rule.ruleId, boundary: 'delivery', violated: true }); });
Then('operationはrequiredとして非許可である', function () { assert.equal(this.result.status, 'required'); assert.equal(this.result.allowed, false); });
Then('有効なoverrideまたは証拠があれば許可される', function () {
  const overridden = enforceOperation({ policy: this.policy, ruleId: this.rule.ruleId, boundary: 'delivery', violated: true, override: this.validOverride, expectedOverride: this.overrideExpected });
  const passed = enforceOperation({ policy: this.policy, ruleId: this.rule.ruleId, boundary: 'delivery', violated: false });
  const malformedEvidence = enforceOperation({ policy: this.policy, ruleId: this.rule.ruleId, boundary: 'delivery', violated: false, validation: { kind: 'targeted', changedFiles: [], risk: [], evidence: { passed: true } } });
  assert.equal(overridden.allowed, true); assert.ok(/** @type {any} */ (overridden).overrideAudit); assert.equal(passed.allowed, true);
  assert.equal(malformedEvidence.allowed, false); assert.equal(malformedEvidence.diagnostic.ruleId, 'ASC-EVIDENCE-001');
});

Given('trusted policyのmerge、review、check、branch、method、scope、意味をcandidateが弱化する', function () {
  const trustedRule = baseRule({ enforcement: 'require', overridePolicy: 'bound', scope: ['delivery', 'package'], purpose: 'trusted意味', targetLayer: 'project' });
  this.trusted = basePolicy([trustedRule]);
  this.trusted.merge = { mode: 'assisted', branches: ['feature/*'], methods: ['squash'], requiredChecks: ['ci'], requiredReviews: 2 };
  this.candidate = structuredClone(this.trusted);
  this.candidate.merge = { mode: 'automatic', branches: ['feature/*', '*'], methods: ['squash', 'merge'], requiredChecks: [], requiredReviews: 0 };
  this.candidate.rules[0] = { ...trustedRule, scope: ['delivery'], purpose: 'candidate意味' };
});
Then('すべてのauthority弱化理由を返す', function () {
  const reasons = this.result.rejected.flatMap((/** @type {any} */ item) => item.reasons).join(' ');
  for (const fragment of ['merge.mode', 'branch', 'method', 'required check', 'required review', 'scope', '意味fingerprint']) assert.ok(reasons.includes(fragment), fragment);
});

Given('tokenとpasswordを含むblock diagnosticがある', function () {
  this.diagnostic = { allowed: false, diagnostic: { ruleId: 'ASC-SECRET-001', purpose: '秘密を守る', risk: 'secret', reasons: ['token=super-secret-value password=never-show'], scope: ['package'], checks: ['api_key=hidden-value'], autoFixes: [], next: 'credentialを失効する', requiredAuthority: 'security owner', rollback: 'artifactを破棄する' } };
});
When('diagnosticを安全にserializeする', function () { this.result = serializeDiagnostic(this.diagnostic); });
Then('秘密値は出力されずmachine正本と非authorityの日本語fallbackがある', function () { const text = JSON.stringify(this.result); assert.equal(text.includes('super-secret-value'), false); assert.equal(text.includes('never-show'), false); assert.equal(this.result.presentation.authoritative, false); assert.equal(this.result.presentation.fallbackLanguage, 'ja'); assert.equal(this.result.result.diagnostic.ruleId, 'ASC-SECRET-001'); for (const label of ['ルールID', '具体的根拠', '安全な次の操作', '必要な最小authority', 'rollback方法']) assert.ok(text.includes(label)); });

Given('同じfingerprintだがpassed falseの証拠がある', function () {
  this.failedValidation = { changedFiles: ['src/x.js'], risk: ['quality'], evidence: { sha: SHA, policyHash: 'c'.repeat(64), tool: 'cucumber-js', scope: ['unit'], passed: false } };
  const fingerprint = evidenceFingerprint(this.failedValidation);
  this.failedValidation.successfulEvidence = [{ fingerprint, passed: false }];
});
When('targeted検証を計画する', function () { this.result = planValidation({ ...(this.boundValidation ?? this.failedValidation), kind: 'targeted' }); });
Then('targeted検証はreadyでありdeduplicatedではない', function () { assert.equal(this.result.status, 'ready'); assert.ok(this.result.checks.length > 0); });

Given('未知kindを含むpolicy metrics eventがある', function () { this.events = [{ kind: 'unknownMetric', value: 1 }]; });
Then('metricsはstructured diagnostic付きでinvalidになる', function () { assert.equal(this.result.valid, false); assert.equal(this.result.diagnostic.ruleId, 'ASC-METRIC-001'); });

Given('package defaultと初回導入前のproject policyがある', function () {
  this.floor = basePolicy([baseRule({ ruleId: 'ASC-FLOOR-001' })]);
  this.projectExtension = { budgets: { localFeedbackMs: 50, prGateMs: 500 }, rules: [baseRule({ ruleId: 'ASC-PROJECT-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound', targetLayer: 'project' })] };
});
When('effective policyを解決する', function () { this.result = resolveEffectivePolicy(this.floor, this.projectExtension); });
Then('安全floorを弱化せずproject ruleをstagedで追加する', function () { assert.equal(this.result.valid, true); assert.deepEqual(this.result.policy.rules.map((/** @type {any} */ rule) => rule.ruleId), ['ASC-FLOOR-001', 'ASC-PROJECT-001']); assert.equal(this.result.policy.rules[0].enforcement, 'deny'); const trustedExtension = structuredClone(this.projectExtension); trustedExtension.rules[0].activation = 'active'; const trusted = resolveEffectivePolicy(this.floor, trustedExtension, { trusted: true }); assert.equal(trusted.valid, true); assert.deepEqual(trusted.policy.rules.map((/** @type {any} */ rule) => rule.ruleId), ['ASC-FLOOR-001', 'ASC-PROJECT-001']); });

Given('bound ruleとnon-override ruleと期限付きoverrideがある', function () {
  this.boundRule = baseRule({ enforcement: 'require', overridePolicy: 'bound', scope: ['policy'] }); this.nonOverrideRule = baseRule();
  this.overrideExpected = { ruleId: this.boundRule.ruleId, issue: 834, scope: 'policy', actor: 'maintainer', sha: SHA, now: '2026-08-23T00:00:00Z' };
  this.validOverride = { ruleId: this.boundRule.ruleId, issue: 834, scope: 'policy', actor: 'maintainer', reason: '期限付き復旧', expiresAt: '2026-08-24T00:00:00Z', sha: SHA };
});
When('overrideの正常、Issue不一致、理由なし、期限切れ、non-overrideを検証する', function () {
  this.overrideResults = {
    valid: validateOverride(this.boundRule, this.validOverride, this.overrideExpected),
    issue: validateOverride(this.boundRule, { ...this.validOverride, issue: 999 }, this.overrideExpected),
    reason: validateOverride(this.boundRule, { ...this.validOverride, reason: '' }, this.overrideExpected),
    expired: validateOverride(this.boundRule, { ...this.validOverride, expiresAt: '2026-08-22T00:00:00Z' }, this.overrideExpected),
    nonOverride: validateOverride(this.nonOverrideRule, this.validOverride, this.overrideExpected),
  };
});
Then('正常overrideだけに監査recordがあり他は拒否される', function () { assert.ok(this.overrideResults.valid.audit); for (const key of ['issue', 'reason', 'expired', 'nonOverride']) { assert.equal(this.overrideResults[key].valid, false); assert.equal(this.overrideResults[key].audit, undefined); } });

Given('override対象と異なるrule IDの記録がある', function () {
  this.rule = baseRule({ ruleId: 'ASC-OVERRIDE-TARGET-001', enforcement: 'require', overridePolicy: 'bound' });
  this.expectedOverride = { ruleId: this.rule.ruleId, issue: 834, scope: 'policy', actor: 'maintainer', sha: SHA, now: '2026-08-23T00:00:00Z' };
  this.override = { ruleId: 'ASC-OTHER-RULE-001', issue: 834, scope: 'policy', actor: 'maintainer', reason: '別ruleの記録を再利用しようとした', expiresAt: '2026-08-24T00:00:00Z', sha: SHA };
});

Given('trusted boundaryに必須属性を欠くruleがある', function () {
  const { targetLayer: _omitted, ...withoutTarget } = baseRule({ scope: ['pull_request'] });
  const invalid = /** @type {any} */ (withoutTarget);
  this.boundaryInput = { policy: basePolicy([invalid]), boundary: 'pull_request', observations: [{ ruleId: invalid.ruleId, violated: false }] };
});
When('trusted boundaryを評価する', function () { this.result = enforceTrustedBoundary(this.boundaryInput); });
Then('policy検証でoperationを拒否する', function () { assert.equal(this.result.allowed, false); assert.equal(this.result.results, undefined); assert.match(JSON.stringify(this.result.diagnostic), /targetLayer/u); });

Given('ownerとtarget layerが誤配置されたasset分類がある', function () { this.ownershipAssets = [{ path: '.agent-skill-chain/project-policy.json', owner: '', targetLayer: 'package', evidence: '' }]; });
When('local、PR、packageのownership境界を評価する', function () { this.ownership = { local: validateOwnershipBoundary(this.ownershipAssets, 'local'), pr: validateOwnershipBoundary(this.ownershipAssets, 'pr'), package: validateOwnershipBoundary(this.ownershipAssets, 'package') }; });
Then('localは移動先とdry-run案を支援しPRは証拠を要求して実配布だけをdenyする', function () { assert.equal(this.ownership.local.status, 'assisted'); assert.equal(this.ownership.local.allowed, true); assert.ok(this.ownership.local.diagnostic.autoFixes[0].dryRunDiff); assert.equal(this.ownership.pr.status, 'required'); assert.equal(this.ownership.pr.allowed, false); assert.equal(this.ownership.package.status, 'blocked'); assert.equal(this.ownership.package.allowed, false); });

Given('I1〜I12のconformance contractがある', function () { this.contract = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/conformance.json', 'utf8')); this.contractResult = validateConformanceContract(this.contract); });
When('invariant {word}を検証する', function (id) { this.invariant = this.contractResult.invariants.find((/** @type {any} */ item) => item.id === id); });
Then('source、enforcement point、counterexample SCN、evidence、rollbackが揃う', function () {
  assert.equal(this.contractResult.valid, true, this.contractResult.errors.join('; '));
  for (const key of ['sourceHook', 'enforcementHooks', 'evidenceHooks', 'rollback']) assert.ok(this.invariant[key]?.length > 0, key);
  for (const [file, property] of [['.agent-skill-chain/schemas/conformance-contract.schema.json', 'invariants'], ['.agent-skill-chain/schemas/project-conformance-binding.schema.json', 'bindings']]) {
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    const clauses = schema.properties[property].allOf;
    assert.ok(Array.isArray(clauses), `${file} must constrain exact invariant IDs`);
    assert.equal(clauses.filter((/** @type {any} */ clause) => clause.contains?.properties?.id?.const === this.invariant.id && clause.minContains === 1 && clause.maxContains === 1).length, 1, `${file}:${this.invariant.id}`);
  }
});

Given('policy、schema、runtime、CI、templateの隔離fixtureと変更manifestがある', function () {
  this.root = this.temp('asc-manifest-'); this.trusted = basePolicy();
  this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-MANIFEST-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  this.entries = migrationEntries(this.root, this.candidate);
  this.beforeContents = Object.fromEntries(this.entries.map((/** @type {any} */ entry) => [entry.path, fs.readFileSync(path.join(this.root, entry.path), 'utf8')]));
});
When('実manifestをdry-run、apply、rollbackする', function () { this.plan = planFileMigration(this.root, this.trusted, this.candidate, this.entries); const approvedPlanHash = this.plan.planFingerprint; this.appliedManifest = applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash, expectedRevision: 0 }); this.afterContents = Object.fromEntries(this.entries.map((/** @type {any} */ entry) => [entry.path, fs.readFileSync(path.join(this.root, entry.path), 'utf8')])); this.rolledManifest = rollbackFileMigration(this.appliedManifest, this.trusted, this.candidate, { approvedPlanHash, expectedRevision: 1 }); });
Then('path、順序、before after hashと状態revisionを記録する', function () { assert.equal(this.plan.revision, 0); assert.deepEqual(this.plan.manifest.map((/** @type {any} */ item) => item.order), [0, 1, 2, 3, 4]); for (const item of this.plan.manifest) { assert.ok(item.path); assert.ok(item.beforeHash); assert.ok(item.afterHash); } assert.equal(this.appliedManifest.revision, 1); assert.equal(this.rolledManifest.revision, 2); });
Then('apply後検証とrollback後復旧が実fileで一致する', function () { assert.equal(this.appliedManifest.readAfterWrite, true); for (const entry of this.entries) { assert.equal(this.afterContents[entry.path], entry.after); assert.equal(fs.readFileSync(path.join(this.root, entry.path), 'utf8'), this.beforeContents[entry.path]); } assert.equal(this.rolledManifest.rollbackVerified, true); });

Given('rollback済みmigration stateと変更済みcandidateまたはrevision改竄がある', function () {
  this.root = this.temp('asc-tamper-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-RETRY-TAMPER-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  fs.writeFileSync(path.join(this.root, 'policy.txt'), 'before\n');
  const entries = migrationEntries(this.root, this.candidate).slice(0, 1); const plan = planFileMigration(this.root, this.trusted, this.candidate, entries); this.approvedPlanHash = plan.planFingerprint;
  this.rolledTamper = rollbackFileMigration(applyFileMigration(plan, this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 0 }), this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 1 });
  this.changedCandidate = structuredClone(this.candidate); this.changedCandidate.budgets.localFeedbackMs += 1;
  this.revisionTamper = { ...this.rolledTamper, revision: 99 };
});
When('trustedとcandidateを再検証してretryする', function () { this.tamperResults = [retryFileMigration(this.rolledTamper, this.trusted, this.changedCandidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 2 }), retryFileMigration(this.revisionTamper, this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 2 })]; });
Then('immutable fingerprintとhash不一致をstructured拒否する', function () { for (const result of this.tamperResults) { assert.equal(result.state, 'rejected'); assert.equal(result.allowed, false); assert.equal(result.diagnostic.ruleId, 'ASC-MIGRATION-TOCTOU-001'); } });

Given(/^未知fieldを持つv0\.3 policyと空rulesのv0\.4 policyがある$/, function () { this.v03Unknown = { schemaVersion: 'agent-skill-chain/project-policy/v0.3', delivery: { stopAt: 'pull_request' }, merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 0 }, mystery: true }; this.v04Empty = basePolicy([]); });
When('schema契約とruntime契約を検証する', function () { this.schemaRuntime = [validatePolicy(this.v03Unknown), validatePolicy(this.v04Empty)]; this.schemaText = fs.readFileSync('.agent-skill-chain/schemas/project-policy.schema.json', 'utf8'); });
Then('両方が安全なmigration diagnostic付きでinvalidになる', function () { for (const result of this.schemaRuntime) { assert.equal(result.valid, false); assert.ok(result.diagnostics[0]); assert.ok(result.migration || result.diagnostics[0].next.includes('migration')); } assert.ok(this.schemaText.includes('"minItems": 1')); assert.ok(this.schemaText.includes('"else"')); });

Given('配布fixtureにenv派生fileとmanifest外assetがある', function () { this.root = this.temp('asc-pack-abuse-'); writeJson(path.join(this.root, 'package.json'), { name: 'fixture', version: '1.0.0', files: ['index.js', '.env.production', 'extra.txt'] }); fs.writeFileSync(path.join(this.root, 'index.js'), 'export {};\n'); fs.writeFileSync(path.join(this.root, '.env.production'), 'TOKEN=not-a-real-secret\n'); fs.writeFileSync(path.join(this.root, 'extra.txt'), 'extra\n'); });
When('実npm pack内容をpackage境界で検証する', function () { const output = this.temp('asc-pack-output-'); const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts', `--pack-destination=${output}`], { cwd: this.root, encoding: 'utf8' }); assert.equal(packed.status, 0, packed.stderr); this.packedFiles = JSON.parse(packed.stdout)[0].files.map((/** @type {any} */ item) => item.path); this.result = validatePackageManifest(this.packedFiles, ['index.js']); });
Then('env派生fileとmanifest外assetをstructured拒否する', function () { assert.equal(this.result.valid, false); assert.ok(this.result.reasons.some((/** @type {string} */ reason) => reason.includes('.env.production'))); assert.ok(this.result.reasons.some((/** @type {string} */ reason) => reason.includes('extra.txt'))); assert.equal(this.result.diagnostic.ruleId, 'ASC-ARTIFACT-001'); });

Given('同一policyと空の実manifestがある', function () { this.root = this.temp('asc-no-change-'); this.trusted = basePolicy(); this.candidate = structuredClone(this.trusted); this.emptyManifest = []; });
Then('changesとmanifestは空である', function () { assert.deepEqual(this.result.changes, []); assert.deepEqual(this.result.manifest ?? [], []); });

Given('tracked dogfood policyを持つ隔離Git repositoryがある', function () {
  this.root = this.initRepo(); fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true });
  this.trusted = basePolicy(); this.normalCandidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-DOGFOOD-NORMAL-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound', targetLayer: 'project' })]); this.weakCandidate = basePolicy([baseRule({ enforcement: 'warn', overridePolicy: 'bound' })]);
  this.trackedPolicy = path.join(this.root, '.agent-skill-chain', 'project-policy.json'); this.normalFile = path.join(this.root, 'normal.json'); this.weakFile = path.join(this.root, 'weak.json'); writeJson(this.trackedPolicy, this.trusted); writeJson(this.normalFile, this.normalCandidate); writeJson(this.weakFile, this.weakCandidate); spawnSync('git', ['add', '.agent-skill-chain/project-policy.json'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'dogfood policy'], { cwd: this.root });
});
When('実binで通常拡張と自己緩和を評価する', function () { this.binResults = [executeBin(['policy', 'evaluate', `--trusted=${this.trackedPolicy}`, `--candidate=${this.normalFile}`]), executeBin(['policy', 'evaluate', `--trusted=${this.trackedPolicy}`, `--candidate=${this.weakFile}`])]; this.tracked = spawnSync('git', ['ls-files', '.agent-skill-chain/project-policy.json'], { cwd: this.root, encoding: 'utf8' }).stdout.trim(); });
Then('通常拡張は成功し自己緩和はASC-TRUST-001で拒否される', function () { assert.equal(this.tracked, '.agent-skill-chain/project-policy.json'); assert.equal(this.binResults[0].status, 0, this.binResults[0].stderr); assert.notEqual(this.binResults[1].status, 0); assert.ok(this.binResults[1].stdout.includes('ASC-TRUST-001')); });

Given('{word}境界のrequire ruleと未達条件がある', function (boundary) { this.root = this.temp('asc-enforce-bin-'); this.boundary = boundary; const rule = baseRule({ ruleId: `ASC-${boundary.toUpperCase()}-REQUIRE-001`, enforcement: 'require', overridePolicy: 'bound', riskClass: 'quality', scope: [boundary], targetLayer: 'project' }); this.enforcePolicy = path.join(this.root, 'policy.json'); this.enforceInput = path.join(this.root, 'input.json'); writeJson(this.enforcePolicy, basePolicy([rule])); writeJson(this.enforceInput, { ruleId: rule.ruleId, boundary, violated: true, reasons: ['必要証拠がない'] }); });
When('実binでoperationをenforceする', function () { this.cliResult = executeBin(['policy', 'enforce', `--policy=${this.enforcePolicy}`, `--input=${this.enforceInput}`]); });
Then('operationは日本語diagnostic付きで非許可になる', function () { assert.notEqual(this.cliResult.status, 0); for (const fragment of ['ルールID', '安全な次の操作', 'rollback方法']) assert.ok(this.cliResult.stdout.includes(fragment)); });

Given('policy、schema、runtime、CI、templateのCLI migration fixtureがある', function () { this.root = this.temp('asc-cli-manifest-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-CLI-MANIFEST-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); this.trustedFile = path.join(this.root, 'trusted.json'); this.candidateFile = path.join(this.root, 'candidate.json'); this.stateFile = path.join(this.root, 'state.json'); writeJson(this.trustedFile, this.trusted); writeJson(this.candidateFile, this.candidate); const entries = migrationEntries(this.root, this.candidate); this.manifestFile = path.join(this.root, 'manifest.json'); writeJson(this.manifestFile, { root: this.root, entries }); this.cliManifestEntries = entries; });
When('実binでdry-run、apply、rollback、retry、改竄retryを実行する', function () { const common = [`--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, `--manifest=${this.manifestFile}`]; const dryRun = executeBin(['policy', 'migrate', ...common, '--dry-run']); const approvedPlanHash = JSON.parse(dryRun.stdout).planFingerprint; const approval = `--approved-plan-hash=${approvedPlanHash}`; this.cliManifestResults = [dryRun, executeBin(['policy', 'migrate', ...common, approval, '--expected-revision=0', `--state=${this.stateFile}`, '--apply']), executeBin(['policy', 'migrate', '--operation=rollback', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, approval, '--expected-revision=1', `--state=${this.stateFile}`, '--apply']), executeBin(['policy', 'migrate', '--operation=retry', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, approval, '--expected-revision=2', `--state=${this.stateFile}`, '--apply'])]; const tampered = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); tampered.revision = 99; writeJson(this.stateFile, tampered); this.tamperedCliResult = executeBin(['policy', 'migrate', '--operation=retry', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, approval, '--expected-revision=2', `--state=${this.stateFile}`, '--apply']); });
Then('実fileは復旧再適用され改竄retryだけがstructured拒否される', function () { for (const result of this.cliManifestResults) assert.equal(result.status, 0, result.stderr); for (const entry of this.cliManifestEntries) assert.equal(fs.readFileSync(path.join(this.root, entry.path), 'utf8'), entry.after); assert.notEqual(this.tamperedCliResult.status, 0); assert.ok(this.tamperedCliResult.stdout.includes('ASC-MIGRATION-TOCTOU-001')); assert.ok(this.tamperedCliResult.stdout.includes('安全な次の操作')); });

Given('trusted ruleのevidence remediation rollbackとauthority choiceをcandidateが変更する', function () {
  const choices = { language: 'a', testRunner: 'b', testLayers: ['c'], naming: 'd', packageManager: 'e', runtime: 'f', ci: 'g', modelMapping: 'h', release: 'i' };
  this.trusted = { ...basePolicy(), projectChoices: choices }; this.candidate = structuredClone(this.trusted);
  Object.assign(this.candidate.rules[0], { evidence: '変更', remediation: '変更', rollback: '変更' }); this.candidate.projectChoices.release = 'automatic';
});
Then('同一rule IDの契約変更とauthority choice変更を拒否する', function () { const reasons = this.result.rejected.flatMap((/** @type {any} */ item) => item.reasons).join(' '); assert.equal(this.result.allowed, false); assert.match(reasons, /意味fingerprint/u); assert.match(reasons, /projectChoices/u); });

Given('current evidenceがpassed falseで同fingerprintの成功cacheがある', function () { this.failedValidation = { changedFiles: ['src/x.js'], risk: ['quality'], evidence: { sha: SHA, policyHash: 'c'.repeat(64), tool: 'runner', scope: ['selected'], passed: false } }; const fingerprint = evidenceFingerprint(this.failedValidation); this.failedValidation.successfulEvidence = [{ fingerprint, passed: true }]; });

Given('token key、Bearer、URL credential、PEMを含む全結果種別がある', function () { const secrets = { token: 'token-value-never-show', nested: { apiKey: 'api-value-never-show' }, text: 'Bearer bearer-never-show https://user:pass@example.test -----BEGIN PRIVATE KEY-----\nprivate-never-show\n-----END PRIVATE KEY-----' }; this.outputKinds = ['passed', 'warned', 'assisted', 'pending', 'migration', 'overridden', 'metrics', 'autofix', 'exception'].map((status) => ({ status, ...secrets })); });
When('全結果をsafe serializerで出力する', function () { this.serializedKinds = this.outputKinds.map(serializeDiagnostic); });
Then('秘密が残らず全結果に完全diagnosticがある', function () { const output = JSON.stringify(this.serializedKinds); for (const secret of ['token-value-never-show', 'api-value-never-show', 'bearer-never-show', 'user:pass', 'private-never-show']) assert.equal(output.includes(secret), false); for (const item of this.serializedKinds) for (const field of ['ruleId', 'purpose', 'risk', 'reasons', 'scope', 'checks', 'autoFixes', 'next', 'requiredAuthority', 'rollback']) assert.ok(item.result.diagnostic[field] !== undefined, field); });

Given('Git内部、unrelated file、symlink、制御文字、Unicode case衝突を含むmanifestがある', function () {
  this.root = this.initRepo(); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-PATH-NEW-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]);
  fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true }); fs.symlinkSync(this.temp('asc-outside-'), path.join(this.root, '.agent-skill-chain', 'schemas'));
  this.badManifests = [
    [{ kind: 'runtime', path: '.git/config', after: 'export {};\n' }], [{ kind: 'runtime', path: 'unrelated-user-data.txt', after: 'export {};\n' }],
    [{ kind: 'schema', path: '.agent-skill-chain/schemas/x.json', after: '{"$schema":"x","type":"object"}\n' }], [{ kind: 'runtime', path: 'src/control\u0001.js', after: 'export {};\n' }],
    [{ kind: 'schema', path: '.agent-skill-chain/schemas/Å.json', after: '{"$schema":"x","type":"object"}\n' }, { kind: 'schema', path: '.agent-skill-chain/schemas/å.json', after: '{"$schema":"x","type":"object"}\n' }],
    [{ kind: 'runtime', path: '../escape.js', after: 'export {};\n' }], [{ kind: 'runtime', path: path.join(this.root, 'absolute.js'), after: 'export {};\n' }],
  ];
});
When('authority付き実manifestをdry-runする', function () { if (this.badManifests) this.authorityPlans = this.badManifests.map((/** @type {any} */ entries) => planFileMigration(this.root, this.trusted, this.candidate, entries)); else { this.authorityPlan = planFileMigration(this.root, this.trusted, this.candidate, this.entries); this.duplicatePlan = planFileMigration(this.root, this.trusted, this.candidate, [...this.entries, this.entries[0]]); } });
Then('全てのnon-owned pathはnon-override diagnosticで拒否される', function () { for (const result of this.authorityPlans) { assert.equal(result.allowed, false); assert.equal(result.diagnostic.overridePolicy, 'never'); } });

Given('runtime kindの異なるowned pathを2件持つmanifestがある', function () { this.root = this.temp('asc-multi-kind-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-MULTI-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); this.entries = [{ kind: 'runtime', path: 'src/a.js', after: 'export const a = 1;\n' }, { kind: 'runtime', path: 'src/b.js', after: 'export const b = 1;\n' }]; for (const entry of this.entries) { fs.mkdirSync(path.dirname(path.join(this.root, entry.path)), { recursive: true }); fs.writeFileSync(path.join(this.root, entry.path), 'before\n'); } });
Then('kind重複は許可しpath重複だけを拒否する', function () { assert.equal(this.authorityPlan.allowed, true, JSON.stringify(this.authorityPlan)); assert.equal(this.authorityPlan.manifest.length, 2); assert.equal(this.duplicatePlan.allowed, false); });

Given('candidateと異なるpolicy afterと不正なschema runtime CI templateがある', function () { this.root = this.temp('asc-invalid-artifacts-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-ARTIFACT-NEW-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); this.badManifests = [[{ kind: 'policy', path: '.agent-skill-chain/project-policy.json', after: '{}\n' }], [{ kind: 'schema', path: '.agent-skill-chain/schemas/x.json', after: '{}\n' }], [{ kind: 'runtime', path: 'src/x.js', after: '\u0000' }], [{ kind: 'CI', path: '.github/workflows/x.yml', after: 'name: x\n' }], [{ kind: 'template', path: '.agent-skill-chain/templates/x.md', after: '' }]]; });
Then('kind別validatorが全ての不正artifactを拒否する', function () { assert.equal(this.authorityPlans.length, 5); for (const result of this.authorityPlans) assert.equal(result.allowed, false); });

Given('durable journalを持つ複数file migrationがある', function () { this.root = this.temp('asc-journal-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-JOURNAL-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); this.entries = [{ kind: 'runtime', path: 'src/a.js', after: 'export const a = 2;\n' }, { kind: 'runtime', path: 'src/b.js', after: 'export const b = 2;\n' }]; for (const entry of this.entries) { fs.mkdirSync(path.dirname(path.join(this.root, entry.path)), { recursive: true }); fs.writeFileSync(path.join(this.root, entry.path), 'before\n'); } this.plan = planFileMigration(this.root, this.trusted, this.candidate, this.entries); });
When('state書込直後、partial apply、rollback途中のcrashを注入する', function () { const journals = /** @type {any[]} */ ([]); try { applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash: this.plan.planFingerprint, expectedRevision: 0, persist: (value) => journals.push(structuredClone(value)), interruptAfterStep: 0 }); } catch { /* simulated process interruption */ } this.initialJournal = journals[0]; this.partialRecovery = recoverFileMigration(journals.at(-1), this.trusted, this.candidate, { approvedPlanHash: this.plan.planFingerprint, expectedRevision: 0 }); const applied = applyFileMigration({ ...this.plan, revision: 0 }, this.trusted, this.candidate, { approvedPlanHash: this.plan.planFingerprint, expectedRevision: 0 }); const rollbackJournals = /** @type {any[]} */ ([]); try { rollbackFileMigration(applied, this.trusted, this.candidate, { approvedPlanHash: this.plan.planFingerprint, expectedRevision: 1, persist: (value) => rollbackJournals.push(structuredClone(value)), interruptAfterStep: 0 }); } catch { /* simulated process interruption */ } this.rollbackRecovery = recoverFileMigration(rollbackJournals.at(-1), this.trusted, this.candidate, { approvedPlanHash: this.plan.planFingerprint, expectedRevision: 1 }); });
Then('次回実行がbefore after hashから全fileを回復する', function () { assert.equal(this.initialJournal.transaction.phase, 'applying'); assert.equal(this.partialRecovery.state, 'rolled_back'); assert.equal(this.rollbackRecovery.state, 'rolled_back'); for (const entry of this.entries) assert.equal(fs.readFileSync(path.join(this.root, entry.path), 'utf8'), 'before\n'); });

Given('allowlisted srcにcredential境界、oauth、reauth及びtoken内容がある', function () { this.root = this.temp('asc-credential-pack-'); fs.mkdirSync(path.join(this.root, 'src')); writeJson(path.join(this.root, 'package.json'), { name: 'credential-fixture', version: '1.0.0', files: ['src/'] }); for (const name of ['credentials.json', 'oauth-client.json', 'reauth-session.json', 'client-secrets.json']) fs.writeFileSync(path.join(this.root, 'src', name), '{"username":"x"}\n'); fs.writeFileSync(path.join(this.root, 'src/data.json'), '{"token":"token-never-ship"}\n'); });
When('実npm packの名前とcontentを検査する', function () { const output = this.temp('asc-pack-output-'); const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts', `--pack-destination=${output}`], { cwd: this.root, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(output, 'npm-cache') } }); assert.equal(packed.status, 0, packed.stderr); const archiveName = fs.readdirSync(output).find((name) => name.endsWith('.tgz')); assert.ok(archiveName, 'npm pack archive'); const archive = path.join(output, archiveName); const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }); assert.equal(listed.status, 0, listed.stderr); const files = listed.stdout.trim().split(/\r?\n/u).map((file) => file.replace(/^package\//u, '')).filter(Boolean); const contents = Object.fromEntries(files.filter((/** @type {string} */ file) => file !== 'package.json').map((/** @type {string} */ file) => { const extracted = spawnSync('tar', ['-xOf', archive, `package/${file}`], { encoding: 'utf8' }); assert.equal(extracted.status, 0, extracted.stderr); return [file, extracted.stdout]; })); this.result = validatePackageManifest(files, ['src/'], contents); });
Then('credential containerと秘密patternだけを拒否しoauthとreauthを許可する', function () { assert.equal(this.result.valid, false); for (const name of ['credentials.json', 'client-secrets.json', 'data.json']) assert.ok(this.result.reasons.some((/** @type {string} */ reason) => reason.includes(name)), name); for (const name of ['oauth-client.json', 'reauth-session.json']) assert.equal(this.result.reasons.some((/** @type {string} */ reason) => reason.includes(name)), false, name); });

Given('unknown、duplicate、dead referenceを持つconformance bindingがある', function () { this.root = this.temp('asc-conformance-cli-'); const contract = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/conformance.json', 'utf8')); contract.invariants[11].id = 'I13'; contract.invariants.push(structuredClone(contract.invariants[0])); const binding = JSON.parse(fs.readFileSync('.agent-skill-chain/project/conformance/bindings.json', 'utf8')); binding.bindings[0].enforcement[0] = { path: 'missing.js', export: 'missing' }; this.contractFile = path.join(this.root, 'contract.json'); this.bindingFile = path.join(this.root, 'binding.json'); this.evidenceFile = path.join(this.root, 'evidence.json'); writeJson(this.contractFile, contract); writeJson(this.bindingFile, binding); writeJson(this.evidenceFile, { tool: 'cucumber-js', passedScenarioIds: [] }); });
When('repository conformance CLIを実行する', function () { this.cliResult = executeBin(['conformance', 'validate', `--root=${process.cwd()}`, `--contract=${this.contractFile}`, `--binding=${this.bindingFile}`, `--evidence=${this.evidenceFile}`]); });
Then('exact I1からI12と実在export、SCN、成功証拠の不足を拒否する', function () { assert.notEqual(this.cliResult.status, 0); for (const fragment of ['exact 12', '未知invariant', 'enforcement', '成功証拠']) assert.ok(this.cliResult.stdout.includes(fragment), fragment); });

Given('trusted origin policyを持つ隔離repositoryと不正なactual operationがある', function () { this.root = this.initRepo(); fs.mkdirSync(path.join(this.root, '.agent-skill-chain/policy'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/policy/default.json', path.join(this.root, '.agent-skill-chain/policy/default.json')); spawnSync('git', ['add', '.agent-skill-chain/policy/default.json'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'trusted floor'], { cwd: this.root }); spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: this.root }); spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: this.root }); });
When('preflight省略、別rule、violated falseを指定してactual CLIを実行する', function () { this.actualBypasses = ['omit', 'other', 'false'].map((name) => executeBin(['worktree', 'create', `--root=${this.root}`, `--path=${path.join(this.root, '.git', name)}`, '--branch=feature/bypass', '--base=main', '--rule=ASC-OFFLINE-001', '--violated=false'])); });
Then('actual stateから導出したtrusted enforcementが全てを拒否する', function () { for (const result of this.actualBypasses) { assert.notEqual(result.status, 0); assert.ok(result.stdout.includes('ASC-GIT-INTERNAL-001')); } });

Given('secretを含む存在しないpath入力がある', function () { this.secretPath = path.join(this.temp('asc-secret-error-'), 'token=token-never-show.json'); });
When('actual binでpath例外を発生させる', function () { this.cliResult = executeBin(['policy', 'validate', `--file=${this.secretPath}`]); });
Then('stdoutは秘密なしの完全structured diagnosticになる', function () { assert.notEqual(this.cliResult.status, 0); assert.equal(this.cliResult.stdout.includes('token-never-show'), false); const output = JSON.parse(this.cliResult.stdout); for (const field of ['ruleId', 'purpose', 'risk', 'reasons', 'scope', 'checks', 'autoFixes', 'next', 'requiredAuthority', 'rollback']) assert.ok(output.result.diagnostic[field] !== undefined, field); });

Given('valid project policy manifestと悪用fragment variantsがある', function () { const create = () => { const root = this.temp('asc-project-set-'); fs.mkdirSync(path.join(root, '.agent-skill-chain'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/project-policy.json', path.join(root, '.agent-skill-chain/project-policy.json')); fs.cpSync('.agent-skill-chain/project', path.join(root, '.agent-skill-chain/project'), { recursive: true }); return root; }; this.projectSetVariants = [];
  { const root = create(); fs.writeFileSync(path.join(root, '.agent-skill-chain/project/rules/orphan.json'), '{}\n'); this.projectSetVariants.push(root); }
  { const root = create(); fs.rmSync(path.join(root, '.agent-skill-chain/project/rules/docs.json')); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project/rules/docs.json'); fs.rmSync(file); fs.symlinkSync(path.join(process.cwd(), '.agent-skill-chain/project/rules/docs.json'), file); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project/rules/docs.json'); fs.writeFileSync(file, '{"ruleId":"A","ruleId":"B"}\n'); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project-policy.json'); const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); manifest.policy = 1; writeJson(file, manifest); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project-policy.json'); const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); manifest.ruleFiles[0] = 'project/rules/nested/rule.json'; writeJson(file, manifest); this.projectSetVariants.push(root); }
  { const root = create(); fs.mkdirSync(path.join(root, '.agent-skill-chain/project/unknown')); fs.writeFileSync(path.join(root, '.agent-skill-chain/project/unknown/value.json'), '{}\n'); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project/rules/docs.json'); fs.chmodSync(file, 0o755); this.projectSetVariants.push(root); }
  { const root = create(); const file = path.join(root, '.agent-skill-chain/project-policy.json'); fs.writeFileSync(file, '{"schemaVersion":"agent-skill-chain/project-policy-manifest/v1","schemaVersion":"duplicate"}\n'); this.projectSetVariants.push(root); }
});
When('filesystem policy setを厳密にloadする', function () { this.projectSetErrors = this.projectSetVariants.map((/** @type {string} */ root) => { try { loadProjectPolicySet(root); return undefined; } catch (error) { return error instanceof Error ? error.message : String(error); } }); });
Then('inventory不一致、不正path、duplicate keyはすべて拒否される', function () { assert.equal(this.projectSetErrors.every(Boolean), true, JSON.stringify(this.projectSetErrors)); assert.ok(this.projectSetErrors.some((/** @type {string} */ error) => error.includes('inventory'))); assert.ok(this.projectSetErrors.some((/** @type {string} */ error) => error.includes('symlink') || error.includes('通常JSON'))); assert.ok(this.projectSetErrors.some((/** @type {string} */ error) => error.includes('重複key'))); });

Given('originにmanifestと全fragmentを持つtrusted commitがある', function () { this.root = this.initRepo(); fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/project-policy.json', path.join(this.root, '.agent-skill-chain/project-policy.json')); fs.cpSync('.agent-skill-chain/project', path.join(this.root, '.agent-skill-chain/project'), { recursive: true }); spawnSync('git', ['add', '.agent-skill-chain'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'trusted project set'], { cwd: this.root }); spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: this.root }); });
When('trusted project policy setをloadする', function () { this.trustedSet = loadTrustedProjectPolicySet(this.root, 'origin/main'); this.trustedHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim(); try { loadEffectiveTrustedPolicySet(this.root, 'main'); } catch (error) { this.missingFloorError = error instanceof Error ? error.message : String(error); } });
Then('provenance commit、set hash、semantic policy hashが固定される', function () { assert.equal(this.trustedSet.provenance.commitSha, this.trustedHead); assert.match(this.trustedSet.setHash, /^[a-f0-9]{64}$/u); assert.match(this.trustedSet.semanticPolicyHash, /^[a-f0-9]{64}$/u); assert.notEqual(this.trustedSet.setHash, this.trustedSet.semanticPolicyHash); assert.match(this.missingFloorError, /default safety floor/u); });

Given('self asserted approved hashを持つforged migration stateがある', function () { this.root = this.temp('asc-self-approved-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-SELF-APPROVAL-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); fs.mkdirSync(path.join(this.root, 'src')); fs.writeFileSync(path.join(this.root, 'src/value.js'), 'before\n'); this.plan = planFileMigration(this.root, this.trusted, this.candidate, [{ kind: 'runtime', path: 'src/value.js', after: 'export const value = 2;\n' }]); this.approvedPlanHash = this.plan.planFingerprint; });
When('外部approvalまたはexpected revisionなしで全state changing APIを呼ぶ', function () {
  this.authorityResults = [];
  this.authorityResults.push(applyFileMigration(this.plan, this.trusted, this.candidate, { expectedRevision: 0 }));
  this.authorityResults.push(applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash }));
  fs.writeFileSync(path.join(this.root, 'src/value.js'), 'before\n');
  this.authorityResults.push(applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash: '0'.repeat(64), expectedRevision: 0 }));
  const applied = applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 0 });
  this.authorityResults.push(rollbackFileMigration(applied, this.trusted, this.candidate, { expectedRevision: 1 }));
  this.authorityResults.push(retryFileMigration({ ...this.plan, state: 'rolled_back', revision: 2, approvedPlanHash: this.approvedPlanHash, history: ['staged', 'applied', 'rolled_back'] }, this.trusted, this.candidate, { expectedRevision: 2 }));
  this.authorityResults.push(recoverFileMigration({ ...this.plan, approvedPlanHash: this.approvedPlanHash, transaction: { phase: 'applying', nextStep: 0 } }, this.trusted, this.candidate, { expectedRevision: 0 }));
  fs.writeFileSync(path.join(this.root, 'src/value.js'), 'before\n');
  this.authorityResults.push(applyFileMigration(this.plan, this.trusted, this.candidate, { approvedPlanHash: this.approvedPlanHash, expectedRevision: 9 }));
  const conceptualPlan = planMigration(this.trusted, this.candidate);
  this.authorityResults.push(applyMigration(conceptualPlan));
  const conceptualApplied = applyMigration(conceptualPlan, { approvedPlanHash: conceptualPlan.planFingerprint, expectedRevision: 0 });
  this.authorityResults.push(rollbackMigration(conceptualApplied));
  this.authorityResults.push(retryMigration({ ...conceptualApplied, state: 'rolled_back', revision: 2, history: ['staged', 'applied', 'rolled_back'] }, this.trusted, this.candidate));
});
Then('全APIはauthority不足をstructured拒否しfileを変更しない', function () { for (const result of this.authorityResults) { assert.equal(result.allowed, false, JSON.stringify(result)); assert.equal(result.state, 'rejected'); assert.equal(result.diagnostic.ruleId, 'ASC-MIGRATION-TOCTOU-001'); } assert.equal(fs.readFileSync(path.join(this.root, 'src/value.js'), 'utf8'), 'before\n'); });

Given('trustedとcandidateのfragmented project policy setがある', function () {
  const copySet = (/** @type {string} */ prefix) => { const root = this.temp(prefix); fs.mkdirSync(path.join(root, '.agent-skill-chain'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/project-policy.json', path.join(root, '.agent-skill-chain/project-policy.json')); fs.cpSync('.agent-skill-chain/project', path.join(root, '.agent-skill-chain/project'), { recursive: true }); return root; };
  this.root = copySet('asc-fragment-target-'); this.candidateRoot = copySet('asc-fragment-candidate-');
  const manifestFile = path.join(this.candidateRoot, '.agent-skill-chain/project-policy.json'); const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const newRef = 'project/rules/staged-migration.json'; manifest.ruleFiles.push(newRef); manifest.ruleFiles.sort(); writeJson(manifestFile, manifest);
  writeJson(path.join(this.candidateRoot, '.agent-skill-chain', newRef), baseRule({ ruleId: 'ASC-FRAGMENT-MIGRATION-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound', targetLayer: 'project' }));
  this.trustedSet = loadProjectPolicySet(this.root); this.candidateSet = loadProjectPolicySet(this.candidateRoot);
  this.fragmentEntries = ['project-policy.json', ...manifest.choiceFiles, ...manifest.ruleFiles, ...manifest.conformanceFiles].map((relative) => ({ kind: 'policy', path: `.agent-skill-chain/${relative}`, after: fs.readFileSync(path.join(this.candidateRoot, '.agent-skill-chain', relative), 'utf8') }));
});
When('monolith afterとcandidate raw inventoryのmigrationを計画する', function () {
  this.monolithPlan = planFileMigration(this.root, this.trustedSet, this.candidateSet, [{ kind: 'policy', path: '.agent-skill-chain/project-policy.json', after: `${JSON.stringify(this.candidateSet.policy, null, 2)}\n` }]);
  this.mixedFormPlan = planFileMigration(this.root, this.trustedSet, this.candidateSet.policy, [{ kind: 'policy', path: '.agent-skill-chain/project-policy.json', after: `${JSON.stringify(this.candidateSet.policy, null, 2)}\n` }]);
  this.fragmentPlan = planFileMigration(this.root, this.trustedSet, this.candidateSet, this.fragmentEntries);
  if (this.fragmentPlan.allowed) this.fragmentApplied = applyFileMigration(this.fragmentPlan, this.trustedSet, this.candidateSet, { approvedPlanHash: this.fragmentPlan.planFingerprint, expectedRevision: 0 });
});
Then('monolithは拒否されreal inventoryはapply後set hashまで一致する', function () { assert.equal(this.monolithPlan.allowed, false); assert.equal(this.mixedFormPlan.allowed, false); assert.equal(this.fragmentPlan.allowed, true, JSON.stringify(this.fragmentPlan)); assert.equal(this.fragmentApplied.allowed, true, JSON.stringify(this.fragmentApplied)); const loaded = loadProjectPolicySet(this.root); assert.equal(loaded.setHash, this.candidateSet.setHash); assert.equal(loaded.semanticPolicyHash, this.candidateSet.semanticPolicyHash); });

Given('project denyを持つtrusted commitと解決不能なorigin HEADがある', function () { this.root = this.initRepo(); fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/project-policy.json', path.join(this.root, '.agent-skill-chain/project-policy.json')); fs.cpSync('.agent-skill-chain/project', path.join(this.root, '.agent-skill-chain/project'), { recursive: true }); fs.mkdirSync(path.join(this.root, '.agent-skill-chain/policy'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/policy/default.json', path.join(this.root, '.agent-skill-chain/policy/default.json')); spawnSync('git', ['add', '.agent-skill-chain'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'trusted deny'], { cwd: this.root }); spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: this.root }); });
When('authority operation policyをloadする', function () { try { this.operationPolicy = loadOperationPolicy(this.root); } catch (error) { this.operationPolicyError = error instanceof Error ? error.message : String(error); } });
Then('trusted ref不明をfail closedにする', function () { assert.equal(this.operationPolicy, undefined); assert.match(this.operationPolicyError ?? '', /trusted|origin|HEAD|SHA/u); });

Given('recover可能journalとunknown hashのartifactがある', function () { this.root = this.temp('asc-recovery-cli-'); this.trusted = basePolicy(); this.candidate = basePolicy([...this.trusted.rules, baseRule({ ruleId: 'ASC-RECOVERY-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound' })]); fs.mkdirSync(path.join(this.root, 'src')); fs.writeFileSync(path.join(this.root, 'src/value.js'), 'before\n'); this.plan = planFileMigration(this.root, this.trusted, this.candidate, [{ kind: 'runtime', path: 'src/value.js', after: 'export const value = 2;\n' }]); this.stateFile = path.join(this.root, 'journal.json'); this.reportFile = `${this.stateFile}.report.json`; this.trustedFile = path.join(this.root, 'trusted.json'); this.candidateFile = path.join(this.root, 'candidate.json'); writeJson(this.trustedFile, this.trusted); writeJson(this.candidateFile, this.candidate); writeJson(this.stateFile, { ...this.plan, state: 'recovery_required', transaction: { phase: 'applying', nextStep: 0 } }); fs.writeFileSync(path.join(this.root, 'src/value.js'), 'unknown\n'); this.journalBefore = fs.readFileSync(this.stateFile, 'utf8'); });
When('CLI recoveryが失敗する', function () { this.recoveryCli = executeBin(['policy', 'migrate', '--operation=recover', `--trusted=${this.trustedFile}`, `--candidate=${this.candidateFile}`, `--state=${this.stateFile}`, `--approved-plan-hash=${this.plan.planFingerprint}`, '--expected-revision=0', '--apply']); });
Then('journalは保持され別reportへ失敗が記録される', function () { assert.notEqual(this.recoveryCli.status, 0); assert.equal(fs.readFileSync(this.stateFile, 'utf8'), this.journalBefore); const journal = JSON.parse(this.journalBefore); assert.ok(journal.manifest.length > 0 && journal.artifacts.length > 0); assert.equal(fs.existsSync(this.reportFile), true); assert.equal(JSON.parse(fs.readFileSync(this.reportFile, 'utf8')).state, 'rejected'); });

Given('origin HEADのないPR checkoutとtrusted base commitとcandidate policy setがある', function () { this.root = this.initRepo(); fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/project-policy.json', path.join(this.root, '.agent-skill-chain/project-policy.json')); fs.cpSync('.agent-skill-chain/project', path.join(this.root, '.agent-skill-chain/project'), { recursive: true }); fs.mkdirSync(path.join(this.root, '.agent-skill-chain/policy'), { recursive: true }); fs.copyFileSync('.agent-skill-chain/policy/default.json', path.join(this.root, '.agent-skill-chain/policy/default.json')); spawnSync('git', ['add', '.agent-skill-chain'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'trusted base'], { cwd: this.root }); this.baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim(); const manifestFile = path.join(this.root, '.agent-skill-chain/project-policy.json'); const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); const ref = 'project/rules/pr-candidate.json'; manifest.ruleFiles.push(ref); manifest.ruleFiles.sort(); writeJson(manifestFile, manifest); writeJson(path.join(this.root, '.agent-skill-chain', ref), baseRule({ ruleId: 'ASC-PR-CANDIDATE-001', enforcement: 'assist', activation: 'staged', riskClass: 'quality', overridePolicy: 'bound', targetLayer: 'project' })); });
When('explicit trusted commitでpolicy validate CLIを実行する', function () {
  const policy = '.agent-skill-chain/project-policy.json'; const common = ['policy', 'validate', policy, `--root=${this.root}`]; const missingSha = 'b'.repeat(40); const matching = [`--trusted-commit=${this.baseSha}`, `--expected-base-sha=${this.baseSha}`];
  this.explicitTrustedResults = [executeBinIn(this.root, [...common, ...matching]), executeBinIn(this.root, common), executeBinIn(this.root, [...common, '--trusted-commit=not-a-sha', `--expected-base-sha=${this.baseSha}`]), executeBinIn(this.root, [...common, `--trusted-commit=${this.baseSha}`, `--expected-base-sha=${missingSha}`]), executeBinIn(this.root, [...common, `--trusted-commit=${missingSha}`, `--expected-base-sha=${missingSha}`])];
  const manifestFile = path.join(this.root, '.agent-skill-chain/project-policy.json'); const manifestRaw = fs.readFileSync(manifestFile, 'utf8'); const projectDirectory = path.join(this.root, '.agent-skill-chain/project'); const savedProjectDirectory = path.join(this.root, '.agent-skill-chain/project-saved');
  writeJson(manifestFile, basePolicy()); this.explicitTrustedResults.push(executeBinIn(this.root, [...common, '--trusted-commit=not-a-sha', `--expected-base-sha=${this.baseSha}`]));
  fs.renameSync(projectDirectory, savedProjectDirectory); this.explicitTrustedResults.push(executeBinIn(this.root, [...common, ...matching]));
  fs.renameSync(savedProjectDirectory, projectDirectory); fs.writeFileSync(manifestFile, manifestRaw); fs.writeFileSync(path.join(projectDirectory, 'rules/orphan-ci.json'), '{}\n'); this.explicitTrustedResults.push(executeBinIn(this.root, [...common, ...matching]));
});
Then('base SHA一致だけ成功し欠落・不正・不一致はfail closedになる', function () { assert.equal(this.explicitTrustedResults[0].status, 0, this.explicitTrustedResults[0].stderr || this.explicitTrustedResults[0].stdout); for (const result of this.explicitTrustedResults.slice(1)) assert.notEqual(result.status, 0); });

Given('H_impl後にPhase A review artifactだけをcommitした隔離repositoryがある', function () {
  this.root = this.initRepo();
  fs.writeFileSync(path.join(this.root, 'product.js'), 'export const value = 1;\n');
  spawnSync('git', ['add', 'product.js'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'implementation'], { cwd: this.root });
  this.implementationCommitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  this.artifactPath = 'docs/reviews/phase-a.json'; fs.mkdirSync(path.dirname(path.join(this.root, this.artifactPath)), { recursive: true }); writeJson(path.join(this.root, this.artifactPath), { phase: 'A', status: 'pending-external-attestation' });
  spawnSync('git', ['add', this.artifactPath], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'phase A evidence'], { cwd: this.root });
  this.finalCommitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  this.externalFile = path.join(this.temp('asc-review-external-'), 'external.json'); writeJson(this.externalFile, {
    pr: { headSha: this.finalCommitSha }, ci: { headSha: this.finalCommitSha, runId: 'run-123', conclusion: 'success' },
    review: { headSha: this.finalCommitSha, commitSha: this.finalCommitSha, actorId: 'reviewer-123', submittedAt: '2026-08-23T12:00:00Z', verdict: 'approved', artifactId: 'review-123' },
  });
});
Given(/^GitHub review providerの(.+)観測がある$/u, function (variant) { prepareReviewGhStub(this, variant); });
When('review evidence CLIでGitとGitHub providerを結合する', function () {
  const common = ['review', 'evidence', `--root=${this.root}`, `--implementation-commit=${this.implementationCommitSha}`, `--final-commit=${this.finalCommitSha}`, `--artifact=${this.artifactPath}`];
  const provider = ['--repo=o/r', '--pr=835', '--run-id=32635972969', '--review-id=9001'];
  if (this.reviewVariant === 'forged-review-file') {
    const forged = path.join(this.temp('asc-forged-review-'), 'review.json'); writeJson(forged, completeReview(this.finalCommitSha, {
      candidateEvidence: { implementationCommitSha: this.implementationCommitSha, finalCommitSha: this.finalCommitSha, implementationTreeSha: 'a'.repeat(40), implementationIsAncestor: true, changedPaths: [this.artifactPath], artifact: { path: this.artifactPath, sha256: 'b'.repeat(64), blobOid: 'c'.repeat(40) } },
      externalEvidence: { provenance: { source: 'github', repository: 'o/r', prNumber: 835, runId: '32635972969', reviewId: '9001' }, implementation: { repository: 'o/r', commitSha: this.implementationCommitSha, authorActorId: 'actor-implementer' }, pr: { repository: 'o/r', number: 835, headSha: this.finalCommitSha, authorActorId: 'actor-implementer' }, ci: { repository: 'o/r', runId: '32635972969', event: 'pull_request', headSha: this.finalCommitSha, conclusion: 'success', pullRequestNumbers: [835] }, review: { repository: 'o/r', prNumber: 835, reviewId: '9001', commitSha: this.finalCommitSha, actorId: 'actor-reviewer', submittedAt: '2026-08-23T12:00:00Z', verdict: 'approved' } },
    }));
    this.reviewEvidenceCli = executeBinIn(this.root, ['review', 'validate', `--file=${forged}`], this.reviewCliEnv); return;
  }
  const args = this.reviewVariant === 'forged-file' ? [...common, `--external=${this.externalFile}`] : this.reviewVariant === 'forged-implementer-option' ? [...common, ...provider, '--implementer-actor-id=forged-actor'] : [...common, ...provider];
  this.reviewEvidenceCli = executeBinIn(this.root, args, this.reviewCliEnv); if (this.reviewEvidenceCli.stdout.trim()) { try { this.reviewEvidence = JSON.parse(this.reviewEvidenceCli.stdout); } catch {} }
});
Then('実tree、diff、artifact hash、blobとH_finalのtrusted review gateが一致する', function () { assert.equal(this.reviewEvidenceCli.status, 0, this.reviewEvidenceCli.stderr || this.reviewEvidenceCli.stdout); assert.equal(this.reviewEvidence.valid, true); assert.equal(this.reviewEvidence.status, 'verified'); assert.equal(this.reviewEvidence.externalEvidence.provenance.source, 'github'); assert.deepEqual(this.reviewEvidence.candidateEvidence.changedPaths, [this.artifactPath]); assert.match(this.reviewEvidence.candidateEvidence.implementationTreeSha, /^[a-f0-9]{40}$/u); assert.match(this.reviewEvidence.candidateEvidence.artifact.sha256, /^[a-f0-9]{64}$/u); assert.match(this.reviewEvidence.candidateEvidence.artifact.blobOid, /^[a-f0-9]{40}$/u); assert.equal(evaluateReview(completeReview(this.finalCommitSha, this.reviewEvidence)).approved, true); const operations = fs.readFileSync(this.ghLog, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).join(' ')); assert.deepEqual(operations, ['auth status', 'repo view', 'pr view', `api repos/o/r/commits/${this.implementationCommitSha}`, 'api repos/o/r/actions/runs/32635972969', 'api repos/o/r/pulls/835/reviews/9001']); });
Then('review evidenceは承認不能でgh呼出境界も守られる', function () { assert.notEqual(this.reviewEvidenceCli.status, 0); if (this.reviewEvidence?.candidateEvidence) assert.equal(evaluateReview(completeReview(this.finalCommitSha, this.reviewEvidence)).approved, false); const called = fs.existsSync(this.ghLog) ? fs.readFileSync(this.ghLog, 'utf8') : ''; if (this.reviewVariant.startsWith('forged-')) assert.equal(called, ''); else assert.match(called, /repo view/u); });

Given('passed current evidenceとlegacy fingerprint及び矛盾structured cacheがある', function () { this.boundValidation = { changedFiles: ['src/x.js'], risk: ['quality'], evidence: { sha: SHA, policyHash: 'c'.repeat(64), tool: 'runner', scope: ['selected'], passed: true } }; const fingerprint = evidenceFingerprint(this.boundValidation); this.boundValidation.successfulFingerprints = [fingerprint]; this.boundValidation.successfulEvidence = [{ fingerprint, passed: false }]; });
Then('完全bindingの成功証拠がないためdedupeを拒否する', function () { assert.notEqual(this.result.status, 'deduplicated'); assert.equal(this.result.valid, false); assert.equal(this.result.diagnostic.ruleId, 'ASC-EVIDENCE-001'); });
