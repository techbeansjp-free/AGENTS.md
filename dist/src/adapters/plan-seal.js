import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertIssueStagingLocation } from "../domain/staging-layout.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { GIT_ENV } from "./review-diff.js";
import { changedSealedArtifacts, deliveredAmendmentViolation, latestPlanGeneration, latestPlanSeal, nextPlanGeneration, PLAN_AMENDMENT_FILE, PLAN_SEAL_ARTIFACTS, PLAN_SEAL_FILE, planAmendmentDigests, planFrozenMessage, planSealAnchorViolation, renderPlanSealFile, validatePlanAmendment, } from "../domain/plan-seal.js";
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
/** 版管理下stagingのcommit上にある`05_計画変更.md`。版管理外は`null`を返す。 */
function readCommittedAmendment(staging, commit) {
    const location = assertIssueStagingLocation(staging);
    if (!location.layout.tracked)
        return null;
    const result = git([
        "cat-file",
        "blob",
        `${commit}:./${location.relative}/${PLAN_AMENDMENT_FILE}`,
    ], location.repositoryRoot, { env: GIT_ENV, allowFailure: true });
    return result.status === 0 ? result.stdout : undefined;
}
/** 版管理下stagingなら封印anchorのrepository相対pathを返す。版管理外は`undefined`。 */
function trackedPlanSealPath(staging) {
    const location = assertIssueStagingLocation(staging);
    if (!location.layout.tracked)
        return undefined;
    return {
        repositoryRoot: location.repositoryRoot,
        relative: `${location.relative}/${PLAN_SEAL_FILE}`,
    };
}
function committedBlob(repositoryRoot, commit, relative) {
    const result = git(["cat-file", "blob", `${commit}:./${relative}`], repositoryRoot, {
        env: GIT_ENV,
        allowFailure: true,
    });
    return result.status === 0 ? result.stdout : undefined;
}
/**
 * 版管理下stagingの封印を`plan-seal.json`へ書く（REQ-WF-036）。封印Stepのjournal追記が
 * publish直前に呼ぶ。版管理外stagingでは書かず`undefined`を返す。戻り値は失敗時に
 * 元へ戻す関数である（既存fileは元の本文へ、無かったfileは削除へ戻す）。
 */
export function writeTrackedPlanSealFile(staging, input) {
    if (trackedPlanSealPath(staging) === undefined)
        return undefined;
    const previous = readPlanningFile(staging, PLAN_SEAL_FILE);
    const destination = path.join(staging, PLAN_SEAL_FILE);
    const options = {
        temporaryDirectory: path.dirname(staging),
        fileMode: 0o644,
    };
    writeFileAtomic(destination, renderPlanSealFile(input), options);
    return () => {
        if (previous === undefined)
            fs.rmSync(destination, { force: true });
        else
            writeFileAtomic(destination, previous.toString("utf8"), options);
    };
}
/**
 * 版管理下stagingの封印anchorを検査する（REQ-WF-036）。**journal（版管理外の機械記録）
 * だけの封印は記録者がchainごと除去できる**ため、worktreeと`commit`上の
 * `plan-seal.json`、`commit`から到達できるその履歴をjournalの封印と照合する。
 * 版管理外stagingでは検査しない（機械記録だけがanchorである）。
 */
export function assertPlanSealAnchor(staging, entries, commit = "HEAD") {
    const tracked = trackedPlanSealPath(staging);
    if (tracked === undefined)
        return;
    const { repositoryRoot, relative } = tracked;
    const listed = git(["rev-list", commit, "--", relative], repositoryRoot, { env: GIT_ENV, allowFailure: true });
    if (listed.status !== 0)
        throw new Error(`版管理下stagingの${PLAN_SEAL_FILE}の履歴をcommit ${commit}から読めません。封印のGit anchorを確認できないため拒否します`);
    const history = listed.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((sha) => committedBlob(repositoryRoot, sha, relative));
    const violation = planSealAnchorViolation({
        entries,
        worktree: readPlanningFile(staging, PLAN_SEAL_FILE)?.toString("utf8"),
        committed: committedBlob(repositoryRoot, commit, relative),
        history,
        commit,
    });
    if (violation)
        throw new Error(violation);
}
/**
 * 封印後の計画凍結と計画変更記録を検査し、記録すべき計画世代を返す（REQ-WF-036）。
 * **封印が無いjournal（本機構以前のstaging）では検査せず`undefined`を返す。**
 * hash chain付きjournalでは封印Stepの`planSeal`欠落をparserが拒否するため、この互換は
 * chainを持たない旧journalにだけ成立する。版管理下stagingでは先に封印anchor
 * （`plan-seal.json`）を検査し、旧journal互換はchainも`plan-seal.json`も無い場合に限る。
 *
 * 1. 封印済み計画文書はworktreeと、版管理下stagingでは`commit`（既定はHEAD。配送時は
 *    配送するhead SHA）上の内容の両方で封印と一致しなければならない。
 * 2. `05_計画変更.md`は構造検査を通り、封印後に記録した世代chainに対して追記専用で
 *    なければならない（記録済みAMDの編集・削除・並べ替えを拒否する）。版管理下stagingでは
 *    commit上のAMD列もworktreeと一致させる。
 * 3. `delivery`では、現在のAMD列が最後のStep 10記録の世代と完全に一致しなければならない。
 *    Step 10記録後に追記した未reviewのAMDを配送へ乗せない。
 */
export function assertPlanFrozenForEntries(staging, entries, commit = "HEAD", options = {}) {
    assertPlanSealAnchor(staging, entries, commit);
    const latest = latestPlanSeal(entries);
    if (latest === undefined)
        return undefined;
    const changed = changedSealedArtifacts(latest.seal, observeSealedArtifacts(staging, latest.seal));
    if (changed.length > 0)
        throw new Error(planFrozenMessage({ sealStep: latest.step, changed }));
    const committed = observeCommittedSealedArtifacts(staging, latest.seal, commit);
    const committedChanged = committed === undefined
        ? []
        : changedSealedArtifacts(latest.seal, committed);
    if (committedChanged.length > 0)
        throw new Error(`${planFrozenMessage({
            sealStep: latest.step,
            changed: committedChanged,
        })}（版管理下stagingのcommit ${commit}上の計画文書が封印と一致しません。worktreeだけを戻しても配送される内容は変わりません）`);
    const amendmentText = readPlanningFile(staging, PLAN_AMENDMENT_FILE)?.toString("utf8");
    if (amendmentText !== undefined) {
        const validation = validatePlanAmendment(amendmentText);
        if (!validation.valid)
            throw new Error(`計画変更記録${PLAN_AMENDMENT_FILE}の構造検査に失敗しました: ${validation.errors.join("; ")}`);
    }
    const current = planAmendmentDigests(amendmentText);
    const committedText = readCommittedAmendment(staging, commit);
    if (committedText !== null &&
        JSON.stringify(planAmendmentDigests(committedText)) !==
            JSON.stringify(current))
        throw new Error(`版管理下stagingのcommit ${commit}上の${PLAN_AMENDMENT_FILE}がworktreeと一致しません。計画変更記録はcommitしてreviewの差分へ含めてから記録・配送してください`);
    const sinceSeal = entries.slice(latest.index + 1);
    const chain = latestPlanGeneration(latest.seal, sinceSeal.flatMap((entry) => entry.planGeneration ? [entry.planGeneration] : []));
    if (chain.errors.length > 0)
        throw new Error(`計画世代chainの検査に失敗しました: ${chain.errors.join("; ")}`);
    const next = nextPlanGeneration(chain.latest, current);
    if (next.error !== undefined)
        throw new Error(next.error);
    if (options.delivery) {
        const reviewed = [...sinceSeal]
            .reverse()
            .find((entry) => entry.step === 10);
        /**
         * **chain付きjournalでは欠落を旧journal互換として読み飛ばさない**（REQ-WF-036）。
         * CLIは封印後のStep 10へ必ず`planGeneration`を記録するため、欠落は記録後の除去である。
         */
        if (reviewed !== undefined &&
            reviewed.planGeneration === undefined &&
            reviewed.previousEntryDigest !== undefined)
            throw new Error("配送前の計画変更検査: chain付きjournalの封印後の最後のStep 10にplanGenerationがありません。旧journal互換として扱わず配送を拒否します");
        if (reviewed?.planGeneration !== undefined) {
            const violation = deliveredAmendmentViolation(reviewed.planGeneration, current, "配送前の計画変更検査");
            if (violation)
                throw new Error(violation);
        }
    }
    return next.value;
}
//# sourceMappingURL=plan-seal.js.map