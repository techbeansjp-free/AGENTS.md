import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../lib/atomic.js';
import { resolveContained, stableJson } from '../lib/security.js';
import { compareTrustedPolicy, diagnostic } from './enforcement.js';
import { loadProjectPolicySet, validatePolicy } from './policy.js';

const ORDER = ['policy', 'schema', 'runtime', 'CI', 'template'];
/** @type {Record<string, RegExp>} */
const OWNED_PATHS = {
  policy: /^\.agent-skill-chain\/(?:project-policy\.json|project\/(?:choices|rules|conformance)\/[a-z0-9][a-z0-9.-]*\.json)$/u,
  schema: /^\.agent-skill-chain\/schemas\/.+\.json$/u,
  runtime: /^src\/.+\.js$/u,
  CI: /^\.github\/workflows\/.+\.ya?ml$/u,
  template: /^\.agent-skill-chain\/templates\/.+\.(?:md|json)$/u,
};
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const CONTENT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u;

/** @param {string|null} contents */
function hash(contents) { return contents === null ? null : crypto.createHash('sha256').update(contents).digest('hex'); }

/** @param {unknown} value */
function digest(value) { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }

/** Policy set metadata is provenance, while its assembled policy is the semantic enforcement input. @param {any} input */
function policyOf(input) { return input?.policy && input?.rawEntries && input?.setHash ? input.policy : input; }

/** @param {any} input */
function fragmentedSet(input) { return Boolean(input?.policy && input?.manifest?.schemaVersion === 'agent-skill-chain/project-policy-manifest/v1' && input?.rawEntries && input?.setHash); }

/** @param {string[]} reasons */
function rejected(reasons) {
  return { state: 'rejected', allowed: false, diagnostic: { ...diagnostic('ASC-MIGRATION-TOCTOU-001', 'migration stateの改竄とTOCTOUを防止する', 'authority', reasons, ['migration'], ['policy、hash、fingerprint、revision、実fileを再検証した'], [], 'trusted/candidateとmanifestから新しいdry-run planを作成してください', 'project policy owner', 'snapshotの内容を保持して適用しない'), overridePolicy: 'never' } };
}

/** A state field is audit data, never approval authority. @param {any} state @param {{approvedPlanHash?: string, expectedRevision?: number}} options @param {number|undefined} requiredRevision */
function requireExternalAuthority(state, options, requiredRevision) {
  const reasons = [];
  if (typeof options.approvedPlanHash !== 'string' || options.approvedPlanHash !== state.planFingerprint) reasons.push('call-siteの独立approved plan hashが必要です');
  if (!Number.isInteger(options.expectedRevision)) reasons.push('call-siteのexpected revisionが必要です');
  else {
    if (options.expectedRevision !== state.revision) reasons.push(`expected revisionがstateと一致しません: expected=${options.expectedRevision} actual=${state.revision}`);
    if (requiredRevision !== undefined && options.expectedRevision !== requiredRevision) reasons.push(`operationのexpected revisionが不正です: required=${requiredRevision} actual=${options.expectedRevision}`);
  }
  return reasons.length ? rejected(reasons) : { allowed: true };
}

/** @param {unknown} error */
function simulatedCrash(error) { return Boolean(error && typeof error === 'object' && 'simulatedCrash' in error); }

/** @param {any} state */
function immutable(state) {
  return { root: state.root, trustedHash: state.trustedHash, candidateHash: state.candidateHash, candidateSetHash: state.candidateSetHash, candidateSemanticPolicyHash: state.candidateSemanticPolicyHash, candidateInventoryHash: state.candidateInventoryHash, manifestHash: state.manifestHash, manifest: state.manifest, artifacts: state.artifacts.map((/** @type {any} */ item) => ({ kind: item.kind, path: item.path, source: item.source, owner: item.owner, retention: item.retention, beforeHash: item.beforeHash, afterHash: item.afterHash })) };
}

/** @param {string} root @param {string} relative */
function rejectSymlink(root, relative) {
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`${relative}はsymlinkを含むため移行できません`);
  }
}

/** @param {string} kind @param {string} relative @param {string} after @param {any} candidateInput */
function validateArtifact(kind, relative, after, candidateInput) {
  const reasons = [];
  if (!OWNED_PATHS[kind]?.test(relative)) reasons.push(`${kind}が所有しないpathです: ${relative}`);
  if (kind === 'policy') {
    if (fragmentedSet(candidateInput)) {
      const sourcePath = relative.replace(/^\.agent-skill-chain\//u, '');
      if (!(sourcePath in candidateInput.rawEntries)) reasons.push(`policy artifactがcandidate set inventoryにありません: ${relative}`);
      else if (after !== candidateInput.rawEntries[sourcePath]) reasons.push(`policy artifactがcandidate raw bytesと一致しません: ${relative}`);
    } else {
      const canonical = `${JSON.stringify(policyOf(candidateInput), null, 2)}\n`;
      if (relative !== '.agent-skill-chain/project-policy.json' || after !== canonical) reasons.push('policy afterがcandidate canonical JSONと一致しません');
    }
  } else if (kind === 'schema') {
    try { const value = JSON.parse(after); if (!value || typeof value !== 'object' || typeof value.$schema !== 'string' || value.type !== 'object') reasons.push('schema artifactに$schemaとobject typeが必要です'); } catch { reasons.push('schema artifactは有効なJSONでなければなりません'); }
  } else if (kind === 'runtime' && (after.trim() === '' || CONTENT_CONTROL.test(after))) reasons.push('runtime artifactは不正制御文字なしの非空sourceでなければなりません');
  else if (kind === 'CI' && (!/(?:^|\n)\s*jobs\s*:/u.test(after) || !/(?:^|\n)\s*(?:name|on)\s*:/u.test(after))) reasons.push('CI artifactにname/onとjobsが必要です');
  else if (kind === 'template' && (after.trim() === '' || CONTENT_CONTROL.test(after))) reasons.push('template artifactは不正制御文字なしの非空文書でなければなりません');
  return reasons;
}

/** @param {string} root @param {any} trusted @param {any} candidate @param {Array<{kind: string, path: string, after: string}>} entries */
export function planFileMigration(root, trusted, candidate, entries) {
  const trustedPolicy = policyOf(trusted); const candidatePolicy = policyOf(candidate);
  const trustedValidation = validatePolicy(trustedPolicy);
  const candidateValidation = validatePolicy(candidatePolicy);
  if (!trustedValidation.valid || !candidateValidation.valid) return rejected([...trustedValidation.errors, ...candidateValidation.errors]);
  const projectDirectory = path.join(path.resolve(root), '.agent-skill-chain', 'project');
  if ((fragmentedSet(trusted) || fs.existsSync(projectDirectory)) && !fragmentedSet(candidate)) return rejected(['fragmented trusted/root policy setをlegacy monolith candidateで上書きできません。manifestと全fragmentのexplicit migrationが必要です']);
  if (fragmentedSet(candidate)) {
    const expectedPolicyPaths = Object.keys(candidate.rawEntries).map((relative) => `.agent-skill-chain/${relative}`).sort();
    const actualPolicyPaths = entries.filter((entry) => entry.kind === 'policy').map((entry) => entry.path).sort();
    if (stableJson(expectedPolicyPaths) !== stableJson(actualPolicyPaths)) return rejected(['fragmented policy migrationはmanifestと全fragmentのcandidate raw inventoryをpath単位で完全列挙してください']);
  }
  const seen = new Set();
  const artifacts = [];
  for (const entry of [...entries].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))) {
    if (!ORDER.includes(entry.kind)) return rejected([`manifest kindが不正です: ${entry.kind}`]);
    if (typeof entry.after !== 'string') return rejected([`${entry.kind}.afterは文字列でなければなりません`]);
    if (typeof entry.path !== 'string' || CONTROL.test(entry.path) || entry.path !== entry.path.normalize('NFC')) return rejected([`${entry.kind}.pathはNFC正規化された安全な文字列でなければなりません`]);
    const collisionKey = entry.path.replaceAll('\\', '/').normalize('NFC').toLocaleLowerCase('und');
    if (seen.has(collisionKey)) return rejected([`manifest pathが重複またはUnicode/case衝突しています: ${entry.path}`]);
    seen.add(collisionKey);
    let file;
    try { file = resolveContained(root, entry.path, { allowMissingLeaf: true }); rejectSymlink(root, entry.path); } catch (error) { return rejected([error instanceof Error ? error.message : String(error)]); }
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const artifactErrors = validateArtifact(entry.kind, relative, entry.after, candidate);
    if (artifactErrors.length) return rejected(artifactErrors);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before === entry.after) continue;
    artifacts.push({ kind: entry.kind, path: relative, source: entry.kind === 'policy' ? 'candidate canonical JSON' : `manifest:${relative}`, owner: 'project policy owner', retention: 'transaction完了と外部証拠確認まで保持する', beforeHash: hash(before), afterHash: hash(entry.after), before, after: entry.after });
  }
  const manifest = artifacts.map(({ kind, path: relative, source, owner, retention, beforeHash, afterHash }, order) => ({ order, kind, path: relative, source, owner, retention, beforeHash, afterHash }));
  /** @type {any} */
  const state = {
    state: 'staged', allowed: true, revision: 0, history: ['staged'], root: path.resolve(root),
    trustedHash: digest(trustedPolicy), candidateHash: digest(candidatePolicy),
    candidateSetHash: fragmentedSet(candidate) ? candidate.setHash : undefined,
    candidateSemanticPolicyHash: fragmentedSet(candidate) ? candidate.semanticPolicyHash : undefined,
    candidateInventoryHash: fragmentedSet(candidate) ? digest(candidate.rawEntries) : undefined,
    manifestHash: digest(manifest),
    compatibility: compareTrustedPolicy(trustedPolicy, candidatePolicy), manifest, artifacts,
    changes: [...new Set(manifest.map((item) => item.kind))], snapshot: '各manifest entryのbefore内容', rollback: 'durable journalとbefore hashから全fileを復元する', retry: 'approved plan hash、revision CAS、全hashを再検証して再適用する',
  };
  state.planId = digest({ trusted: trustedPolicy, candidate: candidatePolicy, candidateSetHash: state.candidateSetHash, candidateInventoryHash: state.candidateInventoryHash, manifest, artifacts: artifacts.map((item) => ({ kind: item.kind, path: item.path, source: item.source, owner: item.owner, retention: item.retention, beforeHash: item.beforeHash, afterHash: item.afterHash })) });
  state.planFingerprint = digest({ planId: state.planId, immutable: immutable(state) });
  if (!state.compatibility.allowed) return { ...state, ...rejected(state.compatibility.rejected.flatMap((/** @type {any} */ item) => item.reasons)) };
  return state;
}

/** @param {any} state @param {any} trusted @param {any} candidate @param {number} revision @param {'beforeHash'|'afterHash'} expectedFileHash @param {string|undefined} approvedPlanHash */
function verify(state, trusted, candidate, revision, expectedFileHash, approvedPlanHash) {
  const reasons = [];
  const trustedPolicy = policyOf(trusted); const candidatePolicy = policyOf(candidate);
  const trustedValidation = validatePolicy(trustedPolicy);
  const candidateValidation = validatePolicy(candidatePolicy);
  reasons.push(...trustedValidation.errors, ...candidateValidation.errors);
  if (state.revision !== revision) reasons.push(`state revisionが不正です: expected=${revision} actual=${state.revision}`);
  if (digest(trustedPolicy) !== state.trustedHash) reasons.push('trusted policy hashが変化しました');
  if (digest(candidatePolicy) !== state.candidateHash) reasons.push('candidate policy hashが変化しました');
  if (state.candidateSetHash !== undefined && (!fragmentedSet(candidate) || candidate.setHash !== state.candidateSetHash || candidate.semanticPolicyHash !== state.candidateSemanticPolicyHash || digest(candidate.rawEntries) !== state.candidateInventoryHash)) reasons.push('candidate fragmented policy setのhashまたはinventoryが変化しました');
  if (digest(state.manifest) !== state.manifestHash) reasons.push('manifest hashが変化しました');
  const expectedPlanId = digest({ trusted: trustedPolicy, candidate: candidatePolicy, candidateSetHash: state.candidateSetHash, candidateInventoryHash: state.candidateInventoryHash, manifest: state.manifest, artifacts: (state.artifacts ?? []).map((/** @type {any} */ item) => ({ kind: item.kind, path: item.path, source: item.source, owner: item.owner, retention: item.retention, beforeHash: item.beforeHash, afterHash: item.afterHash })) });
  if (expectedPlanId !== state.planId) reasons.push('planIdをtrusted/candidate/manifestから再導出できません');
  const expectedFingerprint = digest({ planId: state.planId, immutable: immutable(state) });
  if (expectedFingerprint !== state.planFingerprint) reasons.push('immutable plan fingerprintが一致しません');
  if (!approvedPlanHash || approvedPlanHash !== state.planFingerprint) reasons.push('approved plan hashが一致しません');
  const compatibility = compareTrustedPolicy(trustedPolicy, candidatePolicy);
  if (!compatibility.allowed) reasons.push(...compatibility.rejected.flatMap((item) => item.reasons));
  for (const artifact of state.artifacts ?? []) {
    if (hash(artifact.before) !== artifact.beforeHash) reasons.push(`${artifact.path}のsnapshot内容が改竄されています`);
    if (hash(artifact.after) !== artifact.afterHash) reasons.push(`${artifact.path}の適用内容が改竄されています`);
    let file;
    try { file = resolveContained(state.root, artifact.path, { allowMissingLeaf: true }); rejectSymlink(state.root, artifact.path); } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); continue; }
    const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (hash(contents) !== artifact[expectedFileHash]) reasons.push(`${artifact.path}が計画後に変化しました`);
  }
  return reasons.length ? rejected(reasons) : { allowed: true };
}

/** @param {any} state @param {any} trusted @param {any} candidate */
/** @param {any} state @param {any} trusted @param {any} candidate @param {{approvedPlanHash?: string, expectedRevision?: number, persist?: (value: any) => void, interruptAfterStep?: number, write?: (file: string, contents: string) => void}} [options] */
export function applyFileMigration(state, trusted, candidate, options = {}) {
  const authority = requireExternalAuthority(state, options, 0);
  if (!authority.allowed) return authority;
  const verified = verify(state, trusted, candidate, 0, 'beforeHash', options.approvedPlanHash);
  if (!verified.allowed) return verified;
  const written = [];
  let journal = { ...state, transaction: { phase: 'applying', nextStep: 0 }, approvedPlanHash: options.approvedPlanHash };
  options.persist?.(journal);
  try {
    for (const [index, artifact] of state.artifacts.entries()) {
      const file = resolveContained(state.root, artifact.path, { allowMissingLeaf: true });
      rejectSymlink(state.root, artifact.path);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (hash(current) !== artifact.beforeHash) throw new Error(`${artifact.path}がwrite直前に変化しました`);
      journal = { ...journal, transaction: { phase: 'writing', nextStep: index, path: artifact.path } };
      options.persist?.(journal);
      // write後の検証失敗でも現在artifactを必ずbeforeへ戻せるよう、write前にrollback対象へ登録する。
      written.push(artifact);
      (options.write ?? writeFileAtomic)(file, artifact.after);
      if (hash(fs.readFileSync(file, 'utf8')) !== artifact.afterHash) throw new Error(`${artifact.path}のread-after-write検証に失敗しました`);
      journal = { ...journal, transaction: { phase: 'applying', nextStep: index + 1 } };
      options.persist?.(journal);
      if (options.interruptAfterStep === index) throw Object.assign(new Error('模擬crash'), { simulatedCrash: true });
    }
    if (state.candidateSetHash !== undefined) {
      const loaded = loadProjectPolicySet(state.root);
      if (loaded.setHash !== state.candidateSetHash || loaded.semanticPolicyHash !== state.candidateSemanticPolicyHash) throw new Error('apply後project policy setのset hashまたはsemantic hashがcandidateと一致しません');
    }
  } catch (error) {
    if (simulatedCrash(error)) throw error;
    try {
      for (const artifact of written.reverse()) restore(state.root, artifact);
      options.persist?.({ ...journal, state: 'rolled_back', revision: 2, transaction: { phase: 'rolled_back', nextStep: 0 } });
    } catch (rollbackError) {
      const recovery = { ...journal, state: 'recovery_required', transaction: { phase: 'rollback_interrupted', nextStep: written.length } };
      options.persist?.(recovery);
      return { ...rejected([error instanceof Error ? error.message : String(error), rollbackError instanceof Error ? rollbackError.message : String(rollbackError)]), journal: recovery };
    }
    return rejected([error instanceof Error ? error.message : String(error)]);
  }
  const applied = { ...state, state: 'applied', revision: 1, history: [...state.history, 'applied'], readAfterWrite: true, approvedPlanHash: options.approvedPlanHash, transaction: { phase: 'applied', nextStep: state.artifacts.length } };
  options.persist?.(applied);
  return applied;
}

/** @param {string} root @param {any} artifact */
function restore(root, artifact) {
  const file = resolveContained(root, artifact.path, { allowMissingLeaf: true });
  rejectSymlink(root, artifact.path);
  if (artifact.before === null) fs.rmSync(file, { force: true });
  else writeFileAtomic(file, artifact.before);
}

/** @param {any} state @param {any} trusted @param {any} candidate */
/** @param {any} state @param {any} trusted @param {any} candidate @param {{approvedPlanHash?: string, expectedRevision?: number, persist?: (value: any) => void, interruptAfterStep?: number}} [options] */
export function rollbackFileMigration(state, trusted, candidate, options = {}) {
  const authority = requireExternalAuthority(state, options, 1);
  if (!authority.allowed) return authority;
  const approved = options.approvedPlanHash;
  const verified = verify(state, trusted, candidate, 1, 'afterHash', approved);
  if (!verified.allowed) return verified;
  const reverse = [...state.artifacts].reverse();
  try {
    for (const [index, artifact] of reverse.entries()) {
      options.persist?.({ ...state, approvedPlanHash: approved, transaction: { phase: 'rolling_back', nextStep: index, path: artifact.path } });
      restore(state.root, artifact);
      const file = resolveContained(state.root, artifact.path, { allowMissingLeaf: true });
      const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (hash(contents) !== artifact.beforeHash) throw new Error(`${artifact.path}のrollback後検証に失敗しました`);
      if (options.interruptAfterStep === index) throw Object.assign(new Error('模擬crash'), { simulatedCrash: true });
    }
  } catch (error) {
    const recovery = { ...state, state: 'recovery_required', approvedPlanHash: approved, transaction: { phase: 'rollback_interrupted' } };
    options.persist?.(recovery);
    if (simulatedCrash(error)) throw error;
    return { ...rejected([error instanceof Error ? error.message : String(error)]), journal: recovery };
  }
  const restored = verify({ ...state, revision: 2 }, trusted, candidate, 2, 'beforeHash', approved);
  if (!restored.allowed) return restored;
  const rolledBack = { ...state, state: 'rolled_back', revision: 2, history: [...state.history, 'rolled_back'], rollbackVerified: true, approvedPlanHash: approved, transaction: { phase: 'rolled_back', nextStep: 0 } };
  options.persist?.(rolledBack);
  return rolledBack;
}

/** @param {any} state @param {any} trusted @param {any} candidate */
/** @param {any} state @param {any} trusted @param {any} candidate @param {{approvedPlanHash?: string, expectedRevision?: number, persist?: (value: any) => void, interruptAfterStep?: number}} [options] */
export function retryFileMigration(state, trusted, candidate, options = {}) {
  const authority = requireExternalAuthority(state, options, 2);
  if (!authority.allowed) return authority;
  const approved = options.approvedPlanHash;
  const verified = verify(state, trusted, candidate, 2, 'beforeHash', approved);
  if (!verified.allowed) return verified;
  const reset = { ...state, revision: 0, history: state.history };
  const applied = applyFileMigration(reset, trusted, candidate, { ...options, approvedPlanHash: approved, expectedRevision: 0 });
  if (applied.allowed === false) return applied;
  const retried = { ...applied, revision: 3, history: [...state.history, 'applied'] };
  options.persist?.(retried);
  return retried;
}

/** Recover a journal left between writes. Mixed before/after files are rolled back; unknown hashes are rejected. @param {any} state @param {any} trusted @param {any} candidate @param {{approvedPlanHash?: string, expectedRevision?: number, persist?: (value: any) => void}} [options] */
export function recoverFileMigration(state, trusted, candidate, options = {}) {
  const authority = requireExternalAuthority(state, options, undefined);
  if (!authority.allowed) return authority;
  if (![0, 1].includes(state.revision)) return rejected([`recover対象revisionが不正です: ${state.revision}`]);
  const approved = options.approvedPlanHash;
  const structural = verify(state, trusted, candidate, /** @type {number} */ (options.expectedRevision), 'beforeHash', approved);
  const observed = [];
  for (const artifact of state.artifacts ?? []) {
    const file = resolveContained(state.root, artifact.path, { allowMissingLeaf: true });
    const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const currentHash = hash(contents);
    observed.push(currentHash === artifact.beforeHash ? 'before' : currentHash === artifact.afterHash ? 'after' : 'unknown');
  }
  if (observed.includes('unknown')) return { ...rejected(['journal回復中にbefore/afterのどちらでもないfileを検出しました']), journal: state };
  const structuralDiagnostic = /** @type {any} */ (structural).diagnostic;
  if (!approved || approved !== state.planFingerprint || structuralDiagnostic?.reasons?.some((/** @type {string} */ reason) => !reason.includes('計画後に変化'))) return structural;
  for (const artifact of [...state.artifacts].reverse()) restore(state.root, artifact);
  const recovered = { ...state, state: 'rolled_back', revision: 2, history: [...(state.history ?? []), 'recovered', 'rolled_back'], approvedPlanHash: approved, transaction: { phase: 'rolled_back', nextStep: 0 }, recovery: 'before/after hashからpartial transactionをrollbackした' };
  options.persist?.(recovered);
  return recovered;
}
