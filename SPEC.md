# SPEC: Issueセグメント成果物のroot直下混入を、事後cleanupだけでなくマージ前に予防するCI gateが無い

- Issue: `ISSUE-590`
- 作成者: `spec_worker`
- 対象ブランチ: `process/590-root-pollution-prevention-gate`

## 目的・背景

AGENTS.md「4セグメント・4ゲート」規約に従い、`.agent-skill-chain/config/segments.yaml` はセグメントごとの成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）を裸のファイル名（root相対パス）として定義している。この定義により、各Issue作業ワーカーはIssueブランチのリポジトリルート直下にこれらの成果物を作成・commitする。これらはIssue進行中は必要だが、Issue完了後は破棄されるべき一時的成果物であり、配置場所がdefault branchとの合流点（root）と同一であるため、PRマージ時に明示的な削除が行われない限りそのままdefault branchのrootへ持ち込まれ、次のIssueがマージされるまで恒久的に残存する。

現状この問題への対策は、default branchへのpushを契機に事後検出・削除を行う `root-cleanup run`（Issue #208、ADR-0007）のみである。ADR-0007は、Issueブランチ自体へ削除commitをpushする案（案1）を明示的に検討し、致命的な技術的欠陥を理由に不採用とした：`.github/workflows/agent-skill-chain-reconcile.yml` が実行する `gate-reconcile.sh` は、Issueブランチへのpushごとに各ゲートが承認した成果物（`approved_artifacts`）のdigestを現在のファイル内容と照合し、ファイルが削除されているとdigest不一致として扱い当該ゲートおよび全下流ゲートを無効化する。したがって、Issueブランチ上でこれら4ファイルを削除するcommitは、そのIssue自身のマージに必要な承認済みゲート状態を自己破壊してしまい成立しない。この制約は本Issueが導入する仕組みにも同様に適用される。

事後cleanupのみでは、混入そのものを防げず、cleanup対象の存在を前提とした運用（手動対応の発生）を許容し続けることになる。実際に、通常運用（Issue完了→PRマージ）だけで2回連続してroot直下へのSPEC.md等の混入が発生し、かつ `root-cleanup run` 自体も別の不具合（PR作成先のbase branchハードコード、別Issueで既に修正済み）により2回とも失敗し、手動対応が必要となった。この実害を踏まえ、マージ前の予防側チェックを追加することが本Issueの目的である。ただし、Issueセグメント成果物の配置パス自体（root直下）や `segments.yaml` の定義は変更しない前提とする——これらを変更することは「セグメント自体の追加・変更＝破壊的変更」としてADR＋AGENTS.md改定＋schema_version更新＋migrationを要する最大級の変更であり、本Issueが解決しようとしている実害（既存の通常運用でのroot混入）に対して不釣り合いに重い。

## 要求 → 要件 → 受入条件

### 要求

Issueセグメント成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）は、マージ準備が完了したPRについて、default branchへ反映される前の時点でroot直下への残存混入が検出・阻止される状態にする。同時に、Issue進行中の正常な中間状態（これら成果物がroot直下に存在することが前提となる段階）を誤ってブロックせず、かつ検証まで正常に完了したPRが追加の手動操作なしにマージ可能であり続ける状態にする。

### 要件

- マージ準備完了状態を、Draft PRがReady for Reviewへ遷移した状態（またはこれと同等にマージ判断が下された状態）として機械的に判定可能な条件で定義する。この定義は、Issue進行中（spec〜implementation段階など、成果物がroot直下に存在すること自体が正常な中間状態）とマージ準備完了後とを取り違えない。
- マージ準備完了状態にあるPRについて、repoRoot直下に `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` のいずれかが存在する場合、CIによる検査を失敗させ、当該PRのマージをブロックする。
- マージ準備完了状態に至っていないPR（Draftのまま、またはマージ準備完了の判定条件を満たさない状態）については、同一の検査がroot直下の対象4ファイルの存在のみを理由に失敗・ブロックしない。
- validation-gateまで正常に完了しマージ準備完了状態へ至ったPRは、進行役・作業ワーカーによる対象4ファイルの追加の `git rm` 等の手動操作を要求されることなく、既存ワークフローに組み込まれた仕組みによってマージ可能な状態になる。
- 対象4ファイルの削除は、Issueブランチ自体へのcommitとしては行わない。Issueブランチへの削除commitは、`gate-reconcile.sh` が承認済み成果物のdigest不一致として扱い当該ゲート・下流ゲートを無効化する既存の仕組みにより、そのIssue自身のマージ可否判定を自己破壊する（ADR-0007が不採用とした案1と同型の問題）。
- `.agent-skill-chain/config/segments.yaml` の `outputs` 定義、AGENTS.md本体、既存の成果物配置パス（root直下）は変更しない。
- 事後対策である `root-cleanup run`（Issue #208、ADR-0007）は保険として維持し、本Issueによる変更で退行させない。
- AGENTS.mdの `quick`（成果物作成義務が免除されるIssue）については、対象4ファイルがそもそもroot直下に作成されないため、本Issueが導入する検査は追加の特別扱いなしに通過する前提とする。

### 受入条件（Acceptance Criteria）

#### AC-1: マージ準備完了状態のPRにroot直下の対象4ファイルが残っている場合、CIが失敗しマージをブロックする

- Given: PRがマージ準備完了状態（Draftではなく、Ready for Reviewへ遷移した状態、またはこれと同等にマージ判断が下された状態）にあり、そのPRのHEADのrepoRoot直下に `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` のいずれかが存在する
- When: マージ準備完了状態を対象とするCI検査が実行される
- Then: 検査が失敗し、当該PRのマージがブロックされる
- 検証方法見込み: `automated`

#### AC-2: Issue進行中（マージ準備未完了）ではこのチェックが誤検知でブロックしない

- Given: PRがまだマージ準備完了状態に至っていない（Draftのまま、spec〜implementation段階などIssueが進行中である）ため、root直下に対象4ファイルが存在することがその時点で正常な状態である
- When: 同一のCI検査が実行される
- Then: 検査は対象4ファイルの存在のみを理由に失敗・ブロックしない
- 検証方法見込み: `automated`

#### AC-3: 正常にvalidation-gateまで完了したPRは、追加の手動操作なしでマージ可能である

- Given: validation-gateまで正常に完了し、マージ準備完了状態（Ready for Review）へ至ったPR
- When: マージ判断が行われる
- Then: 進行役・作業ワーカーが対象4ファイルの削除のために追加で `git rm` 等の手動操作を行うことなく、既存ワークフローに組み込まれた成果物削除の仕組みにより当該PRはマージ可能な状態になる
- 検証方法見込み: `hybrid`

#### AC-4: `.agent-skill-chain/config/segments.yaml`・AGENTS.md本体・既存の成果物配置パスを変更しない

- Given: 本Issueの実装差分
- When: `.agent-skill-chain/config/segments.yaml` の `outputs` 定義、AGENTS.md本体の記述、Issueセグメント成果物のroot直下という配置パスを確認する
- Then: これらのいずれも変更されていない
- 検証方法見込み: `manual`

#### AC-5: `root-cleanup run`（Issue #208/ADR-0007）が保険として引き続き機能する

- Given: 本Issueの変更が適用された状態のリポジトリ
- When: default branchへのpush（`[skip ci]` を含まないもの）を契機に `root-cleanup run` が動作する状況を再現する
- Then: `root-cleanup run` は本Issue適用前と同じ手順（root直下混入ファイルの検出・短命ブランチでの削除・PR作成・マージ）で機能し、本Issueによる回帰が無い
- 検証方法見込み: `hybrid`

## スコープ外

- Issueブランチ自体へ削除commitをpushする方式（ADR-0007が不採用と判断した案1）の採用。
- `.agent-skill-chain/config/segments.yaml` の `outputs` 定義自体の変更、および成果物配置パスをnamespace化する等の破壊的変更。
- `root-cleanup run`（Issue #208/ADR-0007）自体のロジック変更。当該機能のPR作成先base branch決定ロジックの不具合修正は、本Issueとは別Issueで既に対応済み・対応中である。
- AGENTS.mdが定める `quick` Issue（成果物作成義務の免除）の免除条件そのものの変更。
- マージ準備完了状態の判定に用いる具体的なCI実装手段（ワークフロートリガー種別・ブランチ保護のrequired status check名・成果物削除を実行する具体的な仕組み等）の確定。これらはDESIGN.mdで確定する設計判断であり、本SPEC.mdは要件レベルの定義に留める。
