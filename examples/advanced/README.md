# Advanced 構成例

**導入レベル**: Advanced — 大規模・厳格運用向け（ログ一元化・監査・CI）。

---

## コピペ手順（そのまま実行可能）

Standard の手順を実行したうえで、次を追加してください。

```bash
# Standard の 1〜3 が完了している前提

# 5. scribe / ledger は .agents に含まれる（cp -r AGENTS-spec/.agents で済んでいる）
# 6. workflow.db を使う場合: .gitignore に追加
echo "workflow.db" >> .gitignore

# 7. （任意）.review をコピーする場合（規約全体のレビュー履歴用）
cp -r AGENTS-spec/.review ./

# 8. （任意）GitHub/CI テンプレートを使う場合
# AGENTS-spec/.workflow/templates/github/ を参照してプロジェクトに合わせて配置
```

**workflow.db**: 初回は空でよい。書記サブがログを記録するときに [ledger/schema.sql](../../.agents/ledger/schema.sql) で DB を作成する。SQLite を使わない場合は [CONTRACT §5](../../.agents/scribe/CONTRACT.md) の暫定記録（memo）で代替可能。

---

## 含まれるもの（Standard ＋ 以下）

| 対象 | 説明 |
|------|------|
| .agents/scribe/ | 書記役とログ委譲（.agents に含まれる） |
| .agents/ledger/ | workflow.db スキーマ・保存先（同上） |
| .review/ | 規約全体のレビュー履歴（任意でコピー） |
| .workflow/templates/github/ | GitHub/CI 用テンプレート（必要に応じて利用） |

## 想定ユーザー

- ログの一元化と監査が必要なチーム
- 証跡を DB で残したい運用
- 規約そのものの変更履歴を .review/ で管理したい場合
