import crypto from "node:crypto";

import { isRecord, type ProjectChoiceShrinkProposal } from "../types.js";
import {
  MONOTONIC_SHRINK_REASON_PREFIX,
  type ProjectChoiceDiff,
} from "./project-choice-diff.js";

/**
 * 縮小提案で受理できる対象field。
 *
 * **owner決裁がこの3つに限ると定めている。** 追加には別のowner決裁が要る。
 */
const SHRINKABLE_FIELD_PATHS: readonly string[] = Object.freeze([
  "projectChoices.testLayers",
  "projectChoices.forbiddenTestFileSuffixes",
  "projectChoices.quality.forbiddenTypes",
]);

/**
 * 要素削除を表す弱化entryの理由接頭辞。
 *
 * **同じfieldPathでも型契約違反のentryは受理候補にしない。** 決裁が受理を許すのは
 * 縮小だけであり、型契約違反は縮小ではない。文言は分類器から共有し複製しない。
 */
const SHRINK_REASON_PREFIX = MONOTONIC_SHRINK_REASON_PREFIX;

const SHA256 = /^[a-f0-9]{64}$/u;

export interface AcceptedShrink {
  fieldPath: string;
  fragmentPath: string;
  proposedSha256: string;
  observedSha256: string;
}

export interface ShrinkAcceptance {
  accepted: AcceptedShrink[];
  remaining: string[];
}

function isProposal(value: unknown): value is ProjectChoiceShrinkProposal {
  return (
    isRecord(value) &&
    typeof value.fieldPath === "string" &&
    typeof value.afterSha256 === "string" &&
    SHA256.test(value.afterSha256) &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    typeof value.owner === "string" &&
    value.owner.trim().length > 0
  );
}

function shrinkFieldPath(entry: string): string | undefined {
  return SHRINKABLE_FIELD_PATHS.find((fieldPath) =>
    entry.startsWith(`${fieldPath}: ${SHRINK_REASON_PREFIX}`),
  );
}

/**
 * 弱化と分類された差分のうち、既定branch側の登録済み提案とchoices fragment fileの
 * raw byteで一致するものを受理へ移す。
 *
 * **提案は`trustedProposals`からのみ読む。** 候補側の同名fieldを引数に取らないため、
 * 候補が同一PRで登録した提案を受理判断に使う経路が構造として存在しない。
 *
 * `candidateChoicesRaw`が`undefined`のときは1件も受理しない。legacy monolith policyは
 * choices fragmentを持たずraw byte列を取得できないため、この経路では判定が
 * 変更前と完全に同一になる。
 */
/**
 * 受理しなかった弱化entryへ、比較したfragment file pathと両sha256を添える。
 *
 * **FR-1044-09が要求する記録の担い手である。** 提案が無い場合は観測値だけを添える。
 */
function describeRejection(
  entry: string,
  observation: {
    fragmentPath: string | undefined;
    observedSha256: string | undefined;
    proposedSha256: string | undefined;
    malformed: number;
  },
): string {
  if (
    observation.fragmentPath === undefined ||
    observation.observedSha256 === undefined
  )
    return entry;
  const proposed =
    observation.proposedSha256 === undefined
      ? "登録済み提案なし"
      : `提案のsha256は${observation.proposedSha256}`;
  const malformed =
    observation.malformed > 0
      ? `、形が不正で無視した提案が${observation.malformed}件`
      : "";
  return `${entry}（比較したchoices fragmentは${observation.fragmentPath}、観測したsha256は${observation.observedSha256}、${proposed}${malformed}）`;
}

export function acceptApprovedShrinks(input: {
  diff: ProjectChoiceDiff;
  trustedProposals: unknown;
  candidateChoicesRaw: string | undefined;
  choicesFragmentPath: string | undefined;
}): ShrinkAcceptance {
  const accepted: AcceptedShrink[] = [];
  const remaining: string[] = [];
  const declared = Array.isArray(input.trustedProposals)
    ? input.trustedProposals
    : [];
  const proposals = declared.filter(isProposal);
  /**
   * **形が不正な提案は落とすが、落とした事実は診断へ残す。**
   *
   * 黙って「登録済み提案なし」と返すと、登録側の誤りに気付けない。
   */
  const malformed = declared.length - proposals.length;
  const observedSha256 =
    input.candidateChoicesRaw === undefined
      ? undefined
      : crypto
          .createHash("sha256")
          .update(input.candidateChoicesRaw, "utf8")
          .digest("hex");
  for (const entry of input.diff.weakened) {
    const fieldPath = shrinkFieldPath(entry);
    /**
     * **同一fieldPathの提案が複数あれば全件と照合する。**
     *
     * 先頭だけを見ると、旧提案を残したまま再登録した場合に陳腐化した提案だけが
     * 比較され、正しい新提案があっても拒否される。
     */
    const candidates =
      fieldPath === undefined
        ? []
        : proposals.filter((item) => item.fieldPath === fieldPath);
    const proposal =
      candidates.find(
        (item) => item.afterSha256.toLowerCase() === observedSha256,
      ) ?? candidates[0];
    if (
      fieldPath === undefined ||
      proposal === undefined ||
      observedSha256 === undefined ||
      input.choicesFragmentPath === undefined ||
      proposal.afterSha256.toLowerCase() !== observedSha256
    ) {
      remaining.push(
        describeRejection(entry, {
          fragmentPath: input.choicesFragmentPath,
          observedSha256,
          proposedSha256: proposal?.afterSha256.toLowerCase(),
          malformed,
        }),
      );
      continue;
    }
    accepted.push({
      fieldPath,
      fragmentPath: input.choicesFragmentPath,
      proposedSha256: proposal.afterSha256.toLowerCase(),
      observedSha256,
    });
  }
  return { accepted, remaining };
}
