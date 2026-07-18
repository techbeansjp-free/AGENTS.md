## review-docs — 実装前ドキュメントレビュー（00/01/02/03）

### Purpose

- 実装前の 00/01/02/03（要求定義・要件定義・設計・実装計画）に対する **ドキュメントレビュー**を行い、  
  - レビュー指摘と修正内容を `.agent-skill-chain/runtime/{issue}/memo/` 以下に **YYYYMMDD_HHMMSS_ プレフィックス付き memo** として記録し、
  - 「レビュー＋修正」を 1 セットとして **指摘がなくなるまで反復**し、
  - 完了後に **書記（write-workflow-log）へ委譲**して証跡を残す。  
- verify-and-close（04_review.md）とは異なり、**実装完了前のドキュメントレビュー専用** command とする。

### Inputs

- **issue_path**: `.agent-skill-chain/runtime/{issue}/` へのパス（必須）。`{issue}` は YYYYMMDD_HHMMSS_ プレフィックス付き issue フォルダ名。
- **targets**: レビュー対象ドキュメントの相対パス配列（例: `["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]`）。少なくとも 1 つ以上。
- **request_text**: ユーザーからのレビュー依頼テキスト（例: 「この issue の 00/01/02/03 をドキュメントレビューして」）。
- **mode**: 実行モード（quick/standard/full）。RULES.md §実行モードに従い選択。

### Process

1. **前提の確認**
   - issue_path と targets が `.agent-skill-chain/runtime/{issue}/` 配下の 00/01/02/03 であることを確認する。
   - 実装（implement-feature）の完了フラグが立っていないことを確認し、完了済みの場合は verify-and-close を検討する別フローとする。

2. **レビュー＋修正ループ（self-progress）**
   - 次のステップを **指摘がなくなるまで（または下記打ち切り規定に該当するまで）繰り返す**:
     1. 対象ドキュメント群（targets）を読み、.agent-skill-chain/source/RULES.md および PHASES.md の監査観点に加えて **[REVIEW_DUAL_LENS.md](../REVIEW_DUAL_LENS.md) の二観点**に従ってレビューを行う。適用する観点・証跡要求・ラウンド間継承の定義は正本 REVIEW_DUAL_LENS.md の **§2（敵対的観点・肯定的観点＝must-preserve の同定）／§3（両リストの証跡要求）／§6（ラウンド間の must-preserve 継承と退行検知）** に従い、本 command では再定義しない。
        - **体験観点の確認（既存ゲートへの相乗り）**: 体験面（`experience_surface`）=あり の issue は、02_設計.md の §7.1（前提ナラティブ・ユーザー/課題・却下案 1 件以上）・§7.2（IA・ユーザーフロー・体験ジャーニー・却下案 1 件以上）・§7.3（UI/ビジュアル・既存資産探索一覧・再利用結果／新規作成の正当化根拠・アクセシビリティ・実装可能性・検証改善観点の確認結果・却下案 1 件以上・責務/API 候補）・§7.4（幻覚ペルソナ注意〈3 フェーズ共通〉）の**各フェーズ必須項目が個別に充足しているか**を DUAL_LENS で確認し、欠落時は差し戻す（§7 セクションが存在するだけでは通過させない）。体験面=なし は体験設計の欠落を理由に差し戻さない。ただし §7.0 の判定記録が無い場合、または「なし」の理由が体験サーフェス定義（画面に限らず CLI 出力・エラー・生成 Markdown・エージェント指示文を含む）と明らかに矛盾する場合は差し戻す（機械的な「なし」の形骸化防止・ADR-3）。
     2. 指摘一覧（場所・内容・優先度など）と、対応方針（修正／却下／別 issue など）を整理する。**「敵対的観点リスト」（攻めた観点と結論）**と**「must-preserve リスト」（不変条件と保持の確認）**の**両方**を成果物へ書き出す（REVIEW_DUAL_LENS.md §3）。
     3. 必要に応じて、設計・実装計画などの修正 command（例: design-feature, implement-feature の関連タスク）へ委譲し、ドキュメントを更新するか、人間の修正指示をガイドする。
     4. `.agent-skill-chain/runtime/{issue}/memo/` に対して、run_command.md §memo 作成時 の Constraints に従い:
        - 事前に **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S または .agent-skill-chain/source/scripts/memo-prefix.sh** を実行してプレフィックスを取得し、
        - `YYYYMMDD_HHMMSS_review-docs.md` 等のファイル名で memo を 1 件以上作成し、
        - 当該レビューサイクルでの指摘一覧・修正内容・残件を記録する。
   - 各ループ毎に「残っている指摘があるか」を判定し、0 件になった時点でループを終了する。
   - **打ち切り規定（反復上限・非収束時のエスカレーション。本 command が正本。他 command は本節を参照）**: 既定 **N=3 ラウンド**を上限とする。**ブロッキング指摘（矛盾・欠落・退行）は N に関わらず必ず解消**すること（打ち切りの対象外）。N ラウンドを終えてもなお指摘が残る場合、残っているのが**低優先度の新規指摘のみ**であれば、これ以上の反復は行わず、**残指摘を優先度付きリストとして進行役へエスカレーション**してループを終了する（無限反復によるトークン・時間の浪費を防ぐ）。ブロッキング指摘が残っている状態での打ち切りは行わない。

3. **書記への委譲（必須）**
   - 最終サイクル完了後、scribe/CONTRACT.md に従い **write-workflow-log** に委譲し、  
     - 対象 issue の issue_id / document_id 群
     - 実行した review-docs の結果（完了判定・変更ファイル・memo パスなど）
     を workflow.db（本則）または memo_ref に記録させる。

### Outputs

- **updated_docs**: レビューと修正を経て最新化された 00/01/02/03 のパス一覧。
- **memos**: `.agent-skill-chain/runtime/{issue}/memo/` 以下に作成された YYYYMMDD_HHMMSS_ プレフィックス付き memo ファイルのパス一覧。
- **dual_lens_lists**: 「敵対的観点リスト」と「must-preserve リスト」の両方（REVIEW_DUAL_LENS.md §3）。memo または 00-03 ドキュメント自体に記載する。**git 追跡される 00-03 への記載を推奨経路**とする（memo は過渡的・非追跡構成があり、機械的な内容強制が確実には効かないため。将来 audit を #27 と同型の git 差分内容チェックへ拡張できる余地を残す）。
- **log_ref**: write-workflow-log によって記録された workflow.db エントリ、または memo_ref の参照情報。

### Done (DoD)

- 対象 00/01/02/03 について、**既知の指摘が 0 件**であること、**または**打ち切り規定（§Process 反復ループ）に該当し残指摘（低優先度の新規指摘のみ）を優先度付きで進行役へエスカレーション済みであることが確認されている。ブロッキング指摘（矛盾・欠落・退行）が残ったままの完了は認めない。
- **二観点の両リストが成果物に記載されている**: 「敵対的観点リスト」と「must-preserve リスト」の**両方**が memo または 00-03 ドキュメント自体に記載されている。**いずれか一方でも欠落しているレビューは未完了**とする（REVIEW_DUAL_LENS.md §3。review-code / review-architecture と同じ強制水準）。
- 各レビューサイクルに対応する memo が `.agent-skill-chain/runtime/{issue}/memo/` に **1 件以上** 作成されている。
- memo ファイル名はすべて **YYYYMMDD_HHMMSS_ プレフィックス**を持ち、プレフィックスは **実行時のシステム時計から取得**されている（推測・固定値ではない）。
- 最後のサイクル完了後に **write-workflow-log** が実行され、CONTRACT 準拠の証跡が記録されている。
- verify-and-close による 04_review.md の作成は行っていない（実装前ドキュメントレビュー専用であること）。
- **完了の定義**: 本 command（review-docs）によるドキュメントレビューを**完了**とみなすのは、上記 DoD の**すべて**（とくに write-workflow-log の実行）を満たした後に限る。書記委譲を省略した場合は未完了であり、ユーザーへの報告前に書記委譲まで実施すること（run_command §実装前のドキュメントレビュー・PHASES §レビュー成果物の配置ルール）。

### Forbidden

- メインエージェントが review-docs の中で **直接ファイル編集を行うこと**（メインは Orchestrator に限定。実作業はサブに委譲する）。
- ユーザーからの「ドキュメントレビュー」依頼に対して、review-docs を起動せずに **レビューコメントだけを返して終了**すること。これは enforcement §失敗条件 #23 に該当する。
- `.agent-skill-chain/runtime/{issue}/memo/` 以下の memo を、**システム時計を用いずに**手入力・固定値・推測のプレフィックスで作成すること。
- 実装が完了しているにもかかわらず、verify-and-close を経ずに review-docs のみで正式レビュー（04_review 相当）を完結させること。
- **二観点のいずれかのリスト（敵対的観点リスト / must-preserve リスト）を欠いたまま review-docs を完了とみなすこと**（REVIEW_DUAL_LENS.md §3・DoD と整合）。

