# PLAN: ローカル独立レビュー証跡方式への変更

- Issue: `ISSUE-271`
- 対応SPEC/DESIGN: `SPEC.md` / `DESIGN.md`

## 変更単位

| # | 変更 | 対応AC |
|---|---|---|
| 1 | manifest/schema/規範文書をlocal execution・trusted Review API evidenceへ更新 | AC-1, AC-2, AC-7 |
| 2 | gate reportへ検証済みreviewer metadata・attempt/evidence digestを追加 | AC-3, AC-4, AC-5 |
| 3 | trusted CLIにone-time token、evidence作成・Review API送信・latest attempt集約・Check cache復元を実装 | AC-3, AC-4, AC-5 |
| 4 | Codex/Claude adapterをローカルevidence送信へ結線し、未登録adapterを拒否 | AC-2, AC-6 |
| 5 | gate workflowをbase trust rootのverify-onlyへ変更し、reconcileをrollout待ちno-opにする | AC-1, AC-3, AC-7 |
| 6 | 配布template/root展開物を同期し、init/upgrade fixtureの安全なasset移行を実装 | AC-1, AC-7 |
| 7 | ADR、role contract、bootstrap依存を同期 | AC-1, AC-2, AC-7 |
| 8 | default-main dispatch・専用App in-progress Check・attestation・success-last recorderを実装 | AC-3, AC-5, AC-8 |
| 9 | 攻撃経路・互換性・回帰テストと独立検証を実施 | 全AC |
| 10 | self-repository sentinelとrelease workflow preflightで#274単体releaseを機械停止 | AC-7 |

## 実装順序

1. 任意schema blockと型を先に追加し、block無し旧manifest/reportの読み取り互換とrollbackを確認する。
2. evidenceのcanonical化、attempt選択、digest、metadata検証、集約をpure functionとして実装する。
3. GitHub API I/Oを薄いcommand境界に置き、stubで投稿・取得を検証する。
4. adapterはprotected base/pinned packageからだけ起動し、model verdict送信先をbackend別に切り替える。
5. workflowを検証専用へ縮小し、template syncを取る。
6. upgradeの事前同期検査から安全置換/全体no-opを実装し、initも検証する。
7. API key/Codex Action/provider CLI/self-hosted依存の残存を静的検査する。
8. 専用App recorderをdefault-main dispatchへ限定し、Check ID/run tuple attestationとsuccess-lastを反証する。
9. GitHub trusted policy resolverでpolicy欠落を構造化`human_required`へ閉じ、ordinary consumerの正式互換はIssue #287へ分離する。

## テスト

- 単体: classifier、NUL/invalid UTF-8 path、capability、canonical digest、present/absent domain separation、actor/SHA/run ID/slot、Strict集約。
- 結合: Review API投稿→workflow相当取得→gate report→Check Run。
- 攻撃: PR変更recorder/verifier/allowlistの不使用、branch内偽証跡、未登録actor、writer/recorder同一actor、専用recorder token欠落・AI subprocess漏洩、GitHub credential/env/origin/ambient隔離root非継承、非default base、one-time token無し直接submit・token再利用、same-SHA旧/new attempt、新attempt不完全、commit actor未解決、101件以上のAPI pagination、dismissed review、API commit ID不一致、古いSHA、prompt/artifact/launcher改変、Claude ambient model証跡改変、空/部分artifact集合、fail finding欠落、slot重複、Strict 1件。
- adapter: Codex exact model/effort/read-only固定argvとcore完全command上書き拒否、Claude管理主体trust rootのattestation/probeと完全command上書き拒否、local Strict 2独立process・fresh workspace、Cursor拒否、通常選択維持。
- distribution: legacy同期済みfixtureの修復、customized workflow競合時の全体no-op、dry-run、init、template sync、legacy gate/reconcileのChecks書込み・Check API・candidate reconcile 0件、provider credential/inference依存0件。任意consumerのCLI可搬性はIssue #285で追跡する。
- rollout: self-repository限定sentinel有りではcheckout以外のnpm/build/version/bump/tag/publish実行数を0にし、sentinel無しでは従来release経路と`[skip ci]` job guardを維持する。sentinelをpackage・`init`・`setup`・`upgrade`でconsumerへ配らないことも検査する。Issue #283のtrusted rollout完了commitはsentinel削除とself-repository専用release workflowの`setup github`配布集合からの分離を同時に行い、最初のreleaseへIssue #271/#283の両変更を含める。policy無しconsumerはGitHub trusted境界でhuman_requiredとし、正式なprovision/migration BDDはIssue #287で追跡する。
- recorder: payload allowlist、actions readの最小権限、actor権限、App未構成、標準Actions App、stale head、Check replay、signer workflow/ref/digest、run tuple、状態書込み前回復、48KiB境界、terminal PATCH response非parse、success後検査0件。
- 必須: build/typecheck、全test、doc/vocab/reference/ADR/secret/SAST、template sync、shell syntax。

## checkpoint・役割

- design: 本DESIGN/PLAN/ADRをcommit・push後、read-only独立レビュー。
- implementation: worker leaseでcode/test/templateをcommit・push後、別runのread-onlyレビュー。
- validation: validation leaseで全検査を再実行し、VALIDATION.mdとログをcommit・push後、別runのread-onlyレビュー。
- reviewerはbranchを変更せずverdictだけを返し、writer roleはReview API証跡を投稿しない。進行役のtrusted recorderが証跡をCoordination Backendへ保存するが、成果物内容を裁定しない。

## 障害時

証跡authenticityをbase trust root・GitHub API metadata・role credential境界へ結線できない、upgrade競合、またはgate正本の循環停止が発生した場合、成功扱いや手動ファイル注入で迂回せず `human_required` と依存Issue（bootstrapは#283）を保存する。
