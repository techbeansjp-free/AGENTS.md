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
 *   値はmode 0600の専用file（`~/.config/agent-skill-chain/jev.env`）へ
 *   single quoteして書き、shell起動fileには値を含まないsource行だけを追記する
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
import {
  ENV_VAR_NAME_PATTERN,
  JEV_PROVIDER_CONFIG_PATH,
  type JevProviderConfig,
} from "../domain/jev-provider-config.js";
import type { LocalConfigResolution } from "../domain/local-config-resolution.js";
import { resolveJevProviderConfig } from "./local-config-workspace.js";

// --- T-06: guided setup command（jev-provider.jsonの生成） ------------------

function validateEndpoint(endpoint: string): string | undefined {
  if (endpoint.trim() === "") return "endpointは空でない文字列が必要です";
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return "endpointは有効なURLが必要です";
  }
  if (parsed.protocol !== "https:")
    return "endpointはhttps://で始まる必要があります";
  return undefined;
}

export interface ConfigureJevProviderInput {
  readonly root: string;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKeyEnvVar: string;
  readonly apply: boolean;
}

export interface ConfigureJevProviderResult {
  readonly configPath: string;
  readonly wouldWrite: JevProviderConfig;
  readonly applied: boolean;
  readonly validationErrors: readonly string[];
  readonly resolution: LocalConfigResolution<JevProviderConfig>;
}

/**
 * `.agent-skill-chain/local/jev-provider.json`を正しいschemaで生成する
 * （Issue #1486、S-06）。**設定fileの手書きを不要にする。** `apply=false`
 * （dry-run）では書き込まず、書き込んだ場合に得られるはずの
 * `LocalConfigResolution`を予測して返す。
 */
export function configureJevProviderConfig(
  input: ConfigureJevProviderInput,
): ConfigureJevProviderResult {
  const errors: string[] = [];
  const endpointError = validateEndpoint(input.endpoint);
  if (endpointError !== undefined) errors.push(endpointError);
  if (input.model.trim() === "") errors.push("modelは空でない文字列が必要です");
  if (!ENV_VAR_NAME_PATTERN.test(input.apiKeyEnvVar))
    errors.push(
      "apiKeyEnvVarはJEV_で始まる英大文字・数字・_のみが必要です（例: JEV_API_KEY）",
    );

  const configPath = path.resolve(input.root, JEV_PROVIDER_CONFIG_PATH);
  const wouldWrite: JevProviderConfig = {
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
function previewResolutionAfterWrite(
  config: JevProviderConfig,
): LocalConfigResolution<JevProviderConfig> {
  const envValue = process.env[config.apiKeyEnvVar];
  if (typeof envValue !== "string" || envValue.length === 0)
    return {
      state: "invalid",
      source: "active",
      reason: `enabledだが指定env var ${config.apiKeyEnvVar} が未設定です（--applyで書き込んでも、env varを設定しない限り同じ状態のままです）`,
    };
  return { state: "enabled", config, source: "active" };
}

// --- T-07: shell起動fileへのexport追記（確認付き） -------------------------

export type ShellRcDetection =
  | {
      readonly ok: true;
      readonly shell: "bash" | "zsh";
      readonly rcPath: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * `$SHELL`から起動fileを推定する（Issue #1486、S-07）。対応外shellは
 * fail-closedで`ok: false`を返す（推測で別fileへ書かない）。
 */
export function detectShellRcFile(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): ShellRcDetection {
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

function exportLinePattern(apiKeyEnvVar: string): RegExp {
  return new RegExp(`^\\s*export\\s+${apiKeyEnvVar}=`, "mu");
}

/**
 * 秘密値の保存先の既定（独立security review M1/M2）。rc fileは多くの場合
 * 0644でdotfile repositoryにも追跡されるため、値はrcへ書かず、この専用
 * file（0600、親directory 0700）へだけ書く。rcへはこのfileを読み込む
 * 非秘密の1行だけを追記する。
 */
export function defaultJevSecretFilePath(
  homeDir: string = os.homedir(),
): string {
  return path.join(homeDir, ".config", "agent-skill-chain", "jev.env");
}

/** POSIX shellのsingle quoteで囲む（`'`は`'\''`へ置換）。 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

/**
 * rcへ追記する非秘密の行。secret fileが存在する場合だけ読み込む。pathは
 * single quoteで囲み、値を一切含まない。
 */
export function jevSecretSourceLine(secretFilePath: string): string {
  const quoted = shellSingleQuote(secretFilePath);
  return `[ -f ${quoted} ] && . ${quoted}`;
}

// 改行・NUL・その他の制御文字を含む値は、quoteしても行注入・切り詰めの
// 原因になるため書き込まずに拒否する（値は出力しない）。
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface AppendJevApiKeyInput {
  readonly apiKeyEnvVar: string;
  readonly rcPath: string;
  /**
   * 秘密値を書き込む専用file。CLIは`defaultJevSecretFilePath()`を渡す。
   * 既定値を持たせないのは、testが利用者の実home配下へ書き込む経路を
   * 作らないため。
   */
  readonly secretFilePath: string;
  readonly apply: boolean;
  /** 明示確認token。`--apply`と同時に`"APPEND"`と一致する場合だけ書き込む。 */
  readonly confirm?: string;
}

export interface AppendJevApiKeyResult {
  readonly rcPath: string;
  readonly secretFilePath: string;
  readonly alreadyPresent: boolean;
  readonly envVarSetInCurrentShell: boolean;
  readonly applied: boolean;
  readonly reason: string;
}

const REQUIRED_CONFIRM_TOKEN = "APPEND";

/**
 * `secretFilePath`（mode 0600）へ`export <apiKeyEnvVar>='<値>'`を書き、
 * `rcPath`へはそのfileを読み込む非秘密の1行だけを追記する（独立security
 * review M1/M2）。**値は引数として受け取らない**——`process.env[apiKeyEnvVar]`
 * （呼び出し時にその shell で既に`export`済みの値）を直接読むだけで、CLI
 * 引数・コマンド履歴には値が一切現れない。戻り値・例外messageにも値を
 * 含めない。
 *
 * 書き込みには`apply: true`と`confirm: "APPEND"`の両方が必要（Issue本文
 * 「確認を挟んだ上でのopt-in」「無言で書き換えない」）。rcに同名変数の
 * `export`行が既にある場合、またはsecret fileのexport行とrcのsource行が
 * 両方揃っている場合は、常に無変更で`alreadyPresent: true`を返す
 * （重複追記・既存記述の上書きを避ける）。
 */
export function appendJevApiKeyToShellRc(
  input: AppendJevApiKeyInput,
): AppendJevApiKeyResult {
  if (!ENV_VAR_NAME_PATTERN.test(input.apiKeyEnvVar))
    throw new Error(
      "apiKeyEnvVarはJEV_で始まる英大文字・数字・_のみが必要です（例: JEV_API_KEY）",
    );
  const envValue = process.env[input.apiKeyEnvVar];
  const envVarSetInCurrentShell =
    typeof envValue === "string" && envValue.length > 0;

  const existingRc = fs.existsSync(input.rcPath)
    ? readRegularFile(input.rcPath)
    : "";
  const existingSecret = fs.existsSync(input.secretFilePath)
    ? readRegularFile(input.secretFilePath)
    : "";
  const sourceLine = jevSecretSourceLine(input.secretFilePath);
  const exportPattern = exportLinePattern(input.apiKeyEnvVar);
  const secretPresent = exportPattern.test(existingSecret);
  const sourcePresent = existingRc
    .split("\n")
    .some((line) => line.trim() === sourceLine);
  const base = { rcPath: input.rcPath, secretFilePath: input.secretFilePath };

  if (exportPattern.test(existingRc) || (secretPresent && sourcePresent))
    return {
      ...base,
      alreadyPresent: true,
      envVarSetInCurrentShell,
      applied: false,
      reason: `${input.apiKeyEnvVar}のexport行とその読み込みは既に設定済みのため変更しません`,
    };

  if (!secretPresent && !envVarSetInCurrentShell)
    return {
      ...base,
      alreadyPresent: false,
      envVarSetInCurrentShell: false,
      applied: false,
      reason: `現在のshellで${input.apiKeyEnvVar}が設定されていないため追記できません。先に export ${input.apiKeyEnvVar}=<値> を実行してから再度呼び出してください`,
    };

  if (
    !secretPresent &&
    typeof envValue === "string" &&
    CONTROL_CHARACTER_PATTERN.test(envValue)
  )
    throw new Error(
      `${input.apiKeyEnvVar}の値が改行・NUL等の制御文字を含むため書き込みません（値は表示しません）`,
    );

  if (!input.apply)
    return {
      ...base,
      alreadyPresent: false,
      envVarSetInCurrentShell,
      applied: false,
      reason: `dry-run: --applyと--confirm=${REQUIRED_CONFIRM_TOKEN}を指定すると${input.secretFilePath}（mode 0600）へexport ${input.apiKeyEnvVar}=(値は表示しません) を書き、${input.rcPath}へはそのfileを読み込む行だけを追記します`,
    };

  if (input.confirm !== REQUIRED_CONFIRM_TOKEN)
    throw new Error(
      `shell rcへの追記には--confirm=${REQUIRED_CONFIRM_TOKEN}の明示指定が必要です（無言で書き換えない）`,
    );

  if (!secretPresent && typeof envValue === "string") {
    const secretDirectory = path.dirname(input.secretFilePath);
    fs.mkdirSync(secretDirectory, { recursive: true, mode: 0o700 });
    const directoryStat = fs.lstatSync(secretDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
      throw new Error(
        `${secretDirectory}はsymlinkでない通常directoryが必要です`,
      );
    const separator =
      existingSecret === "" || existingSecret.endsWith("\n") ? "" : "\n";
    writeFileAtomic(
      input.secretFilePath,
      `${existingSecret}${separator}export ${input.apiKeyEnvVar}=${shellSingleQuote(envValue)}\n`,
      { fileMode: 0o600 },
    );
  }

  if (!sourcePresent) {
    const separator =
      existingRc === "" || existingRc.endsWith("\n") ? "" : "\n";
    // rcへ追記するのは値を含まないsource行だけなので、既存fileのpermission
    // は尊重する（利用者自身の設定を変えない）。
    const existingMode = fs.existsSync(input.rcPath)
      ? fs.statSync(input.rcPath).mode & 0o777
      : 0o644;
    writeFileAtomic(input.rcPath, `${existingRc}${separator}${sourceLine}\n`, {
      fileMode: existingMode,
    });
  }

  return {
    ...base,
    alreadyPresent: false,
    envVarSetInCurrentShell,
    applied: true,
    reason: `${input.secretFilePath}（mode 0600）へ${input.apiKeyEnvVar}のexport行を書き、${input.rcPath}へそのfileを読み込む行を追記しました（値はこの出力に含まれません）`,
  };
}

function readRegularFile(target: string): string {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${target}はsymlinkでない通常fileが必要です`);
  return fs.readFileSync(target, "utf8");
}
