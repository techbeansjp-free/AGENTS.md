# PLAN: consumer project固有ポリシー（`.agent-skill-chain/project/`）の作成導線・雛形が皆無で導入時に設定方法が分からない

- Issue: `ISSUE-586`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素（`project-policy-scaffold`・`project-policy テンプレート資産`・`init` 拡張・`docs/PROJECT_POLICY.md`）を、以下の変更単位に分割して実装する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `project-policy テンプレート資産の追加` | `.agent-skill-chain/templates/project-policy/manifest.yaml`（`project.id` を `__PROJECT_ID__` プレースホルダにしたコメント付き雛形。`.agent-skill-chain/schemas/project-policy.schema.yaml` の必須フィールドを過不足なく満たす）と `.agent-skill-chain/templates/project-policy/RULES.md`（対応する記述例）を新規追加する | `AC-1, AC-2` | なし |
| 2 | `project-policy-scaffold の新設` | `src/lib/project-policy-scaffold.ts` を新設し、`.agent-skill-chain/project/manifest.yaml` の存在検査、不在時のみの `__PROJECT_ID__` 置換＋`RULES.md`→`manifest.yaml`の順での書込み、`dryRun` 時の計画結果算出（書込みなし）を実装する。所有権記録（`src/lib/ownership-record.ts`）へは一切登録しない。単体テストで、(a) 両ファイル不在時に両方生成される、(b) `manifest.yaml` 存在時は完全no-op（`RULES.md` の内容も変更しない）になる、(c) `dryRun: true` 時は一切書込みが起きない、の3ケースを検証する | `AC-1, AC-2, AC-6` | `#1` |
| 3 | `init への組み込み` | `src/commands/init.ts` の既存アセット複製処理の後段で `project-policy-scaffold` を1回呼び出し、結果（作成／既存のため変更なし）を summary へ追記する。実行結果に関わらず `docs/PROJECT_POLICY.md` とスキーマパスへの案内文言を summary へ追加する。`test/integration/init.test.ts` に、新規導入時に `.agent-skill-chain/project/manifest.yaml`・`RULES.md` が作成されること、既に `manifest.yaml` が存在する状態で再実行しても内容が変更されないこと（AC-6）、`--dry-run` 時は実ファイルが作成されないことを検証する統合テストを追加する | `AC-1, AC-2, AC-6` | `#1, #2` |
| 4 | `docs/PROJECT_POLICY.md の新規作成` | `.agent-skill-chain/project/` の目的・スキーマ必須フィールドの解説・`manifest.yaml`＋`RULES.md` を組み合わせた完結した最小具体例（AC-2 で検証する内容そのものを転記してよい）・`upgrade`/`uninstall` の不可侵/保持の既存不変条件を自己完結して記載する | `AC-5` | なし（`#1〜#3` と並行実施可） |
| 5 | `upgrade/uninstall 非干渉の回帰テスト追加` | 既存テスト（`upgrade`・`uninstall` のテストスイート）に、`init` で `.agent-skill-chain/project/manifest.yaml` を生成した後、その内容を独自の値に書き換え、`upgrade`（`--dry-run` 無し）を実行しても内容が一切変更されないこと（AC-3）、`uninstall`（`--dry-run` 無し）を実行しても `.agent-skill-chain/project/` 配下が削除されず保持されること（AC-4）を検証するケースを追加する。既存の `NAMESPACED_ENTRIES` 定義・`upgrade`/`uninstall` の実装コードは変更しない（回帰確認のみ） | `AC-3, AC-4` | `#3`（scaffold生成済みの状態が前提） |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
