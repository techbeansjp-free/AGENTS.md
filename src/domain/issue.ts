import fs from "node:fs";
import path from "node:path";
import { safeSlug } from "../lib/security.js";
import { publishDirectoryAtomic, writeFileAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
import {
  classifyMode,
  detectQuickDisqualifiers,
  POC_HIGH_RISK_IDS,
  QUESTIONS,
  type Mode,
  type ModeAnswer,
  type PocDeclaration,
} from "./mode.js";
import { validateDevelopmentConsiderations } from "./conformance.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  STAGING_RECORD_FILE,
  type StoredStagingRecord,
} from "./staging.js";

const packageRoot = findPackageRoot(import.meta.url);
const templateRoot = path.join(
  packageRoot,
  ".agent-skill-chain",
  "templates",
  "issue",
);
const FULL_FILES = {
  "01_要件定義.md": "01_要件定義.md",
  "02_設計.md": "02_設計.md",
  "03_実装計画.md": "03_実装計画.md",
};

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

function requirementDocument(
  mode: Mode,
  title: string,
  answers: Record<string, ModeAnswer>,
  poc?: PocDeclaration,
): string {
  const name =
    mode === "poc"
      ? "00_要求定義_poc.md"
      : mode === "quick"
        ? "00_要求定義_quick.md"
        : "00_要求定義_full.md";
  let content = fs.readFileSync(path.join(templateRoot, name), "utf8");
  content = replaceTwoColumnRow(content, "件名", escapeCell(title));
  for (const id of QUESTIONS) {
    const item = answers?.[id];
    const answer =
      item?.answer === true
        ? "true"
        : item?.answer === false
          ? "false"
          : "unknown";
    const evidence = escapeCell(item?.evidence || "根拠なし");
    content = content.replace(
      new RegExp(
        `^\\|[ \\t]*${id}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`,
        "m",
      ),
      `| ${id} | ${answer} | ${evidence} |`,
    );
  }
  if (mode === "poc" && poc) {
    const replacements: Array<[string, string]> = [
      ["PoC目的", escapeCell(poc.purpose)],
      [
        "対象期間",
        `${escapeCell(poc.period.from)}〜${escapeCell(poc.period.to)}`,
      ],
      ["成功条件", escapeCell(poc.successCriteria)],
      ["中止条件", escapeCell(poc.abortCriteria)],
      ["非対象", escapeCell(poc.outOfScope)],
      ["責任者", escapeCell(poc.owner)],
    ];
    for (const [label, value] of replacements)
      content = replaceTwoColumnRow(content, label, value);
    for (const risk of poc.highRisk) {
      content = content.replace(
        new RegExp(
          `^\\|[ \\t]*${escapeRegExp(risk.id)}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`,
          "m",
        ),
        `| ${risk.id} | ${risk.present ? "あり" : "なし"} | ${escapeCell(risk.evidence)} |`,
      );
    }
  }
  return content;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTwoColumnRow(
  content: string,
  label: string,
  value: string,
): string {
  return content.replace(
    new RegExp(
      `^\\|[ \\t]*${escapeRegExp(label)}[ \\t]*\\|[^\\n|]+\\|[ \\t]*$`,
      "m",
    ),
    `| ${label} | ${value} |`,
  );
}

function escapeCell(value: unknown): string {
  return String(value)
    .replaceAll("|", "｜")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function createIssueStaging(
  root: string,
  options: {
    title: string;
    answers: Record<string, ModeAnswer>;
    now?: Date;
    requestedMode?: string;
    poc?: PocDeclaration;
    changedFiles?: string[];
  },
) {
  const slug = safeSlug(options.title);
  const decision = classifyMode(options.answers, {
    requestedMode: options.requestedMode,
    poc: options.poc,
    changedFiles: options.changedFiles,
  });
  const finalPath = path.join(
    root,
    ".agent-skill-chain",
    "tmp",
    "issues",
    `${timestamp(options.now ?? new Date())}_${slug}`,
  );
  publishDirectoryAtomic(finalPath, (temporary) => {
    fs.writeFileSync(
      path.join(temporary, "00_要求定義.md"),
      requirementDocument(
        decision.mode,
        options.title,
        options.answers,
        options.poc,
      ),
      { flag: "wx" },
    );
    if (decision.mode === "full") {
      for (const [name, template] of Object.entries(FULL_FILES))
        fs.copyFileSync(
          path.join(templateRoot, template),
          path.join(temporary, name),
          fs.constants.COPYFILE_EXCL,
        );
    }
    const artifacts = listStagingArtifacts(temporary);
    const record: StoredStagingRecord = {
      schemaVersion: "agent-skill-chain/staging-record/v1",
      mode: decision.mode,
      artifacts,
      digest: calculateStagingDigest(temporary, artifacts),
      owner: "runtime・project owner",
      createdAt: (options.now ?? new Date()).toISOString(),
      state: "local-active",
      tracker: null,
      checkpoint: null,
      syncedAt: null,
      syncDigest: null,
      readBackDigest: null,
    };
    fs.writeFileSync(
      path.join(temporary, STAGING_RECORD_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  });
  return {
    path: finalPath,
    mode: decision.mode,
    reasons: decision.reasons,
    durable: false,
    synced: false,
  };
}

export function recordStagingSync(
  stagingPath: string,
  input: {
    tracker: string;
    checkpoint: number;
    syncedAt: string;
    bodyDigest: string;
    readBackDigest: string;
  },
): StoredStagingRecord {
  const resolved = path.resolve(stagingPath);
  const repositoryRoot = path.dirname(
    path.dirname(path.dirname(path.dirname(resolved))),
  );
  const expected = path.join(
    repositoryRoot,
    ".agent-skill-chain",
    "tmp",
    "issues",
    path.basename(resolved),
  );
  if (resolved !== expected || path.basename(resolved).includes(".."))
    throw new Error(
      "同期記録は.agent-skill-chain/tmp/issues/直下のstagingだけに書き込めます",
    );
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("同期記録の対象はsymlinkでない通常directoryが必要です");
  if (fs.realpathSync(resolved) !== resolved)
    throw new Error("同期記録の対象にsymlink祖先を使用できません");
  const current = readStoredStagingRecord(resolved);
  const expectedCheckpoint = current.mode === "full" ? 8 : 4;
  if (input.checkpoint !== expectedCheckpoint)
    throw new Error(
      `mode=${current.mode}の最終同期checkpointはStep ${expectedCheckpoint}です`,
    );
  if (!/^[a-f0-9]{64}$/u.test(input.bodyDigest))
    throw new Error("bodyDigestは64桁SHA-256でなければなりません");
  if (
    !/^[a-f0-9]{64}$/u.test(input.readBackDigest) ||
    input.bodyDigest !== input.readBackDigest
  )
    throw new Error("書き込み後読み取りbody digestが同期内容と一致しません");
  if (
    !/^(?:https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*|#?[1-9]\d*)$/u.test(
      input.tracker,
    )
  )
    throw new Error("trackerはGitHub Issue URLまたはIssue番号が必要です");
  const syncedAt = Date.parse(input.syncedAt);
  if (
    !Number.isFinite(syncedAt) ||
    new Date(syncedAt).toISOString() !== input.syncedAt
  )
    throw new Error("syncedAtはISO 8601 UTC日時でなければなりません");
  const artifacts = listStagingArtifacts(resolved);
  const required =
    current.mode === "full"
      ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
      : ["00_要求定義.md"];
  const missing = required.filter((artifact) => !artifacts.includes(artifact));
  if (missing.length > 0)
    throw new Error(
      `mode別の必要成果物が不足しています: ${missing.join(", ")}`,
    );
  const updated: StoredStagingRecord = {
    ...current,
    artifacts,
    digest: calculateStagingDigest(resolved, artifacts),
    state: "sync-verified",
    tracker: input.tracker,
    checkpoint: expectedCheckpoint,
    syncedAt: input.syncedAt,
    syncDigest: input.bodyDigest,
    readBackDigest: input.readBackDigest,
  };
  writeFileAtomic(
    path.join(resolved, STAGING_RECORD_FILE),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
  const reread = readStoredStagingRecord(resolved);
  if (JSON.stringify(reread) !== JSON.stringify(updated))
    throw new Error("同期記録の書き込み後読み取り確認に失敗しました");
  return reread;
}

export function validateIssue(
  issuePath: string,
  options: {
    changedFiles?: string[];
    requestedOperation?: string;
    operation?: string;
    delivery?: { stopAt?: string };
  } = {},
) {
  const errors: string[] = [];
  const requirementPath = path.join(issuePath, "00_要求定義.md");
  if (!fs.existsSync(requirementPath))
    return {
      valid: false,
      mode: "full",
      errors: ["00_要求定義.mdがありません"],
      blockedOperations: [],
    };
  const text = fs.readFileSync(requirementPath, "utf8");
  const declaredValue =
    /^\|\s*モード\s*\|\s*`?(quick|full|poc)`?\s*\|\s*$/m.exec(text)?.[1];
  const declared: Mode =
    declaredValue === "quick" || declaredValue === "poc"
      ? declaredValue
      : "full";
  let mode: Mode = declared;
  const requiredHeadings =
    declared === "quick"
      ? [
          "1. 目的、現在、期待状態（必須）",
          "2. 対象範囲と権限（必須）",
          "3. ドメイン影響（必須）",
          "4. Q-01〜Q-08の回答と根拠（必須）",
          "5. 要求、受け入れ条件、最小Gherkin（必須）",
          "6. 最小設計",
          "7. 実装とテストの計画",
          "8. P-01〜P-07の証拠",
          "9. 仕様、図表、識別子",
          "10. リスク、レビュー、再開地点",
        ]
      : declared === "poc"
        ? [
            "1. 目的、現在、期待状態（必須）",
            "2. 対象範囲と権限（必須）",
            "3. ドメイン影響（必須）",
            "4. PoC宣言（必須）",
            "5. high risk確認（必須）",
            "6. 要求、受け入れ条件、実行可能な受け入れ例（必須）",
            "7. 最小設計",
            "8. 実装とテストの計画",
            "9. P-01〜P-07の証拠",
            "10. 仕様、図表、識別子",
            "11. リスク、昇格・廃止判断、再開地点",
          ]
        : [
            "1. 目的と背景",
            "2. 対象範囲",
            "3. 利害関係者と利用場面",
            "4. ドメイン影響",
            "5. 要求の概要",
            "6. 制約、前提、依存関係",
            "7. 受け入れ条件と成功基準",
            "8. リスクと安全側への縮小",
            "9. モード判定Q-01〜Q-08",
            "10. P-01〜P-07の適用計画",
            "11. 図表と識別子の判断",
            "12. 参考資料、未決事項、再開地点",
          ];
  for (const heading of requiredHeadings) {
    if (!text.includes(`## ${heading}`))
      errors.push(`必須項目がありません: ${heading}`);
  }
  const allText = [
    text,
    ...Object.keys(FULL_FILES)
      .filter((name) => fs.existsSync(path.join(issuePath, name)))
      .map((name) => fs.readFileSync(path.join(issuePath, name), "utf8")),
  ].join("\n");
  if (
    /<[^>\n]+>|\{[^}\n]+\}|（[^）\n]*(?:記載|記入|件名|名称|内容|役割|日時|ISO 8601形式|状態|結果|根拠|条件|パス|URL|SHA|値|対象)[^）\n]*）/.test(
      allText,
    )
  )
    errors.push("未解決のplaceholderが残っています");
  for (let index = 1; index <= 7; index += 1) {
    const id = `P-${String(index).padStart(2, "0")}`;
    if (!text.includes(id)) errors.push(`${id}の証拠がありません`);
  }
  if (!/Scenario:\s+SCN-[A-Z0-9-]+/.test(allText))
    errors.push("GherkinシナリオIDがありません");
  const disqualifiers = detectQuickDisqualifiers(options.changedFiles ?? []);
  if (
    (declared === "quick" || declared === "poc") &&
    disqualifiers.length > 0
  ) {
    mode = "full";
    errors.push(
      `${declared}からfullへの単調昇格が必要: ${disqualifiers.join(", ")}`,
    );
  }
  if (declared === "poc") {
    for (const label of [
      "PoC目的",
      "対象期間",
      "成功条件",
      "中止条件",
      "非対象",
      "データ・security上の制約",
      "責任者",
      "full昇格条件",
      "廃止条件",
    ]) {
      const value = readTwoColumnValue(text, label);
      if (!value || /不明|未定|未確認|（/u.test(value)) {
        mode = "full";
        errors.push(
          `PoC宣言の${label}が未記入または不明なためfullへの昇格が必要です`,
        );
      }
    }
    for (const id of POC_HIGH_RISK_IDS) {
      const row = new RegExp(
        `^\\|\\s*${id}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`,
        "m",
      ).exec(text);
      if (!row) {
        mode = "full";
        errors.push(
          `PoC high risk条件 ${id} が未確認のためfullへの昇格が必要です`,
        );
      } else if (
        row[1] !== "なし" ||
        !row[2] ||
        row[2].includes("不明") ||
        row[2].includes("（")
      ) {
        mode = "full";
        errors.push(
          `PoC high risk条件 ${id} が不明または存在するためfullへの昇格が必要です`,
        );
      }
    }
  }
  const requestedOperation = options.requestedOperation ?? options.operation;
  const blockedOperations =
    declared === "poc"
      ? ["release", "automatic-merge", "production-cleanup"]
      : [];
  if (
    declared === "poc" &&
    requestedOperation &&
    isPocBlockedOperation(requestedOperation)
  )
    errors.push(
      `PoCでは${requestedOperation}を要求できません。delivery.stopAt=${options.delivery?.stopAt ?? "pull_request"}で停止し、fullへ昇格してください`,
    );
  if (mode === "full") {
    for (const name of Object.keys(FULL_FILES))
      if (!fs.existsSync(path.join(issuePath, name)))
        errors.push(`fullモードには${name}が必要です`);
  }
  const considerationFiles =
    mode === "full"
      ? ["00_要求定義.md", ...Object.keys(FULL_FILES)]
      : ["00_要求定義.md"];
  for (const name of considerationFiles) {
    const file = path.join(issuePath, name);
    if (!fs.existsSync(file)) continue;
    errors.push(
      ...validateDevelopmentConsiderations(fs.readFileSync(file, "utf8"), name)
        .errors,
    );
  }
  return { valid: errors.length === 0, mode, errors, blockedOperations };
}

function readTwoColumnValue(text: string, label: string): string | undefined {
  return new RegExp(
    `^\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`,
    "m",
  )
    .exec(text)?.[1]
    ?.trim();
}

function isPocBlockedOperation(operation: string): boolean {
  const normalized = operation.toLowerCase().replaceAll("_", "-");
  return (
    normalized.includes("release") ||
    (normalized.includes("merge") &&
      (normalized.includes("automatic") ||
        normalized.includes("auto") ||
        normalized.includes("自動"))) ||
    (normalized.includes("cleanup") &&
      (normalized.includes("production") ||
        normalized.includes("prod") ||
        normalized.includes("本番") ||
        normalized === "cleanup"))
  );
}

export function planPocPromotion(issuePath: string): {
  missing: string[];
  reasons: string[];
} {
  const missing = Object.keys(FULL_FILES).filter(
    (name) => !fs.existsSync(path.join(issuePath, name)),
  );
  const reasons = missing.map(
    (name) =>
      `${name}はPoCの最小成果物に含まれず、正式開発のfullモードで補完が必要です`,
  );
  const requirementPath = path.join(issuePath, "00_要求定義.md");
  if (!fs.existsSync(requirementPath)) {
    if (!missing.includes("00_要求定義.md")) missing.unshift("00_要求定義.md");
    reasons.unshift(
      "PoCから正式開発へ昇格する根拠となる00_要求定義.mdがありません",
    );
  } else {
    const text = fs.readFileSync(requirementPath, "utf8");
    if (!/^\|\s*モード\s*\|\s*`?poc`?\s*\|\s*$/m.test(text))
      reasons.push(
        "管理情報のモードがpocではないため、昇格元を確認してください",
      );
    else
      reasons.unshift(
        "PoC宣言の成功・中止条件とhigh risk確認を昇格根拠としてfull成果物へ追跡してください",
      );
  }
  return { missing, reasons };
}
