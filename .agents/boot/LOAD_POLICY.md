# LOAD_POLICY - いつ何を読むか・どの Skill / どの worker を使うか

> **AI 向け**: 常時ロード廃止。**必要なときだけ**読む・呼ぶ。全部読まない。

---

## 0. 読み込み順＝優先順位（上書きルール）

**読む順番は優先順位を表す。** 同じテーマで複数ソースが衝突したときは、**後に読んだものが勝つ**（後勝ち）。

明示的な優先順位（強い順）:

1. **AGENTS**（共通ルール・規約入口）
2. **CORE**（絶対制約）
3. **TOOLS**（利用可能ツール）
4. **ROLE**（その人格の定義・worker）
5. **USER**（ユーザー情報）
6. **MEMORY**（過去の記憶）

**衝突時のルール**:

- 同一テーマで複数ソースが競合したときは、上記の順で**番号の小さい（強い）方が勝つ**。後勝ちと矛盾する場合は、本優先順位表を優先する。
- **サブエージェント**は例外なく、**親（メイン）が渡した Task Contract（作業契約）が最優先**。サブのコンテキスト内では契約の制約が rules より優先する。
- **MEMORY は「参照」であって「規則」ではない**。規則は `rules/` および CORE / AGENTS にのみ置く。memory に書いた内容で振る舞いを強制しない。

ルール同士の衝突の解釈は [CORE 4.5 衝突時の優先順位](./CORE.md) に従う。

---

## 1. メインが最初に読むもの（常時）

- [CORE.md](./CORE.md) … 絶対制約
- 本ファイル（LOAD_POLICY.md）… 以降の読み方・委譲先のルール

---

## 2. 条件に応じて読むもの

- フェーズ進行・提出物・DoD の詳細 → [サブエージェント抜かし防止.md](../rules/サブエージェント抜かし防止.md)
- 委譲の入出力仕様 → [boot/EXECUTION_CONTRACT.md](./EXECUTION_CONTRACT.md)
- 記憶の 2 層・サニタイズ（memory/raw と memory/curated）→ [boot/MEMORY_POLICY.md](./MEMORY_POLICY.md)
- 誰が何を書けるか（書記以外の logs/・DB 書込禁止）→ [capabilities/POLICY.md](../capabilities/POLICY.md)
- ログの記録ルール・書記への委譲 → [書記役とログ委譲.md](../scribe/書記役とログ委譲.md)
- ログ保存先・スキーマ → [ワークフローログ_SQLiteスキーマ.md](../ledger/ワークフローログ_SQLiteスキーマ.md)、[ledger/README.md](../ledger/README.md)
- レビュー時 → [レビュールール.md](../rules/レビュールール.md)
- その他ルール（実行・コーディング・ドキュメント・テスト等）→ 必要になったら [AGENTS.md](../../AGENTS.md) の参考資料から該当ファイルを参照

---

## 3. 委譲時に使う Skill（1 回 1 つ）

- **サブにタスクを投げるとき** → [skills/agent/delegate_to_sub.md](../skills/agent/delegate_to_sub.md) を**唯一の入口**として読み、Task / Constraints / OutputSpec を組み立ててから委譲する。**直接サブを呼ばない。**
- **最小読込保証**: サブに渡すコンテキストは [boot/SUBAGENT_PACK.md](./SUBAGENT_PACK.md) の**注入順序**で組み立てる（SUBAGENT_MINIMUM → TOOLS → 役割定義 → Task payload）。含めないとサブ側でルールが強制されず破綻する。

---

## 4. フェーズ → worker（誰に委譲するか）

**delegate_to_sub の固定 JSON では role が 5 値**（implementer | reviewer | tester | auditor | scribe）のみ。workers の 6 人格とは次の対応で統一する: 要件BDDリード・総合レビューリード → `reviewer`。実装者 → `implementer`。テスト者 → `tester`。監査者 → `auditor`。書記 → `scribe`。詳細は [delegate_to_sub の「role と workers 6 人格の対応」](../skills/agent/delegate_to_sub.md) を参照。

| フェーズ | 委譲先（worker） | 参照 |
|----------|------------------|------|
| 01 要件定義・BDD | 要件BDDリード | [workers/01_要件BDDリード.md](../workers/01_要件BDDリード.md) |
| 02 設計・実装・テスト | 実装者・テスト者（タスクに応じて） | [workers/03_実装者.md](../workers/03_実装者.md)、[workers/04_テスト者.md](../workers/04_テスト者.md) |
| 03 実装計画・監査 | 監査者 | [workers/05_監査者.md](../workers/05_監査者.md) |
| 壁打ち・04 総合レビュー | 総合レビューリード | [workers/02_総合レビューリード.md](../workers/02_総合レビューリード.md) |
| **ログ記録（毎回）** | **書記** | [workers/06_書記.md](../workers/06_書記.md)、[書記役とログ委譲.md](../scribe/書記役とログ委譲.md) |

各サブ実行後は必ず書記にログ項目を委譲し、トレーサビリティを確保する。

---

## 5. サブに渡すコンテキスト

- **必ず含める**: [SUBAGENT_PACK.md](./SUBAGENT_PACK.md) の順序で連結（SUBAGENT_MINIMUM → TOOLS → 役割 1 つ → 作業契約）。サブのコンテキストを毎回同じ形にする。
- **ホワイトリスト方式**: 「渡さない」だけにせず、**「このロールにはこれだけ渡す」** を [workers/README のホワイトリスト](../workers/README.md) で固定する。
- サブに渡すコンテキストは、EXECUTION_CONTRACT と delegate_to_sub で定めた範囲および上記ホワイトリストを超えない。

---

## 6. 禁止

- **全部読むな。** 上記「条件に応じて読む」は、その条件が成立したときだけ読む。
