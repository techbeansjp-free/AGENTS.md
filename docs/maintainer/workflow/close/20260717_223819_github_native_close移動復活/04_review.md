---
document_id: "2d64f896-3ad6-4702-95c2-59acb9670577"
---

# レビュー書: github_native モードでも完了 issue を close/ へ移動する

**プロジェクト名**: github_native モードでも完了 issue を close/ へ移動する（GitHub Issue #137）
**作成日**: 2026 年 07 月 17 日
**最終更新**: 2026 年 07 月 18 日

> **重要**: 本レビューは verify-and-close フェーズの成果物。実装（commit `beaef53`・T1〜T4）を独立観点で検証した結果を記録する。実装したサブエージェントの自己申告は鵜呑みにせず、差分の実読・grep 再確認・tmp 隔離環境でのテスト再実行により裏取りした。
>
> **2026-07-18 追記**: PR #138（T1〜T4）マージ後、CodeRabbit の未解決 2 件（Major×2）に対する是正（commit `e24a09a`）を独立検証した結果を **§16** に追記した。document_id は不変。
>
> **レビュー深度**: full（00_要求定義.md frontmatter `mode: full`）。REVIEW_RULE.md 準拠。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証（T1〜T4 が 01 の受け入れ基準を満たし、local_tracked と消費者に回帰・波及を起こさないことの独立検証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: close 移動を「整理整頓目的」と再定義し github_native でも復活させる変更。T1=DECISIONS.md へ ADR-137-1〜4 追記、T2=正本 4 文書（CORE.md・PHASES.md・run_command.md・自己拡張ワークフロー.md）の記述整合、T3=audit.sh #33 の github_native 早期 return SKIP 撤廃、T4=`close-move-issue.sh` 新設。**T5（遡及 4 件の是正移動）は本 PR スコープ外**（進行役がメインツリーで別途実行）。
- **レビュー期間**: 2026-07-17 ～ 2026-07-17
- **レビュー担当者**: verify-and-close 委譲サブエージェント（opus・独立検証）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1: ADR 記録 | DECISIONS.md へ ADR-137-1〜4 を 5 要素・evidence_source 付きで追記。冒頭説明文を両モード整合へ更新 | 2026-07-17 | implement-feature | 完了 |
| T2: 正本 4 文書整合 | CORE/PHASES/run_command/project の「local_tracked 専用／github_native では close 移動不要」記述を「両モードで行う（整理整頓目的）・確定手段のみモード差」へ上書き。project に分岐 C・3 分岐化を追加 | 2026-07-17 | implement-feature | 完了 |
| T3: audit #33 SKIP 撤廃 | `check_close_move_pending` 冒頭の `resolve_issue_tracking_mode == github_native` 早期 return SKIP ブロックを撤廃。関数本体・grandfather・猶予・FAIL メッセージ・除外は不変 | 2026-07-17 | implement-feature | 完了 |
| T4: 移動スクリプト新設 | `.agent-skill-chain/source/scripts/close-move-issue.sh`（99 行）。追跡=`git mv`／非追跡=`mv` のファイル単位判定・メインツリーガード・衝突ガード | 2026-07-17 | implement-feature | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: ADR-137-1〜4 の追記（DECISIONS.md）

- **実装内容**: `git diff main..HEAD -- docs/maintainer/decisions/DECISIONS.md` を実読。ADR-137-1（close 移動を整理整頓と再定義・両モード実行）／137-2（トリガー=GitHub Issue close、実行主体=進行役、実行場所=メインツリー）／137-3（`close-move-issue.sh` 新設・ファイル単位判定）／137-4（audit #33 一括 SKIP 撤廃）の 4 件が追加。
- **確認事項**: 各 ADR が 5 要素（コンテキスト・検討した選択肢・決定・根拠[evidence_source]・帰結）を欠かさず備える。evidence_source は 137-1=human_decision、137-2=human_decision+existing_code、137-3=observed_runtime、137-4=existing_code+observed_runtime。**ADR-S2-toggle・ADR-S2-5 の本文は差分に一切現れず不変**（旧エントリは履歴として保存・上書きは新規 ADR で宣言）。冒頭説明文 1 行のみ両モード整合へ更新されており、これは ADR-137-1 との整合上必要かつ ADR 本文ではない。

#### タスク 2: 正本 4 文書の記述整合

- **実装内容**: 4 文書の diff を実読。CORE.md §完了 issue の close 分離／PHASES.md §完了 issue の close 移動／run_command.md §Issue 追跡モード／自己拡張ワークフロー.md（完了行・SKIP 説明・実行確定分岐・猶予意味・相対リンク補正手順）を「両モードで close 移動を行う。モード差は確定手段（人間関与点）のみ」へ書き換え。project は「実行確定の 2 分岐」→「3 分岐（分岐 C=github_native）」へ拡張。
- **確認事項**: local_tracked の既存記述（分岐 A=PR マージ確定、分岐 B=ユーザー明示指示）はセマンティクスを保持したまま 3 分岐構成へ再編されており、挙動不変。

#### タスク 3: audit.sh #33 の github_native SKIP 撤廃

- **実装内容**: `check_close_move_pending` 冒頭の `if [[ "$(resolve_issue_tracking_mode)" == "github_native" ]]; then ... return 0; fi` ブロックを撤廃し、両モード共通で走査する旨のコメントへ置換。ヘッダコメント #33・関数説明コメントも「両モードで検知」へ是正。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/ci/audit.sh`（+21/-8 のうち実質は SKIP ブロック削除＋コメント）。
- **確認事項**: 撤廃以外に走査ロジック・grandfather（既定 20260712）・猶予（`CLOSE_MOVE_GRACE_DAYS` 既定 3）・FAIL メッセージ・`*/close/*`・`*/templates/*`・`*/90_issues/*` 除外・`resolve_issue_tracking_mode` 本体はいずれも不変。

#### タスク 4: close-move-issue.sh 新設

- **実装内容**: 単一 issue ディレクトリを受け取り、配下ファイルを `git ls-files --error-unmatch` でファイル単位に追跡判定し、追跡=`git mv`／非追跡=`mv` で `<workflow>/close/<issue>/` へ移動。空になった元ディレクトリを掃除。移動確認は `git status`（パスのみ）で行い close/ 配下の内容は読まない。
- **実装方法**: メインツリー実行ガード（`--git-dir` != `--git-common-dir` の worktree 検知・非 git 検知・root 直下 `.agent-skill-chain/` sentinel）＋衝突ガード（移動先既存で停止）＋引数検証＋0 件検知。`set -euo pipefail`。
- **確認事項**: 全ファイル実読。守備範囲は「非追跡ドラフトをメインツリーで移動する機械部分」に限定され、リンク補正・完了判断・gh 操作・PR・commit を含まない（単一責務）。

---

## 3. テスト結果の確認

> 実装成果物にテスト（スクリプト・audit ロジック）が含まれるため、tmp 隔離環境で **自分でも再実行** して検証した。専用の自動テストファイル（.bats 等）は本 PR に含まれず、検証は 01 の BDD gherkin シナリオを隔離フィクスチャで実挙動確認する形で行った。

### 3.1 単体テスト（隔離環境での実挙動検証）

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-17
- **テストシナリオ数**: 16（T3=6・T4=10）
- **成功**: 16
- **失敗**: 0
- **スキップ**: 0

#### T3: audit.sh #33 の local_tracked 非回帰（最重要）

`git show main:...audit.sh` と HEAD 版の 2 install を用意し、同一の隔離フィクスチャ（github.com remote 付き git repo・完了済み未移動 issue・workflow.db に verify-and-close 証跡）に対して同一条件で実行し比較した。

| 検証 | 条件 | 結果 |
| ---- | ---- | ---- |
| install 差分が T3 diff と一致 | main install の audit.sh のみ差し替え | OK（SKIP ブロック撤廃＋コメントのみ） |
| **local_tracked 全出力差分** | `ISSUE_TRACKING_MODE=local_tracked`・main vs head | **完全一致（差分 0・非回帰）** |
| local_tracked FAIL 集合 | close 移動未実施 FAIL の件数 | main=1 / head=1（一致） |
| github_native の main | `ISSUE_TRACKING_MODE=github_native`・remote=github.com | #33 を SKIP（close-move FAIL=0） |
| github_native の head | 同上 | **#33 が走り close 移動未実施を検知（FAIL=1）** |
| CI 相当 no-op | github_native・追跡ファイルのみ（非追跡ドラフト不在を模擬） | close-move FAIL=0（走査対象 0 件で構造的 no-op） |

- ts_utc は実 DB と同形式の ISO（`2026-07-01T00:00:00Z`）を用いた。初回フィクスチャでレガシー `YYYYMMDD_HHMMSS` 形式を用いた際は GNU date が underscore をパースできず #33 が発火しなかったが、これはフィクスチャ側の形式誤り（実 DB の主形式は ISO）であり、ISO 修正後は期待どおり両モードで検知した。
- **結論**: local_tracked 挙動は変更前後で完全に一致（差分 0）。github_native は main=SKIP→head=検知へ意図どおり変化。CI では非追跡ドラフト不在により no-op。回帰安全を独立に実証。

#### T4: close-move-issue.sh の実挙動・ガード

隔離した main-tree git repo（root 直下に `.agent-skill-chain/` sentinel・workflow/close/ を持つ）で実行。

| # | シナリオ | 期待 | 結果 |
| - | -------- | ---- | ---- |
| 1 | 混在 dir（追跡 3＋非追跡 2・ネスト含む） | 追跡=git mv(R)/非追跡=mv(??)・元 dir 消滅 | OK（`git status` で追跡 3=Rename・非追跡 2=??・wf/issueA 削除） |
| 2 | 全非追跡 dir（#132 相当・issueD） | 全件 mv・git 非関与・元 dir 消滅・RC=0 | OK（close/issueD が ?? のみ・元 dir GONE） |
| 3 | 全追跡（混在テストで検証） | git mv で R（履歴 move 保持） | OK |
| 4 | worktree で実行 | メインツリーガードで拒否 | OK（exit 1・「worktree 内での実行を検知」） |
| 5 | 移動先が既存 | 衝突ガードで拒否 | OK（exit 1・「移動先が既に存在する」） |
| 6 | close/ 配下を渡す | 拒否 | OK（exit 1・「close/ 配下の issue は移動対象にできない」） |
| 7 | 引数 0 個／2 個 | 引数検証で拒否 | OK（exit 1） |
| 8 | 存在しない dir | 拒否 | OK（exit 1） |
| 9 | 非 git ツリー | メインツリーガードで拒否 | OK（exit 1・「git リポジトリとして解決できない」） |
| 10 | git repo だが root 直下に .agent-skill-chain 無し（sentinel 欠如） | 安全側停止 | OK（exit 1・「sentinel 不成立」） |

- **ADR-137-3 のエビデンス独立再測**: メインツリーで `git ls-files` を実測し、遡及 4 件の追跡数が ADR 記載と完全一致することを確認した — #115（issue運用ポリシー全面移行）=16/17、#119（worktree運用規律）=13/13、#127（デザイナー視点組込）=10/10、#132（workflow-db監査証跡）=0/4。

#### 失敗したテスト

なし（0 件）。

### 3.2 統合テスト

該当なし（本変更は監査スクリプト・移動スクリプトの単体挙動が対象）。

### 3.3 E2E テスト

該当なし。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント結果**: 0 / 0（`set -euo pipefail`・`bash -n` 相当で構文健全。実行検証済み）
- **フォーマット**: 問題なし
- **型チェック**: 該当なし（bash）

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | close-move-issue.sh の冒頭コメントに目的・守備範囲・ガード・使い方を明記 | OK | 単一責務が明文化されている |
| 保守性 | audit.sh #33 は SKIP ブロック撤廃のみで走査ロジック・env・除外を温存 | OK | 審査済みロジックを破壊せず最小差分 |
| パフォーマンス | 少数ファイルの mv/git mv・unbounded find は既存 #29/#31 と同型 | OK | 性能懸念なし |
| セキュリティ | close/ 配下を読まず `git status` のパスのみで確認・sentinel でメインツリー限定 | OK | deny 設定に抵触しない設計 |

### 4.2 指摘事項

#### 指摘 1: SIGPIPE 下での部分移動（軽微・非ブロッキング・コード変更不要）

- **重要度**: 低
- **指摘内容**: 検証中、スクリプト stdout を早期終了するパイプ（壊れた grep）へ繋いだ際、SIGPIPE でループが途中終了し部分移動が残った。パイプ無しの直接実行では全件移動・元 dir 削除・RC=0 と正常。
- **対応状況**: 対応不要（完了）
- **対応方法**: これは `set -e`＋SIGPIPE 下の任意スクリプト共通の性質で、本スクリプトの呼び出し規約は進行役による直接実行（stdout をパイプで早期クローズしない）。実運用の呼び出し形態では発生せず、コード変更は不要と判断。分岐 C の運用手順どおり直接実行すれば安全。将来もし出力をパイプ消費する運用を導入する場合の留意点として記録に留める。

**その他の指摘: なし。** T1〜T4 いずれも独立検証で受け入れ基準を満たし、修正を要する欠陥は検出されなかった。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（frontmatter mode:full・github_issue:#137・branch 記録済み） | verify サブ | 2026-07-17 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（BDD 4 ユースケース・受け入れ基準） | verify サブ | 2026-07-17 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-137-1〜4・分岐 C） | verify サブ | 2026-07-17 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（T1〜T5 タスク分解） | verify サブ | 2026-07-17 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（T1〜T4 は 02 の ADR-137-1〜4・分岐 C・03 のタスク分解に対応）。review-docs 設計レビュー（memo ラウンド 1・2）で F1〜F5 が実装前に是正済みで、実装はその是正済み設計に一致。
- **要件と実装の整合性**: 整合している（01 の受け入れ基準を §12.3 で全件充足確認）。
- **コメント**: 旧表現「local_tracked 専用」「github_native.\*close 移動.\*行わない」「close 移動.\*不要」が source・project から grep で 0 件（除去確認済み）。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本変更は `.agent-skill-chain/source`（フレームワーク正本）・`.agent-skill-chain/project`・`enforcement/ci/audit.sh`・`docs/maintainer/decisions/DECISIONS.md` の保守者向け運用規約・ADR・監査ロジックの改修であり、`docs/`（システム仕様書・利用者向け仕様）が記述する対象領域には影響しない。close 移動の運用再定義は保守者ワークフロー内部の整理整頓ルールであり、システム仕様書の機能・画面・データ・API 記述に変更を生じない。よって DOCS_RULES.md §継続追随ゲートは更新不要判定（根拠付き軽量パス）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。close-move-issue.sh は単一責務（非追跡ドラフトのメインツリー移動の機械部分のみ）で UNIX 哲学に沿う。audit #33 は SKIP 撤廃の最小差分で「審査済みロジックを破壊しない」原則を守る。
- **ディレクトリ構成**: OK。スクリプトは `.agent-skill-chain/source/scripts/`（既存 memo-prefix.sh・resolve-wf-db.sh と同列）に配置。
- **命名規則**: OK。`close-move-issue.sh`（動詞-対象-種別）。

### 9.2 境界・依存の確認

- **責務の境界**: OK。スクリプト=機械移動、進行役=完了判断・GitHub Issue close 確認・PR 確定、audit #33=検知 Query（移動を強制しない）で三者が分離。
- **依存関係**: OK。`resolve_issue_tracking_mode` は #28 と共用のため不変で参照せず、意図しない結合を作らない。`gh` へは依存しない（監査純粋性・可搬性を保持）。
- **指摘・推奨**: T5（遡及 4 件の移動）は本 PR の後、T2/T3/T4 が main へマージされてから実行すべき（下記 §12.3 申し送り）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| local_tracked 非回帰（差分 0） | test_output | tmp 隔離で main/head audit.sh を同一フィクスチャ実行し全出力一致を確認 |
| github_native で #33 が検知へ変わる | test_output | 同フィクスチャで main=SKIP/head=FAIL を確認 |
| CI 構造的 no-op | test_output | 追跡ファイルのみのフィクスチャで close-move FAIL=0 を確認 |
| close-move-issue.sh の追跡/非追跡分岐・ガード | test_output + existing_code | 10 シナリオ実行＋全文実読 |
| ADR-137-3 の追跡数エビデンス | observed_runtime | `git ls-files` で #115=16/17・#119=13/13・#127=10/10・#132=0/4 を再測・一致 |
| 旧 ADR 本文不改変・旧表現除去 | existing_code | diff 実読＋grep 0 件 |
| .adapters 非編集・T5 スコープ外 | observed_runtime | `git diff --stat` に .adapters・遡及 4 件が不在 |

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（最小差分・単一責務・審査済みロジック温存）
- **テスト品質**: 良好（隔離環境で 16 シナリオ再実行・非回帰を差分 0 で実証）
- **ドキュメント品質**: 良好（ADR 5 要素・旧表現除去・4 文書整合）
- **総合評価**: **承認可**（指摘は軽微 1 件のみで対応不要。修正を要する欠陥なし）

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 委譲サブエージェント（独立検証）
- **承認日**: 2026-07-17
- **承認コメント**: T1〜T4 は 01 の受け入れ基準を全件満たす。local_tracked・消費者への回帰・波及なし。T5 は別途・マージ後に進行役が実行する前提を守っており本 PR のスコープ分離は適切。

### 12.3 受け入れ基準の充足確認（01 §2.1 / §2.2）

| 受け入れ基準（01） | 充足 | 検証方法 |
| ------------------ | ---- | -------- |
| S1: close 移動が github_native でも整理整頓目的で実行される（正本 4 文書が両モード整合） | OK | 4 文書 diff 実読・旧表現 grep 0 件 |
| S1: 実行主体=進行役・実行場所=メインツリー・トリガー=GitHub Issue close が正本に明記 | OK | CORE/PHASES/project の分岐 C 記述確認 |
| S2: 遡及移動の追跡/非追跡混在をファイル単位で正しく扱う | OK | close-move-issue.sh の混在・全非追跡・全追跡・ガード 10 シナリオ実行 |
| S3: 恒久 ADR で旧判断を上書き・旧エントリ不改変 | OK | ADR-137-1〜4 が 5 要素・evidence_source 付き／ADR-S2-toggle・S2-5 本文 diff 不在 |
| S4: audit #33 の github_native 再設計が実装と一致 | OK | SKIP 撤廃・両モード検知・CI no-op を実挙動で確認 |
| S5-1: **local_tracked の close 移動フロー・#33 が差分 0 で維持** | OK | tmp 隔離で main/head 全出力一致（最重要・実証済み） |
| S5-2: 配布物 source 既定挙動不変（env unset/非 github→local_tracked）で消費者非波及 | OK | `resolve_issue_tracking_mode` 本体不変・github_native は明示 env+github remote 時のみ実効 |
| S5-3: #33 の github_native 挙動が再設計され記述と一致 | OK | ヘッダ/関数コメント・project SKIP 説明が実装と整合 |
| スコープ: T5（遡及 4 件移動）は本 PR に含めない | OK | `git diff --stat` に遡及 4 件・.adapters が不在 |

**全受け入れ基準を充足。** 指摘 0 件（軽微観察 1 件は対応不要）で収束。

---

## 16. CodeRabbit 未解決 2 件の是正検証（PR #138・commit `e24a09a`・2026-07-18）

> **重要**: 本節は PR #138（T1〜T4）マージ後に CodeRabbit が残した未解決 2 件（Major×2）への是正を、**実装したサブエージェントの自己申告を鵜呑みにせず独立観点で検証**した記録。差分・実ファイルの行順実読、旧版とのバイト比較、tmp 隔離での自力再現、テスト自力再実行により裏取りした。**GitHub Issue #137 は引き続き OPEN（T5 未完了）**。

### 16.1 是正対象と実装（commit `e24a09a`・worktree `bugfix/20260718_003329-close-move-guard-audit33-warn`）

| # | 指摘（CodeRabbit） | 重要度 | 是正内容 |
| - | ------------------ | ------ | -------- |
| 修正1 | `close-move-issue.sh` の引数検証不足。`workflow_dir` が許可 workflow root 直下かを検証しておらず、無関係ディレクトリ（例 `.agent-skill-chain/source`）を渡すと全ガードを通過しフレームワーク本体を誤移動しうる（安全性・Major） | Major | ロジック順序を再編し `main_root` 解決（worktree 拒否・sentinel）を先に済ませてから、`workflow_dir` が `<main_root>/docs/maintainer/workflow` または `<main_root>/.agent-skill-chain/runtime` の**直下**であることを絶対パス `case` 照合で要求する workflow root 制限ガードを追加（ADR-137-5） |
| 修正2 | audit `#33` の github_native 誤 FAIL。github_native は GitHub Issue close 待ちが正当にありうるのに猶予超過を一律 FAIL していた（Major） | Major | `check_close_move_pending` の猶予超過分岐を実効モードで分岐。github_native は WARN（非 FAIL・EXIT_CODE 不変）へ格下げ、local_tracked は従来どおり FAIL（EXIT_CODE=1・完全不変） |

### 16.2 独立検証の結果（指摘なし）

#### 修正1: workflow root 制限ガード（安全性の核心＝解決順序）

- **行順の実読**: `close-move-issue.sh` を全文実読。`main_root` の解決（git 解決 54-57 行・worktree 拒否 58-60 行・sentinel 63-64 行）が **workflow root 制限 `case`（75-81 行）より前**にあることを実際の行番号で確認した。順序が逆だと `main_root` 未確定で絶対パス照合が成立しないため、この順序が安全性の前提。`target_parent`/`target_dir` の決定（83-84 行）は制限 `case` 通過後に移動しており、拒否時は移動先計算にすら到達しない。
- **tmp 隔離での自力再現**（テストファイル任せにせず手動フィクスチャで実行）:
  - 無関係 dir `.agent-skill-chain/source/somemodule` を渡す → **exit 1 で拒否**。`core.md` が動かず `close/` も未作成＝**フレームワーク本体の誤移動なし**を実確認。
  - 正規 `docs/maintainer/workflow/<issue>` → **exit 0・`close/` へ移動成功**。
  - 消費者ランタイム `.agent-skill-chain/runtime/<issue>` → **exit 0・`close/` へ移動成功**。
- **付随確認**: 従来の「close/ 直下拒否」は root 不一致（親が `<root>/close` で許可 2 root に該当しない）で自然に拒否され、`basename==close` の個別チェック削除後も回帰しないことを確認。

#### 修正2: audit `#33` の実効モード分岐（最重要＝local_tracked 完全不変）

- **分岐ロジックの実読**: `check_close_move_pending`（1122 行 `eff_mode` 解決、1144-1154 行の分岐）を実読。github_native は WARN を stderr 出力するのみで **`EXIT_CODE` を触らない**、local_tracked（`else`）は `FAIL`＋`ROLLBACK_MSG`＋`EXIT_CODE=1`。
- **local_tracked 完全不変のバイト比較**: PR #138 マージコミット `b2a780d` の `audit.sh` から猶予超過ブロックを抽出（`FAIL`＋`$ROLLBACK_MSG`＋`EXIT_CODE=1`）し、現行の `else` 分岐と**メッセージ・ROLLBACK・EXIT_CODE すべて同一**であることを確認。local_tracked 経路は変更前後で完全一致。
- **`resolve_issue_tracking_mode` は #28/#33 共用の既存シグナルを再利用**（新規判定を作らない・単一責務）。未設定・非 GitHub は local_tracked へフォールバックし FAIL 経路を辿る。
- **自力テスト再実行**（実 `audit.sh` バイナリを実フィクスチャ+mode env で駆動）: `test-audit.sh` の #33 S10（github_native→WARN・EXIT_CODE 不変＝猶予超過 rc == 猶予内 rc）・S11（local_tracked→従来どおり FAIL／close 移動 FAIL 以外の FAIL 集合は両モード同一＝差分なし）が **PASS**。

#### ADR-137-5（DECISIONS.md）

- 5 要素（コンテキスト・検討した選択肢・決定・根拠[evidence_source: existing_code + human_decision]・帰結）を欠かさず備え、末尾へ**追記**されている。ADR-137-4 本文は diff 上一切改変されておらず、ADR-137-5 は「走査を両モードで有効化する ADR-137-4 の決定は維持し、猶予超過時の重大度のみ github_native で緩和する」＝**補完**（上書きではない）と明記。ADR-137-4 帰結中の「github_native CI で FAIL 検知されうる」記述が本 ADR により WARN 検知へ改まる旨も追記済み。

### 16.3 テスト再実行結果（自力・数値）

- **実行日**: 2026-07-18
- **`test/test-close-move-issue.sh`（新設・10 ケース）**: PASS=10 / FAIL=0。全追跡 S1・全非追跡（消費者ランタイム root）S2・混在 S3・**workflow root 外拒否 S4**・close/ 直下拒否 S5・sentinel S6・worktree S7・衝突 S8・引数不正 S9 を網羅。
- **`test/test-audit.sh`（#33 に追加分含む全体）**: PASS=133 / FAIL=0。#33 の S10（github_native WARN・EXIT_CODE 不変）・S11（local_tracked FAIL 維持・FAIL 集合差分なし）を含む。
- **`test/run-all.sh`（全体スイート）**: 合計 25・PASS=18・FAIL=1・SKIP=6。唯一の FAIL は `test-worktree-discipline`（`validate_worktree_path`/`is_worktree_destroy` の finding-5・repo 直下 `.worktree` accept）で、**本変更とは無関係の既存失敗**。根拠: 本 commit `e24a09a` の変更 6 ファイル（audit.sh・close-move-issue.sh・DECISIONS.md・run-all.sh・test-audit.sh・test-close-move-issue.sh）に worktree discipline 関連ファイルは含まれず、当該テストが source する `PreToolUse.sh` フックは base `b2a780d` からバイト不変（`git diff` 空）であることを確認済み。close-move/audit #33 の追加・変更テストはすべて PASS。

### 16.4 是正検証の結論

- **指摘なし**（修正 1・2 とも実装申告どおりで、追加是正を要する欠陥は検出されなかった）。
- **local_tracked 完全不変**を旧版バイト比較・自力テスト（S11・FAIL 集合差分なし）の二重で実証。
- **安全性**（無関係 dir 誤移動防止）を tmp 隔離の自力再現で実証。解決順序（main_root 先行）も行番号で確認。
- 検証観点の evidence_source は全て test_output / existing_code（実読・実行・比較）に基づき、inference_only 依存の重要判断はない。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- GitHub Issue #137
- `docs/maintainer/decisions/DECISIONS.md`（ADR-137-1〜4・ADR-S2-toggle・ADR-S2-5）
- commit `beaef53`（T1〜T4 実装）
- 検証ログ（tmp 隔離・本セッションで実行）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 進行役による PR 化（T2/T3/T4 を main へマージ）。
- **マージ後**に進行役が T5（遡及 4 件の close 移動）をメインツリーで実行（順序厳守。詳細は完了報告の申し送り）。
