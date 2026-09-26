import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import {
  peekPrimaryReviewRoot,
  resolveGitWorkspace,
} from "./review-workspace.js";
import {
  classifyJevProviderConfig,
  JEV_PROVIDER_CONFIG_PATH,
  type JevProviderConfig,
} from "../domain/jev-provider-config.js";
import type {
  LocalConfigClassification,
  LocalConfigResolution,
} from "../domain/local-config-resolution.js";

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
export function resolveLocalConfigWithWorkspaceFallback<T>(
  root: string,
  configPath: string,
  classify: (root: string, configPath: string) => LocalConfigClassification<T>,
): LocalConfigResolution<T> {
  const active = classify(root, configPath);
  if (active.state !== "absent") return { ...active, source: "active" };

  const localPathExists = (() => {
    try {
      fs.lstatSync(path.resolve(root, configPath));
      return true;
    } catch {
      return false;
    }
  })();
  // classifyが既にabsentと判定した以上、fileが存在するのに絶対absentへ潰れる
  // 経路は無いはずだが、二重確認としてlocalPathExistsがtrueなら安全側でfallback
  // せずabsentを返す（fallbackは「activeに何も無い」ときだけの契約を守る）。
  if (localPathExists) return { state: "absent" };

  const candidatePrimary = peekPrimaryReviewRoot(root);
  if (candidatePrimary === undefined || candidatePrimary === root)
    return { state: "absent" };
  if (!fs.existsSync(path.join(candidatePrimary, configPath)))
    return { state: "absent" };
  try {
    const primaryRoot = resolveGitWorkspace(root).primaryRoot;
    if (primaryRoot === root) return { state: "absent" };
    const primary = classify(primaryRoot, configPath);
    return primary.state === "absent"
      ? { state: "absent" }
      : { ...primary, source: "primary" };
  } catch {
    return { state: "absent" };
  }
}

/**
 * `target`がそのfileの属するGit repositoryで追跡されていればtrue。Git
 * repositoryでない場所（tmpdir fixture等）では`git ls-files`が失敗するため
 * false（未追跡）になる。
 */
function isTrackedByGit(target: string): boolean {
  const result = git(
    ["ls-files", "--error-unmatch", "--", path.basename(target)],
    path.dirname(target),
    { allowFailure: true },
  );
  return result.status === 0;
}

/**
 * `classifyJevProviderConfig`へ「Git追跡下の設定fileを拒否する」検査を足す
 * （独立security review L2）。個人ローカル設定はgit管理外が前提であり、
 * repositoryへcommitされた`jev-provider.json`は第三者（clone元）が
 * 内容を選べるため、`enabled`でもfail-closedで`invalid`にする。
 */
function classifyUntrackedJevProviderConfig(
  root: string,
  configPath: string,
): LocalConfigClassification<JevProviderConfig> {
  const classified = classifyJevProviderConfig(root, configPath);
  if (classified.state !== "enabled") return classified;
  if (isTrackedByGit(path.resolve(root, configPath)))
    return {
      state: "invalid",
      reason:
        "設定fileがGitで追跡されています。個人ローカル設定はcommitせず、git rm --cachedで追跡を外してください",
    };
  return classified;
}

/**
 * Jev provider configを、active worktree local→primary worktree localの順で
 * 解決する（Issue #1485、L-04）。`decision invoke`のprovider診断出力が使う。
 */
export function resolveJevProviderConfig(
  root: string,
  configPath: string = JEV_PROVIDER_CONFIG_PATH,
): LocalConfigResolution<JevProviderConfig> {
  return resolveLocalConfigWithWorkspaceFallback(
    root,
    configPath,
    classifyUntrackedJevProviderConfig,
  );
}
