import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";
import { findPackageRoot } from "../lib/package-root.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { isRecord } from "../types.js";
import { inspectExecutableVersion, MINIMUM_GH_VERSION, MINIMUM_GIT_VERSION, } from "../lib/executable-version.js";
import { loadProjectPolicySet } from "./policy.js";
import { DEPRECATED_POLICY_SCHEMA_ALIASES, SUPPORTED_POLICY_SCHEMA_VERSIONS, } from "../lib/version.js";
import { readStoredStagingRecord } from "./staging.js";
import { MODE_DECISION_FILE, STEP_JOURNAL_FILE, inspectWorkflowStagingArtifacts, } from "./workflow.js";
import { surveyWorktrees } from "./worktree-survey.js";
const packageRoot = findPackageRoot(import.meta.url);
/**
 * repository直下へ展開するhost入口。
 *
 * **hostごとに常時読まれるfile名が違う。** Codexは`AGENTS.md`、Claude Codeは
 * `CLAUDE.md`を読む。片方だけを配ると、もう片方のhostでは規範文書へ到達する
 * 常時の入口が存在しない（Issue #1219）。
 *
 * **skillは代替にならない。** `HOST_SKILL_TARGETS`は呼び出されたときに読まれる
 * 登録口であり、常時読まれる入口ではない。
 */
const ROOT_ASSETS = ["AGENTS.md", "CLAUDE.md"];
const NAMESPACE_ROOT_ASSETS = ["00_利用案内.md"];
const NAMESPACE_ASSETS = [
    "docs",
    "skills",
    "templates",
    "schemas",
    "policy",
    "hooks",
];
const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";
const HOST_SKILL_SOURCE = ".agent-skill-chain/skills/asc-step/SKILL.md";
const HOST_SKILL_TARGETS = [
    ".claude/skills/asc-step/SKILL.md",
    ".agents/skills/asc-step/SKILL.md",
];
/**
 * 強制点hookの正本と、hostごとの展開先（Issue #1105）。
 *
 * **skillとhookは責務が違う。** skillは呼び出されたときに読まれる登録口であり、
 * hookはhostのtool呼び出し前に**利用者の操作なしに毎回走る**。同じ配布機構を
 * 使うが、`HOST_SKILL_TARGETS`とは別の定数に分ける。
 *
 * **共通のloopへまとめない。** まとめると、展開先の一覧を消す変異がskillと
 * hookの両方を同時に消し、片方だけを壊す変異を検出できなくなる。
 *
 * **配るのは本体だけである。** hostの設定fileへ登録を書き込まない。登録は
 * 利用者・hostが所有する共有設定への書き込みであり、`install`の権限を
 * 「packageの資産を置く」から「以後のtool callごとに自動実行されるcodeを
 * 登録する」へ広げる。登録状態は`doctor`が報告するだけにとどめる。
 */
const HOST_HOOK_SOURCE = ".agent-skill-chain/hooks/asc-contract-citation.mjs";
const HOST_HOOK_TARGETS = [
    ".claude/hooks/asc-contract-citation.mjs",
    ".codex/hooks/asc-contract-citation.mjs",
];
/**
 * hookの登録を観測するproject-localの設定file（Issue #1105）。
 *
 * **読むだけで書かない。** ここへ`install`が書き込むと、`install`の権限が
 * 「以後のtool callごとに自動実行されるcodeを登録する」まで広がる。
 */
const HOST_HOOK_SETTINGS = ".claude/settings.local.json";
/**
 * project-localの設定にhookのentryがあるかを返す純関数（Issue #1105）。
 *
 * **filesystemを読まない。** 設定の内容を引数で受ける。読み取りは呼び出し側が行う。
 *
 * **`healthy`を変えない。** 返すのは観測であって判定ではない。project-localの
 * 設定だけを見ており、global・managed・plugin経由の有効化状態は見えない。
 * **「hookが無効です」と断定しない。**
 */
export function inspectHookRegistration(input) {
    if (input.settings === undefined)
        return {
            registered: false,
            reason: `${HOST_HOOK_SETTINGS}がありません。project-localの登録は確認できません`,
        };
    let parsed;
    try {
        parsed = JSON.parse(input.settings);
    }
    catch {
        return {
            registered: false,
            reason: `${HOST_HOOK_SETTINGS}をJSONとして解釈できません。project-localの登録は確認できません`,
        };
    }
    /**
     * **entryの形ではなくcommandの字面を見る。** 別のcommandのentryが1件あるだけで
     * 登録済みと数えると、未登録を見逃す。
     */
    const found = JSON.stringify(parsed).includes(input.expectedCommandFragment);
    return found
        ? {
            registered: true,
            reason: `${HOST_HOOK_SETTINGS}に期待entryがあります`,
        }
        : {
            registered: false,
            reason: `${HOST_HOOK_SETTINGS}に期待entryがありません。global・managed・plugin経由の有効化状態は未確認です`,
        };
}
const SHA256 = /^[a-f0-9]{64}$/u;
function isPackageOwnedPath(relative) {
    const normalized = relative.replaceAll("\\", "/");
    return (
    /**
     * **`ROOT_ASSETS`を正本にする。** file名を直接書くと、host入口を足したときに
     * 展開はされるがrecord検証で拒否される（Issue #1219で`CLAUDE.md`を足して観測した）。
     */
    ROOT_ASSETS.includes(normalized) ||
        HOST_SKILL_TARGETS.includes(normalized) ||
        /**
         * **hookの展開先も同じ扱いにする**（Issue #1105）。ここへ足さないと、
         * 展開はされるがrecord検証で拒否され、`update`と`delete`が使えなくなる。
         * 上の`ROOT_ASSETS`のコメントが警告しているのと同じ罠である。
         */
        HOST_HOOK_TARGETS.includes(normalized) ||
        NAMESPACE_ROOT_ASSETS.some((file) => normalized === `.agent-skill-chain/${file}`) ||
        NAMESPACE_ASSETS.some((directory) => normalized.startsWith(`.agent-skill-chain/${directory}/`)));
}
function digest(file) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
}
function relativeKey(target, file) {
    return path.relative(target, file).replaceAll(path.sep, "/");
}
function isRegularFile(file) {
    return fs.lstatSync(file).isFile();
}
function pathEntryExists(file) {
    try {
        fs.lstatSync(file);
        return true;
    }
    catch (error) {
        if (isRecord(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
function resolveManagedAsset(target, relative) {
    if (relative !== relative.normalize("NFC"))
        throw new Error(`managed asset pathのUnicode正規化が不正です: ${relative}`);
    const portable = relative.replaceAll("\\", "/");
    const segments = portable.split("/");
    if (path.posix.isAbsolute(portable) ||
        path.win32.isAbsolute(relative) ||
        segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
        !isPackageOwnedPath(portable))
        throw new Error(`managed asset recordが不正です: ${relative}`);
    return resolveContained(target, portable, { allowMissingLeaf: true });
}
function readManagedAssetRecord(target) {
    const recordPath = resolveContained(target, MANAGED_RECORD);
    if (!isRegularFile(recordPath))
        throw new Error("managed asset recordは通常fileでなければなりません");
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.files))
        throw new Error("managed asset recordが不正です");
    const files = {};
    const assets = [];
    for (const [recordKey, expected] of Object.entries(parsed.files)) {
        if (typeof expected !== "string" || !SHA256.test(expected))
            throw new Error(`managed asset recordが不正です: ${recordKey}`);
        const relative = recordKey.replaceAll("\\", "/");
        const file = resolveManagedAsset(target, recordKey);
        if (files[relative] !== undefined)
            throw new Error(`managed asset pathが重複しています: ${recordKey}`);
        files[relative] = expected;
        assets.push({ relative, file, expected });
    }
    return {
        recordPath,
        record: { version: parsed.version, files },
        assets,
    };
}
function walkFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const resolved = path.join(directory, entry.name);
        return entry.isDirectory()
            ? walkFiles(resolved)
            : entry.isFile()
                ? [resolved]
                : [];
    });
}
function mappings(target) {
    const destination = (relative) => resolveContained(target, relative, { allowMissingLeaf: true });
    const result = ROOT_ASSETS.map((name) => ({
        src: path.join(packageRoot, name),
        dest: destination(name),
    }));
    for (const file of NAMESPACE_ROOT_ASSETS)
        result.push({
            src: path.join(packageRoot, ".agent-skill-chain", file),
            dest: destination(path.join(".agent-skill-chain", file)),
        });
    for (const directory of NAMESPACE_ASSETS) {
        const source = path.join(packageRoot, ".agent-skill-chain", directory);
        if (!fs.existsSync(source))
            continue;
        for (const file of walkFiles(source)) {
            const relative = path.relative(source, file);
            result.push({
                src: path.join(source, relative),
                dest: destination(path.join(".agent-skill-chain", directory, relative)),
            });
        }
    }
    for (const relative of HOST_SKILL_TARGETS)
        result.push({
            src: path.join(packageRoot, HOST_SKILL_SOURCE),
            dest: destination(relative),
        });
    for (const relative of HOST_HOOK_TARGETS)
        result.push({
            src: path.join(packageRoot, HOST_HOOK_SOURCE),
            dest: destination(relative),
        });
    return result;
}
export function init(target, options) {
    const assets = mappings(target);
    const conflicts = assets
        .filter(({ src, dest }) => pathEntryExists(dest) &&
        (!isRegularFile(dest) || digest(src) !== digest(dest)))
        .map(({ dest }) => dest);
    if (conflicts.length > 0)
        throw new Error(`初期導入先が競合しています。ファイルは書き込んでいません: ${conflicts.join(", ")}。` +
            "updateを実行してください。updateは正本と一致する展開済み資産を採用し、" +
            "異なる資産は上書きせずretainedとして報告します");
    if (!options.apply)
        return { applied: false, assets: assets.map(({ dest }) => dest) };
    const record = {
        version: PACKAGE_VERSION,
        files: {},
    };
    for (const { src, dest } of assets) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!pathEntryExists(dest))
            fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        record.files[relativeKey(target, dest)] = digest(dest);
    }
    writeFileAtomic(path.join(target, MANAGED_RECORD), `${JSON.stringify(record, null, 2)}\n`);
    return { applied: true, assets: Object.keys(record.files) };
}
export function classifyManagedAsset(input) {
    if (!input.exists)
        return "place";
    if (!input.regularFile)
        return "retain";
    if (input.expected !== undefined)
        return input.destDigest === input.expected ? "overwrite" : "retain";
    return input.destDigest === input.sourceDigest ? "adopt" : "retain";
}
/**
 * managed asset recordを読む。**不在なら空recordを返す**（Issue #1305）。
 *
 * 以前はここで`未導入です。先にinstallを実行してください`をthrowしていたが、
 * その`install`は展開先が正本と異なる場合に`初期導入先が競合しています`で
 * 拒否するため、**拒否理由が閉路を作り製品内の復旧経路が存在しなかった。**
 * 空recordを返すと全資産が「記録が無い」として評価され、正本と一致する資産は
 * 採用、相違する資産は保持になる。**上書きの到達性は1経路も増えない。**
 */
function readManagedAssetRecordOrEmpty(target) {
    if (!fs.existsSync(path.join(target, MANAGED_RECORD)))
        return { version: PACKAGE_VERSION, files: {} };
    return readManagedAssetRecord(target).record;
}
/**
 * 分類の入力をfilesystemから観測する（Issue #1305）。
 *
 * **通常fileでないときにdigestを読まない。** 読むとdirectoryで例外になる。
 * 分類関数は`exists`と`regularFile`で早期に返すため、この場合のdigestは
 * 判定に使われない。
 */
function observeManagedAsset(item, expected) {
    const exists = pathEntryExists(item.dest);
    const regularFile = exists && isRegularFile(item.dest);
    return {
        exists,
        regularFile,
        expected,
        destDigest: regularFile ? digest(item.dest) : "",
        sourceDigest: regularFile ? digest(item.src) : "",
    };
}
export function upgrade(target, options) {
    const recordPath = path.join(target, MANAGED_RECORD);
    const old = readManagedAssetRecordOrEmpty(target);
    const current = mappings(target);
    const retained = [];
    const adoptable = [];
    const planned = [];
    for (const item of current) {
        const key = relativeKey(target, item.dest);
        const expected = old.files[key];
        const classification = classifyManagedAsset(observeManagedAsset(item, expected));
        if (classification === "retain") {
            retained.push(key);
            continue;
        }
        planned.push({ ...item, key, expected });
        if (classification === "adopt")
            adoptable.push(key);
    }
    if (!options.apply)
        return {
            applied: false,
            planned: planned.map((item) => item.key),
            adopted: adoptable,
            retained,
        };
    const next = {
        version: PACKAGE_VERSION,
        files: { ...old.files },
    };
    const adopted = [];
    for (const item of planned) {
        fs.mkdirSync(path.dirname(item.dest), { recursive: true });
        /**
         * **preview後の状態変化をここで取り直す。** TOCTOUの再検証であり、
         * previewの判定を再利用しない。
         */
        const classification = classifyManagedAsset(observeManagedAsset(item, item.expected));
        if (classification === "retain") {
            retained.push(item.key);
            continue;
        }
        if (classification === "place")
            fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
        else if (classification === "overwrite")
            fs.copyFileSync(item.src, item.dest);
        else
            adopted.push(item.key);
        next.files[item.key] = digest(item.dest);
    }
    writeFileAtomic(recordPath, `${JSON.stringify(next, null, 2)}\n`);
    return { applied: true, adopted, retained };
}
export function uninstall(target, options) {
    const recordPath = path.join(target, MANAGED_RECORD);
    if (!fs.existsSync(recordPath))
        throw new Error("managed asset recordがありません。撤去対象を確定できません。" +
            "updateを実行してrecordを再固定してから、deleteを実行してください");
    const managed = readManagedAssetRecord(target);
    const removable = [];
    const retained = [];
    for (const { relative, file, expected } of managed.assets) {
        if (!pathEntryExists(file))
            continue;
        if (isRegularFile(file) && digest(file) === expected)
            removable.push(file);
        else
            retained.push(relative);
    }
    if (!options.apply)
        return {
            applied: false,
            removable,
            retained,
            removed: [],
            pending: [],
            recovery: "previewのため変更はありません",
        };
    const candidates = [];
    for (const asset of managed.assets) {
        if (!removable.includes(asset.file))
            continue;
        const file = resolveManagedAsset(target, asset.relative);
        if (!pathEntryExists(file) ||
            !isRegularFile(file) ||
            digest(file) !== asset.expected) {
            if (pathEntryExists(file) && !retained.includes(asset.relative))
                retained.push(asset.relative);
            continue;
        }
        candidates.push({ ...asset, file });
    }
    const removed = [];
    const pending = [];
    for (const asset of candidates) {
        try {
            const file = resolveManagedAsset(target, asset.relative);
            if (!pathEntryExists(file) ||
                !isRegularFile(file) ||
                digest(file) !== asset.expected) {
                if (pathEntryExists(file) && !retained.includes(asset.relative))
                    retained.push(asset.relative);
                continue;
            }
            fs.rmSync(file);
            removed.push(asset.relative);
        }
        catch {
            pending.push(asset.relative);
        }
    }
    if (pending.length === 0) {
        try {
            fs.rmSync(managed.recordPath);
        }
        catch {
            pending.push(MANAGED_RECORD);
        }
    }
    const applied = pending.length === 0;
    return {
        applied,
        removable,
        retained,
        removed,
        pending,
        recovery: applied
            ? "不要"
            : "権限と未処理対象を確認し、managed asset recordを保持したままdelete --applyを再実行してください",
        consumerAssetsPreserved: [
            ".agent-skill-chain/tmp",
            ".agent-skill-chain/project-policy.json",
            ".agent-skill-chain/project",
            "docs/specs",
        ],
    };
}
function hasLegacyAgentsAssets(target) {
    const agents = path.join(target, ".agents");
    if (!pathEntryExists(agents))
        return false;
    if (!fs.lstatSync(agents).isDirectory())
        return true;
    return walkFiles(agents).some((file) => relativeKey(target, file) !== HOST_SKILL_TARGETS[1]);
}
function validateAdapterFrontmatter(markdown) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(markdown)?.[1];
    return Boolean(frontmatter &&
        /^name:\s*asc-step\s*$/mu.test(frontmatter) &&
        /^description:\s*\S.+$/mu.test(frontmatter));
}
function inspectDoctorWorkflowStaging(staging) {
    const record = readStoredStagingRecord(staging);
    const modeFile = path.join(staging, MODE_DECISION_FILE);
    const journalFile = path.join(staging, STEP_JOURNAL_FILE);
    return inspectWorkflowStagingArtifacts({
        staging,
        mode: record.mode,
        state: record.state,
        ...(fs.existsSync(modeFile)
            ? { modeDecisionSource: fs.readFileSync(modeFile, "utf8") }
            : {}),
        ...(fs.existsSync(journalFile)
            ? { journalSource: fs.readFileSync(journalFile, "utf8") }
            : {}),
    });
}
function injectedWorktreeSurvey(value) {
    if (value === undefined)
        return undefined;
    if (isRecord(value) &&
        Array.isArray(value.entries) &&
        Array.isArray(value.cleanupReady) &&
        Array.isArray(value.retained) &&
        Array.isArray(value.inProgress) &&
        Array.isArray(value.errors))
        return value;
    return surveyWorktrees(value);
}
export function doctor(target, worktreeObservations) {
    const worktreeSurvey = injectedWorktreeSurvey(worktreeObservations);
    const legacy = [
        ...(hasLegacyAgentsAssets(target) ? [".agents"] : []),
        ...(pathEntryExists(path.join(target, ".workflow")) ? [".workflow"] : []),
    ];
    const recordPath = path.join(target, MANAGED_RECORD);
    const installed = pathEntryExists(recordPath);
    const diagnostics = [];
    let files = {};
    let managedAssets = [];
    if (!installed)
        diagnostics.push(`${MANAGED_RECORD}: managed recordがありません`);
    else {
        try {
            const managed = readManagedAssetRecord(target);
            files = managed.record.files;
            managedAssets = managed.assets;
        }
        catch (error) {
            diagnostics.push(`${MANAGED_RECORD}: ${error instanceof Error ? error.message : "検証できません"}`);
        }
    }
    for (const asset of managedAssets) {
        if (!pathEntryExists(asset.file) || !isRegularFile(asset.file)) {
            diagnostics.push(`${asset.relative}: managed通常fileがありません`);
            continue;
        }
        if (digest(asset.file) !== asset.expected)
            diagnostics.push(`${asset.relative}: managed hashが一致しません`);
    }
    const source = path.join(target, HOST_SKILL_SOURCE);
    let sourceHash;
    if (!pathEntryExists(source) || !isRegularFile(source))
        diagnostics.push(`${HOST_SKILL_SOURCE}: 通常fileがありません`);
    else {
        const markdown = fs.readFileSync(source, "utf8");
        sourceHash = digest(source);
        if (!validateAdapterFrontmatter(markdown))
            diagnostics.push(`${HOST_SKILL_SOURCE}: frontmatterが不正です`);
        if (!markdown.includes("../../../.agent-skill-chain/docs/01_開発ワークフロー.md") ||
            !markdown.includes(".agent-skill-chain/skills/step-NN-"))
            diagnostics.push(`${HOST_SKILL_SOURCE}: 正本linkが不正です`);
    }
    for (const relative of HOST_SKILL_TARGETS) {
        const file = path.join(target, relative);
        if (!pathEntryExists(file) || !isRegularFile(file)) {
            diagnostics.push(`${relative}: 通常fileがありません`);
            continue;
        }
        const actual = digest(file);
        if (!sourceHash || actual !== sourceHash)
            diagnostics.push(`${relative}: adapter正本とhashが一致しません`);
        if (files[relative] !== actual)
            diagnostics.push(`${relative}: managed recordとhashが一致しません`);
    }
    const policyFile = path.join(target, ".agent-skill-chain", "project-policy.json");
    let projectPolicyStatus = "missing";
    let projectPolicyMessage = "project policyは未作成です。install健全性とは別に利用project ownerが作成・検証してください";
    if (fs.existsSync(policyFile)) {
        try {
            const parsed = parseJsonStrict(fs.readFileSync(policyFile, "utf8"), "project policy");
            const schemaVersion = isRecord(parsed) ? parsed.schemaVersion : undefined;
            const knownVersion = schemaVersion === "agent-skill-chain/project-policy-manifest/v1" ||
                (typeof schemaVersion === "string" &&
                    (SUPPORTED_POLICY_SCHEMA_VERSIONS.includes(schemaVersion) ||
                        Object.prototype.hasOwnProperty.call(DEPRECATED_POLICY_SCHEMA_ALIASES, schemaVersion)));
            if (!knownVersion) {
                projectPolicyStatus = "unsupported-version";
                projectPolicyMessage =
                    "project policyのschemaVersionは未対応です。入力を保持してstaged migrationを計画してください";
            }
            else {
                loadProjectPolicySet(target);
                projectPolicyStatus = "valid";
                projectPolicyMessage =
                    "project policyはschemaとruntimeの現行契約に適合しています";
            }
        }
        catch {
            projectPolicyStatus = "invalid";
            projectPolicyMessage =
                "project policyが不正です。入力を変更せずpolicy validateの診断を確認してください";
        }
    }
    const issuesRoot = path.join(target, ".agent-skill-chain", "tmp", "issues");
    const workflowStagings = [];
    if (pathEntryExists(issuesRoot) && fs.lstatSync(issuesRoot).isDirectory()) {
        for (const entry of fs.readdirSync(issuesRoot, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const staging = path.join(issuesRoot, entry.name);
            try {
                workflowStagings.push(inspectDoctorWorkflowStaging(staging));
            }
            catch (error) {
                workflowStagings.push({
                    staging,
                    valid: false,
                    errors: [error instanceof Error ? error.message : String(error)],
                });
            }
        }
    }
    const workflowHealthy = workflowStagings.every((staging) => staging.valid);
    /**
     * **契約を満たしたまま止まっているstagingを名指しする**（Issue #954）。
     *
     * `healthy`の判定は変えない。**門を増やさず、報告だけを分ける。** 未完の
     * stagingには「契約を満たさない古い記録」と「単に途中で止まっている」が
     * 混ざっており、後者だけが手を入れる対象である。
     */
    const interruptedStagings = workflowStagings
        .filter((staging) => "interrupted" in staging && staging.interrupted)
        .map((staging) => ({
        staging: staging.staging,
        mode: staging.mode,
        currentStep: staging.currentStep,
        nextStep: staging.nextStep,
    }));
    const tooling = {
        git: inspectExecutableVersion("git", ["--version"], target, MINIMUM_GIT_VERSION),
        gh: inspectExecutableVersion("gh", ["--version"], target, MINIMUM_GH_VERSION),
    };
    const toolingDiagnostics = [tooling.git, tooling.gh].flatMap((tool) => tool.diagnostic ? [tool.diagnostic] : []);
    /**
     * **登録状態は報告するが`healthy`を変えない**（Issue #1105）。
     *
     * hook本体の欠落・改変はmanaged assetの診断として`healthy`へ入る。
     * **登録は利用者による有効化状態であり、packageのinstall健全性ではない。**
     * `healthy` keyをこの欄へ置かない。置くと門と誤読される。
     */
    /**
     * **境界外への解決失敗で`doctor`全体を止めない**（Issue #1105、外部reviewの指摘）。
     *
     * `.claude`がroot外を指すsymlinkだと`resolveContained`は例外を投げる。
     * **登録状態の観測は任意であり、失敗しても他の診断を返す価値がある。**
     * `resolveContained`自体は残すため、境界外のfileは読まない。
     */
    let hookSettingsFile;
    try {
        hookSettingsFile = resolveContained(target, HOST_HOOK_SETTINGS, {
            allowMissingLeaf: true,
        });
    }
    catch {
        hookSettingsFile = undefined;
    }
    /**
     * **設定fileが無い場合を例外にしない。** `isRegularFile`は`lstatSync`を使い
     * ENOENTを投げる。**未登録は正常な状態であり、診断の対象であって失敗ではない。**
     */
    const hookRegistration = inspectHookRegistration({
        settings: hookSettingsFile !== undefined &&
            fs.existsSync(hookSettingsFile) &&
            isRegularFile(hookSettingsFile)
            ? fs.readFileSync(hookSettingsFile, "utf8")
            : undefined,
        expectedCommandFragment: HOST_HOOK_TARGETS[0],
    });
    return {
        healthy: installed && diagnostics.length === 0,
        installed,
        hooks: {
            canonical: HOST_HOOK_SOURCE,
            expected: [...HOST_HOOK_TARGETS],
            registered: hookRegistration.registered,
            diagnostics: hookRegistration.registered ? [] : [hookRegistration.reason],
        },
        adapters: {
            expected: [...HOST_SKILL_TARGETS],
            healthy: diagnostics.length === 0,
            diagnostics,
        },
        legacyDetected: legacy,
        legacyRuntimeEnabled: false,
        projectPolicyStatus,
        projectPolicyMessage,
        tooling: {
            healthy: toolingDiagnostics.length === 0,
            diagnostics: toolingDiagnostics,
            git: tooling.git,
            gh: tooling.gh,
        },
        workflow: {
            healthy: workflowHealthy,
            /** 契約を満たしたまま未完で止まっているstaging（Issue #954）。 */
            interrupted: interruptedStagings,
            stagings: workflowStagings,
        },
        worktrees: worktreeSurvey
            ? {
                cleanupReadyCount: worktreeSurvey.cleanupReady.length,
                retainedCount: worktreeSurvey.retained.length,
                inProgressCount: worktreeSurvey.inProgress.length,
                diagnostics: [
                    ...worktreeSurvey.cleanupReady.map((worktreePath) => `既定branchへmerge済みで後片付け可能です: ${worktreePath}`),
                    ...worktreeSurvey.errors.map((error) => `worktree走査を完了できませんでした: ${error}`),
                ],
            }
            : undefined,
        migration: legacy.length
            ? "診断のみ。旧資産は実行も変換もしません"
            : "なし",
    };
}
//# sourceMappingURL=lifecycle.js.map