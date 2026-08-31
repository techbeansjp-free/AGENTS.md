import fs from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict } from "../lib/security.js";
import {
  deriveEffectiveHead,
  isContentEquivalent,
  isEvidenceReanchorRecord,
  type EvidenceReanchorRecord,
} from "../domain/evidence-reanchor.js";
import {
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import { readStoredDeliveryState } from "./delivery-state.js";
import {
  observeReviewDiff,
  readStoredReviewSession,
} from "./review-session.js";
import { assertWorkflowStaging } from "./workflow-journal.js";

export const EVIDENCE_REANCHOR_FILE = "journal/reanchor.jsonl";

const OID = /^[a-f0-9]{40}$/u;

export type EvidenceReanchorLayer = "delivery" | "review";

/**
 * 追記済みの再固定chainを読む。
 *
 * **fileが無い場合は空のchainとして扱う。** 再固定記録を持たない既存stateの判定を
 * 変更前と完全に同一にするためである。
 */
export function readEvidenceReanchorChain(
  stagingInput: string,
): EvidenceReanchorRecord[] {
  const staging = assertWorkflowStaging(stagingInput);
  const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
  if (!fs.existsSync(file)) return [];
  const records: EvidenceReanchorRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const value = parseJsonStrict(line, "再固定記録");
    if (!isEvidenceReanchorRecord(value))
      throw new Error("再固定記録の形式が不正です");
    records.push(value);
  }
  return records;
}

/**
 * 層ごとの固定済みanchorを耐久stateから導出する。
 *
 * **旧headと旧baseを利用者から受け取らない。** 任意の旧baseを選べると
 * 「旧diffと新diffが一致する」対を作れてしまい、未reviewのbase内容を含むheadへ
 * 証跡を移送できる。束縛先は既存stateにある。
 */
function resolveAnchor(
  staging: string,
  layer: EvidenceReanchorLayer,
): { anchoredHeadSha: string; anchoredBaseSha: string } {
  if (layer === "delivery") {
    const state = readStoredDeliveryState(staging);
    if (!state?.create)
      throw new Error(
        "pr reanchorには pr create で固定したdelivery stateが必要です",
      );
    if (state.state !== "step11-recorded")
      throw new Error(
        `delivery stateが${state.state}です。step11-recordedでない状態の復旧はpr createの再実行で行ってください`,
      );
    return {
      anchoredHeadSha: state.create.headSha,
      anchoredBaseSha: state.create.baseSha,
    };
  }
  if (readStoredDeliveryState(staging)?.create)
    throw new Error(
      "review reanchorはdelivery state固定後には使えません。pr reanchorを使ってください",
    );
  const session = readStoredReviewSession(staging);
  if (session === null)
    throw new Error("review reanchorには永続review sessionが必要です");
  if (session.status !== "converged")
    throw new Error(
      `review sessionが収束していません: status=${session.status}`,
    );
  return {
    anchoredHeadSha: session.latestCandidateHeadSha,
    anchoredBaseSha: session.anchor.diffBaseSha,
  };
}

export interface EvidenceReanchorResult {
  chain: readonly EvidenceReanchorRecord[];
  effectiveHeadSha: string;
  appended: boolean;
}

/**
 * 内容等価性を実証したうえで再固定記録を1件追記する。
 *
 * 既存の`journal/steps.jsonl`と`journal/delivery-state.json`へは書き込まない。
 * 追記後に`refreshStoredStagingDigest`を呼び、read-backで一致を確認する。
 */
export function appendEvidenceReanchor(input: {
  staging: string;
  root: string;
  layer: EvidenceReanchorLayer;
  newHeadSha: string;
  newBaseSha: string;
  reason: string;
  recordedAt: string;
}): EvidenceReanchorResult {
  const staging = assertWorkflowStaging(input.staging);
  for (const [label, oid] of [
    ["--new-head", input.newHeadSha],
    ["--new-base", input.newBaseSha],
  ] as const)
    if (!OID.test(oid))
      throw new Error(`${label}は小文字40桁のGit SHAで指定してください`);
  if (input.reason.trim() === "")
    throw new Error("再固定の理由を指定してください");
  return withStagingMutationLock(staging, () => {
    const anchor = resolveAnchor(staging, input.layer);
    const existing = readEvidenceReanchorChain(staging);
    const derived = deriveEffectiveHead({
      records: existing,
      anchoredHeadSha: anchor.anchoredHeadSha,
    });
    if (derived.invalidIndex !== undefined)
      throw new Error(
        `既存の再固定chainが${derived.invalidIndex}件目で連鎖していません`,
      );
    const oldHeadSha = derived.effectiveHeadSha;
    const oldBaseSha = existing.at(-1)?.newBaseSha ?? anchor.anchoredBaseSha;
    const terminal = existing.at(-1);
    if (
      terminal?.newHeadSha === input.newHeadSha &&
      terminal.newBaseSha === input.newBaseSha
    )
      return {
        chain: existing,
        effectiveHeadSha: derived.effectiveHeadSha,
        appended: false,
      };
    if (oldHeadSha === input.newHeadSha)
      throw new Error("再固定は移動していないheadに対して行えません");
    const before = observeReviewDiff(input.root, oldBaseSha, oldHeadSha);
    const after = observeReviewDiff(
      input.root,
      input.newBaseSha,
      input.newHeadSha,
    );
    if (!isContentEquivalent(before, after))
      throw new Error(
        `再固定前後の内容が等価ではありません: before=${before.digest} after=${after.digest}`,
      );
    const record: EvidenceReanchorRecord = {
      oldHeadSha,
      newHeadSha: input.newHeadSha,
      oldBaseSha,
      newBaseSha: input.newBaseSha,
      diffDigest: before.digest,
      method: "rebase",
      reason: input.reason,
      recordedAt: input.recordedAt,
    };
    const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
    const next = [...existing, record];
    writeFileAtomic(
      file,
      `${next.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { temporaryDirectory: path.dirname(staging) },
    );
    refreshStoredStagingDigest(staging);
    const reread = readEvidenceReanchorChain(staging);
    if (JSON.stringify(reread) !== JSON.stringify(next))
      throw new Error("再固定chainの書き込み後read-backが一致しません");
    return {
      chain: reread,
      effectiveHeadSha: record.newHeadSha,
      appended: true,
    };
  });
}
