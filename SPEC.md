# SPEC: CI/gate運用の本番導入とE2Eフロー実地一周

- Issue: `ISSUE-171`
- 作成者: `claude`
- 対象ブランチ: `process/171-ci-gate-dogfood`

## 目的・背景

このリポジトリ自身は配布用の`.github/`一式（CI・gate・reconcile・risk workflow、Issue/PRテンプレート等）を導入しておらず、`agent-skill-chain-ci.yml`・`agent-skill-chain-gate.yml`が一度も本リポジトリで稼働した実績が無かった（実装チェックリストとのギャップ分析の横断的所見13）。本Issueは (1) `init`コマンドで`.github/`一式を本リポジトリへ導入し、(2) 実質1人開発でAPIキー不要な`review.adapter: human`へ切り替え、(3) 本Issue自体をSPEC→DESIGN→IMPLEMENTATION→VALIDATIONの4segmentで処理してgateを実地稼働させることで、ドッグフーディングを開始する。

## 要求 → 要件 →受入条件

### 要求

リポジトリメンテナから、`.github/`配下のCI/gate workflowを本リポジトリで実際に有効化し、gate判定フロー・成果物規約（`segments.yaml`）が実地で機能することを確認したいという要求。

### 要件

- `init`コマンドで`.github/`一式を導入し、既存ファイルを破壊しない。
- `review.adapter`を`human`へ変更し、schemaがこれを許容していることを確認する。
- 変更後もbranch名検証・既存テストスイートが壊れないことを確認する。
- 本Issueを実際にCI（gate workflow・verifyジョブ）上で流し、`segments.yaml`が定める正式成果物規約（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`）に適合させる。

### 受入条件（Acceptance Criteria）

#### AC-1: `init`実行で`.github/`一式が作成され既存ファイルは破壊されない

- Given: `.github/`が未導入で`AGENTS.md`・`CLAUDE.md`・`.agent-skill-chain/`一式が既に存在するリポジトリ状態
- When: `node bin/agents-md.js init`を実行する
- Then: `.github/`配下18ファイル（CODEOWNERS、ISSUE_TEMPLATE 7種、SECURITY.md、dependabot.yml、pull_request_template.md、workflows 4種）が`created`として作成され、既存の`AGENTS.md`・`CLAUDE.md`・`.agent-skill-chain/`一式は`unchanged`のままである
- 検証方法見込み: `manual`

#### AC-2: `--dry-run`と実実行の対象ファイル一覧が一致する

- Given: `.github/`未導入のリポジトリ状態
- When: `node bin/agents-md.js init --dry-run`実行後に`node bin/agents-md.js init`を実行する
- Then: dry-runが`planned created`と報告したファイル一覧と、実実行が`created`と報告したファイル一覧が完全に一致する
- 検証方法見込み: `manual`

#### AC-3: `review.adapter`が`human`へ変更されている

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml`の`review.adapter: claude`
- When: 当該行を`review.adapter: human`へ編集する
- Then: ファイル内容が`adapter: human`になっている
- 検証方法見込み: `manual`

#### AC-4: config schemaが`adapter: human`を許容する

- Given: `.agent-skill-chain/schemas/config.schema.yaml`
- When: `adapter`フィールドのenum定義を確認する
- Then: `enum: [claude, codex, human]`に`human`が含まれ、schema変更なしにAC-3の値を許容する
- 検証方法見込み: `manual`

#### AC-5: `verify branch-name`が現ブランチに対しexit 0を返す

- Given: 対象ブランチ`process/171-ci-gate-dogfood`（`branch.pattern: "{type}/{issue_id}-{slug}"`、`allowed_types`に`process`を含む）
- When: `node bin/agents-md.js verify branch-name`を引数省略（現在のブランチ自動解決）・明示指定の両方で実行する
- Then: いずれも終了コード0を返す。detached HEAD等でブランチ名を解決できない場合は明確なエラーメッセージで終了コード1を返す
- 検証方法見込み: `manual`

#### AC-6: 既存テストスイートを破壊しない

- Given: 本Issueの変更（`init`実行・`review.adapter`変更・CI実地実行で発見された`detached HEAD`対応等の修正）を適用した状態
- When: `npm test`を実行する
- Then: 実行時点の全テストがpassする（既存分＋本Issue中に追加した分の両方）。fail発生時は原因を特定し正直に記録する
- 検証方法見込み: `automated`

#### AC-7: Issue成果物が`segments.yaml`の正式規約に適合する

- Given: `.agent-skill-chain/config/segments.yaml`が定める各segmentの必須成果物定義（spec: `SPEC.md`、design: `DESIGN.md`/ADR/`PLAN.md`、implementation: code/unit_test_results、validation: acceptance_test_results/regression_test_results/pr）
- When: `node bin/agents-md.js verify artifacts ISSUE-171 <segment>`（4segment分）と`node bin/agents-md.js verify ac-coverage ISSUE-171`を実行する
- Then: いずれも終了コード0を返す（孤児AC・孤児テスト参照・成果物欠落が無い）
- 検証方法見込み: `automated`

## スコープ外

- claudeアダプタでの実AI判定の実地検証（APIキー未設定のため）。
- doctor全項目網羅・WIP強制等、本Issueが対象としない他ギャップ項目。
- `test/helpers/tmp-repo.ts`の`createTmpRepo()`が本リポジトリの`.agent-skill-chain/`を丸ごと複製する構造自体の恒久修正（`.installed_version`混入問題）。
- 本Issueで新設した`docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/`配下の00〜04ファイルの削除・移行（既存資産として残置し、本ファイル群が正式成果物として扱われる）。
- push・CI再実行後の最終グリーン確認（進行役が別途実施）。
