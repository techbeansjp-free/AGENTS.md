import { git } from './exec.js';
import { defaultBranch } from './worktree.js';

export interface SelfReferenceGuardrail {
  test: (path: string) => boolean;
  reason: string;
}

/** quick mode と review:light が共有する自己参照変更の安全側ガードレール。 */
export const GUARDRAIL_PATHS: readonly SelfReferenceGuardrail[] = [
  { test: (entry) => entry.startsWith('docs/adr/'), reason: '変更差分に docs/adr/ 配下（ADRを要する変更）が含まれます' },
  {
    test: (entry) => entry === '.agent-skill-chain/config/segments.yaml',
    reason: '変更差分に .agent-skill-chain/config/segments.yaml（セグメント定義）が含まれます',
  },
  { test: (entry) => entry === 'AGENTS.md', reason: '変更差分に AGENTS.md（不変条件の正本）が含まれます' },
  {
    test: (entry) => entry.startsWith('.agent-skill-chain/schemas/'),
    reason: '変更差分に .agent-skill-chain/schemas/ 配下（スキーマ定義）が含まれます',
  },
];

/** `git status --porcelain` の1行からパスを取り出す（rename は変更前後の両方を対象にする）。 */
function pathsFromPorcelainLine(line: string): string[] {
  const body = line.slice(3);
  const parts = body.includes(' -> ') ? body.split(' -> ') : [body];
  return parts.map((entry) => entry.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

export interface ChangedPaths {
  paths: string[];
  /** 差分を機械的に解決できたか。解決不能なら安全側へ倒す。 */
  resolvable: boolean;
}

/** baseとの差分と未コミット差分を合成し、自己参照ガードレールの入力を解決する。 */
export function changedPaths(worktreePath: string, targetRef = 'HEAD'): ChangedPaths {
  const paths: string[] = [];
  let resolvable = true;
  try {
    const base = defaultBranch(worktreePath);
    const diff = git(['diff', '--name-only', `${base}...${targetRef}`], worktreePath);
    if (diff.status !== 0) {
      resolvable = false;
    } else {
      paths.push(...diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean));
    }
  } catch {
    resolvable = false;
  }

  const status = git(['status', '--porcelain', '--untracked-files=all'], worktreePath);
  if (status.status !== 0) {
    resolvable = false;
  } else {
    for (const line of status.stdout.split('\n')) {
      if (line.trim()) paths.push(...pathsFromPorcelainLine(line));
    }
  }
  return { paths: [...new Set(paths)], resolvable };
}

/** 解決済みパス集合に該当する自己参照ガードレール理由を返す。 */
export function selfReferenceGuardrailReasons(paths: readonly string[]): string[] {
  return GUARDRAIL_PATHS.filter((guardrail) => paths.some(guardrail.test)).map((guardrail) => guardrail.reason);
}
