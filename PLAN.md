# PLAN: ゲート差し戻しのラウンド予算と非追記型の是正方針

- Issue: `ISSUE-786`
- 対応する DESIGN: `DESIGN.md`

## 実装方針・制約

既存 `review.round_limit`、round導出、cutoff、取得不能fallbackを変更せず、配布契約とその検査だけを追加する。実装中に別カウンタ、別設定、降格台帳が必要に見えた場合は範囲を拡張せず、対象SHA・再現コマンド・終了コード・該当assetを報告して停止する。accepted ADR-0068と承認済みSPECは編集しない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 最終round事前宣言 | `gate-review/SKILL.md`、state/gate証跡schema、verdict記録・review起動経路へ、最終roundを開始させるreject時の耐久宣言と直前attempt・作成順序・digest結線を追加。レビュー開始後/結果後の追加・上書きを拒否し、宣言をround導出へ使わない | AC-1, AC-2, AC-6, AC-8 | なし |
| 2 | finding現行追跡 | gate-report findingとGitHub分類記録へ元/分類後severity、理由、4類型外根拠、raw evidence、follow-upを同居させ、`record-verdict`がcurrent record単独で検証 | AC-3〜AC-6 | #1 |
| 3 | worker契約・報告 | `roles.yaml`の4 workerへ非追加手段の優先と必要追加の例外条件を配布し、worker-report schema・`report status`へremediation種別と必要追加理由の条件検査を追加 | AC-7 | なし |
| 4 | 契約単体検査 | 事前宣言の正常遷移、宣言なし/開始後/結果後/上書き、current finding記録、4類型、常時blocking、理由なし必要追加、fallback、誤配布禁止を検証 | AC-1〜AC-8 | #1〜#3 |
| 5 | 配布検査 | init/upgradeのstandard・lightweight fixtureでskill、roles、schemaの展開と同期を検証 | AC-1, AC-2, AC-7, AC-8 | #1〜#4 |
| 6 | 回帰検査 | 既存gate round/evidence/judgmentテスト、build、lint、template syncを実行し、ゲート品質と既存fallbackの不変を確認 | AC-3, AC-4, AC-6, AC-8 | #4, #5 |

## 検証計画

- 常時: `npm run build`、対象unit/integration test、`npm test`、`git diff --check`。
- 規範文書: `lint-references.sh`、`lint-vocab.sh`、`verify-doc-length.sh`。
- 配布: `verify-template-sync.sh` とstandard/lightweightのinit/upgrade integration test。
- ADR: 新規ADRを作らずaccepted ADR-0068を変更しないため、`adr-lint.sh check`で既存整合だけを確認する。
- 反証ケース: round取得不能、宣言なし・レビュー開始後/結果後の追加・上書き、直前attempt/digest不一致、current recordの元severity欠落・raw evidence変更、follow-up永続化失敗、データ喪失・セキュリティ低下、理由なし必要追加、worker 1ロールだけの契約欠落をそれぞれ失敗または安全側停止として検証する。

## 障害時・ロールバック

schemaまたは配布検査が既存consumer fixtureを壊した場合、任意フィールドと契約追加を同一変更単位で戻し、既存 `round_limit` とruntimeには触れない。実装順序だけの変更はPLANを更新し、配置・責務・永続化境界を変える場合はDESIGNを更新してdesign-gateを再通過する。

## 完了条件・未決事項・対象外

変更単位1〜6が完了し、AC-1〜AC-8の自動証跡が揃い、差分が本計画のassetとテストに限定されることを完了条件とする。未決事項はない。Issue #745の降格台帳・worker除外、別round counter、新設定、accepted ADR変更、ゲート・レビュア・検査・quick境界の緩和は対象外とする。
