import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Given, When, Then } from '@cucumber/cucumber';
import { classifyMode, detectQuickDisqualifiers } from '../../src/domain/mode.js';
import { safeSlug, resolveContained, redactSecrets } from '../../src/lib/security.js';
import { evaluateReview } from '../../src/domain/review.js';
import { validatePolicy } from '../../src/domain/policy.js';
import { parseGherkinScenarios, validateScenarioTrace } from '../../src/domain/trace.js';
import { run } from '../../src/lib/process.js';

const validAnswers = () => Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
  `Q-${String(index + 1).padStart(2, '0')}`, { answer: true, evidence: `evidence-${index + 1}` },
]));
const reviewBase = () => ({
  round: 1, headSha: 'a'.repeat(40),
  affirmative: { correctness: 'pass', value: 'pass', feasibility: 'pass', consistency: 'pass', maintainability: 'pass' },
  adversarial: { counterexamples: 'pass', failures: 'pass', boundaries: 'pass', abuse: 'pass', security: 'pass', dataLoss: 'pass', rollback: 'pass', scope: 'pass' },
  findings: [], tests: 'pass', specConsistency: 'pass',
});
const runtimeFiles = () => fs.readdirSync('src', { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));

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
When('review gateを評価する', function () { try { this.result = evaluateReview(this.review); } catch (error) { this.error = error; } });
Then('reviewはapprovedである', function () { assert.equal(this.result.approved, true); });
Then('reviewはrejectedである', function () { assert.equal(this.result.approved, false); });
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
When('skill contractを数える', function () { this.skills = fs.readdirSync('.agent-skill-chain/skills').sort(); });
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
  const roots = ['.agent-skill-chain/docs', '.agent-skill-chain/templates/common', '.agent-skill-chain/templates/issue', '.agent-skill-chain/templates/specs', 'docs/specs'];
  this.nameOffenders = roots.flatMap((root) => fs.readdirSync(root, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    const name = entry.name;
    if (entry.isDirectory()) return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) ? [path.join(entry.parentPath, name)] : [];
    if (entry.isFile() && name.endsWith('.md')) return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(name) ? [path.join(entry.parentPath, name)] : [];
    return [];
  }));
});
Then('連番付き日本語file名の違反は0件である', function () { assert.deepEqual(this.nameOffenders, []); });
When('規範文書の配置を検査する', function () {
  this.rootNormative = ['AGENTS.md', 'POLICY.md', 'QUALITY.md', 'WORKFLOW.md'].filter((file) => fs.existsSync(file));
  this.namespaceNormative = fs.readdirSync('.agent-skill-chain/docs').filter((name) => name.endsWith('.md'));
});
Then('repository直下の規範文書はAGENTSだけである', function () { assert.deepEqual(this.rootNormative, ['AGENTS.md']); });
Then('namespace配下に連番付き規範文書が3件ある', function () { assert.equal(this.namespaceNormative.length, 3); assert.ok(this.namespaceNormative.every((/** @type {string} */ name) => /^\d{2}_.+\.md$/u.test(name))); });
Given('英語だけの人向けMarkdownがある', function () { this.root = this.temp(); fs.writeFileSync(path.join(this.root, 'AGENTS.md'), '# English documentation\n\nThis document contains only English prose for people.\n'); });
When('日本語文書形式検査を実行する', function () { this.documentCheck = spawnSync('python3', ['scripts/check_japanese_docs.py', this.root], { cwd: process.cwd(), encoding: 'utf8' }); });
Then('日本語文書形式検査は失敗する', function () { assert.notEqual(this.documentCheck.status, 0); assert.ok(this.documentCheck.stderr.includes('日本語')); });

Given('repositoryの全feature fileとCucumber実行結果がある', function () { this.featuresRoot = 'test/features'; });
When('Gherkin traceを検証する', function () { this.result = validateScenarioTrace(this.featuresRoot); });
Then('全scenarioに一意なSCN IDとGiven、When、Thenがある', function () { assert.equal(this.result.errors.filter((/** @type {string} */ error) => /duplicate|missing/.test(error)).length, 0); });
Then('unit、integration、E2Eの各layerにscenarioがある', function () { for (const layer of ['unit', 'integration', 'e2e']) assert.ok(this.result.layerCounts[layer] > 0); });
Then('JavaScriptのNode test起票は0件である', function () { assert.deepEqual(this.result.nodeTests, []); });
Given('Whenが欠けたGherkin scenarioがある', function () { this.gherkin = 'Feature: 日本語機能\nScenario: SCN-X-001 日本語scenario\n Given 日本語前提\n Then 日本語結果\n'; });
When('Gherkin構造を解析する', function () { this.parsed = parseGherkinScenarios(this.gherkin); });
Then('When不足を検出する', function () { assert.equal(this.parsed[0].keywords.has('When'), false); });
Given('同じSCN IDを持つ2つのGherkin scenarioがある', function () {
  const root = this.temp(); this.featuresRoot = path.join(root, 'features');
  for (const layer of ['unit', 'integration', 'e2e']) fs.mkdirSync(path.join(this.featuresRoot, layer), { recursive: true });
  fs.writeFileSync(path.join(this.featuresRoot, 'unit', 'x.feature'), 'Feature: 日本語機能\nScenario: SCN-X-001 日本語一\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\nScenario: SCN-X-001 日本語二\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
  fs.writeFileSync(path.join(this.featuresRoot, 'integration', 'x.feature'), 'Feature: 日本語結合\nScenario: SCN-X-002 日本語結合\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
  fs.writeFileSync(path.join(this.featuresRoot, 'e2e', 'x.feature'), 'Feature: 日本語E2E\nScenario: SCN-X-003 日本語E2E\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n');
});
Then('重複errorを検出する', function () { assert.ok(this.result.errors.some((/** @type {string} */ error) => error.includes('重複'))); });
