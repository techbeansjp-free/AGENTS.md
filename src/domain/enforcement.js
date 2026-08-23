import crypto from 'node:crypto';
import { CURRENT_POLICY_SCHEMA_VERSION } from '../lib/version.js';
import { redactSecrets, stableJson } from '../lib/security.js';

export const ENFORCEMENTS = ['deny', 'require', 'assist', 'warn', 'record'];
export const ACTIVATIONS = ['active', 'staged', 'disabled'];
export const DENY_RISK_CLASSES = ['secret', 'path', 'authority', 'irreversible', 'identity', 'artifact'];
export const METRIC_KINDS = ['gateWaitMs', 'duplicate', 'falseBlock', 'override', 'rollback', 'miss'];

const RULE_FIELDS = ['ruleId', 'purpose', 'riskClass', 'scope', 'enforcement', 'activation', 'owner', 'targetLayer', 'evidence', 'remediation', 'overridePolicy', 'rollback'];
const RULE_MEANING_FIELDS = RULE_FIELDS.filter((field) => field !== 'activation');
/** @type {Record<string, number>} */
const STRENGTH = { deny: 5, require: 4, assist: 3, warn: 2, record: 1 };
/** @type {Record<string, number>} */
const ACTIVATION_STRENGTH = { active: 3, staged: 2, disabled: 1 };

/** @param {unknown} value */
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value); }

/** @param {string} ruleId @param {string} purpose @param {string} risk @param {string[]} reasons @param {string[]} scope @param {string[]} checks @param {Array<{description: string, dryRunDiff: string}>} autoFixes @param {string} next @param {string} requiredAuthority @param {string} rollback */
export function diagnostic(ruleId, purpose, risk, reasons, scope, checks, autoFixes, next, requiredAuthority, rollback) {
  return { ruleId, purpose, risk, reasons, scope, checks, autoFixes, next, requiredAuthority, rollback };
}

/** @param {any} value @returns {any} */
function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey|authorization)$/i.test(key) ? '[REDACTED]' : redactValue(item)]));
  return typeof value === 'string' ? redactSecrets(value) : value;
}

/** @param {any} value */
export function sanitizeOutput(value) { return redactValue(value); }

/** @param {any} source */
function completeDiagnostic(source = {}) {
  return {
    ruleId: source.ruleId ?? 'ASC-RESULT-001', purpose: source.purpose ?? '操作結果を安全に記録する', risk: source.risk ?? 'unknown',
    reasons: Array.isArray(source.reasons) && source.reasons.length ? source.reasons : ['操作結果を記録した'],
    scope: Array.isArray(source.scope) && source.scope.length ? source.scope : ['operation'],
    checks: Array.isArray(source.checks) && source.checks.length ? source.checks : ['入力と結果を確認した'],
    autoFixes: Array.isArray(source.autoFixes) ? source.autoFixes : [], next: source.next ?? '次の安全な操作へ進んでください',
    requiredAuthority: source.requiredAuthority ?? '不要', rollback: source.rollback ?? '状態を変更せず再計画する',
  };
}

/** @param {any} value */
export function serializeDiagnostic(value) {
  const safe = redactValue(value);
  const source = completeDiagnostic(safe.diagnostic ?? safe);
  const result = safe && typeof safe === 'object' ? { ...safe, diagnostic: source } : { value: safe, diagnostic: source };
  return {
    result,
    presentation: { fallbackLanguage: 'ja', authoritative: false },
    messageJa: {
      rule: `ルールID: ${source.ruleId ?? 'ASC-UNKNOWN'}`,
      purpose: `目的: ${source.purpose ?? '安全な操作を保証する'}`,
      risk: `リスク: ${source.risk ?? 'unknown'}`,
      reason: `具体的根拠: ${(source.reasons ?? ['不明な状態']).join('、')}`,
      action: `安全な次の操作: ${source.next ?? '入力とauthorityを再確認してください'}`,
      authority: `必要な最小authority: ${source.requiredAuthority ?? '不要'}`,
      rollback: `rollback方法: ${source.rollback ?? '状態を変更せず再計画する'}`,
    },
  };
}

/** @param {any} rule */
export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) errors.push('ruleはobjectでなければなりません');
  else {
    for (const field of RULE_FIELDS) if (rule[field] === undefined) errors.push(`${field}が必要です`);
    for (const field of Object.keys(rule)) if (!RULE_FIELDS.includes(field)) errors.push(`${field}は未知fieldです`);
    for (const field of ['ruleId', 'purpose', 'riskClass', 'owner', 'evidence', 'remediation', 'rollback']) if (!nonEmpty(rule[field])) errors.push(`${field}は安全な空でない文字列でなければなりません`);
    if (!['package', 'project', 'spec', 'evidence'].includes(rule.targetLayer)) errors.push('targetLayerはpackage、project、spec、evidenceのいずれかでなければなりません');
    if (!/^ASC-[A-Z0-9-]+$/.test(rule.ruleId ?? '')) errors.push('ruleIdはASC-で始まる安定IDでなければなりません');
    if (!Array.isArray(rule.scope) || rule.scope.length === 0 || rule.scope.some((/** @type {unknown} */ item) => !nonEmpty(item))) errors.push('scopeは空でない安全な文字列配列でなければなりません');
    else if (new Set(rule.scope).size !== rule.scope.length) errors.push('scopeに重複があります');
    if (!ENFORCEMENTS.includes(rule.enforcement)) errors.push('enforcementが不正です');
    if (!ACTIVATIONS.includes(rule.activation)) errors.push('activationが不正です');
    if (!['never', 'bound'].includes(rule.overridePolicy)) errors.push('overridePolicyが不正です');
    if (rule.enforcement === 'deny' && !DENY_RISK_CLASSES.includes(rule.riskClass)) errors.push('denyは安全・authority境界のriskClassだけに使用できます');
    if (rule.enforcement === 'deny' && rule.overridePolicy !== 'never') errors.push('deny ruleはnon-overrideでなければなりません');
  }
  const remediation = diagnostic(
    rule?.ruleId ?? 'ASC-POLICY-INVALID', rule?.purpose ?? 'risk比例ruleを有効にする', rule?.riskClass ?? 'unknown', errors,
    Array.isArray(rule?.scope) ? rule.scope : ['policy'], ['必須属性、列挙値、deny riskを検証した'],
    [{ description: 'ruleをstagedで追加して影響を計測する', dryRunDiff: 'activation: active -> staged' }],
    'schema、runtime、CI、templateを同一migrationへ含めて再検証してください', 'project policy owner', rule?.rollback ?? '直前のtrusted policyへ戻す',
  );
  return { valid: errors.length === 0, errors, diagnostic: remediation };
}

/** @param {any} rule @param {{violated: boolean, reasons?: string[], checks?: string[], autoFixes?: Array<{description: string, dryRunDiff: string}>}} input */
export function evaluateRule(rule, input) {
  const validation = validateRule(rule);
  if (!validation.valid) return { status: 'blocked', blocked: true, diagnostic: validation.diagnostic };
  const details = diagnostic(
    rule.ruleId, rule.purpose, rule.riskClass, input.reasons ?? ['rule条件に一致した'], rule.scope,
    input.checks ?? ['rule構造とactivationを確認した'], input.autoFixes ?? [], rule.remediation,
    rule.enforcement === 'deny' || rule.enforcement === 'require' ? rule.owner : '不要', rule.rollback,
  );
  if (!input.violated) return { status: 'passed', allowed: true, blocked: false, hardBlocked: false, diagnostic: details };
  if (rule.activation === 'disabled') return { status: 'recorded', allowed: true, blocked: false, hardBlocked: false, diagnostic: details };
  if (rule.activation === 'staged') return { status: 'pending', allowed: true, blocked: false, hardBlocked: false, diagnostic: details };
  /** @type {Record<string, string>} */
  const statuses = { deny: 'blocked', require: 'required', assist: 'assisted', warn: 'warned', record: 'recorded' };
  const blocked = rule.enforcement === 'deny' || rule.enforcement === 'require';
  return { status: statuses[rule.enforcement], allowed: !blocked, blocked, hardBlocked: rule.enforcement === 'deny', diagnostic: details };
}

/** @param {any} policy */
export function validateEnforcementPolicy(policy) {
  const errors = [];
  const diagnostics = [];
  if (!Array.isArray(policy?.rules)) errors.push('rulesは配列でなければなりません');
  else {
    if (policy.rules.length === 0) errors.push('rulesは1件以上必要です');
    const ids = new Set();
    for (const rule of policy.rules) {
      const result = validateRule(rule);
      if (ids.has(rule?.ruleId)) result.errors.push(`ruleIdが重複しています: ${rule.ruleId}`);
      ids.add(rule?.ruleId);
      if (!result.valid || result.errors.length > 0) {
        errors.push(...result.errors.map((error) => `${rule?.ruleId ?? 'unknown'}: ${error}`));
        diagnostics.push({ ...result.diagnostic, reasons: result.errors });
      }
    }
  }
  return { valid: errors.length === 0, errors, diagnostics };
}

/** @param {any} trusted @param {any} candidate */
export function compareTrustedPolicy(trusted, candidate) {
  const trustedRules = new Map((trusted?.rules ?? []).map((/** @type {any} */ rule) => [rule.ruleId, rule]));
  const candidateRules = new Map((candidate?.rules ?? []).map((/** @type {any} */ rule) => [rule.ruleId, rule]));
  const rejected = [];
  const stagedAdditions = [];
  const authorityReasons = [];
  /** @type {Record<string, number>} */
  const mergeStrength = { disabled: 3, assisted: 2, automatic: 1 };
  if ((mergeStrength[candidate?.merge?.mode] ?? 0) < (mergeStrength[trusted?.merge?.mode] ?? 99)) authorityReasons.push(`merge.modeを${trusted?.merge?.mode}から${candidate?.merge?.mode}へ弱化している`);
  if (trusted?.delivery?.stopAt !== candidate?.delivery?.stopAt) authorityReasons.push('delivery.stopAtを変更している');
  const trustedBranches = trusted?.merge?.branches ?? [];
  const candidateBranches = candidate?.merge?.branches ?? [];
  if (candidateBranches.some((/** @type {string} */ item) => !trustedBranches.includes(item))) authorityReasons.push('許可branchを拡大している');
  const trustedMethods = trusted?.merge?.methods ?? [];
  const candidateMethods = candidate?.merge?.methods ?? [];
  if (candidateMethods.some((/** @type {string} */ item) => !trustedMethods.includes(item))) authorityReasons.push('許可merge methodを拡大している');
  const missingChecks = (trusted?.merge?.requiredChecks ?? []).filter((/** @type {string} */ item) => !(candidate?.merge?.requiredChecks ?? []).includes(item));
  if (missingChecks.length) authorityReasons.push(`required checkを削除している: ${missingChecks.join(', ')}`);
  if ((candidate?.merge?.requiredReviews ?? -1) < (trusted?.merge?.requiredReviews ?? 0)) authorityReasons.push('required review数を減らしている');
  if (authorityReasons.length) rejected.push(diagnostic('ASC-TRUST-001', '候補変更によるauthority条件の自己緩和を防止する', 'authority', authorityReasons, ['delivery', 'merge'], ['stopAt、mode、branch、method、check、reviewを比較した'], [], 'trusted authority条件を維持して独立reviewを受けてください', 'default branch policy owner', 'candidateのauthority緩和差分を取り消す'));
  for (const [ruleId, trustedRule] of trustedRules) {
    const next = candidateRules.get(ruleId);
    const reasons = [];
    if (!next) reasons.push('trusted ruleを削除している');
    else {
      if ((STRENGTH[next.enforcement] ?? 0) < (STRENGTH[trustedRule.enforcement] ?? 99)) reasons.push(`${trustedRule.enforcement}から${next.enforcement}へ弱化している`);
      if ((ACTIVATION_STRENGTH[next.activation] ?? 0) < (ACTIVATION_STRENGTH[trustedRule.activation] ?? 99)) reasons.push(`${trustedRule.activation}から${next.activation}へactivationを弱化している`);
      if (trustedRule.overridePolicy === 'never' && next.overridePolicy !== 'never') reasons.push('non-override条件を緩和している');
      if (trustedRule.scope.some((/** @type {string} */ item) => !next.scope.includes(item))) reasons.push('trusted ruleのscope包含を狭めている');
      // activationだけはdisabled -> staged -> activeの単調な昇格を許す。
      // scope、enforcement、owner等の意味変更は別IDのstaged ruleとして再導入する。
      const meaning = (/** @type {any} */ rule) => evidenceFingerprint(Object.fromEntries(RULE_MEANING_FIELDS.map((field) => [field, rule[field]])));
      if (meaning(trustedRule) !== meaning(next)) reasons.push('rule意味fingerprintを変更している');
    }
    if (reasons.length) rejected.push(diagnostic('ASC-TRUST-001', '候補変更による自己承認を防止する', 'authority', reasons, trustedRule.scope, ['trusted default policyとcandidate policyを比較した'], [], 'trusted条件を維持し、独立reviewと既定ブランチへの正規migrationを行ってください', 'default branch policy owner', 'candidateの緩和差分を取り消す'));
  }
  for (const [ruleId, rule] of candidateRules) {
    if (trustedRules.has(ruleId)) continue;
    if (rule.activation === 'staged') stagedAdditions.push(ruleId);
    else rejected.push(diagnostic('ASC-MIGRATION-001', '新規ruleを段階適用して影響を確認する', rule.riskClass, ['新規ruleがstagedではありません'], rule.scope, ['trusted policyに同じrule IDがないことを確認した'], [{ description: '新規ruleをstagedへ変更する', dryRunDiff: `activation: ${rule.activation} -> staged` }], 'staged運用で誤blockと検出漏れを確認してからactiveへ移行してください', rule.owner, `candidateから${ruleId}を除去する`));
  }
  if (trusted?.projectChoices && evidenceFingerprint(trusted.projectChoices) !== evidenceFingerprint(candidate?.projectChoices)) {
    rejected.push(diagnostic('ASC-TRUST-001', 'authorityを含むproject choiceの自己変更を防止する', 'authority', ['projectChoicesのrelease、model mapping、CIまたは開発契約を変更している'], ['projectChoices'], ['trustedとcandidateのprojectChoices fingerprintを比較した'], [], '新しいstaged migrationと独立reviewを作成してください', 'default branch policy owner', 'trusted projectChoicesを復元する'));
  }
  return { allowed: rejected.length === 0, rejected, stagedAdditions };
}

/** @param {any} rule @param {any} override @param {{ruleId: string, issue: number, scope: string, actor: string, sha: string, now: string}} expected */
export function validateOverride(rule, override, expected) {
  const reasons = [];
  if (rule.overridePolicy !== 'bound') reasons.push('このruleはnon-overrideです');
  if (!nonEmpty(expected?.ruleId) || expected.ruleId !== rule.ruleId) reasons.push('expected ruleIdが対象ruleと一致しません');
  if (!nonEmpty(override?.ruleId) || override.ruleId !== expected?.ruleId || override.ruleId !== rule.ruleId) reasons.push('override recordのruleIdが対象ruleと一致しません');
  if (!Number.isInteger(override?.issue) || override.issue <= 0 || override.issue !== expected.issue) reasons.push('Issueが一致しません');
  if (!nonEmpty(override?.scope) || override.scope !== expected.scope || !rule.scope.includes(override.scope)) reasons.push('scopeが一致しません');
  if (!nonEmpty(override?.actor) || override.actor !== expected.actor) reasons.push('actorが一致しません');
  if (!nonEmpty(override?.reason)) reasons.push('理由が必要です');
  const expiry = Date.parse(override?.expiresAt ?? '');
  const now = Date.parse(expected.now);
  if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) reasons.push('overrideが期限切れか期限が不正です');
  if (!/^[a-f0-9]{40}$/i.test(override?.sha ?? '') || override.sha !== expected.sha) reasons.push('対象SHAが一致しません');
  return {
    valid: reasons.length === 0, reasons,
    diagnostic: diagnostic(rule.ruleId, rule.purpose, rule.riskClass, reasons, rule.scope, ['overrideのIssue、scope、actor、reason、expiry、SHAを確認した'], [], '拘束条件を修正するかrule ownerへ新しいauthorityを依頼してください', rule.owner, rule.rollback),
    audit: reasons.length ? undefined : { ruleId: override.ruleId, issue: override.issue, scope: override.scope, actor: override.actor, reason: override.reason, expiresAt: override.expiresAt, sha: override.sha },
  };
}

/** @param {Array<{id: string, requiresExternal: boolean}>} gates @param {{online: boolean}} environment */
export function planOfflineGates(gates, environment) {
  return gates.map((gate) => ({ ...gate, status: !environment.online && gate.requiresExternal ? 'pending' : 'ready', reason: !environment.online && gate.requiresExternal ? '外部接続回復後にこのgateだけを再試行する' : 'localで実行可能' }));
}

/** @param {any} value @returns {any} */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

/** @param {any} input */
export function evidenceFingerprint(input) { return crypto.createHash('sha256').update(JSON.stringify(stable(input))).digest('hex'); }

/** @param {{kind: 'targeted'|'final', changedFiles: string[], risk: string[], evidence: any, successfulFingerprints?: string[], successfulEvidence?: Array<{fingerprint: string, passed: boolean, sha?: string, policyHash?: string, tool?: string, scope?: string[]}>}} input */
export function planValidation(input) {
  const evidenceErrors = [];
  if (!/^[a-f0-9]{40}$/i.test(input.evidence?.sha ?? '')) evidenceErrors.push('証拠SHAは40桁でなければなりません');
  if (!/^[a-f0-9]{64}$/i.test(input.evidence?.policyHash ?? '')) evidenceErrors.push('証拠policyHashは64桁でなければなりません');
  if (!nonEmpty(input.evidence?.tool)) evidenceErrors.push('証拠toolが必要です');
  if (!Array.isArray(input.evidence?.scope) || input.evidence.scope.length === 0) evidenceErrors.push('証拠scopeが必要です');
  if (typeof input.evidence?.passed !== 'boolean') evidenceErrors.push('証拠success状態が必要です');
  if (evidenceErrors.length) return { status: 'blocked', scope: input.kind === 'final' ? 'full' : 'targeted', valid: false, checks: [], diagnostic: diagnostic('ASC-EVIDENCE-001', '検証証拠を正確な状態へ拘束する', 'quality', evidenceErrors, ['validation'], ['SHA、policyHash、tool、scope、successを確認した'], [], '完全な成功証拠を生成して再検証してください', 'test owner', '不完全な証拠を再利用しない') };
  const fingerprint = evidenceFingerprint({ changedFiles: [...input.changedFiles].sort(), risk: [...input.risk].sort(), evidence: input.evidence });
  if (input.kind === 'final' && input.evidence.passed !== true) return { status: 'blocked', scope: 'full', valid: false, fingerprint, checks: [], diagnostic: diagnostic('ASC-EVIDENCE-001', '検証証拠を正確な状態へ拘束する', 'quality', ['final gateは成功証拠がなければ操作を続行できません'], ['validation'], ['final evidenceのsuccessを確認した'], [], 'full validationと独立reviewを実行し、同じSHAの成功証拠で再検証してください', 'test owner', '失敗証拠を承認に再利用しない') };
  if (input.kind === 'final') return { status: 'ready', scope: 'full', fingerprint, checks: ['security', 'acceptance', 'independentReview', 'fullTest'] };
  const matching = (input.successfulEvidence ?? []).filter((/** @type {any} */ item) => item.fingerprint === fingerprint);
  if (input.evidence.passed === true && matching.some((/** @type {any} */ item) => item.passed !== true)) return { status: 'blocked', scope: 'targeted', valid: false, fingerprint, checks: [], diagnostic: diagnostic('ASC-EVIDENCE-001', '検証証拠を正確な状態へ拘束する', 'quality', ['同fingerprintの現在成功証拠と失敗cacheが矛盾しています'], ['validation'], ['current evidenceとstructured cacheの成否を確認した'], [], '矛盾するevidenceを破棄してtargeted validationを再実行してください', 'test owner', 'legacy fingerprintを再利用しない') };
  const evidencePassed = input.evidence.passed === true && matching.some((/** @type {any} */ item) => item.passed === true && item.sha === input.evidence.sha && item.policyHash === input.evidence.policyHash && item.tool === input.evidence.tool && stableJson(item.scope) === stableJson(input.evidence.scope));
  const duplicate = evidencePassed;
  return { status: duplicate ? 'deduplicated' : 'ready', scope: 'targeted', fingerprint, checks: duplicate ? [] : ['riskSelectedTest', 'riskSelectedReview'] };
}

/** @param {Array<{kind: string, value?: number, secret?: string}>} events @param {{localFeedbackMs?: number, prGateMs?: number}} budgets */
export function aggregateMetrics(events, budgets = {}) {
  const metrics = Object.fromEntries(METRIC_KINDS.map((kind) => [kind, 0]));
  const unknown = events.filter((event) => !METRIC_KINDS.includes(event.kind)).map((event) => event.kind);
  for (const event of events) if (METRIC_KINDS.includes(event.kind)) metrics[event.kind] += event.kind === 'gateWaitMs' ? Math.max(0, Number(event.value) || 0) : 1;
  /** @type {any} */
  const result = { valid: unknown.length === 0, metrics, budgets, exceeded: { localFeedback: budgets.localFeedbackMs !== undefined && metrics.gateWaitMs > budgets.localFeedbackMs, prGate: budgets.prGateMs !== undefined && metrics.gateWaitMs > budgets.prGateMs } };
  if (!result.valid) result.diagnostic = diagnostic('ASC-METRIC-001', 'policy品質の観測漏れを防止する', 'quality', [`未知metric kind: ${unknown.join(', ')}`], ['metrics'], ['metric kind allowlistを確認した'], [], '既知kindへ修正するかschemaとruntimeを同じmigrationで拡張してください', 'workflow maintainer', '未知eventを適用せず保持する');
  return result;
}

/** @param {any} floor @param {any} project @param {{trusted?: boolean}} [options] */
export function resolveEffectivePolicy(floor, project, options = {}) {
  if (!project) return { valid: true, policy: structuredClone(floor), source: 'package-default-floor' };
  const floorRules = new Map((floor.rules ?? []).map((/** @type {any} */ rule) => [rule.ruleId, rule]));
  const additions = [];
  const replacements = new Map();
  const rejected = [];
  for (const rule of project.rules ?? []) {
    if (!floorRules.has(rule.ruleId)) {
      if (rule.activation !== 'staged' && options.trusted !== true) rejected.push(`${rule.ruleId}は初回導入時にstagedでなければなりません`);
      else additions.push(rule);
    } else {
      const comparison = compareTrustedPolicy({ ...floor, rules: [floorRules.get(rule.ruleId)] }, { ...floor, rules: [rule] });
      rejected.push(...comparison.rejected.flatMap((item) => item.reasons));
      if (comparison.allowed) replacements.set(rule.ruleId, rule);
    }
  }
  if (rejected.length) return { valid: false, policy: structuredClone(floor), diagnostic: diagnostic('ASC-EFFECTIVE-001', 'package安全floorをproject設定で弱化させない', 'authority', rejected, ['project-policy'], ['package defaultとproject extensionを比較した'], [], 'project固有ruleを新しいIDのstaged ruleとして追加してください', 'project policy owner', 'package default floorだけへ戻す') };
  const effectiveRules = (floor.rules ?? []).map((/** @type {any} */ rule) => replacements.get(rule.ruleId) ?? rule);
  return { valid: true, source: 'package-floor+trusted-project-extension', policy: { ...structuredClone(floor), delivery: options.trusted ? project.delivery ?? floor.delivery : floor.delivery, merge: options.trusted ? project.merge ?? floor.merge : floor.merge, budgets: project.budgets ?? floor.budgets, projectChoices: project.projectChoices, rules: [...effectiveRules, ...additions] } };
}

/** @param {{policy: any, ruleId: string, boundary: string, violated: boolean, reasons?: string[], checks?: string[], override?: any, expectedOverride?: any, online?: boolean, requiresExternal?: boolean, validation?: any, events?: any[]}} input */
export function enforceOperation(input) {
  const validation = validateEnforcementPolicy(input.policy);
  if (!validation.valid) return { allowed: false, status: 'blocked', diagnostic: validation.diagnostics[0] };
  const rule = input.policy.rules.find((/** @type {any} */ item) => item.ruleId === input.ruleId);
  if (!rule || !rule.scope.includes(input.boundary)) return { allowed: false, status: 'blocked', diagnostic: diagnostic('ASC-SCOPE-001', 'operationへ適用するrule scopeを保証する', 'authority', ['ruleがないかboundaryをscopeに含みません'], [input.boundary], ['rule IDとscopeを確認した'], [], 'trusted policyへboundaryを含むstaged ruleを追加してください', 'project policy owner', 'operationを実行せず保持する') };
  const offline = planOfflineGates([{ id: input.boundary, requiresExternal: input.requiresExternal === true }], { online: input.online !== false })[0];
  if (offline.status === 'pending') return { allowed: false, status: 'pending', diagnostic: diagnostic(rule.ruleId, rule.purpose, rule.riskClass, [offline.reason], rule.scope, ['外部接続の必要性を確認した'], [], offline.reason, rule.owner, rule.rollback) };
  const metricResult = aggregateMetrics(input.events ?? [], input.policy.budgets ?? {});
  if (!metricResult.valid) return { allowed: false, status: 'blocked', diagnostic: metricResult.diagnostic, metrics: metricResult };
  const validationPlan = input.validation ? planValidation(input.validation) : undefined;
  if (validationPlan?.status === 'blocked') return { allowed: false, status: 'blocked', diagnostic: validationPlan.diagnostic, validation: validationPlan, metrics: metricResult };
  const evaluated = evaluateRule(rule, { violated: input.violated, reasons: input.reasons, checks: input.checks });
  if (evaluated.allowed) return { ...evaluated, allowed: true, validation: validationPlan, metrics: metricResult };
  if (input.override && input.expectedOverride) {
    const override = validateOverride(rule, input.override, input.expectedOverride);
    if (override.valid) return { ...evaluated, status: 'overridden', allowed: true, blocked: false, overrideAudit: override.audit, validation: validationPlan, metrics: metricResult };
  }
  return { ...evaluated, allowed: false, validation: validationPlan, metrics: metricResult };
}

/** Operation adapters must bind each independently derived observation to one exact trusted rule ID. @param {{policy: any, boundary: string, observations: Array<{ruleId: string, violated: boolean, reasons?: string[], checks?: string[]}>}} input */
export function enforceTrustedBoundary(input) {
  const validation = validateEnforcementPolicy(input.policy);
  if (!validation.valid) return { allowed: false, boundary: input.boundary, diagnostic: validation.diagnostics[0] ?? diagnostic('ASC-POLICY-INVALID', 'trusted policyをoperation前に検証する', 'authority', validation.errors, [input.boundary], ['trusted policy全ruleを検証した'], [], 'trusted policyを修正してからoperationを再実行してください', 'project policy owner', 'operationを実行しない') };
  const applicable = (input.policy?.rules ?? []).filter((/** @type {any} */ rule) => rule.scope.includes(input.boundary));
  if (applicable.length === 0) return { allowed: false, boundary: input.boundary, diagnostic: diagnostic('ASC-SCOPE-001', 'operation境界をtrusted ruleで統治する', 'authority', [`${input.boundary}へ適用するtrusted ruleがありません`], [input.boundary], ['trusted policyの全scopeを確認した'], [], 'trusted policyへ対象boundaryを持つruleを追加してください', 'project policy owner', 'operationを実行しない') };
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const results = applicable.map((/** @type {any} */ rule) => {
    const matches = observations.filter((item) => item?.ruleId === rule.ruleId);
    const observed = matches.length === 1 ? matches[0] : {
      violated: true,
      reasons: [matches.length === 0 ? `${rule.ruleId}に必要なactual observationがありません` : `${rule.ruleId}のactual observationが重複しています`],
      checks: ['operation adapterのrule ID別観測完全性を確認した'],
    };
    return evaluateRule(rule, observed);
  });
  const blocked = results.find((/** @type {any} */ result) => result.blocked === true || result.allowed !== true);
  return blocked ? { allowed: false, boundary: input.boundary, results, diagnostic: blocked.diagnostic } : { allowed: true, boundary: input.boundary, results };
}

/** @param {any} trusted @param {any} candidate */
export function planMigration(trusted, candidate) {
  const compatibility = compareTrustedPolicy(trusted, candidate);
  const trustedIds = new Set((trusted.rules ?? []).map((/** @type {any} */ rule) => rule.ruleId));
  const candidateIds = new Set((candidate.rules ?? []).map((/** @type {any} */ rule) => rule.ruleId));
  /** @type {any} */
  const plan = {
    state: 'staged', fromVersion: trusted.schemaVersion, toVersion: candidate.schemaVersion,
    changes: evidenceFingerprint(trusted) === evidenceFingerprint(candidate) ? [] : ['policy'], compatibility,
    dryRun: true, writes: [], snapshot: structuredClone(trusted), candidate: structuredClone(candidate),
    revision: 0, trustedHash: evidenceFingerprint(trusted), candidateHash: evidenceFingerprint(candidate),
    dryRunDiff: {
      schemaVersion: `${trusted.schemaVersion} -> ${candidate.schemaVersion}`,
      addedRules: [...candidateIds].filter((ruleId) => !trustedIds.has(ruleId)),
      removedRules: [...trustedIds].filter((ruleId) => !candidateIds.has(ruleId)),
    },
    rollback: 'snapshotを原子的に復元しvalidationを再実行する', retry: '同じmigration plan IDとcandidateで再適用する',
    planId: evidenceFingerprint({ from: trusted.schemaVersion, to: candidate.schemaVersion, rules: candidate.rules }),
  };
  plan.planFingerprint = evidenceFingerprint({ planId: plan.planId, trustedHash: plan.trustedHash, candidateHash: plan.candidateHash, changes: plan.changes });
  return plan;
}

/** @param {ReturnType<typeof planMigration>} plan @param {{approvedPlanHash?: string, expectedRevision?: number}} [authority] */
export function applyMigration(plan, authority = {}) {
  const reasons = conceptualMigrationReasons(plan, plan.snapshot, plan.candidate, 0, authority);
  if (!plan.compatibility.allowed || reasons.length) return conceptualRejected(plan, [...reasons, ...plan.compatibility.rejected.flatMap((/** @type {any} */ item) => item.reasons)]);
  return { ...plan, state: 'applied', revision: 1, dryRun: false, policy: structuredClone(plan.candidate), history: ['staged', 'applied'] };
}

/** @param {ReturnType<typeof applyMigration>} state @param {{approvedPlanHash?: string, expectedRevision?: number}} [authority] */
export function rollbackMigration(state, authority = {}) {
  const reasons = conceptualMigrationReasons(state, state.snapshot, state.candidate, 1, authority);
  if (reasons.length) return conceptualRejected(state, reasons);
  return { ...state, state: 'rolled_back', revision: 2, policy: structuredClone(state.snapshot), history: [...(state.history ?? []), 'rolled_back'] };
}

/** @param {ReturnType<typeof rollbackMigration>} state @param {any} trusted @param {any} candidate @param {{approvedPlanHash?: string, expectedRevision?: number}} [authority] */
export function retryMigration(state, trusted, candidate, authority = {}) {
  const reasons = conceptualMigrationReasons(state, trusted, candidate, 2, authority);
  if (state.state !== 'rolled_back') reasons.push('retryはrollback後だけ実行できます');
  const compatibility = compareTrustedPolicy(trusted, candidate);
  if (!compatibility.allowed) reasons.push(...compatibility.rejected.flatMap((/** @type {any} */ item) => item.reasons));
  if (reasons.length) return conceptualRejected(state, reasons);
  return { ...state, state: 'applied', revision: 3, policy: structuredClone(candidate), history: [...state.history, 'applied'] };
}

/** @param {any} state @param {any} trusted @param {any} candidate @param {number} revision @param {{approvedPlanHash?: string, expectedRevision?: number}} authority */
function conceptualMigrationReasons(state, trusted, candidate, revision, authority) {
  const reasons = [];
  if (!trusted || !candidate) reasons.push('trustedとcandidateの再入力が必要です');
  if (typeof authority.approvedPlanHash !== 'string' || authority.approvedPlanHash !== state.planFingerprint) reasons.push('call-siteの独立approved plan hashが必要です');
  if (!Number.isInteger(authority.expectedRevision) || authority.expectedRevision !== revision) reasons.push(`call-siteのexpected revisionが必要です: required=${revision}`);
  if (state.revision !== revision) reasons.push(`state revisionが不正です: expected=${revision} actual=${state.revision}`);
  if (trusted && evidenceFingerprint(trusted) !== state.trustedHash) reasons.push('trusted policy hashが一致しません');
  if (candidate && evidenceFingerprint(candidate) !== state.candidateHash) reasons.push('candidate policy hashが一致しません');
  const expected = evidenceFingerprint({ planId: state.planId, trustedHash: state.trustedHash, candidateHash: state.candidateHash, changes: state.changes });
  if (expected !== state.planFingerprint) reasons.push('immutable plan fingerprintが一致しません');
  if (trusted?.schemaVersion === CURRENT_POLICY_SCHEMA_VERSION && !validateEnforcementPolicy(trusted).valid) reasons.push('trusted policyのrule検証に失敗しました');
  if (candidate?.schemaVersion === CURRENT_POLICY_SCHEMA_VERSION && !validateEnforcementPolicy(candidate).valid) reasons.push('candidate policyのrule検証に失敗しました');
  return reasons;
}

/** @param {any} state @param {string[]} reasons */
function conceptualRejected(state, reasons) { return { ...state, state: 'rejected', allowed: false, diagnostic: diagnostic('ASC-MIGRATION-TOCTOU-001', 'migration再実行の証拠完全性を守る', 'authority', reasons, ['migration'], ['revision、trusted/candidate hash、plan fingerprint、compatibilityを再検証した'], [], 'trusted/candidateから新しいdry-run planを作成してください', 'project policy owner', 'snapshotを保持して適用しない'), history: [...(state.history ?? []), 'rejected'] }; }

/** @param {string[]} files @param {string[]} patterns */
export function classifyPackageAssets(files, patterns = []) {
  const excluded = files.filter((file) => pathIsSensitive(file) || patterns.some((pattern) => pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern));
  return { excluded, allowed: files.filter((file) => !excluded.includes(file)) };
}

/** @param {string} file */
function pathIsSensitive(file) {
  const name = file.split('/').at(-1)?.toLowerCase() ?? '';
  const stem = name.replace(/\.[^.]+$/u, '');
  const credentialSegment = /(?:^|[._-])(?:credentials?|secrets?|auth|client-secrets?)(?:$|[._-])/u;
  return name.startsWith('.env') || credentialSegment.test(stem) || ['.pem', '.key', '.p12', '.pfx'].some((suffix) => name.endsWith(suffix));
}

/** @param {unknown} value @returns {boolean} */
function structuredSecret(value) {
  if (Array.isArray(value)) return value.some(structuredSecret);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => /^(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey|authorization)$/i.test(key) || structuredSecret(item));
}

/** @param {string} contents */
function contentIsSensitive(contents) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{20,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@|["']?(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey)["']?\s*[=:]\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|(?![/[{(])[A-Za-z0-9._+~-]{8,})/i.test(contents)) return true;
  try { return structuredSecret(JSON.parse(contents)); } catch { return false; }
}

/** @param {string[]} files @param {string[]} allowed @param {Record<string, string>} [contents] */
export function validatePackageManifest(files, allowed, contents = {}) {
  const unexpected = files.filter((file) => file !== 'package.json' && !allowed.some((entry) => file === entry.replace(/\/$/, '') || file.startsWith(`${entry.replace(/\/$/, '')}/`)));
  const sensitive = files.filter(pathIsSensitive);
  const secretContents = files.filter((file) => typeof contents[file] === 'string' && contentIsSensitive(contents[file]));
  const reasons = [...new Set([...sensitive.map((file) => `秘密・credential containerを配布できません: ${file}`), ...secretContents.map((file) => `実contentに秘密patternがあります: ${file}`), ...unexpected.map((file) => `manifest allowlist外です: ${file}`)])];
  return { valid: reasons.length === 0, reasons, diagnostic: reasons.length ? diagnostic('ASC-ARTIFACT-001', '配布成果物の汚染を防止する', 'artifact', reasons, ['artifact_distribution'], ['実pack内容とmanifest allowlistを比較した'], [], '環境fileとallowlist外assetを除外して再構築してください', 'artifact owner', '汚染成果物を公開しない') : undefined };
}

/** @param {Array<{path: string, owner: string, targetLayer: 'package'|'project'|'spec'|'evidence', evidence?: string}>} assets @param {'local'|'pr'|'package'} stage */
export function validateOwnershipBoundary(assets, stage) {
  /** @param {string} file */
  const expectedLayer = (file) => file === '.agent-skill-chain/project-policy.json' || ['.agent-skill-chain/project/', '.agent-skill-chain/tmp/', '.agent-skill-chain/role-log/', '.agent-skill-chain/metrics/'].some((prefix) => file.startsWith(prefix)) ? 'project' : file.startsWith('docs/specs/') ? 'spec' : file.startsWith('test/') || file.startsWith('docs/reviews/') || file.startsWith('.agent-skill-chain/reviews/') ? 'evidence' : 'package';
  const findings = [];
  for (const asset of assets) {
    const expected = expectedLayer(asset.path);
    if (asset.targetLayer !== expected) findings.push({ path: asset.path, reason: `分類${asset.targetLayer}と配置${expected}が一致しません`, moveTo: expected === 'project' ? '.agent-skill-chain/project-policy.json' : expected === 'spec' ? 'docs/specs/' : '.agent-skill-chain/' });
    if (stage === 'pr' && (!nonEmpty(asset.owner) || !nonEmpty(asset.evidence))) findings.push({ path: asset.path, reason: 'PR分類にはownerとevidenceが必要です', moveTo: asset.path });
    if (stage === 'package' && asset.targetLayer !== 'package') findings.push({ path: asset.path, reason: 'project/spec/evidence assetが実配布物へ混入しています', moveTo: '配布manifest外' });
  }
  const enforcement = stage === 'local' ? 'assist' : stage === 'pr' ? 'require' : 'deny';
  const blocked = findings.length > 0 && stage !== 'local';
  return {
    allowed: !blocked, status: findings.length === 0 ? 'passed' : enforcement === 'assist' ? 'assisted' : enforcement === 'require' ? 'required' : 'blocked', findings,
    diagnostic: findings.length ? diagnostic('ASC-OWNERSHIP-001', '汎用機構、project規約、製品仕様の所有境界を構造で保つ', stage === 'package' ? 'artifact' : 'quality', findings.map((item) => `${item.path}: ${item.reason}`), assets.map((item) => item.path), ['path、owner、targetLayer、evidenceを構造比較した'], findings.map((item) => ({ description: `${item.path}を${item.moveTo}へ移動する`, dryRunDiff: `${item.path} -> ${item.moveTo}` })), stage === 'local' ? 'dry-run移動案を確認してください' : 'ownerと分類根拠を補い再検証してください', stage === 'local' ? '不要' : 'asset owner', '誤配置fileを元の所有layerへ戻す') : undefined,
  };
}
