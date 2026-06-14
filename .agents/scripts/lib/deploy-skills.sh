#!/usr/bin/env bash
# deploy-skills.sh — スキル配備ロジックの共有ライブラリ（命名規約 {domain}__{capability} の単一正本）。
#
# 責務: 正本 .agents/skills/{domain}/{capability}/ を、配備先 {domain}__{capability}/ で配備する
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

# deploy_skills_impl <src_skills_dir> <out_skills_dir>
#   <src_skills_dir>  : 正本 skills ルート（例: .agents/skills）
#   <out_skills_dir>  : 配備先ルート（例: .adapters/claude/skills, .claude/skills, .cursor/skills）
#   配備先は呼び出し側で事前にクリーンしてよい（setup は rm -rf する）。本関数は mkdir -p のみ行う。
#   配備件数を標準出力へ返す（呼び出し側がメッセージを整形する）。
deploy_skills_impl() {
  local src_skills="$1"
  local out_skills="$2"
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
      mkdir -p "$out_skills/$domain"
      cp "$domain_dir/SKILL.md" "$out_skills/$domain/SKILL.md"
      [[ -f "$domain_dir/README.md" ]] && cp "$domain_dir/README.md" "$out_skills/$domain/README.md"
      n_skill=$((n_skill+1))
    fi

    # capability 配下の SKILL.md を {domain}__{capability} で配備する。
    local cap_dir cap dest
    for cap_dir in "$domain_dir"*/; do
      [[ -d "$cap_dir" ]] || continue
      cap=$(basename "$cap_dir")
      [[ -z "$cap" ]] && continue
      [[ -f "$cap_dir/SKILL.md" ]] || continue
      dest="$out_skills/${domain}__${cap}"
      mkdir -p "$dest"
      cp -R "$cap_dir"/* "$dest"/ 2>/dev/null || true
      n_skill=$((n_skill+1))
    done
  done

  echo "$n_skill"
}
