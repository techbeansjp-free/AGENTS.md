import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** ローカルモードのIssue毎データ配置のディレクトリ名（root直下 `issues/`）。doctorの
 * root直下汚染検査（`checkTrackedLocalStateAtRoot`）が参照する単一の正本でもある。 */
export const LOCAL_STATE_ROOT_DIR_NAME = 'issues';

export type CoordinationBackend = 'github' | 'local';

/**
 * Issue #399: GitHubモード（coordination.backend: github）でこれらの関数が呼ばれた場合の
 * 一時記録先。`gate-local-review.sh` 等の手動レビューツールはCI経由のCheck Run発行が
 * 機能しない/存在しない状態でもgate-reportを一時的に読み書きする必要があるが（PR #238の
 * 背景。前提のAIレビューゲートCI自体はIssue #386で削除済み）、GitHubモードの調整状態の
 * 正本はCheck Runのみである（I6）。リポジトリ作業ツリー内（root直下 `issues/`）へは
 * 一切書かず、os.tmpdir() 配下・リポジトリrootのsha256接頭辞で名前空間化した完全非追跡の
 * 場所を使う（過去にPR #238でこの root 直下パスがgit管理下へ誤commitされた実例がある）。
 */
function githubModeScratchRoot(root: string): string {
  const digest = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'agent-skill-chain-github-mode', digest);
}

/**
 * Issue毎データ配置。
 *
 * `backend` 省略時（既定 `local`）は、`schemas/gate-report.schema.yaml` /
 * `schemas/integration.schema.yaml` の examples が成果物パスとして `issues/123/SPEC.md` 等を
 * 示しているため、Issue 番号ディレクトリ `issues/<number>/` を成果物の配置先として踏襲する。
 * coordination 内部状態（state.yaml・writer lease・gate report・Integration Record）は成果物と
 * 混在させず `issues/<number>/.agent-skill-chain/` 配下に置く（AGENTS.md には配置先の明記が
 * 無いための進行役判断。既存の削除済み `.agent-skill-chain/` トップレベルディレクトリとは無関係）。
 *
 * `backend: 'github'` の場合は上記のリポジトリroot直下配置を使わず、`githubModeScratchRoot`
 * （os.tmpdir() 配下）を基点にする（Issue #399）。
 */
export function issueDir(root: string, issueNumber: string, backend: CoordinationBackend = 'local'): string {
  if (backend === 'github') {
    return path.join(githubModeScratchRoot(root), LOCAL_STATE_ROOT_DIR_NAME, issueNumber);
  }
  return path.join(root, LOCAL_STATE_ROOT_DIR_NAME, issueNumber);
}

function coordinationDir(root: string, issueNumber: string, backend: CoordinationBackend = 'local'): string {
  return path.join(issueDir(root, issueNumber, backend), '.agent-skill-chain');
}

export function stateFilePath(root: string, issueNumber: string, backend: CoordinationBackend = 'local'): string {
  return path.join(coordinationDir(root, issueNumber, backend), 'state.yaml');
}

export function leaseFilePath(root: string, issueNumber: string, backend: CoordinationBackend = 'local'): string {
  return path.join(coordinationDir(root, issueNumber, backend), 'lease.yaml');
}

export function integrationFilePath(
  root: string,
  issueNumber: string,
  backend: CoordinationBackend = 'local',
): string {
  return path.join(coordinationDir(root, issueNumber, backend), 'integration.yaml');
}

export function reviewFilePath(
  root: string,
  issueNumber: string,
  gateId: string,
  backend: CoordinationBackend = 'local',
): string {
  return path.join(coordinationDir(root, issueNumber, backend), 'reviews', `${gateId}.yaml`);
}

export function reportFilePath(
  root: string,
  issueNumber: string,
  segment: string,
  backend: CoordinationBackend = 'local',
): string {
  return path.join(coordinationDir(root, issueNumber, backend), 'reports', `${segment}.yaml`);
}
