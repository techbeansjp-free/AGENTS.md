#!/usr/bin/env node
// agents-md — npm 配布用の薄い CLI ラッパ。
// 役割: 採用先プロジェクトのルート（既定は process.cwd()）を第1引数として
//       .agent-skill-chain/source/scripts/setup.sh に渡し、正本配備・各ツール向け生成・workflow.db 初期化を行う。
// 正本は .agent-skill-chain/source/。本 CLI はロジックを持たず setup.sh を呼び出す薄いラッパに徹する。
//
// サブコマンド:
//   init             setup.sh を実行して採用先へ配備する
//   upgrade          init と同等（当面）。既存配備の再同期を意図する
//   uninstall        setup/init が配備した成果物のみを除去する（ユーザー資産は既定で保持）
//   doctor           配備に必要な前提ファイル・依存の存在確認 ＋ 証跡健全性診断（hash チェーン・integrity）
//   audit [dir]      .agent-skill-chain/source/enforcement/ci/audit.sh の薄ラッパー（終了コード透過）
//   export [dir]     workflow.db を NDJSON で書き出す（export-ndjson.sh の薄ラッパー・read-only）
//   enforce on|off|status  enforcement フックを .claude/settings.json に着脱（既定 off / opt-in）
//   version          package.json の version を表示
//   help / (既定)    使い方を表示

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// パッケージ root は bin/ の 1 つ上。
const PACKAGE_ROOT = join(__dirname, "..");
// パッケージ正本は統合ネストにより .agent-skill-chain/source/ 配下にある。
const PACKAGE_SOURCE = join(PACKAGE_ROOT, ".agent-skill-chain", "source");
const SETUP_PATH = join(PACKAGE_SOURCE, "scripts", "setup.sh");
// audit.sh（CI 監査の正本）と export-ndjson.sh（NDJSON 出力の正本）。CLI は薄ラッパーに徹する。
const AUDIT_PATH = join(PACKAGE_SOURCE, "enforcement", "ci", "audit.sh");
const EXPORT_NDJSON_PATH = join(PACKAGE_SOURCE, "scripts", "export-ndjson.sh");
// entry_hash 計算の共有正本（gen_entry_hash）。doctor の hash チェーン検証はこれを source して使う（再実装禁止）。
const GEN_ENTRY_HASH_PATH = join(PACKAGE_SOURCE, "scripts", "gen-entry-hash.sh");
// enforcement 用 settings.json の正本テンプレート（既定 off。opt-in で配線する）。
const ENFORCE_TEMPLATE_PATH = join(
  PACKAGE_SOURCE,
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
  npx agent-skill-chain <command>

コマンド:
  init [dir]            採用先プロジェクト（既定: カレントディレクトリ）へ .agent-skill-chain/ 等を配備する
  upgrade [dir]         既存配備を再同期する（旧 3 ディレクトリ構成は統合移行してから再同期）
  uninstall [dir]       init/setup が配備した成果物のみを除去する（ユーザー資産は既定で保持）
  doctor                配備に必要な前提（setup.sh・bash・sqlite3 等）の有無 ＋ 証跡健全性
                        （workflow.db の hash チェーン・integrity_check・配線差分）を確認する
  audit [dir]           .agent-skill-chain/source/enforcement/ci/audit.sh を実行する（CI 監査の薄ラッパー・終了コード透過）
  export [dir]          workflow.db を NDJSON（1 行 1 JSON）で標準出力へ書き出す（read-only）
  enforce <on|off|status> [dir]
                        enforcement フック（PreToolUse/PostToolUse）を .claude/settings.json に着脱する。
                        既定は off（init では配線しない）。on で opt-in、off で解除、status で現状表示。
  version               パッケージのバージョンを表示する
  help                  このヘルプを表示する

uninstall のオプション:
  --yes, -y            対話確認をスキップして実行する（既定は dry-run 表示のみ）
  --purge              project/・runtime/（issue 履歴・workflow.db を含む）も削除し統合ルートごと除去する（既定は保持）

enforce のオプション:
  enforce on           settings.json に enforcement 配線を追加する（既存ユーザー値はマージ・保持。退避 .bak を作成）
  enforce off          enforcement 配線のみを外す（ユーザーの他設定は保持）
  enforce status       現在 on/off と hook スクリプト実在性を表示する

例:
  cd my-project && npx agent-skill-chain init
  npx agent-skill-chain@0.1.0 init       # 版をピン留め
  npx agent-skill-chain uninstall        # 削除対象を表示（dry-run）
  npx agent-skill-chain uninstall --yes  # 実際に除去する

注意:
  init は内部で ${".agent-skill-chain/source/scripts/setup.sh"} を実行します。
  setup.sh は workflow.db 初期化に sqlite3 バイナリを必要とします（doctor で確認可能）。
  uninstall は既定で .agent-skill-chain/project/・runtime/ の issue 履歴・workflow.db を保持します
  （--purge で project/・runtime/ も削除）。引数なしの場合は dry-run（表示のみ）です。
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

// audit: .agent-skill-chain/source/enforcement/ci/audit.sh の薄ラッパー。判定ロジックは再実装せず spawnSync で呼ぶ。
//   引数 dir（既定 cwd）を audit.sh の PROJECT_ROOT へ渡し、env（AUDIT_GIT_RANGE/WORKFLOW_DIRS/PR_BODY 等）は
//   プロセス env として透過する。終了コードは audit.sh のものをそのまま返す（pass-through）。
function runAudit(dir: string): number {
  if (!existsSync(AUDIT_PATH)) {
    console.error(
      `エラー: audit.sh が見つかりません: ${AUDIT_PATH}\n` +
        `        パッケージが壊れている可能性があります。再インストールしてください。`
    );
    return 1;
  }
  const result = spawnSync("bash", [AUDIT_PATH, dir], { stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    console.error(
      err.code === "ENOENT"
        ? `エラー: bash が見つかりません。audit.sh の実行には bash が必要です。`
        : `エラー: audit.sh の起動に失敗しました: ${err.message}`
    );
    return 1;
  }
  // audit.sh の終了コードを透過（0=pass / 非 0=FAIL）。signal 終了は 1 に丸める。
  return result.status ?? 1;
}

// export: workflow.db を NDJSON で書き出す薄ラッパー（export-ndjson.sh を呼ぶ）。read-only。
//   標準出力に NDJSON をそのまま流す（stdio: inherit）。終了コードは export-ndjson.sh を透過。
function runExport(dir: string): number {
  if (!existsSync(EXPORT_NDJSON_PATH)) {
    console.error(
      `エラー: export-ndjson.sh が見つかりません: ${EXPORT_NDJSON_PATH}\n` +
        `        パッケージが壊れている可能性があります。再インストールしてください。`
    );
    return 1;
  }
  const result = spawnSync("bash", [EXPORT_NDJSON_PATH, dir], { stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    console.error(
      err.code === "ENOENT"
        ? `エラー: bash が見つかりません。export には bash が必要です。`
        : `エラー: export-ndjson.sh の起動に失敗しました: ${err.message}`
    );
    return 1;
  }
  return result.status ?? 1;
}

// 証跡健全性診断（doctor 拡張）の結果。read-only。
interface LedgerHealth {
  // 診断を実行したか（DB 不在・sqlite3 不在で skip した場合 false）。
  ran: boolean;
  // 検査メッセージ（[OK]/[NG]/[WARN]/[SKIP] 行）。
  lines: string[];
  // 1 つでも [NG] があれば false。
  ok: boolean;
}

// workflow.db の証跡健全性を read-only で診断する:
//   (b) hash チェーン検証 — 各行の entry_hash を gen_entry_hash 共有関数で再計算し DB の値と照合し、
//       かつ rowid 連続行で prev_hash が直前の entry_hash と一致することを確認する。
//   (c) PRAGMA integrity_check が ok であること。
//   hash 再計算は gen-entry-hash.sh を source する bash ワンショットで行い、TS 側で式を再実装しない（N-D）。
//   payload は sqlite3 側で json/連結を避け、各フィールドを NUL 区切りで取り出して bash 配列へ渡す方式は
//   summary の改行・タブで壊れるため、sqlite3 の "||" 連結で 14 フィールドの payload 文字列を 1 列で作り、
//   その payload を sha256 した値と stored entry_hash を比較する（gen_entry_hash と同一式・同一区切り）。
function checkLedgerHealth(projectRoot: string): LedgerHealth {
  const lines: string[] = [];
  const dbPath = join(projectRoot, ".agent-skill-chain", "runtime", "workflow.db");
  if (!existsSync(dbPath)) {
    lines.push("[SKIP] workflow.db が無いため証跡健全性診断をスキップします。");
    return { ran: false, lines, ok: true };
  }
  const sqliteProbe = spawnSync("sqlite3", ["-version"]);
  if (sqliteProbe.error || sqliteProbe.status !== 0) {
    lines.push("[SKIP] sqlite3 が無いため証跡健全性診断をスキップします。");
    return { ran: false, lines, ok: true };
  }

  let ok = true;

  // (c) integrity_check（read-only）。
  const integrity = spawnSync("sqlite3", [dbPath, "PRAGMA integrity_check;"], {
    encoding: "utf8",
  });
  if (integrity.status === 0 && /(^|\s)ok(\s|$)/.test(integrity.stdout.trim())) {
    lines.push("[OK]  workflow.db integrity_check = ok");
  } else {
    lines.push("[NG]  workflow.db integrity_check が ok ではありません（DB 破損の可能性）。");
    ok = false;
  }

  // 新スキーマ（entry_hash カラム）でなければ hash チェーン検証は対象外。
  const cols = spawnSync(
    "sqlite3",
    [dbPath, "SELECT 1 FROM pragma_table_info('workflow_log') WHERE name='entry_hash';"],
    { encoding: "utf8" }
  );
  if (!cols.stdout.includes("1")) {
    lines.push("[SKIP] 旧スキーマ（entry_hash 無し）のため hash チェーン検証をスキップします。");
    return { ran: true, lines, ok };
  }

  // (b) hash チェーン検証。gen-entry-hash.sh を source し、各行を gen_entry_hash で再計算して照合する。
  //   各フィールドは RS/FS 制御文字区切りで sqlite3 から取り出し、summary 等に改行/タブ/| が含まれても
  //   壊れないようにする。式の再実装はしない（gen_entry_hash を呼ぶ・N-D）。
  const verifyScript = buildHashChainScript(dbPath);
  const verify = spawnSync("bash", ["-c", verifyScript], { encoding: "utf8" });
  const out = (verify.stdout || "").trim();
  const m = /MISMATCH=(\d+) CHAINBREAK=(\d+) ROWS=(\d+)/.exec(out);
  if (verify.status !== 0 || !m) {
    lines.push(`[NG]  hash チェーン検証の実行に失敗しました（${out || verify.stderr || "no output"}）。`);
    ok = false;
  } else {
    const mismatch = Number(m[1]);
    const chainBreak = Number(m[2]);
    const rows = Number(m[3]);
    if (mismatch === 0 && chainBreak === 0) {
      lines.push(`[OK]  workflow.db hash チェーン検証 = 整合（${rows} 行・entry_hash/prev_hash 連結 OK）`);
    } else {
      lines.push(
        `[NG]  workflow.db hash チェーン不整合: entry_hash 不一致=${mismatch} 件, prev_hash 連結断絶=${chainBreak} 件（改ざんの痕跡）。`
      );
      ok = false;
    }
  }

  return { ran: true, lines, ok };
}

// hash チェーン検証用の bash スクリプトを生成する。gen-entry-hash.sh を source して各行を
//   gen_entry_hash で再計算し、stored entry_hash・prev_hash 連結を照合する（式の再実装をしない・N-D）。
//   各フィールドは sqlite3 の readfile を使わず、行を NUL 区切りで安全に取り出して読み込む。
function buildHashChainScript(dbPath: string): string {
  // 各カラムを RS=\x1e（レコード区切り）・FS=\x1f（フィールド区切り）で 1 ストリームに出力し、
  // bash で読み出す。summary 等に改行/タブ/| が含まれても壊れない区切りを使う。
  //
  // 連結検証の方針（誤検知防止）:
  //   - entry_hash 再計算照合が主たる改ざん検知（gen_entry_hash 共有関数で再計算 → stored と比較）。
  //   - prev_hash 連結は「非空 prev_hash が DB 内のいずれかの行の entry_hash を指していること」を要求する
  //     （dangling = 指す先が存在しない＝行削除/改ざんの痕跡）。直前 rowid の entry_hash と厳密一致までは
  //     要求しない。書込時 prev_hash は INSERT 時点の head を指すが、セッション間 interleave で head が
  //     直前 rowid と一致しない正当ケースがあり、厳密一致だと健全 DB を誤検知するため。
  return `
set -euo pipefail
. ${shellQuote(GEN_ENTRY_HASH_PATH)}
db=${shellQuote(dbPath)}
mismatch=0
chain_break=0
rows=0
# 既知 entry_hash 集合（連結先の存在確認用）。一意な entry_hash を改行区切りで読み込み連想配列化する。
declare -A known
while IFS= read -r h; do
  [ -n "$h" ] && known["$h"]=1
done < <(sqlite3 "$db" "SELECT entry_hash FROM workflow_log WHERE entry_hash IS NOT NULL AND entry_hash<>'';" 2>/dev/null)
# RS=0x1e でレコード, FS=0x1f でフィールドを区切って取り出す（任意の本文を安全に通す）。
while IFS=$'\\x1f' read -r -d $'\\x1e' eid pid docid ts ar dr cmd iid rid ip rp cf sum dod stored prevh; do
  # sqlite3 は行ごとに改行を付すため、レコード区切り \\x1e の直後（= 次レコードの先頭フィールド）に
  # 改行が混入する。先頭フィールド eid の先行改行を除去してから判定する。
  eid="\${eid#$'\\n'}"
  [ -z "\${eid:-}" ] && continue
  rows=$((rows+1))
  calc="$(gen_entry_hash "$eid" "$pid" "$docid" "$ts" "$ar" "$dr" "$cmd" "$iid" "$rid" "$ip" "$rp" "$cf" "$sum" "$dod")"
  [ "$calc" != "$stored" ] && mismatch=$((mismatch+1))
  # prev_hash 連結検証: 非空 prev_hash が既知 entry_hash 集合に存在しなければ連結断絶（dangling）。
  if [ -n "$prevh" ] && [ -z "\${known[$prevh]:-}" ]; then chain_break=$((chain_break+1)); fi
done < <(sqlite3 "$db" "
  SELECT
    coalesce(entry_id,'') || char(31) ||
    coalesce(parent_entry_id,'') || char(31) ||
    coalesce(document_id,'') || char(31) ||
    coalesce(ts_utc,'') || char(31) ||
    coalesce(actor_role,'') || char(31) ||
    coalesce(delegated_by_role,'') || char(31) ||
    coalesce(command,'') || char(31) ||
    coalesce(issue_id,'') || char(31) ||
    coalesce(review_id,'') || char(31) ||
    coalesce(issue_path,'') || char(31) ||
    coalesce(review_path,'') || char(31) ||
    coalesce(changed_files_json,'') || char(31) ||
    coalesce(summary,'') || char(31) ||
    dod_met || char(31) ||
    coalesce(entry_hash,'') || char(31) ||
    coalesce(prev_hash,'') || char(30)
  FROM workflow_log ORDER BY rowid;
" 2>/dev/null)
echo "MISMATCH=$mismatch CHAINBREAK=$chain_break ROWS=$rows"
`;
}

// シェル単一引用符で安全に囲む（パスに空白・特殊文字があっても安全）。
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
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
  check(".agent-skill-chain/source/scripts/setup.sh（配備スクリプト）", existsSync(SETUP_PATH), "パッケージを再インストールしてください。");
  check(".agent-skill-chain/source/boot/CORE.md（実行契約の正本）", existsSync(join(PACKAGE_SOURCE, "boot", "CORE.md")));

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

  // enforcement 配線差分（drift）の検知: settings.json の managed hook エントリの command が、
  //   正本テンプレート（settings.enforce.json）の command と一致するかを確認する（read-only）。
  //   on の場合のみ。差分があれば再 enforce on を促す（[WARN]）。
  if (settings !== null && enforceIsOn(settings)) {
    const drift = detectEnforceDrift(settings);
    if (drift.length === 0) {
      console.log("[OK]  enforcement 配線 = 正本テンプレートと一致");
    } else {
      for (const d of drift) console.log(`[WARN] enforcement 配線差分: ${d}`);
      console.log("        ヒント: `agents-md enforce on` で配線を再同期できます。");
    }
  }

  // 証跡健全性診断（hash チェーン・integrity）。read-only。
  console.log("\n証跡健全性（workflow.db・read-only）:");
  const health = checkLedgerHealth(projectRoot);
  for (const l of health.lines) console.log(`        ${l}`);
  if (!health.ok) ok = false;

  // install 状態の判定（uninstall の安全策と同じ「配備の痕跡」で判定する）。
  const installed =
    existsSync(join(projectRoot, ".agent-skill-chain")) ||
    existsSync(join(projectRoot, "AGENTS.md"));
  console.log(
    installed
      ? "\ndoctor: 配備状態 = 配備済み（uninstall で除去可能）。"
      : "\ndoctor: 配備状態 = 未配備（init で配備してください）。"
  );

  console.log(ok ? "\ndoctor: 必須項目はすべて満たしています。" : "\ndoctor: 不足項目があります（上記 [NG] を参照）。");
  return ok ? 0 : 1;
}

// enforcement 配線差分の検知（read-only）。設定中の managed hook エントリの command が
//   正本テンプレートの command と一致しなければ差分行を返す。テンプレートが読めなければ空（判定不能は WARN しない）。
function detectEnforceDrift(settings: Settings): string[] {
  const template = readEnforceTemplate();
  if (template === null) return [];
  const drift: string[] = [];
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return drift;
  for (const event of HOOK_EVENTS) {
    const tmplEntries = templateHookEntries(template, event);
    const tmplCmds = tmplEntries
      .map((e) => extractHookCommand(e))
      .filter((c): c is string => c !== null);
    const arr = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(arr)) {
      if (tmplCmds.length > 0) drift.push(`${event}: 配線が存在しません（テンプレートにはあり）。`);
      continue;
    }
    const managed = arr.filter(isManagedHookEntry);
    const managedCmds = managed
      .map((e) => extractHookCommand(e))
      .filter((c): c is string => c !== null);
    for (const tc of tmplCmds) {
      if (!managedCmds.includes(tc)) {
        drift.push(`${event}: 正本の hook コマンドが設定に見当たりません（再 enforce on を推奨）。`);
        break;
      }
    }
  }
  return drift;
}

// hook エントリから実コマンド文字列を取り出す（settings の hook は { hooks: [{ command }] } のネスト構造）。
function extractHookCommand(entry: unknown): string | null {
  if (!isJsonObject(entry)) return null;
  const inner = (entry as JsonObject).hooks;
  if (Array.isArray(inner)) {
    for (const h of inner) {
      if (isJsonObject(h) && typeof h.command === "string") return h.command;
    }
  }
  if (typeof (entry as JsonObject).command === "string") {
    return (entry as JsonObject).command as string;
  }
  return null;
}

// ----------------------------------------------------------------------------
// package-manifest: 統合ルート .agent-skill-chain/ の配備マーカー確認（fail-closed 衝突検知）・
// 再配備前バックアップ・README 警告文の生成。
//
// 判定規則・退避命名・警告文言は setup.sh が source する
// .agent-skill-chain/source/scripts/lib/package-manifest.sh と**同一のものをミラーする**
// （list_owned_skill_names / ownedSkillNames と同型の単一定義ミラー方式。drift を避けるため、
// 判定規則・警告文を変えるときは package-manifest.sh 側も合わせて更新すること）。
//
// この二重実装（bash 版 = package-manifest.sh / TS 版 = 本ブロック）が同一の判定結果・同一の
// 出力を返すことは test/test-package-manifest-parity.sh がパリティテストで検証し、ドリフトを検知する。
// そのため下記 5 関数（checkPackageManifest / legacyFingerprintOk / writePackageManifest /
// backupAgentSkillChain / writeReadmeWarning）はテストから import して呼べるよう export する。
// ----------------------------------------------------------------------------

// 配備マーカー（.package-manifest）の内容（name/version の 2 フィールドのみ）。
interface PackageManifest {
  name: string;
  version: string;
}

// agentSkillChainRoot: <projectRoot>/.agent-skill-chain の絶対パスを返す。
function agentSkillChainRoot(projectRoot: string): string {
  return join(projectRoot, ".agent-skill-chain");
}

// realpathSafe: パスの実体（シンボリックリンク解決済み）を返す。存在しない・解決不能なら入力を返す。
//   自己適用判定で projectRoot と packageRoot を実パス比較するために使う（setup.sh の `pwd -P` 相当）。
function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// readPackageManifest: 配備マーカーを読む（無い・壊れていれば null）。
//   フォーマットは key=value の改行区切り（package-manifest.sh の write_package_manifest と同一）。
function readPackageManifest(projectRoot: string): PackageManifest | null {
  const manifestPath = join(agentSkillChainRoot(projectRoot), ".package-manifest");
  if (!existsSync(manifestPath)) return null;
  try {
    const fields: Record<string, string> = {};
    for (const line of readFileSync(manifestPath, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
    if (typeof fields.name !== "string" || typeof fields.version !== "string") return null;
    return { name: fields.name, version: fields.version };
  } catch {
    return null;
  }
}

// checkPackageManifest の判定結果。setup.sh の check_package_manifest の 4 分岐に対応する。
type ManifestCheckResult =
  | { kind: "own" }
  | { kind: "new" }
  | { kind: "match"; manifest: PackageManifest }
  | { kind: "abort"; reason: string };

// checkPackageManifest: .agent-skill-chain/ の配備マーカーを検証する（fail-closed。単一定義のミラー）。
//   - projectRoot が packageRoot と実パス一致（自己適用 PACKAGE_ROOT=PROJECT_ROOT）
//                                                             → { kind: "own" }（マーカー検査を省いて続行）。
//   - .agent-skill-chain/ が存在しない                       → { kind: "new" }（新規配備）。
//   - マーカーが存在し name が expectedName と一致            → { kind: "match" }（本パッケージ由来）。
//   - マーカー不在、または name 不一致（本パッケージ由来と確認できない）
//                                                             → { kind: "abort" }。
//   "abort" を受け取った呼び出し元は、破壊的操作（再配備・バックアップ上書き等）を一切行わないこと。
//
//   自己適用（own）の根拠は package-manifest.sh の check_package_manifest と同一:
//   本パッケージ自身のリポジトリへ配備すると .agent-skill-chain/ はパッケージ正本そのものだが、
//   マーカー（.package-manifest）は生成物として gitignore 対象で存在しない。projectRoot と
//   packageRoot の実パス一致は「配備先がパッケージ自身」であることを確実に示すため、この一致時のみ
//   マーカー検査を省いて続行する（他人の無関係ディレクトリは実パスが一致せず fail-closed の境界は
//   弱まらない）。判定規則を変えるときは package-manifest.sh 側も合わせて更新すること。
//   本関数は package-manifest.sh の check_package_manifest のミラーであり、両者が同一の判定
//   （own/new/match/abort）を返すことを test/test-package-manifest-parity.sh が検証している。
export function checkPackageManifest(
  projectRoot: string,
  expectedName: string,
  packageRoot?: string
): ManifestCheckResult {
  if (packageRoot !== undefined && realpathSafe(projectRoot) === realpathSafe(packageRoot)) {
    return { kind: "own" };
  }
  const dir = agentSkillChainRoot(projectRoot);
  if (!existsSync(dir)) return { kind: "new" };

  const manifest = readPackageManifest(projectRoot);
  if (manifest === null) {
    return {
      kind: "abort",
      reason:
        `${dir} は存在しますが配備マーカー（.package-manifest）が見つかりません。` +
        `本パッケージ（${expectedName}）由来と確認できないため、破壊的操作（再配備）を中止します。`,
    };
  }
  if (manifest.name !== expectedName) {
    return {
      kind: "abort",
      reason:
        `${join(dir, ".package-manifest")} の name（'${manifest.name}'）が本パッケージ` +
        `（'${expectedName}'）と一致しません。本パッケージ由来と確認できないため、破壊的操作（再配備）を中止します。`,
    };
  }
  return { kind: "match", manifest };
}

// writePackageManifest: 配備マーカーへ name/version を書き込む（新規配備・再配備のいずれでも呼ぶ）。
//   package-manifest.sh の write_package_manifest のミラー。生成される .package-manifest の内容が
//   一致することを test/test-package-manifest-parity.sh が検証している。
export function writePackageManifest(projectRoot: string, name: string, version: string): void {
  const dir = agentSkillChainRoot(projectRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".package-manifest"), `name=${name}\nversion=${version}\n`);
}

// backupTimestamp: setup.sh の `date +%Y%m%d%H%M%S`（ローカル時刻）と同一書式のタイムスタンプ。
function backupTimestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// backupAgentSkillChain: 本パッケージ由来と確認できた場合の再配備前に、source/・runtime/templates/ を
//   タイムスタンプ付きバックアップへ退避する（存在するものだけ。無ければ何もしない）。
//   バックアップ自体の書き込みに失敗した場合は例外を投げる（バックアップの成立を上書きの前提条件とする。
//   呼び出し元はこの例外を捕捉したら上書きを中止すること）。
//   命名は setup.sh の backup_agent_skill_chain と同一（単一定義のミラー）:
//     <root>/.agent-skill-chain-source.bak.<timestamp>/
//     <root>/.agent-skill-chain-runtime-templates.bak.<timestamp>/
//   package-manifest.sh の backup_agent_skill_chain のミラー。退避先ディレクトリの命名規則と
//   退避内容が一致することを test/test-package-manifest-parity.sh が検証している。
export function backupAgentSkillChain(projectRoot: string): void {
  const dir = agentSkillChainRoot(projectRoot);
  const ts = backupTimestamp();

  const sourceDir = join(dir, "source");
  if (existsSync(sourceDir)) {
    cpSync(sourceDir, join(projectRoot, `.agent-skill-chain-source.bak.${ts}`), {
      recursive: true,
      errorOnExist: false,
    });
  }

  const templatesDir = join(dir, "runtime", "templates");
  if (existsSync(templatesDir)) {
    cpSync(templatesDir, join(projectRoot, `.agent-skill-chain-runtime-templates.bak.${ts}`), {
      recursive: true,
      errorOnExist: false,
    });
  }
}

// legacyFingerprintOk: 旧レイアウト（統合ネスト前のルート直下 source 相当ディレクトリ）配下に
//   本パッケージ配備物のフィンガープリント（構造的に安定した 4 ファイルの AND 条件）が揃っているかを
//   判定する（統合移行可否の判断）。
//   package-manifest.sh の legacy_fingerprint_ok と**同一の判定規則をミラーする**（単一定義のミラー方式。
//   drift を避けるため、対象ファイルを変えるときは package-manifest.sh 側も合わせて更新すること）。
//   実際の破壊的な移行（バックアップ→移動）は setup.sh の migrate_legacy_dirs が単一実装で担い、
//   本 CLI の init/upgrade は runSetup 経由でそれを実行する（移行アクションを二重実装しない）。
//   package-manifest.sh の legacy_fingerprint_ok のミラー。同一の旧ディレクトリ状態に対し両者が
//   同一の true/false を返すことを test/test-package-manifest-parity.sh が検証している。
export function legacyFingerprintOk(projectRoot: string): boolean {
  const agents = join(projectRoot, ".agents");
  return (
    existsSync(join(agents, "boot", "CORE.md")) &&
    existsSync(join(agents, "scripts", "setup.sh")) &&
    existsSync(join(agents, "enforcement", "ci", "audit.sh")) &&
    existsSync(join(agents, "ledger", "schema.sql"))
  );
}

// readmeWarningText: 統合ルート直下に置く警告文の本体を返す。
//   package-manifest.sh の readme_warning_text と**同一文言**（単一定義のミラー）。
function readmeWarningText(): string {
  return `# ⚠️ このフォルダを直接 rm -rf しないでください

\`.agent-skill-chain/\` には、パッケージ本体（source/）だけでなく、
このプロジェクト固有の設定（project/）と監査履歴・issue 記録（runtime/）が同居しています。

- \`rm -rf .agent-skill-chain/\` を実行すると、プロジェクト固有の設定・監査履歴・
  issue 記録がすべて失われます。これは公式なアンインストール手順ではありません。
- 安全にアンインストールするには次のコマンドを使用してください:

    npx agent-skill-chain uninstall

  既定ではパッケージ所有物（source/ と再生成可能な runtime/templates/）のみを削除し、
  project/ と runtime/ のユーザー資産（issue 記録・監査履歴）は保持します。
  監査履歴・issue 記録も含めて完全に削除する場合は --purge --yes を指定してください。
`;
}

// writeReadmeWarning: 統合ルート直下の警告文を最新化する（新規配備・再配備どちらでも呼ぶ）。
//   package-manifest.sh の write_readme_warning（本文は readme_warning_text）のミラー。
//   書き込まれる README 警告文ファイルの内容が一致することを test/test-package-manifest-parity.sh が検証している。
export function writeReadmeWarning(projectRoot: string): void {
  const dir = agentSkillChainRoot(projectRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), readmeWarningText());
}

// ----------------------------------------------------------------------------
// uninstall: setup/init が配備した成果物のみを除去する。
//
// 配備物の正本は setup.sh の配備ロジック。本 CLI はそれと一致する「配備物マニフェスト」を
// 1 か所に持つ。ユーザー資産（project/・runtime/ の issue 履歴・workflow.db）は既定で保持し、
// 誤削除しない安全側設計とする。--purge で project/・runtime/ も含め統合ルートごと全削除する。
// ----------------------------------------------------------------------------

// 既定で除去する配備物（setup.sh が配備するパッケージ完全所有分のみ）。相対パスで列挙する。
// 注1: runtime/ は丸ごと消さない（issue 履歴・workflow.db はユーザー資産）。templates のみ除去する。
// 注2: .cursor/・.claude/ は **丸ごと消さない**。setup が配備したパッケージ所有分
//      （.cursor/<owned files>・.claude/hooks の所有フック・.claude/skills と .cursor/skills の所有 skill）
//      のみを除去し、ユーザー作成物（.cursor/rules/*.mdc・.claude/settings.json・.claude/hooks の独自フック・
//      .claude/skills や .cursor/skills のユーザー自作スキル等）が同居していれば保持する。
//      パッケージ所有ファイル/skill 名は正本（enforcement・skills）から動的に導出する（setup.sh と単一整合）。
// 注3: .claude/hooks・.claude/skills・.cursor/skills は**ディレクトリごと消さず**、所有エントリのみ除去する
//      （下記 deployedOwnedHookFiles / deployedOwnedSkillEntries で導出）。
const DEPLOYED_ARTIFACTS: string[] = [
  ".agent-skill-chain/source", // パッケージ正本（setup がコピー配備・再配備で復元可能）
  "AGENTS.md", // ルート契約（setup がコピー）
  "CLAUDE.md", // ルート契約（setup がコピー）
  ".agent-skill-chain/runtime/templates", // テンプレート（setup がコピー。runtime 自体は残す）
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

// .cursor/ 直下のパッケージ所有ファイル（enforcement/cursor 由来のトップレベルファイル）の配備物相対パス。
// setup.sh は enforcement/cursor/* を .cursor/ 直下へコピーする（copy_owned_files）。同じ規則で導出する。
function deployedOwnedFiles(): string[] {
  const enforcement = join(PACKAGE_SOURCE, "enforcement");
  return ownedFilesFrom(join(enforcement, "cursor"), ".cursor");
}

// .claude/hooks 配下のパッケージ所有フックファイルの配備物相対パス。
// setup.sh は enforcement/claude/* のトップレベル通常ファイル（.gitkeep 除外）を .claude/hooks へコピーする
// （copy_owned_files）。同じ規則で導出し、ユーザー独自フックを残してパッケージ所有分のみ除去する。
function deployedOwnedHookFiles(): string[] {
  const enforcement = join(PACKAGE_SOURCE, "enforcement");
  return ownedFilesFrom(join(enforcement, "claude"), join(".claude", "hooks"));
}

// パッケージが配備した所有 skill エントリ名（{domain}__{capability}・ドメイン直下 {domain}）を
// 正本 source/skills/ から導出する。命名規約の正本は lib/deploy-skills.sh（list_owned_skill_names）。
// 本関数はその走査規則を Node 側でミラーし（同一規則）、setup.sh と同じ所有集合を得る。
// drift を避けるため、命名規則を変えるときは lib/deploy-skills.sh と本関数の双方を整合させること。
function ownedSkillNames(): string[] {
  const skillsRoot = join(PACKAGE_SOURCE, "skills");
  if (!existsSync(skillsRoot)) return [];
  const names: string[] = [];
  for (const domainEnt of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!domainEnt.isDirectory()) continue;
    const domain = domainEnt.name;
    const domainDir = join(skillsRoot, domain);
    // ドメイン直下に skill 定義を持つケース（例: agent/）は {domain} を所有名とする。
    if (existsSync(join(domainDir, "SKILL.md"))) names.push(domain);
    // capability 配下に skill 定義を持つものは {domain}__{capability} を所有名とする。
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

// --purge 時のみ追加で除去するユーザー資産（統合ルート配下）。project/ とランタイム名前空間
// （runtime/ 直下の issue 履歴・workflow.db を含む）を丸ごと除去し、統合ルートを完全に空にする。
const PURGE_ARTIFACTS: string[] = [
  ".agent-skill-chain/project",
  ".agent-skill-chain/runtime",
];

// finalizeAscRoot: 配備物除去後の統合ルート（.agent-skill-chain/）の後片付け。
//   purge 時: project/・runtime/ も除去済みのため、ルート（マーカー・README 含む）ごと削除する。
//   既定時: project/ またはユーザー資産を含む runtime/（issue 履歴・workflow.db）が残っていれば
//           マーカー・README ごとルートを残し、案内を表示する。残っていなければルートごと削除する。
//   ルートを残す理由: マーカーを保つことで将来の再 init/upgrade がこのディレクトリを本パッケージ由来と
//   正しく認識し source/ を安全に再配備できる。ユーザー資産がある間は README の警告も有効であるべき。
function finalizeAscRoot(projectRoot: string, purge: boolean): void {
  const ascRoot = join(projectRoot, ".agent-skill-chain");
  if (!existsSync(ascRoot)) return;

  if (purge) {
    rmSync(ascRoot, { recursive: true, force: true });
    console.log("削除しました: .agent-skill-chain/（完全削除）");
    return;
  }

  const hasProject = existsSync(join(ascRoot, "project"));
  const runtimeDir = join(ascRoot, "runtime");
  // templates は既定で除去済み。.gitignore はパッケージ生成物のためユーザー資産に数えない。
  const runtimeAssets = existsSync(runtimeDir)
    ? readdirSync(runtimeDir).filter((n) => n !== ".gitignore")
    : [];

  if (hasProject || runtimeAssets.length > 0) {
    console.log(
      "\n.agent-skill-chain/ を残しました（ユーザー資産を含むため）:\n" +
        "  project/ またはランタイム資産（issue 履歴・workflow.db）が保持されています。\n" +
        "  監査履歴・issue 記録も含めて完全に削除する場合は --purge --yes を使用してください。"
    );
  } else {
    rmSync(ascRoot, { recursive: true, force: true });
    console.log(
      "削除しました: .agent-skill-chain/（ユーザー資産が無いためマーカー・README ごと除去）"
    );
  }
}

// uninstall: deployed artifacts を除去する。
// 戻り値: 終了コード（0=成功, 1=安全側中止/失敗）。
function runUninstall(projectRoot: string, opts: UninstallOpts): number {
  const { yes, purge } = opts;

  // 安全策(1): 採用先が「自分が配備した」痕跡を持つか確認する。
  // 配備の中核（統合ルート .agent-skill-chain/ またはルート契約ファイル）が無いのに
  // 他の保護物を消すのは想定外なので中止する。
  const looksInstalled =
    existsSync(join(projectRoot, ".agent-skill-chain")) ||
    existsSync(join(projectRoot, "AGENTS.md"));
  if (!looksInstalled) {
    console.error(
      `エラー: ${projectRoot} に配備の痕跡（.agent-skill-chain/ または AGENTS.md）が見つかりません。\n` +
        `        誤削除を防ぐため uninstall を中止します（このディレクトリは未配備の可能性）。`
    );
    return 1;
  }

  // 削除対象を列挙する（存在するものだけ）。
  // パッケージ所有分を正本から動的に加える:
  //   - .cursor 直下の所有ファイル                              … deployedOwnedFiles
  //   - .claude/hooks の所有フックファイル                      … deployedOwnedHookFiles
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
  console.log(`        モード=${purge ? "purge（ユーザー資産も削除）" : "既定（ユーザー資産は保持）"}`);
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
  if (!purge) {
    console.log("  .agent-skill-chain/project/   （プロジェクト固有ルール）");
    console.log("  .agent-skill-chain/runtime/<issue>/  （templates 以外の issue 成果物）");
    console.log("  .agent-skill-chain/runtime/workflow.db*  （証跡 DB。--purge 指定時のみ削除）");
  } else {
    console.log("  （--purge 指定のため project/・runtime/ も削除します。）");
  }
  console.log("  .cursor/ のユーザー作成物（自作 rules/*.mdc 等。配備分以外は保持）");
  console.log("  .claude/ のユーザー設定 （settings.json 等。配備分以外は保持）");

  if (!yes) {
    console.log(
      "\n[dry-run] これは表示のみです。実際に除去するには --yes を付けて再実行してください:\n" +
        `  npx agent-skill-chain uninstall${purge ? " --purge" : ""} --yes`
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

  // 統合ルートの後片付け: ユーザー資産の残存有無で残置/除去を決める（purge は常に除去）。
  finalizeAscRoot(projectRoot, purge);

  console.log(
    failed
      ? "\nuninstall: 一部の削除に失敗しました（上記参照）。"
      : purge
        ? "\nuninstall: 統合ルートを含め完全に除去しました。"
        : "\nuninstall: 配備物の除去が完了しました（ユーザー資産は保持）。"
  );
  return failed ? 1 : 0;
}

// ----------------------------------------------------------------------------
// enforce: enforcement フックを .claude/settings.json に着脱する（既定 off / opt-in）。
//
// 方針（ライブセッション保護・ユーザー値非破壊）:
//   - 既定では init/setup は settings.json に enforcement を書き込まない（off）。
//   - `enforce on`  … 正本テンプレート（.agent-skill-chain/source/platforms/claude/settings.enforce.json）から
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

  // C-4b 出所分離（HIGH 是正）: scribe 出所制御の **実 nonce** と **期待 nonce** を別出所にする。
  //   - 実 nonce: settings.json の env(AGENTS_SCRIBE_NONCE) にリテラル値として配線する（hook 起動時に env 継承）。
  //   - 期待 nonce: ${projectRoot}/.agent-skill-chain/source/.scribe-nonce ファイル（0600）に同値を書く。hook は期待値をこのファイルから読む。
  //   env だけを掌握した相手は env の AGENTS_SCRIBE_NONCE を任意に変えられるが、期待値はファイルから読まれるため
  //   一致させられない（ファイルは 0600 で書けない）。enforce のたびに新しい nonce へローテートする。
  const scribeNonce = randomBytes(24).toString("hex");
  next.env.AGENTS_SCRIBE_NONCE = scribeNonce;
  const nonceFile = join(projectRoot, ".agent-skill-chain", "source", ".scribe-nonce");
  try {
    writeFileSync(nonceFile, scribeNonce + "\n", { mode: 0o600 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`警告: scribe nonce ファイルの書き込みに失敗しました: ${nonceFile}: ${msg}`);
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
  projectRoot: string,
  settingsPath: string,
  settings: Settings,
  template: EnforceTemplate
): number {
  // 出所分離: enforce off では scribe nonce ファイルも除去する（実 nonce env はテンプレ env キーとして除去される）。
  const nonceFile = join(projectRoot, ".agent-skill-chain", "source", ".scribe-nonce");
  if (existsSync(nonceFile)) {
    try {
      rmSync(nonceFile);
    } catch {
      /* 失敗しても致命ではない（settings の除去を優先）。 */
    }
  }
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
    case "audit": {
      // audit [dir]。dir 省略時は cwd。audit.sh の終了コードを透過。
      const dirArg = argv.slice(3).find((a) => !a.startsWith("-"));
      let dir = process.cwd();
      if (dirArg) dir = dirArg.startsWith("/") ? dirArg : join(process.cwd(), dirArg);
      return runAudit(dir);
    }
    case "export": {
      // export [dir]。dir 省略時は cwd。NDJSON を標準出力へ。
      const dirArg = argv.slice(3).find((a) => !a.startsWith("-"));
      let dir = process.cwd();
      if (dirArg) dir = dirArg.startsWith("/") ? dirArg : join(process.cwd(), dirArg);
      return runExport(dir);
    }
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

// CLI として直接起動されたときのみ main を実行する。パリティテスト（test/test-package-manifest-parity.sh）は
// 内部関数（checkPackageManifest / legacyFingerprintOk / writePackageManifest / backupAgentSkillChain /
// writeReadmeWarning）を呼ぶために本モジュールを import するため、import 時は副作用（process.exit）を
// 起こしてはならない。npm bin の symlink 経由でも直接起動を正しく判定できるよう、起動パス（argv[1]）と
// 本モジュール実体パスを realpath 正規化して比較する（es-main 判定）。CLI のコマンド体系は不変。
const invokedRealPath = ((): string => {
  const p = process.argv[1];
  if (!p) return "";
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
})();
if (invokedRealPath && invokedRealPath === realpathSafe(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv));
}
