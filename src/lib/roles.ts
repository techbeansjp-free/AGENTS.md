import path from 'node:path';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset, repoRoot } from './paths.js';

// config/roles.yaml には専用スキーマが無いため（AGENTS.md §ディレクトリ構成参照）、
// ここでは必要な形だけを緩く型付けする。
export interface RolesDocument {
  schema_version: string;
  roles: Record<string, unknown>;
  adapters: Record<string, string>;
  role_contracts: Record<
    string,
    {
      inputs: string[];
      outputs: string[];
      rules: string[];
      completion: string[];
      forbidden: string[];
      unnecessary_knowledge?: string[];
    }
  >;
  blocked_report_schema: string;
}

export function loadRoles(root: string = repoRoot()): RolesDocument {
  const rolesPath = resolveAsset(path.join('config', 'roles.yaml'), root);
  return readYamlFile<RolesDocument>(rolesPath);
}
