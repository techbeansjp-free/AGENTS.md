# worker: create-pr-review-issue

**責務**: PR レビュー指摘の**独立技術評価（トリアージ表生成）**と、進行役の承認後の**対応実施**（即時対応の委譲実行／起票／見送り記録）を一連で実行する。指摘は三値 disposition（即時対応／起票／見送り）で処置し、**起票は起票条件チェックリスト（C1〜C5）該当時のみ**に限定する。メインエージェント（進行役）は commands/create-pr-review-issue.md を run_command 経由でサブに委譲し、本 worker の手順に従って実行する。

> **横断ルール（正本参照・本 README で再定義しない）**:
> - **サブによる独断起票の禁止・Go は進行役**: サブは独立評価とトリアージ案の提示に留め、起票・即時対応を独断で実行しない（正本: `skills/agent/run_command.md` §Forbidden「サブによる独断起票」・CORE / PHASES）。
> - **進行役の直接 Edit 禁止**: 即時対応は**委譲実行**であり、進行役は自らファイルを Edit しない（正本: `skills/agent/run_command.md` Execution Path Rule）。
> - データ形式（`Disposition`・`TriageRow`・起票条件 C1〜C5・`security_flag`・`defer_reason`）の正本は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md)。本 README では再定義せず参照する。

---

## INPUT（command から渡される）

- **pr_url**: string
- **review_comments_raw**: string
- **issue_dir_hint**: string | null
- **parent_issue_id**: string（`.agent-skill-chain/runtime/{parent_issue_id}/` が存在する前提）

---

## PROCESS（手順）

本フローは進行役（orchestrator）とサブ（worker）に跨る。**ステップ 1 はサブが実行しトリアージ表を進行役へ返却して一旦終了**する。**ステップ 2（一括承認）は進行役が行う**（サブは自己承認しない）。**ステップ 3（対応実施）は進行役が承認後に改めてサブへ委譲**する。サブがステップ 2 を自己完結して起票・修正まで走らせてはならない。

### ステップ 1: 独立技術評価（トリアージ表生成・提案のみ）

1. **指摘一覧抽出**
   review_comments_raw から `ReviewFinding[]` を生成する。**出力形式は [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md) §1 に固定**する。
2. **各指摘の独立技術評価**
   各 finding を調査し、**起票条件チェックリスト C1〜C5**（[OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md) §4）を適用して disposition 提案・根拠・`security_flag`・`defer_reason` を判断する。
   - C1〜C5 に **1 つでも該当**したら `disposition_proposal=起票`（保守側デフォルト）。根拠は該当項目名で記述する（主観語「非可逆」を判定式に用いない）。
   - C1〜C5 いずれも非該当で、即時対応の許容ゲート（現 PR ブランチ 1 コミット・既存テスト green・diff 局所）を満たすなら `即時対応`。
   - AI 誤検知等は `見送り`（`defer_reason` 必須）。
   - 判定に必要な情報が不足する場合は保守側（起票）へ倒す。
3. **トリアージ表として提示**
   全指摘一括の `TriageRow[]`（列: 指摘 / 判定案 / 根拠）を進行役へ返却する。個々の指摘を 3 ステップ個別往復させない。**`security_flag=true`・C5 該当の指摘は視覚的に分離して提示**し、進行役の個別承認を促す（[OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md) §4.4）。
   - サブはここで**一旦終了**し、起票・即時対応は独断で実行しない。

### ステップ 2: 進行役の一括承認（進行役が実施・サブは自己承認しない）

- 進行役がトリアージ表に対し disposition を一括承認（必要に応じて個別修正）し、各指摘の最終 disposition を確定する。`security_flag=true`・C5 該当は個別承認とする。
- 承認記録は [00_TEMPLATE_MAPPING.md](./00_TEMPLATE_MAPPING.md) の一括承認ブロックへ記録する。

### ステップ 3: 対応実施（進行役が承認後にサブへ委譲）

確定 disposition に従い分岐する。

1. **即時対応**（`disposition=即時対応`）
   - **委譲実行**で現 PR ブランチ内を修正する（**進行役は直接 Edit しない**。`skills/agent/run_command.md` Execution Path Rule 参照）。
   - 修正後に**テストを実行**し、既存テストが green を維持することを確認する（テストゲート）。
   - **既存テストが green を維持できない場合、またはテストが実行不能・タイムアウト・flaky で green を確定できない場合は、軽微判定（即時対応）を取り消し**、起票側または再評価へ回す（fail-safe）。
   - 結果（修正内容・テスト結果）を 00 の指摘一覧へ記録する。
2. **起票**（`disposition=起票`。C1〜C5 のいずれかに該当）
   - **起票する場合のみ**、既存起票フローでサブ issue を起票する: `create-pr-review-issue-dir.sh` を実行（または本 README のロジックに従う）してディレクトリを決定・作成し、当該 `90_issues/{ディレクトリ名}/` 配下に 00_要求定義.md を生成する。
     - `issue_dir_hint` 指定時: `.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{issue_dir_hint}/` の存在を確認。存在すれば採用。存在しなければエラー（ERROR_DIR_NOT_FOUND）としてユーザーへ返す。
     - `issue_dir_hint` 未指定時: pr_url から PR 番号を抽出し、memo-prefix.sh でプレフィックスを取得。`.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{プレフィックス}PR指摘対応/` を新規作成する。
   - 起票根拠（該当した C1〜C5）を 00 の指摘一覧へ記録する。
3. **見送り**（`disposition=見送り`）
   - `defer_reason`（AI 誤検知等）を 00 の指摘一覧へ**必須記録**する。追加の起票成果物は持たない。

いずれの disposition でも、全指摘の disposition・根拠を**トリアージ記録用 00_要求定義（指摘一覧）へ一本化**して記録する（[00_TEMPLATE_MAPPING.md](./00_TEMPLATE_MAPPING.md)）。**起票が 0 件でも当該 00 は生成する**（監査可能性）。`security_flag=true` の指摘は即時対応でも記録・監査を必須とする。

> **既存 issue ディレクトリ（issue_dir_hint）指定時**: 起票分岐でのディレクトリ新規作成は行わず、当該ディレクトリを採用したうえで指摘一覧・disposition を反映する。

---

## OUTPUT

- **トリアージ記録用 00_要求定義.md**: 全指摘の disposition・根拠・一括承認ブロックを一本化した記録面（PR レビューバッチにつき 1 つ）。
- **created_issue_dir**（起票 disposition がある場合のみ）: 起票した指摘の追跡用サブ issue ディレクトリ（`.agent-skill-chain/runtime/{parent_issue_id}/90_issues/{ディレクトリ名}/`）と配下の 00_要求定義.md。
- 即時対応の修正（現 PR ブランチ）＋テスト結果。

---

## エラーハンドリング（メッセージ設計）

- **既存ディレクトリ未検出**: issue_dir_hint を指定したが該当ディレクトリが存在しない場合 → **「指定されたディレクトリが見つかりません。ディレクトリ名を確認するか、未指定で新規作成してください。」** をユーザーに返す。runtime 配下に不完全なディレクトリを作成しない。
- **指摘一覧が空**: review_comments_raw が空または有意な指摘を 1 件も抽出できなかった場合 → 00_要求定義.md に **「指摘一覧が空です。手動で指摘を追加するか、review_comments_raw を再入力してください。」** を明記し、受け入れ基準に「指摘一覧が 1 件以上埋まっていること」を含める。トリアージ表は 0 行。
- **PR URL 不正**: PR 番号を抽出できない場合 → 00_要求定義.md の参照元に **「PR を一意に特定できるか不明です。有効な PR URL を確認してください。」** を明記する。処理は継続し、ディレクトリ名のプレフィックスは「PR不明」等のフォールバックを用いてよい。
- **テストゲート不成立**: 即時対応後にテストが green を維持できない／実行不能で green を確定できない → 軽微判定を取り消し起票側または再評価へ回す（上記ステップ 3-1）。

---

## 参照

- commands/create-pr-review-issue.md（3 ステップフローの chain）
- [OUTPUT_FORMAT.md](./OUTPUT_FORMAT.md)（`Disposition`・`TriageRow`・起票条件 C1〜C5・security の正本）
- [00_TEMPLATE_MAPPING.md](./00_TEMPLATE_MAPPING.md)（disposition・承認記録の 00 一本化マッピング）
- `skills/agent/run_command.md`（§Forbidden「サブによる独断起票」・Execution Path Rule。横断ルールの正本）
- `boot/CORE.md`・`workflow/PHASES.md`（起票・Go 判断の正本）
- `scripts/create-pr-review-issue-dir.sh`（起票 disposition 時のみ用いるディレクトリ決定・作成。本改定で変更しない）
- workflow/TEMPLATES.md（00_要求定義のテンプレート）
