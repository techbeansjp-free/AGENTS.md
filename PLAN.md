# PLAN: 配布テンプレートからdependabot.ymlを削除する

- Issue: `ISSUE-611`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 配布元ファイル削除 | `.agent-skill-chain/templates/github/.github/dependabot.yml` を削除する | `AC-1` | なし |
| 2 | seed-onlyマニフェスト更新 | `.agent-skill-chain/templates/github/.github.seed-only.yaml` の `paths:` から `dependabot.yml` エントリを削除し、`CODEOWNERS` のみ残す | `AC-2` | `#1` |
| 3 | 既存テスト是正 | `test/integration/verify.test.ts` から「seed-only指定ファイル（dependabot.yml）が完全に削除された場合は引き続き欠落として検出される（AC-2）」テストケースを削除し、同ファイル冒頭のISSUE-574由来コメントを `CODEOWNERS` のみを列挙する記述へ是正する | `AC-3` | `#1, #2` |
| 4 | ソースコメント是正 | `src/lib/template-sync.ts` の `ISSUE-574: CODEOWNERS・dependabot.yml等、...` コメントを `CODEOWNERS等` へ是正する（ロジック自体は無変更） | `AC-3` | `#1, #2` |
| 5 | 回帰確認（コード変更なし） | `dependabot-ci-skip` 判定関連（`.github/workflows/agent-skill-chain-ci.yml` の `skip_checks`、`test/unit/dependabot-ci-skip.test.ts`、`test/unit/dependabot-ci-skip-exec.test.ts`）に変更が不要であることを実装セグメントでテスト実行により再確認する（DESIGN.mdの設計時確認結果の追認） | `AC-4` | `#1, #2` |
| 6 | dogfooding用ファイル無変更の確認 | このリポジトリ自身の `.github/dependabot.yml` に変更を加えていないことを実装完了時に `git status`/diff で確認する | `AC-5` | `#1, #2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
