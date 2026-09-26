import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { peekPrimaryReviewRoot, resolveGitWorkspace, } from "./review-workspace.js";
import { classifyJevProviderConfig, JEV_PROVIDER_CONFIG_PATH, } from "../domain/jev-provider-config.js";
/**
 * ローカル設定のactive worktree→primary worktree継承を一般化した共通adapter
 * （Issue #1485、L-04）。既存`loadWorkspaceConfig`
 * （`src/adapters/supplemental-review-launch.ts:364`、Issue #1428）が個別に持って
 * いた「activeにfileが存在すればfallbackしない、存在しなければ`peekPrimaryReviewRoot`
 * の安価な判定を経て`resolveGitWorkspace`でGit境界を確認してからprimaryを読む」
 * という手順を、`LocalConfigResolution<T>`の4状態を返す形へ一般化する。
 *
 * **fallbackするのは`classify`が`{state:"absent"}`を返したときだけ。** `disabled`・
 * `invalid`はfallbackしない。`classify`自身はgit・worktreeに一切触れない
 * 単一rootのpure classifierを渡す（`jev-provider-config.ts`の
 * `classifyJevProviderConfig`等）。
 *
 * Git境界検証（`resolveGitWorkspace`）が失敗する場合（`root`がGit worktreeでない
 * tmpdir fixture等）は例外を投げず`absent`として扱う。既存`loadWorkspaceConfig`と
 * 同じfail-safeの倣いである。
 */
export function resolveLocalConfigWithWorkspaceFallback(root, configPath, classify) {
    const active = classify(root, configPath);
    if (active.state !== "absent")
        return { ...active, source: "active" };
    const localPathExists = (() => {
        try {
            fs.lstatSync(path.resolve(root, configPath));
            return true;
        }
        catch {
            return false;
        }
    })();
    // classifyが既にabsentと判定した以上、fileが存在するのに絶対absentへ潰れる
    // 経路は無いはずだが、二重確認としてlocalPathExistsがtrueなら安全側でfallback
    // せずabsentを返す（fallbackは「activeに何も無い」ときだけの契約を守る）。
    if (localPathExists)
        return { state: "absent" };
    const candidatePrimary = peekPrimaryReviewRoot(root);
    if (candidatePrimary === undefined || candidatePrimary === root)
        return { state: "absent" };
    if (!fs.existsSync(path.join(candidatePrimary, configPath)))
        return { state: "absent" };
    try {
        const primaryRoot = resolveGitWorkspace(root).primaryRoot;
        if (primaryRoot === root)
            return { state: "absent" };
        const primary = classify(primaryRoot, configPath);
        return primary.state === "absent"
            ? { state: "absent" }
            : { ...primary, source: "primary" };
    }
    catch {
        return { state: "absent" };
    }
}
/**
 * `target`がそのfileの属するGit repositoryで追跡されているかを観測する。
 *
 * **未追跡と判定するのはGitが明示した2つの場合だけである。** Git repositoryで
 * ない場所（tmpdir fixture等、`not a git repository`）と、pathspecが追跡fileに
 * 一致しない場合（`--error-unmatch`の終了値1）である。git不在・dubious
 * ownership・index破損などの失敗は追跡の有無を観測できないため`unknown`を返し、
 * 呼出し側はfail-closedで`invalid`にする。診断文の照合のためlocaleをCへ固定する。
 */
function observeGitTracking(target) {
    const result = git(["ls-files", "--error-unmatch", "--", path.basename(target)], path.dirname(target), {
        allowFailure: true,
        env: { ...process.env, LANG: "C", LC_ALL: "C", LANGUAGE: "C" },
    });
    if (result.status === 0)
        return "tracked";
    if (result.status === 1 &&
        /^error: pathspec '.*' did not match any file\(s\) known to git/mu.test(result.stderr))
        return "untracked";
    if (result.status === 128 &&
        /^fatal: not a git repository/mu.test(result.stderr))
        return "untracked";
    return "unknown";
}
/**
 * `classifyJevProviderConfig`へ「Git追跡下の設定fileを拒否する」検査を足す
 * （独立security review L2）。個人ローカル設定はgit管理外が前提であり、
 * repositoryへcommitされた`jev-provider.json`は第三者（clone元）が
 * 内容を選べるため、`enabled`でもfail-closedで`invalid`にする。
 */
function classifyUntrackedJevProviderConfig(root, configPath) {
    const classified = classifyJevProviderConfig(root, configPath);
    if (classified.state !== "enabled")
        return classified;
    const tracking = observeGitTracking(path.resolve(root, configPath));
    if (tracking === "tracked")
        return {
            state: "invalid",
            reason: "設定fileがGitで追跡されています。個人ローカル設定はcommitせず、git rm --cachedで追跡を外してください",
        };
    if (tracking === "unknown")
        return {
            state: "invalid",
            reason: "設定fileがGitで追跡されているかを確認できません（git ls-filesが失敗しました）。gitの実行可否とrepositoryの状態を確認してください",
        };
    return classified;
}
/**
 * Jev provider configを、active worktree local→primary worktree localの順で
 * 解決する（Issue #1485、L-04）。`decision invoke`のprovider診断出力が使う。
 */
export function resolveJevProviderConfig(root, configPath = JEV_PROVIDER_CONFIG_PATH) {
    return resolveLocalConfigWithWorkspaceFallback(root, configPath, classifyUntrackedJevProviderConfig);
}
//# sourceMappingURL=local-config-workspace.js.map