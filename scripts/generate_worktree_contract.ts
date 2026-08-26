import fs from "node:fs";
import path from "node:path";
import {
  WORKTREE_NAME_FORMAT,
  WORKTREE_TIMESTAMP_MAX_AGE_MINUTES,
} from "../src/domain/worktree.js";

export const WORKTREE_CONTRACT_BEGIN = "<!-- 自動生成: worktree作成契約 -->";
export const WORKTREE_CONTRACT_END = "<!-- 自動生成ここまで -->";
export const WORKFLOW_DOCUMENT =
  ".agent-skill-chain/docs/01_開発ワークフロー.md";

export function renderWorktreeContract(): string {
  return [
    WORKTREE_CONTRACT_BEGIN,
    "",
    `\`worktree create\`は専用worktreeを\`.worktrees/\`の直接の子として作成する。directory名は\`${WORKTREE_NAME_FORMAT}\`とし、timestampは実行環境のlocal timeとして解釈する。未来のtimestampは猶予なく拒否し、現在時刻から${WORKTREE_TIMESTAMP_MAX_AGE_MINUTES}分を超えて古いtimestampも拒否する。**作成時点の実時刻と名前を拘束するためであり、過去に作った名前を後から再利用させない。** 現在時刻を観測できない場合はtimestamp検証を省略せずfail-closedで拒否する。`,
    "",
    "`--path`は省略できる。省略時は同じ現在時刻、Issue番号、slugから規定名を構成する。明示する場合はrepository相対pathで指定する。**明示pathはGit内部領域などのtrusted boundaryを最初に評価し、その後で配置、directory名、timestamp、Issue番号、slugを検証する。** 境界違反は不足入力より先に報告する。",
    "",
    "`worktree survey`はdirectory名とbranch名のIssue番号・slugの不一致を報告するが、分類も削除判断も変えず、既存directoryを改名しない。",
    "",
    WORKTREE_CONTRACT_END,
  ].join("\n");
}

export function extractWorktreeContract(text: string): string | undefined {
  const begin = text.indexOf(WORKTREE_CONTRACT_BEGIN);
  if (begin === -1) return undefined;
  const end = text.indexOf(WORKTREE_CONTRACT_END, begin);
  if (end === -1) return undefined;
  return text.slice(begin, end + WORKTREE_CONTRACT_END.length);
}

export function applyWorktreeContract(root: string): {
  changed: boolean;
  errors: string[];
} {
  const file = path.resolve(root, WORKFLOW_DOCUMENT);
  if (!fs.existsSync(file))
    return { changed: false, errors: [`${WORKFLOW_DOCUMENT}がありません`] };
  const text = fs.readFileSync(file, "utf8");
  const current = extractWorktreeContract(text);
  if (current === undefined)
    return {
      changed: false,
      errors: [
        `${WORKFLOW_DOCUMENT}に自動生成markerがありません: ${WORKTREE_CONTRACT_BEGIN}`,
      ],
    };
  const rendered = renderWorktreeContract();
  if (current === rendered) return { changed: false, errors: [] };
  fs.writeFileSync(file, text.replace(current, rendered));
  return { changed: true, errors: [] };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const result = applyWorktreeContract(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
