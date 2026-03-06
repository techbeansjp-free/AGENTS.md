# Standard 構成例

**導入レベル**: Standard — 通常の開発フローで使う推奨構成。**コピペで導入可能。**

---

## コピペ手順（そのまま実行可能）

既存プロジェクトの場合は先に `.workflow/00_システム理解.md` を作成し、システム概要を記載してから 00_要求定義 に進む。

プロジェクトルートで次を実行してください。`AGENTS-spec` はこのリポジトリのルートのパスに置き換えてください。

```bash
# 1. AGENTS.md を置く
cp AGENTS-spec/COPY_TO_PROJECT_ROOT_AGENTS.md ./AGENTS.md

# 2. .agents 一式をコピー（boot, platforms, workers, skills 含む）
cp -r AGENTS-spec/.agents ./

# 3. .workflow/templates をコピー（issue 開始時にここから 00_要求定義 等をコピーする）
mkdir -p .workflow
cp -r AGENTS-spec/.workflow/templates .workflow/

# 4. 新規 issue を 1 本作る例
ISSUE_DIR=".workflow/$(TZ=Asia/Tokyo date +%Y%m%d_%H%M%S)_my_issue"
mkdir -p "$ISSUE_DIR"
cp .workflow/templates/00_要求定義.md "$ISSUE_DIR/"
cp .workflow/templates/01_要件定義.md "$ISSUE_DIR/"
cp .workflow/templates/02_設計.md "$ISSUE_DIR/"
cp .workflow/templates/03_実装計画.md "$ISSUE_DIR/"
# 実装後に 04_review.md を templates からコピーして使用
```

5. **AI に「agents に従って、.workflow/ の当該 issue から 00_要求定義を読んで進めて」と指示する。**

---

## 含まれるもの（Minimal ＋ 以下）

| 対象 | コピー元 |
|------|----------|
| .agents/workers/ | `AGENTS-spec/.agents/workers/`（.agents 一式に含まれる） |
| .agents/skills/ | `AGENTS-spec/.agents/skills/`（同上） |
| .workflow/templates/ | `AGENTS-spec/.workflow/templates/` |

## このレベルに含まれないもの

- scribe / ledger（workflow.db）→ [advanced/](../advanced/)
- .review/、GitHub/CI テンプレート → advanced
