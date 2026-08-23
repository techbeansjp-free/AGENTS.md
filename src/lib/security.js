import fs from 'node:fs';
import path from 'node:path';

const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** @param {string} title */
export function safeSlug(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('タイトルが必要です');
  const normalized = title.normalize('NFC').trim();
  if (CONTROL.test(normalized)) throw new Error('タイトルに制御文字または書式文字が含まれています');
  if (path.isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    throw new Error('タイトルにパス構文を含めてはいけません');
  }
  const slug = normalized.replace(/\s+/gu, '-').replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/-+/g, '-');
  if (!slug || slug === '.' || slug === '..' || slug.length > 80) throw new Error('タイトルを安全で長さ制限内のslugへ変換できません');
  return slug;
}

/** @param {string} root @param {string} candidate @param {{allowMissingLeaf?: boolean}} [options] */
export function resolveContained(root, candidate, options = {}) {
  if (!candidate || path.isAbsolute(candidate) || CONTROL.test(candidate)) throw new Error('パスは安全な相対パスでなければなりません');
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, candidate);
  const relative = path.relative(rootPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('パストラバーサルを拒否しました');
  const realRoot = fs.realpathSync(rootPath);
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('既存のパス境界がありません');
    existing = parent;
  }
  if (!options.allowMissingLeaf && existing !== resolved) throw new Error('パスが存在しません');
  const realExisting = fs.realpathSync(existing);
  const realRelative = path.relative(realRoot, realExisting);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error('シンボリックリンクによる境界外移動を拒否しました');
  }
  return resolved;
}

/** @param {string} input */
export function redactSecrets(input) {
  return String(input)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*[^\s]+/gi, '[REDACTED_SECRET]');
}

/** @param {unknown} value @returns {string} */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
