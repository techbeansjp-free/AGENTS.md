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
- package files検査は実際のnpm pack対象を検査し、下記の収録契約を維持しなければならない。
- 競合し得るpackage検証とCLI利用を意図的に重ねる自動回帰検証を持つ。
- 既定並列度を維持し、個々のテストが実行順序へ依存しない。
- 一時領域は成功時・失敗時とも後始末され、repository内へ検証用生成物を残さない。
- 変更はpackage検証の境界へ局所化し、CLI本体の公開動作とnpm packageの内容契約を変えない。

### 維持するpackage収録契約

- 必須ファイル: `bin/agents-md.js`、`AGENTS.md`、`CLAUDE.md`、`docs/GLOSSARY.md`。
- 必須namespaceと代表ファイル: `.agent-skill-chain/` 配下の
  `adapters/claude.sh`、`ci/verify-ac-coverage.sh`、`config/agent-skill-chain.yaml`、
  `hooks/claude-pretooluse.sh`、`schemas/config.schema.yaml`、`scripts/init.sh`、
  `standards/GIT_CONVENTIONS.md`、`templates/issue/SPEC.md`。
- 禁止prefix: `.agent-skill-chain/runtime/`、`.agent-skill-chain/project/`、`src/`、
  `test/`、`tsconfig`、`docs/adr/`、`docs/maintainer/`。
- 禁止ファイル: `.agent-skill-chain/.installed_version`、`CONTRIBUTING.md`。
- 判定規則: `npm pack --dry-run --json` が返す実際のfiles一覧を上記集合と照合する。

### 受入条件（Acceptance Criteria）

#### AC-1: package検証は共有生成物を変更しない

- Given: repository root に利用可能な共有CLI生成物が存在する
- When: package files検証がnpm lifecycleを伴うpack処理を実行する
- Then: 処理の成功・失敗を問わずrepository rootの共有生成物の内容は処理前と同一である
- 検証方法見込み: `automated`

#### AC-2: package内容契約を実物で検証する

- Given: package manifestと収録対象ファイルが用意されている
- When: package files統合テストを実行する
- Then: npmが算出したpack対象が「維持するpackage収録契約」の必須集合を全て含み、禁止集合を含まない
- 検証方法見込み: `automated`

#### AC-3: 競合条件を再現する回帰テストが安定して成功する

- Given: package検証とCLI読込みを並行開始できるテスト環境がある
- When: lifecycle buildを伴うpackage検証とCLIを利用する検査を意図的に重ねて実行する
- Then: package処理中も共有 `bin/agents-md.js` のコマンドモジュールgraphが完全にloadされ、
  `--help` が終了コード0とusageを返し、cleanな入力への `lint vocab` が終了コード0を返す
- 検証方法見込み: `automated`

#### AC-4: 全テストが既定並列度で決定的に成功する

- Given: 変更後のソースと通常のNode.js test runner設定がある
- When: 全unit・integrationテストを既定並列度で最低3回連続実行する
- Then: 3回以上の各回が成功し、並列度1への固定や実行順制御を必要としない
- 検証方法見込み: `automated`

#### AC-5: 一時資源と既存契約を保全する

- Given: package検証が成功する場合と途中で失敗する場合がある
- When: 検証処理が終了する
- Then: 一時作業領域は後始末され、CLI公開動作・package収録契約・repository状態に副作用が残らない
- 検証方法見込み: `automated`

## 制約・完了条件・未決事項

- 制約: npmの実際のpack計算を模倣実装へ置換せず、test runner全体の並列実行を無効化しない。
- 完了条件: AC-1〜AC-5の証跡、3回以上の全テスト結果、型検査結果を検証成果物へ残す。
- 未決事項: なし。

## スコープ外

- npm packageの公開内容、CLIコマンド仕様、プロダクションビルド方式の変更。
- Node.js test runner自身のスケジューラ制御、および#279と無関係な既存テストの整理や高速化。
