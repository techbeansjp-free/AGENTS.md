/**
 * Jev guided setup（Issue #1486、T-06/T-07）。
 *
 * Issueの明文化された設計原則（2026-09-26追記2）: 「人間が自分のAIエージェント
 * へ自然言語でJevのkey・endpoint・model名を伝え、AIエージェントがそれを
 * 受けて設定を完了させる」流れを前提にする。したがって：
 *
 * - `configureJevProviderConfig`（T-06）はendpoint/model/apiKeyEnvVar
 *   （非秘密情報）を引数で受け取る。**AIエージェントがこれらの値を代行して
 *   呼び出してよい。** 戻り値は常にJSON化可能な構造（機械可読）で、
 *   `LocalConfigResolution`の状態をそのまま含む
 * - APIキーの値そのものは、このmoduleのどの関数も引数として受け取らない。
 *   `appendJevApiKeyToShellRc`（T-07）は`process.env[apiKeyEnvVar]`から
 *   実行時に読むだけであり、値がCLI引数・コマンド履歴へ現れる経路が無い。
 *   Issue本文が求める役割分担（「値はAIへ渡さず、人間が自分のshellで
 *   `export`する」）は、値をこのCLIの引数にしないという設計そのもので
 *   実現する——値を渡す入力経路自体が存在しない
 * - 追記は`--apply`かつ明示的な`--confirm=APPEND`の両方を要求し、
 *   dry-runでは何も書き込まない（無言で書き換えない）。出力はどの状態でも
 *   値そのものを含まない
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../lib/atomic.js";
import { ENV_VAR_NAME_PATTERN, JEV_PROVIDER_CONFIG_PATH, } from "../domain/jev-provider-config.js";
import { resolveJevProviderConfig } from "./local-config-workspace.js";
// --- T-06: guided setup command（jev-provider.jsonの生成） ------------------
function validateEndpoint(endpoint) {
    if (endpoint.trim() === "")
        return "endpointは空でない文字列が必要です";
    let parsed;
    try {
        parsed = new URL(endpoint);
    }
    catch {
        return "endpointは有効なURLが必要です";
    }
    if (parsed.protocol !== "https:")
        return "endpointはhttps://で始まる必要があります";
    return undefined;
}
/**
 * `.agent-skill-chain/local/jev-provider.json`を正しいschemaで生成する
 * （Issue #1486、S-06）。**設定fileの手書きを不要にする。** `apply=false`
 * （dry-run）では書き込まず、書き込んだ場合に得られるはずの
 * `LocalConfigResolution`を予測して返す。
 */
export function configureJevProviderConfig(input) {
    const errors = [];
    const endpointError = validateEndpoint(input.endpoint);
    if (endpointError !== undefined)
        errors.push(endpointError);
    if (input.model.trim() === "")
        errors.push("modelは空でない文字列が必要です");
    if (!ENV_VAR_NAME_PATTERN.test(input.apiKeyEnvVar))
        errors.push("apiKeyEnvVarは英大文字・数字・_のみで先頭は英字か_が必要です（例: JEV_API_KEY）");
    const configPath = path.resolve(input.root, JEV_PROVIDER_CONFIG_PATH);
    const wouldWrite = {
        enabled: true,
        apiKeyEnvVar: input.apiKeyEnvVar,
        endpoint: input.endpoint,
        model: input.model,
    };
    if (errors.length > 0)
        return {
            configPath,
            wouldWrite,
            applied: false,
            validationErrors: errors,
            resolution: {
                state: "invalid",
                source: "active",
                reason: errors.join("; "),
            },
        };
    if (input.apply)
        writeFileAtomic(configPath, `${JSON.stringify(wouldWrite, null, 2)}\n`);
    const resolution = input.apply
        ? resolveJevProviderConfig(input.root)
        : previewResolutionAfterWrite(wouldWrite);
    return {
        configPath,
        wouldWrite,
        applied: input.apply,
        validationErrors: [],
        resolution,
    };
}
/**
 * dry-run用: 実際に書き込んだ場合に`classifyJevProviderConfig`が返すはずの
 * 状態を、書き込み無しで予測する。schema検証はここへ来る前に確定している
 * ため、残る分岐は`apiKeyEnvVar`が現在のprocess.envに設定済みかどうかだけ
 * （既存loaderの`enabled`分岐と同じ規則）。
 */
function previewResolutionAfterWrite(config) {
    const envValue = process.env[config.apiKeyEnvVar];
    if (typeof envValue !== "string" || envValue.length === 0)
        return {
            state: "invalid",
            source: "active",
            reason: `enabledだが指定env var ${config.apiKeyEnvVar} が未設定です（--applyで書き込んでも、env varを設定しない限り同じ状態のままです）`,
        };
    return { state: "enabled", config, source: "active" };
}
/**
 * `$SHELL`から起動fileを推定する（Issue #1486、S-07）。対応外shellは
 * fail-closedで`ok: false`を返す（推測で別fileへ書かない）。
 */
export function detectShellRcFile(env = process.env, homeDir = os.homedir()) {
    const shellPath = env.SHELL;
    if (typeof shellPath !== "string" || shellPath.trim() === "")
        return { ok: false, reason: "$SHELLが設定されていません" };
    const shellName = path.basename(shellPath);
    if (shellName === "zsh")
        return { ok: true, shell: "zsh", rcPath: path.join(homeDir, ".zshrc") };
    if (shellName === "bash")
        return { ok: true, shell: "bash", rcPath: path.join(homeDir, ".bashrc") };
    return {
        ok: false,
        reason: `未対応のshellです（$SHELL=${shellPath}）。対応: bash、zsh`,
    };
}
function exportLinePattern(apiKeyEnvVar) {
    return new RegExp(`^\\s*export\\s+${apiKeyEnvVar}=`, "mu");
}
const REQUIRED_CONFIRM_TOKEN = "APPEND";
/**
 * `rcPath`へ`export <apiKeyEnvVar>=<値>`を追記する。**値は引数として
 * 受け取らない**——`process.env[apiKeyEnvVar]`（呼び出し時にその shell で
 * 既に`export`済みの値）を直接読むだけで、CLI引数・コマンド履歴には値が
 * 一切現れない。戻り値にも値を含めない。
 *
 * 書き込みには`apply: true`と`confirm: "APPEND"`の両方が必要（Issue本文
 * 「確認を挟んだ上でのopt-in」「無言で書き換えない」）。既に同名変数の
 * `export`行が存在する場合は、内容を検査せず（値を読まず）常に無変更で
 * `alreadyPresent: true`を返す（重複追記・既存記述の上書きを避ける）。
 */
export function appendJevApiKeyToShellRc(input) {
    if (!ENV_VAR_NAME_PATTERN.test(input.apiKeyEnvVar))
        throw new Error("apiKeyEnvVarは英大文字・数字・_のみで先頭は英字か_が必要です");
    const envValue = process.env[input.apiKeyEnvVar];
    const envVarSetInCurrentShell = typeof envValue === "string" && envValue.length > 0;
    const existingContent = fs.existsSync(input.rcPath)
        ? readRegularFile(input.rcPath)
        : "";
    const alreadyPresent = exportLinePattern(input.apiKeyEnvVar).test(existingContent);
    if (alreadyPresent)
        return {
            rcPath: input.rcPath,
            alreadyPresent: true,
            envVarSetInCurrentShell,
            applied: false,
            reason: `${input.rcPath}に既に${input.apiKeyEnvVar}のexport行があるため変更しません`,
        };
    if (!envVarSetInCurrentShell)
        return {
            rcPath: input.rcPath,
            alreadyPresent: false,
            envVarSetInCurrentShell: false,
            applied: false,
            reason: `現在のshellで${input.apiKeyEnvVar}が設定されていないため追記できません。先に export ${input.apiKeyEnvVar}=<値> を実行してから再度呼び出してください`,
        };
    if (!input.apply)
        return {
            rcPath: input.rcPath,
            alreadyPresent: false,
            envVarSetInCurrentShell: true,
            applied: false,
            reason: `dry-run: --applyと--confirm=${REQUIRED_CONFIRM_TOKEN}を指定すると${input.rcPath}へexport ${input.apiKeyEnvVar}=(値は表示しません) を追記します`,
        };
    if (input.confirm !== REQUIRED_CONFIRM_TOKEN)
        throw new Error(`shell rcへの追記には--confirm=${REQUIRED_CONFIRM_TOKEN}の明示指定が必要です（無言で書き換えない）`);
    const separator = existingContent === "" || existingContent.endsWith("\n") ? "" : "\n";
    const nextContent = `${existingContent}${separator}export ${input.apiKeyEnvVar}=${envValue}\n`;
    // 追記後のrc fileは秘密値を含む通常fileになる。既存fileのpermissionは
    // 尊重し（利用者自身の設定を変えない）、新規作成時だけ秘密値を含むfileの
    // 既定として0600を使う。
    const existingMode = fs.existsSync(input.rcPath)
        ? fs.statSync(input.rcPath).mode & 0o777
        : 0o600;
    writeFileAtomic(input.rcPath, nextContent, { fileMode: existingMode });
    return {
        rcPath: input.rcPath,
        alreadyPresent: false,
        envVarSetInCurrentShell: true,
        applied: true,
        reason: `${input.rcPath}へ${input.apiKeyEnvVar}のexport行を追記しました（値はこの出力に含まれません）`,
    };
}
function readRegularFile(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`${target}はsymlinkでない通常fileが必要です`);
    return fs.readFileSync(target, "utf8");
}
//# sourceMappingURL=jev-guided-setup.js.map