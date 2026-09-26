import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import type { Mode } from "./mode.js";

/**
 * 計画封印（Planning Seal、TERM-ASC-WR-01）と計画変更記録（Planning Amendment、
 * TERM-ASC-WR-02）の純粋な判定。REQ-WF-036。
 *
 * **承認済み計画は封印後に書き換えない。** 同期checkpoint（fullはStep 8、quick/pocは
 * Step 4）の記録時に、modeの計画文書のSHA-256をjournal entryの`planSeal`へ固定する。
 * 封印後の計画変更は`05_計画変更.md`へ追記専用のentryとして記録し、実装事実はGit、
 * 現在のsystem契約は`docs/specs/`が所有する。
 */

export const PLAN_AMENDMENT_FILE = "05_計画変更.md";

export const PLAN_SEAL_ARTIFACTS: Readonly<Record<Mode, readonly string[]>> =
  Object.freeze({
    full: Object.freeze([
      "00_要求定義.md",
      "01_要件定義.md",
      "02_設計.md",
      "03_実装計画.md",
    ]),
    quick: Object.freeze(["00_要求定義.md"]),
    poc: Object.freeze(["00_要求定義.md"]),
  });

export type PlanSeal = Readonly<Record<string, string>>;

/** modeの計画を封印する同期checkpoint。 */
export function planSealStep(mode: Mode): 4 | 8 {
  return mode === "full" ? 8 : 4;
}

/** 封印後に計画凍結を検査するStep。 */
export function isPlanFrozenCheckStep(step: number): boolean {
  return step === 9 || step === 10;
}

/**
 * journal行の`planSeal`を構造検査する。**CLIが成果物から計算した値だけを受理する形**
 * であり、modeの封印Step以外・modeの計画文書集合と異なるkey集合・64桁SHA-256以外を拒否する。
 */
export function parsePlanSeal(input: {
  value: unknown;
  mode: unknown;
  step: unknown;
  label: string;
}): { value?: PlanSeal; errors: string[] } {
  const { value, label } = input;
  const mode =
    input.mode === "full" || input.mode === "quick" || input.mode === "poc"
      ? input.mode
      : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { errors: [`${label}.planSealはobjectが必要です`] };
  if (mode === undefined) return { errors: [] };
  if (input.step !== planSealStep(mode))
    return {
      errors: [
        `${label}.planSealは${mode}のStep ${planSealStep(mode)}にだけ指定できます`,
      ],
    };
  const record = value as Record<string, unknown>;
  const expected = PLAN_SEAL_ARTIFACTS[mode];
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...expected].sort()))
    return {
      errors: [
        `${label}.planSealのfile集合が${mode}の計画文書（${expected.join("、")}）と一致しません`,
      ],
    };
  const errors = expected
    .filter((name) => !/^[a-f0-9]{64}$/u.test(String(record[name] ?? "")))
    .map((name) => `${label}.planSeal.${name}は64桁SHA-256が必要です`);
  if (errors.length > 0) return { errors };
  return {
    value: Object.freeze(
      Object.fromEntries(
        expected.map((name) => [name, record[name] as string]),
      ),
    ),
    errors,
  };
}

/** journal上で最後に記録された封印。**無ければ封印前（旧journalを含む）である。** */
export function latestPlanSeal(
  entries: readonly { step: number; planSeal?: PlanSeal }[],
): { step: number; seal: PlanSeal; index: number } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.planSeal)
      return { step: entry.step, seal: entry.planSeal, index };
  }
  return undefined;
}

/**
 * **封印は不変である。** 現在のmodeの封印が既にあれば、そのmodeの封印Stepを再記録して
 * 封印し直すことはできない（Step 9の前後を問わない）。返すのは拒否理由であり、
 * 封印できる場合は`undefined`を返す。
 *
 * 例外は2つだけである。quick/pocからfullへの昇格後のfull Step 8はmodeが異なるため
 * 最初のfull封印になる。HumanOverrideの記録は封印を作らないため対象にしない。
 */
export function planResealRejection(input: {
  entries: readonly { step: number; mode: Mode; planSeal?: PlanSeal }[];
  mode: Mode;
  step: number;
  humanOverride: boolean;
}): string | undefined {
  if (input.humanOverride || input.step !== planSealStep(input.mode))
    return undefined;
  const sealed = input.entries.find(
    (entry) => entry.planSeal !== undefined && entry.mode === input.mode,
  );
  if (sealed)
    return `承認済みPlanningはStep ${sealed.step}で封印済みのため凍結されています。Step ${input.step}を再記録して封印し直すことはできません（内容が同じ場合も同じです）。封印後の計画の変更は${PLAN_AMENDMENT_FILE}へPlanning Amendment（AMD-NNN）として追記してください`;
  if (
    input.entries.some((entry) => entry.step >= 9 && entry.mode === input.mode)
  )
    return `Step 9以降の記録後にStep ${input.step}を追記して計画を再封印できません。計画の変更は${PLAN_AMENDMENT_FILE}へAMD-NNNとして追記してください`;
  return undefined;
}

// ---- 計画変更の世代chain（REQ-WF-036） ----

export interface PlanAmendmentDigest {
  id: string;
  digest: string;
}

/**
 * 計画の世代。封印が世代1（`digest`は封印digest、`previousDigest`はnull）であり、
 * 新しいAMDが追記されるたびに次の世代になる。世代2以降の`digest`は
 * `sha256(stableJson({previousDigest, amendments}))`で、`amendments`は
 * 世代までに記録した全AMDの累積列である。
 */
export interface PlanGeneration {
  generation: number;
  previousDigest: string | null;
  amendments: PlanAmendmentDigest[];
  digest: string;
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** 封印のdigest。世代1の`digest`である。 */
export function planSealDigest(seal: PlanSeal): string {
  return sha256Text(stableJson(seal));
}

export function planGenerationDigest(
  previousDigest: string,
  amendments: readonly PlanAmendmentDigest[],
): string {
  return sha256Text(stableJson({ previousDigest, amendments }));
}

export function baseGeneration(seal: PlanSeal): PlanGeneration {
  return {
    generation: 1,
    previousDigest: null,
    amendments: [],
    digest: planSealDigest(seal),
  };
}

/**
 * `05_計画変更.md`のAMD entryごとのdigest。entryは`## AMD-NNN`見出し行から次の`##`見出し
 * （fence外）の直前までの原文であり、末尾の空行だけを除く（後続entryの追記で
 * 既存entryのdigestが変わらないようにするため）。見出し形式の検査は
 * `validatePlanAmendment`が行う。
 */
export function planAmendmentDigests(
  markdown: string | undefined,
): PlanAmendmentDigest[] {
  if (markdown === undefined) return [];
  const entries: Array<{ id: string; lines: string[] }> = [];
  let current: { id: string; lines: string[] } | undefined;
  let fenced = false;
  for (const line of markdown.split("\n")) {
    const plain = line.replace(/\r$/u, "");
    if (/^\s*(?:```|~~~)/u.test(plain)) fenced = !fenced;
    if (!fenced && /^##\s/u.test(plain)) {
      const heading = /^##\s+(AMD-\d{3})(?:\s|$)/u.exec(plain);
      current = heading ? { id: heading[1] ?? "", lines: [] } : undefined;
      if (current) entries.push(current);
    }
    current?.lines.push(line);
  }
  return entries.map(({ id, lines }) => {
    const kept = [...lines];
    while (kept.length > 0 && (kept.at(-1) ?? "").trim() === "") kept.pop();
    return { id, digest: sha256Text(kept.join("\n")) };
  });
}

function describeAmendments(
  amendments: readonly PlanAmendmentDigest[],
): string {
  return amendments.map(({ id }) => id).join("、");
}

/**
 * 記録済み世代に対して現在のAMD列が追記専用を守っているかを返す。
 * 記録済みAMDの編集・削除・並べ替えは不一致の先頭を名指しして拒否する。
 */
function appendOnlyViolation(
  recorded: PlanGeneration,
  current: readonly PlanAmendmentDigest[],
): string | undefined {
  const broken = recorded.amendments.find(
    (amendment, index) =>
      current[index]?.id !== amendment.id ||
      current[index]?.digest !== amendment.digest,
  );
  if (!broken) return undefined;
  const present = current.some(({ id }) => id === broken.id);
  return `記録済みの計画変更${broken.id}が${present ? "編集または並べ替え" : "削除"}されています（計画世代${recorded.generation}で記録済み）。${PLAN_AMENDMENT_FILE}は追記専用です。記録済みentryを記録時の内容へ戻し、計画の変更は新しいAMD-NNNとして末尾へ追記してください`;
}

/**
 * journalに記録した世代列を封印から辿り、chainの整合と最新世代を返す。
 * 各記録は直前の世代と同一か、`generation`が1つ進み`previousDigest`が直前の`digest`で
 * `amendments`が直前の列を先頭に持つ次世代でなければならない。
 */
export function latestPlanGeneration(
  seal: PlanSeal,
  recorded: readonly PlanGeneration[],
): { latest: PlanGeneration; errors: string[] } {
  let latest = baseGeneration(seal);
  const errors: string[] = [];
  for (const generation of recorded) {
    if (stableJson(generation) === stableJson(latest)) continue;
    const next =
      generation.generation === latest.generation + 1 &&
      generation.previousDigest === latest.digest &&
      appendOnlyViolation(latest, generation.amendments) === undefined &&
      generation.amendments.length > latest.amendments.length &&
      generation.digest ===
        planGenerationDigest(latest.digest, generation.amendments);
    if (!next) {
      errors.push(
        `journalの計画世代${generation.generation}が封印と直前の世代${latest.generation}から辿れません`,
      );
      break;
    }
    latest = generation;
  }
  return { latest, errors };
}

/**
 * 現在のAMD列から、記録する世代を計算する。記録済みAMDが変わっていれば拒否し、
 * 新しいAMDが無ければ直前の世代をそのまま返す。
 */
export function nextPlanGeneration(
  previous: PlanGeneration,
  current: readonly PlanAmendmentDigest[],
): { value?: PlanGeneration; error?: string } {
  const violation = appendOnlyViolation(previous, current);
  if (violation) return { error: violation };
  if (current.length === previous.amendments.length) return { value: previous };
  const amendments = current.map(({ id, digest }) => ({ id, digest }));
  return {
    value: {
      generation: previous.generation + 1,
      previousDigest: previous.digest,
      amendments,
      digest: planGenerationDigest(previous.digest, amendments),
    },
  };
}

/**
 * 配送時の検査。現在のAMD列は最後のStep 10が記録した世代と完全に一致しなければならない。
 * **Step 10記録後に追記したAMDはreviewを経ていないため配送に乗せない。**
 */
export function deliveredAmendmentViolation(
  reviewed: PlanGeneration,
  current: readonly PlanAmendmentDigest[],
  where: string,
): string | undefined {
  const violation = appendOnlyViolation(reviewed, current);
  if (violation) return `${where}: ${violation}`;
  if (current.length === reviewed.amendments.length) return undefined;
  return `${where}: 最後のStep 10記録（計画世代${reviewed.generation}）の後に未記録の計画変更${describeAmendments(current.slice(reviewed.amendments.length))}が追記されています。計画変更はStep 10のreviewを経てから配送します。前進commitを伴う新しいreview roundを実行してStep 10を再記録（pr-bound中は--post-pr-intake）してから再実行してください`;
}

const PLAN_GENERATION_FIELDS = [
  "amendments",
  "digest",
  "generation",
  "previousDigest",
];

/**
 * journal行の`planGeneration`を構造検査する。Step 9・10にだけ許し、exact keyと
 * digestの計算式を検査する（封印との連結は`latestPlanGeneration`が見る）。
 */
export function parsePlanGeneration(input: {
  value: unknown;
  step: unknown;
  label: string;
}): { value?: PlanGeneration; errors: string[] } {
  const label = `${input.label}.planGeneration`;
  if (input.step !== 9 && input.step !== 10)
    return { errors: [`${label}はStep 9・10にだけ指定できます`] };
  const value = input.value;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { errors: [`${label}はobjectが必要です`] };
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(PLAN_GENERATION_FIELDS)
  )
    return {
      errors: [
        `${label}のfield集合は${PLAN_GENERATION_FIELDS.join("、")}が必要です`,
      ],
    };
  const { generation, previousDigest, amendments, digest } = record;
  const hex = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate);
  if (
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 1
  )
    return { errors: [`${label}.generationは1以上の整数が必要です`] };
  if (!hex(digest))
    return { errors: [`${label}.digestは64桁SHA-256が必要です`] };
  if (!Array.isArray(amendments))
    return { errors: [`${label}.amendmentsは配列が必要です`] };
  const parsed: PlanAmendmentDigest[] = [];
  for (const [index, item] of (amendments as unknown[]).entries()) {
    const expectedId = `AMD-${String(index + 1).padStart(3, "0")}`;
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      JSON.stringify(Object.keys(item).sort()) !==
        JSON.stringify(["digest", "id"]) ||
      (item as Record<string, unknown>).id !== expectedId ||
      !hex((item as Record<string, unknown>).digest)
    )
      return {
        errors: [
          `${label}.amendments[${index}]は{id: ${expectedId}, digest: 64桁SHA-256}が必要です`,
        ],
      };
    parsed.push({
      id: expectedId,
      digest: (item as { digest: string }).digest,
    });
  }
  if (generation === 1) {
    if (previousDigest !== null || parsed.length > 0)
      return {
        errors: [
          `${label}の世代1はpreviousDigest=nullと空のamendmentsが必要です`,
        ],
      };
  } else {
    if (!hex(previousDigest) || parsed.length === 0)
      return {
        errors: [
          `${label}の世代2以降は64桁SHA-256のpreviousDigestと1件以上のamendmentsが必要です`,
        ],
      };
    if (digest !== planGenerationDigest(previousDigest, parsed))
      return {
        errors: [
          `${label}.digestがpreviousDigestとamendmentsから計算した値と一致しません`,
        ],
      };
  }
  return {
    value: {
      generation,
      previousDigest: generation === 1 ? null : (previousDigest as string),
      amendments: parsed,
      digest,
    },
    errors: [],
  };
}

/**
 * 封印と現在のdigestを比べ、変化した計画文書を返す。現在値`undefined`は削除を表す。
 */
export function changedSealedArtifacts(
  seal: PlanSeal,
  current: Readonly<Record<string, string | undefined>>,
): string[] {
  return Object.keys(seal)
    .sort()
    .filter((name) => current[name] !== seal[name])
    .map((name) => (current[name] === undefined ? `${name}（削除）` : name));
}

export function planFrozenMessage(input: {
  sealStep: number;
  changed: readonly string[];
}): string {
  return `承認済み計画はStep ${input.sealStep}で封印済みのため変更できません。封印後に変化した計画文書: ${input.changed.join("、")}。計画文書（fullは00〜03、quick/pocは00）を封印時の内容へ戻し、計画の変更は${PLAN_AMENDMENT_FILE}へAMD-NNNとして追記してください`;
}

/**
 * staging digest不一致の診断に付ける説明。**判定は行わず、何が変わったかと
 * その状態で成立する次の行動だけを返す。**
 *
 * 記録は成果物一覧と集合digestだけを持つため、file単位で特定できるのは追加・削除と、
 * 封印（file単位のdigest）と比べた計画文書の変化である。それ以外の内容変化は
 * 「いずれかのfile」と述べ、推測で名指ししない。
 *
 * 次の行動はjournalの記録状態で変わる。terminal delivery state（journalのStep 11、または
 * delivery stateの`merge-observed`・`step11-recorded`）ではdigestを再固定できないため
 * 内容を戻す。Step 10記録後は収束済みsessionが前進commitの無い追加roundを拒否するため、
 * stagingだけの変更は戻すしかない。Step 9記録後は`review round`が現在の成果物へdigestを
 * 再固定する。それより前は最新Stepの再記録がdigestを更新する。旧来の上流再確定
 * （`--reconfirm`）は廃止した（REQ-WF-036）。
 */
export function stagingDriftDiagnostic(input: {
  added: readonly string[];
  removed: readonly string[];
  changedPlanning: readonly string[];
  recordedSteps: Iterable<number>;
  terminalDelivery?: boolean;
}): string {
  const steps = new Set(input.recordedSteps);
  const changes = [
    ...(input.added.length > 0 ? [`追加 ${input.added.join("、")}`] : []),
    ...(input.removed.length > 0 ? [`削除 ${input.removed.join("、")}`] : []),
    ...(input.changedPlanning.length > 0
      ? [`封印済み計画 ${input.changedPlanning.join("、")}`]
      : []),
  ];
  const parts = [
    changes.length > 0
      ? `変化した成果物: ${changes.join("; ")}`
      : "成果物一覧は同じで、いずれかのfileの内容が変化しています",
  ];
  if (input.changedPlanning.length > 0)
    parts.push(
      `承認済み計画は封印済みです。${input.changedPlanning.join("、")}を封印時の内容へ戻し、計画の変更は${PLAN_AMENDMENT_FILE}へAMD-NNNとして追記してください`,
    );
  if (input.terminalDelivery === true || steps.has(11))
    parts.push(
      "terminal delivery stateではstagingのdigestを再固定できません。編集した成果物を編集前の内容へ戻してください",
    );
  else if (steps.has(10))
    parts.push(
      "Step 10記録後にstaging digestを再固定するのは、前進commitを伴う新しいreview roundだけです（再固定後にStep 10を再記録します）。stagingだけの変更は編集前の内容へ戻してください",
    );
  else if (steps.has(9))
    parts.push(
      "review roundを実行するとstaging digestが現在の成果物へ再固定されます",
    );
  else
    parts.push(
      "workflow record --step=<最新のStep> を再実行してdigestを更新してから再試行してください",
    );
  return `。${parts.join("。")}`;
}

/**
 * 計画変更記録は判断だけを書く。変更前の記述は封印済み計画から、影響範囲は影響集合から
 * 導出できるため書かせない。
 */
export const PLAN_AMENDMENT_FIELDS = Object.freeze(["対象", "変更", "理由"]);

/**
 * `05_計画変更.md`の構造検査。**履歴はGitが所有するため、ここでは形だけを見る。**
 * `## AMD-NNN`見出しが001から欠番・重複なく昇順に並び、各entryが3項目（対象・変更・理由）を
 * 空でない値（`（…）`だけのplaceholderを除く）で持つことを要求する。
 */
export function validatePlanAmendment(markdown: string): {
  valid: boolean;
  ids: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const ids: string[] = [];
  const entries: Array<{ id: string; lines: string[] }> = [];
  let current: { id: string; lines: string[] } | undefined;
  let fenced = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^##\s/u.test(line)) {
      current = undefined;
      const heading = /^##\s+(AMD-\S*)/u.exec(line);
      if (!heading) continue;
      const id = heading[1] ?? "";
      if (!/^AMD-\d{3}$/u.test(id)) {
        errors.push(
          `${PLAN_AMENDMENT_FILE}の見出し${id}はAMD-NNN形式が必要です`,
        );
        continue;
      }
      current = { id, lines: [] };
      entries.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  entries.forEach((entry, index) => {
    ids.push(entry.id);
    const expected = `AMD-${String(index + 1).padStart(3, "0")}`;
    if (entry.id !== expected)
      errors.push(
        `${PLAN_AMENDMENT_FILE}の${entry.id}は${expected}であるべきです。entryは001から欠番・重複なく昇順に追記し、既存entryを削除・並べ替えしません`,
      );
    for (const field of PLAN_AMENDMENT_FIELDS) {
      const matched = entry.lines
        .map((line) => new RegExp(`^- ${field}:(.*)$`, "u").exec(line))
        .find((candidate) => candidate !== null);
      const value = matched?.[1]?.trim() ?? "";
      if (value === "" || /^（[^）]*）$/u.test(value))
        errors.push(
          `${PLAN_AMENDMENT_FILE}の${entry.id}に${field}がありません`,
        );
    }
  });
  return { valid: errors.length === 0, ids, errors };
}
