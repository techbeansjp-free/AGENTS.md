import path from "node:path";
import { distributedPaths } from "./conformance.js";
import { matchesStagingRoot, readStagingLayout } from "./staging-layout.js";

export interface ReviewArtifactPath {
  readonly path: string;
  readonly changeType: "A" | "M" | "D";
}

export interface ReviewIdentityAnchor {
  readonly base: string;
  readonly implementation: string;
}

export interface ReviewArtifactAuditEntry {
  readonly path: string;
  readonly status: string;
  readonly fields: readonly string[];
  readonly decision: string;
}

export interface ReviewArtifactDiagnostic {
  readonly code: string;
  readonly line: number;
  readonly expected: string;
  readonly message: string;
}

export interface ReviewArtifactStructure {
  readonly base: string | undefined;
  readonly implementation: string | undefined;
  readonly rounds: number | undefined;
  readonly stepChain:
    Readonly<{ kind: "via" | "bypass"; detail: string }> | undefined;
  readonly auditEntries: readonly ReviewArtifactAuditEntry[];
  readonly diagnostics: readonly ReviewArtifactDiagnostic[];
}

export interface ContextIsolatedApprovalRecord {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const REVIEW_IDENTITY_HEADING = "## 0. レビュー識別情報";
const IDENTITY_BASE_EXPECTED = "| 比較基点 | `<40桁の小文字hex>` |";
const IDENTITY_IMPL_EXPECTED = "| H_impl | `<40桁の小文字hex>` |";
const AUDIT_HEADER =
  "| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |";
const AUDIT_ROW_EXPECTED =
  "| `<repository相対path>` | A / M / D / R | <owner> | <target layer> | <責務> | <依存> | <追跡> | <安全性> | pass / finding |";
const REQUIRED_HEADINGS = Object.freeze([
  REVIEW_IDENTITY_HEADING,
  "## 1. 入力証拠",
  "### 1.1 変更ファイル個別監査",
  "## 2. 受け入れ条件の確認",
  "## 3. 肯定的評価",
  "## 4. 敵対的評価",
  "## 5. 指摘",
  "## 6. ラウンド固有の確認",
  "## 7. テスト結果",
  "## 8. 配布物影響",
  "## 9. 独立reviewの成立",
  "## 10. 仕様整合性",
  "## 11. 総合判定と再開地点",
]);

/** Markdown fence内を空行へ置換し、行番号を維持したまま構造だけを読む。 */
export function visibleMarkdownLines(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  let fence: { character: "`" | "~"; length: number } | undefined;
  return lines.map((line) => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(?:[^`]*)$/u.exec(line)?.[1];
    if (delimiter !== undefined) {
      const character = delimiter[0] as "`" | "~";
      if (fence === undefined) fence = { character, length: delimiter.length };
      else if (
        fence.character === character &&
        delimiter.length >= fence.length &&
        new RegExp(`^ {0,3}${character}{${fence.length},} *$`, "u").test(line)
      )
        fence = undefined;
      return "";
    }
    return fence === undefined ? line : "";
  });
}

function sectionRange(
  lines: readonly string[],
  heading: string,
): { start: number; end: number } | undefined {
  const starts = lines
    .map((line, index) => (line === heading ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return undefined;
  const start = starts[0]!;
  const level = heading.startsWith("### ") ? 3 : 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (
      level === 2
        ? /^## /u.test(lines[index]!)
        : /^#{2,3} /u.test(lines[index]!)
    ) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function exactIdentityValue(
  lines: readonly string[],
  range: { start: number; end: number } | undefined,
  label: "比較基点" | "H_impl",
): { value?: string; line: number; count: number } {
  if (range === undefined) return { line: 1, count: 0 };
  const labelPattern = new RegExp(`^\\| ${label} \\|`, "u");
  const exactPattern =
    label === "比較基点"
      ? /^\| 比較基点 \| `([a-f0-9]{40})` \|$/u
      : /^\| H_impl \| `([a-f0-9]{40})` \|$/u;
  const candidates = lines
    .slice(range.start + 1, range.end)
    .map((line, offset) => ({ line, index: range.start + 1 + offset }))
    .filter((entry) => labelPattern.test(entry.line));
  const exact = candidates.filter((entry) => exactPattern.test(entry.line));
  return {
    value:
      candidates.length === 1 && exact.length === 1
        ? exactPattern.exec(exact[0]!.line)?.[1]
        : undefined,
    line: (candidates[0]?.index ?? range.start) + 1,
    count: candidates.length,
  };
}

function identityCell(
  lines: readonly string[],
  range: { start: number; end: number } | undefined,
  label: string,
): { value?: string; line: number; count: number } {
  if (range === undefined) return { line: 1, count: 0 };
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^\\| ${escaped} \\| ([^|]+) \\|$`, "u");
  const labelPattern = new RegExp(`^\\| ${escaped} \\|`, "u");
  const candidates = lines
    .slice(range.start + 1, range.end)
    .map((line, offset) => ({ line, index: range.start + 1 + offset }))
    .filter((entry) => labelPattern.test(entry.line));
  return {
    value:
      candidates.length === 1
        ? pattern.exec(candidates[0]!.line)?.[1]?.trim()
        : undefined,
    line: (candidates[0]?.index ?? range.start) + 1,
    count: candidates.length,
  };
}

function parseAuditRow(line: string): ReviewArtifactAuditEntry | undefined {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (
    cells.length !== 9 ||
    !/^`[^`]+`$/u.test(cells[0]!) ||
    !["A", "M", "D", "R"].includes(cells[1]!) ||
    cells.slice(2).some((cell) => cell === "")
  )
    return undefined;
  return {
    path: cells[0]!.slice(1, -1),
    status: cells[1]!,
    fields: cells.slice(2, 8),
    decision: cells[8]!,
  };
}

export function parseReviewArtifactAudit(markdown: string): Readonly<{
  base: string | undefined;
  implementation: string | undefined;
  rounds: number | undefined;
  stepChain: Readonly<{ kind: "via" | "bypass"; detail: string }> | undefined;
  entries: readonly ReviewArtifactAuditEntry[];
}> {
  const lines = visibleMarkdownLines(markdown);
  const identity = sectionRange(lines, REVIEW_IDENTITY_HEADING);
  const base = exactIdentityValue(lines, identity, "比較基点").value;
  const implementation = exactIdentityValue(lines, identity, "H_impl").value;
  const roundsText = identityCell(lines, identity, "ラウンド数").value;
  const leadingRound = /^(\d+)/u.exec(roundsText ?? "")?.[1];
  const rounds = leadingRound === undefined ? undefined : Number(leadingRound);
  const chainText = identityCell(lines, identity, "Step chain").value;
  const chainMatch = /^(経由|迂回) *[:：] *(.+)$/u.exec(chainText ?? "");
  const stepChain = chainMatch
    ? {
        kind: chainMatch[1] === "経由" ? ("via" as const) : ("bypass" as const),
        detail: chainMatch[2]!.trim(),
      }
    : undefined;
  const audit =
    sectionRange(lines, "### 1.1 変更ファイル個別監査") ??
    sectionRange(lines, "## 変更ファイル個別監査");
  const entries: ReviewArtifactAuditEntry[] = [];
  if (audit !== undefined)
    for (const line of lines.slice(audit.start + 1, audit.end)) {
      const entry = parseAuditRow(line);
      if (entry !== undefined) entries.push(entry);
    }
  return { base, implementation, rounds, stepChain, entries };
}

/** review artifactから機械導出される2つの正規identity cellを一意に読む。 */
export function parseReviewIdentityAnchor(
  markdown: string,
): ReviewIdentityAnchor | undefined {
  const parsed = parseReviewArtifactAudit(markdown);
  return parsed.base === undefined || parsed.implementation === undefined
    ? undefined
    : { base: parsed.base, implementation: parsed.implementation };
}

/** 再固定比較のため、機械導出されるidentity 2値だけをplaceholderへ置換する。 */
export function normalizeReviewIdentityAnchor(
  markdown: string,
): string | undefined {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const visible = visibleMarkdownLines(markdown);
  const range = sectionRange(visible, REVIEW_IDENTITY_HEADING);
  if (range === undefined || parseReviewIdentityAnchor(markdown) === undefined)
    return undefined;
  for (let index = range.start + 1; index < range.end; index += 1) {
    if (/^\| 比較基点 \| `[a-f0-9]{40}` \|$/u.test(visible[index]!))
      lines[index] = `| 比較基点 | \`<正規化済み>\` |`;
    if (/^\| H_impl \| `[a-f0-9]{40}` \|$/u.test(visible[index]!))
      lines[index] = `| H_impl | \`<正規化済み>\` |`;
  }
  return lines.join(newline);
}

/** Markdown review artifactの事前検証。成功はauthorityやapprovalを生成しない。 */
export function validateReviewArtifactStructure(
  markdown: string,
): ReviewArtifactStructure {
  const lines = visibleMarkdownLines(markdown);
  const diagnostics: ReviewArtifactDiagnostic[] = [];
  const add = (code: string, line: number, expected: string, message: string) =>
    diagnostics.push({ code, line, expected, message });
  for (const heading of REQUIRED_HEADINGS) {
    const matches = lines
      .map((line, index) => (line === heading ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length !== 1)
      add(
        "heading",
        (matches[0] ?? 0) + 1,
        heading,
        `${heading}は1件必要です（実測=${matches.length}件）`,
      );
  }
  const identity = sectionRange(lines, REVIEW_IDENTITY_HEADING);
  const base = exactIdentityValue(lines, identity, "比較基点");
  const implementation = exactIdentityValue(lines, identity, "H_impl");
  if (base.value === undefined)
    add(
      "identity-base",
      base.line,
      IDENTITY_BASE_EXPECTED,
      "比較基点を一意な厳密行で記録してください",
    );
  if (implementation.value === undefined)
    add(
      "identity-implementation",
      implementation.line,
      IDENTITY_IMPL_EXPECTED,
      "H_implを一意な厳密行で記録してください",
    );
  const roundsCell = identityCell(lines, identity, "ラウンド数");
  const roundText = /^(\d+)/u.exec(roundsCell.value ?? "")?.[1];
  const rounds = roundText === undefined ? undefined : Number(roundText);
  if (rounds === undefined)
    add(
      "rounds",
      roundsCell.line,
      "| ラウンド数 | <0以上の整数で始まる値> |",
      "ラウンド数を一意に記録してください",
    );
  const chainCell = identityCell(lines, identity, "Step chain");
  const chainMatch = /^(経由|迂回) *[:：] *(.+)$/u.exec(chainCell.value ?? "");
  const stepChain = chainMatch
    ? {
        kind: chainMatch[1] === "経由" ? ("via" as const) : ("bypass" as const),
        detail: chainMatch[2]!.trim(),
      }
    : undefined;
  if (stepChain === undefined)
    add(
      "step-chain",
      chainCell.line,
      "| Step chain | 経由: <staging> | または | Step chain | 迂回: <理由> |",
      "Step chainを一意に記録してください",
    );
  const distribution = sectionRange(lines, "## 8. 配布物影響");
  const distributionLines =
    distribution === undefined
      ? []
      : lines.slice(distribution.start + 1, distribution.end);
  const decisions = distributionLines
    .map((line, offset) => ({
      line,
      index: (distribution?.start ?? 0) + 1 + offset,
    }))
    .filter((entry) => entry.line.startsWith("判断:"));
  const roots = distributionLines
    .map((line, offset) => ({
      line,
      index: (distribution?.start ?? 0) + 1 + offset,
    }))
    .filter((entry) => entry.line.startsWith("根拠:"));
  if (
    decisions.length !== 1 ||
    !["判断: 配布物を更新した", "判断: 配布物を更新しない"].includes(
      decisions[0]?.line ?? "",
    )
  )
    add(
      "distribution-decision",
      (decisions[0]?.index ?? distribution?.start ?? 0) + 1,
      "判断: 配布物を更新した または 判断: 配布物を更新しない（1件）",
      "配布物影響の判断を一意に記録してください",
    );
  if (roots.length !== 1 || roots[0]!.line.slice("根拠:".length).trim() === "")
    add(
      "distribution-reason",
      (roots[0]?.index ?? distribution?.start ?? 0) + 1,
      "根拠: <具体的な根拠>（1件）",
      "配布物影響の根拠を一意に記録してください",
    );
  const auditRange = sectionRange(lines, "### 1.1 変更ファイル個別監査");
  if (auditRange !== undefined) {
    const auditLines = lines
      .slice(auditRange.start + 1, auditRange.end)
      .map((line, offset) => ({ line, index: auditRange.start + 1 + offset }));
    const headers = auditLines.filter((entry) => entry.line === AUDIT_HEADER);
    if (headers.length !== 1)
      add(
        "audit-header",
        (headers[0]?.index ?? auditRange.start) + 1,
        AUDIT_HEADER,
        "変更ファイル個別監査のheaderを一意な厳密行で記録してください",
      );
    const dataRows = auditLines.filter((entry) => /^\| *`/u.test(entry.line));
    for (const entry of dataRows)
      if (parseAuditRow(entry.line) === undefined)
        add(
          "audit-row",
          entry.index + 1,
          AUDIT_ROW_EXPECTED,
          "変更ファイル個別監査の行形式が不正です",
        );
    const validRows = dataRows
      .map((entry) => ({
        entry: parseAuditRow(entry.line),
        index: entry.index,
      }))
      .filter(
        (item): item is { entry: ReviewArtifactAuditEntry; index: number } =>
          item.entry !== undefined,
      );
    if (validRows.length === 0)
      add(
        "audit-row",
        auditRange.start + 1,
        AUDIT_ROW_EXPECTED,
        "変更ファイル個別監査に1件以上の適合行が必要です",
      );
    const seen = new Set<string>();
    for (const item of validRows) {
      if (seen.has(item.entry.path))
        add(
          "audit-duplicate",
          item.index + 1,
          "監査対象pathは各1件",
          `変更ファイル個別監査のpathが重複しています: ${item.entry.path}`,
        );
      seen.add(item.entry.path);
    }
  }
  const audit = parseReviewArtifactAudit(markdown);
  return {
    base: base.value,
    implementation: implementation.value,
    rounds,
    stepChain,
    auditEntries: audit.entries,
    diagnostics,
  };
}

/**
 * Tracked review artifactに記録されたcontext-isolatedの最終判断を読む。
 * artifact単体はauthorityにせず、callerが保存済みsession bindingとGit blobを
 * 別途照合した後にだけ、このsemantic recordをapprovalへ使用する。
 */
export function validateContextIsolatedApprovalRecord(
  markdown: string,
): ContextIsolatedApprovalRecord {
  const structure = validateReviewArtifactStructure(markdown);
  const lines = visibleMarkdownLines(markdown);
  const independence = sectionRange(lines, "## 9. 独立reviewの成立");
  const summary = sectionRange(lines, "## 11. 総合判定と再開地点");
  const mode = identityCell(lines, independence, "適用した独立性モード");
  const satisfies = identityCell(lines, independence, "その要求を満たすこと");
  const comparison = identityCell(
    lines,
    independence,
    "reviewerとimplementerのidentity・context比較",
  );
  const nonModification = identityCell(
    lines,
    independence,
    "reviewerが対象差分を変更していないこと",
  );
  const summaryLines =
    summary === undefined ? [] : lines.slice(summary.start + 1, summary.end);
  const verdicts = summaryLines.filter((line) => line.startsWith("- 判定:"));
  const blockers = summaryLines.filter((line) =>
    line.startsWith("- 未解決Critical/High:"),
  );
  const errors = structure.diagnostics.map((item) => item.message);
  if (mode.count !== 1 || mode.value !== "context-isolated")
    errors.push("適用した独立性モードはcontext-isolatedが1件必要です");
  if (satisfies.count !== 1 || !/^はい(?:$|[（(])/u.test(satisfies.value ?? ""))
    errors.push("context-isolatedの要求を満たす記録が必要です");
  if (
    comparison.count !== 1 ||
    comparison.value === undefined ||
    comparison.value === "" ||
    /[{}]|実体の観測値/u.test(comparison.value)
  )
    errors.push(
      "reviewerとimplementerのidentity・context比較の実測値が必要です",
    );
  if (
    nonModification.count !== 1 ||
    !/^はい(?:$|[（(])/u.test(nonModification.value ?? "")
  )
    errors.push("reviewerが対象差分を変更していない記録が必要です");
  if (verdicts.length !== 1 || verdicts[0] !== "- 判定: approved")
    errors.push("総合判定approvedが1件必要です");
  if (
    blockers.length !== 1 ||
    !/^- 未解決Critical\/High: *なし$/u.test(blockers[0] ?? "")
  )
    errors.push("未解決Critical/Highがない記録が必要です");
  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

/** review artifact用stagingが対象rootの規定issues directory直下にあるか判定する。 */
export function isReviewArtifactStagingDirectChild(
  root: string,
  staging: string,
): boolean {
  const resolvedRoot = path.resolve(root);
  const parent = path.dirname(path.resolve(staging));
  const relative = path
    .relative(resolvedRoot, parent)
    .split(path.sep)
    .join("/");
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return false;
  return matchesStagingRoot(
    readStagingLayout(resolvedRoot).rootPattern,
    relative,
  );
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
/**
 * 変更pathの種別から機械的に導出できる監査列を事前充填する。
 *
 * 利用projectの実測では、80 pathの9列を毎roundreviewerが手で書いていた。
 * 文書・lockfile・生成物・test・設定は、owner（layer）・依存方向・安全/rollbackの
 * 列がpathから決まる。**判定列（個別判定）と仕様・AC列は事前充填しない。** これらは
 * reviewerの判断であり、`finding`と「reviewerが確認」のまま残す。product code
 * （source）は全列をreviewerが書く。owner列は実際の担当者名をpathから特定できない
 * ため確定しないが、layerが判明した行はowner列に領域heading（layer）を添えて、
 * reviewerが同じ行内の他列と照合する読み直しを減らす。
 */
export function auditRowDraft(
  pathValue: string,
  changeType: "A" | "M" | "D" | "R",
): string {
  const p = pathValue.replaceAll("\\", "/");
  const rollback = changeType === "D" ? "git履歴に残る。revert" : "revert";
  let kind: string | undefined;
  let layer = "reviewerが確認";
  let dependency = "reviewerが確認";
  if (
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock)$/u.test(
      p,
    )
  ) {
    kind = "lockfile。依存の完全固定";
    layer = "依存";
    dependency = "依存のみ。循環なし";
  } else if (/(^|\/)docs\/reviews\//u.test(p)) {
    kind = "review artifact";
    layer = "docs/reviews";
    dependency = "記録。循環なし";
  } else if (/(^|\/)docs\/specs\//u.test(p)) {
    kind = "システム仕様書";
    layer = "docs/specs";
    dependency = "spec → src（許可された向き）";
  } else if (/(^|\/)docs\//u.test(p) || /\.(md|adoc|rst|txt)$/u.test(p)) {
    kind = "文書";
    layer = "docs";
    dependency = "文書。循環なし";
  } else if (/(^|\/)(generated|__generated__|dist|build)\//u.test(p)) {
    kind = "生成物。生成元との対応を再build後のclean差分で確認";
    layer = "生成物";
    dependency = "生成元 → 生成物";
  } else if (
    /(^|\/)(tests?|__tests__|spec|features)\//u.test(p) ||
    /\.(test|spec)\.[jt]sx?$|_test\.py$|^test_.*\.py$|\.feature$/u.test(p)
  ) {
    kind = "test。検証内容はreviewerが確認";
    layer = "test";
    dependency = "test → 対象（許可された向き）";
  } else if (
    /\.(json|ya?ml|toml|ini|cfg|env\.example)$|(^|\/)\.[^/]+$/u.test(p)
  ) {
    kind = "設定。値の意味はreviewerが確認";
    layer = "設定";
    dependency = "設定。循環なし";
  }
  const responsibility = kind ?? "reviewerが確認";
  const owner = kind ? `reviewerが確認（領域: ${layer}）` : "reviewerが確認";
  const safety =
    layer === "生成物"
      ? `§8の配布物影響表とpackage filesで確認。${rollback}`
      : kind
        ? `${kind.split("。")[0]}。${rollback}`
        : "reviewerが確認";
  return `| \`${escapeCell(p)}\` | ${changeType} | ${owner} | ${layer} | ${responsibility} | ${dependency} | reviewerが確認 | ${safety} | finding |`;
}

export function renderReviewArtifactDraft(input: {
  readonly template: string;
  readonly staging: string;
  readonly stagingDigest: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly paths: readonly ReviewArtifactPath[];
  /** package.jsonの`files`。与えると§8配布物影響の行を境界判定つきで生成する。 */
  readonly packageFiles?: readonly string[];
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
  content = replaceRow(
    content,
    "ラウンド数",
    "1（reviewerが実施したround数へ更新する）",
  );
  content = replaceRow(content, "Step chain", `経由: ${input.staging}`);
  const auditRows = input.paths
    .map((item) => auditRowDraft(item.path, item.changeType))
    .join("\n");
  content = content.replace(
    /^\| （repository相対path） \| A \/ M \/ D \/ R \|[^\n]*$/mu,
    auditRows ||
      "| 差分なし | M | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | finding |",
  );
  if (input.packageFiles !== undefined) {
    const grouped = [
      ...new Set(
        input.paths.map((item) =>
          item.path === "dist" || item.path.startsWith("dist/")
            ? `dist/${item.path.split("/")[1] ?? ""}${item.path.split("/")[1] ? "/" : ""}`
            : item.path,
        ),
      ),
    ];
    const distributed = new Set(
      distributedPaths({
        changedPaths: grouped,
        packageFiles: input.packageFiles,
      }),
    );
    const distributionRows = grouped
      .map(
        (target) =>
          `| ${escapeCell(target)} | ${distributed.has(target) ? "入る" : "入らない"} | ${distributed.has(target) ? "reviewerが確認" : "なし"} |`,
      )
      .join("\n");
    content = content.replace(
      /^\| \{パス\} \| 入る \/ 入らない \|[^\n]*$/mu,
      distributionRows || "| 差分なし | 入らない | なし |",
    );
  }
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
