#!/usr/bin/env node
// agents-md — npm 配布用の薄い CLI ラッパ。
// 役割: 採用先プロジェクトのルート（既定は process.cwd()）を第1引数として
//       .agents/scripts/setup.sh に渡し、正本配備・各ツール向け生成・workflow.db 初期化を行う。
// 正本は .agents/。本 CLI はロジックを持たず setup.sh を呼び出す薄いラッパに徹する。
//
// サブコマンド:
//   init             setup.sh を実行して採用先へ配備する
//   upgrade          init と同等（当面）。既存配備の再同期を意図する
//   doctor           配備に必要な前提ファイル・依存の存在確認
//   version          package.json の version を表示
//   help / (既定)    使い方を表示

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  init [dir]      採用先プロジェクト（既定: カレントディレクトリ）へ .agents/ 等を配備する
  upgrade [dir]   既存配備を再同期する（当面 init と同等）
  doctor          配備に必要な前提（setup.sh・bash・sqlite3 等）の有無を確認する
  version         パッケージのバージョンを表示する
  help            このヘルプを表示する

例:
  cd my-project && npx @techbeansjp-free/agents-md init
  npx @techbeansjp-free/agents-md@0.1.0 init   # 版をピン留め

注意:
  init は内部で ${".agents/scripts/setup.sh"} を実行します。
  setup.sh は workflow.db 初期化に sqlite3 バイナリを必要とします（doctor で確認可能）。`);
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

  console.log(ok ? "\ndoctor: 必須項目はすべて満たしています。" : "\ndoctor: 不足項目があります（上記 [NG] を参照）。");
  return ok ? 0 : 1;
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
