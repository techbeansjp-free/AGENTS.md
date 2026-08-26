/**
 * モード判定質問。**この一覧と`.agent-skill-chain/docs/01_開発ワークフロー.md`の表が
 * 質問文の唯一の対である。** 両者は独立した複製ではなく、機械的に一致を強制される写しであり、
 * `checkModeQuestionText`が`(id, disqualifier, question)`の順序付き比較で不一致を拒否する。
 *
 * 片方だけを書き換えられると、人が読む規範文書に差分が現れないままowner承認を迂回できる。
 * 質問文の極性（真＝quickを選べる向き）は機械では判定できない。向きの反転は文面の変更として
 * 現れるため、一致検査がそれを捕捉する。
 */
export interface ModeQuestion {
  readonly id: string;
  readonly disqualifier: string;
  readonly question: string;
}

export const MODE_QUESTIONS: readonly ModeQuestion[] = Object.freeze([
  {
    id: "Q-01",
    disqualifier: "public-api",
    question:
      "この変更は、外部へ公開するinterface（API、CLI、配布するschema定義file、template、規範文書）とその外部観測可能な振る舞い（終了値、error、既定値、副作用、互換性）を、追加・変更・削除しないか",
  },
  {
    id: "Q-02",
    disqualifier: "data-migration",
    question:
      "この変更は、既に保存されているデータの形式、移行手順、後方非互換な読み書き規則を追加・変更・削除しないか",
  },
  {
    id: "Q-03",
    disqualifier: "security-boundary",
    question:
      "この変更は、認証、認可、信頼境界の判定に加え、秘密情報の取得、保存、伝送、表示、伏字化、破棄の扱いを、追加・変更・削除しないか",
  },
  {
    id: "Q-04",
    disqualifier: "dependency",
    question:
      "この変更は、依存package、lockfile、versionの制約に加え、実行時に必要となる外部の存在（executable、OS library、外部service、常駐process）を、追加・変更・削除しないか",
  },
  {
    id: "Q-05",
    disqualifier: "infrastructure",
    question:
      "この変更は、実行環境、CI、基盤設定、配布経路、および接続先やendpointの指定を、追加・変更・削除しないか",
  },
  {
    id: "Q-06",
    disqualifier: "irreversible-operation",
    question:
      "この変更は、削除、公開、送信など元へ戻せない操作について、認可、対象、引数、実行時期、到達性、操作手順、復旧可能性のいずれも追加・変更・削除しないか。いずれも変えない非規範的な引用だけであれば該当しない。不明な場合はfalseとする",
  },
  {
    id: "Q-07",
    disqualifier: "ambiguity",
    question:
      "現時点の入力に、目的、対象内外、各受け入れ条件の観測方法、判定に用いる閾値、未決事項とその決定権者がすべて明記されており、目的、対象範囲、受け入れ条件、不変条件、要件のいずれのあいだにも矛盾が無いか。1つでも不足、不明、または矛盾があればfalseとする",
  },
  {
    id: "Q-08",
    disqualifier: "multi-context",
    question:
      "影響する境界づけられたコンテキストが1つに限定でき、他コンテキストのモデルと操作へ触れないか",
  },
]);

/** 承認済みのquick失格分類。`MODE_QUESTIONS`と1対1で対応する。 */
export const QUICK_DISQUALIFIER_IDS: readonly string[] = Object.freeze(
  MODE_QUESTIONS.map((entry) => entry.disqualifier),
);

const QUESTIONS = MODE_QUESTIONS.map((entry) => entry.id);

/**
 * 質問と分類の対応を検証する。
 * 件数と一意性だけでは、空文字や未承認tokenを含む8件が通過する。集合の完全一致を要求する。
 */
export function validateModeQuestions(
  questions: readonly ModeQuestion[],
): string[] {
  const errors: string[] = [];
  const expectedIds = Array.from(
    { length: 8 },
    (_, index) => `Q-${String(index + 1).padStart(2, "0")}`,
  );
  const ids = questions.map((entry) => entry.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
    errors.push(
      `モード判定質問のIDが規定と一致しません: ${ids.join("、") || "（なし）"}`,
    );
  for (const entry of questions)
    if (entry.question.trim() === "")
      errors.push(`モード判定質問の文面が空です: ${entry.id}`);
  const texts = questions.map((entry) => entry.question);
  for (const value of new Set(
    texts.filter((value, index) => texts.indexOf(value) !== index),
  ))
    errors.push(`モード判定質問の文面が重複しています: ${value.slice(0, 24)}…`);
  const declared = questions.map((entry) => entry.disqualifier);
  const duplicated = declared.filter(
    (value, index) => declared.indexOf(value) !== index,
  );
  for (const value of new Set(duplicated))
    errors.push(`quick失格分類が重複しています: ${value}`);
  const approved: ReadonlySet<string> = new Set<string>(APPROVED_DISQUALIFIERS);
  for (const entry of questions)
    if (!approved.has(entry.disqualifier))
      errors.push(
        `モード判定質問に対応する分類が承認済みではありません: ${entry.id}（${entry.disqualifier || "（空）"}）`,
      );
  const present = new Set(declared);
  for (const value of APPROVED_DISQUALIFIERS)
    if (!present.has(value))
      errors.push(`quick失格分類に対応する質問がありません: ${value}`);
  return errors;
}

/** 承認済みの分類token。`MODE_QUESTIONS`の値と集合として一致しなければならない。 */
const APPROVED_DISQUALIFIERS = [
  "public-api",
  "data-migration",
  "security-boundary",
  "dependency",
  "infrastructure",
  "irreversible-operation",
  "ambiguity",
  "multi-context",
] as const;

export const POC_HIGH_RISK_IDS = [
  "public-api",
  "personal-data",
  "confidential-data",
  "external-exposure",
  "irreversible-operation",
] as const;

export type Mode = "quick" | "full" | "poc";

export type ModeAnswer = { answer?: boolean | "unknown"; evidence?: string };

export interface PocDeclaration {
  purpose: string;
  period: { from: string; to: string };
  outOfScope: string;
  successCriteria: string;
  abortCriteria: string;
  owner: string;
  highRisk: Array<{ id: string; present: boolean; evidence: string }>;
}

export interface ModeOptions {
  requestedMode?: string;
  poc?: PocDeclaration;
  changedFiles?: string[];
  currentMode?: Mode;
}

const knownHighRiskIds = new Set<string>(POC_HIGH_RISK_IDS);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function quickReasons(answers: Record<string, ModeAnswer>): string[] {
  const reasons: string[] = [];
  for (const id of QUESTIONS) {
    const item = answers?.[id];
    if (!item) reasons.push(`${id}: 未回答`);
    else if (item.answer !== true)
      reasons.push(
        `${id}: ${item.answer === "unknown" || item.answer == null ? "不明" : String(item.answer)}`,
      );
    else if (!nonEmpty(item.evidence)) reasons.push(`${id}: 根拠なし`);
  }
  return reasons;
}

function pocReasons(declaration: PocDeclaration | undefined): string[] {
  if (!declaration) return ["PoC宣言がありません"];

  const reasons: string[] = [];
  const requiredFields: Array<[string, unknown]> = [
    ["目的", declaration.purpose],
    ["対象期間の開始", declaration.period?.from],
    ["対象期間の終了", declaration.period?.to],
    ["非対象", declaration.outOfScope],
    ["成功条件", declaration.successCriteria],
    ["中止条件", declaration.abortCriteria],
    ["責任者", declaration.owner],
  ];
  for (const [label, value] of requiredFields)
    if (!nonEmpty(value))
      reasons.push(`PoC宣言の${label}が未記入または不明です`);

  const riskEntries = Array.isArray(declaration.highRisk)
    ? declaration.highRisk
    : [];
  for (const id of POC_HIGH_RISK_IDS) {
    const entries = riskEntries.filter((entry) => entry?.id === id);
    if (entries.length !== 1) {
      reasons.push(`PoC high risk条件 ${id} が未確認または重複しています`);
      continue;
    }
    const entry = entries[0];
    if (!entry || typeof entry.present !== "boolean")
      reasons.push(`PoC high risk条件 ${id} の有無が不明です`);
    else if (entry.present)
      reasons.push(
        `PoC high risk条件 ${id} が存在するためfullへの昇格が必要です`,
      );
    if (!entry || !nonEmpty(entry.evidence))
      reasons.push(`PoC high risk条件 ${id} の根拠がありません`);
  }
  for (const entry of riskEntries) {
    if (!entry || !nonEmpty(entry.id)) {
      reasons.push("PoC high risk条件に識別子がありません");
      continue;
    }
    if (entry.present === true && !knownHighRiskIds.has(entry.id))
      reasons.push(
        `PoC high risk条件 ${entry.id} が存在するためfullへの昇格が必要です`,
      );
    if (typeof entry.present !== "boolean")
      reasons.push(`PoC high risk条件 ${entry.id} の有無が不明です`);
    if (!nonEmpty(entry.evidence))
      reasons.push(`PoC high risk条件 ${entry.id} の根拠がありません`);
  }
  return [...new Set(reasons)];
}

export function classifyMode(
  answers: Record<string, ModeAnswer>,
  options: ModeOptions = {},
): {
  mode: Mode;
  reasons: string[];
} {
  if (
    options.requestedMode !== undefined &&
    !["quick", "full", "poc"].includes(options.requestedMode)
  )
    return {
      mode: "full",
      reasons: [`要求されたモード ${options.requestedMode} は不明です`],
    };
  if (options.requestedMode !== "poc") {
    const reasons = quickReasons(answers);
    if (options.requestedMode === "full" || options.currentMode === "full") {
      if (reasons.length === 0)
        reasons.push("fullからquickまたはpocへ途中降格しません");
      return { mode: "full", reasons };
    }
    return { mode: reasons.length === 0 ? "quick" : "full", reasons };
  }

  const reasons = pocReasons(options.poc);
  if (options.currentMode === "full")
    reasons.push("fullからpocへ途中降格しません");
  for (const disqualifier of detectQuickDisqualifiers(
    options.changedFiles ?? [],
  ))
    reasons.push(
      `変更fileのhigh risk条件 ${disqualifier} を検出したためfullへの昇格が必要です`,
    );
  return { mode: reasons.length === 0 ? "poc" : "full", reasons };
}

export function detectQuickDisqualifiers(changedFiles: string[]): string[] {
  const reasons = new Set<string>();
  for (const file of changedFiles) {
    const normalized = file.replaceAll("\\", "/");
    if (
      /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.toml)$/.test(
        normalized,
      )
    )
      reasons.add("dependency");
    if (
      /(^|\/)(public-api|api\/|openapi|contracts?\/|exports?\.)/i.test(
        normalized,
      )
    )
      reasons.add("public-api");
    if (/(^|\/)(migrations?|schema\/)/i.test(normalized))
      reasons.add("data-migration");
    if (/(^|\/)(auth|security|secrets?)(\/|\.)/i.test(normalized))
      reasons.add("security-boundary");
    if (
      /(^|\/)(\.github\/workflows|infra\/|Dockerfile|terraform)/i.test(
        normalized,
      )
    )
      reasons.add("infrastructure");
  }
  return [...reasons];
}

export { QUESTIONS };
