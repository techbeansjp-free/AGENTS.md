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
