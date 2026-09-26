import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertIssueStagingLocation } from "../domain/staging-layout.js";
import { git } from "../lib/process.js";
import { GIT_ENV } from "./review-diff.js";
import { changedSealedArtifacts, latestPlanSeal, PLAN_AMENDMENT_FILE, PLAN_SEAL_ARTIFACTS, planFrozenMessage, validatePlanAmendment, } from "../domain/plan-seal.js";
/**
 * 計画封印の成果物I/O（REQ-WF-036）。封印値は**成果物fileからだけ**計算し、
 * 利用者入力を受け取る引数を持たない。
 */
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
/** staging直下の通常fileを読む。symlink・symlink祖先・通常file以外は拒否する。 */
function readPlanningFile(staging, name) {
    const absolute = path.join(staging, name);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (stat === undefined)
        return undefined;
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`計画文書はsymlinkでない通常fileが必要です: ${name}`);
    if (fs.realpathSync(absolute) !== path.join(fs.realpathSync(staging), name))
        throw new Error(`計画文書にsymlink祖先を使用できません: ${name}`);
    return fs.readFileSync(absolute);
}
/** modeの計画文書を封印する。**文書が1件でも無ければ封印しない（fail-closed）。** */
export function computePlanSeal(staging, mode) {
    return Object.freeze(Object.fromEntries(PLAN_SEAL_ARTIFACTS[mode].map((name) => {
        const source = readPlanningFile(staging, name);
        if (source === undefined)
            throw new Error(`計画封印の対象文書がありません: ${name}`);
        return [name, sha256(source)];
    })));
}
/** 封印済み文書の現在digest。削除済みは`undefined`で表す。 */
export function observeSealedArtifacts(staging, seal) {
    return Object.fromEntries(Object.keys(seal).map((name) => {
        const source = readPlanningFile(staging, name);
        return [name, source === undefined ? undefined : sha256(source)];
    }));
}
/** 最新封印と比べて変化した計画文書。封印が無ければ空（旧journal互換）。 */
export function changedPlanningSince(staging, entries) {
    const latest = latestPlanSeal(entries);
    if (!latest)
        return { changed: [] };
    return {
        sealStep: latest.step,
        changed: changedSealedArtifacts(latest.seal, observeSealedArtifacts(staging, latest.seal)),
    };
}
/**
 * 版管理下stagingの封印済み文書を、配送されるcommit上の内容で観測する。
 *
 * **worktreeの一致だけでは不足する。** 版管理下stagingではcommitした計画文書がmainへ
 * 入るため、編集版をcommitしてworktreeだけ封印時の本文へ戻すと凍結を迂回できる。
 * commit上に無い・読めない文書は削除として扱い、封印と一致させない（fail-closed）。
 * 版管理外stagingは空（検査対象なし）を返す。
 */
function observeCommittedSealedArtifacts(staging, seal, commit) {
    const location = assertIssueStagingLocation(staging);
    if (!location.layout.tracked)
        return undefined;
    return Object.fromEntries(Object.keys(seal).map((name) => {
        const result = git(["cat-file", "blob", `${commit}:./${location.relative}/${name}`], location.repositoryRoot, { env: GIT_ENV, allowFailure: true });
        return [
            name,
            result.status === 0
                ? sha256(Buffer.from(result.stdout, "utf8"))
                : undefined,
        ];
    }));
}
/**
 * 封印後の計画凍結と計画変更記録の構造を検査する。**封印が無いjournal（本機構以前の
 * staging）では検査しない。** 版管理下stagingでは、worktreeに加えて`commit`
 * （既定はHEAD。配送時は配送するhead SHA）上の封印済み文書も封印と一致させる。
 */
export function assertPlanFrozenForEntries(staging, entries, commit = "HEAD") {
    const observed = changedPlanningSince(staging, entries);
    if (observed.sealStep === undefined)
        return;
    if (observed.changed.length > 0)
        throw new Error(planFrozenMessage({
            sealStep: observed.sealStep,
            changed: observed.changed,
        }));
    const latest = latestPlanSeal(entries);
    const committed = latest === undefined
        ? undefined
        : observeCommittedSealedArtifacts(staging, latest.seal, commit);
    const committedChanged = latest === undefined || committed === undefined
        ? []
        : changedSealedArtifacts(latest.seal, committed);
    if (committedChanged.length > 0)
        throw new Error(`${planFrozenMessage({
            sealStep: observed.sealStep,
            changed: committedChanged,
        })}（版管理下stagingのcommit ${commit}上の計画文書が封印と一致しません。worktreeだけを戻しても配送される内容は変わりません）`);
    const amendment = readPlanningFile(staging, PLAN_AMENDMENT_FILE);
    if (amendment === undefined)
        return;
    const validation = validatePlanAmendment(amendment.toString("utf8"));
    if (!validation.valid)
        throw new Error(`計画変更記録${PLAN_AMENDMENT_FILE}の構造検査に失敗しました: ${validation.errors.join("; ")}`);
}
//# sourceMappingURL=plan-seal.js.map