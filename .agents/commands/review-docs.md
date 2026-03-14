## review-docs — 実装前ドキュメントレビュー（00/01/02/03）

### Purpose

- 実装前の 00/01/02/03（要求定義・要件定義・設計・実装計画）に対する **ドキュメントレビュー**を行い、  
  - レビュー指摘と修正内容を `.workflow/{issue}/memo/` 以下に **YYYYMMDD_HHMMSS_ プレフィックス付き memo** として記録し、
  - 「レビュー＋修正」を 1 セットとして **指摘がなくなるまで反復**し、
  - 完了後に **書記（write-workflow-log）へ委譲**して証跡を残す。  
- verify-and-close（04_review.md）とは異なり、**実装完了前のドキュメントレビュー専用** command とする。

### Inputs

- **issue_path**: `.workflow/{issue}/` へのパス（必須）。`{issue}` は YYYYMMDD_HHMMSS_ プレフィックス付き issue フォルダ名。
- **targets**: レビュー対象ドキュメントの相対パス配列（例: `["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]`）。少なくとも 1 つ以上。
- **request_text**: ユーザーからのレビュー依頼テキスト（例: 「この issue の 00/01/02/03 をドキュメントレビューして」）。
- **mode**: 実行モード（quick/standard/full）。RULES.md §実行モードに従い選択。

### Process

1. **前提の確認**
   - issue_path と targets が `.workflow/{issue}/` 配下の 00/01/02/03 であることを確認する。
   - 実装（implement-feature）の完了フラグが立っていないことを確認し、完了済みの場合は verify-and-close を検討する別フローとする。

2. **レビュー＋修正ループ（self-progress）**
   - 次のステップを **指摘がなくなるまで繰り返す**:
     1. 対象ドキュメント群（targets）を読み、.agents/RULES.md および PHASES.md の監査観点に従ってレビューを行う。
     2. 指摘一覧（場所・内容・優先度など）と、対応方針（修正／却下／別 issue など）を整理する。
     3. 必要に応じて、設計・実装計画などの修正 command（例: design-feature, implement-feature の関連タスク）へ委譲し、ドキュメントを更新するか、人間の修正指示をガイドする。
     4. `.workflow/{issue}/memo/` に対して、run_command.md §memo 作成時 の Constraints に従い:
        - 事前に **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S または .agents/scripts/memo-prefix.sh** を実行してプレフィックスを取得し、
        - `YYYYMMDD_HHMMSS_review-docs.md` 等のファイル名で memo を 1 件以上作成し、
        - 当該レビューサイクルでの指摘一覧・修正内容・残件を記録する。
   - 各ループ毎に「残っている指摘があるか」を判定し、0 件になった時点でループを終了する。

3. **書記への委譲（必須）**
   - 最終サイクル完了後、scribe/CONTRACT.md に従い **write-workflow-log** に委譲し、  
     - 対象 issue の issue_id / document_id 群
     - 実行した review-docs の結果（完了判定・変更ファイル・memo パスなど）
     を workflow.db（本則）または memo_ref に記録させる。

### Outputs

- **updated_docs**: レビューと修正を経て最新化された 00/01/02/03 のパス一覧。
- **memos**: `.workflow/{issue}/memo/` 以下に作成された YYYYMMDD_HHMMSS_ プレフィックス付き memo ファイルのパス一覧。
- **log_ref**: write-workflow-log によって記録された workflow.db エントリ、または memo_ref の参照情報。

### Done (DoD)

- 対象 00/01/02/03 について、**既知の指摘が 0 件** であることが確認されている。
- 各レビューサイクルに対応する memo が `.workflow/{issue}/memo/` に **1 件以上** 作成されている。
- memo ファイル名はすべて **YYYYMMDD_HHMMSS_ プレフィックス**を持ち、プレフィックスは **実行時のシステム時計から取得**されている（推測・固定値ではない）。
- 最後のサイクル完了後に **write-workflow-log** が実行され、CONTRACT 準拠の証跡が記録されている。
- verify-and-close による 04_review.md の作成は行っていない（実装前ドキュメントレビュー専用であること）。
- **完了の定義**: 本 command（review-docs）によるドキュメントレビューを**完了**とみなすのは、上記 DoD の**すべて**（とくに write-workflow-log の実行）を満たした後に限る。書記委譲を省略した場合は未完了であり、ユーザーへの報告前に書記委譲まで実施すること（run_command §実装前のドキュメントレビュー・PHASES §レビュー成果物の配置ルール）。

### Forbidden

- メインエージェントが review-docs の中で **直接ファイル編集を行うこと**（メインは Orchestrator に限定。実作業はサブに委譲する）。
- ユーザーからの「ドキュメントレビュー」依頼に対して、review-docs を起動せずに **レビューコメントだけを返して終了**すること。これは enforcement §失敗条件 #23 に該当する。
- `.workflow/{issue}/memo/` 以下の memo を、**システム時計を用いずに**手入力・固定値・推測のプレフィックスで作成すること。
- 実装が完了しているにもかかわらず、verify-and-close を経ずに review-docs のみで正式レビュー（04_review 相当）を完結させること。

