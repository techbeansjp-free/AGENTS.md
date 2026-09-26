/**
 * Decision Type Registryのdeterministic resolver実体（Issue #1485、L-01）。
 *
 * DCAND-001〜005は既存compiled codeを**そのまま**呼ぶだけのwrapperであり、
 * 判定内容を1つも変えない。既存の呼び出し元（`issue.ts`・`cli.ts`・
 * `review-artifact.ts`・`policy.ts`）はこれらのresolverを経由せず、直接
 * 既存関数を呼び続ける（L-01「現在の呼び出し元の挙動を変えない」）。
 *
 * DCAND-008は本Issueで新設するdeterministic resolverであり、
 * `.agent-skill-chain/docs/01_開発ワークフロー.md`「CodeRabbitの利用枠制限は」
 * 節の基準（対象PRの最新HEADに対する明示的なrate limit観測だけを証拠にし、
 * checkの不在・過去HEADの通知・単なるreview待ちは証拠にしない）を機械化する。
 * 確定できない場合は`"unknown"`を返し、呼び出し側（`decision-invoke.ts`）が
 * providerへadvisoryで委譲する。
 */
import { detectQuickDisqualifiers, } from "./mode.js";
import { inspectCiDelivery, } from "./ci-delivery.js";
import { requiresSpecUpdate } from "./spec.js";
import { auditRowDraft } from "./review-artifact.js";
import { hasConcreteDecisionText } from "./policy.js";
export function resolveDcand001(input) {
    return detectQuickDisqualifiers([...input.changedFiles]);
}
export function resolveDcand002(input) {
    return inspectCiDelivery(input);
}
export function resolveDcand003(input) {
    return requiresSpecUpdate(input.changedFiles);
}
export function resolveDcand004(input) {
    return auditRowDraft(input.path, input.changeType);
}
export function resolveDcand005(input) {
    return hasConcreteDecisionText(input.value, input.minimum);
}
const RATE_LIMIT_PATTERN = /rate.?limit|usage limit|quota exceeded|利用枠|レート制限|上限に達/iu;
/**
 * `checkの不在、過去HEADの通知、単なるreview待ちは制限の証拠にしない`
 * （`01_開発ワークフロー.md`）を機械化する。**最新HEADを対象にした観測だけ**
 * を見る（`targetHeadSha !== latestHeadSha`は無視する＝過去HEAD通知の除外）。
 */
export function resolveDcand008(input) {
    const relevant = input.observations.filter((observation) => observation.targetHeadSha === input.latestHeadSha);
    const limited = relevant.filter((observation) => RATE_LIMIT_PATTERN.test(observation.text));
    if (limited.length > 0)
        return { value: "confirmed-limited", matchedObservations: limited };
    // 単なるreview待ち（review-pending）やnotificationだけでは「制限が無い」証拠にも
    // ならない。check-run・reviewという実際に完了した活動が最新HEADに存在し、かつ
    // rate limit言及が無い場合だけ`no-limit-evidence`とする。
    const completedActivity = relevant.filter((observation) => observation.kind === "check-run" || observation.kind === "review");
    if (completedActivity.length > 0)
        return { value: "no-limit-evidence", matchedObservations: completedActivity };
    return { value: "unknown", matchedObservations: [] };
}
//# sourceMappingURL=decision-resolvers.js.map