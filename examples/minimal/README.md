# Minimal 構成例

**導入レベル**: Minimal — 最小で動かす構成。**コピペで 3 分以内に試せます。**

---

## コピペ手順（そのまま実行可能）

プロジェクトルートで次を実行してください。`AGENTS-spec` はこのリポジトリのルート（AGENTS-spec フォルダ）のパスに置き換えてください。

```bash
# 1. AGENTS.md をプロジェクトルートに置く
cp AGENTS-spec/COPY_TO_PROJECT_ROOT_AGENTS.md ./AGENTS.md

# 2. .agents をコピー（boot と platforms が含まれる）
cp -r AGENTS-spec/.agents ./

# 3. （任意）issue 用フォルダを 1 つ作る
mkdir -p .workflow/20260306_120000_my_first_issue
# 00_要求定義.md は AGENTS-spec/.workflow/templates/00_要求定義.md をコピーして編集
cp AGENTS-spec/.workflow/templates/00_要求定義.md .workflow/20260306_120000_my_first_issue/
```

4. **AI に「agents に従って、.workflow/20260306_120000_my_first_issue の 00_要求定義から進めて」と指示する。**

以上で Minimal 構成で動きます。AI は AGENTS.md → CORE → LOAD_POLICY を読んでから作業します。

---

## 含まれるもの

| 対象 | コピー元 |
|------|----------|
| AGENTS.md | `AGENTS-spec/COPY_TO_PROJECT_ROOT_AGENTS.md` → ルートに `AGENTS.md` として保存 |
| .agents/boot/ | `AGENTS-spec/.agents/boot/` |
| .agents/platforms/ | `AGENTS-spec/.agents/platforms/` |
| 00_要求定義（1 本だけ） | `AGENTS-spec/.workflow/templates/00_要求定義.md` |

## このレベルに含まれないもの

- workers（人格定義）→ [standard/](../standard/) で追加
- .workflow/templates 一式 → standard で追加
- scribe / ledger / .review → [advanced/](../advanced/) で追加
