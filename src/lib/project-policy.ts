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
 * 現在の作業コピーに登録された project policy 文書を検証して読み込む。
 * manifest がない consumer project は、従来どおり追加のポリシーなしで動作する。
 */
export function loadProjectPolicyDocuments(root: string, segment: string): string[] {
  const projectDir = path.join(root, '.agent-skill-chain', 'project');
  const manifestPath = path.join(projectDir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) return [];

  const manifest = readYamlFile<ProjectPolicyManifest>(manifestPath);
  const validation = validateAgainstSchema('project-policy', manifest, root);
  if (!validation.valid) {
    throw new Error(`project policy manifest がスキーマに適合しません: ${validation.errors.join('; ')}`);
  }

  const documentPaths = [...manifest.documents.common, ...(manifest.documents.roles[segment] ?? [])];
  return documentPaths.map((documentPath) => fs.readFileSync(path.join(projectDir, documentPath), 'utf8'));
}
