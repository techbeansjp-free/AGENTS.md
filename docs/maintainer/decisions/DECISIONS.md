---
document_id: "aa9911ab-cadc-41be-8620-2053d5f20fa5"
---

# DECISIONS — 本リポジトリの恒久 ADR 記録（決定ログ）

本ファイルは、本リポジトリ（`techbeansjp-free/AGENTS.md`）の設計・運用に関する**恒久的な設計判断（ADR: Architecture Decision Records）**を git 追跡で永続保存する単一の記録先である。

`ISSUE_TRACKING_MODE=github_native` 採用により、起票検討段階のローカル issue ドラフト（`docs/maintainer/workflow/**` 配下の 00〜04）は非追跡化され、tracking は GitHub Issue の close で完結する。**close 移動（`close/` へのローカル整理整頓）は両モードで行う**（ADR-137-1）が、非追跡ドラフトは worktree 削除等で破棄されうる。そのため、破棄されても失われてはならない**恒久的な設計判断**を、追跡ファイルである本ファイルへ集約する（2026-07-15 の worktree 削除で 02/03 が失われた事故の再発防止も兼ねる）。

- **記録形式の正本**: ADR 最小集合の定義は [.agent-skill-chain/source/EVIDENCE_POLICY.md §節2](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md) を正本とする（本ファイルは同形式を適用するのみで再定義しない）。
- **evidence_source の分類定義**: [.agent-skill-chain/source/CONCEPTS.md §外部根拠の必須化](../../../.agent-skill-chain/source/CONCEPTS.md#外部根拠の必須化external-anchor) を正本とする。
- **本リポ運用手順との関係**: 本ファイルへの記録タイミング・両モード運用は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../.agent-skill-chain/project/自己拡張ワークフロー.md) が正本。

---

## 記録手順（いつ・何を・誰が追記するか）

- **いつ**: 各 issue の完了フェーズ（verify-and-close／04_review 作成時）に、その issue で確定した**恒久的な設計判断**を本ファイルへ転記する。実装途中に判明した重要判断も、遅くとも完了フェーズまでに追記する。
- **何を**: 採否がその issue の成果物の構造・実現可能性・後続フェーズを左右する**重要判断**（[EVIDENCE_POLICY.md §節3](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md)）を、下記「ADR 記録フォーマット」の ADR 最小集合 5 要素で記録する。誤字修正・表現整理等の軽量 issue は対象外（記録不要）。
- **誰が**: 当該 issue の実装・レビューを担当したエージェント（またはその成果を確認した進行役・保守者）。非追跡ドラフトの内容に依存せず、本ファイル単体で判断の背景が辿れるよう自己完結的に記述する。
- **どこへ**: 本ファイル末尾の「## ADR 記録」節へ、新しい ADR を**追記**する（既存エントリは改変しない。決定が覆った場合は新規 ADR として「〜を上書きする」旨を記録し、旧エントリは履歴として残す）。
- **トークン・機密の非混入**: 認証トークンの実値・機密情報を本ファイルへ残さない。

---

## ADR 記録フォーマット（ADR 最小集合 5 要素）

各 ADR は次の 5 見出しで記録する（正本: [EVIDENCE_POLICY.md §節2](../../../.agent-skill-chain/source/EVIDENCE_POLICY.md)）。

```markdown
### ADR-<連番>: <決定の要約タイトル>（<日付 YYYY-MM-DD>・issue: <参照>）

- **コンテキスト**: なぜこの判断が必要か。
- **検討した選択肢**: 比較した候補（2 案以上が望ましい）。
- **決定**: 採用した選択肢。
- **根拠**: 決定に至った理由（**evidence_source 付き**。例: `[evidence_source: observed_runtime]`）。
- **帰結**: この決定によって何が確定し、何に影響するか。
```

---

## ADR 記録

<!--
本節へ各 issue の恒久 ADR を追記する。以下は S-2（本リポ github_native 採用）の恒久判断であり、
verify-and-close（04_review）フェーズで本節へ転記した（02_設計 ADR-S2-5 の帰結）。
正本は当該 issue の 02_設計.md（非追跡ドラフト）だが、本ファイル単体で判断の背景が辿れるよう自己完結的に要約する。
-->

### ADR-S2-1: `.gitignore`・#28 ガード・スイッチ投入の原子的投入（2026-07-17・issue: 親 GitHub Issue #115 / S-2）

- **コンテキスト**: ローカル issue ドラフト(00〜04)を `.gitignore` で非追跡化するにあたり、非追跡化・audit.sh #28 ガード追加・実効モードスイッチ投入の順序を誤ると本リポ監査がロックアウトしうる。fable 助言は「`.gitignore` 追加だけで既存**追跡済み**ドキュメントが #28 で FAIL する」と指摘した。
- **検討した選択肢**: (A) 3 変更（`.gitignore`・#28 ガード・CI スイッチ）を同一 PR で原子的投入。(B) #28 ガードを先行 PR で投入。(C) 順序無制約。
- **決定**: (A) 同一 PR での原子的投入。加えて fable 前提（追跡済みが即 FAIL）は実測で否定し、真のリスク（未追跡ドラフトの誤 FAIL）へ順序制約を限局。
- **根拠 [evidence_source: observed_runtime]**: `git check-ignore -q`（`--no-index` 無し）は git index を参照し、追跡済みファイルは exit 1（非 ignore＝#28 対象外）、未追跡ドラフトのみ exit 0（#28 対象）を返す（git 2.43.0・tmp 隔離で実測。verify-and-close で独立再現確認済み）。CI（`actions/checkout`）はクリーン展開で追跡ファイルのみ＝未追跡ドラフト不在のため #28 は安全。真の順序制約点は未追跡ドラフトが同居しうるローカル作業ツリー(pre-push)。
- **帰結**: 3 追跡成果物（`.gitignore` パターン・`audit.sh#28` ガード・`self-enforce.yml` audit step の env）を同一 PR で投入し中間状態を main に残さない。ローカル pre-push は追跡外のため hook 採用と env 設定を一組で行う不変条件とする（唯一の残余ロックアウト経路の封鎖）。

### ADR-S2-2: #28 への github_native SKIP ガードの実装方式（S-1 #33 と同型）（2026-07-17・issue: S-2）

- **コンテキスト**: 非追跡ドラフトによる #28（`check_issue_doc_in_gitignored_path`）誤 FAIL を解消する実装が必要。
- **検討した選択肢**: (A) #33 と同型の「冒頭で `resolve_issue_tracking_mode`==github_native なら SKIP」ガードを #28 冒頭に 1 箇所追加。(B) `.gitignore` パターンを走査対象から除外する特別扱い。(C) #28 廃止。
- **決定**: (A) S-1 が確立した #33 同型の冒頭 SKIP ガードを #28 に 1 箇所追加。
- **根拠 [evidence_source: existing_code]**: #33 は既に同一パターンの冒頭ガードを持つ（審査済みロジックの横展開）。`resolve_issue_tracking_mode`・#33 本体・#28 の既存検知ロジックは不変（最小差分）。(B) は複雑化、(C) は local_tracked での誤配置検知を失う。
- **帰結**: `github_native` では #28 が SKIP（stderr に SKIP 行・`return 0`）。`local_tracked`・非 GitHub では従来検知が有効（回帰安全）。verify-and-close の tmp 隔離実測で SKIP（github_native）／FAIL（local_tracked）両方向を独立確認済み。

### ADR-S2-3: スイッチ（env `ISSUE_TRACKING_MODE`）の機械的実装先の確定（2026-07-17・issue: S-2）

- **コンテキスト**: 実効モードは env `ISSUE_TRACKING_MODE` × github.com remote の 2 因子で決まる。CI とローカル pre-push で誰がどこで env を設定するかを確定しないとスイッチが機械的に成立しない。配布物 source へ書くと消費者へ波及する（AC8 違反）。
- **検討した選択肢**: (A) CI＝`self-enforce.yml` audit step の `env:` に付与、pre-push＝ローカル hook/シェルで export。(B) 配布物 `pre-push.example`／`audit.yml`／`audit.sh` 既定値へ焼き込み。(C) project に env 宣言ファイルを新設し audit.sh が読む。
- **決定**: (A)。source 配布物は変更しない。
- **根拠 [evidence_source: existing_code + observed_runtime]**: `self-enforce.yml` は本リポ専用 CI（配布物ではない）。pre-push フック実体は git 追跡外・環境固有。本リポ `git remote` は github.com を含む。(B) は消費者波及で AC8 違反、(C) は解決層に env 以外の入力を持ち込み 2 因子原則を崩す。
- **帰結**: 実効 github_native は「本リポ CI step env ＋ ローカル pre-push/シェル export」の 2 箇所で成立。配布物 source の既定 `local_tracked` は不変（消費者は unset→local_tracked）。audit step の `continue-on-error`（非ブロッキング）は不変。verify-and-close で AC8 非波及（unset→local_tracked／非 github remote→local_tracked／source 差分は #28 ガードのみ）を独立確認済み。

### ADR-S2-4: `.gitignore` 非追跡パターンの設計（過剰 ignore 回避・tracked 温存）（2026-07-17・issue: S-2）

- **コンテキスト**: `docs/maintainer/workflow/**` 配下の 00〜04 を非追跡化し、既存追跡ファイル・`DECISIONS.md`・Forms を巻き込まない要求（C7）。
- **検討した選択肢**: (A) 5 明示ファイル名パターン。(B) `0[0-4]_*.md` ワイルドカード。(C) `*.md` 全体。
- **決定**: (A) 明示 5 パターン（`docs/maintainer/workflow/**/{00_要求定義,01_要件定義,02_設計,03_実装計画,04_review}.md`）。
- **根拠 [evidence_source: observed_runtime]**: 追跡済みは git 機構により温存（ADR-S2-1 実測）。可読性・過剰 ignore 回避のため (C)(B) は不可。(A) は #28 の find 走査対象のうち正規ドラフト名のみを非追跡化。
- **帰結**: 新規未追跡ドラフト（上記 5 名）のみ非追跡。既存追跡 issue・`close/`・`90_issues.md`・`DECISIONS.md`（別パス）・Forms（別パス）は追跡継続。verify-and-close で over-ignore 無し（DECISIONS.md・Forms・90_issues.md・docs/README.md がいずれも非 ignore）を独立確認済み。

### ADR-S2-5: 恒久 ADR 記録先 `DECISIONS.md` の構造（2026-07-17・issue: S-2）

- **コンテキスト**: github_native では close 移動を行わずローカルドラフトは非追跡・破棄されうる。設計判断の永続記録先が別途必要（2026-07-15 worktree 削除で 02/03 喪失事故の再発防止）。
- **検討した選択肢**: (A) 単一追記ファイル `docs/maintainer/decisions/DECISIONS.md` に ADR 最小集合で記録。(B) issue ごと個別 ADR ファイル。(C) GitHub Issue コメントのみ。
- **決定**: (A) 単一の git 追跡ファイル。
- **根拠 [evidence_source: existing_code + inference_only]**: EVIDENCE_POLICY §節2 が ADR 最小集合 5 要素を定義。単一ファイル追記は参照容易性・可読性に優れ非追跡ドラフト破棄後も恒久保存される。(B) はファイル増殖、(C) は git 追跡外で喪失リスク。
- **帰結**: 本ファイル（DECISIONS.md）が恒久 ADR 記録先。本 ADR-S2-1〜S2-7 の転記自体が本 ADR の帰結の履行である。

### ADR-S2-6: 本リポ Issue Forms 実ファイルの新設方式（S-3 雛形からのコピー）（2026-07-17・issue: S-2）

- **コンテキスト**: GitHub Web UI 手動起票に構造強制が無い。S-3 で汎用雛形 `enforcement/github/issue-request.example.yml` を新設済み。
- **検討した選択肢**: (A) S-3 雛形を `.github/ISSUE_TEMPLATE/issue-request.yml` へコピーし有効化。(B) 独自 Forms をゼロから作成。
- **決定**: (A)。
- **根拠 [evidence_source: existing_code]**: 雛形は目的・成功基準・受け入れ基準を `required: true`、全体像・フロー／参照を `required: false` とする妥当スキーマを備え自己記述済み。再利用が再発明回避。
- **帰結**: `.github/ISSUE_TEMPLATE/issue-request.yml` が Web UI で選択可能に。AI 起票（`gh issue create --body`）・audit・hook からは読まれず既存フロー非干渉。verify-and-close で YAML パース可・required 設計妥当（purpose/success-criteria/acceptance-criteria=true, overview-flow/references=false）を独立確認済み。

### ADR-S2-7: 検証は tmp 隔離＋非追跡ドラフトの実作成（2026-07-17・issue: S-2）

- **コンテキスト**: SC5〜SC8／AC5〜AC8 の検証は本番自己インストールを避け tmp 隔離で行う（2026-07-11 誤 uninstall 事故防止）。だが `git archive` は追跡ファイルのみをアーカイブするため非追跡ドラフト存在下の #28 挙動を再現できず偽 PASS になる。
- **検討した選択肢**: (A) tmp 隔離環境内で `.gitignore` 適用後に新規 00〜04 を実ファイル作成し非追跡を確認してから audit 実行。(B) `git archive` 展開結果のみで検証。
- **決定**: (A)。
- **根拠 [evidence_source: observed_runtime]**: `git archive` は tracked のみ出力。(B) では非追跡ドラフト不在で #28 が偽 PASS。
- **帰結**: 検証は「隔離環境構築→`.gitignore` 適用→実ドラフト作成→非追跡確認→env 付与→audit 実行」で行う。verify-and-close で本手順を独立実施し AC7 を確認済み（下記 ADR-S2-V 参照）。

### ADR-S2-toggle: `ISSUE_TRACKING_MODE=github_native` スイッチ投入の正当性（人間判断のトグル運用）（2026-07-17・issue: S-2）

- **コンテキスト**: `ISSUE_TRACKING_MODE` を含む enforcement 関連 env は AI エージェントによる自律的な設定・変更を禁止（AGENT_CONDUCT §enforcement ゲートの自己無効化禁止）。本 issue はその env をスイッチ投入するため、正当性の根拠を恒久記録する必要がある（C4）。
- **検討した選択肢**: (A) 人間（保守者）判断の project 恒常トグル運用として扱い根拠を記録。(B) AI が自律設定（禁止・不採用）。
- **決定**: (A)。
- **根拠 [evidence_source: human_decision]**: 本スイッチ投入は親 GitHub Issue #115（オーナー起票）で承認された「issue 運用ポリシーの GitHub Issue 中心への全面移行（二重モード方式）」の S-2 成果であり、00〜03 で意図された成果物として計画・承認されている。AGENT_CONDUCT はゲートの「自己無効化（AI が自律的に自分の監査を緩める）」を禁止するものであり、人間が判断した正当な project 恒常トグル運用は禁止対象外（同 §正当なトグル運用との区別）。
- **帰結**: 本リポ実効モードを github_native とする恒常運用が正当化される。ただし本番 main への反映は PR マージという人間（オーナー／進行役）の行為で成立するため、マージ時にオーナーの明示的なトグル採用意図を確認するガバナンスチェックポイントを推奨する（verify-and-close 申し送り）。

### ADR-S2-V: verify-and-close 独立検証結果（AC5〜AC8・回帰安全）（2026-07-17・issue: S-2）

- **コンテキスト**: 実装（T-a〜T-f）の受け入れ基準を独立レビューが再検証した結果を恒久記録する（AC6/AC7 の DECISIONS.md 記録要求）。
- **決定・帰結（独立実測ベース）**:
  - **回帰安全（最重要）[evidence_source: observed_runtime]**: 本 worktree・同一 workflow.db に対し main 版 audit.sh と本ブランチ版 audit.sh を同一ディレクトリ・同一 env（local_tracked）で実行し、FAIL 集合が完全一致（差分 0）。#28 ガードは local_tracked で no-op であり既定挙動を破壊しない。
  - **AC5/AC6 [evidence_source: observed_runtime]**: `ISSUE_TRACKING_MODE=github_native`＋github.com remote 下で `resolve_issue_tracking_mode` は厳密に `github_native` を返し、audit.sh 実行時 #28・#33 とも SKIP 行を出力（#33 起因 FAIL 0 件）。
  - **AC7 [evidence_source: observed_runtime]**: tmp 隔離（`git archive`＋`git init`＋github.com remote）に `.gitignore` 適用後、`docs/maintainer/workflow/_probe_/{00,02}` を未追跡実作成（`git status --porcelain` 空・`git check-ignore` exit 0）。github_native では #28 SKIP で probe 由来 FAIL 0 件、local_tracked（unset）では #28 が probe ドラフトを確実に FAIL 検知。偽陽性解消と回帰検知の両方向を確認。
  - **AC8 [evidence_source: observed_runtime]**: env unset→`local_tracked`、env=github_native だが非 github remote→`local_tracked`。source 配布物差分は #28 ガードのみ（既定値 `local_tracked` は不変）。
  - **AC1/AC3/AC4 [evidence_source: observed_runtime]**: `.gitignore` は既存追跡（S-2 の 00〜03）・`DECISIONS.md`・Forms・`90_issues.md`・`docs/README.md` を巻き込まない（over-ignore 0）。Forms は YAML パース可・required 設計妥当。DECISIONS.md は追跡・ADR 5 要素充足。
  - **既知の設計上の帰結（欠陥ではない）**: #36（`check_pr_issue_linkage`）は `git diff --name-only`（追跡ファイルのみ）起点のため非追跡ドラフトを検知対象にできない（Issue 紐づけは GitHub Issue／#34 ゲートで担保）。

### ADR-EXP-1: 新規 skill domain `experience` を 1 つ追加する（既存 skill への統合ではなく）（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: デザイナー視点（UX/プロダクトデザイン）をどこに置くか。
- **検討した選択肢**: (a) 既存 skill（extract-goals / define-boundaries）へ観点統合。(b) 新規 domain 追加。(c) ハイブリッド。
- **決定**: (b)＋(c) の折衷。新規 domain `experience` を 1 つ追加し、`design-feature` chain に条件付き工程として差す。要求フェーズへは新規 skill を置かず、00_要求定義.md の trigger 記入とテンプレート枠で「参加」させる（軽量統合）。ドメイン内のフェーズ分割数は ADR-EXP-7 で決定する。
- **根拠 [evidence_source: human_decision]**: (a) は該当 skill が二責務化し単一責務を崩す・条件発動（UI/UX 時のみ）の制御が困難。(b) は既存 domain（requirements/architecture/…）の構成に倣え、条件発動を chain step の分岐で表現できる。spec/01 単一責務・spec/06「再利用のために責務を曖昧にしてはならない」に整合し、META_LAYER Rule 1（統合検討）に対しては、体験設計は requirements/architecture のいずれとも責務が異なり統合すると単一責務が崩れるため新規化を選択した。プロジェクトオーナーの「デザイナーがいない」という明示指摘に基づく判断。
- **帰結**: 新規 domain が 1 つ増える（内部フェーズ capability 数は ADR-EXP-7 が決定）。ただし新規 command・新規 enforcement・新規成果物ファイルは増やさない（ADR-EXP-4/ADR-EXP-5/ADR-EXP-7 で担保）。

### ADR-EXP-2: 差し込み位置は design-feature 冒頭の 1 箇所のみとし、requirement-discovery には新規工程を置かない（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: アドバイザー（fable、助言限定起用）は requirement-discovery 中盤（extract-goals と write-bdd の間）と design-feature 冒頭の 2 箇所への差し込みを提案していた。
- **検討した選択肢**: (a) 2 箇所差し込み（アドバイザー案）。(b) design-feature 冒頭 1 箇所のみ＋00_要求定義.md へのトリガー記入で要求フェーズは軽量参加。
- **決定**: (b)。requirement-discovery の chain（extract-goals→identify-assumptions→define-constraints→write-bdd）は変えない。要求フェーズは 00_要求定義.md の `experience_surface` 記入で参加する。
- **根拠 [evidence_source: existing_code]**: アドバイザー自身が落とし穴として挙げた「extract-goals・write-bdd との重複」を最小化する。write-bdd は既に「As a / I want / So that」のユーザーストーリーを担っており、体験の流れは設計フェーズで責務・API を逆算する側に置く方が、要件定義の要求（「設計フェーズで体験設計視点が入る」）に直結する。既存の requirement-discovery chain・write-bdd の既存責務を観察した上での判断であり、CONTEXT_EFFICIENCY の過剰適用回避・META_LAYER Rule 3 の最小変更にも整合する。要件定義の受け入れ基準「要求定義フェーズまたは設計フェーズのいずれか」を満たす。
- **帰結**: 差し込みは 1 箇所。要求フェーズの体験関与はトリガー記入という 1 行コストに抑えられる。将来、要求フェーズ専用の体験 capability（例: `map-user-journey`）が必要と判明した場合は別 issue で追加できる（拡張余地を残す）。

### ADR-EXP-3: 発動トリガーは 00_要求定義.md frontmatter `experience_surface` に記録し、silent skip を防ぐ（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: UI/UX 非関与 issue への過剰適用を避けつつ、「なし」を黙って素通りさせない（アドバイザー助言）。
- **検討した選択肢**: (a) 00_要求定義.md frontmatter に必須項目として追加。(b) frontmatter に任意項目として追加し、値が無い場合は frame-experience（体験フェーズ1）の step 1 が設計時に判定・記録。(c) 本文セクションに記録。
- **決定**: (b)。`experience_surface: "yes: <理由1行>"` または `"no: <理由1行>"`（既存の `github_issue: "declined: <理由>"` パターンに倣う）。任意項目とし、後方互換（既存の 00・既存消費者）を保つ。値が無い/未知の場合、frame-experience の step 1 が体験サーフェスを判定し、判定結果（あり/なし＋理由1行）を必ず 02_設計.md §7.0 に記録する（silent skip 防止は skill レベルで担保）。判定が「なし」なら後続フェーズ（map/detail）はスキップ。00 に `no: <理由>` が明示記入されている場合も無検証で採用せず、設計フェーズで最初に委譲されるサブが §7.0 へ転記した上で体験サーフェス定義（人間が感覚器で直接体験する出力があるか。画面に限らず CLI 出力・エラー・生成 Markdown・エージェント指示文を含む）に照らして検証し、定型理由が実際の出力と矛盾する場合は「あり」へ倒す（fail-safe）。
- **根拠 [evidence_source: existing_code]**: `github_issue` の declined パターンを踏襲。frontmatter を必須化すると全 issue（バックエンドのみ含む）に記入を強制し過剰適用・後方互換破壊となる。任意＋skill レベルの判定記録なら、過剰適用回避と silent skip 防止（アドバイザー助言）を両立できる。
- **帰結**: 00_要求定義.md テンプレートに任意 1 項目が増える。判定の実施責任は「値なし→frame-experience step 1」「明示なし値→設計フェーズ最初の委譲サブの転記・検証」に定まり、いずれの経路でも 02_設計.md §7.0 に記録が残る。

### ADR-EXP-4: 新規 enforcement（audit.sh チェック）を追加せず、既存 review-docs ゲート＋DUAL_LENS に相乗りする（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: META_LAYER Rule 3 は「enforcement を伴わないルール追加」を禁じる。一方で新規 audit チェックの追加は基盤肥大・機械強制の複雑化を招く。
- **検討した選択肢**: (a) 新規 audit.sh チェック（体験観点欠落を機械検知）。(b) 既存 review-docs ゲート（implement 前の必須ゲート・full/standard 一律必須）と DUAL_LENS（review-docs も対象と明記されている）に「体験観点の有無確認」を相乗りさせる。
- **決定**: (b)。review-docs.md の確認観点に「体験面=あり の issue は 02_設計.md §7 に体験設計観点が記載されているか」を 1 項追加する。新規 audit.sh チェックは追加しない。
- **根拠 [evidence_source: existing_code]**: 体験観点は静的機械監査になじまない（ナラティブの質は機械判定不能。アドバイザー助言の「幻覚ペルソナ」「チェックボックス化」リスク）。既存の実装前必須ゲート＝review-docs は既に横断的に発動しており、そこに人手＋DUAL_LENS で確認させる方が実効的。既存の review-docs ゲート構造を観察した上で、本件は「既存 enforcement（review-docs ゲート）を利用する」ため META_LAYER Rule 3 の「enforcement を伴わないルール」には該当しないと判断した。
- **帰結**: 機械検知は追加されない。実効性は review-docs レビュアーの観点＋DUAL_LENS に依存する（限界として明記）。

### ADR-EXP-5: 成果物ファイルを増やさず、既存 02_設計.md §7 を拡張して体験設計を吸収する（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: アドバイザー助言「`05_UX設計.md` 等の新規ファイルは避け既存 00〜02 のセクション吸収が望ましい」。
- **検討した選択肢**: (a) 新規成果物 `05_UX設計.md`。(b) 既存の 02_設計.md テンプレート §7「UI 設計」を「UI/UX・体験設計」へ拡張。
- **決定**: (b)。02_設計.md テンプレートの §7 を拡張し、7.0 体験サーフェス判定・7.1 フェーズ1（体験の前提）・7.2 フェーズ2（体験の流れ）・7.3 フェーズ3（体験の具体化）・7.4 幻覚ペルソナ注意 を 3 フェーズ対応の受け皿とする（既存 7.1 画面遷移図・7.2 画面設計 は 7.5 以降へ再配置）。
- **根拠 [evidence_source: human_decision]**: META_LAYER Rule 1（新規文書追加前の統合検討）。成果物ファイル増殖は追跡・監査コストを増やす。既存 §7 は元々「UI 設計」で体験設計と親和性が高い。アドバイザー助言を採用した人間側（設計担当）の判断。
- **帰結**: 新規成果物ファイルは 0。02_設計.md テンプレートの §7 見出しが変わる（後方互換: 既存 issue の 02_設計.md は §7 を持つため破壊しない）。

### ADR-EXP-6: 基盤修正ファイル数が META_LAYER 目安（≤2）を超えることの明示（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: META_LAYER の監視指標「1 issue あたり基盤修正ファイル数 ≤ 2（目安）」。本件は新規 7 ファイル（domain README 1 ＋ 3 フェーズ capability × README/SKILL 各 2）＋改修 8 ファイル（command 3〈design-feature / requirement-discovery / review-docs〉・テンプレート 2〈00/02〉・索引/必須条件 2〈workflow/TEMPLATES.md / workflow/SKILL_MANDATORY.md〉・source/README 1）＝計 15 ファイルを触る（ADR-EXP-7 のフェーズ分割で新規ファイルが増える）。
- **検討した選択肢**: (a) 目安に収めるため機能を削る。(b) 目安超過を許容し、各ファイルの変更を最小に保つ。
- **決定**: (b)。ただし、(1) フェーズ capability を 3 に絞る（11 工程を丸写ししない・ADR-EXP-7）、(2) 新規 command を作らず既存 design-feature に相乗り、(3) 新規 audit を作らない、(4) 新規成果物ファイルを作らない、(5) 既存 §7 を拡張、(6) requirement-discovery は注記のみ、という 6 つの簡素化で touch ファイルあたりの変更を最小化する。
- **根拠 [evidence_source: existing_code]**: META_LAYER の指標は「目安」であり「超えた場合、基盤の簡素化を検討する」と定める。既存の META_LAYER 指標定義を踏まえ、本件は「新しい役割（デザイナー視点＝デザインチーム）を CORE に組み込む」という性質上、フェーズ分担（fresh サブ per phase）を成立させるには複数の capability（＝複数ステップ）が不可欠であり（ADR-EXP-7）、単一ファイルには収まらない。指標超過を隠さず明記し、上記 6 簡素化で正当化する。
- **帰結**: 目安超過を許容。ただし実装 PR は最小 diff を維持し、review-docs で肥大化チェックを受ける。

### ADR-EXP-7: 体験設計を 3 フェーズに分割し、各フェーズを都度 fresh サブへ委譲する（単一 capability 一気通貫の否定）（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: プロジェクトオーナーが design-feature 完了後に追加要望を提示した。要旨:「デザイナー」を Claude Code の Skill ではなく AI 社員の職務定義（Job Description）として設計し、Web デザインの一連の業務フロー（要件受領 → ビジネス理解 → ユーザー分析 → 競合調査 → 情報設計 → UX 設計 → ワイヤーフレーム → UI → デザインシステム → アクセシビリティ → 実装レビュー → デザインレビュー）を、1 人の AI が一気通貫でこなすのではなく、役割を分担したデザインチームとして、フェーズごとに新規サブエージェント（別のデザイナー）へ引き継ぐべき、というもの。従前の設計は体験設計を単一 capability `map-experience`（＝単一ステップ）に畳み込んでいたが、本フレームワークの標準運用では進行役（orchestrator）は command 単位で委譲し、委譲を受けた 1 サブ（worker）が commands/{name}.md の skill chain を順に実行する。委譲を分割できるのは step（skill）境界のみであり、1 つの capability の内部フェーズを進行役が分割委譲する経路は存在しない。したがって単一 capability では体験設計全工程が 1 サブの一気通貫になり、ユーザー要望と矛盾する。
- **検討した選択肢**: (a) `map-experience` を単一 capability に維持し、SKILL.md 内で「各フェーズを fresh サブへ委譲せよ」と記す。→ 却下（capability 内部の工程は委譲境界にならず、単一ステップは単一サブに帰結しフレームワーク非整合）。(b) `experience` を独立 command（例 `design-experience`）に切り出し、複数 skill の chain として各ステップを fresh サブへ委譲する。→ PHASE_COMMAND_MAP（phase→command の決定的単一正本）の改変・02_設計.md の所有権の再整理が必要でコア routing への侵襲が大きい。(c) (b) の実行モデル（複数ステップ・各ステップ fresh サブ）を採りつつ、独立 command を新設せず、既存 design-feature chain 冒頭の条件付き複数ステップとして実現する。→ PHASE_COMMAND_MAP・02_設計.md 所有権は不変。
- **決定**: (c)。体験設計を 3 フェーズ（`frame-experience`〈ビジネス目的＋ユーザー/課題〉→ `map-experience`〈IA＋UXフロー〉→ `detail-experience`〈UI＋デザインシステム＋アクセシビリティ＋実装可能性〉）に分割し、design-feature chain の step 0a/0b/0c として差す。各ステップは orchestrator が都度 fresh サブへ委譲する。ユーザーの「役割分担したデザインチーム」は、フェーズごとに役割の異なる fresh サブ（＝別デザイナー）が担当する構造として実現する。委譲手順（design-feature.md 実行時の注意に明文化）: 体験面=あり の場合、進行役は design-feature の委譲を「step 0a」「step 0b」「step 0c」「残り chain（step 1〜3）」の単位に分割し、既存 run_command の委譲 I/F（Task/Constraints/OutputSpec）で個別に委譲する。各委譲パケットには (1) Task（担当 step と成果物・参照・前フェーズの確定出力）、(2) Constraints（却下済み指摘＋理由・must-preserve リスト・選定ティア/effort の明記）、(3) OutputSpec（当該フェーズの Done）を含める。規模比例で統合する場合は統合対象の工程群を 1 委譲に畳んでよい。11 工程は丸写しせず 3 フェーズへ統合する（要件受領〜競合調査 → frame、情報設計〜ワイヤーフレーム → map、UI〜アクセシビリティ → detail）。「実装レビュー・デザインレビュー・成果物提出」は既存の review-docs（実装前）／verify-and-close（実装後 04_review）が担い、experience に専用フェーズを新設しない。
- **根拠 [evidence_source: human_decision]**: プロジェクトオーナーの最重要指定。加えて `[evidence_source: existing_code]`（CLOSEOUT.md §fresh サブ分割 の継承前提・委譲 I/F run_command）— ただし既存の fresh サブ分割義務（発火するのは phase 遷移時・レビュー↔修正反復であり command 内の step 単位では自動発火しない）の自動発火ではなく、同原則を体験フェーズ境界へ拡張適用する新たな運用規定を design-feature.md（コア）に明文化する変更である（発火点の追加。CLOSEOUT.md 自体・project 側の発火一覧は改変しない）。3 フェーズ強制による過剰適用リスクを避けるため、`experience_surface: no` は 3 フェーズとも非発動、体験サーフェスが小さい場合は orchestrator の裁量でフェーズを統合してよく最小 1 サブまで畳んでよい（規模比例）。
- **帰結**: experience domain の capability が 1 → 3 に増える（ADR-EXP-6 のファイル数に反映）。design-feature chain が step 0a/0b/0c を持つ。アドバイザーの「skill は 2 つまで／1 capability に絞る」提言は、それより後に届いたユーザーの fresh サブ分割要望が優先し 3 フェーズへ更新した。

### ADR-EXP-8: detail-experience は「新規作成」より「既存デザイン資産の再利用」を優先する（探索順序と新規作成正当化条件の明文化）（2026-07-17・issue: GitHub Issue #127（デザイナー視点組込・close済み））

- **コンテキスト**: プロジェクトオーナーが design-feature 完了・review-docs 1 回目完了後に追加インプットを提示した。要旨:「Web デザイナー」の設計行為では Atomic Design のような部品分解の名称だけでは統一性を保てず、実務でありがちな失敗（Container が Atom か Template か曖昧・レイアウトがページごとにバラつく・コンポーネントが肥大化する等）が起きる。そこで責務で階層分けした構成（例: Design Tokens → UI Primitives → UI Components → Layout Components → Patterns/Sections → Page Templates → Pages の 7 層）と、AI（デザイナー役）に「新しい画面をデザインする能力」より先に「既存デザインシステムを読み取り・再利用し・必要最小限だけ拡張する能力」を持たせることが最重要と指摘された。従前の detail-experience（ADR-EXP-7）は UI/ビジュアル・デザインシステム適用・アクセシビリティ・実装可能性を扱うが、「新規 UI 要素をいきなり作らせない／既存資産を優先探索する」という決定順序と新規作成が正当化される条件が Process/Done に明文化されていなかった。
- **検討した選択肢**: (a) プロジェクトオーナー提示の具体例（React/Figma/Storybook 前提のディレクトリ構成・TypeScript コード例・7 層の固定名称）を CORE 成果物にそのままコピーして強制する。→ 却下。本フレームワーク（`.agent-skill-chain/source/`）は特定技術スタック非依存な汎用ワークフロー定義であり、特定の階層名・ディレクトリ構成を CORE にハードコードすると対象外スタックの消費者に不要な制約を課す（META_LAYER Feature First・過剰適用回避）。(b) 技術スタックに依存しない汎用原則のみを抽出して detail-experience に組み込み、具体的な階層名は「消費者プロジェクトが持つ既存の階層・デザインシステム命名を最優先で使い、無ければ一般化した考え方を参考にする」柔軟な形にする。→ 採用。
- **決定**: (b)。detail-experience に次の技術非依存な汎用原則を組み込む: 1) 既存資産の再利用探索順序（新規作成の前に必ず実施）: ①既存のページテンプレート相当 → ②既存のパターン／セクション相当 → ③既存のコンポーネント相当 → ④既存のレイアウト相当の組み合わせ → ⑤既存のプリミティブ相当 → ⑥それでも不足する場合のみ新規作成。2) 新規作成が正当化される条件（すべて満たすことが望ましい）: 複数箇所での再利用が見込まれる／責務が明確／既存の組み合わせで表現できない／バリアントが明示されている／アクセシビリティ要件が文書化されている／レスポンシブ挙動が文書化されている。3) 4 原則（detail-experience の判断基準）: (i) 基礎値（トークン相当）を自由に増やさない、(ii) レイアウトを個別成果物に直接埋め込まない、(iii) 既存資産を先に探索する、(iv) 新規作成条件を明文化する。4) 階層の考え方（参考・強制しない）: 一般化した多層構造（基礎値 → 最小部品 → 複合部品 → レイアウト → パターン → テンプレート → 個別成果物）は参考情報として示すに留める。消費者プロジェクトが独自の階層・デザインシステム命名を持つ場合はそれを最優先で使う。CORE は特定フレームワーク・特定ディレクトリ構成・特定の階層名を強制しない。判断基準優先順位（§2.1.4）は、プロジェクトオーナー提示のレビュー優先順位（ビジネス目標→ユーザータスク→情報階層→アクセシビリティ→デザインシステム一貫性→レスポンシブ→保守性→ビジュアル洗練度）を統合・精緻化したもの（旧 6 段を 8 段へ細分・矛盾なし）であり、「デザインシステムの一貫性」を明示順位に組み込むことで本 ADR の再利用優先原則と価値観を共有する。
- **根拠 [evidence_source: human_decision]**: プロジェクトオーナーの追加インプット。META_LAYER Feature First・過剰適用回避（技術非依存性を壊さない）に整合。ADR-EXP-4/ADR-EXP-5 と整合（新規 audit・新規成果物ファイルを増やさず、detail-experience の既存契約 Process/Done と 02_設計.md §7.3 受け皿への追記のみで吸収する）。
- **帰結**: 新規ファイル・新規 command・新規 audit は増えない（detail-experience の既存契約 Process/Done と 02_設計.md §7.3 テンプレートへの追記のみ）。detail-experience は「新規 UI を作る役」から「既存を読み取り最小拡張する役」へ責務の重心が移る。特定技術スタックは CORE に固定しない。

### ADR-EXPPR128-1: グループ C — design-feature chain の PROCESS 実行条件を「null（未記入）または yes」へ改める（2026-07-17・issue: PR#128指摘対応（親: GitHub Issue #127配下のサブissue））

- **コンテキスト**: `commands/design-feature.md` の INPUT（L25）は「`experience_surface` 未記入の場合は frame-experience が判定する」とするが、PROCESS（L31/33/35）は 0a/0b/0c いずれも「体験サーフェス=あり のときのみ」という条件文で、文字どおり適用すると `experience_surface: null` の issue は 0a（frame-experience）自体が起動されず、INPUT の約束が果たされない（chain 中核の制御フロー矛盾。PR#128 レビュー指摘 finding-2, 7, 14 の根本原因）。
- **検討した選択肢**: (a) PROCESS 0a の実行条件を「`experience_surface` が `null`（未記入）または `"yes: ..."` の場合に 0a を実行し、0a の判定結果（あり/なし）に応じて 0b/0c の要否を決める。`"no: ..."` は 0a〜0c をスキップ」へ変更する。(b) INPUT 側を「`experience_surface=あり` のときのみ frame-experience が起動」へ書き換え、PROCESS に合わせる。(c) 未記入検出用の新規 audit/enforcement を追加してスキップを検知する。
- **決定**: (a)。
- **根拠 [evidence_source: existing_code]**: (b) は「未記入時は frame-experience が判定する」という fail-safe 設計（親issue 02_設計.md ADR-EXP-3・過剰スキップ回避）を捨てることになり後退。(c) は「新規 audit 追加禁止」（本サブ issue 01/00 の制約）に反する。(a) のみが INPUT の意図（未記入→frame-experience が判定）と PROCESS を無矛盾にし、既存の「`no:`＝トリガー非該当の正常系」「0b/0c は 0a の判定結果に従う」という設計を保存する。`design-feature.md` L25/31-35・`skills/experience/README.md` L17 発動条件・親issue 02_設計.md §3.1.4/§3.2.2 を実ファイル確認した上での判断。
- **帰結**: `commands/design-feature.md` PROCESS・`workflow/SKILL_MANDATORY.md` L13・`workflow/TEMPLATES.md` L27・親issue 02_設計.md §3.2.2 の 4 箇所を同じ条件表現へ揃える。挙動が実際に変わるのは `experience_surface: null` の issue のみ（0a が起動するようになる）。既に `"yes:"`／`"no:"` が明記された issue の挙動・DONE の 2 条件分岐（あり/なし）の意味・step1-3 の順序・委譲粒度（親issue ADR-EXP-7）・規模比例統合は不変。`commands/run_command.md`・`CLOSEOUT.md` は触らない。

### ADR-EXPPR128-2: グループ B — 新規 UI 作成条件の必須レベルの統一先を「満たす場合に限る」（必須）とする（2026-07-17・issue: PR#128指摘対応（親: GitHub Issue #127配下のサブissue））

- **コンテキスト**: 「新規 UI 作成が正当化される条件」の必須レベルが 3 ファイルで不統一（PR#128 レビュー指摘 finding-4, 6）。`skills/experience/detail-experience/README.md`（L21 手順7・L38）は「すべて満たすことが望ましく／望ましい」（努力目標）、`skills/experience/README.md`（L42）は「満たす場合に限る」（必須）、`runtime/templates/02_設計.md` テンプレート §7.3（L305）は「満たすことを明記」（必須度が曖昧）。
- **検討した選択肢**: (a) 最も厳格な「満たす場合に限る」（必須）へ揃える。(b) 最も緩い「望ましい」（努力目標）へ揃える。
- **決定**: (a)。
- **根拠 [evidence_source: existing_code]**: `skills/experience/README.md`（判断基準の domain 正本）が既に採用している「満たす場合に限る」を基準に揃えるのが、既存の再利用優先原則（新規作成を抑制する。親issue ADR-EXP-8）と整合し、二重定義を生まない。(b) は新規 UI 濫造の抑止を弱めるため後退。3 ファイルを実ファイル確認し、誤帰属注記どおり `detail-experience/SKILL.md` には「望ましい」表記が無く `README.md` 側（L21/L38）にあることを確認した上での判断。
- **帰結**: 是正対象は `skills/experience/detail-experience/README.md`（L21 手順7・L38）・`skills/experience/README.md`（既に必須表現のため原則無変更・用語の一致確認のみ）・`runtime/templates/02_設計.md` テンプレート §7.3（L305）。`detail-experience/SKILL.md` へは誤って新規追記しない。条件 6 項目の内容自体は変更しない。

### ADR-EXPPR128-3: グループ E — review-docs の体験観点確認を各フェーズ必須項目の個別充足へ強化する（2026-07-17・issue: PR#128指摘対応（親: GitHub Issue #127配下のサブissue））

- **コンテキスト**: `commands/review-docs.md` Process 1.1（L27）の体験観点確認は「02_設計.md §7 に体験設計観点が記載されているか」という §7 の存在確認にとどまり、§7 が存在しさえすれば通過する形骸化の余地があった（PR#128 レビュー指摘 finding-13。グループ A・D と同族の「§7 完全性が検証層で完結していない」テーマ）。
- **検討した選択肢**: (a) `commands/review-docs.md` 本体の確認観点を §7.1/§7.2/§7.3 各フェーズの必須項目の個別充足確認へ書き換える。(b) 新規 audit を追加して各項目の存在を機械検査する。
- **決定**: (a)。
- **根拠 [evidence_source: existing_code]**: (b) は新規 audit 追加禁止に反する。(a) は既存 review-docs ゲート（DUAL_LENS 相乗り）の枠内で確認観点を精緻化するのみで、後方互換（体験面=なしを差し戻さない・親issue ADR-EXP-3 形骸化防止）を保つ。`commands/review-docs.md` L27・各フェーズ Done を frame/map/detail の SKILL.md と `runtime/templates/02_設計.md` テンプレート §7.1-7.3 で確認した上での判断。
- **帰結**: 是正対象は `commands/review-docs.md` L27 と親issue 02_設計.md §3.3（L349 の review-docs 記述）。他の確認観点（DUAL_LENS 敵対的観点・must-preserve・memo 記録・書記委譲）は不変。

### ADR-EXPPR128-4: finding-8 の是正範囲 — 変更対象スコープ記述を §4.1 を主対象として横断整合する（2026-07-17・issue: PR#128指摘対応（親: GitHub Issue #127配下のサブissue））

- **コンテキスト**: 親issue `00_要求定義.md` §4.1（L161）の「変更対象は `.agent-skill-chain/source/`」が、実際の変更範囲（`source/` ＋ `runtime/templates/`）と不一致（PR#128 レビュー指摘 finding-8）。同型の「変更対象＝source/ 限定」記述が 00 の他所・01・03 にも点在する。
- **検討した選択肢**: (a) §4.1 のみ修正する。(b) §4.1 を主対象としつつ、同じ「変更対象スコープ」を主張する箇所（00 L91/L191・01 L94/L196/L237・03 L25 実装方針文・03 L51 のリスト見出し）も同一規則で整合する。
- **決定**: (b)。
- **根拠 [evidence_source: existing_code]**: サブ issue 01_要件定義.md の finding-8 受け入れ基準が「00/01/03 に同種の記述があれば同様に是正対象として確認する」を明記。§4.1 だけ直すと同一ファイル・関連ファイル内に不整合が残り、finding-8 の趣旨（読み手が誤った制約を前提にしない）を満たさない。ただし CORE の概念定義（「`source/` は配布パッケージ正本＝CORE である」という事実記述）は正しいため変更しない。修正するのは「変更対象（スコープ）が source/ に限られる」と読める記述に限る。grep で 00/01/03 の全該当箇所を列挙し、03 L25 の実装方針文「`.agent-skill-chain/source/` 配下の新規 7 ファイル・改修 8 ファイル」と 03 L51 のリスト見出しはいずれも「source/ 配下」と称するが、ファイル表の項目 10-11 が `runtime/templates/` を含むため不正確であることを確認した上での判断。
- **帰結**: 該当各箇所へ「`.agent-skill-chain/source/`（配布パッケージ正本＝CORE）および `.agent-skill-chain/runtime/templates/`（テンプレート正本）」相当の表現を反映。制約の趣旨（全消費者へ届く／project 限定でない）は維持する。

### ADR-132-1: workflow.db の worktree 横断集約（`git-common-dir` 固定 + sentinel ガード）（2026-07-17・issue: GitHub Issue #132）

- **コンテキスト**: `write-workflow-log.sh:17` は `PROJECT_ROOT="${PROJECT_ROOT:-.}"`（CWD 基準）で DB パスを解決するため、サブエージェントが git worktree 内（CWD=worktree）で書記を実行すると DB が `<worktree>/.agent-skill-chain/runtime/workflow.db` を指す。`workflow.db` は `.gitignore` 対象＝worktree 間で非共有のため、記録が main ツリーの canonical DB に載らず、`git worktree remove` で失われる。本日（2026-07-17）2 issue・計 7 フェーズ分の記録が欠落し、`audit.sh` が「実装前に 04_review（implement/verify ログ 0 件）」の誤 FAIL を出した。
- **検討した選択肢**: (a) `PROJECT_ROOT` 未指定時に `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` で main root へ固定。(b) 委譲時に進行役が `PROJECT_ROOT` を main 絶対パスへ明示指定する運用徹底。(a) には consumer モノレポ回帰リスク（`.agent-skill-chain/` が git サブディレクトリにある環境で別 root へ DB を新規作成しうる）と bare/非標準 GIT_DIR caveat がある。
- **決定**: (a) を採用。ただし**「解決先 root 直下に `.agent-skill-chain/` が実在する場合のみ git 解決を採用し、非該当・`git rev-parse` 失敗時は従来の `.`（CWD 基準）へ fail-safe フォールバックする」sentinel ガードを必須付帯**とする。DB パス解決は**共有ヘルパ 1 箇所へ集約**し、`write-workflow-log.sh`（env 経由）と `audit.sh`（位置引数経由）の呼び出し規約差をヘルパ引数化で吸収して read/write を同一 canonical DB に揃える。`PROJECT_ROOT` 明示指定は最優先で尊重（後方互換）。(b) は恒常運用要件にはせず、(a) deploy までの移行期の補助と明示上書き経路に限定する（サブの自己申告依存で再発するため）。
- **根拠 [evidence_source: observed_runtime]**: git 2.43.0 で `git rev-parse --path-format=absolute --git-common-dir` は main ツリー・worktree いずれからも同一 main `.git` を返し、`dirname` が main root（`/home/adachi/projects/AGENTS.md`）を返すことを両ツリーで独立再現。tmp 隔離 4 ケース（標準+worktree＝canonical 集約／モノレポ＝sentinel 不在で CWD フォールバック＝回帰なし／非 git＝`.`／明示 hint＝尊重）で sentinel ガードが SC-1（集約）と SC-4（回帰なし）を両立することを実測。sentinel ガードは bare/非標準 GIT_DIR で `dirname` が誤 root を返しても `.agent-skill-chain/` 不在によりフォールバックするため誤 DB 新規作成を防ぐ。`--path-format` は git 2.31+ 必要だが旧 git は `git rev-parse` 失敗で `.` フォールバックへ落ち実害なし。
- **帰結**: worktree 内書記が main root の単一 canonical DB を指し、SC-1/SC-2 を満たす。worktree 内に DB 実体が生成されないため `git worktree remove` での DB 記録喪失（問題2 の DB 部分）が問題1 修正で自動的に閉じる。実装対象は `write-workflow-log.sh:17` と `audit.sh` の `WF_DB` 導出（走査用 `PROJECT_ROOT="${1:-.}"` は不変・DB パス導出のみ差し替え）。配布物（`.agent-skill-chain/source/`）であり consumer 非回帰を tmp 隔離で検証する。過去に失われた記録の遡及復元・スキーマ変更は対象外（別 issue）。

### ADR-132-2: gitignore 成果物の worktree 削除消失対策（DECISIONS.md 転記主軸 + 削除前確認 + enforce 発火は委譲）（2026-07-17・issue: GitHub Issue #132）

- **コンテキスト**: `git worktree remove`（`--force`）は **未追跡かつ `.gitignore` に一致するファイル**を安全チェック対象外として無警告で削除するため、そうした成果物は完全消失する（未コミットゆえ git object にも残らず復元不能）。一方**追跡済みファイルは `.gitignore` パターンに一致していても git 履歴に残り復元可能**であり、本リスクが当てはまるのは **「未追跡かつ ignored」な成果物に限定される**。本日 S-2 の 04_review.md（設計判断で意図的に非追跡＝未追跡かつ ignored）とレビュー memo 複数が worktree 削除で失われた。退避機構 `worktree_untracked_rescue`（PreToolUse.sh:478）は untracked/ignored 双方を `.claude/.worktree-trash/` へ copy 保全する設計で R8（968行）に配線済みだが、`.claude/settings.json` に `hooks` が無い（enforce off）ため実機で一度も発火していないことが真因。退避ロジック本体は既存 issue `20260716_013937_worktree運用規律` の SC-3 の責務（本 issue では再実装しない）。
- **検討した選択肢**: (c) 削除前に `git status --ignored` / `git clean -ndX` で ignored 成果物を確認する運用ルール化。(d) 04_review 等の恒久判断は常に追跡・commit する設計変更（github_native の「ドラフト非追跡」思想と衝突するため追跡対象の線引き再定義が必要）。(e) 既存退避機構を確実に発火させる（enforce 再有効化 or enforce 非依存の独立発火）。enforce 再有効化は 2026-07-15 のロックアウト事故（PreToolUse が Agent ツール名未対応で進行役を完全ロックアウト、復旧は `!` 付き `enforce off`）の再来リスクを持つ。
- **決定**: **(d) を主軸**とし、追跡対象を「起票前・作業中ドラフト（00〜04 draft）＝ transient・非追跡（S-2 ADR-S2-4 の思想維持）」と「完了済みの恒久判断＝ 追跡ファイル `DECISIONS.md` へ verify-and-close で転記完了」に線引きする。worktree 削除前に恒久判断が DECISIONS.md（追跡）に載っていることを完了要件として担保すれば、transient な 04_review draft が失われても恒久情報は失われない（S-2 設計と非衝突で問題2 を解消）。local_tracked モードの consumer では 04_review 自体が追跡・commit されるため喪失しない。**(c) を即時運用ガード**（enforce off の現状で今日から有効な削除前 `git status --ignored` 確認）として併用。**(e)（enforce 再有効化による退避発火）は本 issue では実施せず、安全策を明文化して別 issue／人間判断へ委譲**する。
- **根拠 [evidence_source: existing_code + observed_runtime + human_decision]**: existing_code＝PreToolUse.sh の退避機構が `git status --porcelain=v1 -z --ignored=matching` で ignored も収集し `cp -a` 保全する非 block 設計・R8 配線を実読確認。observed_runtime＝`.claude/settings.json` に `hooks` 無し（`grep -c hooks`=0）で退避機構が不発である現状を確認。human_decision＝enforce 再有効化リスクの根拠はユーザーメモリ `feedback_enforce-on-lockout-incident`（2026-07-15 事故）。(d) は機構（hook 発火）非依存で恒久記録を保証するため (e) はクリティカルパスではなく belt-and-suspenders に留まる。
- **帰結**: 問題2 の恒久記録保全は「恒久判断の DECISIONS.md 転記完了 + 削除前 ignored 確認」で機構非依存に達成する。将来 enforce を再有効化して退避機構を実機発火させる場合の**安全策要件**を残す：①退避は決して block しない事実を活用し reject しうる全ルールを一括有効化しない、②Agent 等 orchestrator 委譲ツールの通過保証を先に確立（2026-07-15 の根本原因修正）、③`!` 付き `enforce off` の緊急解除手段確保・tmp 隔離での先行検証、④発火対象を削除形コマンドに限定。この (e) 安全策の実施・退避ロジック本体・enforce 再有効化・settings.json への hooks 配線は本 issue スコープ外（既存 `20260716_013937` 系／別 issue／人間判断へ申し送り）。

### ADR-137-1: close 移動を「整理整頓目的」と再定義し github_native でも復活させる（ADR-S2-toggle/ADR-S2-5 の該当部を上書き）（2026-07-17・issue: GitHub Issue #137）

- **コンテキスト**: S-2（親 GitHub Issue #115）は close 移動を「tracking の手段」と捉え、github_native では GitHub Issue の close で完結するため close 移動不要と判断した（ADR-S2-toggle 帰結・ADR-S2-5 コンテキスト・正本 4 文書に明記）。しかしプロジェクトオーナーから「close 移動は tracking ではなくローカル整理整頓（active/completed の分離）であり tracking モードに依らず必要。そうなっていないならバグ」との指摘があった。実測でも CLOSED 済み 4 件（#115/#119/#127/#132）が `docs/maintainer/workflow/` 直下に残留している。
- **検討した選択肢**: (A) close 移動の目的を「整理整頓」と再定義し両モードで実行する。(B) S-2 の判断を維持し github_native では close 移動しない（現状）。(C) github_native 専用に close/ とは別の「アーカイブ」概念を新設する。
- **決定**: (A)。close 移動の目的を「ローカル整理整頓（`docs/maintainer/workflow/` 直下を active issue のみに保つ）」と正本で再定義し、github_native でも実行する。
- **根拠 [evidence_source: human_decision]**: プロジェクトオーナーの明示指摘（本 issue 要件 §6・「完了と同時に close へ移動させるべき。ルールがそうなっていないならバグ」）。(B) はオーナー要求と矛盾し残留を放置する。(C) は close/ という既存の完了分離概念があるのに二重概念を持ち込み単一責務・可読性を損なう（spec/06）。
- **帰結**: CORE.md/PHASES.md/run_command.md/project 自己拡張ワークフロー.md の「close 移動は local_tracked 専用／github_native では不要」の記述を上書きし、両モードで close 移動を行う。**ADR-S2-toggle・ADR-S2-5 の「close 移動を行わない」に相当する該当部は本 ADR で上書きされる**（旧エントリ本文は改変せず履歴として残す）。トリガー・実行主体・実行場所・監査は ADR-137-2〜137-4 で確定する。

### ADR-137-2: トリガー＝GitHub Issue close（人間関与点）、実行主体＝進行役、実行場所＝メインツリー（2026-07-17・issue: GitHub Issue #137）

- **コンテキスト**: PHASES.md は close 移動の最終確定を「人間関与点」で経ることを要求する（local_tracked では PR マージ）。github_native の非追跡ドラフトは git diff に乗らず PR 経由確定が字義どおり成立しない。加えて非追跡ドラフトはメインツリーにのみ実体があり worktree の `git mv`/`mv` は空振りする（#132 の workflow.db 問題と同型）。本日の実例（#115/#119/#127/#132）は verify-and-close 完了と GitHub Issue close のタイミングが必ずしも一致せず、#115 は PR 群マージ後にユーザーが手動で close 確認した。
- **検討した選択肢**: (a) verify-and-close 完了時点で即座に close 移動まで一括実行する。(b) GitHub Issue が close したローカルディレクトリを移動する（人間関与点＝GitHub Issue close をトリガーにする）。(c) 進行役が手動判断で都度移動する（トリガー規定なし）。
- **決定**: (b)。**GitHub Issue の close を github_native における人間関与点（＝local_tracked の PR マージに相当）とし、これをトリガー兼確定点とする**。実行主体は**進行役**（承認の直接性を持ち、メインツリーを操作する立場）。実行場所は**メインツリー**（非追跡ドラフトが実在する唯一の場所）。進行役は完了検知後に着手（リンク補正等）してよいが、最終確定は GitHub Issue close を経る。
- **根拠 [evidence_source: human_decision + existing_code]**: human_decision＝実例（#115 は close タイミングが verify-and-close と乖離）とオーナー指摘「close 移動はメインのディレクトリで対応する必要がある（workflow.db をメインで更新するのと同じ理由）」。existing_code＝PHASES.md「最終確定は必ず人間関与点を経る」の既存原則を github_native に写像（PR マージ→GitHub Issue close）。(a) は close タイミング乖離の実例に反し早期移動してしまう。(c) は silent skip（放置）を招く。サブエージェントはメインツリー直接変更禁止（CLAUDE.md）かつ非追跡ドラフトを worktree から見られないため、実行主体は進行役に限定される。
- **帰結**: github_native の close 移動フローが「GitHub Issue close（人間関与点）→ 進行役がメインツリーで移動」と確定する。「PR 経由確定」は非追跡ドラフトには適用されない旨を正本へ明記する。project 自己拡張ワークフロー.md §実行確定の 2 分岐 に github_native 分岐（分岐 C）を追加する。

### ADR-137-3: 追跡/非追跡混在をファイル単位で扱うヘルパースクリプト `close-move-issue.sh` を新設する（2026-07-17・issue: GitHub Issue #137）

- **コンテキスト**: 遡及 4 件は追跡状態が混在する。`git ls-files` の実測で #119/#127 は全追跡、#132 は全非追跡、**#115 は同一ディレクトリ内で追跡と非追跡が混在する**。#115 はトップレベル 00〜04 を持たない親ワークフローディレクトリであり、直下は `90_issues.md`（追跡）と `90_issues/`（3 サブ issue）のみで、17 ファイル中 16 が追跡・**唯一の非追跡は `90_issues/20260716_174958_S-2本リポgithub_native採用/04_review.md` の 1 件**。追跡ファイルへ `mv` すると git 履歴上の move を失い、非追跡ファイルへ `git mv` すると失敗するため、ファイル単位の判定が要る。今後の github_native issue も 00〜04・04_review 非追跡＋tests 等追跡が混在しうる。
- **検討した選択肢**: (A) ファイル単位で追跡状態を判定し追跡=`git mv`／非追跡=`mv` を使い分ける軽量ヘルパースクリプトを新設する。(B) 手順書のみ（人手で使い分け）。(C) ディレクトリ一括 `git mv`（非追跡ファイルが取り残される／エラーになる）。
- **決定**: (A)。単一 issue ディレクトリを受け取り、配下ファイルを追跡状態でファイル単位に使い分けて `close/<issue>/` へ移動する `close-move-issue.sh` を `.agent-skill-chain/source/scripts/` へ新設する。メインツリー外実行・既存 close/ 衝突はガードで拒否する。リンク補正・完了判断・GitHub 操作は含まない（呼び出し側責務・単一責務）。
- **根拠 [evidence_source: observed_runtime]**: `git ls-files` によるファイル別の追跡状態を実測（#115=16/17 追跡・唯一の非追跡は S-2 サブ issue の 04_review.md、#119=13/13 追跡、#127=10/10 追跡、#132=0/4 追跡）。混在はディレクトリ内でも発生するため (B)(C) では取り違え・履歴喪失リスクが残る。ファイル単位の機械判定でメインツリーに実在する非追跡ドラフトの取りこぼしと追跡ファイルの履歴喪失を同時に防ぐ。
- **帰結**: 混在ケースを含む close 移動が機械的に正しく実行される。スクリプトは追加物・opt-in であり既定挙動を変えない（消費者は呼ばない＝非波及）。**スクリプトの守備範囲は「非追跡ドラフト（メインツリーにのみ実在）を含むディレクトリを、メインツリーで移動する」機械部分に限定**し、追跡ファイルの close 移動を PR で確定する経路（feature branch→PR→マージ・direct push 禁止）は呼び出し側（進行役）の worktree+PR フローが担う。

### ADR-137-4: audit #33 の github_native 一括 SKIP を撤廃し、FS/DB 走査による未移動検知を両モードで有効化する（gh 依存は採らない）（2026-07-17・issue: GitHub Issue #137）

- **コンテキスト**: 現状 #33（`check_close_move_pending`）は冒頭で実効モード github_native なら丸ごと SKIP する（「close 移動運用は廃止済み」前提）。ADR-137-1 で close 移動を両モード必要と再定義したため、この SKIP は矛盾する。一方 github_native の完了ドラフト（04_review.md 含む）は非追跡であり、CI（`actions/checkout`）は追跡ファイルのみ展開するため CI では走査対象が不在になる。GitHub Issue の CLOSED 状態を厳密トリガーにするには `gh` CLI（ネットワーク・認証依存）が必要になる。
- **検討した選択肢**: (A) github_native 一括 SKIP を撤廃し、既存の「verify-and-close 証跡＋猶予超過」FS/DB 走査ロジックを両モードで用いる（`gh` 非依存・決定論的・ローカル主体）。(B) SKIP を維持（現状・ADR-137-1 と矛盾）。(C) #33 を `gh issue view` で GitHub Issue CLOSED 状態を判定する形へ作り替える。
- **決定**: (A)。#33 冒頭の `resolve_issue_tracking_mode == github_native` 早期 return SKIP ブロックを撤廃する。関数本体の走査・grandfather（既定 20260712）・猶予（`CLOSE_MOVE_GRACE_DAYS` 既定 3）・FAIL メッセージ・`*/close/*` 除外は不変とする。検知はファイルシステム走査で行われ、**非追跡ドラフトが実在するローカル環境でのみ発火し、CI では走査対象不在で自然に no-op になる**（ローカル限定検知・#36 PR 紐づけゲートが CI 限定であるのと対称）。`resolve_issue_tracking_mode` 自体は #28 と共用のため変更しない。
- **根拠 [evidence_source: existing_code + observed_runtime]**: existing_code＝audit.sh は「人間が事前レビューした固定ロジック・決定論的走査・内容を読んで判断しない」という設計であり、`gh` のネットワーク/認証/レート/オフライン依存を持ち込むと監査の純粋性・可搬性を破壊する。observed_runtime＝CI は追跡ファイルのみ展開＝非追跡 04_review.md 不在＝`find` が対象 0 件＝github_native の CI 検知は構造的に no-op（追加コードなしで安全側）。(C) は監査純粋性を壊し CI では走査対象不在で無意味。(B) は ADR-137-1 と矛盾。
- **帰結**: #33 は両モードで未移動を検知する Query になる。github_native では local 主体（pre-push・手動）で発火する。遡及の追跡済み完了 issue（#119/#127 の追跡 04_review.md 等）は T3 の SKIP 撤廃後・T5 の移動前の期間に github_native CI で FAIL 検知されうるが、`continue-on-error: true` の**非ブロッキング督促**であり T5 移動後は `*/close/*` 除外で収束する（放置防止の督促として設計意図どおり）。local_tracked の #33 挙動は完全不変（SKIP は元々 github_native のみ・回帰安全）。#33 コメント・SKIP メッセージの「廃止済み」表現を是正する。
