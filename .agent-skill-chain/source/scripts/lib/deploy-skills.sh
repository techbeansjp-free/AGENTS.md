#!/usr/bin/env bash
# deploy-skills.sh — スキル配備ロジックの共有ライブラリ（命名規約 {domain}__{capability} の単一正本）。
#
# 責務: 正本 .agent-skill-chain/source/skills/{domain}/{capability}/ を、配備先 {domain}__{capability}/ で配備する
#       唯一の関数 deploy_skills を提供する。配備先ディレクトリは引数化し、build-adapters.sh
#       （アダプタ生成 .adapters/<tool>/skills/）と setup.sh（自己インストール .claude/skills・
#       .cursor/skills）の双方がこの 1 ファイルを source して同じロジックを使う。
#
# 命名規約の単一定義:
#   - capability 配下: SKILL.md を持つ {domain}/{capability}/ を {domain}__{capability}/ に配備。
#   - ドメイン直下:    {domain}/SKILL.md がある場合（例: agent/）は {domain}/ に配備。
#   {domain}__{capability} の算出はこの 1 箇所のみ。他で再実装しないこと。
#   参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md, platforms/SKILLS.md
#
# このファイルは保守/導入専用スクリプトであり、アダプタには同梱しない
# （build-adapters.sh の bundle_agents_src 除外対象。二重管理回避）。
#
# 由来判定（所有マーカー）の単一正本:
#   配備先スキルディレクトリが「パッケージ配備物か」を判定する責務も本ファイルに集約する
#   （命名/所有集合と同様に単一正本とし、TS 版 src/agents-md.ts の isOwnedSkillDir が同型ミラーする）。
#   破壊操作（rm -rf・上書き・uninstall 削除）は名前一致ではなく**由来の確定**に従属させ、
#   由来不明の同名ディレクトリ（＝ユーザー自作スキル）は保持する。
#   マーカーはセキュリティ境界ではなく偶発的な名前衝突事故の防止に用いる軽量な配備証跡である。
#   契約・所有区分の正本ドキュメントは SETUP.md（§所有区分／保持・上書き契約）。
#   参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md, platforms/SKILLS.md, SETUP.md

# 配備先スキルディレクトリに書き込む所有マーカー（配備証跡）のファイル名。
# 存在＝パッケージ配備物（高速パス）。TS 版（src/agents-md.ts）も同一名を用いる（drift 防止）。
ASC_SKILL_OWNED_MARKER=".agent-skill-chain-owned"
# マーカー内容（パッケージ識別子）。統合ルート .package-manifest と同趣旨の軽量版。
ASC_SKILL_OWNED_MARKER_CONTENT="agent-skill-chain"

# _asc_skill_frontmatter_name <skill_md>
#   SKILL.md の frontmatter `name` フィールド値を標準出力へ返す（先頭一致・前後空白トリム・
#   引用符除去）。ファイル無し・`name:` 行無しなら空文字を返す。由来判定の移行フォールバックで
#   「配備先 SKILL.md の name が正本 SKILL.md の name と一致するか」を比較するために使う。
#   TS 版 skillFrontmatterName と同一の正規化規則（drift 防止）。
_asc_skill_frontmatter_name() {
  local skill_md="$1"
  [[ -f "$skill_md" ]] || return 0
  local line
  line="$(grep -m1 -E '^[[:space:]]*name:' "$skill_md" 2>/dev/null)" || return 0
  [[ -z "$line" ]] && return 0
  line="${line#*:}"                              # `name:` を除去
  line="${line#"${line%%[![:space:]]*}"}"        # 先頭空白トリム
  line="${line%"${line##*[![:space:]]}"}"        # 末尾空白トリム
  line="${line#\"}"; line="${line%\"}"           # 二重引用符除去
  line="${line#\'}"; line="${line%\'}"           # 単一引用符除去
  printf '%s' "$line"
}

# is_owned_skill_dir <dest_dir> <src_skill_md>
#   配備先の 1 スキルディレクトリの由来を判定する副作用のない Query。
#   判定の優先順（fail-safe＝判定不能は破壊しない側 collision へ倒す）:
#     (1) dest_dir 不在                                    → absent（安全に新規配備可）
#     (2) dest_dir/$ASC_SKILL_OWNED_MARKER 有              → owned（配備証跡あり）
#     (3) マーカー無・dest SKILL.md の name == 正本 name    → legacy_owned（マーカー backfill 対象）
#     (4) それ以外（name 不一致・SKILL.md/name 欠落）        → collision（非所有＝保持）
#   区分文字列を標準出力へ返す。
is_owned_skill_dir() {
  local dest_dir="$1"
  local src_skill_md="$2"
  if [[ ! -d "$dest_dir" ]]; then
    echo "absent"
    return 0
  fi
  if [[ -f "$dest_dir/$ASC_SKILL_OWNED_MARKER" ]]; then
    echo "owned"
    return 0
  fi
  local dest_name src_name
  dest_name="$(_asc_skill_frontmatter_name "$dest_dir/SKILL.md")"
  src_name="$(_asc_skill_frontmatter_name "$src_skill_md")"
  if [[ -n "$dest_name" && -n "$src_name" && "$dest_name" == "$src_name" ]]; then
    echo "legacy_owned"
    return 0
  fi
  echo "collision"
}

# _asc_write_skill_marker <dest_dir>
#   配備した各スキルディレクトリ直下へ所有マーカーを書き込む。書込み失敗は警告に留め非致命
#   （次回同期で name 一致フォールバックにより owned/legacy_owned と再判定でき回復可能）。
_asc_write_skill_marker() {
  local dest_dir="$1"
  printf '%s\n' "$ASC_SKILL_OWNED_MARKER_CONTENT" > "$dest_dir/$ASC_SKILL_OWNED_MARKER" 2>/dev/null \
    || echo "警告: 所有マーカーの書き込みに失敗しました: $dest_dir/$ASC_SKILL_OWNED_MARKER" >&2
}

# deploy_skills_impl <src_skills_dir> <out_skills_dir> [only_name] [write_marker]
#   <src_skills_dir>  : 正本 skills ルート（例: .agent-skill-chain/source/skills）
#   <out_skills_dir>  : 配備先ルート（例: .adapters/claude/skills, .claude/skills, .cursor/skills）
#   [only_name]       : 指定時は当該所有エントリ名（{domain} または {domain}__{cap}）のみ配備。省略で全件。
#   [write_marker]    : 真値（非空）時は配備した各 dest 直下へ所有マーカーを書き込む。省略で書き込まない。
#   配備先は呼び出し側で事前にクリーンしてよい（setup は rm -rf する）。本関数は mkdir -p のみ行う。
#   配備件数を標準出力へ返す（呼び出し側がメッセージを整形する）。
#   後方互換: 追加 2 引数を省略すると従来挙動（全件配備・マーカー無し）を厳守する
#            （build-adapters.sh の 2 引数呼び出しはアダプタカプセルへマーカーを混入させない）。
deploy_skills_impl() {
  local src_skills="$1"
  local out_skills="$2"
  local only_name="${3:-}"
  local write_marker="${4:-}"
  [[ -d "$src_skills" ]] || return 0
  local n_skill=0
  mkdir -p "$out_skills"

  local domain_dir domain
  for domain_dir in "$src_skills"/*/; do
    [[ -d "$domain_dir" ]] || continue
    domain=$(basename "$domain_dir")
    [[ -z "$domain" ]] && continue

    # ドメイン直下に SKILL.md があるケース（例: agent/）は {domain} で配備する。
    if [[ -f "$domain_dir/SKILL.md" ]]; then
      if [[ -z "$only_name" || "$only_name" == "$domain" ]]; then
        mkdir -p "$out_skills/$domain"
        cp "$domain_dir/SKILL.md" "$out_skills/$domain/SKILL.md"
        [[ -f "$domain_dir/README.md" ]] && cp "$domain_dir/README.md" "$out_skills/$domain/README.md"
        [[ -n "$write_marker" ]] && _asc_write_skill_marker "$out_skills/$domain"
        n_skill=$((n_skill+1))
      fi
    fi

    # capability 配下の SKILL.md を {domain}__{capability} で配備する。
    local cap_dir cap dest name
    for cap_dir in "$domain_dir"*/; do
      [[ -d "$cap_dir" ]] || continue
      cap=$(basename "$cap_dir")
      [[ -z "$cap" ]] && continue
      [[ -f "$cap_dir/SKILL.md" ]] || continue
      name="${domain}__${cap}"
      [[ -n "$only_name" && "$only_name" != "$name" ]] && continue
      dest="$out_skills/$name"
      mkdir -p "$dest"
      cp -R "$cap_dir"/* "$dest"/ 2>/dev/null || true
      [[ -n "$write_marker" ]] && _asc_write_skill_marker "$dest"
      n_skill=$((n_skill+1))
    done
  done

  echo "$n_skill"
}

# list_owned_skill_entries <src_skills_dir>
#   正本 skills ルートから、パッケージが配備先に作る **所有 skill エントリ** を
#   `name<TAB>src_skill_md_path` の形式で 1 行 1 エントリ列挙する（命名規約
#   {domain}__{capability}・ドメイン直下 {domain} の単一定義）。第2列の正本 SKILL.md パスは
#   由来判定（is_owned_skill_dir）の name 一致フォールバックで参照する。
#   deploy_skills_impl と**同じ走査規則**で算出する（drift 防止のため命名はこの 1 ファイルに集約）。
list_owned_skill_entries() {
  local src_skills="$1"
  [[ -d "$src_skills" ]] || return 0

  local domain_dir domain cap_dir cap
  for domain_dir in "$src_skills"/*/; do
    [[ -d "$domain_dir" ]] || continue
    domain=$(basename "$domain_dir")
    [[ -z "$domain" ]] && continue

    # ドメイン直下に SKILL.md があるケース（例: agent/）は {domain} を所有名とする。
    if [[ -f "$domain_dir/SKILL.md" ]]; then
      printf '%s\t%s\n' "$domain" "$domain_dir/SKILL.md"
    fi

    # capability 配下の SKILL.md を持つものは {domain}__{capability} を所有名とする。
    for cap_dir in "$domain_dir"*/; do
      [[ -d "$cap_dir" ]] || continue
      cap=$(basename "$cap_dir")
      [[ -z "$cap" ]] && continue
      [[ -f "$cap_dir/SKILL.md" ]] || continue
      printf '%s\t%s\n' "${domain}__${cap}" "$cap_dir/SKILL.md"
    done
  done
}

# list_owned_skill_names <src_skills_dir>
#   所有 skill エントリ名の集合を 1 行 1 名で列挙する（後方互換の薄いラッパー）。
#   list_owned_skill_entries の第1列と完全一致する（命名の単一正本を維持）。
#   用途: uninstall の対称除去等で「名前だけ」欲しい既存呼び出しの出力互換を保つ。
list_owned_skill_names() {
  list_owned_skill_entries "$1" | cut -f1
}

# sync_skills_selective <src_skills_dir> <dest_root>
#   <dest_root>（.claude/skills・.cursor/skills）を**丸ごと rm -rf せず**、所有エントリごとに
#   由来判定（is_owned_skill_dir）を評価し、**由来マーカーで所有を確認したエントリ（または不在）
#   のみ**削除→再配備＋マーカー付与する。マーカー無し・正本 name とも不一致の同名ディレクトリ
#   （＝ユーザー自作スキル）は削除も上書きもせず、警告して保持・スキップする（fail-closed な破壊・
#   fail-open な配備）。命名/所有集合/由来判定の単一定義は本ファイルに集約。
sync_skills_selective() {
  local src_skills="$1"
  local dest_root="$2"
  [[ -d "$src_skills" ]] || return 0
  mkdir -p "$dest_root"

  local name src_skill_md dest verdict
  while IFS=$'\t' read -r name src_skill_md; do
    [[ -z "$name" ]] && continue
    dest="$dest_root/$name"
    verdict="$(is_owned_skill_dir "$dest" "$src_skill_md")"
    case "$verdict" in
      owned|legacy_owned|absent)
        # 所有確定（または不在）: 削除→単一エントリ再配備＋マーカー付与（legacy_owned は backfill）。
        rm -rf "${dest_root:?}/$name"
        deploy_skills_impl "$src_skills" "$dest_root" "$name" 1 >/dev/null
        ;;
      collision)
        # 非所有の同名ディレクトリ: 誤削除防止のため保持し、この名前のパッケージスキルは配備しない。
        echo "警告: $dest はパッケージ所有マーカーが無く、正本スキルと name も一致しません（ユーザー自作スキルの可能性）。誤削除防止のため保持し、この名前のパッケージスキルは配備しません。競合を解消するには当該ディレクトリをリネームしてください。" >&2
        ;;
    esac
  done < <(list_owned_skill_entries "$src_skills")
}
