---
document_id: "aa9911ab-cadc-41be-8620-2053d5f20fa5"
---

# DECISIONS — 本リポジトリの恒久 ADR 記録（決定ログ）

本ファイルは、本リポジトリ（`techbeansjp-free/AGENTS.md`）の設計・運用に関する**恒久的な設計判断（ADR: Architecture Decision Records）**を git 追跡で永続保存する単一の記録先である。

`ISSUE_TRACKING_MODE=github_native` 採用により、起票検討段階のローカル issue ドラフト（`docs/maintainer/workflow/**` 配下の 00〜04）は非追跡化され、完了時も `close/` 移動を行わず GitHub Issue の close で完結する。そのため、非追跡ドラフトが破棄されても失われてはならない**恒久的な設計判断**を、追跡ファイルである本ファイルへ集約する（2026-07-15 の worktree 削除で 02/03 が失われた事故の再発防止も兼ねる）。

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
