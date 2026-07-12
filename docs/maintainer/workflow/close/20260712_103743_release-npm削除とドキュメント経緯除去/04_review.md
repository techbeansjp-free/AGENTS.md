---
document_id: "7d4dc7e5-fdb2-44f8-ace6-99f70f387b64"
---

# レビュー書: release-npm ジョブ完全削除とコメント/README の経緯記述除去

**プロジェクト名**: release-npm削除とドキュメント経緯除去
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **重要**: 本レビューは verify-and-close command の skill chain（generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従い、[.agent-skill-chain/source/REVIEW_RULE.md](../../../../../.agent-skill-chain/source/REVIEW_RULE.md) を参照して実施した。
> **レビュー深度**: full（新規スクリプト・CI 定義の構造変更・複数ドキュメント改訂を含む中〜大規模。最重要 issue のため）。

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認・品質保証・クローズ前最終チェックを行い、SC-1〜SC-5・SC-7 と 01 の BDD 全シナリオが機械判定で成立することを、レビュワー自身の再実行によって独立に裏付ける。

### 1.2 レビュー対象

- **実装範囲**: T1〜T9（03_実装計画.md）。release-npm 完全削除・version-bump 新設・依存張替え（T4）、コメント規約検知スクリプト新設と audit.sh 委譲（T1・T2）、テスト新設/登録（T3）、self-enforce.yml コメント是正＋blocking step 追加（T5・T6）、README/RELEASE.md/apm-package.md/adapters.md の経緯記述除去（T7・T8）、全体検証（T9）。
- **変更ファイル（本 issue 対象・11 件、`changed_files_json` と一致）**: 新設 `check-comment-refs.sh`・`test-check-comment-refs.sh`。変更 `audit.sh`・`run-all.sh`・`test-audit.sh`・`release.yml`・`self-enforce.yml`・`README.md`・`RELEASE.md`・`apm-package.md`・`adapters.md`。
- **レビュー担当者**: verify-and-close サブエージェント（auditor 区分・opus・xhigh）。

> 注: 作業ツリーには前 issue「npm配布導線ノイズ是正」の未コミット修正が同一ファイル（README.md 等）へ重畳している。README.md の working-tree diff には本 issue の経緯除去分と前 issue の npx github: 記法書き換え分が混在するが、これは 00 §5・01 §5・03 §4 リスクで既知・許容。SC-4 等の機械判定は最終合成状態で成立を確認した。

---

## 2. 実装内容の確認（review-code）

### 2.1 実装完了タスク

| タスク | 実装内容 | ステータス |
| --- | --- | --- |
| T1 | `check-comment-refs.sh` 新設（検知ロジック単一正本・§5.2 契約） | 完了 |
| T2 | `audit.sh` check #26 を委譲リファクタ（走査対象決定＋FAIL 集約のみ保持） | 完了 |
| T3 | `test-check-comment-refs.sh` 新設・`run-all.sh` 登録・`test-audit.sh` へ回帰追加 | 完了 |
| T4 | `release.yml` release-npm 削除・version-bump 新設・依存張替え・コメント是正 | 完了 |
| T5 | `self-enforce.yml` コメント是正（正本 3 行削除・境界事例是正） | 完了 |
| T6 | `self-enforce.yml` blocking step 追加（continue-on-error なし） | 完了 |
| T7 | `README.md` 経緯記述除去・リリース手順節書き換え | 完了 |
| T8 | `RELEASE.md` 全面改訂・`apm-package.md`/`adapters.md` 整合 | 完了 |
| T9 | 全体検証（SC-1〜SC-5・SC-7・全テスト非破壊） | 完了 |

### 2.2 重点確認（レビュワー自身の再実行による裏付け）

#### (A) SC-1: release-npm・NPM_TOKEN の完全消去 — OK

- `grep -rn 'release-npm' .github/` → 0 件。`grep -c 'NPM_TOKEN' .github/workflows/release.yml` → 0。
- 禁止語彙 `grep -nE '案[A-C]|dormant|撤去済み|再開' release.yml` → 0 件。
- evidence_source: observed_runtime（レビュワー再実行、2026-07-12）。

#### (B) SC-2: needs 連鎖と version 取得の独立化 — OK

- `python3 yaml.safe_load` による機械抽出: `version-bump`(needs=None, outputs=[version]) → `release-marketplace`(needs=version-bump) → `apm-release`(needs=release-marketplace)。YAML 構文妥当（safe_load 成功）。
- `version-bump.outputs` に `version` のみ・`tag` 非公開（02 §5.1 準拠）を確認。
- evidence_source: observed_runtime / existing_code。

#### (C) T4 移植同一性（ADR-3）— OK（バイト一致）

- `git show HEAD:.github/workflows/release.yml` の release-npm 配下「Decide datetime tag」step（HEAD 141-165）・「Create GitHub Release」step（HEAD 168-179）を切り出し、working-tree の version-bump 配下の同 step（WT 102-140）と `diff` した結果 **IDENTICAL（差分 0）**。`run:` 内容・`id: datetag`・`env: GH_TOKEN`・冪等分岐（`gh release view`）・3 段リトライループがロジック行として完全一致。
- implement-feature の「HEAD とバイト一致」主張を、レビュワーが HEAD 側と working-tree 側を独立に切り出して diff することで裏付けた。
- evidence_source: existing_code / observed_runtime。

#### (D) apm/marketplace 固有ロジック無改変（01 UC2 シナリオ 2）— OK

- `release-marketplace`（HEAD 215-317 vs WT 145-247）の非コメント差分は **`needs: release-npm`→`needs: version-bump` と `version="…needs.release-npm.outputs.version…"`→`…needs.version-bump…` の 2 行のみ**。他の差分はすべて `#` コメント行（§2.6 文体是正）。
- `apm-release`（HEAD 318-422 vs WT 248-351）の非コメント差分は **0 件**（ロジック完全無改変。差分はゲート説明コメントの是正のみ）。
- `build-adapters.sh` 呼び出し・決定性検証・release/marketplace・release/apm ブランチ運用・`apm-vX.Y.Z` タグは無改変。
- evidence_source: existing_code（ジョブブロック前後 diff、レビュワー再実行）。

#### (E) 拡張子境界修正の妥当性（ADR-6 実装差異）— OK・妥当

- 02 ADR-6 指定パターン `[^[:space:]]+\.(md|adoc)` は `.cursor/rules/*.mdc` の `foo.mdc` を `foo.md` として誤検出する欠陥がある。実装は語末境界 `([^[:alnum:]]|$)` を付し `[^[:space:]]+\.(md|adoc)([^[:alnum:]]|$)` へ精緻化した。
- **レビュワー自作テストケース 8 件**を実行して独立検証（期待どおり全一致）:
  - 誤検出しない: `.mdc`(exit 0)・`.adocx`(exit 0)・`.mdx`(exit 0)
  - 検出する: CJK 名 `02_設計.md`(exit 1)・ASCII 名 `RELEASE.md`(exit 1)・空白なし CJK 後続 `RELEASE.mdを参照`(exit 1)・行末 `docs/02_設計.md`(exit 1)・`.adoc`(exit 1)
- CJK 名検出（ADR-6 の本来目的＝self-enforce.yml の全角名違反検出）は境界付与後も維持。誤検出 0 件。**設計との差異は正当かつ設計意図（`.md`/`.adoc` を検出し `.mdc` は検出しない）をより正確に実装したもの**と判定。02_設計.md（ADR-6・§5.2）を本レビューで実パターンへ同期更新済み。
- evidence_source: observed_runtime（レビュワー自作 8 ケース、2026-07-12）。

#### (F) SC-7 前段（違反混入検知・T6）— OK

- **作業ツリー起点**（`git archive HEAD` を使わない。03 §2.6.3 の落とし穴回避）で `.github/workflows/*.yml` を tmp へ複製 → 混入前は exit 0 → `# 詳細は docs/maintainer/RELEASE.md を参照` を release.yml 末尾へ注入 → 再実行で **exit 1・`release.yml:352` を出力**。SC-7 前段成立。
- self-enforce.yml の blocking step「Comment external-ref check (blocking)」(196 行) に `continue-on-error` が無いこと、非ブロッキング audit step（184 行）のみが `continue-on-error: true` であることを確認。
- evidence_source: observed_runtime。

#### (G) audit.sh check #26 委譲（T2）— OK

- `check_code_comment_external_ref()` は (i) `check-comment-refs.sh` の存在確認（不在時 WARN＋`return 0`＝SKIP。静かな握りつぶし無し）、(ii) `CODE_COMMENT_SRC_DIRS`（既定 src/app/components）の解釈・実在 dir のみ委譲、(iii) exit 1 時に従来形式 `FAIL: コメント外部参照禁止違反 (CODE_COMMENT_RULES):`＋違反行＋`ROLLBACK_MSG`＋`EXIT_CODE=1` を出力、の 3 責務のみに縮約されパターン照合ロジックの二重定義が排除されている。
- `test-audit.sh` 42 PASS（回帰維持）。
- evidence_source: existing_code / test_output。

### 2.3 指摘事項

- **指摘 1（軽微・対応済み）**: 02_設計.md の ADR-6・§5.2 が docname パターンを `[^[:space:]]+\.(md|adoc)`（境界なし）と記載しており、実装の精緻化（`([^[:alnum:]]|$)` 付与）と乖離していた。living-document 原則に従い本レビューで 02 を実パターンへ同期更新した（重要度: 低。振る舞いは実装が正・より正確）。
- **その他の指摘: なし**（機械判定・ロジック diff・テストいずれも合格）。

---

## 3. テスト結果の確認（レビュワー再実行）

### 3.1 テスト実行結果

- **実行日**: 2026-07-12（レビュワー再実行）
- **`bash test/run-all.sh`**: **合計=18 PASS=18 FAIL=0 SKIP=0**（exit 0）。implement-feature の 18/18 PASS 報告を裏付け。
- **`bash test/test-check-comment-refs.sh`（単独）**: PASS=9 FAIL=0（exit 0）。`.mdc` 境界ケースを含む。
- **`bash test/test-audit.sh`（単独）**: PASS=42 FAIL=0（exit 0）。check #26 委譲回帰を含む。
- **構文**: `bash -n check-comment-refs.sh`・`bash -n audit.sh` いずれも OK。

### 3.2 03 検証コマンドの再実行結果（SC 別）

| 検証 | コマンド概要 | 結果 |
| --- | --- | --- |
| SC-1 | `grep -rn release-npm .github/` / `grep -c NPM_TOKEN release.yml` | 0 / 0 — OK |
| SC-2 | yaml.safe_load で needs・outputs 抽出 | 連鎖正・tag 非公開 — OK |
| ADR-3 | HEAD release-npm 2 step vs WT version-bump 2 step の diff | IDENTICAL — OK |
| SC-3 | `check-comment-refs.sh .github/workflows` | exit 0 — OK |
| SC-4 | `grep -nE '取りやめ\|保留中\|以前は\|dormant\|再開' README.md` / `NPM_TOKEN` | 0 / 0 — OK |
| SC-5 | `grep -nE 'release-npm\|NPM_TOKEN\|npm publish\|npm-publish\|dormant\|再開' RELEASE/apm-package/adapters` | 0 — OK |
| SC-7 | 作業ツリー起点の違反注入 → exit 1・`file:line` 出力 | OK |
| T4(c) | tmp 隔離で bump→sync→4 ファイル commit → `git status --porcelain` 空 | OK（apm.yml 取り残しなし） |
| T4(d) | tmp 隔離で日時タグ 3 段リトライ（base→-2→打ち切り） | OK |
| 参照 | 変更 3 doc の相対リンク実在（python 全数） | 全リンク実在 — OK |

---

## 4. コードレビュー観点

| 観点 | 確認内容 | 結果 |
| --- | --- | --- |
| 可読性 | release.yml ヘッダ・ジョブコメントが現在事実のみ（案名・dormant・再開を排除） | OK |
| 保守性 | 検知ロジックが `check-comment-refs.sh` 単一正本に集約され audit.sh/self-enforce.yml が呼ぶだけ | OK |
| パフォーマンス | CI 定義・ドキュメントの改訂中心で性能要件なし | OK |
| セキュリティ | `NPM_TOKEN` 参照が repo から完全消去（0 件）。version-bump は既定 GITHUB_TOKEN のみ使用 | OK |

- リント/型チェック: 対象は bash/YAML/Markdown のため該当なし（`bash -n` 構文チェックで代替・OK）。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本 issue の変更対象は `.github/workflows`（CI 定義）・`docs/maintainer/`（メンテナ向け運用ドキュメント）・`enforcement/ci` スクリプトであり、システム仕様書 `docs/`（`docs/00_review/` を伴う仕様正本群）そのものの記述内容には影響しない。CODE_COMMENT_RULES §2 の検知強化は「規約の正しい実装への是正」であって規約本文の変更を伴わない（00/01 で明示的にスコープ外）。`docs/maintainer/*.md`（RELEASE/apm-package/adapters）の更新は本 issue の成果物そのものであり、その整合は §2.2・§3.2 で検証済み。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務（version-bump は bump＋リリース可視化のみ／検知スクリプトは検出のみ）・明確な境界（apm/marketplace 固有ロジック無改変）・UNIX 哲学（小さな道具を 2 呼び出し元が共有）・可読性（06 優先順位 1 位）を、実コードで確認。ADR-1〜7 が実装へ正しく反映（ADR-1 削除／ADR-2 version-bump 新設＋4 ファイル apm.yml 是正／ADR-3 2 step バイト一致移植／ADR-4 正本行削除・境界事例拡張子なし／ADR-5 単一正本＋委譲＋blocking step／ADR-6 CJK 対応＋境界／ADR-7 RELEASE.md 全面改訂）。
- **ディレクトリ構成**: 新設スクリプトは `enforcement/ci/`（既存監査群と同居・カバレッジ分母外）、テストは `test/` に配置。spec/02 準拠。
- **命名規則**: `check-comment-refs.sh`・`test-check-comment-refs.sh` は既存慣行（`verify-npm-pack.sh`／`sync-version.sh` 等）と同型。

### 9.2 境界・依存の確認

- **責務の境界**: version-bump（bump・可視化）／release-marketplace・apm-release（公開）／check-comment-refs.sh（検出）が分離。ロジック行の越境なし。
- **依存関係**: version-bump→marketplace→apm の一方向直列。audit.sh→check-comment-refs.sh、self-enforce.yml→check-comment-refs.sh の一方向委譲。循環なし。
- **指摘・推奨**: なし（境界侵犯・意図しない依存は検出されず）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| ADR-3 移植のロジック同一性 | existing_code / observed_runtime | HEAD 141-179 と WT 102-140 の diff=IDENTICAL |
| apm/marketplace 固有ロジック無改変 | existing_code | ジョブブロック前後 diff（非コメント差分は needs/version の 2 行のみ・apm-release は 0 件） |
| 拡張子境界修正の妥当性 | observed_runtime | レビュワー自作 8 ケースで誤検出 0・CJK 検出維持 |
| 全テスト非破壊 | test_output | run-all 18/18・test-audit 42・test-check-comment-refs 9 すべて PASS |
| SC-7 前段成立 | observed_runtime | 作業ツリー起点注入で exit 1・file:line 出力 |

---

## 監査観点: 敵対的観点リスト（adversarial lens）

レビューで能動的に反証を試み、いずれも問題なしと確認した観点:

1. **release-npm の隠れ残存**: ジョブ名以外（`needs`・`outputs`・コメント・secret 参照）に `release-npm`/`NPM_TOKEN` が残っていないか → `.github/` 全体 grep で 0 件。
2. **移植 step のロジック改変**: 「無改変移植」と称して実は変わっていないか → HEAD と WT の 2 step を独立に切り出し diff=IDENTICAL で反証。
3. **apm/marketplace ロジックへの巻き込み改変**: コメント是正に紛れてロジック行が変わっていないか → 非コメント差分が needs/version の 2 行のみ・apm-release は 0 件で反証。
4. **検知パターンのすり抜け／過検出**: 境界追加で CJK 名を取りこぼしていないか・`.mdc` を誤検出しないか → 自作 8 ケースで両方向を反証。
5. **blocking の骨抜き**: 新 step に `continue-on-error` が付いて実効しないのではないか → step 定義に無いことを確認、非ブロッキング audit step のみが持つことを確認。
6. **テスト自体の検出力欠如**: テストが常に PASS する飾りでないか → 違反注入で exit 1 を確認、test-audit の委譲回帰が src 配下違反を FAIL 検出。
7. **前 issue 変更との混線**: README の混在差分が本 issue の成果を隠していないか → 経緯除去分（SC-4）を最終状態 grep で独立確認、リリース手順節の書き換えを目視確認。

## 監査観点: must-preserve（不変条件）リスト

本変更が壊してはならない不変条件と、その保全確認:

1. **`release-marketplace`/`apm-release` の apm/marketplace 固有ロジック（build-adapters.sh・決定性検証・ブランチ/タグ運用）は無改変** → ジョブブロック diff で保全確認。
2. **`sync-version.sh --check`（package.json⇔plugin.json⇔apm.yml 三者一致）が bump 後も通過** → T4(c) 隔離模擬で exit 0 確認。
3. **`RELEASE_ENABLED` ゲート・`workflow_dispatch` のみのトリガ・`concurrency: release`** → 3 ジョブとも維持（if ゲート文字列一致）。
4. **日時タグ・GitHub Release の可視化機能** → version-bump へバイト一致移植で保全。
5. **既存テスト一式の非破壊** → run-all 18/18・既存 test-audit 回帰維持。
6. **カバレッジ分母不変**（`enforcement/ci/` は `INCLUDE_PATHS` 外） → 新設スクリプトは分母外・台帳追記不要。
7. **CODE_COMMENT_RULES.md 本文不変**（検知の追加のみ） → 規約本文への変更なし。

---

## 5. 受け入れ基準・BDD カバレッジ（generate-scenarios / map-coverage）

| 01 の BDD | 検証方法 | 結果 |
| --- | --- | --- |
| UC1 シナリオ1（release-npm 不在・NPM_TOKEN 参照なし） | SC-1 grep | OK |
| UC1 シナリオ2（release-marketplace の独立 version 取得） | needs/outputs 機械抽出 | OK |
| UC1 シナリオ3（日時タグ・Release の version-bump 移植）※03 T4 で追加 | 2 step diff=IDENTICAL・generate-notes 1 件 | OK |
| UC1 シナリオ4（同一秒衝突リトライ）※03 T4 で追加 | T4(d) 隔離模擬（base→-2→打ち切り） | OK |
| UC2 シナリオ1（self-enforce.yml のドキュメント名直書きなし） | `check-comment-refs.sh self-enforce.yml` exit 0 | OK |
| UC2 シナリオ2（ロジック行に差分なし） | ジョブブロック前後 diff | OK |
| UC3 シナリオ1（README が現在事実のみ） | SC-4 grep | OK |
| UC3 シナリオ2（RELEASE.md の整合） | SC-5 grep・構成確認 | OK |
| UC4 シナリオ1（違反混入で CI 失敗） | SC-7 前段（作業ツリー起点注入） | OK |
| UC4 シナリオ2（非混入で成功・許可パターン非誤検出） | 実 workflows exit 0・test の非検出系 | OK |

- **テストコード化の網羅**: 01 の全 BDD シナリオがテスト（test-check-comment-refs.sh／test-audit.sh）または機械検証コマンド（SC-1〜SC-7・T4 隔離模擬）へ対応。自動テスト不能な観点（実 CI 発火 E2E＝`RELEASE_ENABLED` 未設定・GitHub API 依存の `gh release create`）はローカル隔離模擬・ロジック同一性 diff で代替し、その理由を 02 §6.1・03 に明記済み。未対応シナリオなし。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計 ADR-1〜7 に忠実。境界侵犯なし。実装時の欠陥発見＝ADR-2 apm.yml 未 commit・ADR-6 `.mdc` 誤検出を構造的に是正）。
- **テスト品質**: 良好（run-all 18/18・新テスト 9・既存回帰 42、すべて tmp 隔離・破壊なし）。
- **ドキュメント品質**: 良好（経緯記述除去が SC-4/SC-5 で機械判定成立。相対リンク全数実在）。
- **総合評価**: **合格**。機械判定・ロジック diff・テストのすべてで受け入れ基準を満たし、レビュワー独立再実行で裏付けた。実装との差異（ADR-6 境界付与）は妥当と判定し、02 を同期更新済み。ブロッキング指摘なし。

### 12.2 承認状況

- **承認者**: verify-and-close サブエージェント（auditor 区分）
- **承認日**: 2026-07-12
- **承認コメント**: SC-6（verify-and-close 完了）を残すのみ。本レビュー完了＋書記記録で充足する。commit/push はユーザー明示指示に従う（自律 commit しない）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../../.agent-skill-chain/source/REVIEW_RULE.md) / [`.agent-skill-chain/source/CODE_COMMENT_RULES.md`](../../../../../.agent-skill-chain/source/CODE_COMMENT_RULES.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

## 15. 次のステップ

- 外部設定は不要（05 は不発動）。verify-and-close 完了後、issue クローズ判断はオーケストレータに委ねる。commit はユーザー明示時のみ。
