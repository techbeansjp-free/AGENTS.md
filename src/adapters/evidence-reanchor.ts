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
import {
  observeStoredDeliveryState,
  readStoredDeliveryState,
} from "./delivery-state.js";
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
  comparison: ReanchorComparison,
  role: "旧H_impl→旧head" | "新H_impl→新head",
): { valid: boolean; gitFailure?: string } {
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
    observed = observeReanchorDiff(
      root,
      role,
      comparison,
      declared,
      head,
      declared,
    );
  } catch (error) {
    return {
      valid: false,
      gitFailure: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    valid:
      observed.changedPaths.length === 1 &&
      observed.changedPaths[0] === artifactPath,
  };
}

function terminalArtifactPath(paths: readonly string[]): string | undefined {
  const artifacts = paths.filter((entry) =>
    entry.startsWith(REVIEW_ARTIFACT_PREFIX),
  );
  /** **artifactが1件でない差分は同定できない。** 受理しない。 */
  return artifacts.length === 1 ? artifacts[0] : undefined;
}

interface ReanchorComparison {
  oldBaseSha: string;
  oldHeadSha: string;
  newBaseSha: string;
  newHeadSha: string;
}

/**
 * 再固定で行うGit比較へ、その比較の役割と固定中の4 SHAを付ける。
 *
 * `observeReviewDiff`は汎用adapterなので変更せず、再固定固有の診断だけをここで
 * 合成する。artifact本文やstate全体は診断へ出さない。
 */
function observeReanchorDiff(
  root: string,
  role:
    | "旧base→旧head"
    | "新base→新head"
    | "旧H_impl→旧head"
    | "新H_impl→新head"
    | "旧base→旧H_impl"
    | "新base→新H_impl",
  comparison: ReanchorComparison,
  baseSha: string,
  headSha: string,
  implementationSha?: string,
): { digest: string; changedPaths: readonly string[] } {
  try {
    return observeReviewDiff(root, baseSha, headSha);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `再固定のGit比較に失敗しました（役割=${role}, oldBaseSha=${comparison.oldBaseSha}, oldHeadSha=${comparison.oldHeadSha}, newBaseSha=${comparison.newBaseSha}, newHeadSha=${comparison.newHeadSha}${implementationSha === undefined ? "" : `, H_impl=${implementationSha}`}）: ${detail}`,
      { cause: error },
    );
  }
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
): {
  reason:
    | RebaseEquivalenceReason
    | "artifact-not-unique"
    | "artifact-unreadable"
    | "base-mismatch"
    | "boundary-mismatch";
  gitFailure?: string;
} {
  const beforeAll = observeReanchorDiff(
    root,
    "旧base→旧head",
    input,
    input.oldBaseSha,
    input.oldHeadSha,
  );
  const afterAll = observeReanchorDiff(
    root,
    "新base→新head",
    input,
    input.newBaseSha,
    input.newHeadSha,
  );
  const beforePath = terminalArtifactPath(beforeAll.changedPaths);
  const afterPath = terminalArtifactPath(afterAll.changedPaths);
  if (beforePath === undefined || afterPath === undefined)
    return { reason: "artifact-not-unique" };
  const beforeArtifact = readBlobAtCommit(root, input.oldHeadSha, beforePath);
  const afterArtifact = readBlobAtCommit(root, input.newHeadSha, afterPath);
  if (beforeArtifact === undefined || afterArtifact === undefined)
    return { reason: "artifact-unreadable" };
  const beforeAnchor = parseReviewIdentityAnchor(beforeArtifact);
  const afterAnchor = parseReviewIdentityAnchor(afterArtifact);
  if (beforeAnchor === undefined || afterAnchor === undefined)
    return { reason: "identity-unresolvable" };
  /** **宣言した比較基点が再固定の基点と一致することを要求する。** */
  if (
    beforeAnchor.base !== input.oldBaseSha ||
    afterAnchor.base !== input.newBaseSha
  )
    return { reason: "base-mismatch" };
  const beforeBoundary = verifiedImplementationBoundary(
    root,
    input.oldHeadSha,
    beforePath,
    beforeAnchor.implementation,
    input,
    "旧H_impl→旧head",
  );
  if (!beforeBoundary.valid)
    return {
      reason: "boundary-mismatch",
      gitFailure: beforeBoundary.gitFailure,
    };
  const afterBoundary = verifiedImplementationBoundary(
    root,
    input.newHeadSha,
    afterPath,
    afterAnchor.implementation,
    input,
    "新H_impl→新head",
  );
  if (!afterBoundary.valid)
    return {
      reason: "boundary-mismatch",
      gitFailure: afterBoundary.gitFailure,
    };
  return {
    reason: isRebaseEquivalent({
      beforeImplementation: observeReanchorDiff(
        root,
        "旧base→旧H_impl",
        input,
        input.oldBaseSha,
        beforeAnchor.implementation,
        beforeAnchor.implementation,
      ),
      afterImplementation: observeReanchorDiff(
        root,
        "新base→新H_impl",
        input,
        input.newBaseSha,
        afterAnchor.implementation,
        afterAnchor.implementation,
      ),
      beforeArtifact,
      afterArtifact,
      beforeArtifactPath: beforePath,
      afterArtifactPath: afterPath,
    }),
  };
}

function resolveAnchor(
  staging: string,
  layer: EvidenceReanchorLayer,
): { anchoredHeadSha: string; anchoredBaseSha: string } {
  const deliveryState = observeStoredDeliveryState(staging);
  if (layer === "delivery") {
    const state = deliveryState;
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
  if (deliveryState?.create)
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

export interface EvidenceReanchorEvaluation extends EvidenceReanchorResult {
  oldHeadSha: string;
  oldBaseSha: string;
  diffDigest: string | undefined;
}

function validateEvidenceReanchorInput(input: {
  newHeadSha: string;
  newBaseSha: string;
  reason: string;
}): void {
  for (const [label, oid] of [
    ["--new-head", input.newHeadSha],
    ["--new-base", input.newBaseSha],
  ] as const)
    if (!OID.test(oid))
      throw new Error(`${label}は小文字40桁のGit SHAで指定してください`);
  if (input.reason.trim() === "")
    throw new Error("再固定の理由を指定してください");
}

/** 再固定の既存受理条件を、永続書込みなしで評価する。 */
export function evaluateEvidenceReanchor(input: {
  staging: string;
  root: string;
  layer: EvidenceReanchorLayer;
  newHeadSha: string;
  newBaseSha: string;
  reason: string;
}): EvidenceReanchorEvaluation {
  const staging = assertWorkflowStaging(input.staging);
  validateEvidenceReanchorInput(input);
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
      oldHeadSha,
      oldBaseSha,
      diffDigest: undefined,
    };
  if (oldHeadSha === input.newHeadSha)
    throw new Error("再固定は移動していないheadに対して行えません");
  const comparison = {
    oldBaseSha,
    oldHeadSha,
    newBaseSha: input.newBaseSha,
    newHeadSha: input.newHeadSha,
  };
  const before = observeReanchorDiff(
    input.root,
    "旧base→旧head",
    comparison,
    oldBaseSha,
    oldHeadSha,
  );
  const after = observeReanchorDiff(
    input.root,
    "新base→新head",
    comparison,
    input.newBaseSha,
    input.newHeadSha,
  );
  if (!isContentEquivalent(before, after)) {
    const rebase = observeRebaseEquivalence(input.root, comparison);
    if (rebase.reason !== "ok")
      throw new Error(
        `再固定前後の内容が等価ではありません（${rebase.reason}）: before=${before.digest} after=${after.digest}${rebase.gitFailure === undefined ? "" : `; ${rebase.gitFailure}`}`,
      );
  }
  return {
    chain: existing,
    effectiveHeadSha: input.newHeadSha,
    appended: true,
    oldHeadSha,
    oldBaseSha,
    diffDigest: before.digest,
  };
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
  /** input拒否で既存transaction復旧やlock作成へ進まない旧順序を保つ。 */
  validateEvidenceReanchorInput(input);
  return withStagingMutationLock(staging, () => {
    /** applyだけが既存delivery transactionをlock内で復旧してから最新stateを評価する。 */
    readStoredDeliveryState(staging);
    const evaluation = evaluateEvidenceReanchor(input);
    if (!evaluation.appended)
      return {
        chain: evaluation.chain,
        effectiveHeadSha: evaluation.effectiveHeadSha,
        appended: false,
      };
    const record: EvidenceReanchorRecord = {
      oldHeadSha: evaluation.oldHeadSha,
      newHeadSha: input.newHeadSha,
      oldBaseSha: evaluation.oldBaseSha,
      newBaseSha: input.newBaseSha,
      diffDigest: evaluation.diffDigest as string,
      method: "rebase",
      reason: input.reason,
      recordedAt: input.recordedAt,
    };
    const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
    const next = [...evaluation.chain, record];
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
