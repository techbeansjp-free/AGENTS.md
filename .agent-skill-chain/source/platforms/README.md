# platforms — Cursor / Claude Code / Gemini の差分

各プラットフォームの**入口・設定**の差分と、**スキル形式・配置**の差分をまとめる。**workflow/ は phase と templates のみ**とし、プラットフォーム差分は本 platforms/ に集約する。**「いつ何を読むか」の正本は boot/LOAD_POLICY.md。** 本 platforms はスキル形式・配備・ツール別設定、および **PF 固有のモデルティア推奨デフォルト（advisory）** を記載する。

---

## スキル形式・配備方針

スキルの正本とプラットフォーム別コピー方針は [platforms/SKILLS.md](SKILLS.md) に記載する。正本は .agent-skill-chain/source/skills/{domain}/{capability}/、setup で各ツールの skills パスにコピーする。配備先の名前衝突対策（プレフィックス `{domain}__{capability}`）は採用済み。[DESIGN_SYNC_SKILLS_NAMING.md](DESIGN_SYNC_SKILLS_NAMING.md) に設計経緯を記載。

---

## apm パッケージメタデータ

`apm/apm.yml` は [.agent-skill-chain/source/platforms/claude/plugin.json](claude/plugin.json) と同型の「手書き正本」であり、`microsoft/apm`（Agent Package Manager）向けのパッケージメタデータ（`name`/`version`/`description`/`includes` 等）を宣言する。`build-adapters.sh apm` がリポジトリルート `apm.yml` へそのままコピーする。詳細は [docs/maintainer/apm-package.md](../../../docs/maintainer/apm-package.md) を参照。

---

## 入口・設定の差分

| プラットフォーム | 設定の配置 | 備考 |
|------------------|------------|------|
| **Claude Code** | .claude/ を setup で生成。enforcement/claude/ 正本から展開。 | PreToolUse/PostToolUse 等は enforcement/claude/ に正本を置く。 |
| **Cursor** | .cursor/ を setup で生成。enforcement/cursor/ 正本から展開。 | 規約要約・「必ず CORE/LOAD_POLICY を読む」をルールに置く。 |
| **Gemini** | プロジェクト単位の設定が公式で定義されていれば同様に生成。未定義の場合はドキュメント参照＋手動。 | |

---

## スキル形式の差分

- **Claude Code**: [Agent Skills](https://agentskills.io/) 準拠。`.claude/skills/<name>/SKILL.md`。YAML frontmatter（name, description）＋ markdown 本文。`/skill-name` で起動可能。
- **Cursor**: 同じ SKILL.md を `.cursor/skills/` にコピーして利用。形式は Agent Skills に合わせる。
- **Gemini CLI**: `.gemini/skills/` に skill フォルダをコピー。形式は共通。

フォーマットは **SKILL.md（Agent Skills 形式）で統一**する。配置パスだけがツールごとに異なる。詳細は [platforms/SKILLS.md](SKILLS.md) を参照。

---

## 運用

- 詳細は [SETUP.md](../SETUP.md) および setup 脚本を参照する。
- スキルを追加・変更したら、正本（.agent-skill-chain/source/skills/ 配下の SKILL.md）を更新し、setup または sync を再実行して各プラットフォームに反映する。
