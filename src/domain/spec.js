import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishDirectoryAtomic } from '../lib/atomic.js';

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.agent-skill-chain/templates/specs');
const UI_CATEGORIES = new Set(['05_画面', '17_デザイン', '18_レイアウト']);
const UI_PROJECT_KINDS = new Set(['ui', 'theme', 'responsive', 'design-system']);
const PROJECT_KINDS = new Set(['cli', 'api', 'service', 'library', 'batch', 'data', ...UI_PROJECT_KINDS]);
const REQUIRED = [
  '00_仕様書構成/00_仕様書索引.md',
  '01_システム概要/00_概要.md',
  '02_要件/00_要件一覧.md',
  '03_アーキテクチャ/00_全体構成.md',
  '04_機能/00_機能一覧.md',
  '06_外部インターフェース/00_インターフェース一覧.md',
  '07_データ/00_データ一覧.md',
  '08_バッチ・ジョブ/00_ジョブ一覧.md',
  '09_基盤・ネットワーク/00_環境・基盤一覧.md',
  '10_セキュリティ/00_セキュリティ方針・資産.md',
  '11_非機能/00_非機能要件一覧.md',
  '12_運用保守/00_運用設計.md',
  '13_移行・廃止/00_移行計画.md',
  '14_開発・品質/00_ディレクトリ構成.md',
  '14_開発・品質/01_コーディング標準.md',
  '14_開発・品質/02_テスト標準.md',
  '15_要件追跡/00_追跡表.md',
  '16_参照資料/00_官公庁一次資料台帳.md',
];

/** @param {string} root @param {string} [relative] @returns {string[]} */
function listTemplateFiles(root, relative = '') {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) throw new Error('system specification templateがpackage内にありません');
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'ja')).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`system specification templateにsymbolic linkは使用できません: ${path.join(relative, entry.name)}`);
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return listTemplateFiles(root, child);
    if (!entry.isFile()) throw new Error(`system specification templateに未対応のentryがあります: ${child}`);
    return [child];
  });
}

/** @param {'cli'|'api'|'service'|'library'|'batch'|'data'|'ui'|'theme'|'responsive'|'design-system'} projectKind */
function selectedTemplateFiles(projectKind) {
  if (!PROJECT_KINDS.has(projectKind)) throw new Error('project kindが不正です');
  const withUi = UI_PROJECT_KINDS.has(projectKind);
  return listTemplateFiles(templateRoot).filter((relative) => withUi || !UI_CATEGORIES.has(relative.split(path.sep)[0]));
}

/** @param {string} root @param {{apply: boolean, newProject: boolean, onboardExisting?: boolean, projectKind: 'cli'|'api'|'service'|'library'|'batch'|'data'|'ui'|'theme'|'responsive'|'design-system'}} options */
export function bootstrapProject(root, options) {
  const meaningfulEntries = fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name !== '.git') : [];
  if (!options.newProject && !options.onboardExisting) throw new Error('初期生成には--new-projectまたは明示的な--onboard-existing承認が必要です');
  if (options.newProject && meaningfulEntries.length > 0 && !options.onboardExisting) throw new Error('既存内容があるため--new-projectとして扱えません。明示的な導入承認が必要です');
  const specs = path.join(root, 'docs', 'specs');
  const planned = selectedTemplateFiles(options.projectKind);
  const withTokens = UI_PROJECT_KINDS.has(options.projectKind);
  if (!options.apply) return { applied: false, planned, tokenSpecs: withTokens };
  if (fs.existsSync(specs)) throw new Error('docs/specsは既に存在します。利用側所有資産を上書きしません');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  publishDirectoryAtomic(specs, (temporary) => {
    for (const relative of planned) {
      const destination = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(templateRoot, relative), destination, fs.constants.COPYFILE_EXCL);
    }
  });
  return { applied: true, planned, tokenSpecs: withTokens };
}

/** @param {string} root @param {{changedFiles?: string[], review?: {specImpact?: string, rationale?: string, trace?: {requirements?: string[], scenarios?: string[], tests?: string[]}}}} [options] */
export function validateSpecs(root, options = {}) {
  const errors = [];
  const specs = path.join(root, 'docs', 'specs');
  for (const name of REQUIRED) {
    const file = path.join(specs, name);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) errors.push(`必須仕様がありません: ${name}`);
  }
  const registry = path.join(specs, '16_参照資料', '00_官公庁一次資料台帳.md');
  if (fs.existsSync(registry)) {
    const registryText = fs.readFileSync(registry, 'utf8');
    for (const field of ['文書名', '公開者', '公式URL', '位置づけ', '採否', '取得日', '版・更新日', 'ライセンス', '帰属表示', '加工内容', '採否理由']) {
      if (!registryText.includes(field)) errors.push(`一次資料台帳の項目がありません: ${field}`);
    }
  }
  const changes = options.changedFiles ?? [];
  const requiresSpecUpdate = changes.some((file) => {
    const normalized = file.replaceAll('\\', '/');
    return /^(?:src|bin)\//.test(normalized)
      || /^(?:package(?:-lock)?\.json|\.github\/workflows\/)/.test(normalized)
      || /^\.agent-skill-chain\/(?:docs|skills|templates|schemas|policy)\//.test(normalized)
      || /(^|\/)architecture(\/|\.|$)/i.test(normalized);
  });
  if (changes.length > 0 && !options.review?.specImpact) errors.push('仕様影響が不明です');
  if (requiresSpecUpdate && options.review?.specImpact !== 'updated') errors.push('振る舞い・構造・安全・policyへ影響する変更には仕様更新が必要です');
  if (options.review?.specImpact === 'updated') {
    const trace = options.review.trace;
    if (!trace?.requirements?.length || !trace?.scenarios?.length || !trace?.tests?.length) errors.push('更新した仕様には要件・シナリオ・テストの追跡が必要です');
  }
  if (options.review?.specImpact === 'no-spec-impact' && (!options.review.rationale || options.review.rationale.trim().length < 12)) {
    errors.push('no-spec-impactには対象範囲を限定した根拠が必要です');
  }
  return { valid: errors.length === 0, errors };
}

export { REQUIRED as requiredSpecFiles };
