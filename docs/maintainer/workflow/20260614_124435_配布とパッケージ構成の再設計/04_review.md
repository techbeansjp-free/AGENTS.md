---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "e5be3fa7-9765-4953-8274-fa39c61128bf"
---

# レビュー書: 配布とパッケージ構成の再設計（軽微1 schema 単一化・軽微3 自己 CI 実体化）

**プロジェクト名**: 配布とパッケージ構成の再設計
**作成日**: 2026 年 06 月 14 日
**最終更新**: 2026 年 06 月 14 日

> **重要**: 本レビューは command **verify-and-close** の成果物。skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従う。
>
> **必須参照**: [`.agents/REVIEW_RULE.md`](../../../../.agents/REVIEW_RULE.md)、[`.agents/workflow/PHASES.md`](../../../../.agents/workflow/PHASES.md)。
> **レビュー深度**: **standard**（中規模・限定スコープの是正 2 件。新規 SQL 正本ファイルとフレームワーク CI 1 本）。
>
> **evidence_source 凡例**: `test_output`（本レビューで再実行した結果）/ `existing_code`（実ファイル確認）/ `external_spec`（仕様文書）/ `inference_only`（推測）。**inference_only のみに依存する重要判断は承認しない。**

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認・品質保証（正本ズレ／二重管理／リーク／クリーン clone 破綻を新たに生まないかの検証）と、テスト再実行による受け入れ基準の充足確認を行う。

### 1.2 レビュー対象

- **実装範囲**: 直前の implement-feature（chain: implement-change）の成果物。
  - **(軽微1)** `workflow.db` スキーマを `.agents/ledger/schema.sql` に単一正本化。実在テーブルは `workflow_log` のみと確定し、`schema.md` を「解説／例示／移行手順」と明記。
  - **(軽微3)** フレームワーク自身の CI `.github/workflows/self-enforce.yml` を新設（構文チェック／スキーマ正本ズレ／生成物差分ゼロ／enforcement audit 非ブロッキング）。
- **変更ファイル（CHANGED_FILES_JSON）**:
  - `.agents/ledger/schema.sql`
  - `.agents/ledger/schema.md`
  - `.github/workflows/self-enforce.yml`
  - `docs/maintainer/workflow/20260614_124435_配布とパッケージ構成の再設計/memo/20260614_153629_軽微1schema単一化_軽微3自己CI実体化.md`
- **レビュー期間**: 2026-06-14 ～ 2026-06-14
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）

---

## 2. 実装内容の確認（review-code）

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| ---- | ---- | ---- | ---- | ---- |
| 軽微1 schema 単一化 | schema.sql を全実在テーブルの単一正本化、schema.md を解説/例示に注記 | 2026-06-14 | worker | 完了 |
| 軽微3 自己 CI 実体化 | self-enforce.yml 新設（構文/スキーマ/差分ゼロ/audit 非ブロッキング） | 2026-06-14 | worker | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: 軽微1 — workflow.db スキーマの単一正本化

- **実装内容**: `schema.sql` 冒頭コメントを「全実在テーブル（現状 `workflow_log` の 1 つ）と索引の単一正本」「実在テーブルを増やす場合は必ず schema.sql に追加（schema.md には書かない）」と明記。`schema.md` は冒頭に「実在テーブルと正本の所在（最初に読むこと）」セクションを追加し、各 SQL ブロック（推奨スキーマ完成版／旧スキーマ／memo_ref）を「解説／例示／移行手順であり新規 DB 作成時には流されない」と注記。
- **変更ファイル**: `.agents/ledger/schema.sql`、`.agents/ledger/schema.md`
- **実装方法**: SQL の実体を schema.sql に一本化し、schema.md は人間向け解説に降格。setup.sh / write-workflow-log.sh はいずれも `sqlite3 ... < ledger/schema.sql` で流すのみ（インライン SQL の実体無し）。
- **確認事項（レビュー結果）**:
  - `setup.sh:142` が `sqlite3 "$db" < "$AGENTS_SOURCE/ledger/schema.sql"` であることを確認（`existing_code`）。インライン `CREATE TABLE` は無い。
  - `write-workflow-log.sh:239` が新規 DB 作成時に `sqlite3 "$WF_DB" < "$AGENTS_ROOT/ledger/schema.sql"` を流すことを確認（`existing_code`）。
  - **schema.md に実在テーブルの「生きた」定義が残っていないか**: `CREATE TABLE` の出現は schema.md の 48 行（推奨スキーマ完成版＝schema.sql の解説用写し）・161 行（旧スキーマ＝説明のみ）・179 行（memo_ref＝将来案の例示）の 3 箇所。**いずれも本文で「実体ではない／新規作成時に流されない」と明記済み**で、どのスクリプトも schema.md を流さない。→ 二重管理リスクは解消（`existing_code`）。
  - `write-workflow-log.sh:275` の `workflow_log_new` は CHECK マイグレーション中の一時テーブルで、最終的に rename される常設外テーブル。実在の常設テーブルではなく問題なし（`existing_code`）。
  - **指摘なし（確認済み）**。

#### タスク 2: 軽微3 — フレームワーク自身の CI（self-enforce.yml）

- **実装内容**: `.github/workflows/self-enforce.yml` を新設。トリガは `pull_request` と `push: branches: [feature/**]`。ジョブ `self-enforce`（ubuntu-latest）に 6 step：(0) checkout、(1) sqlite3 install、(2) `bash -n .agents/scripts/*.sh`、(3) `schema.sql` を一時 DB に流し `workflow_log` 生成を確認、(4) build 実行後 `git status --porcelain --untracked-files=no` が空 ＋ `git ls-files .adapters` が空、(5) `audit.sh` を `continue-on-error: true` + `|| echo` で非ブロッキング呼び出し。
- **変更ファイル**: `.github/workflows/self-enforce.yml`（新規）
- **実装方法**: 「確実に green になる構成のみ」を方針とし、実在しないツールに依存しない。
- **確認事項（レビュー結果）**:
  - YAML が妥当で 1 job・6 step・トリガ 2 種が正しくパースされる（`test_output`、本レビューで pyyaml により確認）。
  - **CI が確実に green か（実在しないツール依存で赤くしないか）**: 依存は `actions/checkout@v4`・`apt-get sqlite3`・`bash`・`git`・本リポ同梱スクリプトのみ。外部の未整備ツール依存は無い（`existing_code`）。
  - **audit.sh が CI を赤くしないか**: 本レビューで `bash .agents/enforcement/ci/audit.sh .` を実行 → exit 1（本リポ issue が `docs/maintainer/workflow/` 配下で、audit.sh は `.workflow/` 前提のため適用範囲外による偽陽性）。self-enforce.yml は当該 step を `continue-on-error: true` かつ `|| echo` でラップしており、**audit が落ちても job は green** を維持できる構成（`test_output` + `existing_code`）。
  - **指摘（低・残課題化）**: audit.sh が本リポ layout 非対応である点は既知の限界（§10.1 課題1）。本 CI は非ブロッキングで対処済みのため、本実装の良し悪しとは無関係。

### 2.3 規約・フォーマット遵守

- memo は issue の `memo/` 配下に `20260614_153629_` プレフィックス付きで配置（プレフィックスは実行環境現在時刻 JST 取得規約に合致）（`existing_code`）。
- 04_review は **issue 直下**（`.workflow/` ではなく `docs/maintainer/workflow/.../`）に作成。`.agents-project/自己拡張ワークフロー.md` の上書きルールに準拠（`external_spec`）。
- 本実装はテストコード（テストファイル）を新規追加していない。検証は bash スクリプト・CLI・CI step の振る舞い検証（`git status` / `bash -n` / `sqlite3` 流し込み / YAML パース）で行うため、TEST_BDD_FORMAT のインラインコメント必須要件は「テストコードが存在する場合」に適用される。本バッチには該当テストコードが無く、03 のクリーン clone 系 BDD（フェーズ0）は別バッチのスコープ（§10.1 課題2 参照）。

---

## 3. テスト結果の確認（テスト再実行）

### 3.1 再実行サマリ

- **実行日**: 2026-06-14
- **実行環境**: sqlite3 3.45.x / node v20.19.5 / bash 5.2.x（CI runner ubuntu-latest 相当）
- **既存 `.workflow/workflow.db` への影響**: 無し（検証は一時 DB のみ。既存 DB を破壊していない）。
- **総合**: 成功 5 / 失敗 0（audit.sh の exit 1 は「設計どおりの非ブロッキング想定挙動」のため失敗にはカウントしない。下表参照）。

### 3.2 個別の検証方法・結果

| # | 検証項目 | 検証方法（コマンド） | 結果 | evidence_source |
| - | ---- | ---- | ---- | ---- |
| T1 | schema.sql の一時 DB ロード | `T=$(mktemp -d); sqlite3 "$T/t.db" < .agents/ledger/schema.sql` | **OK**（exit 0）。作成テーブル=`workflow_log` のみ、索引 7 件（command/document_id/document_path/issue_id/parent/review_id/ts_utc）。CHECK `actor_role='scribe'` が不正 INSERT を拒否することも確認。 | test_output |
| T2 | bash 構文チェック | `bash -n .agents/scripts/*.sh`（6 本） | **OK**（全 6 本 exit 0）：build-plugin-claude / create-pr-review-issue-dir / memo-prefix / new-workflow-memo / setup / write-workflow-log | test_output |
| T3 | build 差分ゼロ | `bash .agents/scripts/build-plugin-claude.sh` 実行後 `git status --porcelain --untracked-files=no` | **OK**。build 前後で追跡ファイル差分は `M schema.md / M schema.sql`（本実装の編集であり build 由来でない）で不変。build 由来の新規差分ゼロ。`git ls-files .adapters` 空、`git check-ignore .adapters/` 真。 | test_output |
| T4 | YAML 妥当性 | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/self-enforce.yml'))"` | **OK**。job=`self-enforce`、steps=6、on=`{pull_request, push: feature/**}`。 | test_output |
| T5 | audit.sh 非ブロッキング確認 | `bash .agents/enforcement/ci/audit.sh .` | **exit 1（想定どおり）**。本リポ layout 非対応の偽陽性。self-enforce.yml は continue-on-error で非ブロッキング化済みのため CI は green を維持。 | test_output |

> 一時 DB は検証後に `rm -rf` で削除済み。既存 `.workflow/workflow.db` は読み取り（SELECT）のみで変更していない。

---

## 4. コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | ---- | ---- | ---- |
| 可読性 | schema.sql/schema.md の冒頭コメントで正本の所在が明示されているか | OK | 「最初に読むこと」セクションで誘導 |
| 保守性 | 実在テーブル定義が単一ファイルに集約され二重管理が解消されているか | OK | schema.sql のみが実体、schema.md は解説 |
| 正本ズレ | setup.sh / write-workflow-log.sh が schema.sql を参照しズレを生まないか | OK | 両者とも `< ledger/schema.sql` で流す |
| CI 安定性 | self-enforce.yml が実在しないツール依存で赤くならないか | OK | checkout/sqlite3/bash/git/同梱スクリプトのみ |
| リーク/汚染 | 本バッチが新たなリーク・クリーン clone 破綻を生まないか | OK | build 差分ゼロ・.adapters 未追跡を確認 |

---

## 5. ドキュメントの確認

| ドキュメント | 更新状況 | コメント |
| ---- | ---- | ---- |
| 00_要求定義.md | 既存（本バッチ非更新） | SC-5（schema 単一化）に対応する是正 |
| 01_要件定義.md | 既存（本バッチ非更新） | シナリオ7-4（正本ズレ検出）に対応 |
| 02_設計.md | 既存（本バッチ非更新） | §3.3 欠陥5・§4.1 の方針に整合 |
| 03_実装計画.md | 既存（本バッチ非更新） | フェーズ0 (5) schema 単一化・フェーズ5/軽微3 自己 CI に整合 |
| memo（20260614_153629_…） | 作成済み | 実装証跡。プレフィックス規約準拠 |

- **実装と設計の整合性**: 整合（02 §3.3 欠陥5 の「schema.sql 切り出し」方針どおり）。
- **要件と実装の整合性**: 整合（01 シナリオ7-4／00 SC-5）。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本バッチはフレームワーク内部の正本一元化と自己 CI であり、システム仕様書（`docs/`）の利用者向け記述に影響しないため。

---

## 6. 受け入れ基準の確認（generate-scenarios → map-coverage）

本バッチは大 issue の限定スコープ（軽微1・軽微3）。**本バッチが直接寄与する基準**に絞ってカバレッジを示す（他フェーズ基準は §10.1 課題2 で未達整理）。

| 受け入れ基準（出典） | 寄与する実装 | 検証方法 | 結果 |
| ---- | ---- | ---- | ---- |
| SC-5: schema 正本単一化・setup/write の一致（00） | 軽微1 | setup.sh:142 / write-workflow-log.sh:239 が schema.sql を参照（existing_code）＋T1 | **○** |
| シナリオ7-4: 生成物の正本ズレ検出（01） | 軽微1＋軽微3 | self-enforce step3（schema.sql ロード）＋step4（build 差分ゼロ）。T1/T3 で再現 | **○** |
| シナリオ7-4 後段: schema が setup/write/schema.md で一致・document_path 非対称無し（01） | 軽微1 | schema.sql に document_path 列あり（schema.sql:22）、両スクリプト参照。schema.md は解説化 | **○** |
| BR-6: 証跡 DB スキーマ正本は単一・複製箇所は完全一致（01） | 軽微1 | 実在 SQL 実体は schema.sql のみ。schema.md は注記済み | **○** |
| 03 フェーズ0 単体: schema.sql を `:memory:` に流すと workflow_log が CHECK 込みで作られる | 軽微1 | T1（一時 DB ＋ CHECK 拒否確認） | **○** |
| 03 フェーズ0 単体: build diff-zero／.adapters 未追跡 | 軽微3 が CI 化 | T3 | **○** |
| 03 全体観点: 「クリーン clone → build → 差分ゼロ」を CI で検証（02 §6.2 必須） | 軽微3（self-enforce step4） | self-enforce.yml が build 後 diff-zero を検証。本レビューでローカル相当 T3 を実行 | **○（CI 配線あり・ローカル相当 pass）** |
| シナリオ2-4: enforcement が非インタラクティブに CI 実行可能 | 軽微3（audit step） | self-enforce が CI から audit を呼ぶ（非ブロッキング）。T5 | **△（呼び出しは配線済みだが audit 本体は本リポ非対応・非ブロッキング）** |

### 未達・要対応（map-coverage）

- **本バッチのスコープ内に未達はなし**。寄与基準は上表のとおり ○。
- **本バッチのスコープ外（別フェーズ／別 issue で対応）**: 00 SC-1/2/3/4・01 のユースケース 1〜7 の大半（npm 土台・生成器一般化・multi-tool・marketplace リリース・enforcement 有効化）。これらは 03 のフェーズ1〜5 に属し、本 implement-feature では実装対象外。verify-and-close としては「本バッチが担当した範囲の DoD 充足」を判定し、未着手フェーズは issue クローズではなく後続タスクとして残す（§10.1 課題3）。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務（「DB スキーマの正本」を schema.sql に集約）・明確な境界（実体＝schema.sql／解説＝schema.md）に準拠。02 §1.2・§3.3 欠陥5 の方針と一致（`external_spec`）。UNIX 哲学（各スクリプトが schema.sql を流すだけ）に整合。
- **ディレクトリ構成**: `.agents/ledger/`（正本）に schema.sql/schema.md、CI は `.github/workflows/`、memo は issue 配下 `memo/`。spec のディレクトリ方針に整合。
- **命名規則**: `self-enforce.yml`・`schema.sql` は用途が自明な命名。問題なし。

### 9.2 境界・依存の確認

- **責務の境界**: schema.sql＝SQL 実体、schema.md＝解説、setup.sh/write-workflow-log.sh＝参照側（流すだけ）という単方向の責務分担。循環なし。
- **依存関係**: self-enforce.yml → 同梱スクリプト/schema.sql の一方向依存。外部レジストリ・未整備ツールへの依存なし。
- **新たな破綻の有無**: build 差分ゼロ・`.adapters` 未追跡を T3 で確認。本バッチはクリーン clone 破綻・リーク・二重管理を**新たに生まない**（`test_output`）。
- **指摘・推奨**: なし（標準深度で承認可能）。残課題は §10.1 へ。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| ---- | ---- | ---- |
| schema.md に実在テーブルの生きた定義が残っていない（二重管理解消） | existing_code | schema.md の CREATE TABLE 3 箇所は全て「解説/旧/将来案」と注記済み。setup/write は schema.sql のみ流す |
| schema.sql 単一正本が機能する（テーブル/索引/CHECK） | test_output | T1：一時 DB ロードで workflow_log + 索引7、CHECK 制約発火 |
| self-enforce.yml が green を維持できる（audit 非ブロッキング） | test_output + existing_code | T5：audit exit 1 だが continue-on-error で job は赤くならない構成 |
| build がクリーン clone 破綻・誤追跡を生まない | test_output | T3：build 後 diff-zero、`git ls-files .adapters` 空 |
| audit.sh の本リポ非対応は既知の限界（本実装と無関係） | test_output | T5：偽陽性。docs/maintainer/workflow layout 非対応 |

- **inference_only のみに依存する重要判断は無い**（全て test_output / existing_code で裏取り）。

---

## 10. 課題と改善点

### 10.1 発見された課題（残課題）

- **課題1（既知の限界）**: `.agents/enforcement/ci/audit.sh` は `WORKFLOW_DIR=.workflow` を前提とし、本リポの自己拡張 issue（`docs/maintainer/workflow/` 配下）に非対応。そのため `audit.sh .` は適用範囲外の偽陽性で exit 1。
  - **影響範囲**: self-enforce CI の audit step のみ（非ブロッキング化で実害なし）。
  - **対応方法**: 将来 audit.sh に `docs/maintainer/workflow` 対応を追加するか、`.workflow` 運用へ寄せた時点で必須化を検討（後続 issue 候補）。
- **課題2（テストコード未整備）**: 03 フェーズ0 の BDD（クリーン clone → build/setup、`mktemp -d` + `git archive` 方式）に対応する実テストスクリプトは未コミット。本バッチでは手動再実行（T1〜T5）で代替検証。
  - **対応方法**: 後続でクリーン clone 系のテストスクリプト化を検討（self-enforce step がその一部を CI で担保済み）。
- **課題3（issue 全体の未完了）**: 本 issue（配布とパッケージ構成の再設計）は 03 フェーズ1〜5（npm 土台・生成器一般化・multi-tool・marketplace・enforcement 有効化）が未着手。本 verify-and-close は **本バッチ（軽微1・軽微3）の範囲の DoD** を判定するものであり、issue 全体のクローズではない。

### 10.2 改善提案

- schema.md の line 11 の一般プロセス記述（「以下の CREATE TABLE を実行」）は line 30 の「schema.sql が単一正本」で打ち消されているが、表現が重複気味。将来の編集で line 11 を schema.sql 参照へ寄せると更に明快（軽微・任意）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（限定スコープを的確に是正、正本ズレ/二重管理/リーク/クリーン clone 破綻を新たに生まない）。
- **テスト品質**: 良好（T1〜T5 を再実行、全て想定どおり。一時 DB のみ使用で既存 DB 非破壊）。
- **ドキュメント品質**: 良好（schema.md/schema.sql の正本明示、memo 規約準拠）。
- **総合評価**: **承認可（本バッチ範囲）**。指摘は残課題（§10.1）として整理、ブロッカーなし。

### 12.2 承認状況

- **レビュー承認者**: worker（auditor、orchestrator 委譲）
- **承認日**: 2026-06-14
- **承認コメント**: 軽微1・軽微3 の本バッチ DoD を充足。issue 全体（フェーズ1〜5）は後続タスクとして継続。

---

# 【追記バッチ B】フェーズ2 生成器一般化（build-adapters.sh）＋ CI トリガ是正

> **本節は verify-and-close の 2 回目の実行（バッチ B）の成果物。** skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、上記バッチ A（軽微1・軽微3）の後続として、フェーズ2（生成器の一般化）と CI トリガ是正をレビューする。
>
> **レビュー深度**: **standard**（中規模・限定スコープ。生成器の一般化 1 件＋互換ラッパ＋CI トリガ小修正）。
> **evidence_source 凡例**: 本書冒頭の凡例と同一。

---

## B-1. レビュー対象

- **実装範囲**: 直前の implement-feature（chain: implement-change）の成果物。
  - **(フェーズ2)** 生成器を `build-adapters.sh`（共通配備関数＋`adapter_claude`/`adapter_cursor`＋`TOOLS` ディスパッチ）に一般化。`build-plugin-claude.sh` は `exec bash build-adapters.sh claude` の後方互換ラッパ化。claude 出力は diff-zero で不変、cursor を `.adapters/cursor/` に新規生成。
  - **(CI トリガ是正)** `self-enforce.yml` の push トリガを `feature/**` → `main`,`develop` に限定（PR は `pull_request` で検証）。
- **変更ファイル（CHANGED_FILES_JSON）**:
  - `.agents/scripts/build-adapters.sh`（新規）
  - `.agents/scripts/build-plugin-claude.sh`（互換ラッパ化）
  - `.github/workflows/self-enforce.yml`（push トリガ限定）
- **参照 memo**: `memo/20260614_155343_フェーズ2生成器一般化_build-adapters.md`、`memo/20260614_155553_self-enforce_CIトリガ是正.md`
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）

---

## B-2. 実装内容の確認（review-code）

### B-2.1 build-adapters.sh（生成器の一般化）

- **共通配備関数の抽出**: `deploy_skills`/`deploy_commands`/`deploy_agents`/`bundle_agents_src`/`write_generated_marker` を出力ルート引数化で抽出し、`adapter_claude`/`adapter_cursor` から再利用。重複ロジックが関数1本に集約され保守性向上（`existing_code`）。
- **adapter_claude が旧出力を再現するか（リグレッション）**: 旧 HEAD 版 `build-plugin-claude.sh` を一時復元して `.adapters/claude` を生成し、新 `build-adapters.sh claude` の出力と `diff -r` で比較。**唯一の差分は同梱 `.agents/scripts/build-adapters.sh` の有無のみ**（旧版はこの新規スクリプトを除外対象として知らないため同梱、新版は `bundle_agents_src` で `build-adapters.sh` も除外）。**これは意図的な改善（新保守スクリプトの除外）であり、リグレッションではない**（`test_output`、B-3 の T1）。
- **保守スクリプト除外**: `bundle_agents_src` が `setup.sh`/`build-plugin-claude.sh`/`build-adapters.sh` の 3 本を `.agents/scripts/` から除外することを claude/cursor 両方で確認（`test_output`、T2b）。二重管理回避の方針に整合。
- **adapter_cursor の配置**: `.cursor/rules/agents-core.mdc`（正本 `enforcement/cursor/agents-core.mdc` の完全コピー）＋ `.cursor/skills/{domain}__{capability}/` に skills 15 件配備（claude と同数）。`.agents` も同梱。`platforms/SKILLS.md` の Cursor 期待パス `.cursor/skills/<skill-name>/` に整合（`external_spec`＋`test_output`、T3）。
- **ディスパッチ**: 引数 > 環境変数 `TOOLS`（カンマ→空白）> `SUPPORTED_TOOLS="claude cursor"`。未対応ツールは事前ループで全件検査し exit 1（部分生成を残さず先に弾く堅牢な設計）。`TOOLS=cursor,claude` で両生成、`gemini` で exit 1＋日本語エラー確認（`test_output`、T4）。
- **build-plugin-claude.sh ラッパ**: `exec bash "$SCRIPT_DIR/build-adapters.sh" claude` の薄いラッパ。npm `scripts.build:claude` / marketplace 手順 / `docs/maintainer/adapters.md` の既存呼び出しを壊さない（`existing_code`）。

### B-2.2 self-enforce.yml（CI トリガ是正）

- `on.push.branches` を `["feature/**"]` → `["main", "develop"]` に変更。`pull_request:` は既定のまま（PR で必ず検証）。jobs/steps（6 step）は不変（`existing_code`）。
- ユーザー方針「PR では必ず検証／push は merge 先ブランチに限定」に合致。feature ブランチ push のたびに走るノイズを削減しつつ、PR 経由の検証は維持される妥当なトリガ設計（`external_spec`：memo の方針）。

### B-2.3 規約・フォーマット遵守

- memo 2 件は issue の `memo/` 配下に `20260614_155343_`/`20260614_155553_` プレフィックス付き（実行環境 JST 取得規約に合致）（`existing_code`）。
- 04_review は **issue 直下**（`.workflow/` 不使用）に追記。`.agents-project/自己拡張ワークフロー.md` の上書きルール準拠（`external_spec`）。
- 本バッチもテストコード（テストファイル）の新規追加なし。検証は bash スクリプト・CLI・YAML パース・`diff -r`・`git status` の振る舞い検証。TEST_BDD_FORMAT のインラインコメント必須要件は「テストコードが存在する場合」に適用され、本バッチに該当テストコードは無い（クリーン clone 系 BDD のテストコード化は §B-7 課題で別バッチ整理）。

---

## B-3. テスト結果の確認（テスト再実行）

- **実行日**: 2026-06-14 / **実行環境**: bash 5.2.x・python3+pyyaml・git・sqlite3。**既存 `.workflow/workflow.db` への影響**: 無し（書記経由の追記のみ。検証は一時ファイル）。
- **総合**: 成功 7 / 失敗 0。

| # | 検証項目 | 検証方法（コマンド） | 結果 | evidence_source |
| - | ---- | ---- | ---- | ---- |
| T0 | bash 構文チェック | `bash -n .agents/scripts/build-adapters.sh build-plugin-claude.sh` | **OK**（両者 exit 0） | test_output |
| T1 | claude 差分ゼロ（真のリグレッション） | 旧 HEAD 版 build-plugin-claude.sh を一時復元し `.adapters/claude` 生成 → 新 `build-adapters.sh claude` 出力と `diff -r` | **OK（リグレッション無し）**。唯一の差分は同梱 `.agents/scripts/build-adapters.sh` の有無＝意図的な新保守スクリプト除外。出力本体（skills/commands/agents/hooks/plugin.json/GENERATED.md）は完全一致 | test_output |
| T2 | ラッパ差分ゼロ | `bash build-plugin-claude.sh`（`.adapters/claude` 削除後）→ baseline と `diff -r` | **OK**（差分ゼロ。ラッパ経由でも同一出力） | test_output |
| T2b | 保守スクリプト除外 | claude/cursor 両出力の `.agents/scripts/` を確認 | **OK**。setup.sh / build-plugin-claude.sh / build-adapters.sh の 3 本が両ツールで除外。残存は create-pr-review-issue-dir / memo-prefix / new-workflow-memo / write-workflow-log のみ | test_output |
| T3 | cursor 生成構造 | `ls -1A .adapters/cursor`・skills 件数・mdc 一致 | **OK**。top=`.agents`/`.cursor`/`GENERATED.md`、`.cursor/rules/agents-core.mdc`（正本と `diff -q` 一致）、`.cursor/skills` 15 件（claude と同数：`__` 付き 14＋ドメイン直下 `agent` 1） | test_output |
| T4 | ディスパッチ | `TOOLS=cursor,claude bash build-adapters.sh`／`bash build-adapters.sh gemini` | **OK**。前者は claude+cursor 両生成（exit 0）、後者は exit 1＋`未対応のツールです: 'gemini'（対応: claude cursor）` | test_output |
| T5 | YAML パース | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/self-enforce.yml'))"` | **OK**。`on={pull_request:None, push:{branches:[main,develop]}}`、jobs=`self-enforce`、steps=6 | test_output |
| T6 | gitignore／追跡差分 | `git check-ignore .adapters/{claude,cursor}/x`・`git ls-files .adapters`・`git status --porcelain` | **OK**。`.adapters/*` は ignore 済み・`git ls-files .adapters` 空。追跡差分は `M build-plugin-claude.sh`／`M self-enforce.yml`／`?? build-adapters.sh` の **スクリプト/CI のみ**（生成物の混入なし） | test_output |

> 一時生成物（baseline・復元した旧スクリプト）は検証後に削除済み。`.adapters/` は最終クリーン再生成済み（gitignore 対象）。

---

## B-4. コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | ---- | ---- | ---- |
| リグレッション | adapter_claude が旧出力を完全再現するか | OK | 出力本体 diff-zero。唯一差分は意図的な保守スクリプト除外 |
| 一般化の妥当性 | 共通配備関数の抽出で重複が解消されたか | OK | deploy_* に集約、各 adapter から再利用 |
| 規約整合（cursor） | `.cursor/skills/<name>/` 規約に整合するか | OK | SKILLS.md の Cursor 期待パスに一致 |
| ディスパッチ堅牢性 | 未対応ツールで部分生成を残さないか | OK | 生成前に全ツール検査→exit 1 で fail-fast |
| 後方互換 | ラッパが既存呼び出しを壊さないか | OK | `exec build-adapters.sh claude`、出力同一 |
| CI トリガ | push 限定＋PR 検証が方針どおりか | OK | push=main/develop、PR=pull_request |
| リーク/汚染 | 追跡差分がスクリプト/CI のみか | OK | `.adapters` 未追跡・ignore 確認 |
| 命名単一定義 | `{domain}__{capability}` が単一定義か | **△** | B-6 参照。生成器側は deploy_skills に単一集約だが setup.sh sync_skills に同等ロジックが別途存在（既知・スコープ外） |

---

## B-5. 受け入れ基準の確認（generate-scenarios → map-coverage）

| 受け入れ基準（出典） | 寄与する実装 | 検証方法 | 結果 |
| ---- | ---- | ---- | ---- |
| ユースケース1 シナリオ1-2: 生成物が正本から決定的に再生成され正本とズレない（01） | フェーズ2 | T1/T2（claude diff-zero）・T6（追跡差分なし） | **○** |
| シナリオ2-2: `.cursor/`・`.cursor/skills` が生成され gitignore 方針が定義済み（01） | adapter_cursor | T3（cursor 構造）・T6（ignore 確認） | **○** |
| シナリオ2-3/6-1: 同一正本から claude/cursor を同期、`domain__capability` で衝突しない（01） | deploy_skills | T3/T4（両ツール 15 件・プレフィックス一意） | **○** |
| シナリオ7-4: 生成物の正本ズレ検出（再生成と差分なし）（01） | フェーズ2＋self-enforce | T1/T2/T6＋self-enforce step4（build 後 diff-zero） | **○** |
| BR-1: 生成物は正本から決定的に再生成可能・手編集禁止（01） | フェーズ2 | diff-zero 再現性（T1/T2）・GENERATED.md 目印 | **○** |
| 「生成器一般化」（本バッチ要求） | build-adapters.sh | 共通関数＋ディスパッチ＋cursor 対応を実装・検証（T0〜T4） | **○** |
| 「正本ズレを生まない」（本バッチ要求） | フェーズ2 | claude 完全再現・cursor は正本コピー（mdc diff-zero）・追跡差分なし | **○** |
| 「命名規約単一」（本バッチ要求） | deploy_skills | 生成器内は単一集約。ただし setup.sh に同等ロジック残存 | **△**（B-6・課題4） |
| シナリオ2-4: enforcement が非インタラクティブに CI 実行可能（CI トリガ）（01） | self-enforce | T5（YAML 妥当・push 限定・PR 検証） | **○** |

### 未達・要対応（map-coverage）

- **本バッチのスコープ内に機能的未達はなし**（生成器一般化・正本ズレ防止・cursor 生成・CI トリガはすべて ○）。
- **「命名規約単一」は △**: 生成器（build-adapters.sh deploy_skills）内では単一集約され、配備時の規約は単一定義。しかし `setup.sh sync_skills`（in-place 配備）にも `${domain}__${cap_name}` の**独立実装**が残存し、`{domain}__{capability}` の定義が **2 箇所**に存在する（B-6 課題4）。今日時点で両者は文字列上は等価（drift なし）だが、「単一定義」の厳密充足には setup 経路の共通化が必要。本バッチは setup.sh 無改修（スコープ限定）のため、後続課題として整理。
- **スコープ外（別フェーズ/別 issue）**: gemini/copilot/codex の adapter、npm 土台、marketplace リリース、enforcement 有効化等は 03 のフェーズ1〜5 に属し本バッチ対象外。

---

## B-6. 設計・境界の確認（review-architecture）

- **設計原則の準拠**: 単一責務（共通配備＝`deploy_*`／ツール差分＝`adapter_<tool>`／ディスパッチ＝`main`）に分離。UNIX 哲学（小さな関数の合成）に整合。`SUPPORTED_TOOLS` 登録＋`adapter_<tool>()` 追加で拡張できる開放/閉鎖な構造（`external_spec`：memo・SKILLS.md）。
- **境界・依存**: build-adapters.sh → 正本 `.agents/`（skills/commands/agents・plugin.json・agents-core.mdc）への一方向依存。生成物 `.adapters/` は 100% 派生で手書き土台は正本側（plugin.json・mdc）に分離。循環なし。
- **後方互換**: build-plugin-claude.sh はラッパとして責務を委譲。出力は claude adapter と同一（diff-zero）。
- **新たな破綻の有無**: claude diff-zero・cursor 正本コピー一致・`.adapters` 未追跡を T1〜T6 で確認。クリーン clone 破綻・リーク・正本分裂を**新たに生まない**（`test_output`）。
- **指摘（課題4／命名の二重定義）**: `{domain}__{capability}` の算出が build-adapters.sh:53（`deploy_skills`）と setup.sh:97（`sync_skills`）の 2 箇所に存在。**今日時点で両者は等価**（`${domain}__${cap}`）だが、将来片方のみ変更すると drift する設計上のリスク。加えて両者には微差があり、setup.sh は `SKILL.md` **または** `README.md` で配備しドメイン直下 SKILL.md（`agent`）を特別扱いしない一方、build-adapters.sh は `SKILL.md` 必須でドメイン直下 SKILL.md を `{domain}` 単独名で配備する（`agent` skill の扱いが非対称）。**本バッチは setup.sh 無改修のため許容範囲だが、命名規約の真の単一化には配備ロジックの共通モジュール化が望ましい**（後続課題）。evidence_source: `existing_code`（両ファイルの該当行）。

### B-6.1 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| ---- | ---- | ---- |
| adapter_claude が旧出力を完全再現（リグレッション無し） | test_output | T1：旧 HEAD 版と `diff -r`、本体一致・唯一差分は意図的除外 |
| cursor 配置が SKILLS.md 規約に整合 | external_spec + test_output | `.cursor/skills/<name>/`／mdc は正本と `diff -q` 一致 |
| 追跡差分がスクリプト/CI のみ・生成物は未追跡 | test_output | T6：`git status --porcelain`・`git ls-files .adapters` 空 |
| CI トリガ（push=main/develop, PR=pull_request）が妥当 | external_spec + test_output | memo の方針＋T5 の YAML 構造 |
| 命名 `{domain}__{capability}` が setup.sh と二重定義（△） | existing_code | build-adapters.sh:53 と setup.sh:97。今日は等価だが drift リスク |

- **inference_only のみに依存する重要判断は無い**（全て test_output / existing_code / external_spec で裏取り）。

---

## B-7. 課題と改善点（残課題）

- **課題4（命名規約の二重定義・本バッチで顕在化）**: `{domain}__{capability}` の配備ロジックが build-adapters.sh（`deploy_skills`）と setup.sh（`sync_skills`）に独立して存在。今日は等価だが drift リスクあり、かつ `agent` ドメイン直下 SKILL.md の扱いに微差。**対応方法**: 配備ロジックを共有モジュール（`lib/deploy-skills.sh` 等）に切り出し setup.sh から source する案を後続 issue で検討。本バッチは setup.sh 無改修のため非ブロッカー。
- **課題5（gemini/copilot/codex 未対応）**: 配置パス確認待ちで未実装。`SUPPORTED_TOOLS` 追加＋`adapter_<tool>()` 新設で拡張可能な構造は用意済み。後続タスク。
- **課題6（クリーン clone 系テストコード未整備）**: バッチ A の課題2 を継続。self-enforce step4 が build diff-zero を CI で担保するが、`git archive` 方式のクリーン clone テストスクリプトは未コミット。後続で検討。

---

## B-8. レビュー結果（バッチ B）

- **実装品質**: 良好（claude 完全再現＋cursor 新規対応で生成器を的確に一般化。正本ズレ/リーク/クリーン clone 破綻を新たに生まない）。
- **テスト品質**: 良好（T0〜T6 を再実行、全て想定どおり。既存 DB 非破壊）。
- **ドキュメント品質**: 良好（memo 2 件プレフィックス準拠、コメントで正本所在を明示）。
- **総合評価**: **承認可（本バッチ範囲）**。機能的ブロッカーなし。命名規約の真の単一化（課題4）のみ後続課題として残す（△、非ブロッカー）。
- **承認者**: worker（auditor、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・テスト再実行記載済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由）。

---

# 【追記バッチ C】課題4 命名二重定義の共有ライブラリ化

> **本節は verify-and-close の 3 回目の実行（バッチ C）の成果物。** skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、バッチ B の §B-7 課題4（命名規約 `{domain}__{capability}` の二重定義）を解消する implement-feature 成果物をレビューする。
>
> **レビュー深度**: **standard**（中規模・限定スコープ。配備ロジックの共有ライブラリ抽出＋2 スクリプトのラッパ化）。
> **evidence_source 凡例**: 本書冒頭（§1.2 直下）の凡例と同一。

---

## C-1. レビュー対象

- **実装範囲**: 直前の implement-feature（chain: implement-change）の成果物。バッチ B 課題4 の解消。
  - **(課題4 解消)** `{domain}__{capability}` のスキル配備ロジックを共有ライブラリ `lib/deploy-skills.sh`（関数 `deploy_skills_impl <src> <out>` の単一正本）へ統合。build-adapters.sh と setup.sh が同 lib を source し、それぞれ薄いラッパ（`deploy_skills` / `sync_skills`）に降格。命名・ドメイン直下 SKILL.md 配備の算出を 1 箇所に集約。
- **変更/新規ファイル（CHANGED_FILES_JSON）**:
  - `.agents/scripts/lib/deploy-skills.sh`（新規・配備関数の単一正本）
  - `.agents/scripts/build-adapters.sh`（lib を source、`deploy_skills` を薄いラッパ化、`bundle_agents_src` の除外に新 lib／`lib/` を追加）
  - `.agents/scripts/setup.sh`（lib を source、`sync_skills` を `deploy_skills_impl` 委譲の薄いラッパ化）
- **参照 memo**: issue `memo/` 配下（実装者作成分）。
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）。

---

## C-2. 実装内容の確認（review-code）

### C-2.1 共有ライブラリ `lib/deploy-skills.sh`（命名規約の単一正本）

- **責務集約**: `deploy_skills_impl <src_skills_dir> <out_skills_dir>` が、(1) ドメイン直下 `{domain}/SKILL.md` を `{domain}/` に配備、(2) capability `{domain}/{capability}/SKILL.md` を `{domain}__{capability}/` に配備、の双方を担う。配備件数を標準出力で返し、メッセージ整形は呼び出し側に委譲する設計（単一責任）（`existing_code`）。
- **命名規約の一本化**: `${domain}__${cap}` の算出はこの 1 関数のみに存在。冒頭コメントで「他で再実装しないこと」「参照: platforms/DESIGN_SYNC_SKILLS_NAMING.md, platforms/SKILLS.md」を明示（`existing_code`）。
- **配布物への非同梱を自己言及**: 冒頭コメントに「保守/導入専用スクリプトでありアダプタには同梱しない（build-adapters.sh の bundle_agents_src 除外対象）」と明記。実装（後述 C-2.2 の除外）と整合（`existing_code`）。

### C-2.2 build-adapters.sh（薄いラッパ化＋除外追加）

- `. "$SCRIPT_DIR/lib/deploy-skills.sh"` を source し、`deploy_skills()` は `deploy_skills_impl "$AGENTS/skills" "$out_skills"` へ委譲する薄いラッパに降格。重複ロジックは消滅（`existing_code`）。
- `bundle_agents_src()` の除外に新 lib を追加：`rm -f .../build-adapters.sh` に加え `rm -rf "$out/.agents/scripts/lib"` を実行。**配布物（.adapters）に保守専用 lib をリークさせない**点を実測で確認（C-3 T_lib）（`test_output`）。

### C-2.3 setup.sh（薄いラッパ化）

- `. "$SCRIPT_DIR/lib/deploy-skills.sh"` を source し、`sync_skills()` は「`rm -rf "$dest_root"` の後 `deploy_skills_impl "$agents_skills" "$dest_root" >/dev/null`」へ委譲。HEAD 版に在ったインラインの `${domain}__${cap_name}` 算出ループは削除され、**命名算出の重複が解消**（`existing_code`）。
- **非対称の解消**: HEAD 版 `sync_skills` は capability サブディレクトリのみを走査し、ドメイン直下 SKILL.md（`agent`）を配備しなかった（→14 件）。新 lib 委譲により build と同じ規則になり、ドメイン直下 `agent` も配備され **15 件**で build 出力と一致（C-3 T_setup）（`test_output`）。

### C-2.4 規約・フォーマット遵守

- 04_review は **issue 直下**（`docs/maintainer/workflow/.../`、`.workflow/` 不使用）へ追記。`.agents-project/自己拡張ワークフロー.md` の上書きルール準拠（`external_spec`）。
- 本バッチもテストコード（テストファイル）の新規追加なし。検証は bash スクリプト・CLI・`diff -r`・`git status` の振る舞い検証で行う。TEST_BDD_FORMAT のインラインコメント必須要件は「テストコードが存在する場合」に適用され、本バッチに該当テストコードは無い（クリーン clone 系 BDD のテストコード化はバッチ A 課題2／バッチ B 課題6 として継続）。

---

## C-3. テスト結果の確認（テスト再実行）

- **実行日**: 2026-06-14 / **実行環境**: bash 5.2.x・git・sqlite3・python3。**既存 `.workflow/workflow.db` への影響**: 無し（検証は隔離した一時 PROJECT_ROOT と一時ディレクトリのみ。本リポの `.claude`/`.cursor` は非破壊）。
- **総合**: 成功 6 / 失敗 0。

| # | 検証項目 | 検証方法（コマンド） | 結果 | evidence_source |
| - | ---- | ---- | ---- | ---- |
| T_n | bash 構文（全 8 本） | `bash -n` を `.agents/scripts/*.sh`（7 本）＋`.agents/scripts/lib/*.sh`（1 本） | **OK**（全 8 本 exit 0）：build-adapters / build-plugin-claude / create-pr-review-issue-dir / memo-prefix / new-workflow-memo / setup / write-workflow-log / lib/deploy-skills | test_output |
| T_A | (A) build diff-zero | HEAD 版 build-adapters.sh を実体パスに一時復元して `.adapters/{claude,cursor}` を生成 → 新版出力と `diff -r` | **OK**。唯一の差分は HEAD 側に同梱される `.agents/scripts/lib`（HEAD は新 lib を除外対象として知らないため bundle 同梱）。当該 lib を除いた**本体は完全 diff-zero**。新版は意図どおり lib を除外 | test_output |
| T_lib | 配布物への lib リーク無し | 新版 build 後 `.adapters/claude/.agents/scripts/` を確認 | **OK**。`lib/`・`setup.sh`・`build-adapters.sh` いずれも非同梱。残存は create-pr-review-issue-dir / memo-prefix / new-workflow-memo / write-workflow-log のみ | test_output |
| T_setup | (B) setup 自己再インストール | 隔離 PROJECT_ROOT に `setup.sh "$PROJ"` 実行 → `.claude/skills`・`.cursor/skills` 件数・命名・build との集合一致 | **OK**。両者 **15 件**（`{domain}__{capability}` 14＋ドメイン直下 `agent` 1）。`diff` で build 出力 `.adapters/claude/skills` と**集合完全一致**。HEAD 版 setup は 14 件で、差分は `agent` の追加のみ（配備落ちゼロ） | test_output |
| T_drop | 配備落ちゼロ（README-only 不在） | 全 capability サブディレクトリの SKILL.md 有無を走査 | **OK**。SKILL.md 欠如の capability 0 件。`SKILL.md OR README.md`→`SKILL.md only` への厳格化で落ちる capability は存在しない（ドメイン直下 README は capability ではなく索引のため非配備対象） | test_output |
| T_D | (D) `.adapters` 未追跡・ignore | `git ls-files .adapters`・`git check-ignore .adapters/`・`.gitignore` 確認 | **OK**。`git ls-files .adapters` 空（0 件）、`.adapters/` は ignore 済み（`.gitignore:21 /.adapters/`） | test_output |

> 検証用の一時 PROJECT_ROOT・一時復元した HEAD スクリプト・`.adapters/{claude,cursor}` は検証後に削除し、`.agents/scripts/build-adapters.sh`・`setup.sh` は元の作業ツリー内容へ復元済み（`diff -q` で同一確認）。最終作業ツリーは `M build-adapters.sh`・`M setup.sh`・`?? lib/` の 3 点のみ。

---

## C-4. コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | ---- | ---- | ---- |
| 命名単一定義 | `{domain}__{capability}` の算出が 1 箇所か | **OK** | `lib/deploy-skills.sh` の `deploy_skills_impl` のみ。build/setup は委譲ラッパ。課題4（バッチ B の △）解消 |
| 二重管理解消 | setup.sh のインライン命名ループが除去されたか | OK | HEAD の `${domain}__${cap_name}` ループを削除し lib 委譲へ |
| リグレッション無し | build 出力本体が不変か | OK | 本体 diff-zero（差分は意図的な lib 除外のみ） |
| 配布物リーク無し | lib が `.adapters` に同梱されないか | OK | `bundle_agents_src` で `lib/` 除外。T_lib で実測 |
| 配備落ち無し | 厳格化で skill が消えないか | OK | 全 capability に SKILL.md 在り。T_drop |
| 非対称解消 | setup と build の配備規則が一致したか | OK | 共に 15 件・集合一致。`agent` ドメイン直下が両経路で配備 |
| クリーン clone 破綻無し | 追跡差分がスクリプトのみか | OK | `M build-adapters.sh`・`M setup.sh`・`?? lib/` のみ。生成物混入なし |

---

## C-5. 受け入れ基準の確認（generate-scenarios → map-coverage）

| 受け入れ基準（出典） | 寄与する実装 | 検証方法 | 結果 |
| ---- | ---- | ---- | ---- |
| 「命名規約の単一正本化」（バッチ B 課題4・本バッチ要求） | lib/deploy-skills.sh | 算出は `deploy_skills_impl` の 1 箇所。build/setup は委譲（existing_code）＋T_setup の集合一致 | **○** |
| シナリオ2-3/6-1: 同一正本から claude/setup を同期、`domain__capability` で衝突しない（01） | deploy_skills_impl | T_A（build 本体不変）＋T_setup（setup＝build 集合一致・15 件一意） | **○** |
| シナリオ1-2/7-4: 生成物が正本から決定的に再生成され正本とズレない（01） | build ラッパ | T_A（本体 diff-zero）＋T_D（追跡差分なし） | **○** |
| BR-6 相当（正本単一・複製箇所は完全一致）の配備版（01） | lib 集約 | 配備ロジック実体は lib のみ。build/setup は同一関数を共有 | **○** |
| 配布物リーク防止（本バッチ要求・02 §6.2） | bundle_agents_src 除外 | T_lib（lib 非同梱）＋T_D（`.adapters` 未追跡・ignore） | **○** |
| 配備落ちゼロ（本バッチ要求） | SKILL.md-only 厳格化 | T_drop（README-only capability 不在）＋T_setup（14→15 で減少なし） | **○** |

### 未達・要対応（map-coverage）

- **本バッチのスコープ内に未達はなし**。命名規約の単一正本化・配布物リーク防止・配備落ちゼロ・非対称解消はすべて ○。バッチ B §B-7 の課題4（△）は本バッチで**解消**（命名算出が単一定義へ）。
- **スコープ外（別フェーズ/別 issue）**: gemini/copilot/codex の adapter（バッチ B 課題5）、クリーン clone 系テストコード化（バッチ A 課題2／バッチ B 課題6）、npm 土台・marketplace・enforcement 有効化（03 フェーズ1〜5）は本バッチ対象外として継続。

---

## C-6. 設計・境界の確認（review-architecture）

- **設計原則の準拠**: 単一責務（配備＝`deploy_skills_impl` 1 関数／呼び出し側＝メッセージ整形・配備先決定）に分離。`{domain}__{capability}` 算出を 1 箇所へ集約し DRY を達成。UNIX 哲学（小さな共有関数の合成）に整合（`external_spec`：platforms/DESIGN_SYNC_SKILLS_NAMING.md, SKILLS.md）。
- **境界・依存**: build-adapters.sh・setup.sh → `lib/deploy-skills.sh` → 正本 `.agents/skills/` の一方向依存。循環なし。lib は純粋な配備関数で外部レジストリ・未整備ツール非依存。
- **配布物の境界**: lib は保守/導入専用として `.adapters` から除外（`bundle_agents_src`）。正本側（`.agents/scripts/lib/`）に置き、生成物 `.adapters/` には派生スキルのみ。境界が明瞭。
- **後方互換**: build-adapters.sh の出力本体・setup.sh のラッパ I/F（`sync_skills <dest_root> [<src>]`）は不変。build-plugin-claude.sh ラッパ経由の既存呼び出しも壊さない（出力本体 diff-zero）。
- **新たな破綻の有無**: build 本体 diff-zero・setup 集合一致・lib 非同梱・`.adapters` 未追跡を T_A/T_setup/T_lib/T_D で確認。正本ズレ・二重管理・クリーン clone 破綻・配布物リークを**新たに生まない**（`test_output`）。
- **指摘・推奨**: なし（standard 深度で承認可能）。

### C-6.1 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| ---- | ---- | ---- |
| 命名 `{domain}__{capability}` が単一定義に集約された | existing_code + test_output | lib の 1 関数のみが算出。build/setup は委譲。T_setup で集合一致 |
| build 出力本体が不変（リグレッション無し） | test_output | T_A：HEAD 版と `diff -r`、唯一差分は意図的な lib 除外。本体完全一致 |
| 配布物（.adapters）に lib がリークしない | test_output | T_lib：`bundle_agents_src` で `lib/` 除外、実測で非同梱 |
| setup の配備が 14→15 で配備落ちゼロ・非対称解消 | test_output | T_setup（15 件・build と集合一致）＋T_drop（README-only 不在） |
| `.adapters` 未追跡・ignore（クリーン clone 破綻無し） | test_output | T_D：`git ls-files .adapters` 空・`check-ignore` 真 |

- **inference_only のみに依存する重要判断は無い**（全て test_output / existing_code / external_spec で裏取り）。

---

## C-7. 課題と改善点（残課題）

- **課題4: 解消**（本バッチで完了）。命名 `{domain}__{capability}` の配備ロジックが `lib/deploy-skills.sh` の単一正本に集約され、build/setup の二重定義が解消された。
- **課題5（gemini/copilot/codex 未対応）**: 継続（バッチ B から）。`SUPPORTED_TOOLS` 追加＋`adapter_<tool>()` で拡張可能な構造は維持。
- **課題6（クリーン clone 系テストコード未整備）**: 継続（バッチ A 課題2／バッチ B 課題6）。self-enforce step4 が build diff-zero を CI で担保するが、`git archive` 方式のクリーン clone テストスクリプトは未コミット。
- **改善提案（軽微・任意）**: self-enforce.yml の build 差分ゼロ step に、新 lib が `.adapters` に同梱されていないこと（`! git ls-files .adapters | grep -q lib` 相当）の明示的アサーションを追加すると、将来の `bundle_agents_src` 除外漏れを CI で早期検出できる。本バッチ範囲外の任意提案。

---

## C-8. レビュー結果（バッチ C）

- **実装品質**: 良好（命名算出を共有 lib の単一正本へ集約し課題4 を解消。build 本体 diff-zero、setup 非対称解消、配布物リーク・配備落ち・クリーン clone 破綻を新たに生まない）。
- **テスト品質**: 良好（T_n/T_A/T_lib/T_setup/T_drop/T_D を再実行、全て想定どおり。既存 `.workflow/workflow.db` および本リポ `.claude`/`.cursor` 非破壊）。
- **ドキュメント品質**: 良好（lib 冒頭コメントで命名正本の所在・非同梱方針を明示）。
- **総合評価**: **承認可（本バッチ範囲・ブロッカーなし）**。バッチ B の課題4（△）を解消。残課題は課題5・課題6 のみ（いずれも非ブロッカー・後続継続）。
- **承認者**: worker（auditor、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・テスト再実行（A〜D＋構文＋配備落ち）記載済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md)・[`01_要件定義.md`](./01_要件定義.md)・[`02_設計.md`](./02_設計.md)・[`03_実装計画.md`](./03_実装計画.md)
- [`memo/20260614_153629_軽微1schema単一化_軽微3自己CI実体化.md`](./memo/20260614_153629_軽微1schema単一化_軽微3自己CI実体化.md)
- [`memo/20260614_155343_フェーズ2生成器一般化_build-adapters.md`](./memo/20260614_155343_フェーズ2生成器一般化_build-adapters.md)
- [`memo/20260614_155553_self-enforce_CIトリガ是正.md`](./memo/20260614_155553_self-enforce_CIトリガ是正.md)
- `.agents/ledger/schema.sql`・`.agents/ledger/schema.md`・`.github/workflows/self-enforce.yml`
- `.agents/scripts/build-adapters.sh`・`.agents/scripts/build-plugin-claude.sh`・`.agents/scripts/setup.sh`・`.agents/scripts/lib/deploy-skills.sh`・`.agents/scripts/write-workflow-log.sh`・`.agents/enforcement/ci/audit.sh`
- `.agents/platforms/SKILLS.md`・`.agents/platforms/DESIGN_SYNC_SKILLS_NAMING.md`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) ＋ implement-feature（chain: implement-change）成果物。

## 15. 次のステップ

- 本バッチ範囲はクローズ可。issue 全体は 03 フェーズ1〜5 を後続タスクで継続。
- 証跡: write-workflow-log.sh により workflow.db へ verify-and-close を記録（step 5）。

---

# 【追記バッチ D】フェーズ1 npm 土台の仕上げ（pack 検証固定化・README 導入手順）

> **本節は verify-and-close の 4 回目の実行（バッチ D）の成果物。** skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、03 §2.2 タスク2 のうち **(3) `npm pack --dry-run` 検証の固定化**と **(4) README 導入手順の整備**（フェーズ1 npm 土台の仕上げ）をレビューする。
>
> **レビュー深度**: **standard**（限定スコープ。新規スクリプト1・CI step 追加1・README 改稿1。配布物リーク防止の検証固定化と導入導線の文書化）。
> **evidence_source 凡例**: `test_output`（本バッチで再実行したコマンドの出力）／`existing_code`（対象ファイルの該当行）／`external_spec`（00/01/03・package.json files 等の契約）／`inference_only`（推論のみ。重要判断では不可）。

---

## D-1. レビュー対象

- **実装範囲**: 直前の implement-feature の成果物（フェーズ1 npm 土台の仕上げ）。03 §2.2.2 (3)(4)。
  - **(3 固定化)** `npm pack --dry-run --json` のリーク／必須物検査を**単一正本スクリプト**化し、CI とローカルで二重化しない。
  - **(4 README)** npm 主導線（`npx @techbeansjp-free/agents-md init`・サブコマンド・版ピン留め）と Claude marketplace 副導線を README に整備。
- **変更/新規ファイル（CHANGED_FILES_JSON）**:
  - `.agents/scripts/verify-npm-pack.sh`（新規・実行権限 `-rwxr-xr-x`）— pack リーク検査の単一正本。
  - `.github/workflows/self-enforce.yml`（変更）— 「npm pack leak check」step を audit step の前に追加（スクリプト呼出のみ）。
  - `README.md`（変更）— npm 主導線・サブコマンド表・版ピン留め＋marketplace 副導線。
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）。

---

## D-2. 実装内容の確認（review-code）

### D-2.1 `verify-npm-pack.sh`（pack リーク検査の単一正本）

- **検証ロジックの一本化**: 冒頭コメントで「検証ロジックはこのスクリプト1か所のみに置き、CI とローカル双方がこれを呼ぶ。二重化しない」と明示（`existing_code`）。CI（self-enforce.yml step6）は `bash .agents/scripts/verify-npm-pack.sh` を呼ぶだけで、判定ロジックを持たない（`existing_code`）。要求の「リーク／汚染防止ガードを自動検証」（00 §2.2・SC-3）に整合（`external_spec`）。
- **禁止パターン**（リポ固有物）: `.agents-project/`・`docs/maintainer/`・`workflow.db`（`-shm`/`-wal` 含む `[-.]` 後続）・`.adapters/`・`.workflow/`（`templates/` 以外）を正規表現でパスごとに判定し、1 件でも該当すれば `failed=true`（`existing_code`）。01 シナリオ5-1 の受け入れ基準「公開対象から `.agents-project/`・`docs/maintainer/`・`workflow.db`・`.workflow/`（templates 除く）が除外される」に対応（`external_spec`）。
- **必須パターン**（正本配布物）: `.agents/`・`AGENTS.md`・`CLAUDE.md`・`bin/agents-md.js`・`README.md`・`package.json`・`.workflow/templates/` の存在を assert。`package.json` の `files` フィールド（`[".agents/","AGENTS.md","CLAUDE.md",".workflow/templates/","bin/","README.md"]`）と整合（`existing_code`・`external_spec`）。
- **終了コード規約**: 違反時 `exit 1`、npm/node 不在時 `exit 2`（スキップせず明示的に失敗）、合格時 `exit 0`。`set -euo pipefail` 採用。判定は node に委譲（パスごとの厳密判定が bash の grep より容易、という設計判断をコメントで明示）（`existing_code`）。01 §「整合検証・リーク検査は終了コードで成否を返し CI から判定できる」に整合（`external_spec`）。
- **`pack_json` の取得**: `npm pack --dry-run --json 2>/dev/null` で stdout のみを node に渡し、進捗ノイズ（stderr）を排除。`--dry-run` のため tarball を生成しない（副作用なし）（`existing_code`）。

### D-2.2 `self-enforce.yml`（CI への組込み）

- **step 追加位置**: 「npm pack leak check (verify-npm-pack.sh)」を **step6**（diff-zero check の後・enforcement audit の前）に追加。スクリプトを呼ぶだけで CI 側にロジック重複なし（`existing_code`・`test_output` D-3 T5）。
- **冒頭コメント整合**: ファイル先頭の検証内容コメントに「4. npm 配布物リーク検査（npm pack --dry-run）」が追記され、step 実体と一致（`existing_code`）。
- **非ブロッカー audit との順序**: leak check は blocking（`set -e`）、後続の audit は `continue-on-error: true`。リーク検査が実質的な配布物ガードとして機能する配置（`existing_code`）。

### D-2.3 `README.md`（導入手順）

- **主導線（npm）**: §「導入」に `cd my-project && npx @techbeansjp-free/agents-md init` を主導線として明記。サブコマンド表（`init`/`upgrade`/`doctor`/`version`/`help`）が `bin/agents-md.js` の `main()` switch・`printHelp()` と**齟齬なく一致**（`existing_code` 照合: README 表 ↔ bin 実装）。
- **版のピン留め**: `@0.1.0`・`@latest upgrade`・`doctor` のコマンド例を記載。`package.json` の `version: 0.1.0` と一致（`external_spec`）。`node bin/agents-md.js version` の出力 `0.1.0` とも一致（`test_output` D-3 T6）。
- **副導線（marketplace）**: `/plugin marketplace add` ＋ `/plugin install agents-package` を副導線として併記。参照する `build-adapters.sh`・`docs/maintainer/adapters.md`・`marketplace.json`・`setup.sh` がいずれも実在（`test_output` D-3 T7）。`marketplace.json` の `source: "./.adapters/claude"` と「生成物は正本から生成」の説明が整合（`existing_code`）。
- **scope 名の注記**: README は npm スコープ名が暫定・未確定である旨を明記し、03 のリスク（スコープ未確定で publish 不可、dry-run までで受け入れ）と整合（`external_spec`）。

### D-2.4 テストコード化の網羅（PHASES 監査観点）

- 本バッチは**テストコード（テストファイル）の新規追加なし**。検証は bash スクリプト・`npm pack --dry-run` の振る舞い検証・YAML パース・README↔bin の静的照合で行う。TEST_BDD_FORMAT のインラインコメント必須要件は「テストコードが存在する場合」に適用され、本バッチに該当テストコードは無い。
- 01 シナリオ5-1・03 §2.2.4 の BDD（`npm pack --dry-run` でリポ固有物が含まれないこと）は、**`verify-npm-pack.sh` 自体が実行可能な検証スクリプトとしてシナリオをコード化**しており、CI（self-enforce step6）で恒常実行される。03 §2.2.4 のテストコード例（`grep -qiE 'agents-project|docs/maintainer|workflow\.db|\.adapters/'`）と同等以上の判定をスクリプトが担う（`existing_code`）。`node bin/agents-md.js version`／`help`／不明コマンドの単体ケース（03 §2.2.3）は D-3 T6 で再実行・確認。クリーン clone 系（`git archive` 方式）のテストスクリプト未コミットはバッチ A 課題2／バッチ B 課題6 として継続（本バッチ範囲外）。

---

## D-3. テスト結果の確認（テスト再実行）

実行環境: node v20.19.5 / npm 10.8.2（03 が想定する npm 10.x / node v20.x に合致。`test_output`）。リポジトリルートで再実行。

| ID | 検証内容 | コマンド | 結果 | evidence_source |
|----|----------|----------|------|------------------|
| T1 | 構文チェック | `bash -n .agents/scripts/verify-npm-pack.sh` | **OK**（exit 0） | `test_output` |
| T2 | pack 検査・正例 | `bash .agents/scripts/verify-npm-pack.sh` | **OK**: 配布158件・リーク0件・必須物すべて存在・**exit 0** | `test_output` |
| T3 | pack 検査・負例 | `.agents/sub/.agents-project/leak.md` を注入→検査→削除 | **検出 OK**: `LEAK: .agents/sub/.agents-project/leak.md` を報告し **exit 1**。検査後にファイル削除・`git status` クリーン復帰を確認 | `test_output` |
| T4 | dry-run 直接確認（01 シナリオ5-1） | `npm pack --dry-run --json` のファイル一覧を node で抽出し grep | **OK**: `agents-project\|docs/maintainer\|workflow.db\|.adapters/` 0 件、`.workflow/` は `templates/` のみ、必須物（.agents/・AGENTS.md・CLAUDE.md・bin・README・package.json・templates）すべて存在 | `test_output` |
| T5 | self-enforce.yml YAML 妥当性 | `python3` `yaml.safe_load` | **OK**: パース成功・**steps 7 件**・leak check（step6）が audit（step7）の**前**に配置 | `test_output` |
| T6 | bin 単体（03 §2.2.3） | `node bin/agents-md.js version`/`help`/`bogus` | **OK**: version=`0.1.0`(exit0)・help(exit0)・不明(exit1) | `test_output` |
| T7 | README 副導線の参照先実在 | `build-adapters.sh`・`docs/maintainer/adapters.md`・`marketplace.json`・`setup.sh` の存在確認 | **OK**: すべて実在（導線が破綻しない） | `test_output` |
| T8 | README↔bin/package.json 整合 | scope 名・サブコマンド表の静的照合 | **OK**: scope=`@techbeansjp-free/agents-md` 一致、サブコマンド `init/upgrade/doctor/version/help` が bin の switch と一致 | `existing_code` |

- **テスト後のリポ状態**: `git status --porcelain` は本バッチ 3 ファイル（` M .github/workflows/self-enforce.yml`・` M README.md`・`?? .agents/scripts/verify-npm-pack.sh`）のみ。T3 の注入物は削除済みで残骸なし（`test_output`）。
- **実行権限**: `verify-npm-pack.sh` は `-rwxr-xr-x`（実行権限あり）（`test_output`）。

---

## D-4. コードレビュー観点

| 観点 | 確認内容 | 判定 | 根拠 |
|------|----------|------|------|
| 検証ロジック単一化 | pack 検査が 1 か所か | **OK** | `verify-npm-pack.sh` のみ。CI は呼出のみ（`existing_code`） |
| 配布物リーク防止 | 禁止パターンを assert・負例で検出 | **OK** | T2（正例 exit0）・T3（負例 exit1 検出）（`test_output`） |
| 必須物の充足 | 正本配布物を assert | **OK** | T2・T4（必須物すべて存在）（`test_output`） |
| 終了コード規約 | 違反 exit1・npm/node 不在 exit2 | **OK** | スクリプト分岐（`existing_code`） |
| CI 組込み | leak step が audit 前・blocking | **OK** | T5（step6<step7・set -e）（`test_output`） |
| README↔実装整合 | サブコマンド・scope・版が bin/package.json と一致 | **OK** | T6・T8（`test_output`・`existing_code`） |
| 導線の非破綻 | README 参照先が実在 | **OK** | T7（`test_output`） |
| 規約・命名・配置 | `.agents/scripts/` 配下・`set -euo pipefail`・コメントで正本性明示 | **OK** | `existing_code` |

- **inference_only 依存の重要判断**: なし。承認に関わる判断はすべて `test_output` または `existing_code`／`external_spec` で裏取り済み。

---

## D-5. 受け入れ基準の確認（generate-scenarios → map-coverage）

本バッチはフェーズ1 npm 土台の仕上げ（限定スコープ）。本バッチが直接寄与する基準に絞ってカバレッジを示す。

| 基準（出典） | 実装 | 検証方法・結果 | 判定 |
|--------------|------|----------------|------|
| 配布物リーク防止「公開対象から `.agents-project/`・`docs/maintainer/`・`workflow.db`・`.workflow/`(templates除く) が除外」（01 シナリオ5-1・00 SC-3） | `verify-npm-pack.sh` 禁止パターン | T2・T4（リーク0件）・T3（負例検出） | **○** |
| 配布物に必須の正本物が含まれる（01 シナリオ5-1） | `verify-npm-pack.sh` 必須パターン | T2・T4（必須物すべて存在） | **○** |
| 「整合検証・リーク検査は終了コードで成否を返し CI から判定できる」（01 §非機能） | exit code 規約＋self-enforce step6 | T1/T2/T3（exit 0/1）・T5（CI step blocking） | **○** |
| 版のピン留め・アップグレード手順が存在し実証できる（00 SC-2） | README §導入（`@0.1.0`/`upgrade`/`doctor`）＋bin | T6（version=0.1.0）・T8（README↔bin 一致） | **○** |
| npm 主導線が文書化され bin と齟齬がない（03 §2.2.2(4)） | README サブコマンド表・主導線 | T8（scope・サブコマンド一致）・T7（副導線参照先実在） | **○** |

### カバレッジ評価

- **本バッチのスコープ内に未達はなし**。寄与基準（リーク防止固定化・必須物充足・終了コード規約・版ピン留め文書化・README↔bin 整合）はすべて ○。
- **スコープ外（別フェーズ／別 issue）**: 00 SC-1（マーケットプレイス土台のクリーン clone 実証）・SC-4・SC-5、01 のユースケース1〜4/6/7、実 publish（スコープ/レジストリ確定後）、クリーン clone 系テストコード化（バッチ A 課題2／バッチ B 課題6）は本バッチ対象外として継続。

---

## D-6. 設計・境界の確認（review-architecture）

- **責務分離**: 「検証ロジック（`verify-npm-pack.sh`）」「呼出オーケストレーション（self-enforce.yml step6）」「人間向け導線（README）」が分離され、ロジックの二重化がない。CI とローカルが同一スクリプトを呼ぶ単一正本構造（00 §2.2 リーク／汚染防止ガードの要件に整合）（`existing_code`・`external_spec`）。
- **正本ズレを生まないこと**: 配布対象の定義は `package.json` の `files` フィールドが正本で、`verify-npm-pack.sh` の必須パターンはそれを検査する（重複定義ではなく検証）。README のサブコマンドは `bin/agents-md.js` を正とし、README は説明に徹する（実装が正本）（`existing_code`）。
- **新たな破綻・汚染の有無**: テスト再実行後も追跡ファイルへの差分は本バッチ 3 ファイルのみ。T3 注入物は削除済み。`verify-npm-pack.sh` は `.agents/scripts/` 配下のため、それ自身が配布物（`.agents/`）に含まれる正本物として妥当（リーク対象ではない）（`test_output`・`existing_code`）。本バッチは正本ズレ・配布物汚染を**新たに生まない**。
- **指摘（軽微・任意・非ブロッカー）**: `verify-npm-pack.sh` の必須パターンと `package.json` の `files` は概念的に対応するが別定義のため、将来 `files` を変更しても必須パターンが追従しない可能性がある（今日時点では一致・drift なし、`test_output` で確認済み）。将来 `files` を変更した際に必須パターンも見直す運用、または `files` から必須リストを導出する案を後続で検討可能。本バッチ範囲外の任意提案（`existing_code`）。

---

## D-7. 課題と改善点（残課題）

- **課題7（実 publish 未実施）**: スコープ/レジストリ未確定のため `npm publish` は未実施。本フェーズは `--dry-run` までで受け入れ（03 §2.2.3 E2E と整合・想定どおり）。スコープ確定後に publish を別タスク化。非ブロッカー。
- **課題6（クリーン clone 系テストコード未整備）**: 継続（バッチ A 課題2／バッチ B 課題6）。`git archive` 方式のクリーン clone テストスクリプトは未コミット。self-enforce が build diff-zero＋pack leak を CI で担保する範囲は拡充された。
- **改善提案（軽微・任意）**: D-6 の必須パターン↔`files` の drift 予防（`files` からの導出）。非ブロッカー。

---

## D-8. レビュー結果（バッチ D）

- **実装品質**: 良好（pack リーク検査を単一正本スクリプト化し CI とローカルの二重化を排除。禁止／必須パターンを正例・負例の双方で検証。終了コード規約で CI 判定可能）。
- **テスト品質**: 良好（T1〜T8 を再実行、すべて想定どおり。負例でリーク検出を実証、テスト後にリポをクリーンに復帰）。
- **ドキュメント品質**: 良好（README 主導線・副導線・サブコマンド・版ピン留めが `bin/agents-md.js`・`package.json` と齟齬なく一致。参照先がすべて実在）。
- **総合評価**: **承認可（本バッチ範囲・ブロッカーなし）**。フェーズ1 npm 土台の仕上げ（配布物リーク防止の検証固定化・README 導入手順整備）の DoD を充足。正本ズレ・配布物汚染を新たに生まない。残課題は課題6・課題7（いずれも非ブロッカー・後続継続）。
- **承認者**: worker（auditor、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・テスト再実行（T1〜T8）記載済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由・バッチ C の entry `c0fc50f8-…` に prev_hash チェーン連結）。

---

# 【追記バッチ E】配布とプラグイン化（フェーズ4 marketplace リリースフロー・LICENSE・安全な uninstall・Node 是正・install/uninstall E2E）

> **本節は verify-and-close の 5 回目の実行（バッチ E）の成果物。** skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、03 §2.5 フェーズ4（marketplace リリースフロー・案A）＋ユーザー追加要件（**つけ外し（uninstall）・カプセル化・Node 是正・install/uninstall E2E テスト**）をレビューする。
>
> **レビュー深度**: **full**（新規ファイル4＝LICENSE・sync-version.sh・release.yml・e2e-install-uninstall.sh、変更ファイル多数＝build-adapters.sh・self-enforce.yml・bin/agents-md.js・package.json・README.md・SETUP.md・adapters.md・03。配布物のつけ外し／カプセル化／リリースフローという利用者面の中核機能のため full）。
> **evidence_source 凡例**: `test_output`（本バッチで再実行したコマンドの出力）／`existing_code`（対象ファイルの該当行）／`external_spec`（00/01/03・package.json files・公式仕様等の契約）／`inference_only`（推論のみ。重要判断では不可）。

---

## E-1. レビュー対象

- **実装範囲**: 直前の implement-feature の成果物。03 §2.5 フェーズ4＋ユーザー追加要件。
  - **(フェーズ4 marketplace リリース・案A)** `release.yml` 新設（タグ `v*` → version 同期検証 → `build-adapters.sh claude cursor` → 再生成 diff ゼロ → 生成物＋`marketplace.json` を `release/marketplace` ブランチへ commit/push）。publish step は未配線（scope/レジストリ未確定）。
  - **(version 同期)** `sync-version.sh`（`--check`/`--write`。正本＝`package.json`、`plugin.json` 従属）新設。`self-enforce.yml` に `--check` ゲートを配線。
  - **(LICENSE)** リポルートに `LICENSE`（MIT・著作権者 `techbeansjp-free`）追加。`package.json` も `license: MIT`。
  - **(安全な uninstall)** `bin/agents-md.js` に `uninstall` 追加（既定 dry-run、`--yes` で実行、`--purge` で workflow.db 含む、配備痕跡無しなら中止）。`doctor` に配備状態判定を追加。
  - **(Node 是正)** `package.json` engines.node `>=18`→`>=20`。両 workflow に `setup-node@v4 node22` を配線。
  - **(install/uninstall E2E)** `.agents/scripts/test/e2e-install-uninstall.sh` 新設（隔離 `mktemp -d`＋`git archive` で install/uninstall/冪等/カプセル化/リークを BDD で検証）。`self-enforce.yml` に E2E step を配線。`build-adapters.sh` の bundle 除外に `sync-version.sh`・`verify-npm-pack.sh`・`scripts/test` を追加。
- **変更/新規ファイル（CHANGED_FILES_JSON）**: `LICENSE`・`.agents/scripts/sync-version.sh`・`.github/workflows/release.yml`・`.agents/scripts/test/e2e-install-uninstall.sh`（新規）／`.agents/scripts/build-adapters.sh`・`.github/workflows/self-enforce.yml`・`bin/agents-md.js`・`package.json`・`README.md`・`.agents/SETUP.md`・`docs/maintainer/adapters.md`・`03_実装計画.md`（変更）。
- **レビュー対象外（触れない）**: 未追跡ディレクトリ `docs/maintainer/workflow/20260614_162712_コア取り込み候補調査/` は本バッチと無関係。
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）。

---

## E-2. 実装内容の確認（review-code）

### E-2.1 `bin/agents-md.js`（安全な uninstall ＋ doctor 配備状態判定）

- **配備物マニフェストの単一定義**: `DEPLOYED_ARTIFACTS = [.agents, AGENTS.md, CLAUDE.md, .claude, .cursor, .workflow/templates]`。これは `setup.sh` の実配備対象（`cp .agents`/`AGENTS.md`/`CLAUDE.md`、`.claude`・`.cursor` 生成、`.workflow/templates` コピー）と**完全一致**することを `setup.sh:41-120` と突合して確認（`existing_code`）。`.workflow` 自体は丸ごと消さず templates のみ除去する設計で、issue・workflow.db を誤削除しない（`existing_code`）。
- **安全策（中核）**: `runUninstall` 冒頭で `.agents/` または `AGENTS.md` の存在（配備痕跡）を確認し、無ければ `exit 1` で中止。誤って未配備 dir のユーザー資産を消さない（`existing_code`＋E-3 S4 で実証）。
- **既定 dry-run**: `--yes` を付けない限り削除対象を表示するのみで `rmSync` を呼ばない（`existing_code`＋S2/S5 で実 install→uninstall を確認）。
- **`--purge`**: `PURGE_ARTIFACTS = [.workflow/workflow.db(-wal/-shm)]` を追加除去。`.agents-project/` は purge でも対象外（保持）（`existing_code`＋E-3 S3）。
- **doctor 配備状態**: 同じ「配備痕跡」基準（`.agents` or `AGENTS.md`）で「配備済み/未配備」を表示（`existing_code`）。判定基準が uninstall の安全策と一貫（単一の install 判定）。

### E-2.2 `sync-version.sh`（version 同期の単一正本）

- **正本＝package.json**: `--check` は `package.json` と `.agents/platforms/claude/plugin.json` の version を比較し一致で 0・不一致で 1。`--write` は package.json の version を plugin.json に注入（`existing_code`）。03 §0「正本＝package.json、plugin.json 従属」と一致（`external_spec`）。
- **決定性との両立**: build は plugin.json を「そのままコピー」するため、注入を sync-version 側に置くことで「同一入力→同一出力」が保たれ、diff-zero 検証と両立する（冒頭コメントで明示）（`existing_code`）。node 不在 exit 2・ファイル不在 exit 2 の明示的失敗（`existing_code`）。

### E-2.3 `release.yml`（marketplace リリース・案A）

- **トリガ**: `on.push.tags: ["v*"]`。`permissions: contents: write`（リリースブランチへ push するため必要最小）（`existing_code`）。
- **version 同期検証**: `tag(vX.Y.Z の v 除去)` == `package.json.version` ＋ `sync-version.sh --check`（pkg==plugin）。三者一致しなければ fail（`existing_code`）。03 §2.5.3 単体「両 version 不一致なら CI fail」に対応（`external_spec`）。
- **build＋再生成 diff ゼロ**: `build-adapters.sh claude cursor` → `/tmp` に退避し再 build → `diff -r` で決定性検証（`existing_code`）。シナリオ7-4（正本ズレ検出）に対応。
- **公開（案A）**: 生成物 `.adapters` と `marketplace.json` を一時退避し、`release/marketplace` を fetch/orphan で用意して生成物のみ commit/push。`main` には生成物を置かない（`/.adapters/` は gitignore のまま）（`existing_code`）。03 §0／§9 未決#2 の暫定既定どおり。
- **publish 未配線**: コメントで「npm publish は scope/レジストリ未確定のため含めない。配線時も NPM_TOKEN secret＋手動承認ゲート」と明示（`existing_code`）。03 §9 未決#1 と整合（外部送信を行わない設計＝本レビューの制約とも一致）。

### E-2.4 `LICENSE`／`package.json`（Node 是正含む）

- `LICENSE` は標準 MIT 全文・`Copyright (c) 2026 techbeansjp-free`（`existing_code`）。`package.json.license: "MIT"` と一致（`external_spec`）。法人正式名は 03 §9 未決#6 として残（ユーザー確認事項）。
- `engines.node: ">=20"`（旧 `>=18` から是正）。両 workflow が `setup-node@v4` で node22 を明示し engines と整合（`existing_code`＋E-3 Y2）。

### E-2.5 `build-adapters.sh`（bundle 除外調整・決定性維持）

- `bundle_agents_src` の除外に `sync-version.sh`・`verify-npm-pack.sh` を追加し、`scripts/lib` に加え `scripts/test` も `rm -rf`（`existing_code`、diff で確認）。保守/導入/テスト専用スクリプトを配布物（.adapters）にリークさせない。決定性は E-3 D1（3 連続 build 同一）で維持を実証。

### E-2.6 `self-enforce.yml`（E2E 配線・Node・diff-zero の claude/cursor 化）

- `setup-node@v4 node22` を追加。diff-zero step を `build-plugin-claude.sh` → `build-adapters.sh claude cursor` に是正。step5 に `sync-version.sh --check`、step6 に E2E、step7 を audit（非ブロッキング）に再番号（`existing_code`、diff で確認）。

### E-2.7 テストコード化の網羅・TEST_BDD_FORMAT 監査（PHASES 監査観点）

- 本バッチは**実行可能な E2E テストファイルを新規追加**（`e2e-install-uninstall.sh`）。**TEST_BDD_FORMAT 監査**: ファイル冒頭に `# ユースケース:`（ファイル全体の利用者目線）を持ち、7 つの `test_*` 関数それぞれに `# シナリオ:` と本文の `# Given:`/`# When:`/`# Then:`、複数段には `# And (Then):`/`# And (When):` を付与（`test_output`：`ユースケース` 1・`シナリオ:` 8・`Given:` 8・`When` 8・`Then` 7・`And (…)` 9。test 関数 7）。**インラインコメント必須要件を充足**（`existing_code`＋`test_output`）。01 のユースケース（配布/導入・つけ外し・冪等・カプセル化・リーク）と 03 のフェーズ4/追加要件を実行コードでシナリオ化しており、PHASES「テストコード化の網羅」を満たす。簡易アサーション群（`assert_exists`/`assert_absent`/`assert_cmd_ok`/`assert_cmd_fail`）で pass/fail を集計し、1 件でも fail なら `exit 1`。

---

## E-3. テスト結果の確認（テスト再実行・非破壊）

- **実行日**: 2026-06-14 / **実行環境**: node v20.19.5・npm 10.x・bash 5.2.x・git・tar・sqlite3 3.45.x・python3+pyyaml。
- **非破壊性**: E2E は隔離 `mktemp -d`＋`git archive HEAD | tar -x` で実行。**実行後に本リポの追跡差分は本バッチ対象ファイルのみ**で、`.agents`/`.claude`/`.cursor`/`.workflow/workflow.db` への churn なし・`git ls-files .adapters` 空を確認（`test_output`）。
- **総合**: E2E **36 アサーション全 pass**（FAIL=0）。補助検証（sync-version・diff-zero・YAML・カプセル化・bash -n・node --check）すべて pass。

### E-3.1 E2E（`e2e-install-uninstall.sh`）シナリオ別結果

| ID | シナリオ | 受け入れ基準（01/00） | 結果（pass 数） | evidence_source |
|----|----------|------------------------|------------------|------------------|
| S1 | install で自己完結配備・maintainer 物が漏れない | シナリオ2-1/2-3・SC-3 | **PASS（10/10）**: `.agents/boot/CORE.md`・AGENTS.md・CLAUDE.md・`.claude/hooks/PreToolUse.sh`・`.cursor`・`.workflow/templates` 配備、`.agents-project`/`docs/maintainer` 不在、`skills/*__*` 形式、`workflow.db` 生成 | test_output |
| S2 | uninstall が配備物のみ除去・ユーザー資産保持 | シナリオ3-1・BR-4 | **PASS（9/9）**: 配備物6種除去、`.agents-project/rule.md`・issue・`workflow.db` 保持 | test_output |
| S3 | `--purge` で workflow.db も除去 | 7-3・BR-4 | **PASS（3/3）**: `.agents`・`workflow.db` 除去、`.agents-project` 保持 | test_output |
| S4 | 未配備 dir への uninstall は安全側中止 | 7-3（無断喪失防止） | **PASS（2/2）**: exit≠0 で中止、ユーザー資産無傷 | test_output |
| S5 | 冪等性（二重 install／uninstall 後再 install） | 7-3・BR-4 | **PASS（3/3）**: 二重 install 健全、再 install で復元 | test_output |
| S6 | プラグインのカプセル化（`.adapters/claude` 自己完結） | シナリオ4-1・BR-1 | **PASS（8/8）**: plugin.json/hooks.json 妥当 JSON、`.agents` 同梱、`${CLAUDE_PLUGIN_ROOT}` 参照、ビルド時絶対パス漏れ無し、`/home /Users /tmp/` 漏れ無し | test_output |
| S7 | npm 配布物リーク無し（verify-npm-pack 再利用） | シナリオ5-1・SC-3 | **PASS（1/1）**: 合格（リーク無し・必須物あり） | test_output |

### E-3.2 補助検証

| # | 検証項目 | 方法 | 結果 | evidence_source |
|---|----------|------|------|------------------|
| V1 | sync-version 正例 | `sync-version.sh --check`（pkg==plugin==0.1.0） | **OK（exit 0）** | test_output |
| V2 | sync-version 負例＋原状復帰 | plugin.json を 9.9.9 に一時変更→`--check`→復帰 | **検出 OK（exit 1）**、復帰後 `git diff --quiet` でクリーン | test_output |
| D1 | build diff-zero（決定性） | `build-adapters.sh claude cursor` を 3 連続 build → `diff -r` | **OK**: a1=a2=a3 完全一致（claude/cursor）。`verify-npm-pack.sh`・`scripts/test` は意図どおり非同梱 | test_output |
| D2 | 正本クリーンさ | `git ls-files .adapters`／`git status --porcelain --untracked-files=no` | **OK**: `.adapters` 追跡 0 件、build 由来の追跡差分なし、`.adapters/` は ignore 済み | test_output |
| Y1 | YAML 妥当性 | `yaml.safe_load(self-enforce.yml, release.yml)` | **OK**: 両者パース成功。`on` キーは `pull_request`/`push`（self-enforce）・`push`（release）として正しく解釈 | test_output |
| Y2 | action メジャー・node 是正 | `uses:` と `node-version` 抽出 | **OK**: 両 workflow とも `actions/checkout@v4`・`actions/setup-node@v4`（現行メジャー＝node20 ランタイム・node16 非推奨警告なし）、`node-version: 22` | test_output |
| C1 | カプセル化独立確認 | 別途 `build-adapters.sh claude` → plugin.json/hooks.json JSON.parse・`${CLAUDE_PLUGIN_ROOT}` grep・絶対パス走査 | **OK**: 両 JSON 妥当、`CLAUDE_PLUGIN_ROOT` 2 箇所（PreToolUse/PostToolUse）、`/home /Users /tmp/` およびリポ絶対パス漏れ無し | test_output |
| B1 | 構文・静的検査 | `bash -n`（scripts 9＋lib 1＋test 1）・`node --check bin`・JSON.parse（package/plugin/marketplace） | **OK**: 全 exit 0 | test_output |

> E2E・diff-zero・カプセル化の一時生成物（`mktemp -d`・`.adapters`）は検証後に削除。`.adapters/` は gitignore 対象で追跡されない。本リポの `.workflow/workflow.db` は SELECT のみで非破壊。

---

## E-4. コードレビュー観点

| 観点 | 確認内容 | 判定 | 根拠 |
|------|----------|------|------|
| 配備物マニフェスト整合 | uninstall 対象が setup.sh の実配備と一致 | **OK** | `DEPLOYED_ARTIFACTS` ↔ setup.sh:41-120 突合（`existing_code`） |
| つけ外しの安全性 | 既定 dry-run・痕跡無しで中止・purge 範囲限定 | **OK** | S2/S3/S4/S5（`test_output`）＋分岐（`existing_code`） |
| ユーザー資産保護 | `.agents-project`・issue・workflow.db を既定保持 | **OK** | S2/S3（保持を実証） |
| カプセル化 | `${CLAUDE_PLUGIN_ROOT}` 相対・絶対パス漏れ無し | **OK** | S6・C1（`test_output`） |
| version 同期 | 正本=package.json・正例/負例・決定性両立 | **OK** | V1/V2・D1（`test_output`） |
| 決定性 | build 3 連続同一・配布物リーク無し | **OK** | D1/D2（`test_output`） |
| リリース安全性 | publish 未配線・push は CI 上のみ・最小権限 | **OK** | release.yml（`existing_code`） |
| CI 健全性 | YAML 妥当・action 現行・node22 | **OK** | Y1/Y2（`test_output`） |
| BDD 形式 | ユースケース/シナリオ/GWT インライン | **OK** | E-2.7（`test_output`） |
| 配布物リーク | test/sync-version/verify-npm-pack を除外 | **OK** | build-adapters diff・D1（`existing_code`＋`test_output`） |

- **inference_only 依存の重要判断**: なし。承認に関わる判断はすべて `test_output`／`existing_code`／`external_spec` で裏取り済み。

---

## E-5. 受け入れ基準の確認（generate-scenarios → map-coverage）

| 基準（出典） | 寄与する実装 | 検証方法・結果 | 判定 |
|--------------|--------------|----------------|------|
| シナリオ2-1: Claude 構成へ install、`.agents-project`/`docs/maintainer` を漏らさない（01・SC-3） | uninstall マニフェスト／setup／E2E | S1（10/10） | **○** |
| シナリオ2-3/6-1: claude/cursor が同一正本から `domain__capability` で配備 | deploy-skills／build-adapters | S1（`skills/*__*`）・D1（cursor 生成） | **○** |
| シナリオ3-1/7-3・BR-4: 人間編集領域保持・無断喪失防止（つけ外し） | runUninstall 安全策・既定保持 | S2/S3/S4/S5 | **○** |
| シナリオ4-1: marketplace 土台が解決・build 土台欠落なし（SC-1） | release.yml 案A・plugin.json 正本コピー | S6（カプセル自己完結）・release.yml version 同期＋diff-zero（`existing_code`） | **○（CI 配線・ローカル相当 S6/D1 pass）** |
| シナリオ7-4: 生成物の正本ズレ検出（決定性） | build-adapters・release diff-zero・self-enforce | D1/D2＋release.yml 再生成 diff（`existing_code`） | **○** |
| シナリオ5-1・SC-3: 配布物にリポ固有物が混入しない | verify-npm-pack 再利用（E2E S7）・bundle 除外 | S7・D2 | **○** |
| SC-2（版のピン留め/アップグレード/ロールバック手順）: 版同期＋タグ運用 | sync-version・release.yml・package.json semver | V1/V2＋release.yml タグ→ブランチ運用（`existing_code`） | **○（手順存在・version 同期実証）** |
| 03 §2.5.3 単体: 両 version 不一致なら CI fail | sync-version `--check`／release version 検証 | V2（負例 exit 1）・self-enforce step5 配線 | **○** |
| BR-1: 生成物は正本から決定的に再生成・手編集禁止 | build-adapters・GENERATED.md | D1（3 連続同一）・カプセル GENERATED.md | **○** |
| LICENSE/MIT 確定（03 §0・§9 未決#6） | LICENSE・package.json | 全文 MIT・license 一致（`existing_code`） | **○（著作権者正式名のみ要確認）** |
| Node 是正（engines.node >=20・CI node22） | package.json・両 workflow | Y2（node22）・engines 一致（`existing_code`） | **○** |

### 未達・要対応（map-coverage）

- **本バッチのスコープ内に機能的未達はなし**。つけ外し・カプセル化・version 同期・リリースフロー（案A 配線）・Node 是正・E2E はすべて ○。
- **CI 上でのみ確認可能な項目**（ローカルでは相当検証で代替）: release.yml の実 push（`release/marketplace` ブランチ生成・実 marketplace install スモーク）は**外部送信を伴うため本レビューでは実行せず**、ローカルで build/version 同期/diff-zero までを相当検証（S6/D1/V1/V2）。03 §2.5.3 E2E「実 marketplace install はリリースブランチ運用確定後」と整合（想定どおり）。
- **スコープ外（別フェーズ/別 issue・継続）**: npm 実 publish（課題7・scope/レジストリ未確定）、gemini/copilot/codex adapter（課題5）、enforcement 有効化（03 フェーズ5）、`git archive` を超えた追加クリーン clone テスト（課題6 は本 E2E で大幅に解消）。

---

## E-6. 設計・境界の確認（review-architecture）

- **設計原則の準拠**: 単一責務の徹底——version 同期＝`sync-version.sh`、つけ外し＝`runUninstall`（マニフェスト1か所）、E2E＝`e2e-install-uninstall.sh`（CI とローカルの単一正本）、リリース＝`release.yml`。検証ロジックを CI とローカルで二重化しない方針が一貫（`external_spec`：03・各ファイル冒頭コメント）。UNIX 哲学（小さな単機能スクリプトの合成）に整合。
- **境界・依存**: `bin/agents-md.js` → `setup.sh`（配備）／自前マニフェスト（除去）の一方向。`sync-version.sh`・`build-adapters.sh` → 正本 `.agents/`／`package.json`／`plugin.json`。`release.yml` → 同梱スクリプトのみ（外部未整備ツール非依存）。循環なし。
- **配布物の境界（カプセル化）**: アダプタ（`.adapters/claude`）は `${CLAUDE_PLUGIN_ROOT}` 相対で同梱 `.agents` を参照し、ビルド環境の絶対パスに非依存＝**移送可能な自己完結カプセル**。保守/導入/テスト専用スクリプト（setup/build-adapters/sync-version/verify-npm-pack/lib/test）は `bundle_agents_src` で除外し配布物にリークしない。境界が明瞭（`test_output`：S6/C1/D1）。
- **正本ズレを生まない**: version 正本＝`package.json`、plugin.json は従属（sync-version で同期・build はコピーのみ）で決定性と両立。配備物マニフェストは setup.sh の実配備と一致。新たな二重管理を生まない（`existing_code`＋`test_output`）。
- **新たな破綻の有無**: build 3 連続同一・`.adapters` 未追跡・E2E 隔離実行で本リポ非破壊を確認。クリーン clone 破綻・リーク・正本汚染を**新たに生まない**（`test_output`）。
- **指摘（軽微・任意・非ブロッカー）**:
  - **release.yml の orphan/上書き運用**: `release/marketplace` を毎回作り直す案A は、初回 orphan 後の継続運用で履歴が肥大化しうる。運用上は問題ないが、将来 `git rm` 後の force-add の挙動を実 CI で 1 度スモークしておくと安心（外部 push を伴うため本レビュー範囲外）。`inference_only` 寄りの将来懸念であり承認判断には影響しない。
  - **uninstall マニフェストと setup.sh の同期**: 今日時点で一致（突合確認済み）だが、将来 setup の配備対象が増えた際にマニフェスト追従が必要。両者を同一ソースから導出する案は後続の任意改善。

### E-6.1 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
|----------|------------------|------|
| install/uninstall・冪等・カプセル化・リークの 36 アサーションが全 pass | test_output | E2E をローカル再実行（隔離・非破壊） |
| uninstall がユーザー資産を保持し未配備 dir で中止する | test_output + existing_code | S2/S3/S4＋runUninstall 安全策 |
| プラグインが `${CLAUDE_PLUGIN_ROOT}` 相対で自己完結・絶対パス漏れ無し | test_output | S6＋独立確認 C1（別 build で再走査） |
| version 同期が正例/負例で機能し決定性と両立 | test_output + existing_code | V1/V2＋D1（3 連続 build 同一） |
| 両 workflow が YAML 妥当・action 現行・node22 | test_output | Y1/Y2（safe_load・uses・node-version） |
| release.yml が publish 未配線・push は CI 上のみ | existing_code | 外部送信を行わない設計（本レビュー制約と整合） |

- **inference_only のみに依存する重要判断は無い**（承認に関わる判断はすべて test_output / existing_code / external_spec で裏取り。軽微な将来懸念のみ inference_only として明示し承認判断から除外）。

---

## E-7. 課題と改善点（残課題）

- **課題6（クリーン clone 系テストコード）: 大幅解消**。本バッチで `e2e-install-uninstall.sh`（`git archive HEAD`＋`mktemp -d` でクリーン clone を再現し install/uninstall/冪等/カプセル化/リークを検証）を新設し CI に配線。バッチ A 課題2／バッチ B 課題6／バッチ C・D で継続していた「クリーン clone 系テスト未整備」は実体化。
- **課題7（npm 実 publish 未実施）**: 継続。scope/レジストリ未確定（03 §9 未決#1）。release.yml は publish を意図的に未配線（手動承認ゲート前提）。非ブロッカー。
- **課題8（marketplace 実 install スモーク）**: `release/marketplace` ブランチ運用の実 CI 実行は外部 push を伴うため未実施。ローカルで build/version 同期/diff-zero まで相当検証済み。運用承認後にユーザー側で実施（03 §9 未決#2 運用承認待ちと整合）。非ブロッカー。
- **課題9（LICENSE 著作権者・npm scope の正式名）**: `techbeansjp-free` は暫定。法人正式名・npm scope はユーザー確認事項（03 §9 未決#1・#6）。非ブロッカー。
- **課題5（gemini/copilot/codex 未対応）**: 継続（バッチ B 由来）。`SUPPORTED_TOOLS` 拡張で対応可能。

---

## E-8. レビュー結果（バッチ E）

- **実装品質**: 良好（つけ外しを安全側設計＝既定 dry-run・痕跡無し中止・ユーザー資産保持で実装。プラグインを `${CLAUDE_PLUGIN_ROOT}` 相対の自己完結カプセルとして生成し絶対パス漏れ無し。version 同期を単一正本化し決定性と両立。リリースフロー案A を配線（publish は安全に未配線）。Node を是正。正本ズレ・配布物汚染・クリーン clone 破綻を新たに生まない）。
- **テスト品質**: 良好（E2E 36 アサーションを隔離・非破壊で再実行し全 pass。sync-version 正例/負例・diff-zero・YAML・カプセル化・bash -n・node --check を再実行。E2E は TEST_BDD_FORMAT のユースケース/シナリオ/GWT インラインを充足）。
- **ドキュメント品質**: 良好（README・SETUP に uninstall 手順とつけ外し表、adapters.md に marketplace 案A 運用、03 §0/§9 を living doc 更新。参照先が実在）。
- **総合評価**: **承認可（本バッチ範囲・ブロッカーなし）**。03 §2.5 フェーズ4＋ユーザー追加要件（つけ外し・カプセル化・Node 是正・install/uninstall E2E）の DoD を充足。残課題（課題5・課題7・課題8・課題9）はいずれも非ブロッカー・後続継続またはユーザー確認事項。
- **承認者**: worker（auditor、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・テスト再実行（E2E 36／補助検証）記載済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由・直前 entry にチェーン連結）。

---

# 【追記バッチ F】再インストール時のユーザー資産保全（.cursor 全削除廃止・uninstall 精緻化・R1-R3 E2E）

> **本節は verify-and-close の 6 回目の実行（バッチ F）の成果物。** skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、ユーザー指摘「再インストールで project 固有ルールが消えないか」への是正実装をレビューする。
>
> **レビュー深度**: **full**（つけ外し・再インストール・upgrade という利用者面の中核機能で、ユーザー資産の破壊はデータ損失に直結するため full。変更5ファイル＝setup.sh・bin/agents-md.js・e2e-install-uninstall.sh・SETUP.md・README.md）。
> **evidence_source 凡例**: `test_output`（本バッチで再実行したコマンドの出力）／`existing_code`（対象ファイルの該当行）／`external_spec`（00/01/03 の契約・受け入れ基準）／`inference_only`（推論のみ。重要判断では不可）。

---

## F-1. レビュー対象

- **実装範囲**: 直前の implement-feature の成果物。ユーザー指摘「再インストール（再 init / upgrade）で `.agents-project/` や自作エディタルールが消えないか」への是正。
  - **(setup.sh)** `.cursor/` の `rm -rf` 全削除を廃止し、新規 `copy_owned_files()` でパッケージ所有ファイル（トップレベル通常ファイル・`.gitkeep` 除外）のみ上書き。`.claude/` は `hooks`/`skills` のみ再生成しユーザー設定（`settings.json` 等）を touch せず。`.agents-project/` は非 touch（従来どおり）。
  - **(bin/agents-md.js)** uninstall を `.cursor`/`.claude` 丸ごと除去から、配備物限定へ精緻化。`DEPLOYED_ARTIFACTS` を `.claude/hooks`・`.claude/skills`・`.cursor/skills` の専用ディレクトリに分解し、`.cursor` 直下のパッケージ所有ファイルは `deployedOwnedFiles()`（enforcement 正本から動的導出）で加える。除去後に `.cursor`/`.claude` が空になった場合のみ親ディレクトリを片付ける。
  - **(e2e-install-uninstall.sh)** R1（再インストール保持）・R2（upgrade 保持）・R3（uninstall 保持）の3シナリオ（計23アサーション）を追加。
  - **(SETUP.md / README.md)** init/upgrade/uninstall の保持・上書き契約表を再設計。project 固有ルールは `.agents-project/` 推奨を明記。
- **変更ファイル（CHANGED_FILES_JSON）**: `.agents/scripts/setup.sh`・`bin/agents-md.js`・`.agents/scripts/test/e2e-install-uninstall.sh`・`.agents/SETUP.md`・`README.md`・`04_review.md`。
- **レビュー対象外（触れない）**: 未追跡ディレクトリ `docs/maintainer/workflow/20260614_162712_コア取り込み候補調査/` は本バッチと無関係。
- **レビュー担当者**: worker（auditor/scribe ロール、orchestrator 委譲）。

---

## F-2. 受け入れ基準の確認（generate-scenarios → map-coverage）

01_要件定義の受け入れ基準（保持・破壊しない系）と本実装・テストの対応。検証方法・結果をセットで記載する。

| 受け入れ基準（01 / BR） | カバーする実装 | カバーするテスト/検証 | 検証方法・結果 | evidence_source |
|--------------------------|----------------|------------------------|------------------|------------------|
| 01 L51/L218/L222・BR-4: アップグレード後、人間編集領域（`.agents-project/` 等）が保持される | setup.sh: `.agents-project/` 非 touch／bin: upgrade=init 同等 | R2（upgrade 保持） | E2E 再実行で R2 全5アサーション pass。`.agents-project/custom-rule.md`・`.cursor/rules/my-team.mdc`・`.claude/settings.json` が upgrade 後も保持 | test_output |
| 01 L62: 既存の `.cursor`/`.claude` を不用意に破壊しない | setup.sh: `copy_owned_files`（`rm -rf` 廃止）・`.claude` は hooks/skills のみ | R1（再インストール保持） | E2E 再実行で R1 全10アサーション pass。ユーザー資産5種が保持され、正本（.agents・agents-core.mdc・skills）は最新化。独立再現 F-5 でも確認 | test_output |
| 01 L370/BR-2/BR-4: 非対象（人間編集領域）が無断上書き・無断除去されない | bin: `deployedOwnedFiles()`＋専用ディレクトリ限定除去・空時のみ親片付け | R3（uninstall 保持） | E2E 再実行で R3 全8アサーション pass。`.cursor/rules/my-team.mdc`・`.claude/settings.json`・`.agents-project/` が uninstall 後も保持、配備分のみ除去 | test_output |
| 既存回帰（S2/S3/S4）: uninstall が配備物のみ除去・未配備 dir で中止・purge は workflow.db のみ追加除去 | bin: 安全策・PURGE_ARTIFACTS（不変） | S2〜S4 | E2E 再実行で S2〜S4 全 pass（リグレッションなし） | test_output |
| 本リポの `.agents/.claude/.cursor/.workflow/workflow.db` を破壊しない（隔離 dir 実行） | E2E は `mktemp -d`＋`git archive HEAD` で隔離実行 | 全シナリオ | E2E 前後で本リポ own dirs の sha256 集約ハッシュ不変・`git status --porcelain` 不変（6行で同一） | test_output |

- **未達・欠落**: なし（保持系の受け入れ基準は R1〜R3＋S2〜S4 で網羅）。
- **必須成果物の充足**: 04_review 直下に本節を追記（PHASES DoD）。01 BDD シナリオ（US つけ外し・アップグレード保持）とテスト（R1〜R3）の対応が取れている。

---

## F-3. 実装内容の確認（review-code）

### F-3.1 `.agents/scripts/setup.sh`（`.cursor` 全削除の廃止）

- **`copy_owned_files()` 新設**: `src_dir` 配下のトップレベル通常ファイルのみ（`.gitkeep` 除外、サブディレクトリは対象外）を `dest_dir` へ `cp` で上書き。ディレクトリ全体を `rm -rf` しないため `.cursor/rules/*.mdc` 等のユーザー作成物が保持される（`existing_code` setup.sh:99-113）。
- **`.cursor/` 処理**: 旧 `rm -rf "$CURSOR_DIR"` を廃止し、`mkdir -p`＋`copy_owned_files enforcement/cursor .cursor`。`.cursor/skills` は別途 `sync_skills`（専用ディレクトリのため毎回再生成）（`existing_code` setup.sh:131-146）。
- **`.claude/` 処理**: `hooks/` のみ `rm -rf`＋再生成（パッケージ生成物専用ディレクトリ）、`skills` も `sync_skills`。`.claude/settings.json` 等のユーザー設定は touch しない（`existing_code` setup.sh:116-129）。独立再現 F-5 で `settings.json` の中身不変を実測。
- **`.agents-project/` 非 touch**: setup.sh は `.agents-project/` を一切操作しない（従来どおり保持）（`existing_code`）。
- **指摘**: なし（規約遵守・責務逸脱なし）。

### F-3.2 `bin/agents-md.js`（uninstall の精緻化）

- **`DEPLOYED_ARTIFACTS` 分解**: `.claude`/`.cursor` 丸ごとから `.claude/hooks`・`.claude/skills`・`.cursor/skills` の専用ディレクトリに変更。`.workflow/templates`・`.agents`・`AGENTS.md`・`CLAUDE.md` は不変（`existing_code` bin:155-165）。
- **`deployedOwnedFiles()` の単一整合**: `.cursor` 直下のパッケージ所有ファイル（`agents-core.mdc`・`README.md`）を `enforcement/cursor` から `readdirSync`＋`.gitkeep` 除外で動的導出。setup.sh の `copy_owned_files` と**同一規則**で、配備物マニフェストの二重管理を避けている（`existing_code` bin:167-187。F-5 で導出結果が `[.cursor/README.md, .cursor/agents-core.mdc]` であることを実測）。
- **空時のみ親片付け**: 除去後に `.cursor`/`.claude` が `readdirSync(...).length === 0` の場合のみ `rmSync`。ユーザー作成物が残っていれば親を削除しない（保持側に倒す。`catch` も保持側に倒す設計）（`existing_code` bin:268-281）。
- **保持アナウンス**: uninstall 出力に「`.cursor`/`.claude` のユーザー作成物・設定は保持」を追加。利用者に保持範囲が伝わる（`existing_code` bin:239-241）。
- **指摘（軽微・非ブロッカー）**: F-6 に後述（`.cursor/README.md` 除去の対称性、deployed setup.sh の版差）。

### F-3.3 テストコードの BDD 形式監査（TEST_BDD_FORMAT）

R1〜R3 のインラインコメントを `.agents/TEST_BDD_FORMAT.md` に照らして監査（`existing_code` e2e:296-431）。

- **ユースケース**: 各テスト関数の直前に `# ユースケース:` ブロックコメントで利用者目線の目的を記載（R1=再インストール保持、R2=upgrade 保持、R3=uninstall 同居保持）。**充足**。
- **シナリオ**: 各テスト本体冒頭に `# シナリオ:` で検証状況を記載。**充足**。
- **Given / When / Then**: 各ブロック直上に1つずつコメント。複数段は `# And (Given):`（R1 の正本改変前提）・`# And (Then):`（正本最新化の検証）で正しく区別。**充足**。
- **結論**: R1〜R3 は TEST_BDD_FORMAT のユースケース/シナリオ/GWT インライン3層を満たす。欠落・ブロックずれなし。

---

## F-4. 設計・境界の確認（review-architecture）

- **責務分離**: 「パッケージ所有ファイルの導出」を setup.sh（`copy_owned_files`）と bin（`deployedOwnedFiles`/`ownedFilesFrom`）が**同一規則**（enforcement 正本・トップレベル通常ファイル・`.gitkeep` 除外）で行い、配備＝除去の対称性を正本1か所（enforcement/cursor）に集約。境界が明確で、配備物マニフェストの二重定義を生まない（CONCEPTS 単一責任に適合）。
- **依存方向**: bin → enforcement 正本（読み取りのみ・一方向）。循環なし。`PACKAGE_ROOT/.agents/enforcement` を参照し、setup.sh の参照元と一致（`existing_code`）。
- **安全側設計**: 「判断に迷えば保持」を一貫して採用（空時のみ親削除・`catch` で保持・専用ディレクトリのみ全削除）。データ損失リスクを構造的に下げている。
- **専用ディレクトリ契約**: `.cursor/skills`・`.claude/hooks`・`.claude/skills` を「パッケージ排他所有・手置き禁止」とし、SETUP.md に明文化。再生成（rm -rf）対象とユーザー資産の境界が文書と実装で一致（BR-4 の「文書と実装の一致」を満たす）。
- **指摘**: なし（設計・境界は妥当）。軽微なドキュメント不整合は F-6。

---

## F-5. テスト再実行と独立確認（evidence_source 付き）

すべて**隔離 dir・非破壊**で本バッチ中に再実行（evidence_source=test_output）。

### F-5.1 E2E 全シナリオ（S1〜S7＋R1〜R3）

- コマンド: `bash .agents/scripts/test/e2e-install-uninstall.sh`（`sqlite3=あり`）。
- 結果: **`PASS=59 FAIL=0`／全シナリオ pass**。内訳=S1(10)・S2(9)・S3(3)・S4(2)・S5(3)・S6(8)・S7(1)=回帰36、R1(10)・R2(5)・R3(8)=新規23。実装者の自己報告（59/0）と一致。
- **保持の実測**（R1/R2/R3 の主要アサーション、test_output より）:
  - R1: `.agents-project/custom-rule.md`・`.cursor/rules/my-team.mdc`・`.claude/settings.json`・`.workflow/<issue>/00.md`・`workflow.db` が再 init 後も保持。中身改変なし（`settings.json`＝`{"userValue":true}`／`my-team.mdc`＝`team cursor rule`）。かつ `.agents/boot/CORE.md` 復元・`.cursor/skills` 再生成・`agents-core.mdc` が STALE→正本に最新化。
  - R2: `.agents-project`・`.cursor/rules`・`.claude/settings.json` が upgrade 後も保持。正本（`.agents`・`agents-core.mdc`）最新化。
  - R3: `.cursor/rules/my-team.mdc`・`.claude/settings.json`・`.agents-project/custom-rule.md` が uninstall 後も保持。パッケージ配備分（`agents-core.mdc`・`.cursor/skills`・`.claude/hooks`・`.claude/skills`・`.agents`）のみ除去。

### F-5.2 本リポ非破壊の実測

- E2E 前後で `find .agents .claude .cursor .workflow -type f | sort | xargs sha256sum | sha256sum` が**同一**（`2d6108…d7a`）。`git status --porcelain` も前後で**同一（6行）**。E2E は `mktemp -d`＋`git archive HEAD` で隔離実行され、本開発リポの `.agents/.claude/.cursor/.workflow/workflow.db` を一切破壊しない。

### F-5.3 build-adapters diff-zero・静的検査・リーク

- `bash .agents/scripts/build-adapters.sh claude` / `cursor`：exit 0。**2回連続実行で生成物 sha256 集約ハッシュ一致＝diff-zero（idempotent）**。
- `bash -n .agents/scripts/setup.sh`・`bash -n .agents/scripts/test/e2e-install-uninstall.sh`・`node --check bin/agents-md.js`：いずれも OK。
- `git ls-files .adapters`：**空**（生成物がリポに漏れていない）。build 実行後も `git status` 不変（`.adapters` は gitignore）。

### F-5.4 独立回帰確認（隔離 dir で 1 ケース再現）

- **setup.sh が `.cursor` を丸ごと消さないこと**: 隔離 dir で**作業ツリーの setup.sh**（レビュー対象）を直接実行。再 init 後、ユーザー設置の `.cursor/rules/my-team.mdc`（中身 `MYTEAM`）・`.claude/settings.json`（`USERSETTINGS`）が保持され、`agents-core.mdc` は STALE→正本に最新化。出力メッセージが新版（「`.cursor/` のパッケージ所有分を最新化しました（ユーザー自作ルールは保持）」）であることも確認（test_output）。
- **uninstall がユーザー作成物を残すこと**: 同 dir で `agents-md uninstall --yes` 後、`.cursor/rules/my-team.mdc`・`.claude/settings.json` が残り、`agents-core.mdc`・`.cursor/README.md` は除去（F-6 の対称性確認）。
- **inference_only 単独依存の重要判断なし**: 承認に関わる判断はすべて test_output／existing_code／external_spec で裏取り。

---

## F-6. 課題と改善点（残課題・軽微）

いずれも**非ブロッカー**。本バッチの承認可否には影響しない。

- **【軽微1・ドキュメント不整合】SETUP.md の deploy パス表記**: SETUP.md L104 の表ヘッダが `.cursor/rules/agents-core.mdc` と記載されているが、実際の配備先は `.cursor/agents-core.mdc`（`.cursor` 直下）。同ファイルの他箇所（L75/L149/L157/L173/L188）はすべて正しく `.cursor/agents-core.mdc` と記載。L104 のみの孤立した表記ゆれ（`existing_code`）。**推奨対応**: L104 を `.cursor/agents-core.mdc` に修正（後続の軽微修正で可）。
- **【軽微2・対称性の確認事項】`.cursor/README.md` の除去**: `deployedOwnedFiles()` は `.cursor/README.md` もパッケージ所有として除去対象に含む（enforcement/cursor に `README.md` が存在するため）。これは setup が同名を上書き配備するのと対称で設計上は正しいが、利用者が `.cursor/README.md` を自作していた場合は uninstall で除去される。`README.md` という一般名のためごく低リスク。**推奨対応**: 不要（配備＝除去の対称性として妥当）。必要なら将来 enforcement/cursor の README をユーザー衝突しにくい名前にする選択肢を残す。
- **【軽微3・運用上の注意・観測事項】deployed setup.sh の版差**: 利用者が**採用先にコピー済みの** `.agents/scripts/setup.sh`（過去版）を直接再実行した場合、その版の挙動（旧版なら `.cursor` 全削除）が走る。`agents-md upgrade`/`init` はパッケージ自身の setup.sh を使うため本是正の恩恵を受けるが、deployed copy の直接実行は版に依存する。これは upgrade モデルに内在する一般的性質で本実装の欠陥ではない（`inference_only`／運用注意）。**推奨対応**: 不要（CLI 経由の upgrade を推奨導線とする README/SETUP の記述と整合）。

---

## F-7. レビュー結果（バッチ F）

- **実装品質**: 良好（`.cursor` の `rm -rf` 全削除を廃止し `copy_owned_files` でパッケージ所有分のみ更新。`.claude` はユーザー設定非 touch。uninstall を enforcement 正本からの動的導出＋専用ディレクトリ限定に精緻化し、空時のみ親を片付ける安全側設計。配備＝除去の対称性を正本1か所に集約し二重管理を生まない）。
- **テスト品質**: 良好（R1〜R3 を新設し E2E `PASS=59 FAIL=0` を隔離・非破壊で再実行。保持5種＋正本最新化を実測。本リポ own dirs の非破壊を sha256＋git status で実証。R1〜R3 は TEST_BDD_FORMAT のユースケース/シナリオ/GWT を充足）。
- **ドキュメント品質**: 良好（SETUP.md・README に保持・上書き契約表を再設計し project 固有ルールは `.agents-project/` 推奨を明記。軽微1 の L104 表記ゆれのみ残）。
- **総合評価**: **承認可（本バッチ範囲・ブロッカーなし）**。ユーザー指摘「再インストールで project 固有ルールが消えないか」への是正は、R1（再インストール）・R2（upgrade）・R3（uninstall）で実測検証され、`.agents-project/`・`.cursor`/`.claude` のユーザー作成物・`.workflow/<issue>`・`workflow.db` が破壊されないことを確認。残課題（軽微1〜3）はいずれも非ブロッカー。
- **承認者**: worker（auditor、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・E2E（S1〜S7＋R1〜R3＝59/0）再実行と保持の実測を記載済み・build-adapters diff-zero／静的検査／リーク確認済み・独立回帰確認済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由・実 DB 現 head にチェーン連結）。

---

# 【追記バッチ G】.claude/.cursor の skills・hooks ユーザー自作物保全（所有エントリのみ管理・R4-R5 E2E）

> **本バッチの位置づけ**: command **verify-and-close**（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）。直前 implement-feature の未コミット成果（ユーザー指摘「`.claude` のユーザー資産保全は？」への是正）を対象とする。**レビュー深度: standard**（中規模・限定スコープ。skills/hooks の選択的同期と uninstall の対称除去）。
>
> **evidence_source 凡例**: `test_output`（本レビューで再実行）/ `existing_code`（実ファイル確認）/ `external_spec`（仕様・ドキュメント）/ `inference_only`（推測。重要判断は不採用）。

## G-1. レビュー対象（変更ファイル）

| ファイル | 変更概要 | evidence |
|----------|----------|----------|
| `.agents/scripts/lib/deploy-skills.sh` | `list_owned_skill_names`（所有 skill 名の単一導出＝`deploy_skills_impl` と同走査規則）・`sync_skills_selective`（dest を丸ごと rm せず所有エントリのみ削除→再配備）を追加 | existing_code |
| `.agents/scripts/setup.sh` | `sync_skills` を `sync_skills_selective` へ委譲（選択的同期）。`.claude/hooks` の `rm -rf` 全削除を廃止し `copy_owned_files`（所有フックのみ上書き）へ | existing_code |
| `bin/agents-md.js` | uninstall を所有 skill/hook エントリのみ除去へ。`ownedSkillNames`/`deployedOwnedHookFiles`/`deployedOwnedSkillEntries` を追加。`DEPLOYED_ARTIFACTS` から `.claude/skills`・`.claude/hooks`・`.cursor/skills` のディレクトリ一括除去を撤去。後始末を子→親の空判定へ | existing_code |
| `.agents/SETUP.md`・`README.md` | 保持/上書き契約を「配備分（既知エントリ）のみ更新・ユーザー自作物は保持/共存可」へ更新。表ヘッダ誤記を `.cursor/agents-core.mdc` に統一（バッチ F 軽微1 を解消） | existing_code |
| `.agents/scripts/test/e2e-install-uninstall.sh` | R4（再インストール保持）・R5（uninstall 保持）を追加 | existing_code |

## G-2. 受け入れ基準の確認（generate-scenarios → map-coverage）

| 基準 | 検証方法 | 結果 |
|------|----------|------|
| setup（再 init/upgrade）が `.claude/skills`・`.cursor/skills` のユーザー自作スキルを破壊しない | R4 E2E + 独立回帰 | **通過**（`my-user-skill/SKILL.md` 保持・中身改変なし） |
| setup が `.claude/hooks` のユーザー独自フックを破壊しない | R4 E2E + 独立回帰 | **通過**（`my-user-hook.sh` 保持・中身改変なし） |
| setup がパッケージ配備分（所有 skill・所有フック）を最新化する | R4 E2E（STALE→正本／agent・`__cap` 再生成） | **通過** |
| uninstall がユーザー自作スキル/フックを保持する | R5 E2E + 独立回帰 | **通過** |
| uninstall がパッケージ所有 skill/hook のみ除去する | R5 E2E（`agent`・`PreToolUse.sh`・`__cap` 除去） | **通過** |
| 自作物が残る限り `.claude/skills`・`.claude/hooks` ディレクトリは保持される | R5 E2E（空でないので片付かない） | **通過** |
| 所有集合が単一定義（bash＝Node＝実配備） | G-4 突合 | **通過** |

未達・要対応: **なし**（全基準が test_output で通過）。必須成果物（00/01/02/03）の必須セクション欠落も本バッチ範囲では検出なし。

## G-3. E2E 再実行サマリ（test_output・隔離 dir・非破壊）

`bash .agents/scripts/test/e2e-install-uninstall.sh`（作業ツリー版＝レビュー対象）を実行。**結果: `PASS=77 FAIL=0`／「全シナリオ pass」**。各シナリオは `mktemp -d` の隔離 dir で `git archive HEAD` / CLI init により独立実行される。

- **S1-S7**（install→uninstall→冪等→カプセル化→build-adapters カプセル→npm pack リーク）: 全 pass。
- **R1-R3**（バッチ F の回帰: 再インストール／upgrade／uninstall でのユーザー資産保持）: 全 pass。
- **R4**（再インストールで自作スキル/フック保持＋配備分最新化）: 9 アサーション pass。実測:
  - `.claude/skills/my-user-skill/SKILL.md`＝`user skill (claude)`、`.cursor/skills/my-user-skill/SKILL.md`＝`user skill (cursor)`、`.claude/hooks/my-user-hook.sh` 末尾＝`echo my-user-hook` が保持（中身改変なし）。
  - パッケージ skill（ドメイン直下 `agent`・`{domain}__{capability}`・`.cursor` 側）が再生成。改変した `PreToolUse.sh`（STALE）が正本で最新化。
- **R5**（uninstall で自作スキル/フック保持＋所有分のみ除去）: 9 アサーション pass。実測:
  - 自作 `my-user-skill`（claude/cursor）・`my-user-hook.sh` が保持。
  - 所有 skill（`agent`・`.cursor agent`・`{domain}__{capability}`）と所有フック `PreToolUse.sh` が除去。
  - 自作物が残るため `.claude/skills`・`.claude/hooks` ディレクトリ自体は保持（空でないため片付かない）。

**本リポ非破壊の実測**: E2E・build・独立回帰の全実行前後で `find .agents .claude .cursor .workflow -type f | sort | xargs sha256sum | sha256sum` が**同一**（`2f3912f0…b2a65a`）。`git status --porcelain` も前後で**同一（7 行＝対象 6 変更＋本 issue ディレクトリ）**。本開発リポの `.agents/.claude/.cursor/.workflow/workflow.db` を一切破壊しないことを確認（test_output）。

## G-4. 所有集合の単一定義の検証（drift リスク評価）

所有 skill 名の導出が **3 経路で同一集合**であることを実測（test_output）。

- bash `list_owned_skill_names .agents/skills`（sort）= **15 件**。
- Node `ownedSkillNames()`（`bin/agents-md.js` の走査規則をミラー実行・sort）= **15 件**。
- 実配備 `deploy_skills_impl .agents/skills <tmp>` のトップレベルエントリ（sort）= **15 件**。
- `diff` 結果: **三者完全一致**（`agent`・`architecture__*`×3・`implementation__*`×2・`logging__write-workflow-log`・`requirements__*`×4・`review__*`×2・`testing__*`×2）。

**所有集合の根拠の単一性**:
- skills の所有名導出は `lib/deploy-skills.sh`（`deploy_skills_impl` と `list_owned_skill_names` が**同一ファイル内・同一走査規則**＝ドメイン直下 `SKILL.md` あり→`{domain}`、capability 配下 `SKILL.md` あり→`{domain}__{capability}`）。配備と所有列挙が同一規則で導出されるため、配備＝削除の対称性が保たれる（existing_code）。
- hooks の所有名は `enforcement/claude` のトップレベル通常ファイル（`.gitkeep` 除外）から導出。setup の `copy_owned_files` と uninstall の `deployedOwnedHookFiles`（`ownedFilesFrom`）が同じ規則を使用（existing_code）。
- **drift リスク評価**: Node 側 `ownedSkillNames` は bash 関数の**別実装（ミラー）**であり、規則を変えると両方を直す必要がある（実装者コメントにも明記）。現時点では両者の出力が完全一致するため drift は**現存しない**。ただし**潜在 drift リスク（軽微・非ブロッカー）**として残る。CI で両経路の突合（本 G-4 と同等のコマンド）を回す自動回帰があれば回帰検知が強固になる。**推奨対応**: 任意（将来 CI に bash↔Node 所有集合一致テストを追加）。本バッチの承認可否には影響しない。

## G-5. 静的検査・diff-zero・リーク（test_output）

- `bash -n` … `setup.sh`／`lib/deploy-skills.sh`／`e2e-install-uninstall.sh`：いずれも OK。
- `node --check bin/agents-md.js`：OK。
- `bash .agents/scripts/build-adapters.sh claude`：exit 0。**2 回連続実行で生成物 sha256 集約一致＝diff-zero**（`d00f8b28…`）。
- `bash .agents/scripts/build-adapters.sh cursor`：exit 0。**2 回連続で一致＝diff-zero**（`cc17111e…`）。
- `git ls-files .adapters`：**空**（生成物がリポに漏れていない）。

## G-6. 独立回帰確認（隔離 dir で 1 ケース・自己再現）

隔離 dir に `git archive HEAD` 展開＋作業ツリーの 6 変更ファイルを上書きし、**パッケージ自身の `setup.sh`/CLI** を直接実行して再現（test_output）。

- **setup 再実行（再 init/upgrade 相当）**: ユーザー設置の `.claude/skills/my-user-skill`（`MINE-claude`）・`.cursor/skills/my-user-skill`（`MINE-cursor`）・`.claude/hooks/my-user-hook.sh`（末尾 `echo MINEHOOK`）が全て保持（中身改変なし）。削除した `.claude/skills/agent` が再生成、STALE 化した `PreToolUse.sh` が正本で最新化、`{domain}__{capability}` skill も再生成。
- **uninstall --yes**: 自作スキル（claude/cursor）・自作フックが保持。所有 skill（`agent`）・所有フック（`PreToolUse.sh`）が除去。自作物が残るため `.claude/skills` ディレクトリは保持。
- **inference_only 単独依存の重要判断なし**: 保持/除去/最新化の判断はすべて test_output／existing_code で裏取り。

## G-7. TEST_BDD_FORMAT 監査（R4/R5）

`.agents/TEST_BDD_FORMAT.md` に照らし R4/R5 のインラインコメントを確認（existing_code）。

- **ユースケース**: R4/R5 とも関数直前のブロックコメントに `# ユースケース:` を記載（利用者目線で「何のためのテスト群か」を 3 文以内で説明）。**充足**。
- **シナリオ**: 各テスト関数本体冒頭に `# シナリオ:` コメントを記載（検証する状況・条件を記述）。**充足**。
- **Given/When/Then**: 各ブロック直上に `# Given:`／`# When:`／`# Then:` を 1 つずつ配置。複数前提・複数検証は `# And (Given):`／`# And (Then):` を使用（R4 のパッケージ改変前提・最新化検証群で確認）。**充足**。
- **指摘**: bash の関数テストという制約上、`ユースケース:`/`シナリオ:` は doc コメント機構ではなくブロックコメントで表現されているが、TEST_BDD_FORMAT §0 が言語に合わせた doc コメントを許容しており、本リポの既存 S1-S7・R1-R3 と同一スタイルで一貫。**逸脱なし（軽微指摘なし）**。

## G-8. 設計・境界の確認（review-architecture）

- **責務分離**: 所有集合の命名/列挙ロジックを `lib/deploy-skills.sh` に集約（`deploy_skills_impl`＝配備、`list_owned_skill_names`＝列挙、`sync_skills_selective`＝選択的同期）。setup.sh と bin/agents-md.js はこの正本に委譲・ミラーする。**単一責任・疎結合に適合**（existing_code）。
- **依存方向**: setup.sh → `lib/deploy-skills.sh`（source）の一方向。`bin/agents-md.js` は Node 実装のため source できず**ミラー実装**だが、コメントで「規則変更時は双方整合」を明記し、G-4 で一致を実測。循環・不要結合なし。
- **配備＝除去の対称性**: setup が配備する所有エントリと uninstall が除去する所有エントリが同一規則で導出され、ユーザー自作物（所有集合外）は両経路で保持される。02 設計（ユーザー資産非破壊・正本単一化）と一致。
- **00/01 要求の充足**: ユーザー指摘「`.claude` のユーザー資産保全」に対し、skills（claude/cursor）・hooks（claude）の自作物保全を実装・実測。抜け漏れなし。
- **指摘**: なし（通過）。

## G-9. レビュー結果（バッチ G）

- **実装品質**: 良好。`.claude/skills`・`.cursor/skills` の `rm -rf` 全削除と `.claude/hooks` の `rm -rf` 全削除を廃止し、所有エントリ/所有フックのみを選択的に更新・除去する設計へ是正。所有集合の導出を `lib/deploy-skills.sh` の 1 ファイルに集約し、配備と列挙を同一走査規則で導く（drift を構造的に抑制）。uninstall は子→親の空判定で安全側に片付ける。
- **テスト品質**: 良好。R4/R5 を新設し E2E `PASS=77 FAIL=0` を隔離・非破壊で再実行。保持（claude/cursor skills・claude hooks）と所有分の最新化/除去を実測。R4/R5 は TEST_BDD_FORMAT のユースケース/シナリオ/GWT を充足。本リポ own dirs の非破壊を sha256＋git status で実証。
- **ドキュメント品質**: 良好。SETUP.md・README の保持/上書き契約表を「配備分（既知エントリ）のみ更新・ユーザー自作物は保持/共存可」へ刷新し、バッチ F で残課題だった表ヘッダ誤記（軽微1: `.cursor/rules/agents-core.mdc` → `.cursor/agents-core.mdc`）を解消。
- **総合評価**: **承認可（本バッチ範囲・ブロッカーなし）**。ユーザー指摘「`.claude` のユーザー資産保全は？」への是正は、R4（再インストール/upgrade）・R5（uninstall）で実測検証され、`.claude/skills/my-user-skill/`・`.claude/hooks/my-user-hook.sh`・`.cursor/skills/my-user-skill/` が保持され、パッケージ skill/hook は最新化/除去されることを確認。所有集合の単一定義（bash＝Node＝実配備）も突合済み。
- **残課題（軽微・非ブロッカー）**: Node `ownedSkillNames` は bash 関数のミラー実装であり潜在 drift リスクが残る（G-4）。現時点では完全一致。将来 CI に bash↔Node 所有集合一致テストを追加すると堅牢化（任意）。
- **承認者**: worker（auditor/scribe、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・E2E（S1〜S7＋R1〜R5＝77/0）再実行と保持の実測を記載済み・所有集合単一定義の三経路突合済み・build-adapters claude/cursor diff-zero／静的検査／`.adapters` 非リーク確認済み・独立回帰確認済み・本リポ非破壊（sha256＋git status 同一）確認済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由・実 DB 現 head にチェーン連結）。

---

# 【追記バッチ H】フェーズ5 enforcement の opt-in 配線（既定off・enforce on/off/status・PreToolUse 実効性の限界）

> **本バッチの位置づけ**: command **verify-and-close**（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）。直前 implement-feature の未コミット成果（フェーズ5 enforcement を **opt-in／既定 off** で配線。03_実装計画 §2.6）を対象とする。**レビュー深度: standard**（中規模・限定スコープ。settings.json への着脱機構・テンプレート・E2E 追加）。
>
> **evidence_source 凡例**: `test_output`（本レビューで再実行）/ `existing_code`（実ファイル確認）/ `external_spec`（公式仕様）/ `inference_only`（推測。重要判断は不採用）。

## H-1. レビュー対象（変更/新規ファイル）

| ファイル | 変更概要 | evidence |
|----------|----------|----------|
| `.agents/platforms/claude/settings.enforce.json` | **新規・正本テンプレート**。`hooks.PreToolUse`/`PostToolUse` を `${CLAUDE_PROJECT_DIR}/.claude/hooks/PreToolUse.sh`/`PostToolUse.sh` へ結線。`env.AGENT_ROLE=orchestrator`・`env.AGENTS_ROOT=${CLAUDE_PROJECT_DIR}/.agents` を設定。hook の `matcher: "*"` | existing_code |
| `bin/agents-md.js` | `enforce on\|off\|status` を追加。managed hook エントリを `__agentsMdEnforce: true` 目印で着脱、managed env キーはテンプレートの `env` キー集合（`AGENT_ROLE`・`AGENTS_ROOT`）で識別。`on` は既存 settings に**マージ**し上書き前に `.bak` 退避、無効 JSON は破壊回避で中止。`doctor` に enforcement on/off 判定を追加。再 on の冪等性（既存 managed を除去してから注入） | existing_code |
| `.agents/scripts/test/e2e-install-uninstall.sh` | R6（opt-in: 既定 off・on 配線・off 解除・status 表示）・R7（ユーザー settings 非破壊: マージ・`.bak` 退避・off で配線のみ除去）を追加 | existing_code |
| `.agents/SETUP.md`・`README.md` | enforcement 既定 off／`enforce on/off/status` opt-in を明記。保持・上書き契約表に settings.json の着脱行を追加 | existing_code |

## H-2. 受け入れ基準の確認（generate-scenarios → map-coverage）

| 基準 | 検証方法 | 結果 |
|------|----------|------|
| 既定 install では settings.json に enforcement を書かない（off） | R6 E2E + 独立回帰 | **通過**（`assert_absent settings`・`status` が off 表示） |
| `enforce on` で妥当 JSON を生成（`node JSON.parse`） | R6 E2E + 独立回帰 | **通過**（parse OK） |
| hook の command が実在 `.claude/hooks/PreToolUse.sh`/`PostToolUse.sh` を指す | R6 E2E + 独立回帰 | **通過**（init 後にテンプレートの `${CLAUDE_PROJECT_DIR}/.claude/hooks/*.sh` が実在ファイルに解決） |
| `enforce on` で `AGENT_ROLE=orchestrator` が設定される | R6 E2E | **通過** |
| ユーザー settings を破壊せずマージし `.bak` 退避 | R7 E2E + 独立回帰 | **通過**（`MY_USER_VAR`・ユーザー hook・`permissions` 保持、`.bak` 生成） |
| `enforce off` で enforcement 配線のみ除去・ユーザー値保持 | R7 E2E | **通過**（managed env/hook のみ除去、ユーザー値残存） |
| `status`・`doctor` が on/off と hook 実在性を表示 | R6 E2E + 独立回帰 | **通過** |
| 無効 JSON で破壊回避（中止） | existing_code（`readSettings`→null で中止） | **通過**（コードパス確認） |
| build-adapters diff-zero・静的検査・`.adapters` 非リーク | H-5 | **通過** |
| **PreToolUse の tool 別 reject が実機で発火するか** | H-6（existing_code + external_spec） | **未達（残課題・本バッチ範囲外）**。下記 H-6 参照 |

未達: **H-6 の PreToolUse 実効性の限界のみ**（実装者が事前に指摘済み・本バッチ範囲外）。00/01/02/03 の必須セクション欠落は本バッチ範囲で検出なし。

## H-3. E2E 再実行サマリ（test_output・隔離 dir・非破壊）

検証は**未コミットの作業ツリー変更を含むスナップショット**（`mktemp -d` に rsync で working tree を複製→`git init`+1 commit。`git archive HEAD` がスナップショットの新規 `settings.enforce.json`・改修 `bin/agents-md.js` を含むようにするため）で実行した。新規ファイルは untracked のため、開発リポの `git archive HEAD` には含まれず E2E が新コードを通らない点に留意し、上記方式で**新コードを実際に通す**形にした（evidence_source=test_output）。

`bash .agents/scripts/test/e2e-install-uninstall.sh` 実行。**結果: `PASS=88 FAIL=0`／「全シナリオ pass」**。各シナリオは隔離 dir で独立実行。

- **S1-S7・R1-R5**（既存の install/uninstall/冪等/カプセル化/ユーザー資産保全）: 全 pass（回帰なし）。
- **R6**（enforcement opt-in）: 8 アサーション pass。実測:
  - 既定 `init` 後、`.claude/settings.json` は**不在**（enforcement を書かない＝off）。
  - `enforce status`（配線前）が **off** を表示。
  - `enforce on` 後、`settings.json` が **`node JSON.parse` 妥当**。`hooks.PreToolUse[].__agentsMdEnforce` の command が `PreToolUse.sh` を含み、`env.AGENT_ROLE==="orchestrator"`。配線先 `PreToolUse.sh`/`PostToolUse.sh` が**実在**。
  - `enforce status`（配線後）が **on** を表示。`enforce off` 後、status が **off** に戻る。
- **R7**（ユーザー settings 非破壊）: 3 アサーション pass。実測:
  - ユーザー `env.MY_USER_VAR=keepme`・ユーザー hook（`echo user-hook`）・`permissions.allow=[Read]` を持つ settings に `enforce on` → `settings.json.bak` が**退避**。
  - ユーザー値（env/hook/permissions）を**保持**しつつ managed env（`AGENT_ROLE`）と managed hook（`__agentsMdEnforce`）を追加。
  - `enforce off` → managed env/hook のみ除去、ユーザー値（`MY_USER_VAR`・user-hook・permissions）が**残存**。

**追加の独立確認（隔離 dir・test_output）**: `init`→`enforce on` を実行し、生成 settings.json を実測。`status`（on 前 off／on 後）と `doctor` が `[INFO] enforcement 配線 = on` を表示。テンプレートの `${CLAUDE_PROJECT_DIR}/.claude/hooks/*.sh` が init 配備後の実ファイル（`PreToolUse.sh`/`PostToolUse.sh`）に解決することを確認。

## H-4. settings テンプレート JSON 妥当性・hook 実在パス（test_output / existing_code）

- `node JSON.parse(.agents/platforms/claude/settings.enforce.json)` … **parse OK**。
- `hooks.PreToolUse[0].hooks[0].command` が `.claude/hooks/PreToolUse.sh` を含む … **true**。`PostToolUse` 同様 … **true**。
- `env.AGENT_ROLE` = `orchestrator`、`env.AGENTS_ROOT` = `${CLAUDE_PROJECT_DIR}/.agents` … **確認**。
- 配備物正本 `.agents/enforcement/claude/PreToolUse.sh`・`PostToolUse.sh` が**実在**（setup が `.claude/hooks/` へ配備する正本）。

## H-5. 静的検査・diff-zero・リーク（test_output）

- `bash -n .agents/scripts/test/e2e-install-uninstall.sh` … **OK**。
- `node --check bin/agents-md.js` … **OK**。
- `bash .agents/scripts/build-adapters.sh claude` … exit 0。**2 回連続で生成物 sha256 集約一致＝diff-zero**（`e50cea3a…`）。
- `bash .agents/scripts/build-adapters.sh cursor` … exit 0。**2 回連続で一致＝diff-zero**（`e70fbafd…`）。
- `git ls-files .adapters` … **空**（生成物がリポに漏れていない）。
- **開発リポ非変更の実測**: 検証前後で `find .agents .claude .cursor -type f | sort | xargs sha256sum | sha256sum` が**同一**（`92e729ee…9c7c4fd59`）。`git status --porcelain` も **6 行（対象 5 変更＋本 issue ディレクトリ）で `.claude/` 変更なし**。検証は全て `mktemp -d` 隔離 dir／スナップショットで行い、**開発リポの `.claude/`（ライブセッション）を一切変更していない**（安全制約遵守）。

## H-6. PreToolUse.sh 実効性の限界（残課題・本バッチ範囲外）

**結論: 本バッチで配線される `AGENT_ROLE=orchestrator`（env）は実機で効くが、`PreToolUse.sh` の「ツール別 reject」分岐は実 Claude Code では発火しない可能性が高い。** 実装者が事前指摘した残課題を、independent に existing_code＋external_spec で確認した（inference_only 単独依存にしない）。

- **入力取得方法（existing_code）**: `.agents/enforcement/claude/PreToolUse.sh` はツール情報を**環境変数のみ**から取得する。
  - L14-17: `TOOL="${CLAUDE_TOOL_NAME:-${TOOL_NAME:-}}"`、`PATH_TARGET`・`CMD` も `CLAUDE_FILE_PATH`/`FILE_PATH`・`CLAUDE_COMMAND`/`COMMAND` の env からのみ取得。**stdin を一切読まない**（`read`/`jq`/`cat /dev/stdin` 等なし）。
  - 全 reject 分岐は `[[ -n "$TOOL" ]]`（L33）／`[[ -n "$CMD" ]]`（L67, L104）で gate されている。
- **配線が渡す env（existing_code）**: `settings.enforce.json` の hook command は `AGENTS_ROOT` と `AGENT_ROLE` のみを export し、`CLAUDE_TOOL_NAME`/`TOOL_NAME`/`FILE_PATH`/`COMMAND` を**渡さない**。
- **実 Claude Code の契約（external_spec: code.claude.com/docs/en/hooks）**: PreToolUse フックは `tool_name`/`tool_input` を **stdin の JSON** で受け取る。**`CLAUDE_TOOL_NAME`/`TOOL_NAME` という環境変数は存在しない**（`CLAUDE_PROJECT_DIR` は実在する env）。さらに**ブロック用の終了コードは `2`**（本スクリプトの reject は `exit 1`）。
- **帰結**: 実機では `TOOL`/`CMD` が空のまま → L33-110 の orchestrator allowlist・Bash 制限・sqlite3 直接禁止・`.workflow` 直接編集禁止の各 reject が**発火しない**。実際に動くのは L26-30 の**常時案内（CORE/LOAD_POLICY/PHASES 読了・委譲・書記の注意喚起）**と、env に入る `AGENT_ROLE=orchestrator` という**変数の設定のみ**。仮に将来 stdin 対応しても、現状は `exit 1` のため Claude のブロック（`exit 2`）として解釈されない二次的ギャップもある。
- **本バッチ範囲との関係**: 本バッチのスコープは「**配線（settings.json への着脱機構）＋ `AGENT_ROLE` の供給**」であり、PreToolUse.sh の入力取得方法の是正（env→stdin）・ブロック exit code の是正（1→2）は**範囲外**。実装者の自己申告と一致する。
- **後続提案（非ブロッカー）**:
  1. `PreToolUse.sh`/`PostToolUse.sh` を **stdin JSON 読取**（`jq -r '.tool_name'`/`.tool_input` 等）へ改修し、reject を `exit 2`、`jq` 非依存フォールバックを用意するサブ issue を起票。
  2. R6 に「reject 発火」レベルの検証（stdin JSON を流して exit code を確認する hook 単体テスト）を追加。
  3. SETUP.md/README に「現状の enforcement は **AGENT_ROLE 供給＋案内**が主で、ツール別 runtime reject は未発火（CI/audit が事後検知の主役）」という**実効範囲の注記**を加える（過信防止）。

## H-7. TEST_BDD_FORMAT 監査（R6/R7）

`.agents/TEST_BDD_FORMAT.md` に照らし R6/R7 のインラインコメントを確認（existing_code）。

- **ユースケース**: R6（`test_enforcement_optin`）・R7（`test_enforcement_preserves_user_settings`）とも関数直前のブロックコメントに `# ユースケース:` を記載（利用者目線で「何のためのテスト群か」を 3 文以内で説明）。**充足**。
- **シナリオ**: 各テスト関数本体冒頭に `# シナリオ:` コメントを記載（検証する状況・条件を記述）。**充足**。
- **Given/When/Then**: 各ブロック直上に `# Given:`／`# When:`／`# Then:` を 1 つずつ配置。複数操作・複数検証は `# And (When):`／`# And (Then):` を使用（R6 の status→on→off 連鎖、R7 のマージ後検証→off 後検証で確認）。**充足**。
- **指摘**: bash の関数テストという制約上 `ユースケース:`/`シナリオ:` はブロックコメントで表現されるが、TEST_BDD_FORMAT §0 が言語に合わせた doc コメントを許容し、既存 S1-S7・R1-R5 と同一スタイルで一貫。**逸脱なし**。

## H-8. 設計・境界の確認（review-architecture）

- **正本単一化**: enforcement の settings 配線は**正本テンプレート 1 ファイル**（`.agents/platforms/claude/settings.enforce.json`）に集約。`bin/agents-md.js` はそこから env キー集合（managed env）と hook エントリを導出して着脱する。配線内容の二重定義がない（existing_code）。
- **着脱の識別と冪等性**: managed hook は `__agentsMdEnforce: true` 目印、managed env はテンプレート env キー集合で識別。`enforce on` は再実行時に既存 managed を除去してから注入し**冪等**。`off` は managed のみ除去しユーザー値（env/hooks/permissions）を保持。**疎結合・非破壊に適合**。
- **安全側設計**: 無効 JSON は `readSettings`→null で**中止**（破壊回避）。`on` は上書き前に `.bak` 退避。`init`/`setup` は settings.json を touch しない（off 既定）。02 設計（ユーザー資産非破壊・opt-in）と一致。
- **責務の越境なし**: setup（配備）と enforce（settings 着脱）が分離。`doctor` は判定のみで着脱しない。循環・不要結合なし。
- **指摘**: 設計上のブロッカーなし。ただし **H-6 の実効性の限界**は「設計意図（runtime reject）と実機挙動（未発火）の乖離」であり、設計ドキュメント／SETUP に実効範囲の注記を追加する余地がある（非ブロッカー・後続）。

## H-9. レビュー結果（バッチ H）

- **実装品質**: 良好。settings.json への着脱を正本テンプレート＋目印（`__agentsMdEnforce`）＋managed env キー集合で実装し、マージ・`.bak` 退避・無効 JSON 中止・再 on 冪等・off でのユーザー値保持を満たす。`doctor`/`status` に on/off 判定を統合。
- **テスト品質**: 良好。R6/R7 を新設し E2E `PASS=88 FAIL=0` を隔離・非破壊で再実行。既定 off・妥当 JSON・hook 実在パス・`AGENT_ROLE` 設定・ユーザー値非破壊・`.bak` 退避・off での配線のみ除去を実測。TEST_BDD_FORMAT 充足。**未コミット新規ファイルを E2E が実際に通る**ようスナップショット方式で検証した点も記録。
- **ドキュメント品質**: 良好。SETUP.md・README に enforcement 既定 off／`enforce on/off/status` opt-in・保持/上書き契約（settings.json 行）を明記。
- **総合評価**: **承認可（本バッチ範囲＝「opt-in 配線＋AGENT_ROLE 供給」・ブロッカーなし）**。Task の検証条件「既定 off・有効化で妥当 settings.json・hook が実在パス・ユーザー値非破壊・ライブセッション非変更」は**全て test_output で充足**。
- **残課題（重要・非ブロッカー・本バッチ範囲外）**: **H-6 PreToolUse 実効性の限界**。`PreToolUse.sh` が env のみ読取・配線が tool 情報 env を渡さず・実 Claude Code は stdin JSON 渡し（`CLAUDE_TOOL_NAME` env は不在）かつブロック exit code は `2` のため、**ツール別 runtime reject は実機で未発火の可能性が高い**（existing_code＋external_spec で確認）。実機で効くのは `AGENT_ROLE` 供給と常時案内のみ。後続で (1) hook の stdin 化＋`exit 2` 改修、(2) reject 発火の hook 単体テスト追加、(3) 実効範囲の注記、をサブ issue 化することを提案。
- **承認者**: worker（auditor/scribe、orchestrator 委譲） / **承認日**: 2026-06-14
- **DoD**: 04_review 追記済み・E2E（S1〜S7＋R1〜R7＝88/0）再実行を新コードを通す形で記載済み・settings テンプレート JSON 妥当性／hook 実在パス確認済み・build-adapters claude/cursor diff-zero／静的検査／`.adapters` 非リーク確認済み・開発リポ `.claude/` 非変更（sha256＋git status 同一）確認済み・PreToolUse 実効性の限界を existing_code＋external_spec で独立確認し残課題として明記済み・write-workflow-log（step 5）で workflow.db に verify-and-close を記録（書記経由・実 DB 現 head にチェーン連結）。
