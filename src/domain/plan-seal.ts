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
): { step: number; seal: PlanSeal } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.planSeal) return { step: entry.step, seal: entry.planSeal };
  }
  return undefined;
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

export const PLAN_AMENDMENT_FIELDS = Object.freeze([
  "対象",
  "Before",
  "After",
  "理由",
  "影響する契約",
  "影響範囲",
]);

/**
 * `05_計画変更.md`の構造検査。**履歴はGitが所有するため、ここでは形だけを見る。**
 * `## AMD-NNN`見出しが001から欠番・重複なく昇順に並び、各entryが6項目を
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
