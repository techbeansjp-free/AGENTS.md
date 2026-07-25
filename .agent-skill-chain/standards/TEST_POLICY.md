# テストポリシー

> 正本: `AGENTS.md` §不変条件I7

## 不変条件 I7（仕様⇔検証の追跡）

> 全 AC-ID は最低1つの検証方法（`automated|manual|hybrid`）と証跡に対応する。承認後の AC 変更はゲート再通過を強制する。

- 自動化可能な AC は自動テストを必須とする。
- 手動・混合（`manual`/`hybrid`）の場合は、自動化できない理由（`reason`）・検証手順（`procedure`）・実行者または実行エージェント（`executor`）・証跡（`evidence`）を必須とする。
- 検証方法・結果・証跡の記録先は Issue ごとの `.agent-skill-chain/templates/issue/VALIDATION.md`（複製後に記入）であり、そのスキーマは `.agent-skill-chain/schemas/validation-report.schema.yaml` を正本とする。フィールド名は `ac_id` / `verification.mode` / `verification.result` / `verification.reason` / `verification.procedure` / `verification.executor` / `evidence` / `regression` に統一し、独自の別名フィールドを作らない。
- 孤児 AC（検証記録の無い AC-ID）・孤児テスト参照（存在しない AC-ID を指す証跡）は許可しない。検査は `.agent-skill-chain/ci/verify-ac-coverage.sh` が担う。
- 承認済み SPEC.md の AC が変更された場合、当該 Issue の全ゲート（またはそれ以降のゲート）は無効化され、再レビューが要求される（`.agent-skill-chain/schemas/gate-report.schema.yaml` の無効化ルールに従う）。

## 独立検証におけるテスト実行ログの保存

独立検証担当者は `npm test` の標準出力・標準エラー出力を、検証ごとに失われないファイルへ保存する。テスト終了コードを確認できるよう、次の形式で実行する。

```bash
set -o pipefail
npm test 2>&1 | tee test-execution.log
```

- 成功時は `VALIDATION.md` の該当 AC の `evidence` に保存ログのパスを記録する。
- 失敗時は `VALIDATION.md` に保存ログのパスと失敗箇所の抜粋を記録する。
- 間欠的失敗時は Issue #236 にテストファイル名、テストケース名、エラーメッセージ、スタックトレースを追記する。
- 間欠的失敗の follow-up Issue では、タイミング依存、順序依存、リソース競合、非同期処理の race condition を原因候補として評価する。

## テスト適用性マトリクス（3分類）

テストのケイデンス割当は「毎PR/リリース単位/該当Issueのみ」という単純な分類ではなく、変更内容に応じた適用性マトリクス方式を採る。7種のテストカテゴリすべてについて「適用要否の判断」自体を必須とし、該当するものだけを Issue 単位で実行する（判断のスキップは許さない）。

### 常時必須

すべての Issue で無条件に実行する。

- lint / format
- 型検査
- 単体テスト
- 変更範囲の結合テスト
- SAST（静的アプリケーションセキュリティテスト）
- 依存関係・secret スキャン

### 変更内容に応じて Issue 単位で必須

変更内容の種別に応じて、該当する検証を必須とする（適用有無の判断自体は省略しない）。

| 変更種別 | 必須検証 |
|---|---|
| ユーザー操作・画面フロー | E2E、アクセシビリティ、（必要に応じ）ユーザビリティ |
| API・サービス境界 | 契約テスト、結合テスト |
| 認証・認可・秘密情報 | セキュリティテスト、権限境界テスト |
| 性能ホットパス・SLO変更 | 負荷・性能テスト |
| DB migration | migration・rollback・データ整合テスト |
| デプロイ・監視・運用変更 | 運用テスト、障害復旧テスト |
| 外部連携 | sandbox または契約・障害系テスト |

### リリース単位

個別 Issue ではなくリリース（統合）単位で実行する。

- 全体 E2E 回帰
- 該当する非機能テスト
- デプロイ・ロールバック検証

## Given/When/Then インラインマーカーの位置づけ

Given/When/Then のインラインマーカー（コード・テスト内への構造化コメント等）は不変条件ではない。以下のいずれかに該当するプロジェクトのみ、戦術として強制する。

- `.agent-skill-chain/config/agent-skill-chain.yaml` の `bdd.profile` が `strict` に設定されている場合
- Gherkin を採用しているプロジェクトの場合

`bdd.profile: standard`（既定）のプロジェクトでは、SPEC.md の受け入れシナリオを散文としての Given/When/Then 記述（構造化マーカー不要）で記載すれば足りる。この散文形式の受け入れシナリオ自体は、`bdd.profile` の値に関わらず標準として扱う。
