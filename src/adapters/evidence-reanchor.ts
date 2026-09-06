import fs from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict } from "../lib/security.js";
import {
  deriveEffectiveHead,
  isContentEquivalent,
  isRebaseEquivalent,
  parseReviewIdentityAnchor,
  type RebaseEquivalenceReason,
  isEvidenceReanchorRecord,
  type EvidenceReanchorRecord,
} from "../domain/evidence-reanchor.js";
import {
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import { readStoredDeliveryState } from "./delivery-state.js";
import { observeReviewDiff, readBlobAtCommit } from "./review-diff.js";
import { readStoredReviewSession } from "./review-session-store.js";
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
/** review artifactのpathとみなす接頭辞。`audit:check`の`AUDIT_DIRECTORY`と同じ。 */
const REVIEW_ARTIFACT_PREFIX = "docs/reviews/";

/**
 * 宣言された`H_impl`を構造で検証する。
 *
 * **caller申告を信用しない。** `H_impl..head`が当該artifact 1件だけであることを
 * Git objectから確かめる。宣言が偽なら不一致になり受理されない（Issue #1172）。
 */
function verifiedImplementationBoundary(
  root: string,
  head: string,
  artifactPath: string,
  declared: string,
): boolean {
  /**
   * **Git観測の失敗を例外のまま外へ出さない。**
   *
   * `parseReviewIdentityAnchor`は40桁hexの書式だけを見るため、**存在しないSHAも
   * 通す。** その値で`observeReviewDiff`を呼ぶと`git rev-parse`が失敗して例外になり、
   * 拒否理由へ変換されないまま呼び出し元へ伝播する（Issue #1172、外部review）。
   * **同定できない入力は理由つきで拒否する。**
   */
  let observed;
  try {
    observed = observeReviewDiff(root, declared, head);
  } catch {
    return false;
  }
  return (
    observed.changedPaths.length === 1 &&
    observed.changedPaths[0] === artifactPath
  );
}

function terminalArtifactPath(paths: readonly string[]): string | undefined {
  const artifacts = paths.filter((entry) =>
    entry.startsWith(REVIEW_ARTIFACT_PREFIX),
  );
  /** **artifactが1件でない差分は同定できない。** 受理しない。 */
  return artifacts.length === 1 ? artifacts[0] : undefined;
}

/**
 * rebase後の再固定に限って成立する二層の等価性を観測する。
 *
 * 判定材料はすべてGit objectから再計算する。記録も申告も根拠にしない。
 */
function observeRebaseEquivalence(
  root: string,
  input: {
    oldBaseSha: string;
    oldHeadSha: string;
    newBaseSha: string;
    newHeadSha: string;
  },
):
  | RebaseEquivalenceReason
  | "artifact-not-unique"
  | "artifact-unreadable"
  | "base-mismatch"
  | "boundary-mismatch" {
  const beforeAll = observeReviewDiff(root, input.oldBaseSha, input.oldHeadSha);
  const afterAll = observeReviewDiff(root, input.newBaseSha, input.newHeadSha);
  const beforePath = terminalArtifactPath(beforeAll.changedPaths);
  const afterPath = terminalArtifactPath(afterAll.changedPaths);
  if (beforePath === undefined || afterPath === undefined)
    return "artifact-not-unique";
  const beforeArtifact = readBlobAtCommit(root, input.oldHeadSha, beforePath);
  const afterArtifact = readBlobAtCommit(root, input.newHeadSha, afterPath);
  if (beforeArtifact === undefined || afterArtifact === undefined)
    return "artifact-unreadable";
  const beforeAnchor = parseReviewIdentityAnchor(beforeArtifact);
  const afterAnchor = parseReviewIdentityAnchor(afterArtifact);
  if (beforeAnchor === undefined || afterAnchor === undefined)
    return "identity-unresolvable";
  /** **宣言した比較基点が再固定の基点と一致することを要求する。** */
  if (
    beforeAnchor.base !== input.oldBaseSha ||
    afterAnchor.base !== input.newBaseSha
  )
    return "base-mismatch";
  if (
    !verifiedImplementationBoundary(
      root,
      input.oldHeadSha,
      beforePath,
      beforeAnchor.implementation,
    ) ||
    !verifiedImplementationBoundary(
      root,
      input.newHeadSha,
      afterPath,
      afterAnchor.implementation,
    )
  )
    return "boundary-mismatch";
  return isRebaseEquivalent({
    beforeImplementation: observeReviewDiff(
      root,
      input.oldBaseSha,
      beforeAnchor.implementation,
    ),
    afterImplementation: observeReviewDiff(
      root,
      input.newBaseSha,
      afterAnchor.implementation,
    ),
    beforeArtifact,
    afterArtifact,
    beforeArtifactPath: beforePath,
    afterArtifactPath: afterPath,
  });
}

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
    if (!isContentEquivalent(before, after)) {
      /**
       * **完全一致しない場合だけ、二層の等価性へ落とす。**
       *
       * ASCの規定するrebase手順は`audit:check`のためにreview artifactのSHA行の
       * 更新を要求する。完全diff digestは`base..H_final`全体を見るため、その1行で
       * 必ず不一致になる。**両者の要求が同時に満たせない**（Issue #1172）。
       *
       * **緩めるのは機械導出される2欄だけである。** 実装差分は`base..H_impl`の
       * 完全diff digestで従来どおり一致を要求し、artifactは2欄を正規化した
       * byte一致を要求する。**同定できない入力は受理しない。**
       */
      const rebase = observeRebaseEquivalence(input.root, {
        oldBaseSha,
        oldHeadSha,
        newBaseSha: input.newBaseSha,
        newHeadSha: input.newHeadSha,
      });
      if (rebase !== "ok")
        throw new Error(
          `再固定前後の内容が等価ではありません（${rebase}）: before=${before.digest} after=${after.digest}`,
        );
    }
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
