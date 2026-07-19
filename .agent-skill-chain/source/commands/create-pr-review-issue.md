# command: create-pr-review-issue

**本ファイルの責務**: PR レビュー指摘対応の**3 ステップフロー**（独立技術評価 → 進行役の一括承認 → 委譲実行での対応実施）を定義する command。**どの skill / worker をどの順で実行するか**のみを記載。実行手順・委譲の形は skills/agent/run_command.md に従う。**契約**: [IO_CONTRACT.md](../IO_CONTRACT.md) に従い INPUT / PROCESS / OUTPUT / DONE で定義する。

> **横断ルールは正本参照・本 command で再定義しない**: サブによる独断起票の禁止・Go は進行役・進行役の直接 Edit 禁止は、`skills/agent/run_command.md` §Forbidden / Execution Path Rule・`boot/CORE.md`・`workflow/PHASES.md` を正本とする。データ形式（`Disposition`・`TriageRow`・起票条件 C1〜C5・`security_flag`・`defer_reason`）の正本は [workers/create-pr-review-issue/OUTPUT_FORMAT.md](../workers/create-pr-review-issue/OUTPUT_FORMAT.md)。

---

## メタデータ（phase → command 整合用）

| 項目 | 値 |
|------|-----|
| **Allowed Phase** | issue_creation（サブフェーズ: create_pr_review_issue） |
| **Required Inputs** | pr_url, review_comments_raw, issue_dir_hint（任意）, parent_issue_id |
| **Produces** | トリアージ記録用 00_要求定義.md（全指摘 disposition 記録・一括承認記録）。起票 disposition がある場合は追加で created_issue_dir（`.agent-skill-chain/runtime/{parent}/90_issues/{ディレクトリ名}/`）と配下の 00_要求定義.md |
| **Next Phase** | 実装（起票したサブ issue の 01→02→03→実装→04 へ進む場合） |

---

## INPUT（本改定で不変・既存互換）

- **pr_url**: string。PR を一意に特定する URL（例: `https://github.com/techbeansjp-free/AGENTS.md/pull/4`）。
- **review_comments_raw**: string。ユーザーが貼り付けた PR レビューコメント一覧（テキスト）。手動取得前提（github MCP は使わない）。
- **issue_dir_hint**: string | null。既存 issue ディレクトリ名。起票 disposition の指摘があり指定された場合は新規作成せず当該ディレクトリを採用する。
- **parent_issue_id**: string。親 issue のディレクトリ名（`.agent-skill-chain/runtime/{parent_issue_id}/` が存在する前提）。

---

## PROCESS（3 ステップフロー・この順で実行）

本 command は**アクター境界を跨ぐ**（進行役とサブ）。受け渡し構造は「**ステップ 1 はサブが実行しトリアージ表を進行役へ返却して一旦終了 → ステップ 2 は進行役が承認（サブは自己承認しない） → ステップ 3 は進行役が承認後に改めてサブへ委譲**」である。サブがステップ 2 を自己完結して起票・修正まで走らせない（サブ独断起票禁止・Go は進行役の正本と整合）。

1. **ステップ 1: 独立技術評価（トリアージ表生成・サブが実行）**
   `workers/create-pr-review-issue/` の手順に従い、全指摘（`ReviewFinding[]`）を調査し、起票条件チェックリスト（C1〜C5）を適用して各指摘の disposition 提案・根拠・`security_flag` を判断し、**全指摘一括のトリアージ表 `TriageRow[]`（列: 指摘 / 判定案 / 根拠）**を進行役へ返却する。サブは提案に留め、起票・即時対応を独断実行しない（`skills/agent/run_command.md` §Forbidden 参照）。
2. **ステップ 2: 進行役の一括承認（進行役が実施）**
   進行役がトリアージ表を一括承認（必要に応じ個別修正）し、各指摘の最終 disposition を確定する。**`security_flag=true`・C5 該当は一括承認に埋没させず個別承認**する（[OUTPUT_FORMAT.md §4.4](../workers/create-pr-review-issue/OUTPUT_FORMAT.md)）。承認記録は 00 の一括承認ブロックへ記録する（[00_TEMPLATE_MAPPING.md](../workers/create-pr-review-issue/00_TEMPLATE_MAPPING.md)）。
3. **ステップ 3: 対応実施（進行役が承認後にサブへ委譲）**
   確定 disposition に従い分岐する（`workers/create-pr-review-issue/README.md` ステップ 3）:
   - **即時対応**: **委譲実行**で現 PR ブランチ内を修正（**進行役は直接 Edit しない**）＋テスト実行（green 維持ゲート）。テスト破壊時、またはテストが実行不能で green を確定できない場合は軽微判定を取り消し起票側／再評価へ。
   - **起票**: **起票条件チェックリスト（C1〜C5）該当時のみ**、既存起票フロー（`create-pr-review-issue-dir.sh` によるディレクトリ決定・00 生成・監査・書記記録）でサブ issue を起票する。
   - **見送り**: `defer_reason` を 00 に必須記録。
4. **監査**（**トリアージ記録 00 を無条件で対象とする**。起票 0 件のバッチでも省略しない）— **トリアージ記録用 00_要求定義.md を常に監査対象**とし、起票 disposition があればサブ issue 側の 00_要求定義.md も併せて対象に含める。**[commands/review-docs](review-docs.md) を参照して**監査・レビュー（実装前ドキュメントレビュー）に依頼する。問題があれば修正して差し戻し、指摘がなくなるまで繰り返す（**反復の打ち切り規定は [review-docs.md §Process 反復ループ](review-docs.md) を正本とし、本節では再定義しない**）。証跡は当該 issue の `memo/` に YYYYMMDD_HHMMSS_ プレフィックスの memo で記録する。
5. **write-workflow-log** — 書記に依頼し、本 command の実施内容・トリアージ記録 00・起票した issue ディレクトリ（あれば）・即時対応の結果を workflow.db に記録する。`skills/logging/write-workflow-log/` を参照。

委譲方針: メインエージェント（進行役）は本 command を run_command 経由でサブに委譲する。ステップ 1 の返却後は進行役が承認（ステップ 2）し、承認後に改めてステップ 3 を委譲する。

---

## OUTPUT

- **トリアージ記録用 00_要求定義.md**: 全指摘の disposition（即時対応／起票／見送り）・根拠・一括承認ブロックを一本化した記録面（PR レビューバッチにつき 1 つ）。**起票が 0 件でも生成する**（監査可能性）。
- **created_issue_dir**（起票 disposition がある場合のみ）: 起票した指摘の追跡用サブ issue ディレクトリ（例: `.agent-skill-chain/runtime/{parent_issue_id}/90_issues/20260314_PR4_PR指摘対応/`）と配下の 00_要求定義.md。
- **即時対応の反映**（該当時）: 現 PR ブランチ内の修正＋テスト green 確認。
- **書記記録済み**: write-workflow-log により workflow.db に実施内容が記録されている。

---

## DONE（DoD）

- **全指摘に disposition（即時対応／起票／見送り）が漏れなく付与**され、根拠とともにトリアージ記録用 00_要求定義（指摘一覧）へ記録されている。
- 起票要否が「非可逆」の主観語ではなく、**起票条件チェックリスト（C1〜C5）の該当有無**で判定・説明されている。サブ issue 化は**起票条件該当時のみ**に限定されている。
- **見送りは理由（`defer_reason`）が必須記録**されている。**セキュリティ指摘（`security_flag=true`）は軽微でも記録・監査**されている。
- **即時対応は委譲実行**であり、進行役の直接 Edit 禁止ルール（Execution Path Rule）に抵触していない。テストゲート（green 維持・実行不能時の fail-safe）が適用されている。
- 起票した場合、当該 `90_issues/{ディレクトリ名}/` 配下に 00_要求定義.md が存在し、監査を経ている。証跡は当該 issue の `memo/` に記録されている。
- **書記（write-workflow-log）で証跡が記録**されている。

---

## 想定されるユーザーの 1 行指示パターン

- 「`https://github.com/techbeansjp-free/AGENTS.md/pull/4` の指摘対応をして」
- 「この PR コメント一覧の指摘をトリアージして対応して」
- 「既存の `AGENTS-PR4_PR指摘対応` ディレクトリを使って、この PR の起票対象の指摘を起票して」

---

## ERROR / Forbidden

- **横断ルール（正本参照・再定義しない）**: サブによる独断起票の禁止・起票/即時対応の Go は進行役・進行役の直接 Edit 禁止は、`skills/agent/run_command.md` §Forbidden / Execution Path Rule・`boot/CORE.md`・`workflow/PHASES.md` を正本とする。サブはステップ 1 の提案に留め、承認前に起票・即時対応を独断実行しない。
- **既存ディレクトリが見つからない**: 起票時に issue_dir_hint を指定したが `.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{issue_dir_hint}/` が存在しない場合 → 「指定されたディレクトリが見つかりません。ディレクトリ名を確認するか、未指定で新規作成してください。」を返す。不完全なディレクトリを runtime 配下に作成しない。
- **指摘一覧が空**: review_comments_raw が空または有意な指摘を 1 件も抽出できなかった場合 → トリアージ記録 00 に「指摘一覧が空です。手動で指摘を追加するか、review_comments_raw を再入力してください。」旨を明記し、受け入れ基準に「指摘一覧が 1 件以上埋まっていること」を含める。
- **PR URL が不正形式**: URL として解釈できない・PR 番号が抽出できない場合 → 00 に「PR を一意に特定できるか不明です。有効な PR URL を確認してください。」旨を明記する。処理は継続し、ディレクトリ名はプレフィックスに「PR不明」等のフォールバックを用いてもよい。
- **判定情報不足**: 起票要否の判定に必要な情報が不足する場合は保守側（起票）へ倒す（C5・保守側デフォルトと整合）。

---

## 参照

- [workers/create-pr-review-issue/README.md](../workers/create-pr-review-issue/README.md)（3 ステップ手順）
- [workers/create-pr-review-issue/OUTPUT_FORMAT.md](../workers/create-pr-review-issue/OUTPUT_FORMAT.md)（`Disposition`・`TriageRow`・起票条件 C1〜C5・security の正本）
- [workers/create-pr-review-issue/00_TEMPLATE_MAPPING.md](../workers/create-pr-review-issue/00_TEMPLATE_MAPPING.md)（disposition・承認記録の 00 一本化）
- `skills/agent/run_command.md`（§Forbidden「サブによる独断起票」・Execution Path Rule。横断ルールの正本）
- `boot/CORE.md`・`workflow/PHASES.md`（issue_creation.create_pr_review_issue サブフェーズ・起票 / Go 判断の正本）
- workflow/TEMPLATES.md（00_要求定義のテンプレート）
- `scripts/create-pr-review-issue-dir.sh`（起票 disposition 時のみ用いる。本改定で変更しない）
