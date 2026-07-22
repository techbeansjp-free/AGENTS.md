<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0006
status: proposed   # proposed | accepted | superseded | deprecated
title: unit_test_resultsの充足証跡はtestディレクトリのbaseブランチ三点差分とする
tags: [verify, artifacts, testing, segments]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/config/segments.yaml` は implementation セグメントの必須成果物として `code` と `unit_test_results` を、validation セグメントの必須成果物として `acceptance_test_results` と `regression_test_results` を定義する。しかし `src/commands/verify.ts` の `checkOutputExists()` は、この3つの抽象成果物（`unit_test_results`/`acceptance_test_results`/`regression_test_results`）をすべて同一条件（`VALIDATION.md` の存在、または `wasEverAddedOrModified()` によるbaseブランチ分岐後の履歴実績）で判定していた。`VALIDATION.md` は validation セグメントでのみ作成されるファイルであるため、implementation セグメント完了時点（validation セグメント未着手）では `unit_test_results` の判定が構造的に必ず失敗する、セグメント間の依存方向が逆転したバグである（Issue #202、SPEC.md参照）。

このバグの修正にあたり、`unit_test_results` の充足を implementation セグメント自身の作業実績のみに基づいて判定する新しい証跡方式を選定する必要がある。既存の `checkOutputExists()` には以下の技法が既に存在する。

- 単一の既知ファイル名について、現在の存在または履歴上のadd/modify実績を確認する方式（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md` が採用、`wasEverAddedOrModified()`）。
- baseブランチとの三点差分（`git diff --stat base...HEAD`）にpathspecを付けて変更の有無を確認する方式（`code` が採用）。

`.agent-skill-chain/standards/TEST_POLICY.md` の「常時必須」区分は、単体テスト・lint/format・型検査等を無条件必須のCIチェックと定めている。これは `verify artifacts` とは別のCIジョブ（例: `npm test` 実行）が担う既存の枠組みであり、「テストが実際にパスすること」の保証はそちら側の責務である。したがって `verify artifacts` 側の `unit_test_results` 判定に求められる責務は、「実装セグメントでテストを書く作業が行われたことの機械的痕跡」の確認に限定してよい。

検討した選択肢は以下の3つである。

1. **`test/` ディレクトリを対象にした `git diff --stat base...HEAD` 三点差分**（`code` ケースと同一技法・同一関数の再利用、pathspecのみ変更）。
2. **専用のテスト実行ログファイル**（例: `.agent-skill-chain/`配下に実行結果を記録する新規ファイル形式を新設し、その存在で判定する）。
3. **設定可能なテストディレクトリパターン**（`.agent-skill-chain/config/agent-skill-chain.yaml` に `test.path_pattern` 等の新規項目を追加し、プロジェクトごとに任意のテストディレクトリ名を指定可能にする）。

## Decision

選択肢1（`test/` ディレクトリを対象にした `git diff --stat base...HEAD` 三点差分）を採用する。判定は `code` ケースの `defaultBranch(worktreePath)` + `git(['diff', '--stat', 'BASE...HEAD', '--', 'test'], worktreePath)` という既存の呼び出しパターンを、pathspecを `test` に変更するだけでそのまま再利用する。新規ヘルパー関数・新規ファイル形式・新規設定項目は一切追加しない。

選択肢2（専用ログファイル）は却下する。理由は、(a) テスト実行結果を記録する新規ファイル形式・書き込みタイミング・スキーマを新設する必要があり、AGENTS.mdが戒める「疑わしい機能は追加しない」（UNIX原則）に反する複雑さを持ち込むこと、(b) このファイル自体も「作成されたか」でしか検証できず、`git diff` ベースの方式に対して back-door 耐性（テストを書かずにファイルだけ作る、というすり抜けの容易さ）で明確に優位ではないこと、(c) 実行環境（CI・ローカル・エージェント実行）ごとにログ生成経路を揃える追加の運用負荷が生じることによる。

選択肢3（設定可能なテストディレクトリパターン）も却下する。理由は、AGENTS.md §設定 が定める設定項目追加の手順（①ハードコード不可の理由→②プロジェクト単位で変わる必要性→③スキーマ更新→④既定値定義→⑤migration定義→⑥必要ならADR）のうち、②「プロジェクト単位で変わる必要性」を本Issueの時点で具体的な利用者ニーズとして提示できないこと。本リポジトリ自身は `test/unit`・`test/integration`・`test/helpers` という固定の配置規約を既に持ち、`checkOutputExists()` の他ケース（`code` ケースの `docs`/`SPEC.md`等のpathspec除外リスト、`ADR` ケースの `docs/adr` 固定パス）も同様にリポジトリの配置規約をハードコードしている。将来、他のディレクトリ命名規約を採る consumer project からの実需が生じた場合は、そのときに新たなADR＋config schema更新として対応する。

## Consequences

- 利点: 新規メカニズムを一切導入せず、`code` ケースと同一の技法の再利用のみで実装できるため、実装コストと将来の保守コストが最小になる。判定ロジックの厳密さの水準（「変更が存在すること」であり「正しく動作すること」ではない）が `code` ケースと揃うため、`checkOutputExists()` 全体の判定思想に一貫性が生まれる。`VALIDATION.md` への依存を完全に除去するため、Issue #202 が指摘したセグメント間の依存方向の逆転が解消される。
- 欠点・フォローアップ: back-door耐性は `code` ケースと同水準にとどまる（テスト内容を伴わない自明な差分でも `test/` 配下であれば充足と判定されうる）。この残存リスクは、TEST_POLICY.md「常時必須」区分のCI必須チェック（単体テストの実行・合格を別途強制する）が実質的な担保を提供することで許容する。テストディレクトリ名 `test` はこのリポジトリの配置規約のハードコードであり、汎用ツールとして他ディレクトリ命名規約を持つプロジェクトへ配布する段階になった場合は、設定可能化（選択肢3）を別ADRとして再検討する必要がある。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。
