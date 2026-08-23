import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from '../src/lib/process.js';

const AUDIT_PATH = 'docs/reviews/01_課題834実装レビュー.md';

/** @param {string} markdown */
export function parseFileAudit(markdown) {
  const base = /\| 比較基点 \| `([a-f0-9]{40})` \|/iu.exec(markdown)?.[1];
  const implementation = /\| H_impl \| `([a-f0-9]{40})` \|/iu.exec(markdown)?.[1];
  const section = markdown.split('## 変更ファイル個別監査')[1]?.split('\n## ')[0] ?? '';
  const entries = [];
  for (const line of section.split(/\r?\n/u)) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 9 || !/^\x60[^\x60]+\x60$/u.test(cells[0]) || !['A', 'M', 'D'].includes(cells[1])) continue;
    entries.push({ path: cells[0].slice(1, -1), status: cells[1], fields: cells.slice(2, 8), decision: cells[8] });
  }
  return { base, implementation, entries };
}

/** @param {string} root */
export function checkFileAudit(root) {
  const errors = [];
  const artifact = path.join(root, AUDIT_PATH);
  if (!fs.existsSync(artifact)) return { valid: false, errors: [`${AUDIT_PATH}がありません`] };
  const parsed = parseFileAudit(fs.readFileSync(artifact, 'utf8'));
  if (!parsed.base || !parsed.implementation) return { valid: false, errors: ['比較基点またはH_implの完全SHAがありません'] };
  for (const oid of [parsed.base, parsed.implementation]) {
    const resolved = git(['rev-parse', '--verify', `${oid}^{commit}`], root, { allowFailure: true });
    if (resolved.status !== 0 || resolved.stdout.trim() !== oid) errors.push(`固定commitを解決できません: ${oid}`);
  }
  if (parsed.base === parsed.implementation) errors.push('比較基点とH_implは異なるcommitでなければなりません');
  const baseAncestry = git(['merge-base', '--is-ancestor', parsed.base, parsed.implementation], root, { allowFailure: true });
  if (baseAncestry.status !== 0) errors.push('比較基点がH_implのancestorではありません');
  const expected = git(['-c', 'core.quotepath=false', 'diff', '--name-status', `${parsed.base}..${parsed.implementation}`, '--'], root).stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [status, ...parts] = line.split('\t');
    return { status: status[0], path: parts.at(-1) };
  });
  const expectedKeys = expected.map((entry) => `${entry.status}\u0000${entry.path}`).sort();
  const actualKeys = parsed.entries.map((entry) => `${entry.status}\u0000${entry.path}`).sort();
  if (new Set(actualKeys).size !== actualKeys.length) errors.push('個別監査に重複pathがあります');
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) errors.push(`個別監査とGit差分path集合が一致しません: expected=${expected.length} actual=${parsed.entries.length}`);
  for (const entry of parsed.entries) {
    if (entry.fields.some((field) => field === '' || field === '-')) errors.push(`${entry.path}のowner・layer・責務・依存・追跡・安全性に空欄があります`);
    if (entry.decision !== 'pass') errors.push(`${entry.path}の個別判定がpassではありません`);
  }
  const current = git(['rev-parse', 'HEAD'], root).stdout.trim();
  const ancestry = git(['merge-base', '--is-ancestor', parsed.implementation, current], root, { allowFailure: true });
  if (ancestry.status !== 0) errors.push('H_implがcurrent HEADのancestorではありません');
  const finalPaths = git(['-c', 'core.quotepath=false', 'diff', '--name-only', `${parsed.implementation}..${current}`, '--'], root).stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (finalPaths.length !== 1 || finalPaths[0] !== AUDIT_PATH) errors.push(`H_impl..currentはreview artifactだけでなければなりません: ${finalPaths.join(',')}`);
  return { valid: errors.length === 0, errors, base: parsed.base, implementation: parsed.implementation, current, auditedFiles: parsed.entries.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkFileAudit(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
