#!/usr/bin/env bash
# agent-skill-chain CLI の3経路解決と自動導入フォールバックを共有する。
# CLI が未導入なら GitHub リポジトリからのグローバル導入を試行する。
# 対話環境では事前確認を行い、AGENT_SKILL_CHAIN_AUTO_INSTALL=0 で無効化できる。
#
# Issue #759: 信頼実行（ローカルゲートレビュー）の文脈では、隔離 clone 配下の実体のみを解決し
# （ASC_TRUSTED_CLI_ROOT）、隔離 clone の外にある配布パッケージを検証してから複製する調達段
# （asc_procure_trusted_cli）を本ファイルが担う。解決と調達を同一境界へ置くのは、探索順を
# 2 か所へ複製しないためである。調達候補の採否は 2 つのパス条件で決める。第一に候補の実体パス、
# 第二に候補が実行時に依存を解決する供給元（候補パッケージ直下および候補と同じ親の node_modules）
# に置かれた参照経路を全て解決した後の実体パスが、いずれも protected base worktree 以外の
# linked worktree 配下にないこと。第二の条件が独立に必要なのは、正準ツリー digest が依存
# ディレクトリ配下を対象から除くため、参照経路を審査対象へ向けた改変が候補の digest を変えず、
# 候補の実体パス照合と digest 照合をいずれも通過してしまうためである。

# Issue #683: 正式な導入手段と同じく既定は可変refとする。固定が必要なconsumerは
# ASC_CLI_INSTALL_SOURCE="github:techbeansjp-free/AGENTS.md#<tag-or-branch>" を指定できる。
# 版が展開済みassetsと異なる場合は警告し、明示的に選ばれた新しいCLIで処理を続行する。
ASC_CLI_INSTALL_SOURCE="${ASC_CLI_INSTALL_SOURCE:-github:techbeansjp-free/AGENTS.md}"

_ASC_CLI_RESOLVE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_REPO_ROOT="$(cd -- "$_ASC_CLI_RESOLVE_DIR/../.." &>/dev/null && pwd)"
ASC_CLI=()

_asc_try_resolve() {
  ASC_CLI=()

  if [[ -f "$_ASC_CLI_REPO_ROOT/bin/agents-md.js" ]]; then
    ASC_CLI=(node "$_ASC_CLI_REPO_ROOT/bin/agents-md.js")
    return 0
  fi

  if [[ -x "$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    ASC_CLI=("$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain")
    return 0
  fi

  local path_cli
  if path_cli="$(command -v agent-skill-chain 2>/dev/null)" \
    && [[ -f "$path_cli" && -x "$path_cli" && -s "$path_cli" ]] \
    && "$path_cli" --help >/dev/null 2>&1; then
    ASC_CLI=("$path_cli")
    return 0
  fi

  return 1
}

_asc_warn_installed_version_mismatch() {
  local consumer_version_file="$_ASC_CLI_REPO_ROOT/.agent-skill-chain/.installed_version"
  [[ -f "$consumer_version_file" ]] || return 0

  local consumer_version
  if ! IFS= read -r consumer_version < "$consumer_version_file" || [[ -z "$consumer_version" ]]; then
    return 0
  fi

  local global_root
  if ! global_root="$(npm root -g 2>/dev/null)" || [[ -z "$global_root" ]]; then
    return 0
  fi

  local installed_version
  if ! installed_version="$(node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof pkg.version !== "string" || pkg.version.length === 0) process.exit(1);
    process.stdout.write(pkg.version);
  ' "$global_root/agent-skill-chain/package.json" 2>/dev/null)"; then
    return 0
  fi

  if [[ "$installed_version" != "$consumer_version" ]]; then
    echo "警告: 自動導入したagent-skill-chain CLIの版（${installed_version}）は、consumerへ展開済みassetsの版（${consumer_version}）と異なります。CLIの処理を続行します。版を揃えるにはupgradeするか、ASC_CLI_INSTALL_SOURCEへ固定refを指定してください。" >&2
  fi
}

_asc_auto_install() {
  if [[ "${AGENT_SKILL_CHAIN_AUTO_INSTALL:-}" == "0" ]]; then
    echo "agent-skill-chain CLI が見つからず、AGENT_SKILL_CHAIN_AUTO_INSTALL=0 のため自動導入を行いません。" >&2
    return 1
  fi

  if [[ -t 0 && -t 2 ]]; then
    local answer
    if ! read -r -p "agent-skill-chain CLI が見つかりません。npm でグローバル導入しますか? [y/N] " answer \
      || [[ ! "$answer" =~ ^([yY]|[yY][eE][sS])$ ]]; then
      echo "agent-skill-chain CLI の自動導入を利用者が拒否したため、CLIを解決できません。" >&2
      return 1
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "agent-skill-chain CLI が見つからず、自動導入に必要な npm コマンドも見つかりません。" >&2
    return 1
  fi

  echo "agent-skill-chain CLI が見つからないため、npm でグローバル導入を試行します。" >&2
  if ! npm install -g "$ASC_CLI_INSTALL_SOURCE" >&2; then
    echo "agent-skill-chain CLI の自動導入に失敗しました（npm install -g $ASC_CLI_INSTALL_SOURCE が非ゼロ終了）。" >&2
    return 1
  fi

  local global_prefix
  if ! global_prefix="$(npm prefix -g)"; then
    echo "agent-skill-chain CLI の自動導入は成功しましたが、npm のグローバル導入先を取得できないためCLI実体を再解決できません。" >&2
    return 1
  fi

  PATH="$global_prefix/bin${PATH:+:$PATH}"
  export PATH
  if ! _asc_try_resolve; then
    echo "agent-skill-chain CLI の自動導入は成功しましたが、導入先を含めてもCLI実体を再解決できません。" >&2
    return 1
  fi

  _asc_warn_installed_version_mismatch

  return 0
}

# Issue #683: 自動導入成功系をスタブで検証するテストとは別に、実際のGitHub導入元へ
# npmが到達できることを副作用の無いmetadata取得で確認するための検査入口。
asc_verify_cli_install_source() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "agent-skill-chain CLI の導入元確認に必要な npm コマンドが見つかりません。" >&2
    return 1
  fi

  local source_version
  if ! source_version="$(npm view "$ASC_CLI_INSTALL_SOURCE" version)" || [[ -z "$source_version" ]]; then
    echo "agent-skill-chain CLI の導入元へ到達できません（${ASC_CLI_INSTALL_SOURCE}）。" >&2
    return 1
  fi
  printf 'agent-skill-chain CLI 導入元: %s (version %s)\n' "$ASC_CLI_INSTALL_SOURCE" "$source_version"
}

# Issue #759: 信頼実行の文脈（ASC_TRUSTED_CLI_ROOT が与えられた場合）は、隔離 clone 配下の
# 2 経路のみを探索し、PATH 上の実体への解決も自動導入フォールバックも行わない。
_asc_resolve_trusted_cli() {
  ASC_CLI=()
  local trusted_root="${ASC_TRUSTED_CLI_ROOT:-}"

  if [[ -f "$trusted_root/bin/agents-md.js" ]]; then
    ASC_CLI=(node "$trusted_root/bin/agents-md.js")
    return 0
  fi

  if [[ -x "$trusted_root/node_modules/.bin/agent-skill-chain" ]]; then
    ASC_CLI=("$trusted_root/node_modules/.bin/agent-skill-chain")
    return 0
  fi

  echo "信頼実行環境のCLI実体を隔離clone配下で解決できません。前提: 隔離clone配下にCLI実体が用意されていること。探索先: ${trusted_root}/bin/agents-md.js, ${trusted_root}/node_modules/.bin/agent-skill-chain。信頼実行の文脈ではPATH上の実体への解決と自動導入フォールバックを行いません。是正: 準備段の調達が成功する状態（配布パッケージの導入と導入マーカーの整合）にしてから再実行してください。" >&2
  return 1
}

asc_resolve_cli() {
  if [[ -n "${ASC_TRUSTED_CLI_ROOT:-}" ]]; then
    _asc_resolve_trusted_cli
    return $?
  fi
  if _asc_try_resolve; then
    return 0
  fi
  _asc_auto_install
}

# ---------------------------------------------------------------------------
# Issue #759: 信頼実行環境の調達段（package_copy モード）
# ---------------------------------------------------------------------------

# 正準ツリー digest（走査根配下の通常ファイルを「実行ビット・内容SHA-256・相対パス」の1行へ落とし、
# 相対パスのバイト昇順で連結した文字列のSHA-256）。CLI 側（src/lib/tree-digest.ts）と同一の
# アルゴリズムを、準備段が Node.js の1回起動で実行できる形で持つ。両実装の同値性は単体テストで固定する。
# 走査根からの相対で `node_modules`・`.git` はエントリ自体を含めて除外する。対象範囲内に
# symbolic link または通常ファイル以外があれば算出せず非0終了する。
_ASC_CANONICAL_TREE_DIGEST_JS="$(cat <<'ASC_TREE_DIGEST_JS'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const DOMAIN = "agent-skill-chain:canonical-tree:v1\n";
const EXCLUDED_ROOT_ENTRIES = ["node_modules", ".git"];
const root = process.argv[1];
const collected = [];
function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function collect(current, prefix) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (prefix === "" && EXCLUDED_ROOT_ENTRIES.includes(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("正準ツリーdigestの対象範囲にsymbolic linkがあるため算出を中止しました: " + relative);
    }
    if (entry.isDirectory()) {
      collect(absolute, relative);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("正準ツリーdigestの対象範囲に通常ファイル以外のエントリがあるため算出を中止しました: " + relative);
    }
    const stat = fs.lstatSync(absolute);
    const executable = (stat.mode & 0o111) !== 0 ? "1" : "0";
    collected.push({
      relative,
      line: executable + "\t" + sha256Hex(fs.readFileSync(absolute)) + "\t" + JSON.stringify(relative),
    });
  }
}
try {
  collect(root, "");
} catch (error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
}
collected.sort((left, right) =>
  Buffer.compare(Buffer.from(left.relative, "utf8"), Buffer.from(right.relative, "utf8")),
);
const lines = collected.map((entry) => entry.line);
const payload = lines.length === 0 ? "" : lines.join("\n") + "\n";
process.stdout.write("sha256:" + sha256Hex(Buffer.from(DOMAIN + payload, "utf8")));
ASC_TREE_DIGEST_JS
)"

asc_canonical_tree_digest() {
  node -e "$_ASC_CANONICAL_TREE_DIGEST_JS" -- "$1"
}

# 期待値（base SHA のコミット内容に含まれる導入マーカー）を読み、`name<TAB>version<TAB>tree_digest` を出す。
_ASC_READ_TRUSTED_CLI_MARKER_JS="$(cat <<'ASC_MARKER_JS'
let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (error) {
    process.stderr.write("信頼CLI導入マーカーをJSONとして解釈できません\n");
    process.exit(1);
  }
  const ok =
    marker &&
    typeof marker === "object" &&
    marker.schema_version === "agent-skill-chain/trusted-cli/v1" &&
    typeof marker.package === "string" &&
    marker.package.length > 0 &&
    typeof marker.version === "string" &&
    marker.version.length > 0 &&
    typeof marker.tree_digest === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(marker.tree_digest);
  if (!ok) {
    process.stderr.write("信頼CLI導入マーカーの形式が不正です\n");
    process.exit(1);
  }
  process.stdout.write(marker.package + "\t" + marker.version + "\t" + marker.tree_digest);
});
ASC_MARKER_JS
)"

# 複製先パッケージの実行入口（package.json の bin）をパッケージ root からの相対パスで出す。
_ASC_PACKAGE_BIN_JS="$(cat <<'ASC_PACKAGE_BIN_JS'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
} catch (error) {
  process.stderr.write("調達候補のpackage.jsonを読めません: " + root + "\n");
  process.exit(1);
}
let entry = null;
if (typeof pkg.bin === "string") entry = pkg.bin;
else if (pkg.bin && typeof pkg.bin === "object") entry = pkg.bin["agent-skill-chain"] || pkg.bin[pkg.name];
if (typeof entry !== "string" || entry.length === 0) {
  process.stderr.write("調達候補のpackage.jsonにagent-skill-chainの実行入口がありません: " + root + "\n");
  process.exit(1);
}
process.stdout.write(entry.replace(/^\.\//, ""));
ASC_PACKAGE_BIN_JS
)"

# `command -v agent-skill-chain` が解決した実行ファイルから、それを含むパッケージ root を辿る。
_ASC_PACKAGE_ROOT_FROM_BIN_JS="$(cat <<'ASC_PACKAGE_ROOT_JS'
const fs = require("node:fs");
const path = require("node:path");
let current;
try {
  current = path.dirname(fs.realpathSync(process.argv[1]));
} catch (error) {
  process.exit(1);
}
for (;;) {
  const manifest = path.join(current, "package.json");
  if (fs.existsSync(manifest)) {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    } catch (error) {
      pkg = null;
    }
    if (pkg && pkg.name === "agent-skill-chain") {
      process.stdout.write(current);
      process.exit(0);
    }
  }
  const parent = path.dirname(current);
  if (parent === current) process.exit(1);
  current = parent;
}
ASC_PACKAGE_ROOT_JS
)"

_asc_realpath() {
  node -e 'const fs=require("node:fs");try{process.stdout.write(fs.realpathSync(process.argv[1]))}catch(e){process.exit(1)}' -- "$1"
}

# 本リポジトリの linked worktree（protected base worktree を除く）の実体パス一覧。
# 一度だけ解決し、候補の実体パスと依存の参照経路の解決後実体パスの双方から参照する。
_ASC_FOREIGN_WORKTREES=()
# 直前の判定で該当した linked worktree のパス（診断へ載せるため）。
_ASC_MATCHED_WORKTREE=""

_asc_load_foreign_worktrees() {
  local protected_root="$1" protected_real="$2"
  local line worktree_path worktree_real
  _ASC_FOREIGN_WORKTREES=()
  while IFS= read -r line; do
    [[ "$line" == worktree\ * ]] || continue
    worktree_path="${line#worktree }"
    worktree_real="$(_asc_realpath "$worktree_path" 2>/dev/null || printf '%s' "$worktree_path")"
    [[ "$worktree_real" == "$protected_real" ]] && continue
    _ASC_FOREIGN_WORKTREES+=("$worktree_real")
  done < <(git -C "$protected_root" worktree list --porcelain 2>/dev/null || true)
}

# 実体パスが protected base worktree 以外の linked worktree 配下にあるかの唯一の判定。
# 要件7(d) の第一条件（候補の実体パス）と第二条件（依存の供給元に置かれた参照経路の解決後
# 実体パス）は、規則を 2 つへ分けると片方だけが更新されて食い違うため、この 1 関数を共有する。
_asc_path_in_foreign_linked_worktree() {
  local subject_real="$1" worktree_real
  _ASC_MATCHED_WORKTREE=""
  ((${#_ASC_FOREIGN_WORKTREES[@]} == 0)) && return 1
  for worktree_real in "${_ASC_FOREIGN_WORKTREES[@]}"; do
    if [[ "$subject_real" == "$worktree_real" || "$subject_real" == "$worktree_real"/* ]]; then
      _ASC_MATCHED_WORKTREE="$worktree_real"
      return 0
    fi
  done
  return 1
}

# 要件7(d) 第二条件の照合対象を列挙し、参照経路を全て解決した実体パスを併記する。
# 供給元は 2 か所（候補パッケージ root 直下の依存ディレクトリと、親が依存ディレクトリである場合の
# 当該親ディレクトリ）に限り、それぞれディレクトリ自身とその直下の全エントリを対象とする。
# 名前が `@` で始まるエントリはスコープ名のディレクトリであり、その直下の各エントリも対象へ加える。
# 候補パッケージ自身は第一条件で照合済みのため重ねて数えない。
# 出力は `<照合対象パス>\t<解決後の実体パス>` の1行。解決できない場合は実体パスを空にする。
_ASC_DEPENDENCY_SUPPLY_JS="$(cat <<'ASC_DEP_SUPPLY_JS'
const fs = require("node:fs");
const path = require("node:path");
const DEPENDENCY_DIR = "node_modules";
const candidate = process.argv[1];
const candidateReal = process.argv[2];
const supplies = [path.join(candidate, DEPENDENCY_DIR)];
const parent = path.dirname(candidate);
if (path.basename(parent) === DEPENDENCY_DIR) supplies.push(parent);
const targets = new Set();
function addEntries(dir, expandScope) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    targets.add(entryPath);
    if (expandScope && entry.name.startsWith("@")) addEntries(entryPath, false);
  }
}
for (const supply of supplies) {
  try {
    fs.lstatSync(supply);
  } catch (error) {
    continue;
  }
  targets.add(supply);
  addEntries(supply, true);
}
const lines = [];
for (const target of [...targets].sort()) {
  let resolved = "";
  try {
    resolved = fs.realpathSync(target);
  } catch (error) {
    resolved = "";
  }
  if (resolved !== "" && resolved === candidateReal) continue;
  lines.push(target + "\t" + resolved);
}
process.stdout.write(lines.join("\n"));
ASC_DEP_SUPPLY_JS
)"

# 直前の第二条件の判定結果。除外理由と、照合を通過した参照経路の集合。
_ASC_DEPENDENCY_REJECTION=""
_ASC_DEPENDENCY_CHECKED_TARGETS=()

# 要件7(d) 第二条件を判定する。解決できない参照経路（リンク切れ・権限不足・循環）も、
# 解決先が審査対象の配下でないことを示せないため候補を除外する（安全側ラチェット）。
_asc_check_dependency_supply() {
  local candidate="$1" candidate_real="$2"
  local supply_output target resolved
  _ASC_DEPENDENCY_REJECTION=""
  _ASC_DEPENDENCY_CHECKED_TARGETS=()
  if ! supply_output="$(node -e "$_ASC_DEPENDENCY_SUPPLY_JS" -- "$candidate" "$candidate_real" 2>/dev/null)"; then
    _ASC_DEPENDENCY_REJECTION="依存の供給元（候補パッケージ直下および候補と同じ親の node_modules）を列挙できませんでした"
    return 1
  fi
  while IFS=$'\t' read -r target resolved; do
    [[ -n "$target" ]] || continue
    if [[ -z "$resolved" ]]; then
      _ASC_DEPENDENCY_REJECTION="依存の供給元に置かれた参照経路を解決できません（参照経路 ${target} → 解決不能）"
      return 1
    fi
    if _asc_path_in_foreign_linked_worktree "$resolved"; then
      _ASC_DEPENDENCY_REJECTION="依存の供給元に置かれた参照経路の解決後の実体パスが審査対象のlinked worktree配下です（参照経路 ${target} → 実体 ${resolved}, linked worktree ${_ASC_MATCHED_WORKTREE}）"
      return 1
    fi
    _ASC_DEPENDENCY_CHECKED_TARGETS+=("$target")
  done <<<"$supply_output"
  return 0
}

# 参照経路を作ってよいのは、第二条件で照合を通過した集合の内側だけに限る。
_asc_dependency_target_checked() {
  local needle="$1" entry
  ((${#_ASC_DEPENDENCY_CHECKED_TARGETS[@]} == 0)) && return 1
  for entry in "${_ASC_DEPENDENCY_CHECKED_TARGETS[@]}"; do
    [[ "$entry" == "$needle" ]] && return 0
  done
  return 1
}

# 隔離 clone の外にある配布パッケージの実体を検証し、隔離 clone 配下へ複製して実行可能にする。
# 使い方: asc_procure_trusted_cli <trusted_root> <base_sha> <protected_base_root>
# 標準出力: procurement_mode / procurement_source / procurement_digest の3行。
asc_procure_trusted_cli() {
  local trusted_root="$1" base_sha="$2" protected_root="$3"

  local marker_json
  if ! marker_json="$(git -C "$trusted_root" show "${base_sha}:.agent-skill-chain/.trusted-cli.json" 2>/dev/null)"; then
    echo "信頼実行コードの期待値（.agent-skill-chain/.trusted-cli.json）がbase SHAのコミット内容にありません。前提: 調達実体の期待値はbase SHAのコミット内容だけを供給元とすること。是正: upgrade を実行し、生成された .agent-skill-chain/.trusted-cli.json を default branch へ反映してください。" >&2
    return 1
  fi
  local marker_fields expected_package expected_version expected_digest
  if ! marker_fields="$(printf '%s' "$marker_json" | node -e "$_ASC_READ_TRUSTED_CLI_MARKER_JS")"; then
    echo "信頼実行コードの期待値を解釈できません（base SHA の .agent-skill-chain/.trusted-cli.json）。是正: upgrade を実行し、生成結果を default branch へ反映してください。" >&2
    return 1
  fi
  IFS=$'\t' read -r expected_package expected_version expected_digest <<<"$marker_fields"

  local protected_real
  protected_real="$(_asc_realpath "$protected_root" 2>/dev/null || printf '%s' "$protected_root")"
  _asc_load_foreign_worktrees "$protected_root" "$protected_real"

  local -a candidate_ids=() candidate_paths=() candidate_notes=()
  local -a searched=()

  # 候補(a): protected base worktree root 直下の依存ディレクトリ。
  searched+=("(a) protected base worktree root 直下の依存ディレクトリ: ${protected_root}/node_modules/${expected_package}")
  if [[ -d "$protected_root/node_modules/$expected_package" ]]; then
    candidate_ids+=("a"); candidate_paths+=("$protected_root/node_modules/$expected_package"); candidate_notes+=("")
  fi

  # 候補(b): `npm root -g` が返すディレクトリ配下。npm 不在・失敗時は候補なしとして次へ進む。
  local global_root=""
  if command -v npm >/dev/null 2>&1; then
    if global_root="$(npm root -g 2>/dev/null)" && global_root="${global_root%/}" && [[ -n "$global_root" ]]; then
      searched+=("(b) npm root -g が返すディレクトリ配下: ${global_root}/${expected_package}")
      if [[ -d "$global_root/$expected_package" ]]; then
        candidate_ids+=("b"); candidate_paths+=("$global_root/$expected_package"); candidate_notes+=("")
      fi
    else
      searched+=("(b) npm root -g が返すディレクトリ配下: 探索不能（npm root -g が失敗しました）")
    fi
  else
    searched+=("(b) npm root -g が返すディレクトリ配下: 探索不能（npm コマンドがありません）")
  fi

  # 候補(c): `command -v agent-skill-chain` が解決する実行ファイルから辿るパッケージ root。
  local path_cli path_pkg_root
  if path_cli="$(command -v "$expected_package" 2>/dev/null)" && [[ -n "$path_cli" ]]; then
    if path_pkg_root="$(node -e "$_ASC_PACKAGE_ROOT_FROM_BIN_JS" -- "$path_cli" 2>/dev/null)" && [[ -n "$path_pkg_root" ]]; then
      searched+=("(c) PATH上の実行ファイルから辿るパッケージ root: ${path_pkg_root}（実行ファイル: ${path_cli}）")
      candidate_ids+=("c"); candidate_paths+=("$path_pkg_root"); candidate_notes+=("")
    else
      searched+=("(c) PATH上の実行ファイルから辿るパッケージ root: 探索不能（${path_cli} からパッケージ root を辿れませんでした）")
    fi
  else
    searched+=("(c) PATH上の実行ファイルから辿るパッケージ root: 探索不能（command -v ${expected_package} が解決しませんでした）")
  fi

  local index adopted_path="" adopted_id="" adopted_real="" adopted_digest="" eligible_count=0
  local -a rejected=()
  # set -u 下で空配列の展開に依存しないよう、要素数を先に確かめてから走査する。
  for ((index = 0; index < ${#candidate_paths[@]}; index++)); do
    local candidate="${candidate_paths[$index]}" candidate_id="${candidate_ids[$index]}"
    local candidate_real
    candidate_real="$(_asc_realpath "$candidate" 2>/dev/null || printf '%s' "$candidate")"
    # 要件7(d) の 2 条件はいずれも採用前・正準ツリーdigest算出前に判定する。
    # 除外した候補には複製も参照経路の付与も行わない。
    if _asc_path_in_foreign_linked_worktree "$candidate_real"; then
      rejected+=("(${candidate_id}) ${candidate}: 第一の条件により除外（候補の実体パスが審査対象のlinked worktree配下です: 実体 ${candidate_real}, linked worktree ${_ASC_MATCHED_WORKTREE}）")
      continue
    fi
    if ! _asc_check_dependency_supply "$candidate" "$candidate_real"; then
      rejected+=("(${candidate_id}) ${candidate}: 第二の条件により除外（${_ASC_DEPENDENCY_REJECTION}）")
      continue
    fi
    eligible_count=$((eligible_count + 1))
    local candidate_digest
    if ! candidate_digest="$(asc_canonical_tree_digest "$candidate" 2>/dev/null)"; then
      rejected+=("(${candidate_id}) ${candidate}: 正準ツリーdigestを算出できませんでした")
      continue
    fi
    if [[ "$candidate_digest" != "$expected_digest" ]]; then
      rejected+=("(${candidate_id}) ${candidate}: digestが期待値と一致しません（実測 ${candidate_digest}）")
      continue
    fi
    adopted_path="$candidate"; adopted_id="$candidate_id"; adopted_real="$candidate_real"; adopted_digest="$candidate_digest"
    break
  done

  if [[ -z "$adopted_path" ]]; then
    # 前提を 3 種に分ける。(1) 候補が1つも存在しない (2) 候補は存在したが除外規則で全て除外
    # (3) 除外されなかった候補はあったが期待値と一致するものが無い。
    local reason
    if (( ${#candidate_paths[@]} == 0 )); then
      reason="信頼実行コードの供給元が実行環境に存在しません。是正: 配布パッケージ ${expected_package}@${expected_version} を consumer の node_modules 配下または PATH 上へ導入してから再実行してください（ローカルの package キャッシュのみの状態は供給元として扱いません）。"
    elif (( eligible_count == 0 )); then
      reason="調達候補が審査対象のlinked worktreeに由来する、または審査対象のlinked worktree配下の実体を依存として解決するため、全候補を採用前に除外しました。是正: 当該参照経路を除去するか、審査対象外の実体から依存を解決できる状態にしてから再実行してください。"
    else
      reason="調達候補の完全性検証に失敗しました（期待値 ${expected_digest} と一致する候補がありません）。是正: 導入版と導入マーカーの整合を回復するため upgrade を実行し、その結果を default branch へ反映してください。"
    fi
    {
      echo "$reason"
      echo "探索した候補と探索先:"
      if ((${#searched[@]} > 0)); then printf '  - %s\n' "${searched[@]}"; fi
      if ((${#rejected[@]} > 0)); then
        echo "採用しなかった候補:"
        printf '  - %s\n' "${rejected[@]}"
      fi
    } >&2
    return 1
  fi

  local dest="$trusted_root/node_modules/$expected_package"
  rm -rf -- "$dest"
  mkdir -p -- "$dest"
  local entry entry_name
  for entry in "$adopted_path"/* "$adopted_path"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    entry_name="$(basename -- "$entry")"
    [[ "$entry_name" == "node_modules" || "$entry_name" == ".git" ]] && continue
    if ! cp -R -p -- "$entry" "$dest/"; then
      echo "調達実体を隔離clone配下へ複製できません: ${entry}" >&2
      return 1
    fi
  done

  local copied_digest
  if ! copied_digest="$(asc_canonical_tree_digest "$dest")"; then
    echo "複製先の正準ツリーdigestを算出できません: ${dest}" >&2
    return 1
  fi
  if [[ "$copied_digest" != "$expected_digest" ]]; then
    echo "複製先の正準ツリーdigestが期待値と一致しません（実測 ${copied_digest}, 期待 ${expected_digest}）。" >&2
    return 1
  fi

  # 依存モジュールは実体を複製せず、参照経路だけを与える。依存実体の由来・完全性の積極的な検証は
  # Issue #772 の射程だが、要件7(d) 第二条件（参照先の解決後実体パスが審査対象のlinked worktree
  # 配下でないこと）は本関数が担う。採用の判定と付与の間に参照先が差し替えられた場合へ備え、
  # 付与の直前に同じ照合を再度行い、1つでも条件を満たさなければ付与せず非0終了する。
  if ! _asc_check_dependency_supply "$adopted_path" "$adopted_real"; then
    echo "調達候補の依存の供給元が採用後に条件を満たさなくなったため、参照経路を作らずに停止します（${_ASC_DEPENDENCY_REJECTION}）。" >&2
    return 1
  fi
  local candidate_parent dep dep_name
  candidate_parent="$(dirname -- "$adopted_path")"
  if [[ "$(basename -- "$candidate_parent")" == "node_modules" ]]; then
    for dep in "$candidate_parent"/*; do
      [[ -e "$dep" ]] || continue
      dep_name="$(basename -- "$dep")"
      [[ "$dep_name" == "$expected_package" || "$dep_name" == ".bin" ]] && continue
      # 照合を経ていない対象へは参照経路を作らない。
      _asc_dependency_target_checked "$dep" || continue
      [[ -e "$trusted_root/node_modules/$dep_name" ]] && continue
      ln -s -- "$dep" "$trusted_root/node_modules/$dep_name"
    done
  fi
  if [[ -d "$adopted_path/node_modules" ]] && _asc_dependency_target_checked "$adopted_path/node_modules"; then
    ln -s -- "$adopted_path/node_modules" "$dest/node_modules"
  fi

  local bin_relative
  if ! bin_relative="$(node -e "$_ASC_PACKAGE_BIN_JS" -- "$dest")"; then
    return 1
  fi
  mkdir -p -- "$trusted_root/node_modules/.bin"
  cat > "$trusted_root/node_modules/.bin/$expected_package" <<ASC_TRUSTED_BIN
#!/usr/bin/env bash
exec node "${dest}/${bin_relative}" "\$@"
ASC_TRUSTED_BIN
  chmod 755 -- "$trusted_root/node_modules/.bin/$expected_package"

  printf 'procurement_mode: package_copy\n'
  printf 'procurement_source: candidate-%s:%s#%s@%s\n' "$adopted_id" "$adopted_path" "$expected_package" "$expected_version"
  printf 'procurement_digest: %s\n' "$adopted_digest"
}
