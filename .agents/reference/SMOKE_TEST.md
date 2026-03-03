# スモークテスト（1 回通れば運用上ほぼ壊れない）

> 次の 3 ケースだけ通れば、強制構造が効いているとみなせる。

---

## ケース A: 実装者サブを呼ぶ → 結果だけ返る（ファイルを書かない）

- **手順**: メインが delegate_to_sub を経由し、実装者サブに「〇〇の設計案を 1 文で返せ」など、**ファイルを書かせない**タスクを渡す。
- **期待**: サブは結果（テキスト）だけを返し、`.workflow/**/logs/` やその他リポジトリに**ファイルを書かない**。
- **確認**: サブ実行前後で、意図しない新規・変更ファイルが増えていないこと。

---

## ケース B: 書記サブを呼ぶ → `.workflow/*/logs/` にだけ 1 ファイル書く

- **手順**: メインが書記サブに、[scribe/CONTRACT](../scribe/CONTRACT.md) のスキーマに沿ったログ項目 1 件を渡す。
- **期待**: 書記は `.workflow/{issue}/logs/` に**1 ファイルだけ**作成する（または指定 SQLite に 1 行 INSERT）。他パスに書かない。
- **確認**: `logs/` 配下に想定どおり 1 ファイルが増えていること。それ以外に変更がないこと。

---

## ケース C: 書記に「logs 以外に書け」と指示 → 拒否する

- **手順**: 書記サブに対して「`README.md` に追記して」など、**logs 以外に書く**よう指示する（テスト用）。
- **期待**:
  - **Claude Code**: PreToolUse ガードが効いていれば、**ツール呼び出しが拒否**される（事故っても書けない）。
  - **Cursor**: プロンプト・役割定義で「書記は logs 以外に書かない」と明記していれば、**拒否する旨を返す**（運用で防ぐ）。
- **確認**: README 等が変更されていないこと。拒否メッセージまたはエラーが出ていること。

---

## 参照

- 入口一本化: [skills/agent/delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 書記契約: [scribe/CONTRACT](../scribe/CONTRACT.md)
- Claude Write ガード: [enforcement/claude/](../enforcement/claude/README.md)
- Cursor 強制: [enforcement/cursor/](../enforcement/cursor/README.md)
