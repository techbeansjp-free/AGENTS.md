#!/usr/bin/env bash
# setup.sh — 初回セットアップ
# 本 .agents/ をプロジェクトの .agents/ にコピーし、AGENTS.md / CLAUDE.md をルートに配置する。
# .claude/・.cursor/ の生成とスキル同期・テンプレートコピーを行う。
# 配置: .agents/scripts/（パッケージルート基準）。参照: SETUP.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# 第1引数があればそれをプロジェクトルートに。なければ:
# - PACKAGE_ROOT が Git リポジトリ内のサブディレクトリなら、その Git のトップレベルをプロジェクトルートとする
# - それ以外は PACKAGE_ROOT をプロジェクトルートとする
if [[ -n "${1:-}" ]]; then
  PROJECT_ROOT="$(cd "$1" && pwd)"
else
  PACKAGE_ROOT_N="$(cd "$PACKAGE_ROOT" && pwd)"
  GIT_TOP="$(cd "$PACKAGE_ROOT_N" && git rev-parse --show-toplevel 2>/dev/null)" || GIT_TOP=""
  if [[ -n "$GIT_TOP" ]]; then
    GIT_TOP="$(cd "$GIT_TOP" && pwd)"
    if [[ "$PACKAGE_ROOT_N" != "$GIT_TOP" && "$PACKAGE_ROOT_N" == "$GIT_TOP"/* ]]; then
      PROJECT_ROOT="$GIT_TOP"
    else
      PROJECT_ROOT="$PACKAGE_ROOT_N"
    fi
  else
    PROJECT_ROOT="$PACKAGE_ROOT_N"
  fi
fi

if [[ ! -d "$AGENTS_SOURCE" ]]; then
  echo "エラー: .agents が見つかりません: $AGENTS_SOURCE。パッケージのルートで実行してください: bash .agents/scripts/setup.sh（採用先プロジェクトルートにいる場合は bash <本パッケージのディレクトリ名>/.agents/scripts/setup.sh）" >&2
  exit 1
fi

echo "プロジェクトルート:  $PROJECT_ROOT"
echo "パッケージルート:    $PACKAGE_ROOT"
echo "Agents ソース:       $AGENTS_SOURCE"

for f in AGENTS.md CLAUDE.md; do
  if [[ -f "$PACKAGE_ROOT/$f" ]]; then
    if [[ "$(cd "$PACKAGE_ROOT" && pwd)/$f" != "$(cd "$PROJECT_ROOT" && pwd)/$f" ]]; then
      cp "$PACKAGE_ROOT/$f" "$PROJECT_ROOT/$f"
      echo "$f をプロジェクトルートにコピーしました。"
    else
      echo "$f は既にプロジェクトルートにあります。"
    fi
  fi
done

if [[ "$(cd "$AGENTS_SOURCE" && pwd)" != "$(cd "$PROJECT_ROOT/.agents" 2>/dev/null && pwd)" ]]; then
  if [[ -d "$PROJECT_ROOT/.agents" ]]; then
    rm -rf "$PROJECT_ROOT/.agents"
    echo "既存の .agents を削除しました。"
  fi
  cp -R "$AGENTS_SOURCE" "$PROJECT_ROOT/.agents"
  echo ".agents をプロジェクトルートにコピーしました。"
else
  echo ".agents は既にプロジェクトルートにあります。コピーをスキップし、hooks・スキル・DB のみ更新します。"
fi

# .agents-project は setup では作成しない（SETUP.md 準拠）。プロジェクト側で用意する

# .workflow/templates は常にパッケージの .workflow/templates の内容で最新化する（ソースと同一パスの場合はスキップ）
WF_TEMPLATES="$PROJECT_ROOT/.workflow/templates"
WF_SOURCE="$PACKAGE_ROOT/.workflow/templates"
if [[ -d "$WF_SOURCE" ]]; then
  if [[ "$(cd "$WF_SOURCE" 2>/dev/null && pwd)" != "$(cd "$WF_TEMPLATES" 2>/dev/null && pwd)" ]]; then
    rm -rf "$WF_TEMPLATES"
    mkdir -p "$PROJECT_ROOT/.workflow"
    cp -R "$WF_SOURCE" "$PROJECT_ROOT/.workflow/"
    echo ".workflow/templates をコピーしました（常に最新化）。"
  else
    echo ".workflow/templates は既にプロジェクトにあります。スキップします。"
  fi
fi

# スキルをプラットフォーム別パスに同期する（.claude/skills, .cursor/skills）
# 配備ロジック（{domain}__{capability} 命名の単一正本）は共有ライブラリに集約。
# build-adapters.sh も同じ lib を source する。配備ロジックを二重定義しないこと。
# 参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md, scripts/lib/deploy-skills.sh
# shellcheck source=lib/deploy-skills.sh
. "$SCRIPT_DIR/lib/deploy-skills.sh"

# sync_skills <dest_root> [<src_skills>]
#   共有ライブラリの deploy_skills_impl に委譲する。常に最新にするため同期前に配備先を削除する。
#   注意: <dest_root>（.claude/skills・.cursor/skills）は **パッケージ生成 skills 専用ディレクトリ**として扱う。
#         このディレクトリへの手置きは禁止（毎回 rm -rf して再生成する）。ユーザー資産は置かないこと。
#         （SETUP.md「保持・上書き契約」参照）
sync_skills() {
  local dest_root="$1"
  local agents_skills="${2:-$PROJECT_ROOT/.agents/skills}"
  [[ ! -d "$agents_skills" ]] && return 0
  rm -rf "$dest_root"
  deploy_skills_impl "$agents_skills" "$dest_root" >/dev/null
}

# copy_owned_files <src_dir> <dest_dir>
#   <src_dir> 配下のパッケージ所有ファイル（トップレベルの通常ファイル）だけを <dest_dir> へ上書きコピーする。
#   ディレクトリ全体を rm -rf しないため、<dest_dir> 配下のユーザー作成物（他の rules/*.mdc 等）は保持される。
#   .gitkeep は配備不要のため除外する。サブディレクトリ（例: skills）は別途 sync_skills が扱う。
copy_owned_files() {
  local src_dir="$1"
  local dest_dir="$2"
  [[ -d "$src_dir" ]] || return 0
  mkdir -p "$dest_dir"
  local f base
  for f in "$src_dir"/*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == ".gitkeep" ]] && continue
    cp "$f" "$dest_dir/$base"
  done
}

# .claude/ はパッケージ所有分（hooks・skills）のみ更新する。
# ユーザー設定（.claude/settings.json 等）や他のユーザー作成物は touch しない（保持）。
CLAUDE_DIR="$PROJECT_ROOT/.claude"
mkdir -p "$CLAUDE_DIR"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/claude" ]]; then
  # hooks/ はパッケージ生成物専用ディレクトリ。毎回作り直す（ユーザーは手置きしない前提。SETUP.md 参照）。
  rm -rf "$CLAUDE_DIR/hooks"
  mkdir -p "$CLAUDE_DIR/hooks"
  copy_owned_files "$PROJECT_ROOT/.agents/enforcement/claude" "$CLAUDE_DIR/hooks"
  echo "enforcement/claude から .claude/hooks を最新化しました（ユーザー設定は保持）。"
else
  echo "注: enforcement/claude が見つかりません。.claude/ を空で作成しました。"
fi

# .cursor/ は丸ごと削除しない。パッケージ所有ファイル（agents-core.mdc 等）と skills のみ更新する。
# ユーザーが .cursor/ 配下に置いた自作ルール（rules/*.mdc 等）・独自ファイルは保持する。
CURSOR_DIR="$PROJECT_ROOT/.cursor"
mkdir -p "$CURSOR_DIR"
if [[ -d "$PROJECT_ROOT/.agents/enforcement/cursor" ]]; then
  copy_owned_files "$PROJECT_ROOT/.agents/enforcement/cursor" "$CURSOR_DIR"
  echo "enforcement/cursor から .cursor/ のパッケージ所有分を最新化しました（ユーザー自作ルールは保持）。"
else
  echo "注: enforcement/cursor が見つかりません。.cursor/ を空で作成しました。"
fi

if [[ -d "$PROJECT_ROOT/.agents" ]]; then
  sync_skills "$PROJECT_ROOT/.claude/skills" "$PROJECT_ROOT/.agents/skills"
  sync_skills "$PROJECT_ROOT/.cursor/skills" "$PROJECT_ROOT/.agents/skills"
  echo "スキルを .claude/skills と .cursor/skills に同期しました。"
fi

# 証跡 DB を setup 時に生成（実体は Git 管理対象外。配布物に含めない）
init_workflow_db() {
  local db="$PROJECT_ROOT/.workflow/workflow.db"
  if [[ -f "$db" ]]; then
    return 0
  fi
  echo "[setup] ワークフロー用 DB を作成しています"
  mkdir -p "$(dirname "$db")"
  # スキーマの正本は ledger/schema.sql（単一正本）。ここでは流すだけ。
  sqlite3 "$db" < "$AGENTS_SOURCE/ledger/schema.sql"
}

init_workflow_db

echo "セットアップ完了。スモークテストは .agents/SETUP.md を参照してください。"
