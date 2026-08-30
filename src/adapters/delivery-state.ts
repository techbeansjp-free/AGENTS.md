import fs from "node:fs";
import path from "node:path";
import {
  DELIVERY_STATE_FILE,
  bindPullRequest,
  claimMergeDispatch,
  claimPullRequestCreationDispatch,
  observeMerge,
  parseDeliveryState,
  prepareMergeIntent,
  preparePullRequestCreation,
  recordStep11,
  renderDeliveryState,
  requireDeliveryReconciliation,
  type DeliveryCreateIntent,
  type DeliveryCreateIntentInput,
  type DeliveryState,
  type MergeIntentInput,
  type MergeObservation,
  type PullRequestBinding,
  type ReconciliationRecord,
  type Step11Record,
} from "../domain/delivery-state.js";
import {
  refreshStoredStagingDigest,
  STAGING_RECORD_FILE,
  withStagingMutationLock,
} from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { stableJson } from "../lib/security.js";
import { assertWorkflowStaging } from "./workflow-journal.js";

function fsyncFile(file: string): void {
  const descriptor = fs.openSync(file, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function deliveryFile(staging: string): string {
  return path.join(staging, ...DELIVERY_STATE_FILE.split("/"));
}

function assertDeliveryDirectory(staging: string): string {
  const directory = path.dirname(deliveryFile(staging));
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("delivery stateの親はsymlinkでない通常directoryが必要です");
  if (fs.realpathSync(directory) !== directory)
    throw new Error("delivery stateの親にsymlink祖先を使用できません");
  return directory;
}

function readLocked(staging: string): DeliveryState | undefined {
  const file = deliveryFile(staging);
  if (!fs.existsSync(file)) return undefined;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("delivery stateはsymlinkでない通常fileが必要です");
  if (fs.realpathSync(file) !== file)
    throw new Error("delivery stateにsymlink祖先を使用できません");
  return parseDeliveryState(fs.readFileSync(file, "utf8"));
}

function persistLocked(staging: string, state: DeliveryState): DeliveryState {
  const directory = assertDeliveryDirectory(staging);
  const file = deliveryFile(staging);
  writeFileAtomic(file, renderDeliveryState(state));
  fsyncFile(file);
  fsyncDirectory(directory);
  refreshStoredStagingDigest(staging);
  fsyncFile(path.join(staging, STAGING_RECORD_FILE));
  fsyncDirectory(staging);
  const reread = readLocked(staging);
  if (!reread || stableJson(reread) !== stableJson(state))
    throw new Error("delivery stateの書き込み後読み取り確認に失敗しました");
  return reread;
}

function sameCreate(
  left: DeliveryCreateIntent,
  right: DeliveryCreateIntent,
): boolean {
  const { dispatchClaimedAt: _leftClaim, ...leftIdentity } = left;
  const { dispatchClaimedAt: _rightClaim, ...rightIdentity } = right;
  return stableJson(leftIdentity) === stableJson(rightIdentity);
}

export function readStoredDeliveryState(
  directory: string,
): DeliveryState | undefined {
  const staging = assertWorkflowStaging(directory);
  return readLocked(staging);
}

/**
 * 外部PR作成より前にcreate intentをdurable化する。同じintentの再読取だけを許し、
 * 異なるPR作成入力で既存stateを上書きしない。
 */
export function prepareStoredPullRequestCreation(
  directory: string,
  create: DeliveryCreateIntentInput,
): DeliveryState {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const prepared = preparePullRequestCreation(create);
    const current = readLocked(staging);
    if (!current) return persistLocked(staging, prepared);
    if (!sameCreate(current.create, prepared.create))
      throw new Error("既存delivery stateのPR作成identityと入力が一致しません");
    return current;
  });
}

/**
 * provider create直前にone-shot claimをfsyncする。dispatchAllowed=trueを得た
 * 呼出元だけが外部createを1回呼べる。claim後は成否不明でも再claimできない。
 */
export function claimStoredPullRequestCreationDispatch(
  directory: string,
  claimedAt: string,
): { state: DeliveryState; dispatchAllowed: boolean } {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current)
      throw new Error("PR create dispatchより前のintentがありません");
    if (current.state !== "create-prepared")
      return { state: current, dispatchAllowed: false };
    if (current.create.dispatchClaimedAt !== null)
      return { state: current, dispatchAllowed: false };
    return {
      state: persistLocked(
        staging,
        claimPullRequestCreationDispatch(current, claimedAt),
      ),
      dispatchAllowed: true,
    };
  });
}

export function bindStoredPullRequest(
  directory: string,
  binding: PullRequestBinding,
): DeliveryState {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current)
      throw new Error("PR bindingより前のcreate intentがありません");
    if (current.pr) {
      if (stableJson(current.pr) !== stableJson(binding))
        throw new Error("固定済みPR bindingを変更できません");
      return current;
    }
    return persistLocked(staging, bindPullRequest(current, binding));
  });
}

export function prepareStoredMergeIntent(
  directory: string,
  merge: MergeIntentInput,
): { state: DeliveryState; requestAllowed: boolean } {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current) throw new Error("mergeより前のdelivery stateがありません");
    if (current.state === "pr-bound")
      return {
        state: persistLocked(staging, prepareMergeIntent(current, merge)),
        requestAllowed: true,
      };
    if (!current.merge)
      throw new Error(`${current.state}にmerge intentがありません`);
    const {
      dispatchClaimedAt: _dispatchClaim,
      observation: _observation,
      ...currentIdentity
    } = current.merge;
    if (stableJson(currentIdentity) !== stableJson(merge))
      throw new Error("既存merge intentのimmutable identityを変更できません");
    return {
      state: current,
      requestAllowed: current.merge.dispatchClaimedAt === null,
    };
  });
}

/** merge provider callにもcreateと同じdurable one-shot claimを適用する。 */
export function claimStoredMergeDispatch(
  directory: string,
  claimedAt: string,
): { state: DeliveryState; dispatchAllowed: boolean } {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current) throw new Error("merge dispatchより前のintentがありません");
    if (current.state !== "merge-prepared" || !current.merge)
      return { state: current, dispatchAllowed: false };
    if (current.merge.dispatchClaimedAt !== null)
      return { state: current, dispatchAllowed: false };
    return {
      state: persistLocked(staging, claimMergeDispatch(current, claimedAt)),
      dispatchAllowed: true,
    };
  });
}

export function observeStoredMerge(
  directory: string,
  observation: Omit<MergeObservation, "observationId">,
): DeliveryState {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current) throw new Error("merge observationより前のstateがありません");
    const next = observeMerge(current, observation);
    return next === current ? current : persistLocked(staging, next);
  });
}

export function recordStoredStep11(
  directory: string,
  input: Omit<Step11Record, "evidenceId">,
): DeliveryState {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current) throw new Error("Step 11より前のdelivery stateがありません");
    if (current.step11) {
      if (
        current.step11.outcome !== input.outcome ||
        current.step11.recordedAt !== input.recordedAt ||
        current.step11.journalDigest !== input.journalDigest
      )
        throw new Error("記録済みStep 11 evidenceを変更できません");
      return current;
    }
    return persistLocked(staging, recordStep11(current, input));
  });
}

export function requireStoredDeliveryReconciliation(
  directory: string,
  input: ReconciliationRecord,
): DeliveryState {
  const staging = assertWorkflowStaging(directory);
  return withStagingMutationLock(staging, () => {
    const current = readLocked(staging);
    if (!current) throw new Error("照合対象のdelivery stateがありません");
    if (current.state === "reconciliation-required") return current;
    return persistLocked(
      staging,
      requireDeliveryReconciliation(current, input),
    );
  });
}
