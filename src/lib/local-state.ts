import path from 'node:path';

/**
 * ローカルモードの Issue 毎データ配置。
 *
 * `schemas/gate-report.schema.yaml` / `schemas/integration.schema.yaml` の examples が
 * 成果物パスとして `issues/123/SPEC.md` 等を示しているため、Issue 番号ディレクトリ
 * `issues/<number>/` を成果物の配置先として踏襲する。coordination 内部状態
 * （state.yaml・writer lease・gate report・Integration Record）は成果物と混在させず
 * `issues/<number>/.agent-skill-chain/` 配下に置く（AGENTS.md には配置先の明記が無いための
 * 進行役判断。既存の削除済み `.agent-skill-chain/` トップレベルディレクトリとは無関係）。
 */
export function issueDir(root: string, issueNumber: string): string {
  return path.join(root, 'issues', issueNumber);
}

function coordinationDir(root: string, issueNumber: string): string {
  return path.join(issueDir(root, issueNumber), '.agent-skill-chain');
}

export function stateFilePath(root: string, issueNumber: string): string {
  return path.join(coordinationDir(root, issueNumber), 'state.yaml');
}

export function leaseFilePath(root: string, issueNumber: string): string {
  return path.join(coordinationDir(root, issueNumber), 'lease.yaml');
}

export function integrationFilePath(root: string, issueNumber: string): string {
  return path.join(coordinationDir(root, issueNumber), 'integration.yaml');
}

export function reviewFilePath(root: string, issueNumber: string, gateId: string): string {
  return path.join(coordinationDir(root, issueNumber), 'reviews', `${gateId}.yaml`);
}

export function reportFilePath(root: string, issueNumber: string, segment: string): string {
  return path.join(coordinationDir(root, issueNumber), 'reports', `${segment}.yaml`);
}
