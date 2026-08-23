import fs from 'node:fs';
import path from 'node:path';
import { git } from '../lib/process.js';
import { resolveEffectivePolicy, validateEnforcementPolicy } from './enforcement.js';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseJsonStrict, resolveContained, stableJson } from '../lib/security.js';
import { validateProjectConformanceBinding } from './conformance.js';
import { COMPATIBLE_POLICY_SCHEMA_VERSIONS, CURRENT_POLICY_SCHEMA_VERSION, DEPRECATED_POLICY_SCHEMA_ALIASES, SUPPORTED_POLICY_SCHEMA_VERSIONS } from '../lib/version.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @param {string} version */
const policyVersionLabel = (version) => version.replace('agent-skill-chain/project-policy/v', 'v');
const currentPolicyVersionLabel = policyVersionLabel(CURRENT_POLICY_SCHEMA_VERSION);
const compatiblePolicyVersionLabels = COMPATIBLE_POLICY_SCHEMA_VERSIONS.map(policyVersionLabel).join('、');

/** @param {any} value @param {string[]} allowed @param {string} prefix @param {string[]} errors */
function rejectUnknownKeys(value, allowed, prefix, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix}はobjectでなければなりません`);
    return;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${prefix}.${key}は未知fieldです`);
}

/** @param {any} value @param {string} name @param {string[]} errors @param {{allowed?: string[], max?: number}} [options] */
function validateStringArray(value, name, errors, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${name}は配列でなければなりません`);
    return;
  }
  if (options.max !== undefined && value.length > options.max) errors.push(`${name}は${options.max}件以内でなければなりません`);
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) errors.push(`${name}には空でない文字列だけを指定してください`);
  if (options.allowed && value.some((item) => !options.allowed?.includes(item))) errors.push(`${name}に許可されていない値があります`);
  if (new Set(value).size !== value.length) errors.push(`${name}に重複があります`);
}

/** @param {any} policy */
export function validatePolicy(policy) {
  /** @type {string[]} */
  const errors = [];
  rejectUnknownKeys(policy, ['schemaVersion', 'delivery', 'merge', 'rules', 'budgets', 'projectChoices'], 'policy', errors);
  rejectUnknownKeys(policy?.delivery, ['stopAt'], 'delivery', errors);
  rejectUnknownKeys(policy?.merge, ['mode', 'branches', 'methods', 'requiredChecks', 'requiredReviews'], 'merge', errors);
  const deprecatedAliasTarget = DEPRECATED_POLICY_SCHEMA_ALIASES[policy?.schemaVersion];
  const compatibleInput = COMPATIBLE_POLICY_SCHEMA_VERSIONS.includes(policy?.schemaVersion) || COMPATIBLE_POLICY_SCHEMA_VERSIONS.includes(deprecatedAliasTarget);
  if (!SUPPORTED_POLICY_SCHEMA_VERSIONS.includes(policy?.schemaVersion) && !deprecatedAliasTarget) errors.push(`schemaVersionが未対応です。${currentPolicyVersionLabel}へのstaged migrationを実行してください`);
  if (compatibleInput && (policy.rules !== undefined || policy.budgets !== undefined || policy.projectChoices !== undefined)) errors.push(`${compatiblePolicyVersionLabels}ではrules、budgets、projectChoicesを使用できません。${currentPolicyVersionLabel}へstaged migrationしてください`);
  if (policy?.delivery?.stopAt !== 'pull_request') errors.push('delivery.stopAtはpull_requestでなければなりません');
  if (!['disabled', 'assisted', 'automatic'].includes(policy?.merge?.mode)) errors.push('merge.modeが不正です');
  validateStringArray(policy?.merge?.branches, 'merge.branches', errors, { max: 32 });
  validateStringArray(policy?.merge?.methods, 'merge.methods', errors, { allowed: ['merge', 'squash', 'rebase'] });
  validateStringArray(policy?.merge?.requiredChecks, 'merge.requiredChecks', errors);
  if (!Number.isInteger(policy?.merge?.requiredReviews) || policy.merge.requiredReviews < 0 || policy.merge.requiredReviews > 20) errors.push('merge.requiredReviewsが不正です');
  const forbidden = ['deleteBranch', 'closeIssue', 'release', 'finalize', 'cleanup'];
  for (const key of forbidden) if (policy?.merge?.[key] === true) errors.push(`マージ権限へ${key}を含めてはいけません`);
  if (policy?.schemaVersion === CURRENT_POLICY_SCHEMA_VERSION) {
    rejectUnknownKeys(policy?.budgets, ['localFeedbackMs', 'prGateMs'], 'budgets', errors);
    for (const key of ['localFeedbackMs', 'prGateMs']) if (!Number.isInteger(policy?.budgets?.[key]) || policy.budgets[key] < 1) errors.push(`budgets.${key}は1以上の整数でなければなりません`);
    const enforcement = validateEnforcementPolicy(policy);
    errors.push(...enforcement.errors);
    if (policy.projectChoices !== undefined) {
      const fields = ['language', 'testRunner', 'testLayers', 'forbiddenTestFileSuffixes', 'naming', 'packageManager', 'runtime', 'ci', 'modelMapping', 'release'];
      rejectUnknownKeys(policy.projectChoices, fields, 'projectChoices', errors);
      for (const field of fields.filter((field) => !['testLayers', 'forbiddenTestFileSuffixes'].includes(field))) if (typeof policy.projectChoices?.[field] !== 'string' || policy.projectChoices[field].trim() === '') errors.push(`projectChoices.${field}は空でない文字列でなければなりません`);
      validateStringArray(policy.projectChoices?.testLayers, 'projectChoices.testLayers', errors);
      validateStringArray(policy.projectChoices?.forbiddenTestFileSuffixes, 'projectChoices.forbiddenTestFileSuffixes', errors);
      if (Array.isArray(policy.projectChoices?.forbiddenTestFileSuffixes) && policy.projectChoices.forbiddenTestFileSuffixes.some((/** @type {unknown} */ suffix) => typeof suffix !== 'string' || !/^\.[A-Za-z0-9._-]+$/u.test(suffix))) errors.push('projectChoices.forbiddenTestFileSuffixesが不正です');
    }
  }
  const migration = compatibleInput || errors.some((error) => error.includes('schemaVersion') || error.includes('未知field')) ? { target: CURRENT_POLICY_SCHEMA_VERSION, activation: 'staged', deprecatedAlias: deprecatedAliasTarget ? { input: policy.schemaVersion, canonical: deprecatedAliasTarget } : undefined, remediation: 'policy、schema、runtime、CI、templateを同一migrationで更新してください', rollback: '入力policyを変更せずtrusted版を保持する' } : undefined;
  return { valid: errors.length === 0, errors, migration, diagnostics: errors.length ? [{ ruleId: 'ASC-POLICY-INVALID', purpose: 'schemaとruntimeのpolicy契約を一致させる', risk: 'unknown', reasons: errors, scope: ['policy'], checks: ['schemaVersion、未知field、rules、budgetsを確認した'], autoFixes: [{ description: `${currentPolicyVersionLabel} staged migrationを作る`, dryRunDiff: `schemaVersionとrulesを${currentPolicyVersionLabel}形式へ更新する` }], next: 'migrationをdry-runしてから適用してください', requiredAuthority: 'project policy owner', rollback: 'trusted policyを保持する' }] : [] };
}

const MANIFEST_VERSION = 'agent-skill-chain/project-policy-manifest/v1';
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** @param {any} manifest */
export function validateProjectPolicyManifest(manifest) {
  /** @type {string[]} */
  const errors = [];
  rejectUnknownKeys(manifest, ['schemaVersion', 'policy', 'choiceFiles', 'ruleFiles', 'conformanceFiles', 'conformanceDirectory'], 'manifest', errors);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { valid: false, errors };
  if (manifest?.schemaVersion !== MANIFEST_VERSION) errors.push('manifest schemaVersionが不正です');
  rejectUnknownKeys(manifest?.policy, ['schemaVersion', 'delivery', 'merge', 'budgets'], 'manifest.policy', errors);
  rejectUnknownKeys(manifest?.policy?.delivery, ['stopAt'], 'manifest.policy.delivery', errors);
  rejectUnknownKeys(manifest?.policy?.merge, ['mode', 'branches', 'methods', 'requiredChecks', 'requiredReviews'], 'manifest.policy.merge', errors);
  rejectUnknownKeys(manifest?.policy?.budgets, ['localFeedbackMs', 'prGateMs'], 'manifest.policy.budgets', errors);
  if (manifest?.policy?.schemaVersion !== CURRENT_POLICY_SCHEMA_VERSION) errors.push('manifest.policy.schemaVersionが不正です');
  if (manifest?.policy?.delivery?.stopAt !== 'pull_request') errors.push('manifest.policy.delivery.stopAtが不正です');
  if (!['disabled', 'assisted', 'automatic'].includes(manifest?.policy?.merge?.mode)) errors.push('manifest.policy.merge.modeが不正です');
  validateStringArray(manifest?.policy?.merge?.branches, 'manifest.policy.merge.branches', errors, { max: 32 });
  validateStringArray(manifest?.policy?.merge?.methods, 'manifest.policy.merge.methods', errors, { allowed: ['merge', 'squash', 'rebase'] });
  validateStringArray(manifest?.policy?.merge?.requiredChecks, 'manifest.policy.merge.requiredChecks', errors);
  const requiredReviews = manifest?.policy?.merge?.requiredReviews;
  if (!Number.isInteger(requiredReviews) || requiredReviews < 0 || requiredReviews > 20) errors.push('manifest.policy.merge.requiredReviewsが不正です');
  for (const key of ['localFeedbackMs', 'prGateMs']) { const value = manifest?.policy?.budgets?.[key]; if (!Number.isInteger(value) || value < 1) errors.push(`manifest.policy.budgets.${key}が不正です`); }
  const choiceFiles = Array.isArray(manifest.choiceFiles) ? manifest.choiceFiles : [];
  const ruleFiles = Array.isArray(manifest.ruleFiles) ? manifest.ruleFiles : [];
  const conformanceFiles = Array.isArray(manifest.conformanceFiles) ? manifest.conformanceFiles : [];
  const references = [...choiceFiles, ...ruleFiles, ...conformanceFiles];
  if (!Array.isArray(manifest?.choiceFiles) || manifest.choiceFiles.length !== 1) errors.push('choiceFilesは1件の配列でなければなりません');
  if (!Array.isArray(manifest?.ruleFiles) || manifest.ruleFiles.length === 0) errors.push('ruleFilesは1件以上の配列でなければなりません');
  if (!Array.isArray(manifest?.conformanceFiles) || manifest.conformanceFiles.length === 0) errors.push('conformanceFilesは1件以上の配列でなければなりません');
  if (ruleFiles.length > 126) errors.push('ruleFilesは126件以内でなければなりません');
  if (conformanceFiles.length > 126) errors.push('conformanceFilesは126件以内でなければなりません');
  for (const reference of references) if (typeof reference !== 'string' || reference === '' || path.isAbsolute(reference) || reference.includes('..') || reference.includes('\\') || CONTROL.test(reference) || reference !== reference.normalize('NFC') || !/^project\/(?:choices|rules|conformance)\/[a-z0-9][a-z0-9.-]*\.json$/u.test(reference)) errors.push(`project fragment pathが不正です: ${String(reference)}`);
  for (const list of [choiceFiles, ruleFiles, conformanceFiles]) if (stableJson(list) !== stableJson([...list].sort())) errors.push('project fragment pathは字句順でなければなりません');
  const keys = references.map((reference) => typeof reference === 'string' ? reference.normalize('NFC').toLocaleLowerCase('und') : String(reference));
  if (new Set(keys).size !== keys.length) errors.push('project fragment pathが重複またはUnicode/case衝突しています');
  if (typeof manifest?.conformanceDirectory !== 'string' || manifest.conformanceDirectory !== 'project/conformance') errors.push('conformanceDirectoryはproject/conformanceでなければなりません');
  return { valid: errors.length === 0, errors };
}

/** @param {any} manifest @param {string} manifestRaw @param {(relative: string) => {value: any, raw: string}} reader @param {string[]} inventory @param {Record<string, unknown>} [provenance] */
function assemblePolicySet(manifest, manifestRaw, reader, inventory, provenance = {}) {
  const manifestValidation = validateProjectPolicyManifest(manifest);
  if (!manifestValidation.valid) throw new Error(`project policy manifestが不正です: ${manifestValidation.errors.join('; ')}`);
  const expected = [...manifest.choiceFiles, ...manifest.ruleFiles, ...manifest.conformanceFiles].sort();
  const actual = [...inventory].sort();
  if (stableJson(expected) !== stableJson(actual)) throw new Error(`project directory inventoryがmanifestと一致しません: expected=${expected.join(',')} actual=${actual.join(',')}`);
  /** @type {Record<string, {value: any, raw: string}>} */
  const entries = Object.fromEntries(expected.map((/** @type {string} */ relative) => [relative, reader(relative)]));
  for (const [relative, entry] of Object.entries(entries)) if (entry.raw.length > 1024 * 1024) throw new Error(`project fragmentが1 MiBを超えています: ${relative}`);
  const choices = manifest.choiceFiles.map((/** @type {string} */ relative) => entries[relative].value);
  const rules = manifest.ruleFiles.map((/** @type {string} */ relative) => entries[relative].value);
  for (const relative of manifest.conformanceFiles) {
    const binding = entries[relative].value;
    const validation = validateProjectConformanceBinding(binding);
    manifestValidation.errors.push(...validation.errors.map((error) => `${relative}: ${error}`));
  }
  if (manifestValidation.errors.length) throw new Error(`project fragmentが不正です: ${manifestValidation.errors.join('; ')}`);
  const policy = { ...manifest.policy, projectChoices: choices[0], rules };
  const validation = validatePolicy(policy);
  if (!validation.valid) throw new Error(`canonical project policy setが不正です: ${validation.errors.join('; ')}`);
  const hashedEntries = [['project-policy.json', crypto.createHash('sha256').update(manifestRaw).digest('hex')], ...expected.map((/** @type {string} */ relative) => [relative, crypto.createHash('sha256').update(entries[relative].raw).digest('hex')])];
  const setHash = crypto.createHash('sha256').update(stableJson({ domain: 'agent-skill-chain/project-policy-set/v1', entries: hashedEntries })).digest('hex');
  const semanticPolicyHash = crypto.createHash('sha256').update(stableJson(policy)).digest('hex');
  const rawEntries = Object.fromEntries([['project-policy.json', manifestRaw], ...expected.map((/** @type {string} */ relative) => [relative, entries[relative].raw])]);
  return { policy, hash: setHash, setHash, setEntries: hashedEntries, rawEntries, semanticPolicyHash, provenance, manifest, choices, rules };
}

/** @param {string} root */
export function loadProjectPolicySet(root) {
  const namespace = path.join(root, '.agent-skill-chain');
  const manifestFile = resolveContained(root, '.agent-skill-chain/project-policy.json');
  const manifestRaw = fs.readFileSync(manifestFile, 'utf8');
  const manifest = parseJsonStrict(manifestRaw, 'project policy manifest');
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    if (fs.existsSync(path.join(namespace, 'project'))) throw new Error('legacy monolithとproject directoryの混在を拒否しました');
    const semanticPolicyHash = crypto.createHash('sha256').update(stableJson(manifest)).digest('hex');
    return { policy: manifest, hash: semanticPolicyHash, setHash: semanticPolicyHash, setEntries: [['project-policy.json', crypto.createHash('sha256').update(manifestRaw).digest('hex')]], rawEntries: { 'project-policy.json': manifestRaw }, semanticPolicyHash, provenance: { source: 'filesystem-legacy' }, manifest, choices: [manifest.projectChoices], rules: manifest.rules };
  }
  const projectRoot = path.join(namespace, 'project');
  if (!fs.existsSync(projectRoot) || fs.lstatSync(projectRoot).isSymbolicLink() || !fs.statSync(projectRoot).isDirectory()) throw new Error('project inventory rootは通常directoryでなければなりません');
  const allowedDirectories = ['choices', 'rules', 'conformance'];
  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) if (!allowedDirectories.includes(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`project inventoryに未知または不正なdirectoryがあります: project/${entry.name}`);
  const inventory = [];
  for (const directory of allowedDirectories) {
    const current = path.join(projectRoot, directory);
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`project inventoryに通常JSON file以外があります: project/${directory}/${entry.name}`);
      const file = path.join(current, entry.name); if ((fs.statSync(file).mode & 0o111) !== 0) throw new Error(`project fragmentに実行権限は不要です: project/${directory}/${entry.name}`);
      inventory.push(`project/${directory}/${entry.name}`);
    }
  }
  return assemblePolicySet(manifest, manifestRaw, (/** @type {string} */ relative) => {
    const file = resolveContained(namespace, relative);
    let current = namespace;
    for (const part of relative.split('/')) { current = path.join(current, part); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`project fragmentにsymlinkは使えません: ${relative}`); }
    const raw = fs.readFileSync(file, 'utf8'); return { value: parseJsonStrict(raw, relative), raw };
  }, inventory, { source: 'filesystem' });
}

/** Read a project policy set from one fixed Git commit without assigning authority semantics. @param {string} root @param {string} ref */
export function loadProjectPolicySetAtCommit(root, ref) {
  const resolved = git(['rev-parse', '--verify', `${ref}^{commit}`], root, { allowFailure: true });
  if (resolved.status !== 0) throw new Error(`${ref}を固定Git commit SHAへ解決できません`);
  const commitSha = resolved.stdout.trim();
  /** @param {string} relative */
  const show = (relative) => {
    const full = `.agent-skill-chain/${relative}`;
    const mode = git(['ls-tree', commitSha, full], root, { allowFailure: true });
    if (mode.status !== 0 || !mode.stdout.trim().startsWith('100644 blob ')) throw new Error(`${commitSha}のproject fragmentが通常fileではありません: ${relative}`);
    const result = git(['show', `${commitSha}:${full}`], root, { allowFailure: true });
    if (result.status !== 0) throw new Error(`${commitSha}のproject fragmentを読めません: ${relative}`);
    return { value: parseJsonStrict(result.stdout, `${commitSha}:${full}`), raw: result.stdout };
  };
  const manifestResult = show('project-policy.json');
  const manifest = manifestResult.value;
  const tree = git(['ls-tree', '-r', commitSha, '.agent-skill-chain/project'], root, { allowFailure: true });
  const treeLines = tree.status === 0 ? tree.stdout.split('\n').filter(Boolean) : [];
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    if (treeLines.length) throw new Error('legacy monolithとproject directoryの混在を拒否しました');
    const semanticPolicyHash = crypto.createHash('sha256').update(stableJson(manifest)).digest('hex');
    return { policy: manifest, hash: semanticPolicyHash, setHash: semanticPolicyHash, setEntries: [['project-policy.json', crypto.createHash('sha256').update(manifestResult.raw).digest('hex')]], rawEntries: { 'project-policy.json': manifestResult.raw }, semanticPolicyHash, provenance: { source: 'git-legacy', commitSha }, manifest, choices: [manifest.projectChoices], rules: manifest.rules };
  }
  for (const line of treeLines) if (!line.startsWith('100644 blob ')) throw new Error(`project inventoryにsymlink、gitlink、実行fileがあります: ${line}`);
  const inventory = treeLines.map((line) => line.slice(line.indexOf('\t') + 1).replace(/^\.agent-skill-chain\//, ''));
  return assemblePolicySet(manifest, manifestResult.raw, show, inventory, { source: 'git', commitSha });
}

/** Compatibility wrapper for callers that already resolved a trusted ref. @param {string} root @param {string} ref */
export function loadTrustedProjectPolicySet(root, ref) {
  return loadProjectPolicySetAtCommit(root, ref);
}

/** @param {string} root @param {string} defaultBranch */
export function loadTrustedPolicy(root, defaultBranch) {
  const ref = `origin/${defaultBranch}`;
  return loadTrustedProjectPolicySet(root, ref).policy;
}

/** @param {string} root @param {string} defaultBranch */
export function loadEffectiveTrustedPolicy(root, defaultBranch) {
  return loadEffectiveTrustedPolicySet(root, defaultBranch).policy;
}

/** @param {string} root @param {string} defaultBranch */
export function loadEffectiveTrustedPolicySet(root, defaultBranch) {
  const branchRef = `origin/${defaultBranch}`;
  const resolved = git(['rev-parse', '--verify', `${branchRef}^{commit}`], root, { allowFailure: true });
  if (resolved.status !== 0) throw new Error(`${branchRef}のtrusted commit SHAを解決できません`);
  return loadEffectiveTrustedPolicySetAtCommit(root, resolved.stdout.trim());
}

/** Assemble floor and project extension exclusively from an already resolved commit. @param {string} root @param {string} ref */
function loadEffectiveTrustedPolicySetAtCommit(root, ref) {
  const packageFloorFile = path.join(packageRoot, '.agent-skill-chain', 'policy', 'default.json');
  const packageFloor = parseJsonStrict(fs.readFileSync(packageFloorFile, 'utf8'), 'package default safety floor');
  const packageFloorValidation = validatePolicy(packageFloor);
  if (!packageFloorValidation.valid) throw new Error(`package default safety floorが不正です: ${packageFloorValidation.errors.join('; ')}`);
  const trustedFloor = git(['show', `${ref}:.agent-skill-chain/policy/default.json`], root, { allowFailure: true });
  if (trustedFloor.status !== 0) throw new Error(`${ref}にpackage default safety floorがありません`);
  const committedFloor = parseJsonStrict(trustedFloor.stdout, `${ref}:default policy`);
  const committedFloorValidation = validatePolicy(committedFloor);
  if (!committedFloorValidation.valid) throw new Error(`trusted commitのdefault policyが不正です: ${committedFloorValidation.errors.join('; ')}`);
  /** @type {any} */
  const floorResult = committedFloor.schemaVersion === CURRENT_POLICY_SCHEMA_VERSION ? resolveEffectivePolicy(packageFloor, committedFloor, { trusted: true }) : { valid: true, policy: packageFloor };
  if (!floorResult.valid) throw new Error(`trusted defaultをpackage safety floorへ合成できません: ${floorResult.diagnostic?.reasons?.join('; ') ?? '不明な構成error'}`);
  const floor = floorResult.policy;
  const result = git(['show', `${ref}:.agent-skill-chain/project-policy.json`], root, { allowFailure: true });
  const baseEntries = [['package-default.json', crypto.createHash('sha256').update(fs.readFileSync(packageFloorFile)).digest('hex')], ['policy/default.json', crypto.createHash('sha256').update(trustedFloor.stdout).digest('hex')]];
  if (result.status !== 0) {
    const setHash = crypto.createHash('sha256').update(stableJson({ domain: 'agent-skill-chain/effective-policy-set/v1', entries: baseEntries })).digest('hex');
    return { policy: floor, setHash, setEntries: baseEntries, semanticPolicyHash: crypto.createHash('sha256').update(stableJson(floor)).digest('hex'), provenance: { source: 'git-floor', commitSha: ref } };
  }
  const projectSet = loadTrustedProjectPolicySet(root, ref);
  const project = projectSet.policy;
  const effective = resolveEffectivePolicy(floor, project, { trusted: true });
  if (!effective.valid) throw new Error(`effective policyを構成できません: ${effective.diagnostic?.reasons?.join('; ') ?? '不明な構成error'}`);
  const setEntries = [...baseEntries, ...projectSet.setEntries.map((/** @type {string[]} */ entry) => [`project/${entry[0]}`, entry[1]])].sort(([left], [right]) => left.localeCompare(right));
  const setHash = crypto.createHash('sha256').update(stableJson({ domain: 'agent-skill-chain/effective-policy-set/v1', entries: setEntries })).digest('hex');
  return { ...projectSet, policy: effective.policy, setHash, hash: setHash, setEntries, semanticPolicyHash: crypto.createHash('sha256').update(stableJson(effective.policy)).digest('hex'), provenance: { ...projectSet.provenance, floorCommitSha: ref } };
}

/** Resolve authority policy only from a fixed trusted commit and trusted provider observation. @param {string} root @param {{trustedCommit?: string, expectedBaseSha?: string, candidateHeadSha?: string, baseRef?: string, defaultBranch?: string, repository?: string, pr?: number, provider?: any}} [options] */
export function loadOperationPolicy(root, options = {}) {
  if (Object.keys(options).length > 0) {
    if (!/^[a-f0-9]{40}$/iu.test(options.trustedCommit ?? '') || !/^[a-f0-9]{40}$/iu.test(options.expectedBaseSha ?? '')) throw new Error('explicit trusted commitとexpected base SHAはどちらも40桁SHAで必要です');
    const trustedCommit = /** @type {string} */ (options.trustedCommit); const expectedBaseSha = /** @type {string} */ (options.expectedBaseSha);
    if (trustedCommit.toLowerCase() !== expectedBaseSha.toLowerCase()) throw new Error('explicit trusted commitがGitHub PR expected base SHAと一致しません');
    if (!/^[a-f0-9]{40}$/iu.test(options.candidateHeadSha ?? '') || options.candidateHeadSha?.toLowerCase() === trustedCommit.toLowerCase()) throw new Error('candidate head SHAはtrusted baseと異なる40桁SHAで必要です');
    if (typeof options.baseRef !== 'string' || options.baseRef.length === 0 || typeof options.defaultBranch !== 'string' || options.defaultBranch.length === 0) throw new Error('PR base refとrepository default branchは空でないbranch名で必要です');
    if (options.baseRef !== options.defaultBranch) throw new Error('非default branchをbaseとするPRはtrusted authorityとして使用できません');
    const defaultBranch = /** @type {string} */ (options.defaultBranch);
    const checkedBranch = git(['check-ref-format', '--branch', defaultBranch], root, { allowFailure: true });
    if (checkedBranch.status !== 0 || checkedBranch.stdout.trim() !== defaultBranch) throw new Error('repository default branchは有効なGit branch名で必要です');
    const provider = options.provider;
    if (provider?.provenance?.source !== 'github') throw new Error('trusted GitHub providerによるPR authority観測が必要です');
    if (provider.repository !== options.repository || provider.provenance.repository !== options.repository) throw new Error('GitHub providerのrepositoryが明示対象と一致しません');
    if (provider.prNumber !== options.pr || provider.provenance.prNumber !== options.pr) throw new Error('GitHub providerのPR numberが明示対象と一致しません');
    if (provider.baseRefName !== options.baseRef || provider.defaultBranch !== options.defaultBranch) throw new Error('GitHub providerのbase/default branch観測が一致しません');
    if (String(provider.baseRefOid ?? '').toLowerCase() !== trustedCommit.toLowerCase()) throw new Error('GitHub providerのPR base OIDがtrusted commitと一致しません');
    if (String(provider.headRefOid ?? '').toLowerCase() !== options.candidateHeadSha?.toLowerCase()) throw new Error('GitHub providerのcandidate headが明示したPR head SHAと一致しません');
    const resolved = git(['rev-parse', '--verify', `${trustedCommit}^{commit}`], root, { allowFailure: true });
    if (resolved.status !== 0 || resolved.stdout.trim().toLowerCase() !== trustedCommit.toLowerCase()) throw new Error('explicit trusted commitをrepository内の固定commit SHAへ解決できません');
    const remoteDefaultRef = `refs/remotes/origin/${defaultBranch}`;
    const remoteDefault = git(['rev-parse', '--verify', `${remoteDefaultRef}^{commit}`], root, { allowFailure: true });
    if (remoteDefault.status !== 0 || !/^[a-f0-9]{40}$/iu.test(remoteDefault.stdout.trim())) throw new Error('明示されたremote default branchを固定commitへ解決できません');
    if (String(provider.defaultBranchTipOid ?? '').toLowerCase() !== remoteDefault.stdout.trim().toLowerCase()) throw new Error('local remote default tipがGitHub providerの現在tip OIDと一致しません');
    const ancestry = git(['merge-base', '--is-ancestor', trustedCommit, remoteDefault.stdout.trim()], root, { allowFailure: true });
    if (ancestry.status !== 0) throw new Error('trusted commitはremote default branch commitのancestorではありません');
    return loadEffectiveTrustedPolicySetAtCommit(root, resolved.stdout.trim());
  }
  const symbolic = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root, { allowFailure: true });
  if (symbolic.status === 0) return loadEffectiveTrustedPolicySet(root, symbolic.stdout.trim().replace(/^origin\//, ''));
  throw new Error('origin/HEADをtrusted branchとcommit SHAへ解決できないためauthority operationを停止しました');
}

/** @param {string} root */
export function loadConsumerPolicy(root) {
  const file = path.join(root, '.agent-skill-chain', 'project-policy.json');
  if (!fs.existsSync(file)) return undefined;
  return loadProjectPolicySet(root).policy;
}

/** Read an optional consumer policy from one fixed commit. @param {string} root @param {string} ref */
export function loadConsumerPolicyAtCommit(root, ref) {
  const resolved = git(['rev-parse', '--verify', `${ref}^{commit}`], root, { allowFailure: true });
  if (resolved.status !== 0 || resolved.stdout.trim().toLowerCase() !== ref.toLowerCase()) throw new Error('candidate policyを読む固定commitを完全OIDへ解決できません');
  const exists = git(['cat-file', '-e', `${resolved.stdout.trim()}:.agent-skill-chain/project-policy.json`], root, { allowFailure: true });
  if (exists.status !== 0) return undefined;
  return loadProjectPolicySetAtCommit(root, resolved.stdout.trim()).policy;
}
