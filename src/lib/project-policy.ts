import fs from 'node:fs';
import path from 'node:path';
import { validateAgainstSchema } from './schema.js';
import { readYamlFile } from './yaml-io.js';

interface ProjectPolicyManifest {
  documents: {
    common: string[];
    roles: Record<string, string[] | undefined>;
  };
}

/**
 * 登録パス documentPath を projectDir 基点で解決し、字句・symlink実体の両面で
 * projectDir 配下に留まることを検証したうえで、実体パス（realpath相当）を返す。
 * ISSUE-326 AC-7: 絶対パス・`../` 脱出・symlink脱出のいずれも fail-closed（例外送出）で拒否する。
 */
export function resolveContainedDocumentPath(projectDir: string, documentPath: string): string {
  if (path.isAbsolute(documentPath)) {
    throw new Error(`project policy 文書パスは相対パスである必要があります（絶対パス指定は許可されません）: ${documentPath}`);
  }

  const resolved = path.resolve(projectDir, documentPath);
  const lexicalRelative = path.relative(projectDir, resolved);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw new Error(`project policy 文書パスが .agent-skill-chain/project/ の範囲外を指しています: ${documentPath}`);
  }

  // realpathSync は symlink を解決すると同時に、実体が存在しない場合は ENOENT を送出する
  // （AC-6: 登録文書の実体欠落時のfail-safeを兼ねる）。
  const realProjectDir = fs.realpathSync(projectDir);
  const realResolved = fs.realpathSync(resolved);
  const realRelative = path.relative(realProjectDir, realResolved);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`project policy 文書パスの実体（symlink解決後）が .agent-skill-chain/project/ の範囲外を指しています: ${documentPath}`);
  }

  return realResolved;
}

/**
 * 現在の作業コピーに登録された project policy 文書を検証して読み込む。
 * manifest がない consumer project は、従来どおり追加のポリシーなしで動作する。
 */
export function loadProjectPolicyDocuments(root: string, segment: string): string[] {
  const projectDir = path.join(root, '.agent-skill-chain', 'project');
  const manifestPath = path.join(projectDir, 'manifest.yaml');

  let manifest: ProjectPolicyManifest;
  try {
    manifest = readYamlFile<ProjectPolicyManifest>(manifestPath);
  } catch (error) {
    // ENOENT（manifest.yaml不在）のみ AC-3 の後方互換経路（[]）へ吸収する。
    // EACCES 等の他のエラーは自ら捕捉せず呼び出し元へ伝播させ、guard() が非0終了コードへ
    // 正規化する既存の共通経路に委ねる（AC-4(c): fail-openにしない）。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const validation = validateAgainstSchema('project-policy', manifest, root);
  if (!validation.valid) {
    throw new Error(`project policy manifest がスキーマに適合しません: ${validation.errors.join('; ')}`);
  }

  const documentPaths = [...manifest.documents.common, ...(manifest.documents.roles[segment] ?? [])];
  const seenRealPaths = new Set<string>();
  const contents: string[] = [];
  for (const documentPath of documentPaths) {
    const realPath = resolveContainedDocumentPath(projectDir, documentPath);
    if (seenRealPaths.has(realPath)) continue; // AC-8: 実体パス単位で重複排除する
    seenRealPaths.add(realPath);
    contents.push(fs.readFileSync(realPath, 'utf8'));
  }
  return contents;
}
