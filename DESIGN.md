# DESIGN: npm testの間欠的失敗の原因調査・再発防止（テスト実行ログ保全の整備）

- Issue: `ISSUE-236`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

CI の `npm test` 出力を終了状態を変えずにファイルへ集約し、常時 artifact として保存する。独立検証のログ保存・記録手順は `TEST_POLICY.md` に集約する。テスト並列度、テスト対象、製品コードは変更しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | CI test-log step と always upload step | stdout/stderr を単一ログへ記録し、成功・失敗の両方で upload |
| `AC-2` | `TEST_POLICY.md` の独立検証手順 | 保存コマンド、`VALIDATION.md` の証跡内容を規定 |
| `AC-3` | `TEST_POLICY.md` の失敗時エスカレーション | Issue #236 追記と四つの原因類型を含む follow-up を規定 |

## 責務・境界

### コンポーネント構成

- CI workflow: テストプロセスの stdout/stderr を `tee` でログに複製し、元のテスト終了コードを維持する。
- upload-artifact action: 常時実行し、テスト結果に関係なくログを Actions artifact として保存する。
- テストポリシー: 手動の独立検証におけるログ保存、証跡、失敗時の報告を定める。
- 構造テスト: workflow の実行・upload 条件とポリシー内の必須手順を静的に検査する。

### 依存関係

```text
npm test → tee test-execution.log → upload-artifact
独立検証 → 保存済み test-execution.log → VALIDATION.md / Issue #236 / follow-up Issue
```

## 関連ADR

```yaml
related_adrs: []
```

設計判断はこの Issue で提案する `ADR-0008` に記録する。未承認 ADR は構造化参照へ入れず、設計本文に必要な判断を完結して記載する。

## 障害・ロールバック考慮

- 想定される失敗モード: `tee` の導入でテスト失敗が成功扱いになる、ログが存在しないため upload が失敗する、手動手順に証跡が残らない。
- ロールバック手順: workflow とポリシーおよび対応する構造テストの変更を同一 commit で revert する。既存の `npm test` 実行に戻り、プロダクトコードやテスト実行方式には影響しない。
- 影響を受ける既存機能: pull request CI のテスト step、独立検証の手動運用、および Actions artifact 使用量。

## 制約・完了条件・未決事項

- ログ保存はテストの終了コードを隠蔽せず、機密情報を追加しない。
- CI workflow と配布テンプレートの同期を保ち、構造テストと `npm test` を通過することを完了条件とする。
- artifact の保持期間・容量は GitHub の既定に従い、実測で問題が出た場合は別 Issue で扱う。
