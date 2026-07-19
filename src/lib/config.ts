import path from 'node:path';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset, repoRoot } from './paths.js';
import { validateAgainstSchema } from './schema.js';

export interface AgentSkillChainConfig {
  schema_version: string;
  coordination: { backend: 'github' | 'local' };
  durability: { backend: 'remote' | 'local_mirror' };
  autonomy: { default: 'gated' | 'full' };
  risk: { default: 'unclassified' | 'normal' | 'high' };
  review: {
    standard: { reviewer_count: number; modes: string[] };
    strict: { reviewer_count: number; trigger: { risk_not_normal: boolean; autonomy_full: boolean } };
  };
  worktree: {
    root: string;
    path_pattern: string;
    timestamp: { source: string; format: string; timezone: string };
    slug_max_length: number;
    immutable_path: boolean;
  };
  branch: { pattern: string };
  issue: { allowed_types: string[] };
  wip: { limit: number; count_by: string };
  lease: { ttl_seconds: number; renewal_interval_seconds: number };
  bdd: { profile: 'standard' | 'strict' };
  templates: { github_source: string; github_target: string; verify_sync: boolean };
  checks: { spec: string; design: string; implementation: string; validation: string };
}

let cached: { root: string; config: AgentSkillChainConfig } | undefined;

export function loadConfig(root: string = repoRoot()): AgentSkillChainConfig {
  if (cached && cached.root === root) return cached.config;
  const configPath = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), root);
  const config = readYamlFile<AgentSkillChainConfig>(configPath);
  const outcome = validateAgainstSchema('config', config, root);
  if (!outcome.valid) {
    throw new Error(
      `config/agent-skill-chain.yaml がスキーマ（agent-skill-chain/config/v1）に適合しません:\n` +
        outcome.errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
  cached = { root, config };
  return config;
}
