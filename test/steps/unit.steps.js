import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Given, When, Then } from '@cucumber/cucumber';
import { classifyMode, detectQuickDisqualifiers } from '../../src/domain/mode.js';
import { safeSlug, resolveContained, redactSecrets } from '../../src/lib/security.js';
import { evaluateReview } from '../../src/domain/review.js';
import { loadOperationPolicy, validatePolicy } from '../../src/domain/policy.js';
import { validateScenarioTrace } from '../../src/domain/trace.js';
import * as traceDomain from '../../src/domain/trace.js';
import { collectProjectTrace, parseProjectGherkin } from '../../scripts/check_trace.js';
import { collectJavaScriptDependencyGraph } from '../../scripts/check_dependency_graph.js';
import { checkFileAudit } from '../../scripts/check_file_audit.js';
import { checkDirectoryGuides } from '../../scripts/check_directory_guides.js';
import { checkSkillTemplateContracts } from '../../scripts/check_skill_templates.js';
import { run } from '../../src/lib/process.js';
import { main } from '../../src/cli.js';
import { COMPATIBLE_POLICY_SCHEMA_VERSIONS, CURRENT_POLICY_SCHEMA_VERSION, DEPRECATED_POLICY_SCHEMA_ALIASES, PACKAGE_VERSION, SUPPORTED_POLICY_SCHEMA_VERSIONS, isPackageVersion, isPolicySchemaPatchVersion, packageReleaseVersion } from '../../src/lib/version.js';

const validAnswers = () => Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
  `Q-${String(index + 1).padStart(2, '0')}`, { answer: true, evidence: `evidence-${index + 1}` },
]));
const H_IMPL = 'a'.repeat(40);
const H_FINAL = 'c'.repeat(40);
const reviewBase = () => ({
  round: 1, headSha: H_FINAL,
  candidateEvidence: {
    implementationCommitSha: H_IMPL, finalCommitSha: H_FINAL, implementationTreeSha: 'b'.repeat(40), implementationIsAncestor: true,
    changedPaths: ['docs/reviews/phase-a.json'], artifact: { path: 'docs/reviews/phase-a.json', sha256: 'd'.repeat(64), blobOid: 'e'.repeat(40) },
  },
  externalEvidence: {
    provenance: { source: 'github', repository: 'o/r', prNumber: 835, runId: '32635972969', reviewId: '9001' },
    implementation: { repository: 'o/r', commitSha: H_IMPL, authorActorId: 'actor-implementer' },
    pr: { repository: 'o/r', number: 835, headSha: H_FINAL, authorActorId: 'actor-pr-author' },
    ci: { repository: 'o/r', runId: '32635972969', event: 'pull_request', headSha: H_FINAL, conclusion: 'success', pullRequestNumbers: [835] },
    review: { repository: 'o/r', prNumber: 835, reviewId: '9001', commitSha: H_FINAL, actorId: 'actor-reviewer', submittedAt: '2026-08-23T12:00:00Z', verdict: 'approved' },
  },
  affirmative: { correctness: 'pass', value: 'pass', feasibility: 'pass', consistency: 'pass', maintainability: 'pass' },
  adversarial: { counterexamples: 'pass', failures: 'pass', boundaries: 'pass', abuse: 'pass', security: 'pass', dataLoss: 'pass', rollback: 'pass', scope: 'pass' },
  findings: [], tests: 'pass', specConsistency: 'pass',
});
const runtimeFiles = () => fs.readdirSync('src', { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));

Given('remote default branchから分岐したfeature commitがある', function () {
  this.root = this.initRepo();
  fs.mkdirSync(path.join(this.root, '.agent-skill-chain/policy'), { recursive: true });
  fs.copyFileSync('.agent-skill-chain/policy/default.json', path.join(this.root, '.agent-skill-chain/policy/default.json'));
  spawnSync('git', ['add', '.agent-skill-chain/policy/default.json'], { cwd: this.root });
  spawnSync('git', ['commit', '-q', '-m', 'trusted default'], { cwd: this.root });
  this.defaultSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['update-ref', 'refs/remotes/origin/main', this.defaultSha], { cwd: this.root });
  fs.writeFileSync(path.join(this.root, 'feature.txt'), 'candidate only\n');
  spawnSync('git', ['add', 'feature.txt'], { cwd: this.root });
  spawnSync('git', ['commit', '-q', '-m', 'feature only'], { cwd: this.root });
  this.featureSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
});
When('feature commitをtrusted commitとexpected base SHAの両方へ指定する', function () {
  const candidateHeadSha = 'f'.repeat(40);
  try { this.operationPolicy = loadOperationPolicy(this.root, { trustedCommit: this.featureSha, expectedBaseSha: this.featureSha, candidateHeadSha, baseRef: 'main', defaultBranch: 'main', repository: 'o/r', pr: 1, provider: { provenance: { source: 'github', repository: 'o/r', prNumber: 1 }, repository: 'o/r', prNumber: 1, baseRefName: 'main', defaultBranch: 'main', defaultBranchTipOid: this.defaultSha, baseRefOid: this.featureSha, headRefOid: candidateHeadSha } }); }
  catch (error) { this.operationPolicyError = error instanceof Error ? error.message : String(error); }
});
Then('explicit trusted authorityはremote default branchへ拘束されて拒否される', function () { assert.equal(this.operationPolicy, undefined); assert.match(this.operationPolicyError ?? '', /default|ancestor|base|trusted/u); });

Given('Q-01〜Q-08がすべてtrueで、それぞれに根拠がある', function () { this.answers = validAnswers(); });
Given('Q-04を{word}にする', function (state) {
  if (state === 'false') this.answers['Q-04'] = { answer: false, evidence: 'false evidence' };
  else if (state === 'unknown') this.answers['Q-04'] = { answer: 'unknown', evidence: 'unknown evidence' };
  else if (state === '根拠なし') this.answers['Q-04'] = { answer: true, evidence: '' };
  else if (state === '未回答') delete this.answers['Q-04'];
});
When('modeを判定する', function () { this.result = classifyMode(this.answers); });
Then('判定結果はquickである', function () { assert.equal(this.result.mode, 'quick'); });
Then('判定結果はfullである', function () { assert.equal(this.result.mode, 'full'); });
Then('不適格理由は0件である', function () { assert.equal(this.result.reasons.length, 0); });
Then('不適格理由にQ-04が含まれる', function () { assert.ok(this.result.reasons.some((/** @type {string} */ reason) => reason.includes('Q-04'))); });

Given('quickとして開始した変更fileが{string}である', function (files) { this.changedFiles = files.split(','); });
When('quick不適格要因を検査する', function () { this.result = detectQuickDisqualifiers(this.changedFiles); });
Then('不適格要因は{string}である', function (expected) { assert.deepEqual([...this.result].sort(), expected.split(',').sort()); });
Then('不適格要因は空である', function () { assert.deepEqual(this.result, []); });

Given('issue titleが{string}である', function (title) {
  this.title = title.replace('<NUL>', '\u0000').replace('<RLO>', '\u202e');
});
When('安全なslugへ変換する', function () { try { this.value = safeSlug(this.title); } catch (error) { this.error = error; } });
Then('title検証は失敗する', function () { assert.ok(this.error instanceof Error); });
Then('slugは{string}である', function (slug) { assert.equal(this.value, slug); });

Given('containment rootと{string}がある', function (candidate) { this.root = this.temp(); this.candidate = candidate; });
When('contained pathを解決する', function () { try { this.value = resolveContained(this.root, this.candidate); } catch (error) { this.error = error; } });
Then('path検証は失敗する', function () { assert.ok(this.error instanceof Error); });
Given('containment root内のsymlinkがroot外を指す', function () {
  this.root = this.temp(); this.outside = this.temp(); fs.symlinkSync(this.outside, path.join(this.root, 'link'));
});
When('symlink配下の未作成fileを解決する', function () { try { this.value = resolveContained(this.root, 'link/file', { allowMissingLeaf: true }); } catch (error) { this.error = error; } });

Given('診断文字列にGitHub tokenとBearer credentialが含まれる', function () {
  this.originalCredentials = ['ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'abc.def.ghi'];
  this.diagnostic = `token=${this.originalCredentials[0]} Authorization: Bearer ${this.originalCredentials[1]}`;
});
When('secret redactionを行う', function () { this.value = redactSecrets(this.diagnostic); });
Then('診断文字列に元のcredentialは残らない', function () { for (const secret of this.originalCredentials) assert.equal(this.value.includes(secret), false); });
Given('secret tokenを引数に持つ失敗commandがある', function () { this.processSecret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'; });
When('process境界でcommandを実行する', function () { try { run(process.execPath, ['-e', 'process.exit(7)', '--', `token=${this.processSecret}`], process.cwd()); } catch (error) { this.error = error; } });
Then('process errorに元のtokenは残らない', function () { assert.equal(this.error.message.includes(this.processSecret), false); });
Then('process errorには伏字が含まれる', function () { assert.ok(this.error.message.includes('[REDACTED')); });

Given('round 1の肯定・敵対rubric、test、specがすべてpassである', function () { this.review = reviewBase(); });
Given('findingは0件である', function () { this.review.findings = []; });
Given('{word}の{word}が未評価である', function (perspective, item) { this.review[perspective][item] = undefined; });
Given('完全なreviewにMediumとLowのvalid findingがある', function () {
  this.review = reviewBase(); this.review.findings = [{ id: 'M1', severity: 'Medium', status: 'valid', evidence: 'minor' }, { id: 'L1', severity: 'Low', status: 'valid', evidence: 'style' }];
});
Given('完全なreviewにHighのvalid finding {string}がある', function (id) { this.review = reviewBase(); this.review.findings = [{ id, severity: 'High', status: 'valid', evidence: 'risk' }]; });
Given('round 3のfinding分類が{string}である', function (status) { this.review = reviewBase(); this.review.round = 3; this.review.focus = { unresolvedBlocking: ['H1'], fixedDiff: ['src/x.js'], adjacentScope: [], fullRescan: false }; this.review.findings = [{ id: 'H1', severity: 'High', status, evidence: 'risk' }]; });
Given('review roundが{int}である', function (round) { this.review = reviewBase(); this.review.round = round; });
Given('完全なreviewに未知の状態と重大度を持つfindingがある', function () { this.review = reviewBase(); this.review.findings = [{ id: 'X1', severity: 'Urgent', status: 'mystery', evidence: 'risk' }]; });
Given('完全なreviewに人間が条件付き受容したHigh findingがある', function () {
  this.review = reviewBase();
  this.review.findings = [{ id: 'H1', severity: 'High', status: 'valid', evidence: 'risk', riskAcceptance: { authority: 'human', owner: 'project-owner', reason: '必須要件と事業期限を比較して受容した', reviewCondition: '2026-09-30または前提変更時' } }];
});
Given('round 2のreviewが全範囲再走査を要求している', function () {
  this.review = reviewBase(); this.review.round = 2;
  this.review.focus = { unresolvedBlocking: ['H1'], fixedDiff: ['src/x.js'], adjacentScope: [], fullRescan: true };
  this.review.findings = [{ id: 'H1', severity: 'High', status: 'resolved', evidence: '修正済み' }];
});
Given('完全なreviewに理由なしのnot-applicableがある', function () { this.review = reviewBase(); this.review.affirmative.value = 'not-applicable'; });
Given('H_implの後にreview artifactだけを追加したH_finalの完全なreviewがある', function () { this.review = reviewBase(); });
Given('有効なPhase A review evidenceの{word}を改竄する', function (attribute) {
  this.review = reviewBase(); const other = 'f'.repeat(40);
  if (attribute === 'same-head') this.review.candidateEvidence.finalCommitSha = H_IMPL;
  if (attribute === 'ancestry') this.review.candidateEvidence.implementationIsAncestor = false;
  if (attribute === 'changed-path') this.review.candidateEvidence.changedPaths.push('src/domain/review.js');
  if (attribute === 'artifact-sha') this.review.candidateEvidence.artifact.sha256 = 'bad';
  if (attribute === 'blob-oid') this.review.candidateEvidence.artifact.blobOid = 'bad';
  if (attribute === 'pr-head') this.review.externalEvidence.pr.headSha = other;
  if (attribute === 'source') this.review.externalEvidence.provenance.source = 'file';
  if (attribute === 'repository') this.review.externalEvidence.ci.repository = 'x/r';
  if (attribute === 'implementation-sha') this.review.externalEvidence.implementation.commitSha = other;
  if (attribute === 'implementation-author') this.review.externalEvidence.implementation.authorActorId = null;
  if (attribute === 'pr-id') this.review.externalEvidence.review.prNumber = 999;
  if (attribute === 'run-id') this.review.externalEvidence.ci.runId = '999';
  if (attribute === 'review-id') this.review.externalEvidence.review.reviewId = '';
  if (attribute === 'ci-head') this.review.externalEvidence.ci.headSha = other;
  if (attribute === 'ci-event') this.review.externalEvidence.ci.event = 'push';
  if (attribute === 'run-pr') this.review.externalEvidence.ci.pullRequestNumbers = [999];
  if (attribute === 'empty-run-pr') this.review.externalEvidence.ci.pullRequestNumbers = [];
  if (attribute === 'ci-conclusion') this.review.externalEvidence.ci.conclusion = 'failure';
  if (attribute === 'reviewer-commit') this.review.externalEvidence.review.commitSha = other;
  if (attribute === 'reviewer-actor') this.review.externalEvidence.review.actorId = 'unstable actor name';
  if (attribute === 'pr-author-review') this.review.externalEvidence.review.actorId = this.review.externalEvidence.pr.authorActorId;
  if (attribute === 'implementer-review') this.review.externalEvidence.review.actorId = this.review.externalEvidence.implementation.authorActorId;
  if (attribute === 'submitted-at') this.review.externalEvidence.review.submittedAt = 'sometime';
  if (attribute === 'verdict') this.review.externalEvidence.review.verdict = 'commented';
});
When('review gateを評価する', function () { try { this.result = evaluateReview(this.review); } catch (error) { this.error = error; } });
Then('reviewはapprovedである', function () { assert.equal(this.result.approved, true); });
Then('reviewはrejectedである', function () { assert.equal(this.result.approved, false); });
Then(/^reviewはrejectedであり(.+)を返す$/u, function (diagnostic) { assert.equal(this.result.approved, false); assert.ok(this.result.errors.some((/** @type {string} */ error) => error.includes(diagnostic)), this.result.errors.join('; ')); });
Given('tracked Phase A review recordを読む', function () { this.phaseAReview = fs.readFileSync('.agent-skill-chain/templates/issue/04_レビュー.md', 'utf8'); });
When('Phase A artifactのimmutable契約を検査する', function () { this.phaseAContractInspected = true; });
Then('H_final後は更新せず外部attestationだけで完了すると明記されている', function () { assert.match(this.phaseAReview, /H_final後[^。]*更新しない/u); assert.match(this.phaseAReview, /完了[^。]*外部attestation/u); });
Then('blocking findingは0件である', function () { assert.equal(this.result.blocking.length, 0); });
Then('blocking findingは{string}である', function (id) { assert.deepEqual(this.result.blocking, [id]); });
Then('review評価は例外で停止する', function () { assert.ok(this.error instanceof Error); });

Given('package default policyを読み込む', function () { this.policy = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/default.json', 'utf8')); });
Given('merge policyの{word}をtrueにする', function (operation) { this.policy.merge[operation] = true; });
Given('merge modeを{string}にする', function (mode) { this.policy.merge.mode = mode; });
Given('policyへ未知fieldと不正な配列値を混入する', function () {
  this.policy.unknown = true;
  this.policy.delivery.unknown = true;
  this.policy.merge.unknown = true;
  this.policy.merge.branches = [123];
  this.policy.merge.methods = ['octopus'];
  this.policy.merge.requiredChecks = ['ci', 'ci'];
  this.policy.merge.requiredReviews = 21;
});
When('policyを検証する', function () { this.result = validatePolicy(this.policy); });
Then('policyはvalidである', function () { assert.equal(this.result.valid, true); });
Then('policyはinvalidである', function () { assert.equal(this.result.valid, false); });
Then('delivery stopはpull_requestである', function () { assert.equal(this.policy.delivery.stopAt, 'pull_request'); });
Then('merge modeはdisabledである', function () { assert.equal(this.policy.merge.mode, 'disabled'); });
Then('policy schema逸脱をすべて報告する', function () {
  for (const fragment of ['unknown', 'branches', 'methods', 'requiredChecks', 'requiredReviews']) assert.ok(this.result.errors.some((/** @type {string} */ error) => error.includes(fragment)), fragment);
});

Given('v0.3 package assetを走査する', function () { this.packageScanned = true; });
Given('runtime sourceを走査する', function () { this.sourceFiles = runtimeFiles(); });
When('skill contractを数える', function () { this.skills = fs.readdirSync('.agent-skill-chain/skills', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); });
Then('Step 0〜11が重複なくすべて存在する', function () {
  assert.equal(this.skills.length, 12); for (let index = 0; index <= 11; index += 1) assert.equal(this.skills.filter((/** @type {string} */ name) => name.startsWith(`step-${String(index).padStart(2, '0')}-`)).length, 1);
});
When('gh process callの所在を検査する', function () { this.offenders = this.sourceFiles.filter((/** @type {string} */ file) => file !== path.join('src', 'adapters', 'github.js')).filter((/** @type {string} */ file) => /(?:run|spawnSync|execFileSync)\s*\(\s*['"]gh['"]/.test(fs.readFileSync(file, 'utf8'))); });
Then('GitHub adapter以外の違反fileは0件である', function () { assert.deepEqual(this.offenders, []); });
When('legacy runtime importを検査する', function () { this.offenders = this.sourceFiles.filter((/** @type {string} */ file) => /from\s+['"][^'"]*(?:\.workflow|\.agents|archive)/.test(fs.readFileSync(file, 'utf8'))); });
Then('legacy import違反fileは0件である', function () { assert.deepEqual(this.offenders, []); });
When('ADR実装assetを検査する', function () { this.adrAssets = ['src/domain/adr.js', '.agent-skill-chain/templates/adr'].filter((file) => fs.existsSync(file)); });
Then('ADR domain、template、CLI、gateは存在しない', function () { assert.deepEqual(this.adrAssets, []); });
When('固定の人向けMarkdown file名を検査する', function () {
  const roots = ['.agent-skill-chain/docs', '.agent-skill-chain/policy', '.agent-skill-chain/schemas', '.agent-skill-chain/templates/common', '.agent-skill-chain/templates/issue', '.agent-skill-chain/templates/specs', 'docs/specs'];
  this.nameOffenders = ['.agent-skill-chain/00_利用案内.md'].filter((file) => !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(path.basename(file))).concat(roots.flatMap((root) => fs.readdirSync(root, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    const name = entry.name;
    if (entry.isDirectory()) return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) ? [path.join(entry.parentPath, name)] : [];
    if (entry.isFile() && name.endsWith('.md')) return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(name) ? [path.join(entry.parentPath, name)] : [];
    return [];
  })));
});
Then('連番付き日本語file名の違反は0件である', function () { assert.deepEqual(this.nameOffenders, []); });
When('規範文書の配置を検査する', function () {
  this.rootNormative = ['AGENTS.md', 'POLICY.md', 'QUALITY.md', 'WORKFLOW.md'].filter((file) => fs.existsSync(file));
  this.namespaceNormative = fs.readdirSync('.agent-skill-chain/docs').filter((name) => name.endsWith('.md'));
});
Then('repository直下の規範文書はAGENTSだけである', function () { assert.deepEqual(this.rootNormative, ['AGENTS.md']); });
Then('namespace配下に連番付き規範文書が3件ある', function () { assert.equal(this.namespaceNormative.length, 3); assert.ok(this.namespaceNormative.every((/** @type {string} */ name) => /^\d{2}_.+\.md$/u.test(name))); });
Given('英語だけの人向けMarkdownがある', function () { this.root = this.temp(); fs.writeFileSync(path.join(this.root, 'AGENTS.md'), '---\nname: machine-readable-name\ndescription: This description contains only English prose for people.\n---\n\n# 日本語文書\n'); });
Given('英語descriptionをblock scalarへ隠したMarkdownがある', function () { this.root = this.temp(); fs.writeFileSync(path.join(this.root, 'AGENTS.md'), '---\nname: machine-readable-name\ndescription: >\n  This description contains only English prose for people.\n---\n\n# 日本語文書\n'); });
When('日本語文書形式検査を実行する', function () { this.documentCheck = spawnSync('python3', ['scripts/check_japanese_docs.py', this.root], { cwd: process.cwd(), encoding: 'utf8' }); });
Then('日本語文書形式検査は失敗する', function () { assert.notEqual(this.documentCheck.status, 0); assert.ok(this.documentCheck.stderr.includes('日本語')); });
Then('block scalar回避として拒否される', function () { assert.notEqual(this.documentCheck.status, 0); assert.match(this.documentCheck.stderr, /block scalar/u); });
When('project選択層とfalse block対応の文書契約を検査する', function () {
  this.traceTemplate = fs.readFileSync('.agent-skill-chain/templates/specs/15_要件追跡/00_追跡表.md', 'utf8');
  this.operationsSpec = fs.readFileSync('docs/specs/12_運用保守/00_運用設計.md', 'utf8');
});
Then('全test layerは層ごとに追跡されnon-override denyは弱化されない', function () {
  for (const fragment of ['projectChoices.testLayers', '全層', '1層1行', '固定の層名']) assert.ok(this.traceTemplate.includes(fragment), fragment);
  for (const fragment of ['non-override deny', '弱めず', 'fail closed', '独立review']) assert.ok(this.operationsSpec.includes(fragment), fragment);
});

Given('package所有runtimeと変更済みtemplateを走査する', function () {
  this.packageRuntime = runtimeFiles();
  this.auditedMermaidTemplates = [
    '.agent-skill-chain/templates/specs/03_アーキテクチャ/00_全体構成.md', '.agent-skill-chain/templates/specs/03_アーキテクチャ/01_システムコンテキスト.md',
    '.agent-skill-chain/templates/specs/03_アーキテクチャ/02_配置・依存.md', '.agent-skill-chain/templates/specs/04_機能/01_個別機能テンプレート.md',
    '.agent-skill-chain/templates/specs/04_機能/02_状態遷移.md', '.agent-skill-chain/templates/specs/05_画面/01_画面遷移.md',
    '.agent-skill-chain/templates/specs/06_外部インターフェース/02_個別APIテンプレート.md', '.agent-skill-chain/templates/specs/07_データ/03_ライフサイクル.md',
    '.agent-skill-chain/templates/specs/08_バッチ・ジョブ/01_個別ジョブテンプレート.md', '.agent-skill-chain/templates/specs/09_基盤・ネットワーク/01_論理ネットワーク.md',
    '.agent-skill-chain/templates/specs/09_基盤・ネットワーク/02_物理・配備構成.md', '.agent-skill-chain/templates/specs/09_基盤・ネットワーク/03_データフロー.md',
  ];
});
When('repository固有IDと固定表示labelを検査する', function () {
  this.packageBoundaryOffenders = this.packageRuntime.filter((/** @type {string} */ file) => fs.readFileSync(file, 'utf8').includes('ASC-DOGFOOD-'));
  const fixedLabels = /\b(?:Actor|Application|Domain|Adapter|External|Client|Service|Store|Pending|Completed|Denied|ScreenA|ScreenB|SafeResult|Caller|Dependency|Create|Validate|Use|Archive|Delete|Trigger|Guard|Process|Verify|Finish|RegionA|ZoneA|ZoneB|ServiceA|ServiceB|Source|Validation|Processing|Destination)\b/u;
  this.templateBoundaryOffenders = this.auditedMermaidTemplates.filter((/** @type {string} */ file) => fixedLabels.test(fs.readFileSync(file, 'utf8').split('```mermaid')[1]?.split('```')[0] ?? ''));
});
Then('汎用packageの所有境界違反は0件である', function () { assert.deepEqual(this.packageBoundaryOffenders, []); assert.deepEqual(this.templateBoundaryOffenders, []); });

Given('review templateとPR事前確認を読む', function () { this.reviewTemplate = fs.readFileSync('.agent-skill-chain/templates/issue/04_レビュー.md', 'utf8'); this.prChecklist = fs.readFileSync('.agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md', 'utf8'); });
When('全変更file監査契約を検査する', function () { this.fileAuditContract = `${this.reviewTemplate}\n${this.prChecklist}`; });
Then('1ファイル1行と差分path集合完全一致が必須である', function () { for (const fragment of ['1ファイル1行', 'path集合', '完全一致', 'owner', 'target layer', '依存方向', '個別判定']) assert.ok(this.fileAuditContract.includes(fragment), fragment); });

Given('H_implの全変更pathと一致する個別監査artifactがある', function () {
  this.root = this.initRepo();
  this.auditBase = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  fs.mkdirSync(path.join(this.root, 'src')); fs.writeFileSync(path.join(this.root, 'src', 'x.js'), 'export const x = 1;\n');
  spawnSync('git', ['add', 'src/x.js'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'implementation'], { cwd: this.root });
  this.auditImplementation = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  fs.mkdirSync(path.join(this.root, 'docs', 'reviews'), { recursive: true });
  this.auditFile = path.join(this.root, 'docs', 'reviews', '01_課題834実装レビュー.md');
  this.auditMarkdown = `# review\n\n| 項目 | 観測値 |\n|---|---|\n| 比較基点 | \`${this.auditBase}\` |\n| H_impl | \`${this.auditImplementation}\` |\n\n## 変更ファイル個別監査\n\n| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |\n|---|---|---|---|---|---|---|---|---|\n| \`src/x.js\` | A | package owner | package | 単一責務 | 非循環 | SCN-X-001 | 削除でrollback | pass |\n`;
  fs.writeFileSync(this.auditFile, this.auditMarkdown); spawnSync('git', ['add', 'docs/reviews/01_課題834実装レビュー.md'], { cwd: this.root }); spawnSync('git', ['commit', '-q', '-m', 'review evidence'], { cwd: this.root });
});
When('個別監査gateを正規表と余分なpathで検証する', function () {
  this.validAudit = checkFileAudit(this.root);
  fs.writeFileSync(this.auditFile, `${this.auditMarkdown}| \`extra.js\` | A | package owner | package | 単一責務 | 非循環 | SCN-X-002 | 削除でrollback | pass |\n`);
  this.invalidAudit = checkFileAudit(this.root);
  fs.writeFileSync(this.auditFile, this.auditMarkdown.replace(this.auditBase, this.auditImplementation));
  this.sameCommitAudit = checkFileAudit(this.root);
  const unrelated = spawnSync('git', ['commit-tree', `${this.auditBase}^{tree}`, '-m', 'unrelated audit base'], { cwd: this.root, encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(this.auditFile, this.auditMarkdown.replace(this.auditBase, unrelated));
  this.nonAncestorAudit = checkFileAudit(this.root);
});
Then('正規表だけが合格し余分なpathと空差分基点は拒否される', function () { assert.equal(this.validAudit.valid, true, this.validAudit.errors.join('; ')); assert.equal(this.invalidAudit.valid, false); assert.match(this.invalidAudit.errors.join(' '), /path集合/u); assert.equal(this.sameCommitAudit.valid, false); assert.match(this.sameCommitAudit.errors.join(' '), /異なるcommit/u); assert.equal(this.nonAncestorAudit.valid, false); assert.match(this.nonAncestorAudit.errors.join(' '), /ancestor/u); });

Given('package metadataとpolicy version artifactがある', function () {
  this.packageMetadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  this.policySchema = JSON.parse(fs.readFileSync('.agent-skill-chain/schemas/project-policy.schema.json', 'utf8'));
  this.defaultPolicy = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/default.json', 'utf8'));
});
When('version正本との一致を検証する', function () { this.releaseVersion = packageReleaseVersion(this.packageMetadata.version); });
Then('製品は0.3.1 betaでpolicyはv0.3.0からv0.3.1へ移行する', function () {
  assert.equal(PACKAGE_VERSION, this.packageMetadata.version);
  assert.match(PACKAGE_VERSION, /^0\.3\.1-beta\./u);
  assert.equal(CURRENT_POLICY_SCHEMA_VERSION, `agent-skill-chain/project-policy/v${this.releaseVersion}`);
  assert.deepEqual(COMPATIBLE_POLICY_SCHEMA_VERSIONS, ['agent-skill-chain/project-policy/v0.3.0']);
  assert.deepEqual(DEPRECATED_POLICY_SCHEMA_ALIASES, { 'agent-skill-chain/project-policy/v0.3': 'agent-skill-chain/project-policy/v0.3.0' });
  assert.deepEqual(this.policySchema.properties.schemaVersion.enum, SUPPORTED_POLICY_SCHEMA_VERSIONS);
  assert.equal(this.defaultPolicy.schemaVersion, CURRENT_POLICY_SCHEMA_VERSION);
  const legacyAlias = validatePolicy({ schemaVersion: 'agent-skill-chain/project-policy/v0.3', delivery: { stopAt: 'pull_request' }, merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 0 } });
  assert.equal(legacyAlias.valid, true);
  assert.ok(legacyAlias.migration);
  assert.deepEqual(legacyAlias.migration.deprecatedAlias, { input: 'agent-skill-chain/project-policy/v0.3', canonical: 'agent-skill-chain/project-policy/v0.3.0' });
  for (const version of ['0.3.0', '0.3.1-beta.1', '0.3.1+build.7', '0.3.1-beta.1+build.7']) assert.equal(isPackageVersion(version), true, version);
  for (const version of ['0.3.01', '0.3.1-01', '0.3.1-beta..1', '0.3.1+']) assert.equal(isPackageVersion(version), false, version);
  for (const version of ['0.3.0', '0.3.1']) assert.equal(isPolicySchemaPatchVersion(version), true, version);
  for (const version of ['0.3.01', '0.3.1-beta.1', '0.3']) assert.equal(isPolicySchemaPatchVersion(version), false, version);
  assert.equal(packageReleaseVersion('0.3.1+build.7'), '0.3.1');
});

Given('packageのStep skillとtemplate契約がある', function () {
  this.skillContractRoot = process.cwd();
  this.brokenSkillContractRoot = this.temp('asc-skill-contract-');
  this.omittedSkillContractRoot = this.temp('asc-skill-omission-');
  this.unroutedSkillContractRoot = this.temp('asc-skill-route-');
  this.blockScalarSkillContractRoot = this.temp('asc-skill-frontmatter-');
  fs.mkdirSync(path.join(this.brokenSkillContractRoot, '.agent-skill-chain/docs'), { recursive: true });
  fs.mkdirSync(path.join(this.omittedSkillContractRoot, '.agent-skill-chain/docs'), { recursive: true });
  fs.mkdirSync(path.join(this.unroutedSkillContractRoot, '.agent-skill-chain/docs'), { recursive: true });
  fs.mkdirSync(path.join(this.blockScalarSkillContractRoot, '.agent-skill-chain/docs'), { recursive: true });
  for (const root of [this.brokenSkillContractRoot, this.omittedSkillContractRoot, this.unroutedSkillContractRoot, this.blockScalarSkillContractRoot]) {
    fs.cpSync('.agent-skill-chain/skills', path.join(root, '.agent-skill-chain/skills'), { recursive: true });
    fs.cpSync('.agent-skill-chain/templates', path.join(root, '.agent-skill-chain/templates'), { recursive: true });
    fs.copyFileSync('.agent-skill-chain/docs/01_開発ワークフロー.md', path.join(root, '.agent-skill-chain/docs/01_開発ワークフロー.md'));
  }
});
When('正規契約とリンク切れ・対応漏れ・経路欠落契約を検証する', function () {
  this.validSkillContracts = checkSkillTemplateContracts(this.skillContractRoot);
  const designSkill = path.join(this.brokenSkillContractRoot, '.agent-skill-chain/skills/step-05-design/SKILL.md');
  fs.writeFileSync(designSkill, fs.readFileSync(designSkill, 'utf8').replace('../../templates/issue/02_設計.md', '../../templates/issue/存在しない設計.md'));
  const planSkill = path.join(this.omittedSkillContractRoot, '.agent-skill-chain/skills/step-06-plan/SKILL.md');
  fs.writeFileSync(planSkill, fs.readFileSync(planSkill, 'utf8').replace('[03_実装計画.md](../../templates/issue/03_実装計画.md)', '`03_実装計画.md`'));
  const workflow = path.join(this.unroutedSkillContractRoot, '.agent-skill-chain/docs/01_開発ワークフロー.md');
  fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('[step-07-design-review](../skills/step-07-design-review/SKILL.md)', '`step-07-design-review`'));
  const blockScalarSkill = path.join(this.blockScalarSkillContractRoot, '.agent-skill-chain/skills/step-05-design/SKILL.md');
  fs.writeFileSync(blockScalarSkill, fs.readFileSync(blockScalarSkill, 'utf8').replace(/^description:.*$/mu, 'description: >\n  設計を作成する'));
  this.brokenSkillContracts = checkSkillTemplateContracts(this.brokenSkillContractRoot);
  this.omittedSkillContracts = checkSkillTemplateContracts(this.omittedSkillContractRoot);
  this.unroutedSkillContracts = checkSkillTemplateContracts(this.unroutedSkillContractRoot);
  this.blockScalarSkillContracts = checkSkillTemplateContracts(this.blockScalarSkillContractRoot);
});
Then('正規契約だけが合格しリンク切れ・対応漏れ・経路欠落は拒否される', function () {
  assert.equal(this.validSkillContracts.valid, true, this.validSkillContracts.errors.join('; '));
  assert.equal(this.validSkillContracts.skills, 12);
  assert.equal(this.brokenSkillContracts.valid, false);
  assert.match(this.brokenSkillContracts.errors.join(' '), /テンプレート対応|リンク先/u);
  assert.equal(this.omittedSkillContracts.valid, false);
  assert.match(this.omittedSkillContracts.errors.join(' '), /テンプレート対応/u);
  assert.equal(this.unroutedSkillContracts.valid, false);
  assert.match(this.unroutedSkillContracts.errors.join(' '), /ワークフロー.*対応/u);
  assert.equal(this.blockScalarSkillContracts.valid, false);
  assert.match(this.blockScalarSkillContracts.errors.join(' '), /block scalar/u);
});

Given('packageのdirectory利用案内契約がある', function () {
  this.directoryGuideRoot = process.cwd();
  const copy = () => {
    const root = this.temp('asc-directory-guide-');
    fs.cpSync('.agent-skill-chain', path.join(root, '.agent-skill-chain'), { recursive: true });
    fs.copyFileSync('AGENTS.md', path.join(root, 'AGENTS.md'));
    return root;
  };
  this.missingDirectoryGuideRoot = copy();
  this.unknownDirectoryGuideRoot = copy();
  this.brokenDirectoryGuideRoot = copy();
});
When('正規契約と入口欠落・未知directory・リンク切れ契約を検証する', function () {
  this.validDirectoryGuides = checkDirectoryGuides(this.directoryGuideRoot);
  fs.rmSync(path.join(this.missingDirectoryGuideRoot, '.agent-skill-chain/policy/00_利用案内.md'));
  fs.mkdirSync(path.join(this.unknownDirectoryGuideRoot, '.agent-skill-chain/templates/未説明'));
  fs.appendFileSync(path.join(this.brokenDirectoryGuideRoot, '.agent-skill-chain/00_利用案内.md'), '\n[存在しない案内](templates/存在しない案内.md)\n');
  this.missingDirectoryGuides = checkDirectoryGuides(this.missingDirectoryGuideRoot);
  this.unknownDirectoryGuides = checkDirectoryGuides(this.unknownDirectoryGuideRoot);
  this.brokenDirectoryGuides = checkDirectoryGuides(this.brokenDirectoryGuideRoot);
});
Then('正規契約だけが合格し入口欠落・未知directory・リンク切れは拒否される', function () {
  assert.equal(this.validDirectoryGuides.valid, true, this.validDirectoryGuides.errors.join('; '));
  assert.equal(this.missingDirectoryGuides.valid, false);
  assert.match(this.missingDirectoryGuides.errors.join(' '), /入口文書がありません/u);
  assert.equal(this.unknownDirectoryGuides.valid, false);
  assert.match(this.unknownDirectoryGuides.errors.join(' '), /入口文書が未定義/u);
  assert.equal(this.brokenDirectoryGuides.valid, false);
  assert.match(this.brokenDirectoryGuides.errors.join(' '), /link先がありません/u);
});

Given('repositoryの全feature fileとCucumber実行結果がある', function () { this.traceRoot = process.cwd(); this.testLayers = ['unit', 'integration', 'e2e']; this.forbiddenFileSuffixes = ['.test.js']; });
When('Gherkin traceを検証する', function () { this.result = validateScenarioTrace(collectProjectTrace(this.traceRoot, this.testLayers, this.forbiddenFileSuffixes), { layers: this.testLayers }); });
Then('全scenarioに一意なSCN IDとGiven、When、Thenがある', function () { assert.equal(this.result.errors.filter((/** @type {string} */ error) => /duplicate|missing/.test(error)).length, 0); });
Then('unit、integration、E2Eの各layerにscenarioがある', function () { for (const layer of ['unit', 'integration', 'e2e']) assert.ok(this.result.layerCounts[layer] > 0); });
Then('JavaScriptのNode test起票は0件である', function () { assert.deepEqual(this.result.nodeTests, []); });
Given('Whenが欠けたGherkin scenarioがある', function () { this.gherkin = 'Feature: 日本語機能\nScenario: SCN-X-001 日本語scenario\n Given 日本語前提\n Then 日本語結果\n'; });
When('Gherkin構造を解析する', function () { this.parsed = parseProjectGherkin(this.gherkin); });
Then('When不足を検出する', function () { assert.equal(this.parsed[0].steps.includes('when'), false); });
Given('日本語keywordのGherkin scenarioがある', function () { this.gherkin = '機能: 日本語機能\nシナリオ: SCN-X-002 日本語scenario\n 前提 日本語前提\n もし 日本語操作\n ならば 日本語結果\n'; });
When('日本語方言でGherkin構造を解析する', function () { this.parsed = parseProjectGherkin(this.gherkin, 'ja'); });
Then('canonical Given When Thenへ変換される', function () { assert.deepEqual(this.parsed[0].steps, ['given', 'when', 'then']); });
Given('空のtestLayersを持つcurrent project policyがある', function () { this.emptyLayersPolicy = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/default.json', 'utf8')); this.emptyLayersPolicy.projectChoices = { ...JSON.parse(fs.readFileSync('.agent-skill-chain/project/choices/development.json', 'utf8')), testLayers: [] }; this.choiceSchema = JSON.parse(fs.readFileSync('.agent-skill-chain/schemas/project-choice.schema.json', 'utf8')); });
When('current project policyを検証する', function () { this.policyValidation = validatePolicy(this.emptyLayersPolicy); });
Then('runtimeとschemaは空のtestLayersを拒否する', function () { assert.equal(this.policyValidation.valid, false); assert.match(this.policyValidation.errors.join(' '), /testLayers.*1件以上/u); assert.equal(this.choiceSchema.properties.testLayers.minItems, 1); });
Given('同じSCN IDを持つ2つのGherkin scenarioがある', function () {
  const root = this.temp(); this.traceRoot = root; this.featuresRoot = path.join(root, 'test', 'features'); this.testLayers = ['unit', 'integration', 'e2e']; this.forbiddenFileSuffixes = [];
  for (const layer of ['unit', 'integration', 'e2e']) fs.mkdirSync(path.join(this.featuresRoot, layer), { recursive: true });
  fs.writeFileSync(path.join(this.featuresRoot, 'unit', 'x.feature'), 'Feature: 日本語機能\nScenario: SCN-X-001 日本語一\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\nScenario: SCN-X-001 日本語二\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
  fs.writeFileSync(path.join(this.featuresRoot, 'integration', 'x.feature'), 'Feature: 日本語結合\nScenario: SCN-X-002 日本語結合\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
  fs.writeFileSync(path.join(this.featuresRoot, 'e2e', 'x.feature'), 'Feature: 日本語E2E\nScenario: SCN-X-003 日本語E2E\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
});
Then('重複errorを検出する', function () { assert.ok(this.result.errors.some((/** @type {string} */ error) => error.includes('重複'))); });
Given('projectがcomponentとjourneyのtest layerを選択する', function () { const root = this.temp(); this.traceRoot = root; this.featuresRoot = path.join(root, 'test', 'features'); this.testLayers = ['component', 'journey']; for (const layer of this.testLayers) { fs.mkdirSync(path.join(this.featuresRoot, layer), { recursive: true }); fs.writeFileSync(path.join(this.featuresRoot, layer, `${layer}.feature`), `Feature: configured layer\nScenario: SCN-${layer.toUpperCase()}-001 configured scenario\n Given configured precondition\n When configured action\n Then configured result\n`); } });
When('configured layerでGherkin traceを検証する', function () { this.result = validateScenarioTrace(collectProjectTrace(this.traceRoot, this.testLayers, []), { layers: this.testLayers }); });
Then('generic traceはfixed 3 layerを要求しない', function () { assert.equal(this.result.valid, true, this.result.errors.join('; ')); assert.deepEqual(Object.keys(this.result.layerCounts), this.testLayers); assert.equal(JSON.stringify(this.result).includes('unit'), false); assert.equal(JSON.stringify(this.result).includes('integration'), false); assert.equal(JSON.stringify(this.result).includes('e2e'), false); });
Given('testLayersを持たないlegacy project policyとGherkinがある', function () {
  this.root = this.temp();
  fs.mkdirSync(path.join(this.root, '.agent-skill-chain'), { recursive: true });
  fs.writeFileSync(path.join(this.root, '.agent-skill-chain/project-policy.json'), `${JSON.stringify({ schemaVersion: 'agent-skill-chain/project-policy/v0.3.0', delivery: { stopAt: 'pull_request' }, merge: { mode: 'disabled', branches: [], methods: [], requiredChecks: [], requiredReviews: 0 } })}\n`);
  this.traceEvidence = path.join(this.root, 'trace.json');
  fs.writeFileSync(this.traceEvidence, `${JSON.stringify({ adapter: 'test', scenarios: [{ id: 'SCN-LEGACY-001', title: 'legacy', source: 'legacy.feature', layer: 'legacy', steps: ['given', 'when', 'then'] }], forbiddenFiles: [] })}\n`);
});
When('trace CLIでlegacy policyを検証する', async function () {
  let stdout = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  try { this.status = await main(['trace', 'validate', `--root=${this.root}`, `--evidence=${this.traceEvidence}`]); } catch (error) { this.error = error; } finally { process.stdout.write = originalWrite; }
  this.stdout = stdout;
});
Then('project choice不足をstructured invalidとして返す', function () { assert.equal(this.error, undefined); assert.equal(this.status, 1); assert.match(this.stdout, /project policy/u); });
Given('{word}を持つdependency graphがある', function (variant) {
  this.graph = variant === 'cycle' ? { nodes: ['requirement', 'design', 'test'], edges: [{ from: 'requirement', to: 'design' }, { from: 'design', to: 'test' }, { from: 'test', to: 'requirement' }] }
    : variant === 'self-loop' ? { nodes: ['review'], edges: [{ from: 'review', to: 'review' }] }
      : { nodes: ['requirement'], edges: [{ from: 'requirement', to: 'missing' }] };
});
When('dependency graphを検証する', function () { this.result = traceDomain.validateDependencyGraph(this.graph.nodes, this.graph.edges); });
Then('dependency graphはcycle diagnostic付きでinvalidである', function () { assert.equal(this.result.valid, false); assert.match(this.result.errors.join(' '), /cycle|self-loop|unknown/u); });
Given('repository sourceのimport graphと循環反例がある', function () {
  const { nodes, edges } = collectJavaScriptDependencyGraph(process.cwd());
  this.sourceGraph = { nodes, edges }; this.cyclicGraph = { nodes, edges: [...edges, { from: nodes[0], to: nodes[0] }] };
});
When('project hookのdependency graphを検証する', function () { this.sourceResult = traceDomain.validateDependencyGraph(this.sourceGraph.nodes, this.sourceGraph.edges); this.cyclicResult = traceDomain.validateDependencyGraph(this.cyclicGraph.nodes, this.cyclicGraph.edges); });
Then('source graphは非循環で循環反例だけを拒否する', function () { assert.equal(this.sourceResult.valid, true, this.sourceResult.errors.join('; ')); assert.equal(this.cyclicResult.valid, false); });
