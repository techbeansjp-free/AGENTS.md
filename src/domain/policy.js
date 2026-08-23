import fs from 'node:fs';
import path from 'node:path';
import { git } from '../lib/process.js';

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
  rejectUnknownKeys(policy, ['schemaVersion', 'delivery', 'merge'], 'policy', errors);
  rejectUnknownKeys(policy?.delivery, ['stopAt'], 'delivery', errors);
  rejectUnknownKeys(policy?.merge, ['mode', 'branches', 'methods', 'requiredChecks', 'requiredReviews'], 'merge', errors);
  if (policy?.schemaVersion !== 'agent-skill-chain/project-policy/v0.3') errors.push('schemaVersionが不正です');
  if (policy?.delivery?.stopAt !== 'pull_request') errors.push('delivery.stopAtはpull_requestでなければなりません');
  if (!['disabled', 'assisted', 'automatic'].includes(policy?.merge?.mode)) errors.push('merge.modeが不正です');
  validateStringArray(policy?.merge?.branches, 'merge.branches', errors, { max: 32 });
  validateStringArray(policy?.merge?.methods, 'merge.methods', errors, { allowed: ['merge', 'squash', 'rebase'] });
  validateStringArray(policy?.merge?.requiredChecks, 'merge.requiredChecks', errors);
  if (!Number.isInteger(policy?.merge?.requiredReviews) || policy.merge.requiredReviews < 0 || policy.merge.requiredReviews > 20) errors.push('merge.requiredReviewsが不正です');
  const forbidden = ['deleteBranch', 'closeIssue', 'release', 'finalize', 'cleanup'];
  for (const key of forbidden) if (policy?.merge?.[key] === true) errors.push(`マージ権限へ${key}を含めてはいけません`);
  return { valid: errors.length === 0, errors };
}

/** @param {string} root @param {string} defaultBranch */
export function loadTrustedPolicy(root, defaultBranch) {
  const ref = `origin/${defaultBranch}`;
  const result = git(['show', `${ref}:.agent-skill-chain/project-policy.json`], root, { allowFailure: true });
  if (result.status !== 0) throw new Error(`${ref}に信頼済みポリシーがありません`);
  const policy = JSON.parse(result.stdout);
  const validation = validatePolicy(policy);
  if (!validation.valid) throw new Error(`信頼済みポリシーが不正です: ${validation.errors.join('; ')}`);
  return policy;
}

/** @param {string} root */
export function loadConsumerPolicy(root) {
  const file = path.join(root, '.agent-skill-chain', 'project-policy.json');
  if (!fs.existsSync(file)) return undefined;
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validatePolicy(policy);
  if (!validation.valid) throw new Error(`利用側ポリシーが不正です: ${validation.errors.join('; ')}`);
  return policy;
}
