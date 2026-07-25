# PLAN: ローカル独立レビュー証跡方式への変更

- Issue: `ISSUE-271`
- 対応SPEC/DESIGN: `SPEC.md` / `DESIGN.md`

## 変更単位

| # | 変更 | 対応AC |
|---|---|---|
| 1 | manifest/schema/規範文書をlocal execution・trusted Review API evidenceへ更新 | AC-1, AC-2, AC-7 |
| 2 | gate reportへ検証済みreviewer metadataを追加 | AC-3, AC-4, AC-5 |
| 3 | trusted CLIにevidence作成・Review API送信・取得検証・集約を実装 | AC-3, AC-4, AC-5 |
| 4 | Codex/Claude adapterをローカルevidence送信へ結線し、未登録adapterを拒否 | AC-2, AC-6 |
| 5 | gate workflowをbase trust rootのverify/publish専用へ変更 | AC-1, AC-3, AC-7 |
| 6 | 配布template/root展開物を同期し、init/upgradeの安全なconsumer移行を実装 | AC-1, AC-7 |
| 7 | ADR、role contract、bootstrap依存を同期 | AC-1, AC-2, AC-7 |
| 8 | 攻撃経路・互換性・回帰テストと独立検証を実施 | 全AC |

## 実装順序

1. 任意schema blockと型を先に追加し、block無し旧manifest/reportの読み取り互換とrollbackを確認する。
2. evidenceのcanonical化、digest、metadata検証、集約をpure functionとして実装する。
3. GitHub API I/Oを薄いcommand境界に置き、stubで投稿・取得を検証する。
4. adapterはprotected base/pinned packageからだけ起動し、model verdict送信先をbackend別に切り替える。
5. workflowを検証専用へ縮小し、template syncを取る。
6. upgradeの事前同期検査から安全置換/全体no-opを実装し、initも検証する。
7. API key/Codex Action/provider CLI/self-hosted依存の残存を静的検査する。

## テスト

- 単体: classifier、capability、canonical digest、actor/SHA/run ID/slot、Strict集約。
- 結合: Review API投稿→workflow相当取得→gate report→Check Run。
- 攻撃: PR変更recorder/verifier/allowlistの不使用、branch内偽証跡、未登録actor、同一writer/recorder actorの正当なattestation、同一actorのattestation欠落・改変、commit actor未解決、dismissed review、API commit ID不一致、古いSHA、prompt/artifact/launcher改変、slot重複、Strict 1件。
- adapter: Codex exact model/effort/read-only、Claude attestation/probe、Cursor拒否、通常選択維持。
- distribution: legacy同期済みconsumerの修復、customized workflow競合時の全体no-op、dry-run、init、template sync、provider credential/inference依存0件。
- 必須: build/typecheck、全test、doc/vocab/reference/ADR/secret/SAST、template sync、shell syntax。

## checkpoint・役割

- design: 本DESIGN/PLAN/ADRをcommit・push後、read-only独立レビュー。
- implementation: worker leaseでcode/test/templateをcommit・push後、別runのread-onlyレビュー。
- validation: validation leaseで全検査を再実行し、VALIDATION.mdとログをcommit・push後、別runのread-onlyレビュー。
- reviewerはbranchを変更せずverdictだけを返し、writer roleはReview API証跡を投稿しない。進行役のtrusted recorderが証跡をCoordination Backendへ保存するが、成果物内容を裁定しない。

## 障害時

証跡authenticityをbase trust root・GitHub API metadata・role credential境界へ結線できない、upgrade競合、またはgate正本の循環停止が発生した場合、成功扱いや手動ファイル注入で迂回せず `human_required` と依存Issue（bootstrapは#283）を保存する。
