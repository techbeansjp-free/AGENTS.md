/**
 * `EvaluationLabel`のfile I/O（Issue #1486、T-03）。
 *
 * 永続方針は`src/adapters/decision-journal-store.ts`と同じ
 * （primaryRoot固定・`withStagingMutationLock`再利用・append-only）。
 * decision journal本体とは別file（`evaluation-labels.jsonl`）に置き、
 * 既存journal schema・既存読み手へ影響しない。
 *
 * **参照先のdecisionRecordIdが実在しないlabelは拒否する（fail-closed）。**
 * 存在しないdecisionを指すlabelを記録できると、後の集計（S-00の
 * precision/recall）が架空のdecisionRecordIdを紛れ込ませたまま実行できて
 * しまう。
 */
import fs from "node:fs";
import path from "node:path";
import { withStagingMutationLock } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import {
  parseEvaluationLabelInput,
  type EvaluationLabel,
} from "../domain/evaluation-label.js";
import { findDecisionJournalRecord } from "./decision-journal-store.js";

export const EVALUATION_LABEL_DIRECTORY =
  ".agent-skill-chain/runtime/decisions";

function labelDirectory(primaryRoot: string, id: string): string {
  return path.join(primaryRoot, EVALUATION_LABEL_DIRECTORY, path.basename(id));
}

function labelPath(primaryRoot: string, id: string): string {
  return path.join(labelDirectory(primaryRoot, id), "evaluation-labels.jsonl");
}

export function readEvaluationLabels(
  primaryRoot: string,
  id: string,
): { labels: EvaluationLabel[]; errors: string[] } {
  const file = labelPath(primaryRoot, id);
  if (!fs.existsSync(file)) return { labels: [], errors: [] };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(
      "evaluation label journalはsymlinkでない通常fileが必要です",
    );
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const labels: EvaluationLabel[] = [];
  const errors: string[] = [];
  lines.forEach((line, index) => {
    try {
      labels.push(parseEvaluationLabelInput(JSON.parse(line)));
    } catch (error) {
      errors.push(
        `line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return { labels, errors };
}

export function findEvaluationLabel(
  primaryRoot: string,
  id: string,
  decisionRecordId: string,
): EvaluationLabel | undefined {
  const { labels, errors } = readEvaluationLabels(primaryRoot, id);
  if (errors.length > 0)
    throw new Error(
      `evaluation label journal（${id}）に不正な行があるため参照できません: ${errors.join("; ")}`,
    );
  return labels.find((label) => label.decisionRecordId === decisionRecordId);
}

/**
 * 1件追記する。**書き込み前に対象decisionRecordIdがdecision journalへ
 * 実在することを確認する（fail-closed）。** 既にlabel済みのdecisionRecordId
 * への再記録は拒否する（1 decisionRecordIdにつきlabelは1件。上書きしたい
 * 場合は将来の設計判断とし、本Issueでは「後から確定した正解を後追いで
 * 書き換えない」というEvidence-driven Verificationの原則をそのまま適用する）。
 */
export function appendEvaluationLabel(
  primaryRoot: string,
  id: string,
  label: EvaluationLabel,
): void {
  const existingDecision = findDecisionJournalRecord(
    primaryRoot,
    id,
    label.decisionRecordId,
  );
  if (existingDecision === undefined)
    throw new Error(
      `decision journalに存在しないdecisionRecordIdへlabelを記録しようとしました: ${label.decisionRecordId}`,
    );
  const directory = labelDirectory(primaryRoot, id);
  fs.mkdirSync(directory, { recursive: true });
  withStagingMutationLock(directory, () => {
    const file = labelPath(primaryRoot, id);
    const existing = readEvaluationLabels(primaryRoot, id);
    if (existing.errors.length > 0)
      throw new Error(
        `evaluation label journalの既存内容が不正です: ${existing.errors.join("; ")}`,
      );
    if (
      existing.labels.some(
        (entry) => entry.decisionRecordId === label.decisionRecordId,
      )
    )
      throw new Error(
        `decisionRecordIdが既存evaluation label journalと重複しています: ${label.decisionRecordId}`,
      );
    const priorSource = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").replace(/\n$/u, "")
      : "";
    const nextSource =
      priorSource === ""
        ? `${JSON.stringify(label)}\n`
        : `${priorSource}\n${JSON.stringify(label)}\n`;
    writeFileAtomic(file, nextSource);
    const reread = readEvaluationLabels(primaryRoot, id);
    if (
      reread.errors.length > 0 ||
      !reread.labels.some(
        (entry) => entry.decisionRecordId === label.decisionRecordId,
      )
    )
      throw new Error(
        "evaluation label journalの書き込み後read-backが一致しません",
      );
  });
}
