# PLAN: issue_sync の既定値を enabled: true へ変更する（GitHubモードではGitHub Issueを正本とすべき）

- Issue: `ISSUE-567`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 恒久設定ファイルの既定値変更 | `.agent-skill-chain/config/agent-skill-chain.yaml` の `issue_sync.enabled` を `false` から `true` へ変更し、直前のコメント（②の既定は無効・オプトインという説明）を「既定は有効・明示的な `false` でオプトアウト可能」という説明に書き直す | `AC-1` | なし |
| 2 | 配布用テンプレートの既定値変更 | `.agent-skill-chain/templates/standard/agent-skill-chain.yaml` の `issue_sync.enabled` を `false` から `true` へ変更する（コメントも変更単位1と同じ趣旨に合わせる） | `AC-2` | なし |
| 3 | スキーマ記述例の整合 | `.agent-skill-chain/schemas/config.schema.yaml` の `examples`（`coordination.backend: github` の例）内 `issue_sync: {enabled: false, ...}` を `{enabled: true, ...}` へ書き換える。型定義・`required`・`additionalProperties` 等の構造は変更しない | `AC-3` | なし |
| 4 | 既存プロジェクト非破壊の確認 | `agent-skill-chain upgrade` が `config/agent-skill-chain.yaml` を一般アセット同期から除外していること（`src/commands/upgrade.ts` の既存分岐）を確認し、既存の `test/integration/upgrade.test.ts` の関連テストが変更単位1・2適用後も成功することを確認する。新規のプロダクションコード変更は行わない | `AC-4` | `1`, `2` |
| 5 | ADR-0021 の改定 | `docs/adr/ADR-0021-github-issue-sync-full-text-content-canonical.md` の D-2（適用範囲・既定値）・D-4 項目6（既存プロジェクトの移行）・D-5（`enabled` の説明）・Consequences 該当箇所を、新しい既定値（GitHubモードでは既定 `true`、明示的な `false` でオプトアウト可能）に合わせて改定する。`status` は `proposed` のまま変更しない | `AC-5` | なし |
| 6 | 規範文書・利用者向け文書の整合 | AGENTS.md（Coordination Backend 節の表・後続段落の「既定 `enabled: false`」「既定（無効）」記述）、`docs/CONFIGURATION.md`（`issue_sync` の既定値説明）、`docs/ARCHITECTURE.md`（成果物内容の正本に関する補足段落）を新しい既定値と整合する記述へ更新する | `AC-6` | `1`, `2`, `5` |
| 7 | 既存自動テストの前提更新 | `test/integration/issue-sync.test.ts` の `issue-sync: 既定（issue_sync.enabled: false）では Issue 本文が一切変更されない` テストを、`setIssueSync(repoDir, { enabled: false })` による明示的な無効化を検証する形へ書き換える。加えて、fixture の設定ファイルを一切上書きしない場合に実際の既定値（`true`、変更単位1適用後）で Issue 本文への転記が行われることを検証する新規テストケースを追加する | `AC-7` | `1` |
| 8 | 全体回帰確認 | 既存の自動テスト一式（`npm test` 相当）と `.agent-skill-chain/ci/verify-doc-length.sh`・`lint-vocab.sh`・`lint-references.sh` 等の機械検査を実行し、変更単位1〜7の適用後に新規の失敗が無いことを確認する | `AC-1`〜`AC-7` | `1`, `2`, `3`, `4`, `5`, `6`, `7` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

変更単位1〜3・5は互いに独立であり並行して着手できる。変更単位4・6・7は、変更単位1・2が確定させた具体的な既定値（`true`）とその説明文を前提にするため、1・2の後に着手する。変更単位8は全変更単位の完了後に実施する最終確認であり、新たなプロダクションコード変更を生じさせない。
