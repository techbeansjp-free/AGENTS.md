import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { gh, git } from './exec.js';
import { readYamlFile } from './yaml-io.js';
import { validateAgainstSchema } from './schema.js';
import { defaultBranch } from './worktree.js';

export interface CoreReviewPolicy {
  required_profile: 'strict';
  unavailable: 'human_required';
  execution: {
    reviewer_location: 'local';
    evidence_transport: 'github_pr_review';
    ci_role: 'verify_and_publish';
    reviewer_count: 2;
    trusted_reviewer_actors: string[];
  };
  capability: {
    model_tier: 'frontier_coding';
    reasoning_tier: 'maximum_reasoning';
  };
  triggers: {
    github_label: 'review:core-audit';
    local_state_value: 'core_audit';
    exact_paths: string[];
    path_prefixes: string[];
  };
  adapters: {
    codex: {
      model: 'gpt-5.6-sol';
      reasoning_effort: 'xhigh';
      override_attestation_env: 'CODEX_CORE_REVIEWER_ATTESTED';
    };
    claude: {
      model_env: 'CLAUDE_CORE_REVIEW_MODEL';
      model_tier_env: 'CLAUDE_CORE_REVIEW_MODEL_TIER';
      reasoning_tier_env: 'CLAUDE_CORE_REVIEW_REASONING_TIER';
      reasoning_probe_env: 'CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD';
    };
    human: {
      behavior: 'human_required';
    };
  };
}

interface ProjectPolicyManifest {
  model_selection?: {
    ordinary: { behavior: 'explicit_selection' };
    core_review: CoreReviewPolicy;
  };
}

export interface CoreReviewDecision {
  required: boolean;
  status: 'resolved' | 'unresolved';
  reason: 'policy_absent' | 'ordinary' | 'explicit_core_audit' | 'core_path_changed' | 'classification_unavailable';
  changed_paths: string[];
  policy?: CoreReviewPolicy;
}

/** 現在の作業コピーに登録された project policy を検証し、コアレビュー契約を返す。 */
export function loadCoreReviewPolicy(root: string): CoreReviewPolicy | undefined {
  const manifestPath = path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) return undefined;

  const manifest = readYamlFile<ProjectPolicyManifest>(manifestPath);
  const validation = validateAgainstSchema('project-policy', manifest, root);
  if (!validation.valid) {
    throw new Error(`project policy manifest がスキーマに適合しません: ${validation.errors.join('; ')}`);
  }
  return manifest.model_selection?.core_review;
}

/** Issue #680: evidenceの信頼元はGitHub上の保護されたdefault branchから読む。 */
export function loadProtectedCoreReviewPolicy(root: string): CoreReviewPolicy | undefined {
  const repositoryResult = gh(['api', 'repos/{owner}/{repo}'], root);
  if (repositoryResult.status !== 0) {
    throw new Error(`GitHubからrepository情報を取得できません: ${repositoryResult.stderr.trim()}`);
  }

  let defaultBranchName: string;
  try {
    const repository = JSON.parse(repositoryResult.stdout) as { default_branch?: unknown };
    if (typeof repository.default_branch !== 'string' || repository.default_branch.length === 0) {
      throw new Error('default_branchが不正です');
    }
    defaultBranchName = repository.default_branch;
  } catch (error) {
    throw new Error(`GitHubのrepository情報を解釈できません: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifestResult = gh(
    [
      'api',
      `repos/{owner}/{repo}/contents/.agent-skill-chain/project/manifest.yaml?ref=${encodeURIComponent(defaultBranchName)}`,
    ],
    root,
  );
  if (manifestResult.status !== 0) {
    throw new Error(`GitHubのrepository default branchからproject policy manifestを取得できません: ${manifestResult.stderr.trim()}`);
  }

  let manifestText: string;
  try {
    const response = JSON.parse(manifestResult.stdout) as { content?: unknown; encoding?: unknown };
    if (response.encoding !== 'base64' || typeof response.content !== 'string') {
      throw new Error('contentまたはencodingが不正です');
    }
    const encoded = response.content.replaceAll(/\s/g, '');
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new Error('contentが正しいbase64ではありません');
    }
    manifestText = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`GitHubのproject policy manifest応答を解釈できません: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifest = parse(manifestText) as ProjectPolicyManifest;
  const validation = validateAgainstSchema('project-policy', manifest, root);
  if (!validation.valid) {
    throw new Error(`project policy manifest がスキーマに適合しません: ${validation.errors.join('; ')}`);
  }
  return manifest.model_selection?.core_review;
}

function resolveBaseRef(root: string, requested?: string): string | undefined {
  let raw = requested;
  if (!raw) {
    try {
      raw = defaultBranch(root);
    } catch {
      return undefined;
    }
  }

  const candidates = raw.startsWith('origin/') ? [raw, raw.slice('origin/'.length)] : [`origin/${raw}`, raw];
  for (const candidate of candidates) {
    if (git(['rev-parse', '--verify', candidate], root).status === 0) return candidate;
  }
  return undefined;
}

function matchesCorePath(policy: CoreReviewPolicy, changedPath: string): boolean {
  const normalized = changedPath.replaceAll(path.sep, '/');
  return (
    policy.triggers.exact_paths.includes(normalized) ||
    policy.triggers.path_prefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

/**
 * 明示監査区分と base...target の差分からコアレビュー要否を決める。
 * 差分を取得できない場合は非コアへ推測せず required/unresolved を返す。
 */
export function classifyCoreReview(
  root: string,
  options: { targetSha?: string; baseRef?: string; reviewSubject?: 'ordinary' | 'core_audit' } = {},
): CoreReviewDecision {
  const policy = loadCoreReviewPolicy(root);
  if (!policy) {
    return { required: false, status: 'resolved', reason: 'policy_absent', changed_paths: [] };
  }

  if (options.reviewSubject === policy.triggers.local_state_value) {
    return { required: true, status: 'resolved', reason: 'explicit_core_audit', changed_paths: [], policy };
  }

  // target SHA を受け取らない従来の read-only context 呼び出しは、分類を要求しない互換経路とする。
  if (!options.targetSha) {
    return { required: false, status: 'resolved', reason: 'ordinary', changed_paths: [], policy };
  }

  const base = resolveBaseRef(root, options.baseRef);
  if (!base || git(['rev-parse', '--verify', options.targetSha], root).status !== 0) {
    return {
      required: true,
      status: 'unresolved',
      reason: 'classification_unavailable',
      changed_paths: [],
      policy,
    };
  }

  const diff = git(['diff', '--name-only', `${base}...${options.targetSha}`], root);
  if (diff.status !== 0) {
    return {
      required: true,
      status: 'unresolved',
      reason: 'classification_unavailable',
      changed_paths: [],
      policy,
    };
  }

  const changedPaths = diff.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (changedPaths.some((entry) => matchesCorePath(policy, entry))) {
    return { required: true, status: 'resolved', reason: 'core_path_changed', changed_paths: changedPaths, policy };
  }
  return { required: false, status: 'resolved', reason: 'ordinary', changed_paths: changedPaths, policy };
}
