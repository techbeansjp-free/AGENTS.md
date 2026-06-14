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

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md)・[`01_要件定義.md`](./01_要件定義.md)・[`02_設計.md`](./02_設計.md)・[`03_実装計画.md`](./03_実装計画.md)
- [`memo/20260614_153629_軽微1schema単一化_軽微3自己CI実体化.md`](./memo/20260614_153629_軽微1schema単一化_軽微3自己CI実体化.md)
- `.agents/ledger/schema.sql`・`.agents/ledger/schema.md`・`.github/workflows/self-enforce.yml`
- `.agents/scripts/setup.sh`・`.agents/scripts/write-workflow-log.sh`・`.agents/enforcement/ci/audit.sh`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) ＋ implement-feature（chain: implement-change）成果物。

## 15. 次のステップ

- 本バッチ範囲はクローズ可。issue 全体は 03 フェーズ1〜5 を後続タスクで継続。
- 証跡: write-workflow-log.sh により workflow.db へ verify-and-close を記録（step 5）。
