# SKILLS.md — プラットフォーム別スキル形式と配備方針

Claude / Cursor / Gemini 等では**スキルの配置パスが異なる**。フォーマットは [Agent Skills](https://agentskills.io/)（SKILL.md + YAML frontmatter）で統一する。**正本は 1 か所・配置だけツール別**。本ファイルは **platforms/** に置き、プラットフォーム差分の責務に含める。

---

## プラットフォーム別の期待パス・フォーマット

| プラットフォーム | 期待パス（スキルが置かれる場所） | 期待フォーマット |
|------------------|----------------------------------|-------------------|
| **Claude Code** | `.claude/skills/<skill-name>/SKILL.md` | Agent Skills（SKILL.md + YAML frontmatter） |
| **Cursor** | `.cursor/skills/<skill-name>/SKILL.md` | 同上 |
| **Gemini CLI** | `~/.gemini/skills/` または `.gemini/skills/` | 同上 |
| **OpenCode / Codex / Kiro** | 各ツールの `skills/` 配下 | 同上 |

正本を 1 か所に持ち、setup または sync スクリプトで各プラットフォームのパスにコピーする。

---

## .agents の対応方針

1. **正本の場所**: `.agent-skill-chain/source/skills/{domain}/{capability}/` に **SKILL.md** を置く。Agent Skills 形式（YAML frontmatter: name, description ＋ 本文に手順・制約・成果物）。**README.md** は索引・詳細用として残す。
2. **名前規則**: 正本の capability 名は小文字・ハイフンのみ。例: `write-bdd`, `extract-goals`。**配備先**のディレクトリ名は `{domain}__{capability}`（例: `requirements__write-bdd`）。ツールのスラッシュコマンドは配備先のディレクトリ名に依存する場合がある（例: `/requirements__write-bdd`）。詳細は [DESIGN_SYNC_SKILLS_NAMING.md](DESIGN_SYNC_SKILLS_NAMING.md)。
3. **配布**: setup 脚本（scripts/setup.sh の sync_skills）で、`.agent-skill-chain/source/skills/{domain}/{capability}/` を対象プラットフォームの `skills/{domain}__{capability}/` に**コピー**する。例: Claude 用なら `.claude/skills/requirements__write-bdd/`。同名 capability の domain 間衝突を防ぐためプレフィックスを採用済み。
4. **Commands**: command（skill chain）の正本は .agents 内の commands/*.md。プラットフォームにコピーするのは**各 capability の SKILL.md**。command 実行時は run_command と commands/{name}.md を読む運用とする。
5. 各 capability ディレクトリに **README.md** と **SKILL.md** の両方を置く。正本は 1 か所。プラットフォームへ配布するときは SKILL.md を含むディレクトリを各ツールの skills パスにコピーする。

---

## 成果物テンプレートとの対応

成果物のテンプレート（00/01/02/03/04）は [workflow/TEMPLATES.md](../workflow/TEMPLATES.md) に記載する。各 capability の SKILL.md の本文に「成果物の形式」「参照: TEMPLATES.md」を書く。

---

## 参照

- [pm-skills](https://github.com/phuryn/pm-skills)
- [Claude Code - Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Agent Skills](https://agentskills.io/)
- platforms/README.md（入口・設定の差分）
