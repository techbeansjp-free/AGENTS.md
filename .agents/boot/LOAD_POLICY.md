# LOAD_POLICY - いつ何を読むか・どの Skill / どの worker を使うか

> **AI 向け**: 常時ロード廃止。**必要なときだけ**読む・呼ぶ。全部読まない。

---

## 0. 読み込み順＝優先順位（上書きルール）

**優先順位は以下の表で固定する。** 同じテーマで複数ソースが衝突したときは、**番号の小さい（強い）方が勝つ**。

明示的な優先順位（強い順）:

1. **AGENTS**（共通ルール・規約入口）
2. **CORE**（絶対制約）
3. **TOOLS**（利用可能ツール）
4. **ROLE**（その人格の定義・worker）
5. **USER**（ユーザー情報）
6. **MEMORY**（過去の記憶）

**衝突時のルール**:

- 同一テーマで複数ソースが競合したときは、上記の順で**番号の小さい（強い）方が勝つ**。
- **サブエージェント**は例外なく、**親（メイン）が渡した Task Contract（作業契約）が最優先**。サブのコンテキスト内では契約の制約が rules より優先する。
- **MEMORY は「参照」であって「規則」ではない**。規則は CORE / AGENTS / WORKFLOW / RULES にのみ置く。memory に書いた内容で振る舞いを強制しない。

**ソース間の優先順位**は本節で定義する（上記の番号の小さい方が勝つ）。**出力方針**（監査・証跡の詳細優先 vs 会話の簡潔優先）の衝突は [CORE 4.5 衝突時の優先順位](./CORE.md) を参照する。

---

## 1. メインが最初に読むもの（常時・飛ばし禁止）

**実行前契約**: 以下の 4 つを読了するまで、いかなるワークフロー・委譲・成果物作成も行ってはならない。読了したら応答冒頭で短く確認すること（CORE §0 参照）。

- [CORE.md](./CORE.md) … 絶対制約
- 本ファイル（LOAD_POLICY.md）… 以降の読み方・委譲先のルール
- [WORKFLOW.md](../WORKFLOW.md) … フェーズ順・必須成果物・DoD・監査観点（思想を守るために必須）
- [CONCEPTS.md](../CONCEPTS.md) … 思想・方法論・哲学・観点・フォーマット（あなたの「守らせる」の根拠）

判断時の問い（観点）は CONCEPTS §4 にあり、上記読了で常時参照可能になる。詳細は条件に応じて 2. の該当ファイルを読む。

---

## 2. 条件に応じて読むもの（トリガー別）

§1 読了後に、次のトリガーが成立したときは該当ファイルを読む。このときはこのファイルを読む、を 1 対 1 で対応させる。

| トリガー | 読むファイル |
|----------|--------------|
| **委譲前**（Task/Constraints/OutputSpec を組み立てる前） | [EXECUTION_CONTRACT.md](./EXECUTION_CONTRACT.md)、[delegate_to_sub.md](../skills/agent/delegate_to_sub.md) |
| **フェーズ進行・提出物・DoD の詳細**（§1 の WORKFLOW で足りない場合） | [WORKFLOW.md](../WORKFLOW.md)、[RULES.md](../RULES.md) |
| **フェーズ完了時・次に進む前** | [RULES.md 確認義務](../RULES.md) の 3 点（成果物照合・テスト実施証跡・ログ委譲）。満たすまで次に進まない。 |
| **ログ記録時**（書記へ委譲する前） | [書記役とログ委譲.md](../scribe/書記役とログ委譲.md)、[CONTRACT.md](../scribe/CONTRACT.md)、[ワークフローログ_SQLiteスキーマ.md](../ledger/ワークフローログ_SQLiteスキーマ.md) |
| **誰が何を書けるか・ログ保存先** | [capabilities/POLICY.md](../capabilities/POLICY.md)、[ledger/README.md](../ledger/README.md) |
| **記憶の参照・サニタイズ** | [MEMORY_POLICY.md](./MEMORY_POLICY.md) |
| **監査時** | 当該 issue の 00_要求定義（ゴール）。[WORKFLOW.md](../WORKFLOW.md) の監査観点。監査は監査者サブに委譲し、メインはその結果に基づき完了判定を行う。03_実装計画の作成は実装者・テスト者に委譲し、完了後に監査者に 03 の監査を委譲する。 |
| **レビュー時** | [RULES.md](../RULES.md)（レビュー節） |
| **テスト作成時**（単体・結合・E2E を書くとき） | [テストコード_BDD形式.md](../テストコード_BDD形式.md)（Given/When/Then インライン必須）、[RULES.md](../RULES.md) 実装チェックリスト |
| **実行基盤に応じて platform 差分を参照するとき** | [platforms/README.md](../platforms/README.md)、該当する [platforms/cursor.md](../platforms/cursor.md) または [claude_code.md](../platforms/claude_code.md) または [openai.md](../platforms/openai.md) または [gemini.md](../platforms/gemini.md) |
| **その他**（実行・コーディング・ドキュメント・テスト等） | [AGENTS.md](../../AGENTS.md) の参考資料から該当ファイルを参照 |

---

## 3. 委譲時に使う Skill（1 回 1 つ）

- **サブにタスクを投げるとき** → [skills/agent/delegate_to_sub.md](../skills/agent/delegate_to_sub.md) を**唯一の入口**として読み、Task / Constraints / OutputSpec を組み立ててから委譲する。**直接サブを呼ばない。**
- **最小読込保証**: サブに渡すコンテキストは [boot/SUBAGENT.md](./SUBAGENT.md) の注入順序で組み立てる。含めないとサブ側でルールが強制されず破綻する。

---

## 4. フェーズ → worker（誰に委譲するか）

**delegate_to_sub の固定 JSON では role が 5 値**（implementer | reviewer | tester | auditor | scribe）のみ。workers の 6 人格とは次の対応で統一する: 要件BDDリード・総合レビューリード → `reviewer`。実装者 → `implementer`。テスト者 → `tester`。監査者 → `auditor`。書記 → `scribe`。詳細は [delegate_to_sub の「role と workers 6 人格の対応」](../skills/agent/delegate_to_sub.md) を参照。

各委譲では、当該フェーズの達成すべき結果を Task に 1 文で書く。

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

- **必ず含める**: [SUBAGENT.md](./SUBAGENT.md) の順序で連結。サブのコンテキストを毎回同じ形にする。
- **ホワイトリスト方式**: 「渡さない」だけにせず、**「このロールにはこれだけ渡す」** を [workers/README のホワイトリスト](../workers/README.md) で固定する。
- サブに渡すコンテキストは、EXECUTION_CONTRACT と delegate_to_sub で定めた範囲および上記ホワイトリストを超えない。

---

## 6. 禁止

- **全部読むな。** 上記「条件に応じて読む」は、その条件が成立したときだけ読む。
