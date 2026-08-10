import fs from 'node:fs';
import path from 'node:path';
import { resolveAsset } from './paths.js';

const PROJECT_ID_PLACEHOLDER = '__PROJECT_ID__';

export interface ProjectPolicyScaffoldResult {
  /**
   * `created`: `manifest.yaml`・`RULES.md` を新規に書き込んだ（dryRun時は書込みを伴わない予定）。
   * `unchanged`: `manifest.yaml` が既に存在したため何も行わなかった（要件6・AC-6）。
   */
  action: 'created' | 'unchanged';
  manifestPath: string;
  rulesPath: string;
}

/**
 * `.agent-skill-chain/project/manifest.yaml` の存在を「scaffold適用済み」の唯一のシグナルとして
 * 検査し、不在の場合にのみ `project-policy テンプレート資産`（`.agent-skill-chain/templates/
 * project-policy/`）から `manifest.yaml`・`RULES.md` を生成する（DESIGN.md 設計要素
 * `project-policy-scaffold`）。生成したファイルは `src/lib/ownership-record.ts` の所有権記録へ
 * 一切登録しない（`upgrade`/`uninstall` の不可侵・保持という既存不変条件を構造的に維持するため、
 * AC-3・AC-4）。
 *
 * 書込み順序は `RULES.md` → `manifest.yaml` とし、`manifest.yaml` の存在を完了マーカーとして
 * 扱う（DESIGN.md 障害・ロールバック考慮(a)）。中断により `RULES.md` のみ書込み済みで
 * `manifest.yaml` が未書込みの状態が残った場合、次回実行時は `manifest.yaml` 不在と判定され
 * 両ファイルが再生成される。
 */
export function scaffoldProjectPolicy(
  targetDir: string,
  options: { dryRun?: boolean } = {},
): ProjectPolicyScaffoldResult {
  const projectDir = path.join(targetDir, '.agent-skill-chain', 'project');
  const manifestPath = path.join(projectDir, 'manifest.yaml');
  const rulesPath = path.join(projectDir, 'RULES.md');

  if (fs.existsSync(manifestPath)) {
    return { action: 'unchanged', manifestPath, rulesPath };
  }

  if (options.dryRun) {
    return { action: 'created', manifestPath, rulesPath };
  }

  const manifestSrc = resolveAsset(path.join('templates', 'project-policy', 'manifest.yaml'), targetDir);
  const rulesSrc = resolveAsset(path.join('templates', 'project-policy', 'RULES.md'), targetDir);
  const manifestTemplate = fs.readFileSync(manifestSrc, 'utf8');
  const rulesContent = fs.readFileSync(rulesSrc, 'utf8');

  // project.id のプレースホルダ（__PROJECT_ID__）を導入先ディレクトリ名へ置換する。
  const projectId = path.basename(targetDir);
  const manifestContent = manifestTemplate.split(PROJECT_ID_PLACEHOLDER).join(projectId);

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(rulesPath, rulesContent, 'utf8');
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');

  return { action: 'created', manifestPath, rulesPath };
}
