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
//   version          package.json の version を表示
//   help / (既定)    使い方を表示

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// パッケージ root は bin/ の 1 つ上。
const PACKAGE_ROOT = join(__dirname, "..");
const SETUP_PATH = join(PACKAGE_ROOT, ".agents", "scripts", "setup.sh");

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    return pkg.version ?? "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function printHelp() {
  const name = "agents-md";
  console.log(`${name} v${readVersion()} — AI 実行契約・ワークフロー仕様パッケージの配備 CLI

使い方:
  npx @techbeansjp-free/agents-md <command>

コマンド:
  init [dir]            採用先プロジェクト（既定: カレントディレクトリ）へ .agents/ 等を配備する
  upgrade [dir]         既存配備を再同期する（当面 init と同等）
  uninstall [dir]       init/setup が配備した成果物のみを除去する（ユーザー資産は既定で保持）
  doctor                配備に必要な前提（setup.sh・bash・sqlite3 等）の有無を確認する
  version               パッケージのバージョンを表示する
  help                  このヘルプを表示する

uninstall のオプション:
  --yes, -y            対話確認をスキップして実行する（既定は dry-run 表示のみ）
  --purge              workflow.db 等の証跡も含めて削除する（既定は保持）

例:
  cd my-project && npx @techbeansjp-free/agents-md init
  npx @techbeansjp-free/agents-md@0.1.0 init       # 版をピン留め
  npx @techbeansjp-free/agents-md uninstall        # 削除対象を表示（dry-run）
  npx @techbeansjp-free/agents-md uninstall --yes  # 実際に除去する

注意:
  init は内部で ${".agents/scripts/setup.sh"} を実行します。
  setup.sh は workflow.db 初期化に sqlite3 バイナリを必要とします（doctor で確認可能）。
  uninstall は既定で .agents-project/・.workflow の issue・workflow.db を保持します
  （--purge で workflow.db も削除）。引数なしの場合は dry-run（表示のみ）です。`);
}

// setup.sh を projectRoot 引数つきで実行する。
function runSetup(projectRoot) {
  if (!existsSync(SETUP_PATH)) {
    console.error(
      `エラー: setup.sh が見つかりません: ${SETUP_PATH}\n` +
        `パッケージが壊れている可能性があります。再インストールしてください。`
    );
    return 1;
  }
  const result = spawnSync("bash", [SETUP_PATH, projectRoot], { stdio: "inherit" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(
        `エラー: bash が見つかりません。setup.sh の実行には bash が必要です。\n` +
          `bash を導入してから再実行してください。`
      );
    } else {
      console.error(`エラー: setup.sh の起動に失敗しました: ${result.error.message}`);
    }
    return 1;
  }
  return result.status ?? 0;
}

// doctor: 配備に必要な前提を確認する。終了コードで成否を返す。
function runDoctor() {
  const projectRoot = process.cwd();
  let ok = true;

  const check = (label, present, hint) => {
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
  check(
    ".claude/hooks/PreToolUse.sh（enforcement フック）",
    existsSync(join(projectRoot, ".claude", "hooks", "PreToolUse.sh")),
    "Claude enforcement が未配備の場合は init を実行してください。"
  );

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
//      （.cursor/skills・.cursor/<owned files>・.claude/hooks・.claude/skills 等）のみを除去し、
//      ユーザー作成物（.cursor/rules/*.mdc・.claude/settings.json 等）が同居していれば保持する。
//      パッケージ所有ファイル名は enforcement 正本から動的に導出する（setup.sh と単一整合）。
const DEPLOYED_ARTIFACTS = [
  ".agents", // パッケージ正本のコピー（setup がコピー配備）
  "AGENTS.md", // ルート契約（setup がコピー）
  "CLAUDE.md", // ルート契約（setup がコピー）
  ".claude/hooks", // enforcement フック（パッケージ生成物専用ディレクトリ）
  ".claude/skills", // 同期 skills（パッケージ生成物専用ディレクトリ）
  ".cursor/skills", // 同期 skills（パッケージ生成物専用ディレクトリ）
  ".workflow/templates", // テンプレート（setup がコピー。.workflow 自体は残す）
];

// setup.sh が .cursor/・.claude/ 直下へコピーするパッケージ所有ファイルを enforcement 正本から導出する。
// setup.sh の copy_owned_files と同じ規則（トップレベルの通常ファイル、.gitkeep を除外）で算出する。
// これにより uninstall は「パッケージが配備した既知のファイル」だけを除去し、ユーザー作成物を残せる。
function ownedFilesFrom(srcDir, destRel) {
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== ".gitkeep")
    .map((d) => join(destRel, d.name));
}

// .cursor/ 直下のパッケージ所有ファイル（agents-core.mdc・README.md 等）の配備物相対パス。
// setup.sh は enforcement/cursor/* を .cursor/ 直下へコピーする（copy_owned_files）。同じ規則で導出する。
// （.claude 側は hooks/・skills/ という専用ディレクトリ配下に配備するため、ディレクトリごと
//   DEPLOYED_ARTIFACTS で除去でき、直下の個別ファイル導出は不要。）
function deployedOwnedFiles() {
  const enforcement = join(PACKAGE_ROOT, ".agents", "enforcement");
  return ownedFilesFrom(join(enforcement, "cursor"), ".cursor");
}

// --purge 時のみ追加で除去する証跡（ユーザー資産）。
const PURGE_ARTIFACTS = [
  ".workflow/workflow.db",
  ".workflow/workflow.db-wal",
  ".workflow/workflow.db-shm",
];

// uninstall: deployed artifacts を除去する。
// 戻り値: 終了コード（0=成功, 1=安全側中止/失敗）。
function runUninstall(projectRoot, opts) {
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
  // パッケージ所有ファイル（.cursor 直下の agents-core.mdc 等）を enforcement 正本から動的に加える。
  const targets = [...DEPLOYED_ARTIFACTS, ...deployedOwnedFiles()];
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
      console.error(`エラー: ${t.rel} の削除に失敗しました: ${e.message}`);
    }
  }

  // 後始末: .cursor/・.claude/ がパッケージ配備物の除去後に空になった場合のみ、空ディレクトリを削除する。
  // ユーザー作成物（.cursor/rules/*.mdc・.claude/settings.json 等）が残っている場合は削除しない（保持）。
  for (const dirRel of [".cursor", ".claude"]) {
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

function main(argv) {
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
