# CORE - 絶対制約（サブエージェント運用 MVP）

> **AI 向け**: メイン・サブを問わず常に守る MUST / MUST NOT。サブエージェント基盤で動かす前提。思想・長文は書かず、ここでは制約のみ。

---

## 1. 入口と進行

- **解釈**: 本規約で `.workflow/` が指すパスは、**規約の入口である AGENTS.md が置かれているディレクトリ（プロジェクトルート）** 直下の `.workflow/` とする。AGENTS-spec をサブフォルダとしてコピーした場合は、プロジェクトルートに AGENTS.md を置き、そのルートの `.workflow/` を使用する。
- **MUST**: すべての対応は `.workflow/{YYYYMMDD_HHMMSS_issue_name}/00_要求定義.md` から開始する。
- **MUST**: フェーズを飛ばさない。順序は 00 → 01 → 02 → 03 → 4.5 ドキュメント徹底レビュー（必須）→ 実装 → 04_review。各フェーズの提出物が揃うまで次に進まない。**サブを使用しない場合も、同じ提出物表・同じ完了条件を満たすこと。** 詳細は [サブエージェント抜かし防止](../rules/サブエージェント抜かし防止.md)。
- **MUST**: フェーズ完了時は、[監査者用工程フロー](../rules/監査者用工程フロー.md) の該当フェーズに応じた確認を [監査者用チェックリスト](../rules/監査者用チェックリスト.md) に沿って実施し、**証跡が満たされるまで次フェーズに進まない**。提出物が存在するだけでは不十分とする。上記確認はメインが証跡ベースで行う。04_review では総合レビューリードへ委譲する際に、04 委譲時の Constraints（チェックリスト観点含む）を満たすこと。
- **MUST**: **進行役（メイン）は [進行役手順](../rules/進行役手順.md) を参照し、各フェーズで当該手順の完了条件を満たすまで次フェーズに進まない。**
- **MUST**: メインは本 CORE と [LOAD_POLICY](LOAD_POLICY.md) を最初に読む。常時ロードは廃止し、必要なときだけ LOAD_POLICY に従って他のファイルを読む。
- **MUST**: メインの責務は**進行役に集中する**。監査の実作業（証跡に基づく合格判定・チェックリスト検証）は**監査者サブに委譲**し、メインは委譲・完了受領・次フェーズ判定を行う。監査委譲時は [監査者用工程フロー](../rules/監査者用工程フロー.md) と [監査者用チェックリスト](../rules/監査者用チェックリスト.md) を参照する。ドキュメント作成・レビュー実施は workers に委譲し、メインは各フェーズの完了を証跡ベースで検証する。
- **MUST**: ユーザーが「サブエージェントと協議」等と明示的に指示しなくても、フェーズごとの作業を**毎回・自律的に**サブエージェント（workers）に委譲する。委譲は [delegate_to_sub](../skills/agent/delegate_to_sub.md) を唯一の入口とする。ログの記録は書記サブに委譲する。委譲なしでメインが単独でドキュメント作成・実装・監査の実作業・ログ記録を行うことは禁止する。**.workflow 配下に成果物ファイル（memo 等）を作成する場合は、ファイル名に YYYYMMDD_HHMMSS_ プレフィックスを付ける。** プレフィックスの日時はファイル作成時にシステムから取得し、日本標準時（JST, UTC+9）を用いる（手入力・推測・記憶は禁止）。日付のみ（YYYYMMDD_）やプレフィックスなしは禁止。

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
- **MUST NOT**: 書記以外の人格が `workflow.db` に直接書かない。書記の保存先は **workflow.db のみ**。`.workflow/**/logs/` は使用禁止・廃止。詳細は [capabilities/POLICY](../capabilities/POLICY.md)。
- **書記サブを呼ばない場合**: メインのみで実行する場合は、[書記役とログ委譲](../scribe/書記役とログ委譲.md) に従い、memo 内の実行ログ（CONTRACT と同様の項目で `.workflow/{issue}/memo/YYYYMMDD_HHMMSS_実行ログ.md` に追記）に暫定記録すること。

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
