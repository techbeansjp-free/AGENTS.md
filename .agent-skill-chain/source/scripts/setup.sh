#!/usr/bin/env bash
# setup.sh — 初回セットアップ
# パッケージ正本（source/）をプロジェクトの .agent-skill-chain/source/ にコピーし、AGENTS.md /
# CLAUDE.md をルートに配置する。旧 3 ディレクトリ構成の検出時は統合移行してから配備する。
# .claude/・.cursor/ の生成とスキル同期・runtime/templates コピーを行う。
# 配置: .agent-skill-chain/source/scripts/（パッケージルート基準）。参照: source/SETUP.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"
# 統合ネスト（.agent-skill-chain/source/scripts/）により、setup.sh はパッケージルートから
# 1 階層深い位置へ移動した（旧 .agent-skill-chain/source/scripts/ は 2 階層上がパッケージルートだったが、
# 新 .agent-skill-chain/source/scripts/ は 3 階層上がパッケージルート）。
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
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
  echo "エラー: パッケージ正本（source）が見つかりません: $AGENTS_SOURCE。パッケージのルートで実行してください: bash .agent-skill-chain/source/scripts/setup.sh（採用先プロジェクトルートにいる場合は bash <本パッケージのディレクトリ名>/.agent-skill-chain/source/scripts/setup.sh）" >&2
  exit 1
fi

echo "プロジェクトルート:  $PROJECT_ROOT"
echo "パッケージルート:    $PACKAGE_ROOT"
echo "Agents ソース:       $AGENTS_SOURCE"

# 配備マーカー（.agent-skill-chain/.package-manifest）による衝突検知・再配備前バックアップ・
# README 警告の共通ロジック（単一正本）。破壊的操作（source 相当のコピー等）より前に必ず実行する。
# fail-closed: 本パッケージ由来と確認できない .agent-skill-chain/ が既にあれば
# check_package_manifest がここでエラー終了し、以降の破壊的操作は一切行われない。
# shellcheck source=lib/package-manifest.sh
. "$SCRIPT_DIR/lib/package-manifest.sh"
# workflow.db 由来検知（軽量警告・非中止）の共通ロジック。init_workflow_db から呼ぶ。
# shellcheck source=lib/workflow-db-guard.sh
. "$SCRIPT_DIR/lib/workflow-db-guard.sh"

PACKAGE_NAME="$(grep -m1 '"name"' "$PACKAGE_ROOT/package.json" | sed -E 's/.*"name": *"([^"]+)".*/\1/')"
PACKAGE_VERSION="$(grep -m1 '"version"' "$PACKAGE_ROOT/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')"

ASC_MODE="$(check_package_manifest "$PROJECT_ROOT" "$PACKAGE_NAME" "$PACKAGE_ROOT")"
if [[ "$ASC_MODE" == "own" ]]; then
  # 自己適用（PACKAGE_ROOT=PROJECT_ROOT）: 配備先がパッケージ自身のリポジトリ。
  # .agent-skill-chain/ はパッケージ正本そのものであり、マーカー（gitignore 対象の生成物）が
  # 無くても本パッケージ由来であることは実パス一致で確定している。バックアップ・統合移行は
  # 行わず（source を自身へ退避しても無意味・後続コピーも同一パスでスキップされる）続行する。
  echo "自己適用（PACKAGE_ROOT=PROJECT_ROOT）を検出しました。マーカー検査をスキップして続行します。"
elif [[ "$ASC_MODE" == "match" ]]; then
  echo ".agent-skill-chain/ の配備マーカーが本パッケージ（$PACKAGE_NAME）と一致しました。再配備前にバックアップします。"
  backup_agent_skill_chain "$PROJECT_ROOT"
elif [[ -d "$PROJECT_ROOT/.agents" ]]; then
  # .agent-skill-chain/ 未配備だが旧レイアウトの source 相当ディレクトリ（統合ネスト前のルート直下配置）を
  # 検出。フィンガープリント一致なら統合移行、不一致なら本パッケージ由来と確認できないため fail-closed で
  # 中止する（既存ファイルは変更しない）。
  if legacy_fingerprint_ok "$PROJECT_ROOT"; then
    echo "旧 3 ディレクトリ構成（統合ネスト前のレイアウト）を検出しました。.agent-skill-chain/ へ統合移行します。"
    migrate_legacy_dirs "$PROJECT_ROOT"
  else
    echo "エラー: 旧レイアウトの source 相当ディレクトリが存在しますが、本パッケージのフィンガープリント（4 ファイル）と一致しません。" >&2
    echo "        本パッケージ由来と確認できないため、統合移行を中止します（既存ファイルは変更しません）。" >&2
    exit 1
  fi
else
  echo ".agent-skill-chain/ は未配備です（新規配備）。"
fi
write_package_manifest "$PROJECT_ROOT" "$PACKAGE_NAME" "$PACKAGE_VERSION"
write_readme_warning "$PROJECT_ROOT"
echo ".agent-skill-chain/.package-manifest と README.md を最新化しました。"

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

ASC_SOURCE_DEST="$PROJECT_ROOT/.agent-skill-chain/source"
if [[ "$(cd "$AGENTS_SOURCE" && pwd)" != "$(cd "$ASC_SOURCE_DEST" 2>/dev/null && pwd)" ]]; then
  if [[ -d "$ASC_SOURCE_DEST" ]]; then
    rm -rf "$ASC_SOURCE_DEST"
    echo "既存の .agent-skill-chain/source を削除しました。"
  fi
  mkdir -p "$PROJECT_ROOT/.agent-skill-chain"
  cp -R "$AGENTS_SOURCE" "$ASC_SOURCE_DEST"
  echo "パッケージ正本を .agent-skill-chain/source にコピーしました。"
else
  echo ".agent-skill-chain/source は既にパッケージ正本と同一です。コピーをスキップし、hooks・スキル・DB のみ更新します。"
fi

# project/ は setup では作成しない（SETUP.md 準拠）。プロジェクト側で用意する

# runtime/templates は常にパッケージのテンプレート内容で最新化する（ソースと同一パスの場合はスキップ）
WF_TEMPLATES="$PROJECT_ROOT/.agent-skill-chain/runtime/templates"
WF_SOURCE="$PACKAGE_ROOT/.agent-skill-chain/runtime/templates"
if [[ -d "$WF_SOURCE" ]]; then
  if [[ "$(cd "$WF_SOURCE" 2>/dev/null && pwd)" != "$(cd "$WF_TEMPLATES" 2>/dev/null && pwd)" ]]; then
    rm -rf "$WF_TEMPLATES"
    mkdir -p "$PROJECT_ROOT/.agent-skill-chain/runtime"
    cp -R "$WF_SOURCE" "$PROJECT_ROOT/.agent-skill-chain/runtime/"
    echo "runtime/templates をコピーしました（常に最新化）。"
  else
    echo "runtime/templates は既にプロジェクトにあります。スキップします。"
  fi
fi

# runtime/.gitignore は未存在時のみ配布する（workflow.db* 誤追跡防止の恒久修正・ADR-1）。
# runtime/templates と異なり、消費者側のローカル変更を尊重するため既存ファイルは上書きしない。
# コピー元は「.gitignore」という名前そのものではなく専用テンプレート名にしている（ADR-4）:
#   npm-packlist は「.gitignore」という名前のファイルを、package.json の files 配列指定に
#   関わらず、パッケージルートから 2 階層以上ネストした位置では強制的に配布物から除外する
#   （実機検証済み。evidence_source: existing_code + 実行確認。npm init 系テンプレート機構が
#   gitignore→.gitignore にリネームするのと同じ回避策）。そのため配布経路上は非 .gitignore 名の
#   テンプレート（.agent-skill-chain/source/runtime-gitignore.template）として保持し、
#   コピー時にのみ .gitignore へリネームする。
WF_GITIGNORE="$PROJECT_ROOT/.agent-skill-chain/runtime/.gitignore"
WF_GITIGNORE_SOURCE="$PACKAGE_ROOT/.agent-skill-chain/source/runtime-gitignore.template"
if [[ -f "$WF_GITIGNORE_SOURCE" ]]; then
  if [[ ! -f "$WF_GITIGNORE" ]]; then
    mkdir -p "$PROJECT_ROOT/.agent-skill-chain/runtime"
    cp "$WF_GITIGNORE_SOURCE" "$WF_GITIGNORE"
    echo "runtime/.gitignore を配布しました（未存在時のみ）。"
  fi
else
  # コピー元テンプレートがパッケージ内に見つからない（本 issue が修正した配布漏れと同種の
  # 回帰の可能性がある）。処理は中止せず（enforcement/claude・enforcement/cursor 欠落時と
  # 同じ非致命方針。L187-207 参照）、workflow-db-guard.sh の 3 要素警告書式を踏襲して
  # stderr へ明示的に警告する（無言スキップにしない。CodeRabbit指摘・回帰防止）。
  {
    echo "警告: runtime/.gitignore のコピー元テンプレートが見つかりません: $WF_GITIGNORE_SOURCE"
    echo "  推定される問題: パッケージの配布物（npm tarball 等）から .agent-skill-chain/source/runtime-gitignore.template が欠落している可能性があります（本パッケージが過去に修正した配布漏れと同種の回帰）。"
    echo "  確認手順: パッケージのバージョン・配布経路（npm publish の files 設定等）を確認してください。setup 処理はこのまま続行しますが、runtime/.gitignore は配布されません。"
  } >&2
fi

# スキルをプラットフォーム別パスに同期する（.claude/skills, .cursor/skills）
# 配備ロジック（{domain}__{capability} 命名の単一正本）は共有ライブラリに集約。
# build-adapters.sh も同じ lib を source する。配備ロジックを二重定義しないこと。
# 参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md, scripts/lib/deploy-skills.sh
# shellcheck source=lib/deploy-skills.sh
. "$SCRIPT_DIR/lib/deploy-skills.sh"

# sync_skills <dest_root> [<src_skills>]
#   共有ライブラリの sync_skills_selective に委譲する。**dest を丸ごと rm -rf しない**。
#   パッケージ所有エントリ（{domain}__{capability}・ドメイン直下 {domain}）のみを削除→再配備し、
#   所有集合に含まれないディレクトリ（＝ユーザー自作スキル）は保持する。
#   命名/所有集合の単一定義は lib/deploy-skills.sh（list_owned_skill_names）に集約。
#   （SETUP.md「保持・上書き契約」参照）
sync_skills() {
  local dest_root="$1"
  local agents_skills="${2:-$PROJECT_ROOT/.agent-skill-chain/source/skills}"
  [[ ! -d "$agents_skills" ]] && return 0
  sync_skills_selective "$agents_skills" "$dest_root"
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
ASC_SOURCE_LOCAL="$PROJECT_ROOT/.agent-skill-chain/source"
if [[ -d "$ASC_SOURCE_LOCAL/enforcement/claude" ]]; then
  # hooks/ は丸ごと rm -rf せず、enforcement/claude 由来のパッケージ所有フックファイルのみを
  # 上書き配備する。ユーザーが .claude/hooks/ に置いた独自ファイルは保持する。
  # 所有フックファイル名は enforcement/claude の内容から導出（copy_owned_files の規則＝単一正本）。
  mkdir -p "$CLAUDE_DIR/hooks"
  copy_owned_files "$ASC_SOURCE_LOCAL/enforcement/claude" "$CLAUDE_DIR/hooks"
  echo "enforcement/claude から .claude/hooks のパッケージ所有分を最新化しました（ユーザー独自フックは保持）。"
else
  echo "注: enforcement/claude が見つかりません。.claude/ を空で作成しました。"
fi

# .cursor/ は丸ごと削除しない。パッケージ所有ファイル（agents-core.mdc 等）と skills のみ更新する。
# ユーザーが .cursor/ 配下に置いた自作ルール（rules/*.mdc 等）・独自ファイルは保持する。
CURSOR_DIR="$PROJECT_ROOT/.cursor"
mkdir -p "$CURSOR_DIR"
if [[ -d "$ASC_SOURCE_LOCAL/enforcement/cursor" ]]; then
  copy_owned_files "$ASC_SOURCE_LOCAL/enforcement/cursor" "$CURSOR_DIR"
  echo "enforcement/cursor から .cursor/ のパッケージ所有分を最新化しました（ユーザー自作ルールは保持）。"
else
  echo "注: enforcement/cursor が見つかりません。.cursor/ を空で作成しました。"
fi

if [[ -d "$ASC_SOURCE_LOCAL" ]]; then
  sync_skills "$PROJECT_ROOT/.claude/skills" "$ASC_SOURCE_LOCAL/skills"
  sync_skills "$PROJECT_ROOT/.cursor/skills" "$ASC_SOURCE_LOCAL/skills"
  echo "スキルを .claude/skills と .cursor/skills に同期しました。"
fi

# 証跡 DB を setup 時に生成（実体は Git 管理対象外。配布物に含めない）
init_workflow_db() {
  local db="$PROJECT_ROOT/.agent-skill-chain/runtime/workflow.db"
  if [[ -f "$db" ]]; then
    warn_if_foreign_workflow_db "$db"
    return 0
  fi
  echo "[setup] ワークフロー用 DB を作成しています"
  mkdir -p "$(dirname "$db")"
  # スキーマの正本は ledger/schema.sql（単一正本）。ここでは流すだけ。
  sqlite3 "$db" < "$AGENTS_SOURCE/ledger/schema.sql"
}

init_workflow_db

echo "セットアップ完了。スモークテストは .agent-skill-chain/source/SETUP.md を参照してください。"
