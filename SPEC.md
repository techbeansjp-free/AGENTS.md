# SPEC: 並列テスト中のnpm pack用ビルドがCLI成果物を競合更新する

- Issue: `ISSUE-279`
- 作成者: `parallel_test_race`
- 対象ブランチ: `bugfix/279-parallel-package-build-race`

## 目的・背景

Node.js test runner はテストファイルを既定で並列実行する。パッケージ内容を確認する統合テストが
repository root で `npm pack --dry-run` を実行すると、npm の `prepare` lifecycle が TypeScript
ビルドを再実行し、共有生成物 `bin/` を書き換える。同時に lint 統合テストが CLI を起動した場合、
生成途中のモジュールを読み、export 不整合で偶発的に失敗する。

本Issueの目的は、パッケージ検証と他の統合テストの書き込み境界を分離し、実行順・既定並列度に
依存しない決定的なテストスイートへ戻すことである。単に全テストを直列化して競合を隠してはならない。

## 用語・対象

- 共有生成物: repository root の `bin/` 以下にあるCLIビルド成果物。
- パッケージ検証: npm packageへ収録されるファイル集合を検査する統合テスト。
- 隔離環境: repository root と異なる一時作業領域で、そこでの生成物変更が共有生成物へ及ばない環境。
- 対象入力: package manifest、TypeScriptソース、package files設定、および既存の事前ビルド成果物。
- 対象出力: package files検査結果と、並列実行しても安定する統合テスト結果。

## 要求 → 要件 → 受入条件

### 要求

パッケージ内容検証が他テストのCLI実行を壊さないよう根本原因を除去し、既定並列度での全テストを
複数回、決定的に成功させる。並列度1への固定は解決として扱わない。

### 要件

- パッケージ検証中の lifecycle build は共有生成物を書き換えてはならない。
- package files検査は実際のnpm pack対象を検査し、隔離によって検査精度を落としてはならない。
- 競合し得るpackage検証とCLI利用を意図的に重ねる自動回帰検証を持つ。
- 既定並列度を維持し、個々のテストが実行順序へ依存しない。
- 一時領域は成功時・失敗時とも後始末され、repository内へ検証用生成物を残さない。
- 変更はpackage検証の境界へ局所化し、CLI本体の公開動作とnpm packageの内容契約を変えない。

### 受入条件（Acceptance Criteria）

#### AC-1: package検証は共有生成物を変更しない

- Given: repository root に利用可能な共有CLI生成物が存在する
- When: package files検証がnpm lifecycleを伴うpack処理を実行する
- Then: 処理の成功・失敗を問わずrepository rootの共有生成物の内容は処理前と同一である
- 検証方法見込み: `automated`

#### AC-2: package内容契約を実物で検証する

- Given: package manifestと収録対象ファイルが用意されている
- When: package files統合テストを実行する
- Then: npmが算出したpack対象に必須ファイルが含まれ、禁止ファイルが含まれないことを検査する
- 検証方法見込み: `automated`

#### AC-3: 競合条件を再現する回帰テストが安定して成功する

- Given: package検証とCLI読込みを並行開始できるテスト環境がある
- When: lifecycle buildを伴うpackage検証とCLIを利用する検査を意図的に重ねて実行する
- Then: CLIは完全なexportを読み込み、両方の処理が成功する
- 検証方法見込み: `automated`

#### AC-4: 全テストが既定並列度で決定的に成功する

- Given: 変更後のソースと通常のNode.js test runner設定がある
- When: 全unit・integrationテストを既定並列度で複数回実行する
- Then: 各回が成功し、並列度1への固定や実行順制御を必要としない
- 検証方法見込み: `automated`

#### AC-5: 一時資源と既存契約を保全する

- Given: package検証が成功する場合と途中で失敗する場合がある
- When: 検証処理が終了する
- Then: 一時作業領域は後始末され、CLI公開動作・package収録契約・repository状態に副作用が残らない
- 検証方法見込み: `automated`

## 制約・完了条件・未決事項

- 制約: npmの実際のpack計算を模倣実装へ置換しない。
- 制約: test runner全体の並列実行を無効化しない。
- 完了条件: AC-1〜AC-5の証跡、複数回の全テスト結果、型検査結果を検証成果物へ残す。
- 未決事項: なし。

## スコープ外

- npm packageの公開内容、CLIコマンド仕様、プロダクションビルド方式の変更。
- Node.js test runner自身のスケジューラ制御。
- #279と無関係な既存テストの整理や高速化。
