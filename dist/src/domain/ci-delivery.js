/**
 * CI runの配送状態を、観測値だけから判定する。
 *
 * **判定は純関数である。** 永続状態を持たず、pollingせず、人間を自動で呼ばず、
 * mergeの門を新設しない。既存の拒否点は`conclusion === "success"`を要求しており、
 * run未生成・実行中・失敗のすべてが同じ「該当0件」へ潰れる。**そこで失われるのは
 * 安全性ではなく、待つべきか人を呼ぶべきかの判断基準である**（Issue #969）。
 */
/**
 * **猶予時間の既定値。**
 *
 * Issue #969 の実測では GitHub Actions の run 生成が約22分遅れた。
 * **その実測を`pending`へ分類できる値にする。** 正本文書へは宣言しない。
 * 宣言しても判定はこの定数を読むため、二重の正本を作らないためである。
 */
export const CI_DELIVERY_GRACE_MINUTES = 30;
function parseInstant(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        throw new Error(`${label}が不正です: ${value}`);
    return parsed;
}
/**
 * 観測値から配送状態を導出する。
 *
 * **`delivered`は成否を問わない。** runが生成されていれば配送は成立しており、
 * 成否の判定は既存の拒否点が持つ。ここで両者を混ぜると、失敗したrunを
 * 「まだ来ていない」と誤って報告する。
 */
export function inspectCiDelivery(input) {
    if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0)
        throw new Error(`猶予時間が不正です: ${String(input.graceMinutes)}`);
    const eventAt = parseInstant(input.eventAt, "イベント時刻");
    const observedAt = parseInstant(input.observedAt, "観測時刻");
    if (observedAt < eventAt)
        throw new Error("観測時刻がイベント時刻より前です");
    const matched = input.runs.filter((run) => run.headSha === input.headSha &&
        run.event === "pull_request" &&
        run.pullRequestNumbers.length === 1 &&
        run.pullRequestNumbers[0] === input.pullRequest);
    const elapsedMinutes = (observedAt - eventAt) / 60000;
    const state = matched.length > 0
        ? "delivered"
        : elapsedMinutes <= input.graceMinutes
            ? "pending"
            : "undelivered";
    return {
        state,
        runCount: matched.length,
        elapsedMinutes,
        graceMinutes: input.graceMinutes,
        headSha: input.headSha,
        pullRequest: input.pullRequest,
        eventAt: input.eventAt,
        observedAt: input.observedAt,
        nextAction: nextActionFor(state, input.graceMinutes),
    };
}
/**
 * 次に採る行動を1文で返す。
 *
 * **観測値を並べるだけでは足りない。** Issue #969 の誤診は、値の不足ではなく
 * 「待つのか人を呼ぶのか」の基準が無かったことによる。**`undelivered`を人間へ
 * 上げる唯一の条件として文言で固定する。**
 */
function nextActionFor(state, graceMinutes) {
    if (state === "delivered")
        return "CI runは生成済みです。結論を確認してください。人間を呼ばないでください";
    if (state === "pending")
        return `CI runは未生成ですが猶予${graceMinutes}分の内側です。再観測してください。人間を呼ばないでください`;
    return `CI runが猶予${graceMinutes}分を超えて未生成です。人間へ上げてください`;
}
//# sourceMappingURL=ci-delivery.js.map