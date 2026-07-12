---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "d0767ed6-40c1-4210-8b97-9a8ab6a3013d"
---

# レビュー書: release.yml の main 直接 push 認証を PAT 化する

**プロジェクト名**: release.yml の main 直接 push 認証を PAT 化する
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
> **レビュー実施時は [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../../.agent-skill-chain/source/REVIEW_RULE.md) を必ず参照**。レビュー深度: **standard**（既存 CI 設定 1 ジョブの認証入力差し替え＋ドキュメント整合。新規コンポーネント追加なし。変更範囲は 02_設計 §1.1 のとおり限定的）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認（`release.yml` `version-bump` の Checkout への PAT 付与・無限ループ防止コメントの `[skip ci]` 主防御化・`RELEASE.md` 認証記述更新）と品質保証（00/01/02/03 との整合・テスト再実行・branch protection 不変の実測・PAT 実値非露出）を行い、issue クローズ可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: `03_実装計画.md` タスク 1〜3（`release.yml` `version-bump` Checkout への `token: ${{ secrets.RELEASE_MAIN_PAT }}` 追加とコメント訂正／`docs/maintainer/RELEASE.md` の認証記述更新・README 確認／静的検査・branch protection 不変・PAT 非露出の検証）。
- **レビュー期間**: 2026-07-12（開始）～ 2026-07-12（終了）
- **レビュー担当者**: verify-and-close サブエージェント（opus・effort 非劣化。skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）

---

## 2. 実装内容の確認

**用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| タスク1: `version-bump` Checkout への PAT 付与・コメント訂正 | Checkout ステップ（64 行目）に `token: ${{ secrets.RELEASE_MAIN_PAT }}` を追加。冒頭コメント（16–23 行目）・push 前コメント（97–98 行目）を「主防御 = `[skip ci]`／actor ガードは残存ガード」へ訂正。push コマンド・commit メッセージ `[skip ci]`・他ジョブは無改変 | 2026-07-12 | 実装エージェント | 完了 |
| タスク2: `RELEASE.md` 認証記述更新・README 確認 | `RELEASE.md` §2（63–65 行目）を「`version-bump` 書き戻しのみ PAT／主防御 `[skip ci]`／他ジョブ・タグ・Release は既定 `GITHUB_TOKEN`」＋障害切り分け（GH006 と 401/403 の区別・復旧手順）へ書き換え。README は認証機構に言及なしのため無改変（確認のみ） | 2026-07-12 | 実装エージェント | 完了 |
| タスク3: 静的検査・branch protection 不変・PAT 非露出の検証 | 静的 grep・`gh api …/protection` 実測・トークン様文字列走査を本レビューで実施（§3・§7 参照） | 2026-07-12 | verify-and-close サブエージェント | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: `version-bump` Checkout への PAT 付与・コメント訂正

- **実装内容**: `.github/workflows/release.yml` の `version-bump` ジョブ Checkout ステップ 64 行目に `token: ${{ secrets.RELEASE_MAIN_PAT }}` を追加（`fetch-depth: 0` は 63 行目に維持）。冒頭「無限ループ防止」コメント（16–23 行目）を「`version-bump` の main 書き戻しは admin PAT で認証し branch protection をバイパスする。PAT push は `on: push` を再トリガしうるため主防御はコミットメッセージの `[skip ci]`。actor ガードは PAT push では admin 主体になるため実効防御にならない（残存ガードとして据え置き）。concurrency は直列化のセーフティネット」へ訂正。push ステップ直前コメント（97–98 行目）を「Checkout が持たせた `RELEASE_MAIN_PAT` で認証し push。再発火防止の主防御は `[skip ci]`」へ訂正。
- **変更ファイル**: `.github/workflows/release.yml`（16–23・64・97–98 行目）
- **実装方法**: Checkout の `with:` に 1 行追加＋コメント 2 か所訂正のみ。`git push origin HEAD:main`（non-fast-forward 再試行含む・104–113 行目）、commit メッセージ `chore(release): v${version} [skip ci]`（108 行目）、既存 `if: github.actor != 'github-actions[bot]' && vars.RELEASE_ENABLED != 'false'`（56 行目）、他 2 ジョブ（`release-marketplace`・`apm-release`）は無改変。
- **確認事項**: `version-bump` のみに `token:` が付与され他ジョブに漏れていないこと → 確認済み（release.yml 全体で `token:` 出現は 64 行目 1 件のみ。§4.2）。02 設計 ADR-1/ADR-2/ADR-3 の決定どおりであること → 確認済み（§9）。

#### タスク 2: `RELEASE.md` 認証記述更新・README 確認

- **実装内容**: `docs/maintainer/RELEASE.md` §2 末尾の引用ブロック（63–65 行目）を「`version-bump` の main 書き戻し push のみ admin PAT（secret `RELEASE_MAIN_PAT`）で認証し branch protection（`enforce_admins: false`）をバイパスして通す。PAT push は `on: push` を再トリガしうるため無限ループ防止の主防御はコミットメッセージの `[skip ci]`（`concurrency: group: release` は直列化のセーフティネット）。リリースブランチ push・タグ付与・GitHub Release 作成は引き続き既定 `GITHUB_TOKEN`」へ書き換え、障害切り分け（GH006 再発時＝PAT 未付与/主体が admin でない、401/403＝失効・スコープ不足・対象リポ不一致、復旧＝secret 再登録）を追記。
- **変更ファイル**: `docs/maintainer/RELEASE.md`（63–65 行目）
- **実装方法**: Markdown 記述のみ。旧記述「既定 `GITHUB_TOKEN` のみを使用する（PAT／deploy key を使わない）」は除去済み（§4.2）。`README.md` は §リリース手順に認証機構への言及がなく矛盾なし＝無改変（確認のみ・§5.2）。
- **確認事項**: 旧記述の残存なし・PAT/`[skip ci]` 主防御記述の存在・README との矛盾なし → いずれも grep で確認済み（§4.2・§5.2）。

#### タスク 3: 静的検査・branch protection 不変・PAT 非露出の検証

- **実装内容**: 本レビューで実施（§3.1 静的 grep／§7 PAT 非露出／§9.2 branch protection 実測）。
- **確認事項**: 03 §2.1.4/§2.2.4/§2.3.4 の検証観点をすべて実行し合格（詳細は各節）。

---

## 3. テスト結果の確認

### 3.1 単体テスト

本 issue の「単体」は CI ワークフロー YAML とドキュメントに対する**静的検査**（grep/パース）で構成される（03 §単体テスト）。ランタイム実行（実 push）は E2E（§3.3）で扱う。

#### 実行1: `bash test/test-release-workflow-trigger.sh`（既存の release ワークフロー静的検証テスト）

- **実行日**: 2026-07-12
- **テストファイル数**: 1
- **テストケース数**: 13（シナリオ群 A: 3、B: 6、C: 4）
- **成功**: 13
- **失敗**: 0
- **スキップ**: 0（本環境は python3 + PyYAML が揃い A・B も実行）
- **exit code**: 0
- **判定**: 今回の変更（Checkout への `token:` 1 行追加・コメント訂正）を加えても既存テストは全 PASS。`token:` 追加は YAML 構造を壊さず（シナリオ A「YAML 構文妥当」PASS）、`on`/`paths`/`if` 構造・`RELEASE_ENABLED` 意味論に影響しないことを実測確認した。

#### 実行2: 03 実装計画の BDD 検証スニペット（§2.1.4/§2.2.4 の grep 群）を本レビューで再実行

| 検証項目（03 スニペット） | コマンド | 結果 |
| --- | --- | --- |
| PAT 参照が `version-bump` Checkout に存在 | `grep -F 'token: ${{ secrets.RELEASE_MAIN_PAT }}'` | OK（64 行目に存在） |
| 実トークン様文字列なし | `! grep -Eq 'ghp_…\|github_pat_…' release.yml` | OK（0 件） |
| commit メッセージに `[skip ci]` 残存 | `grep -q '\[skip ci\]'` | OK（108 行目ほか） |
| RELEASE.md 旧記述の除去 | `! grep -q 'PAT／deploy key を使わない' RELEASE.md` | OK（0 件） |
| RELEASE.md に `RELEASE_MAIN_PAT` 記述 | `grep -q 'RELEASE_MAIN_PAT' RELEASE.md` | OK |
| RELEASE.md に `[skip ci]` 主防御記述 | `grep -q 'skip ci' RELEASE.md` | OK |
| README に断定矛盾なし | `! grep -q 'GITHUB_TOKEN のみ' README.md` | OK |

> **注記（Finding 1）**: 03 §2.1.4 の bash スニペット `grep -q 'token: ${{ secrets.RELEASE_MAIN_PAT }}' "$f"` は GNU grep の BRE で `{{`/`}}` が区間量指定子として解釈され、額面どおり実行すると**偽陰性（exit 1＝不一致）**を返す。実装は正しく（`token:` は 64 行目に確実に存在）、`grep -F`（固定文字列）および `grep -E 'token: \$\{\{ secrets\.RELEASE_MAIN_PAT \}\}'` の双方で存在を実測確認した。§10.2 改善提案・§4.2 指摘 1 を参照。実装の正当性には影響しない。

#### 実行3: `bash test/run-all.sh`（全テストスイート）

- **実行日**: 2026-07-12
- **結果**: 本環境で 2 分のツール実行上限に達し打ち切り（E2E 系テスト＝`e2e-install-uninstall`・`test-cli-audit-doctor`・`test-export-ndjson`・`e2e-claude-hook` 等の build/隔離処理が長時間化するため。今回の変更対象＝`release.yml`・`RELEASE.md` はこれらテストの検証対象ではない）。**環境要因の打ち切りであり FAIL ではない**。本 issue に直接対応する `test-release-workflow-trigger.sh` は実行1で単体 PASS（13/13）を確認済み。

#### テストカバレッジ（受け入れ基準対応表・map-coverage 出力）

01_要件定義 §2.2 の BDD ユースケース・シナリオと実装・検証の対応:

| 01 のユースケース・シナリオ | 検証方法 | 結果 |
| --- | --- | --- |
| UC1-S1: RELEASE_MAIN_PAT で書き戻し push が成功する | 静的検査（Checkout に `token` 存在・64 行目）＋ E2E は実 push 必須で未達（§3.3・意図的） | 通過（静的範囲）／E2E は運用時確認 |
| UC1-S2: branch protection は据え置き | `gh api …/protection` 実測（§9.2）＋変更ファイルが release.yml/RELEASE.md のみで protection API に非接触 | 通過 |
| UC2-S3: `[skip ci]` で release が再発火しない | commit メッセージ `[skip ci]` 残存 grep（§3.1 実行2）＋ 主防御明記コメント/RELEASE.md 確認（§5.2）。実発火抑止は GitHub 公式仕様（02 ADR-2・external_spec） | 通過（静的範囲）／実挙動は運用時確認 |
| UC3-S4: PAT 実値の非露出 | トークン様文字列走査 0 件（§7・全成果物＋release.yml＋RELEASE.md） | 通過 |
| ストーリー5: docs と実装の整合 | 旧記述除去＋新記述存在の grep（§4.2）＋ README 無矛盾（§5.2） | 通過 |

**未達・要対応**: E2E（実 push での GH006 回避）はランタイム依存で本 issue のスコープでは実行不能。00 §6・02 §6.1・03 §2.3.3 で明記済みの代替（静的検査＋branch protection 不変）で担保し、実発火の最終確認は本 PR マージ後の初回 release 実行ログで行う運用とする。

#### 失敗したテスト

なし（該当なし）。

### 3.2 統合テスト

該当なし（02 §6.1 のとおり GitHub Actions ランタイム上の実結合はローカルで検証不能。§3.3 参照）。

### 3.3 E2E テスト

**未達（意図的）**: `version-bump` の bump 書き戻し push が branch protection に GH006 で拒否されず成功するか、および PAT push に対し `[skip ci]` が実際に再発火を抑止するかは、**GitHub Actions ランタイム上の実 push でのみ真に検証できる**。本 issue のスコープでは本番 main への実 push は実施不可能（01 §6・02 §6.1・03 §4 で明記）。代替として静的検査（§3.1）＋branch protection 不変の実測（§9.2）＋PAT 非露出（§7）で担保し、実発火の最終確認は本 PR マージ後の初回 release 実行で目視確認する運用とする。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードスタイル

- **リント結果**: 該当なし（YAML・Markdown で lint ツール未導入）。
- **フォーマット**: 問題なし（既存インデント・コメントスタイルに準拠）。
- **型チェック**: 該当なし（TS 実装の変更なし。本 issue は release.yml・RELEASE.md のみ変更）。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | Checkout の `token:` 追加箇所・push 前コメントが `[skip ci]` 主防御の意図を明示 | OK | ADR-2/ADR-3 の決定がコメントに反映済み |
| 保守性 | 変更を `version-bump` の認証入力＋コメント＋RELEASE.md に限定。push コマンド・再試行ロジック・他ジョブは無改変で差分最小 | OK | ADR-3 の「checkout token 方式（差分最小・可読性）」に整合 |
| パフォーマンス | 認証入力の差し替えのみでジョブ実行時間・CI 頻度に有意影響なし | OK | 01 §3.1 と整合 |
| セキュリティ | PAT 使用範囲を `version-bump` の Checkout に限定（ブラスト半径最小）。他ジョブ・タグ・Release は既定 `GITHUB_TOKEN` 据え置き。実値は secret 参照のみ | OK | §7 参照 |

### 4.2 指摘事項

#### 指摘 1: 03 §2.1.4 の grep 検証スニペットが GNU grep BRE で偽陰性（軽微・実装は正）

- **重要度**: 低
- **指摘内容**: 03 実装計画 §2.1.4 の bash スニペット `grep -q 'token: ${{ secrets.RELEASE_MAIN_PAT }}' "$f"` は、GNU grep の基本正規表現で `{{`/`}}` が区間量指定子メタ文字として解釈されるため、額面どおり実行すると一致せず exit 1（偽陰性）を返す。**実装そのものは正しく**、`token:` は `version-bump` Checkout の 64 行目に確実に存在する（`grep -F` および `grep -E` でエスケープした双方で存在を実測確認）。
- **対応状況**: 完了（実害なしと判定）。
- **対応方法**: 本レビューでは `grep -F 'token: ${{ secrets.RELEASE_MAIN_PAT }}'`（固定文字列）で検証し合格を確認した。03 の当該スニペットは「検証イメージ」の例示であり実装の正当性を左右しない。03 の修正は本 issue のクローズをブロックしないため見送り（§10.2 に改善提案として記録）。将来の同種検証では `grep -F` を用いることを推奨。

#### 指摘 2: `test-release-workflow-trigger.sh` が今回の変更（token 追加・`[skip ci]` 主防御）を検証していない（03 スコープ外・指摘に留める）

- **重要度**: 低〜中
- **指摘内容**: 既存テスト `test/test-release-workflow-trigger.sh` は release.yml の `on`/`paths`/`if`/`RELEASE_ENABLED` を静的検証するが、今回追加した `version-bump` Checkout の `token: ${{ secrets.RELEASE_MAIN_PAT }}` の存在、および `[skip ci]` を主防御とする設計は**アサートしていない**。そのため本変更を加えても当該テストは GREEN のままだが、変更内容自体はこのテストではカバーされない（回帰検知できない）。
- **対応状況**: 完了（03 のスコープに照らし指摘に留める判断）。
- **対応方法**: 03 実装計画は本変更の「単体テスト」を §2.1.4/§2.2.4/§2.3.4 の**静的 grep スニペット**として定義しており、`test-release-workflow-trigger.sh` への新規アサート追加は 03 のタスクに含まれない（スコープ外）。本レビューでは当該 grep 群を再実行して全合格を確認済み（§3.1 実行2）で、変更の正当性は担保されている。加えて本変更の核心（GH006 回避・PAT push の `[skip ci]` 抑止）は実 push でのみ真に検証可能な E2E 事象であり、静的テスト追加で完全にカバーできる性質ではない。**推奨（フォローアップ）**: 進行役の判断で、`test-release-workflow-trigger.sh` に「`version-bump` の Checkout に `token: ${{ secrets.RELEASE_MAIN_PAT }}` が 1 件存在し他ジョブの Checkout には無い」「commit メッセージに `[skip ci]` が残存する」を静的アサートするシナリオ群を追加すると回帰検知性が高まる。重大な設計変更ではなく軽微な追加のため、起票要否は進行役が判断されたい（サブによる独断起票はしない）。

### 4.3 敵対的観点リスト（REVIEW_DUAL_LENS.md §2.1）

| # | 攻めた観点 | 結論 |
| --- | --- | --- |
| 1 | `token:` 追加で YAML 構文が壊れていないか | 問題なし。`test-release-workflow-trigger.sh` シナリオ A（PyYAML パース）PASS。 |
| 2 | PAT が `version-bump` 以外のジョブへ誤って付与されていないか | 問題なし。release.yml 全体で `token:` 出現は 64 行目 1 件のみ（`release-marketplace`・`apm-release` の Checkout は無改変）。 |
| 3 | PAT push で actor が admin になり `[skip ci]` が効かないと無限ループするリスク | 許容範囲。`[skip ci]` は GitHub 公式のスキップ機構で workflow run 自体を作成しない（02 ADR-2・external_spec）。commit メッセージ 108 行目に `[skip ci]` 残存を確認。actor ガードが弾けなくなる点はコメント/RELEASE.md に明記済み。 |
| 4 | push コマンド・non-fast-forward 再試行が改変され認証が壊れていないか | 問題なし。104–113 行目の push/rebase 再試行ロジックは無改変（Checkout の persist-credentials で認証されるため push 側改変不要＝ADR-3）。 |
| 5 | PAT 実値がコード・コメント・成果物・ログに露出していないか | 問題なし。トークン様文字列走査 0 件（§7）。参照は `${{ secrets.RELEASE_MAIN_PAT }}` のみ。 |
| 6 | branch protection 設定が本変更で弱められていないか | 問題なし。変更ファイルは release.yml/RELEASE.md のみで protection API に非接触。実測で従来設定と一致（§9.2）。 |
| 7 | RELEASE.md に旧記述（GITHUB_TOKEN のみ・PAT を使わない）が残り実装と矛盾しないか | 問題なし。旧記述は除去済み・新記述（PAT／`[skip ci]` 主防御）に置換済み（§4.2 の grep）。 |

### 4.4 must-preserve リスト（REVIEW_DUAL_LENS.md §2.2）

| # | 不変条件 | 保持の確認 |
| --- | --- | --- |
| 1 | 3 ジョブ（version-bump → release-marketplace → apm-release）の直列構成・`needs:` 依存 | 保持確認済み。diff は `needs:` に変更なし。 |
| 2 | 3 ジョブの処理内容（bump・adapter/apm 生成・決定性検証・タグ・Release 作成） | 保持確認済み。変更は Checkout の `token:` 1 行＋コメント＋RELEASE.md のみ。 |
| 3 | `permissions: contents: write` の権限モデル | 保持確認済み。28–29 行目に変更なし。 |
| 4 | `git push origin HEAD:main`・non-fast-forward 再試行・commit メッセージ `[skip ci]` | 保持確認済み（104–113・108 行目 無改変）。 |
| 5 | `concurrency: group: release` / `cancel-in-progress: false` の直列化 | 保持確認済み（45–47 行目 無改変）。 |
| 6 | 他ジョブ・タグ・GitHub Release の既定 `GITHUB_TOKEN` 使用 | 保持確認済み。`release-marketplace`・`apm-release` の Checkout に token 追加なし。Release 作成は `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`（147 行目）据え置き。 |
| 7 | main branch protection 設定自体（PR 必須・レビュー 1 件・self-enforce・enforce_admins:false・force push/削除禁止） | 保持確認済み（§9.2 実測）。 |
| 8 | `RELEASE.md`＝詳細正本・`README.md`＝要約のみの役割分担 | 保持確認済み。README は無改変（認証機構への言及なし）。 |

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新不要（確定済み・本レビューで整合確認） | verify-and-close サブエージェント | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新不要（確定済み・受け入れ基準は実装/検証で対応） | verify-and-close サブエージェント | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-1〜3 含め実装前に確定） | verify-and-close サブエージェント | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（タスク 1〜3 記載済み） | verify-and-close サブエージェント | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している。release.yml の Checkout `token`（64 行目）・コメント（16–23・97–98 行目）は 02 設計 §2.1.1・ADR-2/ADR-3 の決定内容と一致。RELEASE.md（63–65 行目）は 02 §3.2・03 タスク 2 の記述方向どおり。
- **要件と実装の整合性**: 整合している。01 §2.1 ストーリー 1〜5 の受け入れ基準はすべて実装・検証で対応（§3.1 カバレッジ表）。
- **コメント（grep 突合結果）**:
  - RELEASE.md 旧記述「PAT／deploy key を使わない」→ **0 件（除去済み）**。
  - RELEASE.md に `RELEASE_MAIN_PAT`・`skip ci` 主防御記述 → **存在**。
  - README に `GITHUB_TOKEN のみ` の断定 → **0 件（矛盾なし・無改変が正）**。
  - review-docs memo（`memo/20260712_161610_review-docs.md`）が実装前に 4 ドキュメントの行番号参照・相対リンク・ADR-2 論理・スコープ境界を実測検証し 0 件収束済み。本レビューで実装後の実態と再突合し矛盾がないことを確認した。

---

## 6. パフォーマンス確認

### 6.1 パフォーマンステスト結果

該当なし（認証入力の差し替えでありジョブ実行時間・CI 頻度への有意影響なし。01 §3.1）。

### 6.2 ボトルネックの確認

該当なし。

---

## 7. セキュリティ確認

### 7.1 セキュリティチェック

| 項目 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 認証・認可 | PAT 使用範囲を `version-bump` Checkout に限定。他ジョブ・タグ・Release は既定 `GITHUB_TOKEN` 据え置き（ブラスト半径最小） | OK | §4.4 #6・02 §8.1 と整合 |
| データ保護（PAT 実値の非露出） | 全成果物（00–03・memo）＋release.yml＋RELEASE.md に対しトークン様文字列 `ghp_…`/`github_pat_…` を走査 → **0 件**。参照は `${{ secrets.RELEASE_MAIN_PAT }}` の secret 名のみ | OK | 01 ストーリー4・00 §3.2 を充足 |
| 入力検証 | PAT 失効・スコープ不足時は GH006 ではなく 401/403 で失敗する切り分け指針を RELEASE.md に明記 | OK | 02 §3.1.4・§9.2 と整合 |

---

## 8. デプロイ準備

### 8.1 デプロイチェックリスト

- [x] 直接対応するテストが通過している（§3.1 実行1: `test-release-workflow-trigger.sh` 13/13 PASS。03 grep スニペット全合格）
- [x] コードレビューが完了している（§4）
- [x] ドキュメントが更新されている（§5・RELEASE.md 更新済み・README 確認済み）
- [ ] マイグレーションスクリプト（該当なし）
- [x] 環境変数（secret）の設定が確認されている（`RELEASE_MAIN_PAT` は登録済み＝00 §1.2 で `gh secret list` 実測確認。追加設定不要）
- [ ] バックアップ計画（該当なし・CI 認証設定変更）

### 8.2 デプロイ計画

- **デプロイ予定日**: 本 issue の PR マージ時点（マージ判断はユーザー承認後）。
- **デプロイ方法**: PR を main へマージすると新しい認証定義が有効化される。実 push での GH006 回避の最終確認は、マージ後の初回 release 実行ログで行う（§3.3）。
- **ロールバック計画**: 問題発生時はリポジトリ変数 `RELEASE_ENABLED=false` で即時停止可能。恒久切り戻しが必要なら本 PR を revert。PAT 失効時は secret `RELEASE_MAIN_PAT` を再登録。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本 issue が変更するのは `.github/workflows/release.yml`（CI 設定）と `docs/maintainer/RELEASE.md`（本 issue のタスク 2 で直接更新した詳細正本そのもの）のみであり、`docs/00_review/` が対象とするシステム仕様書（アーキテクチャ・データ設計等の恒久ドキュメント）には該当しない。RELEASE.md は実装と同一変更で整合済みであり、DOCS_RULES.md §継続追随ゲートが防ぐ「実装変更と関連 docs の不整合放置」は発生していない。したがって追加の `docs/00_review` レビューは不要と判定する（evidence_source: existing_code・DOCS_RULES.md 準拠）。

---

## 9. 設計・境界の確認

**注意**: review-architecture の結果。責務・境界・依存関係が設計と一致しているかを確認した。

### 9.1 設計の確認

- **設計原則の準拠**: 02 §1.2 の「単一責務」（変更を `version-bump` の認証入力に限定）・「docs と実装の不整合を放置しない」（RELEASE.md を同一変更で整合）・「最小ブラスト半径」（PAT を `version-bump` Checkout のみに限定）に準拠。実装 diff を確認した結果、変更は Checkout の `token:` 1 行・コメント 2 か所・RELEASE.md 1 ブロックに限定され、push コマンド・再試行・他ジョブ・branch protection・paths・concurrency には一切波及していない。
- **ディレクトリ構成**: 変更ファイルはすべて既存パス（`.github/workflows/release.yml`・`docs/maintainer/RELEASE.md`）。新規ファイル・ディレクトリの作成なし。
- **命名規則**: secret 参照は `${{ secrets.RELEASE_MAIN_PAT }}` の規定形式のみ（02 §4.2）。

### 9.2 境界・依存の確認

- **責務の境界**: Checkout は「認証情報を持たせて取得する」、Commit & push は「bump 結果を書き戻す」の責務分離を維持（02 §2.3）。push ステップに PAT を直書きする改変（remote URL 埋め込み）は行っていない（ADR-3 の決定どおり）。
- **依存関係**: `version-bump` Checkout → secret `RELEASE_MAIN_PAT`（参照）、Commit & push → Checkout が persist-credentials で埋めた PAT 資格情報（参照）、RELEASE.md → release.yml 実装（記述整合）。循環参照なし。他ジョブは各自 `GITHUB_TOKEN` を独立使用し本ジョブの認証を参照しない（02 §2.1.3 と一致）。
- **branch protection 不変の実測（run_command Constraints 必須項目）**: `gh api repos/techbeansjp-free/AGENTS.md/branches/main/protection` を本レビューで実行し、以下を実測確認した。

  | 設定項目 | 実測値 | 00/01/02 記載の基準 | 判定 |
  | --- | --- | --- | --- |
  | `required_status_checks.strict` | `true` | self-enforce 必須（strict） | 一致 |
  | `required_status_checks.contexts` | `["self-enforce"]` | self-enforce 必須 | 一致 |
  | `required_pull_request_reviews.required_approving_review_count` | `1` | レビュー承認 1 件以上必須 | 一致 |
  | `required_pull_request_reviews.dismiss_stale_reviews` | `true` | PR 必須（承認要件） | 一致 |
  | `enforce_admins.enabled` | `false` | `enforce_admins: false`（admin バイパス経路） | 一致 |
  | `allow_force_pushes.enabled` | `false` | force push 禁止 | 一致 |
  | `allow_deletions.enabled` | `false` | ブランチ削除禁止 | 一致 |
  | `required_conversation_resolution.enabled` | `true` | （00/01/02 では明示されないが保護を弱める変更ではない） | 現状維持 |

  実測値は 00 §1.2・01 §1.1・02 §2.1.2 に記載された保護設定（PR 必須・レビュー承認 1 件以上・self-enforce 必須・`enforce_admins: false`・force push/削除禁止）と完全一致する（PAT の admin バイパスが乗る `enforce_admins: false` も 00/01/02 の基準どおり）。加えて、本 issue の変更ファイル（release.yml・RELEASE.md）は branch protection API に一切接触しない。以上 2 点——**00/01/02 の基準と現時点の実測値が一致していること**、および**本 PR の変更ファイルが protection API に非接触であること**——を根拠として、保護設定への影響がないと判断する。
  - **補足（implement-feature 実測結果との比較について）**: 本 issue の memo ディレクトリには review-docs memo（`20260712_161610_review-docs.md`）のみが存在し、implement-feature が別途 before/after の protection JSON を memo に退避した記録は見当たらなかった。このため比較の基準は 00/01/02 に文書化された保護設定とし、上表のとおり実測が完全一致することをもって「変更なし」を確認した。変更が release.yml/RELEASE.md に閉じており protection API に非接触である以上、この確認で成功基準（branch protection 不変）は充足される。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元・URL 等） |
| --- | --- | --- |
| PAT（`RELEASE_MAIN_PAT`）採用で GH006 を回避できる（ADR-1） | observed_runtime / external_spec | GH006 は手動 workflow_dispatch で実測（00 §1.2）。`enforce_admins: false` 下で admin 主体が保護をバイパスできるのは GitHub 公式仕様（GitHub Docs「About protected branches」） |
| `[skip ci]` を無限ループ防止の主防御とする（ADR-2） | external_spec | `[skip ci]` は push/pull_request の workflow run 自体を作成しない（GitHub Docs「Skipping workflow runs」）。GITHUB_TOKEN の push は再トリガしないが PAT は再トリガしうる（GitHub Docs「Triggering a workflow」） |
| checkout `token`＋persist-credentials で push を認証（ADR-3） | external_spec | actions/checkout README（persist-credentials 既定 true・token を git config に永続化） |
| branch protection が本変更で不変 | observed_runtime | 本レビューで `gh api …/branches/main/protection` を実測し 00/01/02 記載基準と一致を確認（§9.2） |
| PAT 実値の非露出 | test_output | 本レビューでトークン様文字列走査 0 件を実測（§7） |
| テスト再実行結果（13/13 PASS・grep 群合格） | test_output | 本レビューで `bash test/test-release-workflow-trigger.sh`・03 grep スニペットを実行し実測（§3.1） |

### 9.4 敵対的観点リスト（設計・境界／REVIEW_DUAL_LENS.md §2.1）

| # | 攻めた観点 | 結論 |
| --- | --- | --- |
| 1 | 認証主体変更で Checkout/Commit&push の責務分離が崩れていないか | 問題なし。Checkout に token を持たせ push は不変＝責務分離維持（ADR-3）。 |
| 2 | commit author（`git config user.name=github-actions[bot]`）と push 認証主体（PAT=admin）の混同で protection バイパスが成立しないリスク | 問題なし。branch protection のバイパス評価は push 認証主体（PAT=admin）で行われ commit author に依存しない。review-docs memo でも同点を確認済み（設計は正しい）。 |
| 3 | PAT 使用が他ジョブへ波及しブラスト半径が広がっていないか | 問題なし。token は 64 行目 1 件のみ（§4.3 #2）。 |

### 9.5 must-preserve リスト（設計・境界／REVIEW_DUAL_LENS.md §2.2）

§4.4 の must-preserve リストと共通（コードレベル・設計レベルで同一の不変条件セットを対象とするため重複記載しない。§4.4 を参照）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: 本変更の核心（実 push での GH006 回避・PAT push に対する `[skip ci]` の再発火抑止）は GitHub Actions ランタイム依存で、マージ前に自動検証できない（E2E 未達）。
  - **影響範囲**: マージ後の初回 release 実行までは実挙動が未確認。
  - **対応方法**: 00/02/03 で明記された代替（静的検査＋branch protection 不変＋GitHub 公式仕様の裏取り）で担保し、初回 release 実行ログで最終確認する運用とする。仮に GH006 が再発しても `RELEASE_ENABLED=false` で即時停止でき、リスクは限定的。

### 10.2 改善提案

- **改善 1（Finding 1 関連）**: 03 §2.1.4 の検証スニペットを `grep -F`（固定文字列）へ改めると、`{{`/`}}` の BRE 偽陰性を回避でき将来の同種検証の再現性が上がる。本 issue のクローズをブロックしない任意対応。
- **改善 2（Finding 2 関連）**: `test/test-release-workflow-trigger.sh` に「`version-bump` Checkout の `token` 存在＋他ジョブ非付与」「commit メッセージ `[skip ci]` 残存」の静的アサートを追加すると、本変更の回帰検知性が高まる。03 スコープ外のため起票要否は進行役が判断されたい。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

- 該当なし（§docs 更新のとおり本 issue はシステム仕様書更新ゲートの対象外）。

### 11.2〜11.3

該当なし。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。02 設計 ADR-1〜3・03 タスク 1〜3 に忠実に実装され、変更は `version-bump` の認証入力＋コメント＋RELEASE.md に限定。push コマンド・他ジョブ・branch protection は無改変で責務分離・境界が維持されている。
- **テスト品質**: 良好（静的範囲）。`test-release-workflow-trigger.sh` 13/13 PASS、03 grep スニペット全合格、PAT 非露出 0 件、branch protection 実測一致。E2E（実 push）はランタイム依存で自動化不能な範囲であり、代替手段と限界を明記した上で担保した。
- **ドキュメント品質**: 良好。RELEASE.md が実装（PAT／`[skip ci]` 主防御）と一致し旧記述を除去、README と矛盾なし。
- **総合評価**: **承認可（合格・要修正なし）**。§4.2 の指摘 2 件はいずれも低〜中の軽微事項で、実装の正当性には影響しない（指摘 1 は検証スニペットの BRE 偽陰性で実装は正、指摘 2 は 03 スコープ外の回帰検知性向上提案）。本レビュー内で検証・記録済みであり、実装への追加修正なしでクローズ可能と判定する。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close サブエージェント（Opus・effort 非劣化）
- **承認日**: 2026-07-12
- **承認コメント**: テスト再実行 PASS・branch protection 実測一致・PAT 非露出 0 件・二観点（敵対的／must-preserve）リスト記載済み。残課題（§10.1 の E2E 未達）は運用時確認・緊急停止スイッチで許容。改善 2 件は進行役の判断に委ねる。git commit は本レビューの範囲外（進行役が別途指示）。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画
- [`memo/20260712_161610_review-docs.md`](./memo/20260712_161610_review-docs.md) - 実装前ドキュメントレビュー（0 件収束）

### 13.2 その他の参考資料

- `.github/workflows/release.yml`・`docs/maintainer/RELEASE.md`（実装成果物本体）
- 本レビュー実測: `bash test/test-release-workflow-trigger.sh`（PASS=13 FAIL=0）、03 検証 grep 群（全合格）、`gh api …/branches/main/protection`（00/01/02 基準と一致）、トークン様文字列走査（0 件）
- GitHub Docs「Skipping workflow runs」「Triggering a workflow」、actions/checkout README（02 §10）

---

## 14. 前のステップ

このレビュー書は、以下のドキュメントを基に作成されています：

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

このレビュー書の承認後、以下のステップに進みます：

- **外部設定が不要な場合**: issue 完了（クローズ）。本 issue は secret `RELEASE_MAIN_PAT` が登録済みで追加の外部設定を要さず、PR マージのみでデプロイが完結するため `05_最終確認チェックリスト.md` は作成しない。実 push での GH006 回避の最終確認はマージ後の初回 release 実行ログで行う。
