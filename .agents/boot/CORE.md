# CORE - 絶対制約（サブエージェント運用 MVP）

> **AI 向け**: メイン・サブを問わず常に守る MUST / MUST NOT。サブエージェント基盤で動かす前提。思想・長文は書かず、ここでは制約のみ。

---

## 1. 入口と進行

- **解釈**: 本規約で `.workflow/` が指すパスは、**規約の入口である AGENTS.md が置かれているディレクトリ（プロジェクトルート）** 直下の `.workflow/` とする。AGENTS-spec をサブフォルダとしてコピーした場合は、プロジェクトルートに AGENTS.md を置き、そのルートの `.workflow/` を使用する。
- **MUST**: すべての対応は `.workflow/{YYYYMMDD_HHMMSS_issue_name}/00_要求定義.md` から開始する。
- **MUST**: フェーズを飛ばさない。順序は 00 → 01 → 02 → 03 → 4.5 ドキュメント徹底レビュー（必須）→ 実装 → 04_review。各フェーズの提出物が揃うまで次に進まない。詳細は [サブエージェント抜かし防止](../rules/サブエージェント抜かし防止.md)。
- **MUST**: メインは本 CORE と [LOAD_POLICY](LOAD_POLICY.md) を最初に読む。常時ロードは廃止し、必要なときだけ LOAD_POLICY に従って他のファイルを読む。

---

## 2. 委譲（メイン → サブ）

**必ず守る運用**（この 3 点を破ると、実質的に人格・記憶を渡しているのと同じになる）:

1. **サブに渡すコンテキストは「① + ③ + そのタスクの Skill 1 つ + 作業契約」まで**。例外は [workers/README のホワイトリスト](../workers/README.md) に閉じる（例: 書記＝ログ仕様・保存先だけ）。
2. **背景は原則書かない**。必要なら 1〜2 文で最小限に留める。
3. **USER.md 全文・memory 全文は渡さない**。メインが要約し、必要な分だけ Constraints に載せる。

- **MUST**: サブエージェントの呼び出しは [skills/agent/delegate_to_sub](../skills/agent/delegate_to_sub.md) を**唯一の入口**とする。**直接呼び出し禁止**。メインはサブを呼ぶ前に、サブのコンテキストに [SUBAGENT_MINIMUM](SUBAGENT_MINIMUM.md) を**必ず含める**（最小読込保証。含めないとルールが強制されず破綻する）。
- **MUST**: フェーズごとの作業は workers に Task / Constraints / OutputSpec の 3 ブロックのみで委譲する。共通 I/F は [EXECUTION_CONTRACT](EXECUTION_CONTRACT.md)、人格一覧は [workers/README](../workers/README.md)。
- **MUST NOT**: サブに背景・経緯・ユーザー情報の長文を渡さない。Constraints の「前提」は最大 5 行に要約する。
- **MUST**: 委譲手順は [skills/agent/delegate_to_sub](../skills/agent/delegate_to_sub.md) に従う。

---

## 3. トレーサビリティ（誰が何をしたか）

- **MUST**: 各サブの実行後に、メインはログ項目を書記サブに委譲する。トレーサビリティは最初から必須。ログ記録は書記のみ。詳細は [書記役とログ委譲](../scribe/書記役とログ委譲.md)。
- **MUST NOT**: 書記以外の人格が `.workflow/**/logs/` や `workflow.db` に直接書かない。詳細は [capabilities/POLICY](../capabilities/POLICY.md)。

---

## 4. 出力形式

- **MUST**: 応答は常に SILENT MODE（会話は最大15行、先頭に `🧠 Mode: SILENT MODE`）。ユーザーが「詳細を」「全文を」と明示した場合を除く。
- **MUST**: ドキュメントと実装を常に同期させる。変更したら必ず該当 md を更新する。

---

## 4.5 衝突時の優先順位

ルール同士が矛盾したときは、本節の優先順位に従う。

- **監査・証跡・ログ**: 詳細を優先する（簡潔化より証跡の完全性）。
- **通常の会話出力**: 簡潔を優先する（SILENT MODE）。
- 上記が衝突する場合は、**監査・証跡・ログの詳細優先**に従う。

---

## 5. 参照

- サブの最小読込保証・注入順序: [SUBAGENT_MINIMUM](SUBAGENT_MINIMUM.md)、[SUBAGENT_PACK](SUBAGENT_PACK.md)
- 何をいつ読むか・どの Skill を呼ぶか: [LOAD_POLICY](LOAD_POLICY.md)
- 実行契約（入出力 3 ブロック）: [EXECUTION_CONTRACT](EXECUTION_CONTRACT.md)
- 委譲の唯一の入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 6 人格の IN/OUT: [workers/README](../workers/README.md)
- 書記・ログ: [書記役とログ委譲](../scribe/書記役とログ委譲.md)、[ledger/README](../ledger/README.md)
