import { gh } from './exec.js';

export interface OpenPrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface OpenPr {
  number: number;
  headRefName: string;
  files: OpenPrFile[];
}

/**
 * branch を head とする、状態が OPEN の PR を1件探す。存在しなければ undefined
 * （新規作成、または再利用不可＝呼び出し側が human_required とする材料になる）。
 *
 * release bump（Issue #196）・root-cleanup run（Issue #208）が共通で用いる、admin merge直前の
 * スコープ検査に必要な「既存ブランチ/PRの冪等な再利用」判定の基盤。
 */
export function findOpenPrByHead(root: string, branch: string): OpenPr | undefined {
  const result = gh(['pr', 'view', branch, '--json', 'number,state,headRefName,files'], root);
  if (result.status !== 0) return undefined;
  try {
    const data = JSON.parse(result.stdout) as {
      number: number;
      state: string;
      headRefName: string;
      files: OpenPrFile[];
    };
    if (data.state !== 'OPEN') return undefined;
    return { number: data.number, headRefName: data.headRefName, files: data.files };
  } catch {
    return undefined;
  }
}
