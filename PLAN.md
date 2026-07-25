# PLAN: ローカル独立レビュー証跡方式への変更

- Issue: `ISSUE-271`
- 対応SPEC/DESIGN: `SPEC.md` / `DESIGN.md`

## 変更単位

| # | 変更 | 対応AC |
|---|---|---|
| 1 | manifest/schema/規範文書をlocal execution・trusted Review API evidenceへ更新 | AC-1, AC-2, AC-7 |
| 2 | worker reportへlease holder由来run IDを結線 | AC-4 |
| 3 | gate reportへ検証済みreviewer metadataを追加 | AC-3, AC-4, AC-5 |
| 4 | trusted CLIにevidence作成・Review API送信・取得検証・集約を実装 | AC-3, AC-4, AC-5 |
| 5 | Codex/Claude adapterをローカルevidence送信へ結線し、未登録adapterを拒否 | AC-2, AC-6 |
| 6 | gate workflowからmodel実行・provider secretを除去しverify/publishだけにする | AC-1, AC-7 |
| 7 | workflow templateと展開結果、ADR、role contractを同期 | AC-1, AC-2, AC-7 |
| 8 | 攻撃経路・回帰テストと独立検証を実施 | 全AC |

## 実装順序

1. schemaと型を先に追加し、旧データの読み取り互換を確認する。
2. evidenceのcanonical化、digest、metadata検証、集約をpure functionとして実装する。
3. GitHub API I/Oを薄いcommand境界に置き、stubで投稿・取得を検証する。
4. adapterは既存model起動後のverdict送信先だけをbackend別に切り替える。
5. workflowを検証専用へ縮小し、template syncを取る。
6. API key/Codex Action/self-hosted依存の残存を静的検査する。

## テスト

- 単体: classifier、capability、canonical digest、actor/SHA/run ID/slot、Strict集約。
- 結合: Review API投稿→workflow相当取得→gate report→Check Run。
- 攻撃: branch内偽証跡、未登録actor、dismissed review、API commit ID不一致、古いSHA、prompt/artifact改変、自己run ID、slot重複、Strict 1件。
- adapter: Codex exact model/effort/read-only、Claude attestation/probe、Cursor拒否、通常選択維持。
- 必須: build/typecheck、全test、doc/vocab/reference/ADR/secret/SAST、template sync、shell syntax。

## checkpoint・役割

- design: 本DESIGN/PLAN/ADRをcommit・push後、read-only独立レビュー。
- implementation: worker leaseでcode/test/templateをcommit・push後、別runのread-onlyレビュー。
- validation: validation leaseで全検査を再実行し、VALIDATION.mdとログをcommit・push後、別runのread-onlyレビュー。
- reviewerはbranchを変更せず、writerはReview API証跡を投稿しない。進行役は成果物内容を裁定しない。

## 障害時

証跡authenticityをGitHub API metadataとrole credential境界へ結線できない、またはgate正本の循環停止が発生した場合、成功扱いや手動ファイル注入で迂回せず `human_required` と依存Issueを保存する。
