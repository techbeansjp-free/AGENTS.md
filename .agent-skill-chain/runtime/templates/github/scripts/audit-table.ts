/**
 * セキュリティ監査結果を統一フォーマットで GitHub Step Summary に出力する。
 * バックエンド（pip-audit）・フロントエンド（pnpm audit）のどちらも
 * 同じテーブル形式（| 深刻度 | パッケージ | 概要 |）で表示する。
 *
 * テンプレート: .agent-skill-chain/runtime/templates/github/scripts/audit-table.ts（パッケージルート基準）
 * 採用先では .github/scripts/audit-table.ts にコピーして利用する。
 *
 * 環境変数:
 *   AUDIT_LABEL     - 見出し用ラベル（例: バックエンド, フロントエンド）
 *   AUDIT_JSON_PATH - 監査 JSON ファイルパス
 *   AUDIT_FORMAT    - "pip" | "pnpm"（省略時は pnpm）
 *   GITHUB_STEP_SUMMARY - GitHub が設定。未設定時は何もしない
 *
 * 実行: npx tsx .github/scripts/audit-table.ts（CI では working-directory から ../.github/scripts/audit-table.ts）
 */

import fs from "node:fs";

interface AuditRow {
  severity: string;
  pkg: string;
  title: string;
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const label = process.env.AUDIT_LABEL ?? "概要";
const inputPath = process.env.AUDIT_JSON_PATH ?? "audit.json";
const format = (process.env.AUDIT_FORMAT ?? "pnpm").toLowerCase() as "pip" | "pnpm";

const raw = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, "utf8").trim() : "";

function safeJsonParse(t: string): unknown {
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

/** pip-audit --format json を正規化 */
function normalizePip(doc: unknown): AuditRow[] {
  const rows: AuditRow[] = [];
  const d = doc as { vulnerabilities?: Array<{ name?: string; installed_version?: string; vulns?: Array<{ id?: string; description?: string }> }> };
  const list = d?.vulnerabilities;
  if (!Array.isArray(list)) return rows;
  for (const v of list) {
    const name = String(v?.name ?? "");
    const version = String(v?.installed_version ?? "");
    const pkg = version ? `${name}@${version}` : name;
    const vulns = Array.isArray(v?.vulns) ? v.vulns : [];
    for (const u of vulns) {
      const id = String(u?.id ?? "N/A");
      const desc = String(u?.description ?? "").trim() || "(no description)";
      rows.push({ severity: id, pkg, title: desc });
    }
    if (vulns.length === 0) rows.push({ severity: "N/A", pkg, title: "(no details)" });
  }
  return rows;
}

/** pnpm audit --json を正規化（advisories / vulnerabilities 両対応） */
function normalizePnpm(doc: unknown): AuditRow[] {
  const rows: AuditRow[] = [];
  if (!doc || typeof doc !== "object") return rows;
  const d = doc as {
    advisories?: Record<string, { severity?: string; module_name?: string; name?: string; title?: string; overview?: string }>;
    vulnerabilities?: Record<string, { severity?: string; via?: Array<string | { title?: string; name?: string }> }>;
  };

  if (d.advisories && typeof d.advisories === "object") {
    for (const a of Object.values(d.advisories)) {
      if (!a || typeof a !== "object") continue;
      rows.push({
        severity: String(a.severity ?? "unknown"),
        pkg: String(a.module_name ?? a.name ?? ""),
        title: String(a.title ?? a.overview ?? "").trim() || "(no title)",
      });
    }
  }

  if (d.vulnerabilities && typeof d.vulnerabilities === "object") {
    for (const [pkg, v] of Object.entries(d.vulnerabilities)) {
      if (!v || typeof v !== "object") continue;
      const via = Array.isArray(v.via) ? v.via : [];
      const firstObj = via.find((x): x is Record<string, unknown> => x !== null && typeof x === "object") ?? null;
      const title =
        (typeof via[0] === "string" ? via[0] : (firstObj?.title ?? firstObj?.name ?? "")) || "(no title)";
      rows.push({
        severity: String(v.severity ?? "unknown"),
        pkg: String(pkg),
        title: String(title).trim() || "(no title)",
      });
    }
  }
  return rows.filter((r) => r.pkg);
}

let rows: AuditRow[];
if (format === "pip") {
  const doc = safeJsonParse(raw);
  rows = doc ? normalizePip(doc) : [];
} else {
  const doc = safeJsonParse(raw);
  rows = doc ? normalizePnpm(doc) : [];
}

const severityOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 9 };
rows.sort((a, b) => {
  const oa = severityOrder[a.severity?.toLowerCase()] ?? (a.severity?.startsWith("CVE") ? 5 : 9);
  const ob = severityOrder[b.severity?.toLowerCase()] ?? (b.severity?.startsWith("CVE") ? 5 : 9);
  return oa - ob || a.pkg.localeCompare(b.pkg);
});

const out: string[] = [];
const w = (s = ""): void => {
  out.push(s);
};

w(`## 🔒 セキュリティ監査（${label}）`);
w("");

if (rows.length === 0) {
  w("✅ 脆弱性は検出されませんでした。");
} else {
  const seen = new Set<string>();
  const uniq = rows.filter((r) => {
    const key = `${r.severity}@@${r.pkg}@@${r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const LIMIT = 120;
  w("| 深刻度 | パッケージ | 概要 |");
  w("|---|---|---|");
  for (const r of uniq.slice(0, LIMIT)) {
    const t = r.title.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200);
    w(`| ${r.severity} | ${r.pkg} | ${t} |`);
  }
  if (uniq.length > LIMIT) {
    w("");
    w(`※ ${uniq.length - LIMIT} 件は省略。`);
  }
}

if (summaryPath) fs.appendFileSync(summaryPath, out.join("\n") + "\n");
