import path from "node:path";

export interface ReviewArtifactPath {
  readonly path: string;
  readonly changeType: "A" | "M" | "D";
}

/** lexical rootから期待する親とreal parentが一致し、repository内に留まることを判定する。 */
export function isReviewArtifactParentContained(
  lexicalRoot: string,
  realRoot: string,
  lexicalParent: string,
  realParent: string,
): boolean {
  const relative = path.relative(path.resolve(lexicalRoot), lexicalParent);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return false;
  return path.resolve(realRoot, relative) === realParent;
}

function escapeCell(value: string): string {
  return value
    .replaceAll("|", "｜")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

function replaceRow(content: string, label: string, value: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return content.replace(
    new RegExp(`^\\|[ \\t]*${escaped}[ \\t]*\\|[^\\n]*$`, "mu"),
    `| ${label} | ${escapeCell(value)} |`,
  );
}

/** reviewer判断を確定せず、Gitとstagingから導ける04欄だけを埋める。 */
export function renderReviewArtifactDraft(input: {
  readonly template: string;
  readonly staging: string;
  readonly stagingDigest: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly paths: readonly ReviewArtifactPath[];
}): string {
  let content = input.template;
  const targetPaths =
    input.paths.map((item) => item.path).join("、") || "差分なし";
  content = replaceRow(content, "対象", "実装");
  content = replaceRow(content, "ラウンド", "1");
  content = replaceRow(content, "対象SHA・文書ダイジェスト", input.headSha);
  content = replaceRow(content, "比較基点", `\`${input.baseSha}\``);
  content = replaceRow(content, "H_impl", `\`${input.headSha}\``);
  content = replaceRow(content, "対象差分", targetPaths);
  content = replaceRow(
    content,
    "対象外",
    "比較基点に存在し変更されていない範囲",
  );
  content = replaceRow(content, "残り予算", "3ラウンド");
  content = replaceRow(content, "ラウンド数", "0（review未実施）");
  content = replaceRow(content, "Step chain", `経由: ${input.staging}`);
  const auditRows = input.paths
    .map(
      (item) =>
        `| \`${escapeCell(item.path)}\` | ${item.changeType} | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | finding |`,
    )
    .join("\n");
  content = content.replace(
    /^\| （repository相対path） \| A \/ M \/ D \/ R \|[^\n]*$/mu,
    auditRows ||
      "| 差分なし | M | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | finding |",
  );
  const evidenceRows = [
    `| 要求・受け入れ条件 | ${escapeCell(input.staging)} | staging digest ${input.stagingDigest} | 既存コード |`,
    `| 差分 | \`${input.baseSha}\`..\`${input.headSha}\` | ${input.paths.length} path | 既存コード |`,
    "| テスト | reviewerが実行後に記録 | 未実行 | テスト出力 |",
    "| 仕様 | reviewerが確認後に記録 | unknown | 既存文書 |",
    `| commit前candidate | ${escapeCell(targetPaths)} | H_impl ${input.headSha} | Git index |`,
    "| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |",
    `| review session | ${escapeCell(input.staging)} | 未開始 | Git観測 |`,
  ].join("\n");
  content = content.replace(
    /^\| 要求・受け入れ条件 \| （URL・ID） \|[^\n]*(?:\n\| 差分 \|[^\n]*)?(?:\n\| テスト \|[^\n]*)?(?:\n\| 仕様 \|[^\n]*)?(?:\n\| commit前candidate \|[^\n]*)?(?:\n\| Phase A artifact \|[^\n]*)?(?:\n\| review session \|[^\n]*)?/mu,
    evidenceRows,
  );
  content = content.replace(
    /## 7\. テスト結果[\s\S]*?(?=\n## 8\. 配布物影響)/u,
    "## 7. テスト結果\n\n- 実行したcommandの一覧: 未実行（reviewerが実行後に記録）\n- 全layerの合計: 未実行（成功・失敗・skipは未確定）\n- runner・Gherkin方言: project choicesからreviewerが確認\n",
  );
  return content;
}
