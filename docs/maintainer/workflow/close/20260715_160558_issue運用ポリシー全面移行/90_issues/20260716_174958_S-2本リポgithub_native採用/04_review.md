---
document_id: "9e88d0f0-7322-41e9-98cc-09b4a900a603"
issue_id: "562dd7c7-5aa3-425c-8553-61e8fb191569"
---

# レビュー書: S-2 本リポ github_native 採用（スイッチ投入・非追跡化・両モード手順化・決定ログ／Issue Forms 新設）

**プロジェクト名**: S-2 本リポ github_native 採用（親: issue 運用ポリシーの GitHub Issue 中心への全面移行）
**作成日**: 2026 年 07 月 17 日（原本）／2026 年 07 月 17 日（復元）
**最終更新**: 2026 年 07 月 17 日

> **【復元に関する重要な注記（透明性のため明記）】**
> 本ドキュメントは、**2026-07-17 に作成された原本が誤って git worktree 削除により失われたため**、元担当エージェント（verify-and-close 独立レビュアー）の**完了報告**および git 追跡・恒久記録である **`docs/maintainer/decisions/DECISIONS.md`（ADR-S2-1〜S2-7・S2-toggle・S2-V）** を一次資料として、**2026-07-17 に復元したもの**である。
> 原本は S-2 自身が導入した `.gitignore` パターン（`docs/maintainer/workflow/**/04_review.md`）により**非追跡ドラフト**のまま残されており、担当者の作業 worktree を進行役が `git worktree remove` した際に git object にも残らず永久に失われた（原本は当該 worktree で commit されていなかった）。これは進行役の過失である。
> 本復元は**存在しない検証結果を新たに作り出すもの（捏造）ではなく、既に実施・報告された独立検証の記録を、一次資料から可能な限り忠実に再構成したもの**である。数値・観測結果は原本報告時点のレビュアー実測値をそのまま転記しており、本復元時に再実測した値ではない旨を各所に明記する。原本にあった詳細な個別項目のうち一次資料から再現できないものは、その旨を正直に記載する。
> 本 04 は verify-and-close（レビューフェーズ）の成果物であり、独立レビュアー（実装作成者とは別サブエージェント・opus）が verify-and-close.md / REVIEW_DUAL_LENS.md（二観点・両リスト必須）/ PHASES.md §監査観点 に従い作成した（原本）。
> S-2 の設計（ADR-S2-4）により本ファイルは**恒久記録先ではない非追跡ドラフト**であり、恒久判断は `DECISIONS.md`（ADR-S2-V）へ既に転記済みである（そのため原本喪失後も判断の実体は保全されていた）。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / クローズ前最終チェック。S-2 の 00〜03（要求 SC1〜SC8・要件 AC1〜AC8・BDD シナリオ 1〜8・設計 ADR-S2-1〜S2-7・実装計画 T-a〜T-f）と実装差分を独立に突合し、**非追跡化・#28 SKIP ガード・両モード手順・決定ログ・Issue Forms・スイッチ投入（env `ISSUE_TRACKING_MODE=github_native`）** が、配置境界（抽象＝source／具体＝project）・回帰安全（既定 local_tracked 不変）・消費者非波及（AC8）を損なわずに成立しているかを批判的に検証する。実装者の自己申告に依存せず、全検証コマンドをレビュアーが再実行し、正本 `audit.sh` を main 版・本ブランチ版の双方で実走して FAIL 集合を実測した。

### 1.2 レビュー対象（必須）

- **実装範囲（S-2 実装コミット群・PR #126・ブランチ `feature/20260717_065958/s2-github-native-design`）**:
  - **T-a**（`18d3d74`）: `audit.sh` #28（`check_issue_doc_in_gitignored_path`）冒頭へ github_native SKIP ガードを 1 箇所追加（S-1 #33 と同型・`resolve_issue_tracking_mode` を再利用）
  - **T-b**（`7247214`）: ルート `.gitignore` に新規ローカル issue ドラフト（`docs/maintainer/workflow/**` 配下の 00〜04）5 明示パターンを追記
  - **T-c**（`91d324f`）: `docs/maintainer/decisions/DECISIONS.md` 新設（恒久 ADR 記録先・記録手順＋ADR 最小集合 5 要素）
  - **T-d**（`6c1a966`）: `.github/ISSUE_TEMPLATE/issue-request.yml` 新設（S-3 汎用雛形 `enforcement/github/issue-request.example.yml` からのコピー）
  - **T-e**（`4345e36`）: `.agent-skill-chain/project/自己拡張ワークフロー.md` に `github_native`／`local_tracked` 両モード具体手順＋スイッチ投入先／非追跡化／DECISIONS 記録手順を集約
  - **T-f**（`e3eb0f3`）: `.github/workflows/self-enforce.yml` audit step へ `env: ISSUE_TRACKING_MODE: github_native` を投入（**最後に投入**・`continue-on-error: true` は不変）
  - **verify-and-close 転記**（`f7e4887`）: `DECISIONS.md` へ ADR-S2-1〜S2-7／S2-toggle／S2-V を恒久転記、`docs/00_review/20260717_091611_review.md` に docs 継続追随ゲート軽量パスを記録
- **レビュー期間**: 2026-07-17 ～ 2026-07-17
- **レビュー担当者**: 独立レビュアー（verify-and-close 実行サブエージェント・opus。実装作成者とは別人格）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク | 実装内容 | AC 対応 | ステータス |
| ------ | -------- | ------- | ---------- |
| T-a（`18d3d74`） | `audit.sh` #28 冒頭に `if [[ "$(resolve_issue_tracking_mode)" == "github_native" ]]; then echo "SKIP: #28…" >&2; return 0; fi` を追加。既存検知ロジック（`find`・`git check-ignore -q` exit0 のみ FAIL・`templates/` 除外）は不変 | AC7(a) | 完了 |
| T-b（`7247214`） | ルート `.gitignore` に `docs/maintainer/workflow/**/{00_要求定義,01_要件定義,02_設計,03_実装計画,04_review}.md` の 5 明示パターン＋意図コメントを追記 | AC1 | 完了 |
| T-c（`91d324f`） | `docs/maintainer/decisions/DECISIONS.md` を新設し git 追跡。記録手順＋ADR 最小集合 5 要素（コンテキスト／検討した選択肢／決定／根拠[evidence_source]／帰結） | AC3 | 完了 |
| T-d（`6c1a966`） | `.github/ISSUE_TEMPLATE/issue-request.yml` を S-3 雛形からコピーし新設。目的／成功基準／受け入れ基準＝required、全体像・フロー／参照＝optional | AC4 | 完了 |
| T-e（`4345e36`） | `自己拡張ワークフロー.md` に両モード起票〜完了手順（github_native＝本文完全転記＋Issue close で完結／local_tracked＝close 移動 PR）＋スイッチ投入先＋非追跡化／DECISIONS 記録手順を集約 | AC2 | 完了 |
| T-f（`e3eb0f3`） | `self-enforce.yml` audit step に `env: ISSUE_TRACKING_MODE: github_native` を投入（最後・非ブロッキング維持） | AC5・AC6・AC8 | 完了 |
| 転記（`f7e4887`） | `DECISIONS.md` へ ADR-S2-1〜S2-7／toggle／V を恒久転記、docs 継続追随ゲート軽量パスを `docs/00_review/` に記録 | AC6・AC7 の記録要件 | 完了 |

### 2.2 実装内容の詳細

#### T-a（#28 github_native SKIP ガード・回帰安全の要）

#28 冒頭に S-1 #33（`audit.sh:1085` 付近）と同型の SKIP ガードを 1 箇所追加。SKIP メッセージは #33 の様式に倣い、実効モード条件（`ISSUE_TRACKING_MODE=github_native` かつ github.com remote）を明記（`audit.sh:864-865`）。`resolve_issue_tracking_mode`・#33 本体・#28 の既存検知ロジックは無改変（C2 例外の範囲・最小差分）。github_native では SKIP（`return 0`）、`local_tracked`・非 GitHub では従来どおり非追跡パス配置の誤配置検知が有効（回帰安全）。

#### T-b（`.gitignore` 非追跡化・過剰 ignore 回避）

5 明示ファイル名パターンに限定（ADR-S2-4）。追跡済みファイルは git 機構により温存され、新規未追跡ドラフトのみが非追跡になる（`git check-ignore -q` は index を参照し tracked→exit1／untracked→exit0・ADR-S2-1 実測）。`90_issues.md`・別パスの `DECISIONS.md`・`.github/`・`docs/README.md` は非対象。

#### T-c（DECISIONS.md・恒久記録先）

github_native では close 移動を行わずローカルドラフトが非追跡・破棄されうるため（A6・A12）、設計判断の永続記録先として新設（ADR-S2-5・2026-07-15 の worktree 削除で 02/03 喪失事故の再発防止）。**本 S-2 の恒久判断（ADR-S2-1〜S2-7）＋スイッチ正当性（S2-toggle）＋独立検証結果（S2-V）を verify-and-close で本ファイルへ転記済み**であり、これが本非追跡 04 原本の喪失に対する保全機構として機能した（＝本復元が DECISIONS.md を一次資料にできる根拠）。

#### T-d（Issue Forms 実ファイル）

S-3 汎用雛形をコピーし本リポ手動起票を構造強制。目的・成功基準・受け入れ基準を `validations.required: true`、全体像・フロー／参照を `required: false`。AI 起票（`gh issue create --body`）・audit・hook からは読まれず既存フロー非干渉（A7）。

#### T-e（自己拡張ワークフロー.md・両モード具体手順）

`github_native`／`local_tracked` の両モード分岐を具体化。スイッチ投入先（CI＝`self-enforce.yml` audit step の env／ローカル＝pre-push フック内 export・hook 採用と env 設定を一組＝ADR-S2-1 の残余ロックアウト回避）を明記。source 抽象原則は二重記載せず参照のみ（C2）。

#### T-f（スイッチ投入・最後）

`self-enforce.yml` audit step へ `env: ISSUE_TRACKING_MODE: github_native` を付与し本リポ実効モードを github_native に切替（ADR-S2-3）。`continue-on-error: true`（非ブロッキング）は不変。配布物 source（`pre-push.example`・`audit.yml` テンプレート・audit.sh 既定値）は無改変（非波及・AC8）。

---

## 3. テスト結果の確認（原本報告時のレビュアー実測を復元）

本 issue の成果物は**設定・監査挙動の検証**が中心であり、単体＝静的検査（grep／YAML パース／`git check-ignore`／`git ls-files`）、結合・受け入れ＝tmp 隔離（`mktemp -d`＋`git archive`）での audit.sh 実挙動（非追跡ドラフト実作成を含む・ADR-S2-7）で担保する。原本のレビュアーは**重点確認 1〜6 をすべて自らコマンド再実行し実装者出力に非依存で確認**したと報告した。以下はその報告内容の復元である（数値・観測は原本報告時点の実測値。本復元での再実測値ではない）。

### 3.1 重点確認 1: audit.sh 実行・FAIL 非増加（回帰安全・最重要）

- **手法**: 同一 worktree・同一 `workflow.db` に対し、**main 版 audit.sh** と**本ブランチ版 audit.sh** を、**同一ディレクトリ・同一 env（`local_tracked`）** で突き合わせた。
- **結果**: **FAIL 集合が完全一致（差分 0）**。#28 ガードは `local_tracked` では no-op であり既定挙動を破壊しない（回帰なし）。実装者の「実装前後で一致」主張を独立再現で確認。
- **補足（見かけの差の説明）**: 「6→6 vs 7→7」の見かけの差は、S-2 自身の過渡状態（本 04_review が未作成であることに起因する一過性 FAIL）の有無によるものであり、**本 04 の作成で解消**する。実質は回帰なし。
  - `[evidence_source: observed_runtime]`

### 3.2 重点確認 2: self-enforce.yml（スイッチ投入面）

- YAML パース可。`env: ISSUE_TRACKING_MODE: github_native` は **audit step 配下に正しく配置**（`self-enforce.yml:195`）。`continue-on-error: true`（非ブロッキング）を保持。CI 破壊懸念なし。
  - `[evidence_source: observed_runtime]`

### 3.3 重点確認 3: .gitignore over-ignore なし

- `git status` クリーン。`DECISIONS.md`・Issue Forms・`90_issues.md`（親・close 配下）・`docs/README.md` はいずれも**非 ignore**（`git check-ignore` exit 1）。追跡済み S-2 00〜03 は git 機構により温存。意図しない巻き込みゼロ。
  - `[evidence_source: observed_runtime]`

### 3.4 重点確認 4: AC1〜AC8 個別確認（map-coverage）— 全 8 充足

| AC | 確認内容 | 実測結果（原本報告） |
| -- | -------- | -------------------- |
| AC1 | 新規ドラフト非追跡・既存追跡温存・過剰 ignore なし | PASS（未追跡 probe は ignore、追跡 00〜03 は温存） |
| AC2 | `自己拡張ワークフロー.md` に両モード分岐・本文完全転記・close 分岐 | PASS（grep 両ヒット・分岐記載確認） |
| AC3 | `DECISIONS.md` 追跡・ADR 最小集合 5 要素・非 ignore | PASS |
| AC4 | Forms YAML パース可・required 設計妥当（目的/成功基準/受け入れ基準=true、全体像・フロー/参照=false） | PASS |
| AC5 | tmp 隔離で `resolve_issue_tracking_mode`＝`github_native`・#33 SKIP・FAIL 0 | PASS |
| AC6 | 実効 github_native で audit 総合の #33 起因 FAIL 0 件・記録 | PASS（DECISIONS.md／本 04 に記録） |
| AC7 | **tmp 隔離＋未追跡 probe ドラフト実作成で両方向実測** — github_native で #28 SKIP（probe 由来 FAIL 0）／local_tracked で #28 が probe を確実に FAIL 検知（回帰検知健在）。#36 は追跡ファイルのみ起点＝検知漏れ（設計上の帰結）を記録 | PASS（偽陽性解消＋回帰検知の両立を確認） |
| AC8 | env unset→`local_tracked`／非 github remote→`local_tracked`／source 配布物差分は #28 ガードのみ | PASS（消費者非波及・実測） |

- 特に **AC7 は tmp 隔離（`git archive`＋`git init`＋github.com remote）に `.gitignore` 適用後、未追跡 probe ドラフトを実作成（`git status --porcelain` 空・`git check-ignore` exit 0）して両方向を実測**した（ADR-S2-7 の手法を独立実施）。`git archive` は追跡ファイルのみをアーカイブするため、probe を実作成しなければ #28 は偽 PASS になる点を回避している。
  - `[evidence_source: observed_runtime]`

### 3.5 重点確認 5: ADR-S2-1〜S2-7 反映確認（review-architecture）— 全 ADR 一致

- 全 ADR の決定が実装に一致（個別確認）。**source 差分は #28 ガード 1 箇所のみ**（`resolve_issue_tracking_mode`・#33 本体・既定 `local_tracked` は不変）。ADR-S2-1（原子的投入）・S2-2（#28 SKIP ガード）・S2-3（env 実装先＝CI step＋ローカル export）・S2-4（`.gitignore` 5 明示パターン）・S2-5（DECISIONS.md 構造）・S2-6（Forms コピー）・S2-7（tmp 隔離＋実ドラフト検証）がいずれも実装差分と整合。
  - `[evidence_source: existing_code + observed_runtime]`

### 3.6 重点確認 6: 実効スイッチ ON 判断＝妥当（低リスク）

- ADR-S2-1 が**3 追跡成果物（`.gitignore` パターン・`audit.sh#28` ガード・`self-enforce.yml` env）の同一 PR 原子的投入**を決定しており、本 PR でスイッチを ON にするのは**設計の明示的要請**である（分離する方が ADR 違反）。
- 非ブロッキング CI（`continue-on-error: true`）・本リポ限定・消費者非波及（AC8 実測）により**ロックアウト不能**。
- ガバナンス（C4／AGENT_CONDUCT）上は、親 GitHub Issue **#115**（オーナー起票・承認）の正当なトグル運用に該当する。evidence は `human_decision`（#115 承認）＋`observed_runtime`（実測）であり `inference_only` ではないため、ブロッキングな「要人間確認」には非該当（EVIDENCE_POLICY 節4 の二段階判定）。
- ただし**本番 main への反映はマージ（人間の行為）で成立する**ため、**マージ時にオーナーのトグル採用意図を明示確認するガバナンスチェックポイント**を申し送りとする（DECISIONS.md ADR-S2-toggle・本 04 §13 に記録）。
  - `[evidence_source: human_decision + observed_runtime]`

### 3.7 最終 audit 状態（原本報告）

- **github_native（本リポ実効モード）**: **6 FAILs**。**すべて pre-existing かつ S-2 と無関係**（別 issue／本ブランチ未変更の既存事項）。**S-2 issue 自体はクリーン**（S-2 固有の FAIL・ERROR は 0 件）。
  - `[evidence_source: observed_runtime]`（原本報告時点の実測値。本復元での再実測値ではない）

---

## 4. コードレビュー（シェル／ドキュメント／YAML）

### 4.1 品質

- **回帰安全（最重要）**: OK。main 版と本ブランチ版 audit.sh の FAIL 集合が `local_tracked` で完全一致（差分 0）。#28 ガードは `local_tracked` で no-op（§3.1）。
- **配置境界（C2・ADR-S2-3）**: OK。source（配布物契約）不変・具体手順は project（`自己拡張ワークフロー.md`）へ集約・source 差分は #28 ガード 1 箇所のみ（§3.5）。
- **env 契約一致（C1・R4）**: OK。`ISSUE_TRACKING_MODE`／`local_tracked`／`github_native` が S-1 実装 `resolve_issue_tracking_mode` と厳密一致。
- **非波及（AC8・C5）**: OK。env unset／非 github remote で `local_tracked` にフォールバック。source 配布物に既定値を github_native へ変える差分なし（§3.4 AC8）。
- **YAML 妥当性**: OK。Forms は `name`/`description`/`body` を備え required 設計が妥当。self-enforce.yml は audit step 配下に env を正しく配置。
- **フォーマット**: OK。日本語・現在形の事実記述。トークン実値の残留なし（C8）。

### 4.2 指摘事項

- **原本報告では、S-2 成果物（配布物 source／本リポ固有ファイル）に対する未是正の指摘は報告されていない**（S-2 issue は audit 上クリーン・§3.7）。原本 04 に個別の指摘節（指摘 1・指摘 2 …）が存在したか否かは一次資料からは確定できない。**一次資料（完了報告・DECISIONS.md）に基づく範囲では、成果物側の是正必須指摘は 0 件**であった。
- **【復元時の正直な限界】**: 原本に S-3 の 04 のような「レビュー中に検出し本レビュアーが是正した process 指摘（例: 書記欠落・見出し欠落）」が含まれていた可能性はあるが、その詳細な個別項目は原本喪失により再現できない。捏造を避けるため、ここでは**確認できた事実のみ**を記す。後述 §write-workflow-log に、報告と実態の齟齬（書記の canonical DB 未記録）を正直に記載する。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 確定済み（SC1〜SC8・全体像マインドマップ・branch を実装ブランチへ更新 `90bad43`） | 独立レビュアー | 2026-07-17 |
| [`01_要件定義.md`](./01_要件定義.md) | 確定済み（AC1〜AC8・US1〜8・BDD シナリオ 1〜8） | 独立レビュアー | 2026-07-17 |
| [`02_設計.md`](./02_設計.md) | 確定済み（ADR-S2-1〜S2-7・§6 テスト戦略） | 独立レビュアー | 2026-07-17 |
| [`03_実装計画.md`](./03_実装計画.md) | 確定済み（T-a〜T-f・各タスク BDD） | 独立レビュアー | 2026-07-17 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合。T-a〜T-f が 02 の ADR-S2-1〜S2-7・03 のタスク分解と 1:1 対応し、実 diff がそれを満たす（source 差分は #28 ガード 1 箇所のみ）。
- **要件と実装の整合性**: 整合。AC1〜AC8（＝SC1〜SC8）が実装で充足（§3.4）。
- **恒久記録との整合**: `DECISIONS.md` の ADR-S2-1〜S2-7／toggle／V が 02_設計・本検証結果と整合（§3.5）。**本非追跡 04 が失われても恒久判断は DECISIONS.md に保全されている**ことが、本復元で改めて確認された。

---

## docs 更新

（DOCS_RULES §継続追随ゲート判定・軽量パス）

- 要否: **不要**
- 対象: なし（対応するレビュー記録: [`docs/00_review/20260717_091611_review.md`](../../../../../../00_review/20260717_091611_review.md)・git 追跡・commit `f7e4887`）
- 理由: 本 issue の変更は本リポ固有の設定・運用ファイル（`.gitignore`・project 手順・`DECISIONS.md`・Forms・self-enforce.yml env）＋ audit.sh #28 の 1 ガードであり、`docs/` システム仕様書（as-built）が説明する対象の構造・失敗条件 enumeration を変えない（#28 の検知セマンティクスは github_native で SKIP されるだけで local_tracked の既定挙動は不変）。よって指摘 0 の軽量パスで「更新不要」を確定（grep 実測根拠・`[evidence_source: observed_runtime]`）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。単一責務（各成果物 1 責務）・明確な境界（抽象 source／具体 project／強制 audit／設定 env の 4 境界）・CQRS（解決・判定は副作用なし Query／状態変更は人間主導 Command）を実装が満たす。
- **ディレクトリ構成**: OK。`docs/maintainer/decisions/` は既存 `docs/maintainer/workflow/` と同格の追跡パス。`.github/ISSUE_TEMPLATE/` は GitHub 標準配置。
- **命名規則**: OK。`.gitignore` 5 明示パターン・`issue-request.yml`（S-3 雛形 `.example.yml` の実効名）が前例と一貫。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。#28 ガード＝非追跡ドラフト衝突解消のみ／project＝本リポ具体手順のみ／DECISIONS.md＝恒久 ADR のみ／Forms＝手動起票構造強制のみ。
- **依存関係**: 循環なし。#28→`resolve_issue_tracking_mode`（一方向再利用）。監査は解決層へ依存を戻さない。
- **指摘・推奨**: なし（実装は最小・非破壊・source 差分 1 箇所）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 回帰安全（main 版と本ブランチ版 audit.sh の FAIL 集合が local_tracked で完全一致） | observed_runtime | 原本レビュアーによる 2 版 audit.sh 実走・差分 0 |
| AC1〜AC8 充足 | observed_runtime | grep／YAML／`git check-ignore`／tmp 隔離＋probe 実作成の再実測（原本報告） |
| ADR-S2-1〜S2-7 が実装に反映・source 差分は #28 ガードのみ | existing_code + observed_runtime | 実装 diff と ADR の個別突合 |
| スイッチ ON の正当性（正当なトグル運用・非ロックアウト） | human_decision + observed_runtime | 親 #115 オーナー承認＋非ブロッキング CI・非波及の実測（inference_only ではない） |
| 本番 main 反映時のオーナー意図明示確認が必要 | human_decision | マージは人間の行為・ガバナンスチェックポイントとして申し送り（§13） |
| 本復元の忠実度（原本の substantive 検証内容は一次資料から再現・process 指摘の個別詳細は再現不能） | existing_code | 一次資料＝完了報告全文＋DECISIONS.md ADR-S2-V |

---

## レビュー二観点（REVIEW_DUAL_LENS §2/§3・両リスト必須／原本報告から復元）

> 原本は二観点（敵対的観点・must-preserve）両リストを収録したと報告された。以下は完了報告および DECISIONS.md から復元できた範囲であり、原本にあった各項目の全文言までは再現できない項目がある旨を正直に付す。

### A. 敵対的観点リスト（反証・破壊を試み、不確実は要修正に倒す）

1. **#28 ガード追加が既定（local_tracked）の検知を壊していないか** → main 版と本ブランチ版 audit.sh の FAIL 集合が local_tracked で完全一致（差分 0）。#28 ガードは local_tracked で no-op。結論: 回帰なし（実測）。
2. **`.gitignore` が既存追跡ファイル・別パスを巻き込んでいないか（過剰 ignore）** → `git status` クリーン。DECISIONS.md・Forms・90_issues.md・docs/README.md はいずれも非 ignore。追跡済み 00〜03 は温存。結論: 巻き込みゼロ（実測）。
3. **非追跡ドラフト存在下で #28 が偽 PASS していないか（検証手法の妥当性）** → `git archive` は追跡ファイルのみをアーカイブするため、tmp 隔離環境に未追跡 probe ドラフトを実作成（`git status` 空・`git check-ignore` exit 0）してから audit を実行。github_native で SKIP（FAIL 0）、local_tracked で probe を確実に FAIL 検知。結論: 偽 PASS を回避し両方向を実測。
4. **env 名・既定値が S-1 実装とズレていないか** → `ISSUE_TRACKING_MODE`/`local_tracked`/`github_native` が `resolve_issue_tracking_mode` と厳密一致。結論: 問題なし。
5. **スイッチが消費者環境へ波及していないか** → env unset／非 github remote で local_tracked にフォールバック。source 配布物に既定値変更差分なし（差分は #28 ガードのみ）。結論: 非波及（実測・AC8）。
6. **スイッチ ON の実行主体が AI 自律設定でないか（C4）** → 親 GitHub Issue #115（オーナー承認）の S-2 成果として計画・承認された正当なトグル運用。human_decision＋observed_runtime に裏付けられ inference_only ではない。結論: 正当（ただしマージ時のオーナー意図確認を申し送り）。
7. **#36（`check_pr_issue_linkage`）の検知漏れは欠陥か** → #36 は `git diff --name-only`（追跡ファイルのみ）起点のため非追跡ドラフトを検知できない。これは github_native 運用の**設計上の帰結**（Issue 紐づけは GitHub Issue／#34 ゲートで担保）であり欠陥ではない（DECISIONS.md ADR-S2-V に記録済み）。結論: 認識・記録済み（見送り）。
8. **恒久判断が非追跡 04 の喪失で失われないか** → ADR-S2-1〜S2-7／toggle／V を DECISIONS.md（追跡）へ転記済み。結論: 保全済み（本復元がその保全機構により成立した実例）。

> **【復元時の正直な限界】** 原本の敵対的観点リストは上記より多くの項目（各項の詳細な反証プロセス）を含んでいた可能性があるが、一次資料から確実に再現できるのは上記まで。再現不能な個別項目は本復元には含めていない（捏造回避）。

### B. must-preserve リスト（壊してはならない不変条件と保持確認）

1. **`resolve_issue_tracking_mode`・#33 本体・その他 audit チェック（S-1 成果）** → 無改変。#28 冒頭ガード 1 箇所の追加のみ。保持。
2. **既定 `local_tracked`・非 GitHub フォールバック（消費者互換）** → source 配布物の既定値不変。unset／非 github remote で local_tracked。保持（AC8）。
3. **source 抽象契約（S-3 成果）** → 二重記載せず参照のみ。source 差分は #28 ガードのみ。保持（C2）。
4. **既存追跡 issue・close 配下・90_issues.md・DECISIONS.md・Forms・docs/README.md の追跡継続** → `.gitignore` 5 明示パターンに非合致で温存。保持（AC1）。
5. **env 名の単一情報源（audit.sh を正）** → 契約・project 記述を audit.sh へ一致。コードは無改変。保持（C1）。
6. **audit step の非ブロッキング（`continue-on-error: true`）** → env 付与のみで不変。保持。
7. **既存 document_id 不変性（00〜03 の frontmatter）** → 実装 diff は document_id を改変しない。保持。
8. **依存順 S-1→S-3→S-2** → S-2 は最後のスイッチ投入。先行成果に依存し改変しない。保持。

> ラウンド継承（REVIEW_DUAL_LENS §6）: 原本レビューは修正後に must-preserve #1〜#8 の退行がないことを diff 再確認・audit.sh 再実走で担保したと報告。**配布物・本リポ固有成果物側は指摘 0**。

---

## 10. 観察事項（見送り・理由付き）

いずれも欠陥ではなく、修正・起票を要しないと判断した観察。

- **O1（#36 の検知漏れ）**: #36 は `git diff --name-only`（追跡ファイルのみ）起点のため非追跡ドラフトを検知対象にできない。github_native 運用の設計上の帰結であり、Issue 紐づけは GitHub Issue／#34 ゲートで担保される。→ **見送り**（DECISIONS.md ADR-S2-V に「既知の設計上の帰結（欠陥ではない）」として記録済み）。
- **O2（本番 main 反映時のガバナンスチェックポイント）**: スイッチ ON 自体は設計・親 #115 で承認済みだが、main への反映はマージ（人間の行為）で成立する。→ **見送り（申し送りへ）**。マージ時にオーナーのトグル採用意図を明示確認することを推奨（§13・DECISIONS.md ADR-S2-toggle）。inference_only ではなく human_decision＋observed_runtime に基づくため、ブロッキングな「要人間確認」ではなく非ブロッキングな申し送りとする。

---

## write-workflow-log（証跡・原本報告と実態の齟齬を正直に記載）

- **原本報告（当時）**: verify-and-close を 3 成果物（`04_review.md` / `DECISIONS.md` / `docs/00_review/20260717_091611_review.md`）それぞれ 1 回ずつ書記記録したと報告された（「1 command につき書記 1 回」の単数解釈を避け、成果物ごとに記録する規約に従う趣旨）。
- **【後日判明した実態・正直な記載】**: この 3 件の書記は、**canonical な main ツリーの `workflow.db` には記録されていなかった**ことが後日判明している。原本報告のこの部分は**誤りだった**（`workflow.db` は `.gitignore` により非追跡のワークツリー・ローカル状態であり、担当 worktree 削除に伴い当該ローカル DB も失われた可能性が高い）。
- **帰結・次工程**: 本復元では、存在しない書記記録を「記録済み」と偽ることはしない。**verify-and-close の書記（3 成果物分）を canonical `workflow.db` へ記録することは、本復元の次工程として進行役／書記が別途実施する必要がある**。参照すべき成果物の DOCUMENT_ID・DOCUMENT_PATH は本 04 §「完了報告／次工程」（末尾）にまとめる。
  - `[evidence_source: existing_code]`（`workflow.db` の記録有無は事後確認で判明）

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（最小・非破壊・配置境界順守。source 差分は #28 ガード 1 箇所のみ。3 追跡成果物の原子的投入で中間ロックアウト状態を main に残さない）。
- **テスト品質**: 良好（自動テストを伴わない性質だが、静的検査＋tmp 隔離＋未追跡 probe 実作成での audit.sh 実挙動を原本レビュアーが全数再実測。main 版・本ブランチ版の 2 版突合で回帰安全を差分 0 で実測）。
- **ドキュメント品質**: 良好（00〜03 テンプレート充足・document_id 完備・DECISIONS.md へ恒久判断を転記済み）。
- **総合評価**: **合格（S-2 成果物側は指摘 0）**。AC1〜AC8（＝SC1〜SC8）を実測で充足。回帰安全（差分 0）・非波及（AC8）・スイッチ ON の正当性を確認。S-2 固有 audit FAIL 0 件（github_native 実効モードで残る 6 FAILs はすべて pre-existing・S-2 無関係）。
  - **条件・申し送り**: (1) 本番 main 反映（マージ）時にオーナーのトグル採用意図を明示確認するガバナンスチェックポイント（§13）。(2) verify-and-close の書記 3 件を canonical `workflow.db` へ記録する次工程（§write-workflow-log）。

### 12.2 承認状況

- **レビュー承認者**: 独立レビュアー（verify-and-close・opus）
- **承認日**: 2026-07-17
- **承認コメント**: AC1〜AC8 を実測で確認（grep／YAML／`git check-ignore`／tmp 隔離＋probe 実作成／main 版・本ブランチ版 audit.sh 2 版突合）。回帰安全（差分 0）・env 契約一致・非波及・ADR 反映（source 差分 #28 ガードのみ）・スイッチ ON の正当性（親 #115 承認・非ブロッキング・非波及）を確認。S-2 固有 FAIL 0 件。トップレベル親 #115 の完了確認・close は本 command 完了後に進行役が別途判断する（S-2 は 90_issues 配下サブ issue）。

---

## 13. 課題と申し送り（独断での issue 起票はしない）

- **申し送り 1（ガバナンスチェックポイント・最重要）**: `ISSUE_TRACKING_MODE=github_native` スイッチの本番 main 反映は PR マージ（人間の行為）で成立する。**マージ時にオーナーのトグル採用意図を明示確認する**こと（DECISIONS.md ADR-S2-toggle・§3.6・§10 O2）。
- **申し送り 2（書記記録・次工程）**: verify-and-close の書記 3 件（04_review.md／DECISIONS.md／docs/00_review）が canonical `workflow.db` に未記録である。進行役／書記が本復元後に記録すること（§write-workflow-log）。参照 ID は末尾にまとめる。
- **申し送り 3（残余ロックアウト経路・運用注意）**: ローカルで env 未設定のまま非追跡ドラフトを push すると #28 が誤 FAIL しうる（唯一の残余経路・ADR-S2-1）。pre-push フック採用と env 設定を一組で行う運用手順を `自己拡張ワークフロー.md`（T-e）で担保済み。
- **申し送り 4（#36 検知漏れ・既知）**: #36 は非追跡ドラフトを検知できない（設計上の帰結）。Issue 紐づけは GitHub Issue／#34 ゲートで担保（DECISIONS.md ADR-S2-V）。

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) — 実装計画フェーズ（実装は implement-feature／commit `18d3d74`（T-a）〜`e3eb0f3`（T-f）＋`f7e4887`（DECISIONS 転記）で完了・PR #126）

## 15. 次のステップ

- 本 04_review（復元）確認後、親トップレベル issue **#115** の完了確認・close は**進行役が別途判断・確定**する（S-2 は 90_issues 配下サブ issue のため単独での close 移動は行わない。github_native 採用後は Issue close で完結）。
- **本復元の次工程**: verify-and-close の書記 3 件を canonical `workflow.db` へ記録する（§write-workflow-log・§13 申し送り 2）。

---

### 完了報告／次工程で参照すべき成果物 ID・パス

| 成果物 | DOCUMENT_ID | DOCUMENT_PATH（ルート相対） |
| ------ | ----------- | --------------------------- |
| 04_review.md（本ファイル・復元） | `9e88d0f0-7322-41e9-98cc-09b4a900a603` | `docs/maintainer/workflow/20260715_160558_issue運用ポリシー全面移行/90_issues/20260716_174958_S-2本リポgithub_native採用/04_review.md` |
| DECISIONS.md（追跡・恒久記録） | `aa9911ab-cadc-41be-8620-2053d5f20fa5` | `docs/maintainer/decisions/DECISIONS.md` |
| docs 継続追随ゲート軽量パス（追跡） | `912cb13a-423c-4d9b-a4cd-e026b0a1f7c0` | `docs/00_review/20260717_091611_review.md` |

> issue_id（全成果物共通）: `562dd7c7-5aa3-425c-8553-61e8fb191569`
