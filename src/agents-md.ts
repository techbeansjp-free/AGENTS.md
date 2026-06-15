#!/usr/bin/env node
// agents-md — npm 配布用の薄い CLI ラッパ。
// 役割: 採用先プロジェクトのルート（既定は process.cwd()）を第1引数として
//       .agents/scripts/setup.sh に渡し、正本配備・各ツール向け生成・workflow.db 初期化を行う。
// 正本は .agents/。本 CLI はロジックを持たず setup.sh を呼び出す薄いラッパに徹する。
//
// サブコマンド:
//   init             setup.sh を実行して採用先へ配備する
//   upgrade          init と同等（当面）。既存配備の再同期を意図する
//   uninstall        setup/init が配備した成果物のみを除去する（ユーザー資産は既定で保持）
//   doctor           配備に必要な前提ファイル・依存の存在確認
//   enforce on|off|status  enforcement フックを .claude/settings.json に着脱（既定 off / opt-in）
//   version          package.json の version を表示
//   help / (既定)    使い方を表示

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// パッケージ root は bin/ の 1 つ上。
const PACKAGE_ROOT = join(__dirname, "..");
const SETUP_PATH = join(PACKAGE_ROOT, ".agents", "scripts", "setup.sh");
// enforcement 用 settings.json の正本テンプレート（既定 off。opt-in で配線する）。
const ENFORCE_TEMPLATE_PATH = join(
  PACKAGE_ROOT,
  ".agents",
  "platforms",
  "claude",
  "settings.enforce.json"
);

// ----------------------------------------------------------------------------
// 型定義（外部 JSON は unknown 経由で安全に絞り込む。CLI が触る最小範囲のみ型付けする）。
// ----------------------------------------------------------------------------

// JSON のプレーンオブジェクト（キー -> unknown）。型ガードで判定する。
type JsonObject = Record<string, unknown>;

// settings.json / テンプレートが扱う hook エントリ（注入印 __agentsMdEnforce を持ちうる）。
interface HookEntry extends JsonObject {
  __agentsMdEnforce?: boolean;
}

// settings.json の最小形（CLI が読み書きするキーのみ）。残りは unknown のまま保持する。
interface Settings extends JsonObject {
  env?: JsonObject;
  hooks?: Record<string, unknown>;
}

// enforce テンプレートの最小形。
interface EnforceTemplate extends JsonObject {
  env?: JsonObject;
  hooks?: Record<string, unknown>;
}

// uninstall のオプション。
interface UninstallOpts {
  yes: boolean;
  purge: boolean;
}

// プレーンオブジェクト（配列・null を除く object）かを判定する型ガード。
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// enforcement で対象にする hook イベント名。
const HOOK_EVENTS = ["PreToolUse", "PostToolUse"] as const;
type HookEvent = (typeof HOOK_EVENTS)[number];

function readVersion(): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
    );
    if (isJsonObject(parsed) && typeof parsed.version === "string") {
      return parsed.version;
    }
    return "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function printHelp(): void {
  const name = "agents-md";
  console.log(`${name} v${readVersion()} — AI 実行契約・ワークフロー仕様パッケージの配備 CLI

使い方:
  npx @techbeansjp-free/agents-md <command>

コマンド:
  init [dir]            採用先プロジェクト（既定: カレントディレクトリ）へ .agents/ 等を配備する
  upgrade [dir]         既存配備を再同期する（当面 init と同等）
  uninstall [dir]       init/setup が配備した成果物のみを除去する（ユーザー資産は既定で保持）
  doctor                配備に必要な前提（setup.sh・bash・sqlite3 等）の有無を確認する
  enforce <on|off|status> [dir]
                        enforcement フック（PreToolUse/PostToolUse）を .claude/settings.json に着脱する。
                        既定は off（init では配線しない）。on で opt-in、off で解除、status で現状表示。
  version               パッケージのバージョンを表示する
  help                  このヘルプを表示する

uninstall のオプション:
  --yes, -y            対話確認をスキップして実行する（既定は dry-run 表示のみ）
  --purge              workflow.db 等の証跡も含めて削除する（既定は保持）

enforce のオプション:
  enforce on           settings.json に enforcement 配線を追加する（既存ユーザー値はマージ・保持。退避 .bak を作成）
  enforce off          enforcement 配線のみを外す（ユーザーの他設定は保持）
  enforce status       現在 on/off と hook スクリプト実在性を表示する

例:
  cd my-project && npx @techbeansjp-free/agents-md init
  npx @techbeansjp-free/agents-md@0.1.0 init       # 版をピン留め
  npx @techbeansjp-free/agents-md uninstall        # 削除対象を表示（dry-run）
  npx @techbeansjp-free/agents-md uninstall --yes  # 実際に除去する

注意:
  init は内部で ${".agents/scripts/setup.sh"} を実行します。
  setup.sh は workflow.db 初期化に sqlite3 バイナリを必要とします（doctor で確認可能）。
  uninstall は既定で .agents-project/・.workflow の issue・workflow.db を保持します
  （--purge で workflow.db も削除）。引数なしの場合は dry-run（表示のみ）です。
  enforcement は既定 off。ドッグフーディング時に enforce on で opt-in（セッション挙動が変わるため任意）。
  enforce off で解除します。enforce は .claude/settings.json のユーザー値を破壊せず配線のみ着脱します。`);
}

// setup.sh を projectRoot 引数つきで実行する。
function runSetup(projectRoot: string): number {
  if (!existsSync(SETUP_PATH)) {
    console.error(
      `エラー: setup.sh が見つかりません: ${SETUP_PATH}\n` +
        `パッケージが壊れている可能性があります。再インストールしてください。`
    );
    return 1;
  }
  const result = spawnSync("bash", [SETUP_PATH, projectRoot], { stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(
        `エラー: bash が見つかりません。setup.sh の実行には bash が必要です。\n` +
          `bash を導入してから再実行してください。`
      );
    } else {
      console.error(`エラー: setup.sh の起動に失敗しました: ${err.message}`);
    }
    return 1;
  }
  return result.status ?? 0;
}

// doctor: 配備に必要な前提を確認する。終了コードで成否を返す。
function runDoctor(): number {
  const projectRoot = process.cwd();
  let ok = true;

  const check = (label: string, present: boolean, hint?: string): void => {
    console.log(`${present ? "[OK]  " : "[NG]  "}${label}`);
    if (!present) {
      ok = false;
      if (hint) console.log(`        ヒント: ${hint}`);
    }
  };

  console.log(`doctor: 採用先=${projectRoot}`);
  console.log(`        パッケージ=${PACKAGE_ROOT}`);

  // パッケージ側の必須ファイル
  check(".agents/scripts/setup.sh（配備スクリプト）", existsSync(SETUP_PATH), "パッケージを再インストールしてください。");
  check(".agents/boot/CORE.md（実行契約の正本）", existsSync(join(PACKAGE_ROOT, ".agents", "boot", "CORE.md")));

  // 採用先側に配備済みかの確認（init 後の健全性）
  check("AGENTS.md（採用先ルート契約）", existsSync(join(projectRoot, "AGENTS.md")), "未配備の場合は init を実行してください。");
  const preHookPath = join(projectRoot, ".claude", "hooks", "PreToolUse.sh");
  const postHookPath = join(projectRoot, ".claude", "hooks", "PostToolUse.sh");
  check(
    ".claude/hooks/PreToolUse.sh（enforcement フック）",
    existsSync(preHookPath),
    "Claude enforcement が未配備の場合は init を実行してください。"
  );

  // enforcement の on/off 判定（opt-in 機構。既定 off）。
  // settings.json に本パッケージ由来の hook 配線があるかで判定する。hook スクリプト実在性も併せて表示する。
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  if (settings === null) {
    console.log("[WARN] .claude/settings.json が妥当な JSON ではありません（enforce 前に修正してください）。");
  } else {
    const on = enforceIsOn(settings);
    console.log(
      `[INFO] enforcement 配線 = ${on ? "on" : "off（既定）"}` +
        `${on ? "" : "。ドッグフーディング時に `agents-md enforce on` で opt-in できます。"}`
    );
    if (on && !(existsSync(preHookPath) && existsSync(postHookPath))) {
      console.log("[NG]  enforcement は on ですが hook スクリプトが未配備です。init を実行してください。");
      ok = false;
    }
  }

  // 依存バイナリ
  const bashOk = spawnSync("bash", ["-c", "true"]).status === 0;
  check("bash（setup.sh の実行に必須）", bashOk, "bash を導入してください。");

  const sqliteProbe = spawnSync("sqlite3", ["-version"]);
  const sqliteOk = !sqliteProbe.error && sqliteProbe.status === 0;
  if (sqliteOk) {
    console.log("[OK]  sqlite3（workflow.db 初期化に使用）");
  } else {
    // sqlite3 は警告扱い（init 時の DB 作成にのみ必要）。
    console.log("[WARN] sqlite3 が見つかりません。init 時の workflow.db 初期化に失敗します。");
    console.log("        ヒント: sqlite3 を導入してください（例: apt-get install sqlite3）。");
  }

  // install 状態の判定（uninstall の安全策と同じ「配備の痕跡」で判定する）。
  const installed =
    existsSync(join(projectRoot, ".agents")) || existsSync(join(projectRoot, "AGENTS.md"));
  console.log(
    installed
      ? "\ndoctor: 配備状態 = 配備済み（uninstall で除去可能）。"
      : "\ndoctor: 配備状態 = 未配備（init で配備してください）。"
  );

  console.log(ok ? "\ndoctor: 必須項目はすべて満たしています。" : "\ndoctor: 不足項目があります（上記 [NG] を参照）。");
  return ok ? 0 : 1;
}

// ----------------------------------------------------------------------------
// uninstall: setup/init が配備した成果物のみを除去する。
//
// 配備物の正本は setup.sh の配備ロジック。本 CLI はそれと一致する「配備物マニフェスト」を
// 1 か所に持つ。ユーザー資産（.agents-project/・.workflow の issue・workflow.db）は既定で保持し、
// 誤削除しない安全側設計とする。--purge で workflow.db 等も含め全削除する。
// ----------------------------------------------------------------------------

// 既定で除去する配備物（setup.sh が配備する成果物のみ）。相対パスで列挙する。
// 注1: .workflow は丸ごと消さない（issue・workflow.db はユーザー資産）。templates のみ除去する。
// 注2: .cursor/・.claude/ は **丸ごと消さない**。setup が配備したパッケージ所有分
//      （.cursor/<owned files>・.claude/hooks の所有フック・.claude/skills と .cursor/skills の所有 skill）
//      のみを除去し、ユーザー作成物（.cursor/rules/*.mdc・.claude/settings.json・.claude/hooks の独自フック・
//      .claude/skills や .cursor/skills のユーザー自作スキル等）が同居していれば保持する。
//      パッケージ所有ファイル/skill 名は正本（enforcement・skills）から動的に導出する（setup.sh と単一整合）。
// 注3: .claude/hooks・.claude/skills・.cursor/skills は**ディレクトリごと消さず**、所有エントリのみ除去する
//      （下記 deployedOwnedHookFiles / deployedOwnedSkillEntries で導出）。
const DEPLOYED_ARTIFACTS: string[] = [
  ".agents", // パッケージ正本のコピー（setup がコピー配備）
  "AGENTS.md", // ルート契約（setup がコピー）
  "CLAUDE.md", // ルート契約（setup がコピー）
  ".workflow/templates", // テンプレート（setup がコピー。.workflow 自体は残す）
];

// setup.sh が .cursor/・.claude/ 直下へコピーするパッケージ所有ファイルを enforcement 正本から導出する。
// setup.sh の copy_owned_files と同じ規則（トップレベルの通常ファイル、.gitkeep を除外）で算出する。
// これにより uninstall は「パッケージが配備した既知のファイル」だけを除去し、ユーザー作成物を残せる。
function ownedFilesFrom(srcDir: string, destRel: string): string[] {
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== ".gitkeep")
    .map((d) => join(destRel, d.name));
}

// .cursor/ 直下のパッケージ所有ファイル（agents-core.mdc・README.md 等）の配備物相対パス。
// setup.sh は enforcement/cursor/* を .cursor/ 直下へコピーする（copy_owned_files）。同じ規則で導出する。
function deployedOwnedFiles(): string[] {
  const enforcement = join(PACKAGE_ROOT, ".agents", "enforcement");
  return ownedFilesFrom(join(enforcement, "cursor"), ".cursor");
}

// .claude/hooks 配下のパッケージ所有フックファイルの配備物相対パス。
// setup.sh は enforcement/claude/* のトップレベル通常ファイル（.gitkeep 除外）を .claude/hooks へコピーする
// （copy_owned_files）。同じ規則で導出し、ユーザー独自フックを残してパッケージ所有分のみ除去する。
function deployedOwnedHookFiles(): string[] {
  const enforcement = join(PACKAGE_ROOT, ".agents", "enforcement");
  return ownedFilesFrom(join(enforcement, "claude"), join(".claude", "hooks"));
}

// パッケージが配備した所有 skill エントリ名（{domain}__{capability}・ドメイン直下 {domain}）を
// 正本 .agents/skills/ から導出する。命名規約の正本は lib/deploy-skills.sh（list_owned_skill_names）。
// 本関数はその走査規則を Node 側でミラーし（同一規則）、setup.sh と同じ所有集合を得る。
// drift を避けるため、命名規則を変えるときは lib/deploy-skills.sh と本関数の双方を整合させること。
function ownedSkillNames(): string[] {
  const skillsRoot = join(PACKAGE_ROOT, ".agents", "skills");
  if (!existsSync(skillsRoot)) return [];
  const names: string[] = [];
  for (const domainEnt of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!domainEnt.isDirectory()) continue;
    const domain = domainEnt.name;
    const domainDir = join(skillsRoot, domain);
    // ドメイン直下に SKILL.md があるケース（例: agent/）は {domain} を所有名とする。
    if (existsSync(join(domainDir, "SKILL.md"))) names.push(domain);
    // capability 配下に SKILL.md を持つものは {domain}__{capability} を所有名とする。
    for (const capEnt of readdirSync(domainDir, { withFileTypes: true })) {
      if (!capEnt.isDirectory()) continue;
      if (existsSync(join(domainDir, capEnt.name, "SKILL.md"))) {
        names.push(`${domain}__${capEnt.name}`);
      }
    }
  }
  return names;
}

// .claude/skills・.cursor/skills 配下のパッケージ所有 skill エントリの配備物相対パス。
// ユーザー自作スキル（所有集合外のディレクトリ）は対象に含めない（保持される）。
function deployedOwnedSkillEntries(): string[] {
  const names = ownedSkillNames();
  const rels: string[] = [];
  for (const base of [".claude/skills", ".cursor/skills"]) {
    for (const name of names) rels.push(join(base, name));
  }
  return rels;
}

// --purge 時のみ追加で除去する証跡（ユーザー資産）。
const PURGE_ARTIFACTS: string[] = [
  ".workflow/workflow.db",
  ".workflow/workflow.db-wal",
  ".workflow/workflow.db-shm",
];

// uninstall: deployed artifacts を除去する。
// 戻り値: 終了コード（0=成功, 1=安全側中止/失敗）。
function runUninstall(projectRoot: string, opts: UninstallOpts): number {
  const { yes, purge } = opts;

  // 安全策(1): 採用先が「自分が配備した」痕跡を持つか確認する。
  // 配備の中核（.agents/ または AGENTS.md）が無いのに他の保護物を消すのは想定外なので中止する。
  const looksInstalled =
    existsSync(join(projectRoot, ".agents")) || existsSync(join(projectRoot, "AGENTS.md"));
  if (!looksInstalled) {
    console.error(
      `エラー: ${projectRoot} に配備の痕跡（.agents/ または AGENTS.md）が見つかりません。\n` +
        `        誤削除を防ぐため uninstall を中止します（このディレクトリは未配備の可能性）。`
    );
    return 1;
  }

  // 削除対象を列挙する（存在するものだけ）。
  // パッケージ所有分を正本から動的に加える:
  //   - .cursor 直下の所有ファイル（agents-core.mdc 等）         … deployedOwnedFiles
  //   - .claude/hooks の所有フックファイル（PreToolUse.sh 等）   … deployedOwnedHookFiles
  //   - .claude/skills・.cursor/skills の所有 skill エントリ      … deployedOwnedSkillEntries
  // いずれもユーザー自作物（独自フック・自作スキル・自作 rules 等）は対象外（保持）。
  const targets: string[] = [
    ...DEPLOYED_ARTIFACTS,
    ...deployedOwnedFiles(),
    ...deployedOwnedHookFiles(),
    ...deployedOwnedSkillEntries(),
  ];
  if (purge) targets.push(...PURGE_ARTIFACTS);

  const present = targets
    .map((rel) => ({ rel, abs: join(projectRoot, rel) }))
    .filter((t) => existsSync(t.abs));
  const absent = targets.filter((rel) => !existsSync(join(projectRoot, rel)));

  console.log(`uninstall: 採用先=${projectRoot}`);
  console.log(`        モード=${purge ? "purge（証跡も削除）" : "既定（ユーザー資産は保持）"}`);
  console.log("\n削除対象（配備物のみ）:");
  if (present.length === 0) {
    console.log("  （削除対象なし。既に除去済みの可能性があります。）");
  } else {
    present.forEach((t) => {
      const kind = statSync(t.abs).isDirectory() ? "dir " : "file";
      console.log(`  [${kind}] ${t.rel}`);
    });
  }
  if (absent.length > 0) {
    console.log("\n存在せずスキップ:");
    absent.forEach((rel) => console.log(`  (skip) ${rel}`));
  }

  console.log("\n保持するユーザー資産（削除しません）:");
  console.log("  .agents-project/        （プロジェクト固有ルール）");
  console.log("  .cursor/ のユーザー作成物（自作 rules/*.mdc 等。配備分以外は保持）");
  console.log("  .claude/ のユーザー設定 （settings.json 等。配備分以外は保持）");
  console.log("  .workflow/<issue>/      （templates 以外の issue 成果物）");
  if (!purge) console.log("  .workflow/workflow.db*  （証跡 DB。--purge 指定時のみ削除）");

  if (!yes) {
    console.log(
      "\n[dry-run] これは表示のみです。実際に除去するには --yes を付けて再実行してください:\n" +
        `  npx @techbeansjp-free/agents-md uninstall${purge ? " --purge" : ""} --yes`
    );
    return 0;
  }

  if (present.length === 0) {
    console.log("\nuninstall: 除去対象がありませんでした。");
    return 0;
  }

  let failed = false;
  for (const t of present) {
    try {
      rmSync(t.abs, { recursive: true, force: true });
      console.log(`削除しました: ${t.rel}`);
    } catch (e) {
      failed = true;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`エラー: ${t.rel} の削除に失敗しました: ${msg}`);
    }
  }

  // 後始末: パッケージ配備物の除去後に**空になった**ディレクトリのみ片付ける。
  // 子（.claude/hooks 等）→ 親（.claude 等）の順で空判定する。
  // ユーザー作成物（独自フック・自作スキル・.cursor/rules/*.mdc・.claude/settings.json 等）が
  // 残っている場合は空でないため削除しない（保持）。
  for (const dirRel of [
    ".claude/hooks",
    ".claude/skills",
    ".cursor/skills",
    ".cursor",
    ".claude",
  ]) {
    const abs = join(projectRoot, dirRel);
    try {
      if (existsSync(abs) && statSync(abs).isDirectory() && readdirSync(abs).length === 0) {
        rmSync(abs, { recursive: true, force: true });
        console.log(`空ディレクトリを削除しました: ${dirRel}`);
      }
    } catch {
      // 空判定・削除に失敗しても致命的でない（ユーザー資産がある等）。保持側に倒す。
    }
  }

  console.log(
    failed
      ? "\nuninstall: 一部の削除に失敗しました（上記参照）。"
      : "\nuninstall: 配備物の除去が完了しました（ユーザー資産は保持）。"
  );
  return failed ? 1 : 0;
}

// ----------------------------------------------------------------------------
// enforce: enforcement フックを .claude/settings.json に着脱する（既定 off / opt-in）。
//
// 方針（ライブセッション保護・ユーザー値非破壊）:
//   - 既定では init/setup は settings.json に enforcement を書き込まない（off）。
//   - `enforce on`  … 正本テンプレート（.agents/platforms/claude/settings.enforce.json）から
//                     hooks.PreToolUse/PostToolUse・env(AGENT_ROLE 等)を **既存 settings.json にマージ**する。
//                     注入したエントリには見えない目印を持たせず、env は managed キー集合で識別する。
//                     既存 settings.json があれば書き換え前に .bak へ退避する。
//   - `enforce off` … enforcement 由来の配線（managed env キー・本パッケージが注入した hook エントリ）
//                     のみを取り除く。ユーザーが書いた他の env/hooks/設定は保持する。
//   - `enforce status` … 現在の on/off と hook スクリプトの実在性を表示する。
//
// 注入の識別:
//   - 注入する各 hook エントリに `"__agentsMdEnforce": true` を付与し、off で除去する目印にする。
//   - 注入する env キーは ENFORCE_MANAGED_ENV_KEYS で固定（テンプレートの env から導出）。
// ----------------------------------------------------------------------------

// テンプレートを読み込む（壊れていれば null）。
function readEnforceTemplate(): EnforceTemplate | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(ENFORCE_TEMPLATE_PATH, "utf8"));
    return isJsonObject(parsed) ? (parsed as EnforceTemplate) : null;
  } catch {
    return null;
  }
}

// settings.json を読み込む（無ければ {}、壊れていれば null を返す）。
function readSettings(settingsPath: string): Settings | null {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    return isJsonObject(parsed) ? (parsed as Settings) : null;
  } catch {
    return null;
  }
}

// hook 配列（PreToolUse 等）内で、本パッケージが注入したエントリかを判定する。
function isManagedHookEntry(entry: unknown): entry is HookEntry {
  return isJsonObject(entry) && entry.__agentsMdEnforce === true;
}

// enforce 状態の判定: settings.json に managed hook エントリが 1 つでもあれば on。
function enforceIsOn(settings: Settings): boolean {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  for (const event of HOOK_EVENTS) {
    const arr = (hooks as Record<string, unknown>)[event];
    if (Array.isArray(arr) && arr.some(isManagedHookEntry)) return true;
  }
  return false;
}

// テンプレートの env キー集合（managed env キー）。off で除去対象にする。
function templateEnvKeys(template: EnforceTemplate): string[] {
  return template.env ? Object.keys(template.env) : [];
}

// テンプレートの hooks から指定イベントのエントリ配列を取り出す（無ければ空配列）。
function templateHookEntries(template: EnforceTemplate, event: HookEvent): JsonObject[] {
  const hooks = template.hooks;
  if (!hooks || typeof hooks !== "object") return [];
  const arr = (hooks as Record<string, unknown>)[event];
  return Array.isArray(arr) ? arr.filter(isJsonObject) : [];
}

// enforce on: テンプレートを既存 settings にマージする（ユーザー値は保持・退避 .bak を作成）。
function enforceOn(
  projectRoot: string,
  settingsPath: string,
  settings: Settings,
  template: EnforceTemplate
): number {
  const next: Settings = { ...settings };

  // env: テンプレートの managed キーを設定する。既存ユーザー env は保持し、managed キーのみ上書きする。
  next.env = { ...(settings.env || {}) };
  for (const [k, v] of Object.entries(template.env || {})) {
    next.env[k] = v;
  }

  // hooks: 既存 hooks を保持しつつ、各イベントに managed エントリを（重複なく）追加する。
  const nextHooks: Record<string, unknown> = { ...(settings.hooks || {}) };
  for (const event of HOOK_EVENTS) {
    const tmplEntries = templateHookEntries(template, event);
    // 既存配列から過去の managed エントリを除去してから注入（再 on の冪等性）。
    const current = nextHooks[event];
    const existing = Array.isArray(current)
      ? current.filter((e) => !isManagedHookEntry(e))
      : [];
    const injected = tmplEntries.map((e): HookEntry => ({ ...e, __agentsMdEnforce: true }));
    nextHooks[event] = [...existing, ...injected];
  }
  next.hooks = nextHooks;

  // 退避: 既存 settings.json があれば .bak に退避する（上書き前の安全策）。
  if (existsSync(settingsPath)) {
    const bak = settingsPath + ".bak";
    try {
      writeFileSync(bak, readFileSync(settingsPath, "utf8"));
      console.log(`enforce: 既存 settings.json を退避しました: ${bak}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`警告: settings.json の退避に失敗しました: ${msg}`);
    }
  }

  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`enforce: on にしました（${settingsPath} に enforcement 配線をマージ）。`);
  console.log("        AGENT_ROLE=orchestrator・PreToolUse/PostToolUse を配線しました。");
  console.log("        注意: ライブセッションに反映するには Claude Code の再起動が必要です。");

  // hook スクリプト実在性の警告（配備前なら案内）。
  warnIfHookScriptsMissing(projectRoot);
  return 0;
}

// enforce off: managed env キーと managed hook エントリのみを除去する（ユーザー値は保持）。
function enforceOff(
  _projectRoot: string,
  settingsPath: string,
  settings: Settings,
  template: EnforceTemplate
): number {
  if (!existsSync(settingsPath)) {
    console.log(`enforce: ${settingsPath} がありません。既に off です。`);
    return 0;
  }
  const next: Settings = { ...settings };

  // env: managed キーのみ削除。残りが空になれば env 自体を消す。
  if (next.env && typeof next.env === "object") {
    next.env = { ...next.env };
    for (const k of templateEnvKeys(template)) delete next.env[k];
    if (Object.keys(next.env).length === 0) delete next.env;
  }

  // hooks: 各イベントから managed エントリのみ除去。空配列になれば当該イベントキーを消す。
  if (next.hooks && typeof next.hooks === "object") {
    const nextHooks: Record<string, unknown> = { ...next.hooks };
    for (const event of HOOK_EVENTS) {
      const arr = nextHooks[event];
      if (Array.isArray(arr)) {
        const kept = arr.filter((e) => !isManagedHookEntry(e));
        if (kept.length === 0) delete nextHooks[event];
        else nextHooks[event] = kept;
      }
    }
    if (Object.keys(nextHooks).length === 0) delete next.hooks;
    else next.hooks = nextHooks;
  }

  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`enforce: off にしました（${settingsPath} から enforcement 配線を除去。ユーザー値は保持）。`);
  console.log("        注意: ライブセッションに反映するには Claude Code の再起動が必要です。");
  return 0;
}

// hook スクリプトが配備済みかを確認し、未配備なら警告する。
function warnIfHookScriptsMissing(projectRoot: string): void {
  for (const name of ["PreToolUse.sh", "PostToolUse.sh"]) {
    const p = join(projectRoot, ".claude", "hooks", name);
    if (!existsSync(p)) {
      console.log(
        `警告: ${join(".claude", "hooks", name)} が見つかりません。init を実行して hook を配備してください。`
      );
    }
  }
}

// enforce status: 現在 on/off と hook スクリプト実在性を表示する。
function enforceStatus(projectRoot: string, settingsPath: string, settings: Settings): number {
  const on = enforceIsOn(settings);
  console.log(`enforce: 採用先=${projectRoot}`);
  console.log(`        settings.json=${existsSync(settingsPath) ? settingsPath : "（未作成）"}`);
  console.log(`        enforcement = ${on ? "on（配線あり）" : "off（配線なし）"}`);
  const pre = join(projectRoot, ".claude", "hooks", "PreToolUse.sh");
  const post = join(projectRoot, ".claude", "hooks", "PostToolUse.sh");
  console.log(`        PreToolUse.sh  = ${existsSync(pre) ? "実在" : "不在（init で配備）"}`);
  console.log(`        PostToolUse.sh = ${existsSync(post) ? "実在" : "不在（init で配備）"}`);
  if (on && (!existsSync(pre) || !existsSync(post))) {
    console.log("        注意: 配線は on ですが hook スクリプトが未配備です。init を実行してください。");
  }
  return 0;
}

// runEnforce: enforce サブコマンドのディスパッチ。
function runEnforce(projectRoot: string, action: string | undefined): number {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  if (settings === null) {
    console.error(
      `エラー: ${settingsPath} が妥当な JSON ではありません。\n` +
        `        手で修正するか退避してから再実行してください（破壊を避けるため中止します）。`
    );
    return 1;
  }

  if (action === "status") {
    return enforceStatus(projectRoot, settingsPath, settings);
  }

  const template = readEnforceTemplate();
  if (template === null) {
    console.error(
      `エラー: enforcement テンプレートが読めません: ${ENFORCE_TEMPLATE_PATH}\n` +
        `        パッケージが壊れている可能性があります。再インストールしてください。`
    );
    return 1;
  }

  if (action === "on") return enforceOn(projectRoot, settingsPath, settings, template);
  if (action === "off") return enforceOff(projectRoot, settingsPath, settings, template);

  console.error(`エラー: enforce の引数は on|off|status のいずれかです: '${action ?? "(なし)"}'`);
  return 1;
}

function main(argv: string[]): number {
  const cmd = argv[2] ?? "help";
  switch (cmd) {
    case "init":
    case "upgrade": {
      const dir = argv[3] ? join(process.cwd(), argv[3]) : process.cwd();
      // 引数が絶対パスならそのまま、相対なら cwd 起点。setup.sh 側で cd して解決される。
      const projectRoot = argv[3] && argv[3].startsWith("/") ? argv[3] : dir;
      return runSetup(projectRoot);
    }
    case "uninstall": {
      // フラグ（--yes/-y, --purge）と任意の dir 引数を順不同で受け取る。
      const rest = argv.slice(3);
      const yes = rest.includes("--yes") || rest.includes("-y");
      const purge = rest.includes("--purge");
      const dirArg = rest.find((a) => !a.startsWith("-"));
      let projectRoot = process.cwd();
      if (dirArg) {
        projectRoot = dirArg.startsWith("/") ? dirArg : join(process.cwd(), dirArg);
      }
      return runUninstall(projectRoot, { yes, purge });
    }
    case "enforce": {
      // enforce <on|off|status> [dir]。dir 省略時は cwd。
      const rest = argv.slice(3);
      const action = rest.find((a) => !a.startsWith("-")) ?? "status";
      const dirArg = rest.filter((a) => !a.startsWith("-"))[1];
      let projectRoot = process.cwd();
      if (dirArg) {
        projectRoot = dirArg.startsWith("/") ? dirArg : join(process.cwd(), dirArg);
      }
      return runEnforce(projectRoot, action);
    }
    case "doctor":
      return runDoctor();
    case "version":
    case "--version":
    case "-v":
      console.log(readVersion());
      return 0;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`不明なコマンド: ${cmd}\n`);
      printHelp();
      return 1;
  }
}

process.exit(main(process.argv));
