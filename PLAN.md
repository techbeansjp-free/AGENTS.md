# PLAN: Issueセグメント成果物のroot直下混入を、事後cleanupだけでなくマージ前に予防するCI gateが無い

- Issue: `ISSUE-590`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `ADR-0046 作成` | `docs/adr/ADR-0046-pre-merge-root-artifact-prevention-gate.md` を `status: proposed` で作成し、DESIGN.mdの決定内容（コンポーネントA〜D、`--admin`必須化のトレードオフ）を記録する | `AC-1, AC-3` | なし |
| 2 | `CIステップ追加（コンポーネントA）` | `.github/workflows/agent-skill-chain-ci.yml` の `verify` ジョブへ `verify-root-clean (merge-ready)` ステップを追加する。`run: ./.agent-skill-chain/ci/verify-root-clean.sh`、条件 `if: steps.ctx.outputs.skip_checks != 'true' && github.event.pull_request.draft == false`。既存の `.agent-skill-chain/ci/verify-root-clean.sh`／CLI `verify root-clean` は無変更のまま再利用する | `AC-1, AC-2` | `#1` |
| 3 | `verify-root-clean.sh / verify.ts のコメント更新` | 「post-merge事後確認専用」と限定していた既存コメント（ヘッダ・`ROOT_CLEAN_USAGE`）を、事前ゲート（コンポーネントA）からも呼ばれる旨を含めて更新する。動作・出力仕様は変更しない | `AC-1` | `#2` |
| 4 | `pr merge の自動クリーンアップ連鎖（コンポーネントB）` | `src/commands/pr.ts` の `merge()` を拡張し、`gh pr merge` 成功・`syncMainWorktree()` 完了後に `root-cleanup.ts` の `run()` を同一プロセス内で呼び出す。`run()` が非ゼロを返した場合はマージ成功を維持しつつ、追加確認が必要な旨を非ゼロ終了コード・日本語メッセージで報告する（`syncMainWorktree()` の既存失敗時メッセージパターンを踏襲） | `AC-3` | `#2` |
| 5 | `pr-merge.sh / MERGE_USAGE / GIT_CONVENTIONS.md の運用文書更新` | validation-gate完了後のPRはコンポーネントAの必須checkが常に失敗する設計であるため、`pr merge` 呼び出し時に `--admin` を明示する必要がある旨を明記する（コンポーネントD） | `AC-1, AC-3` | `#4` |
| 6 | `自動テスト追加・更新` | 下記「検証」参照 | `AC-1, AC-2, AC-3, AC-5` | `#2, #4` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 検証（実装セグメント・独立検証セグメントへの申し送り）

- AC-1・AC-2（`automated`）: `test/integration/verify.test.ts`（または同等の新規テストファイル）に、draft PR相当の入力では `verify root-clean` 呼び出しをスキップし、非draft相当かつ対象4ファイル存在時は失敗することを検証するケースを追加する。CI workflow自体のyaml条件分岐は、`agent-skill-chain-ci.yml` の `if:` 式が既存の `skip_checks` パターンと同型であることをレビューで確認する（workflow実行そのものを単体テストで再現するのは既存踏襲の限界のため、GitHub Actions式の等価性確認は設計レビュー・実装レビューで担保する）。
- AC-3（`hybrid`）: `test/integration/pr-merge.test.ts` に、マージ成功後に repoRoot 直下の対象4ファイルが自動的に検出・削除され、かつ Issueブランチ自体には削除commitが一切追加されないこと（`git log <issue-branch>` に削除commitが含まれないこと）を検証するケースを追加する（`test/integration/root-cleanup.test.ts` のスタブ・fixtureパターンを再利用）。手動検証として、実際のPRマージ1件を通じて `--admin` 指定時に自動クリーンアップが発火することを確認する。
- AC-4（`manual`）: 実装差分に `.agent-skill-chain/config/segments.yaml` の `outputs` 変更・AGENTS.md本体の変更・成果物配置パスの変更が含まれないことをPRレビューで確認する。
- AC-5（`hybrid`）: 既存の `test/integration/root-cleanup.test.ts` 全ケースが無変更のまま成功することを確認し、新規呼び出し元（コンポーネントB）を追加したことによる回帰が無いことを、`root-cleanup run` を単独実行するケースと `pr merge` から連鎖実行するケースの両方を含むテストで確認する。

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
