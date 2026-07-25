# PLAN: 非coreのStrictゲートで独立レビュア2体を強制する

- Issue: `ISSUE-277`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力

承認済みSPEC/DESIGNを入力とし、Strict session、2 slot launcher、trusted aggregation、schema証跡、adapter通知、回帰テストを出力する。core専用モデル選択は入力にも出力にも含めない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | report契約 | optional profile・invocation・reviewers schema/typeを追加 | AC-1, AC-2, AC-4 | なし |
| 2 | session準備 | 固定slot、UUID、private manifest、one-time消費を実装 | AC-1, AC-2 | #1 |
| 3 | trusted集約 | binding、独立性、優先順位、artifact一致、証跡保存を実装 | AC-1, AC-2 | #1, #2 |
| 4 | launcher分岐 | Standard direct pathを維持しStrictだけ2 subprocess起動 | AC-1, AC-3, AC-4 | #2, #3 |
| 5 | adapter結線 | prompt/human通知へ自slot provenanceを追加 | AC-1, AC-3 | #4 |
| 6 | workflow配布 | launcher契約とtemplate/展開先同期を検証 | AC-2, AC-5 | #3〜#5 |
| 7 | 自動テスト | 正常・不足・重複・replay・binding・混合・provider・Standardを検査 | AC-1〜AC-5 | #1〜#6 |
| 8 | 独立検証 | 全AC証跡、全回帰、PR #274差分境界をVALIDATIONへ記録 | AC-1〜AC-5 | #7 |

## PR #274との適用順序

- #280が先: #274をmainへrebaseし、core専用2 Actionの結果を`aggregate-strict`へ結線する。
- #274が先: #280をmainへrebaseし、core分類・能力選択を保持したまま件数だけの集約を置換する。
- どちらの場合もcore/ordinary分類は#274、2 slot provenanceと最終集約は#280の責務とし、片方を複製しない。

## テスト適用性

- 常時必須: 型検査、unit/integration、文書・語彙・参照・ADR・secret・template sync。
- 並行性: 2 slotの起動markerで両invocationが別processであることを検査する。
- 障害系: 1件、重複、replay、別SHA、片側error/deferred、混合final、cleanup失敗を検査する。
- provider: Claude Code/Codex/humanの実モデルを呼ばずstubで起動回数とfail-closedを検査する。
- 権限: reviewerが成果物とpeer resultを書かず、trusted CLIだけが最終reportを更新することを検査する。

## checkpoint・完了条件・見直し

design成果物とproposed ADRをcheckpoint後、read-only design gateを通す。承認後は専用ADR finalization leaseでstatusだけを更新する。implementationは文書を変更せず実装・自動テストをcheckpointし、validationで全証跡を保存する。責務・schema・集約優先順位を変える場合はDESIGN再承認を要する。
