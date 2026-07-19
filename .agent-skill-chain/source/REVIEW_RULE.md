# REVIEW_RULE — レビュー実施時の参照と観点（補助）

**This file is a supplementary guide; the definitive rules live in [.agent-skill-chain/source/RULES.md](RULES.md).** 正本は RULES.md であり、本ファイルは補助資料。重複を避けるため、ルールの解釈・運用は RULES.md を単一の参照先とすること。

04_review を実施するときの**必須参照**と**監査観点**をまとめる。レビュー深度は **quick / standard / full** のいずれか。変更規模（小修正→quick、中規模→standard、新規・大規模→full）に応じて [RULES.md §実行モード](RULES.md) で選択すること。

---

## レビュー成果物の配置（必須）

以下は RULES.md および PHASES.md に基づく補足であり、権威は正本（RULES.md）に属する。

- **04_review は実装フェーズ完了後のレビューフェーズ**（verify-and-close 実行時）でのみ作成・更新する。実装前に 04_review を作成してはならない。（PHASES §レビュー成果物の配置ルールに基づく）
- **実装完了後の正式なレビュー成果物**は **必ず issue フォルダ直下に 04_review.md を直接作成する（絶対強制）。** verify-and-close を実行したら 04_review.md を作成しないで完了とみなしてはならない。memo のみで済ませること禁止。同上・enforcement 失敗条件 #3。
- **memo にはドキュメントレビュー証跡を記録してよい**。実装前の 00/01/02/03 に対するドキュメントレビューの証跡は memo に残してよい。**04_review に相当する正式なレビュー成果物は memo に書かない**。memo はメモ・証跡用とする。（同上）
- **ドキュメントレビューはレビューと修正を一組とし、指摘がなくなるまで繰り返す**。各回の証跡は memo に記録する。**完了後は必ず書記（write-workflow-log）に依頼**すること（run_command §実装前のドキュメントレビュー・PHASES §レビュー成果物の配置ルール）。**「完了」＝ memo 作成＋修正反復＋書記委譲のすべて**。書記委譲を省略してユーザーに報告のみで終了することは禁止（enforcement §失敗条件 #23）。

---

## 参照先一覧

レビュー手順の正本は [.agent-skill-chain/source/RULES.md](RULES.md)。以下は参照の索引である。

| 参照先 | 内容 |
|--------|------|
| .agent-skill-chain/source/boot/CORE.md | 読了義務・証跡省略禁止・ログは書記のみ・メインは直接実作業しない |
| .agent-skill-chain/source/boot/LOAD_POLICY.md | いつ何を読むか |
| .agent-skill-chain/source/workflow/PHASES.md | フェーズ・成果物・DoD・監査観点 |
| .agent-skill-chain/source/workflow/TEMPLATES.md | 成果物のフォーマット・必須セクション |
| .agent-skill-chain/source/RULES.md | 実行・ドキュメント・テスト・証跡・監査・書記 |
| .agent-skill-chain/source/IO_CONTRACT.md | command / skill の入出力契約（INPUT/PROCESS/OUTPUT/DONE、Purpose/Inputs/Process/Outputs/Done/Forbidden） |
| .agent-skill-chain/source/agents/auditor.md | 監査の責務・検証項目 |
| .agent-skill-chain/source/skills/review/ | review-code（実装・規約・テスト BDD インライン・ディレクトリ・命名・spec 準拠）、review-architecture（設計・境界） |
| .agent-skill-chain/source/TEST_BDD_FORMAT.md | テストコードの `ユースケース:`・`シナリオ:`（doc 等）および Given / When / Then（必要時 And）インラインコメント必須 |
| .agent-skill-chain/source/spec/ | 設計原則・ディレクトリ構造・命名規則・設計判断の優先順位（監査で spec 準拠を確認する） |

---

## 監査で検証する項目（PHASES §監査観点）

レビュー手順の正本は [.agent-skill-chain/source/RULES.md](RULES.md)。監査時には [workflow/PHASES.md](workflow/PHASES.md) の監査観点を満たすこと。以下は RULES.md / PHASES に基づく検証用チェックリストである。

### テストコード化の網羅

- **ユースケースに基づく全シナリオで、テストコード化できるものは全てテストコード化したか**。01 の BDD シナリオ一覧とテスト仕様（単体テスト仕様・チェックリスト等）の対応が取れていること。未対応のシナリオがある場合は、テストコード化しない理由が明記されていること（例: ドキュメントのみでチェックする、外部依存で自動化困難等）。
- 対応表または 03_実装計画のタスク別テスト観点で、シナリオとテストの対応が確認できること。

### フォーマットの正しさ

- **全ドキュメントに document_id（UUID）を必須とする。任意とすることを禁止する。レビュワーが任意と判断することも禁止する。** 対象には 00/01/02/03/04/05/90、memo、docs 配下・指摘対応・00_システム理解から作成するドキュメントを含む。
- **document_id は作成時または初回付与時にのみ設定されていることを確認し、既に存在する document_id が後から変更・上書きされていないことをレビューで検証する。**
- 各フェーズの成果物がテンプレートの必須セクションを満たしていること。
- **ディレクトリ構成・ファイルの作成場所・命名規則（spec/03）・プレフィックス（memo の YYYYMMDD_HHMMSS_ は実行環境現在時刻 JST 取得であること）・用語・参照リンク・BDD 形式・spec 準拠（設計原則・UNIX 哲学等）**に適合していること。
- **テストコードに `ユースケース:`・`シナリオ:` および Given / When / Then（必要時 And）のインラインコメントが付いていること**（.agent-skill-chain/source/TEST_BDD_FORMAT.md）。

### その他（証跡・手順）

- 各工程で監査・書記に依頼していること。レビュー・クローズ前に verify-and-close を経ていること。
- 証跡（memo・ログ）が YYYYMMDD_HHMMSS_ プレフィックス等の規約に従っていること。**memo プレフィックスは専用経路のみで取得すること**（TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agent-skill-chain/source/scripts/memo-prefix.sh の実行）。**手入力・固定値・AI の推測は違反とする。**
- command 実行が commands/{name}.md の skill chain に従っていること。

---

## レビュー実施時の必須行動

手順の正本は [.agent-skill-chain/source/RULES.md](RULES.md)。以下は補足である。

- **04_review の作成・更新時は、該当 issue の実装成果物にテストが含まれる場合、テストを再実行し、結果（成功/失敗・ログ参照先）を 04_review に記載すること。** テストを実行していない状態で監査完了とみなしてはならない。
- 調査範囲はレビュー深度に比例させる（規模非比例の負荷を避ける）。**full 深度では変更の影響範囲に加えてプロジェクト全体を徹底調査し、quick / standard 深度では変更の影響範囲（関連するテスト・コード）に限定する**こと。
- 上記の参照先を読んだうえで、04_review の各セクション（実装内容の確認・受け入れ基準の確認・設計の確認・レビュー結果）を記載すること。
- **重要判断には evidence_source を記載し、外部根拠を 1 つ以上含めること。ただし一次情報に到達不能なランタイム（オフライン等）では、[EVIDENCE_POLICY.md §節4](EVIDENCE_POLICY.md) の顕在化フラグ付き `inference_only`（要注意／要人間確認の二段階明示）で足りる**（無条件の外部根拠必須による自走デッドロックを避ける）。

---

## 参照

| 参照先 | 内容 |
|--------|------|
| .agent-skill-chain/source/commands/verify-and-close.md | 検証・クローズ command |
| .agent-skill-chain/source/enforcement/README.md | 強制・監査の正本 |
