# PLAN: ゲート差し戻しのラウンド予算と非追記型の是正方針

- Issue: `ISSUE-786`
- 対応する DESIGN: `DESIGN.md`

## 実装方針・制約

既存 `review.round_limit`、round導出、cutoff、取得不能fallbackを変更せず、配布契約・分類後の判定集約・制御レコードの信頼境界とその検査だけを追加する。レビュアが提出するraw sub-verdictは書き換えず、判定は有効sub-verdictから1箇所で再計算する。実装中に別カウンタ、別設定、降格台帳、制御レコード用の別actor一覧が必要に見えた場合は範囲を拡張せず、対象SHA・再現コマンド・終了コード・該当assetを報告して停止する。accepted ADR-0068と承認済みSPECは編集しない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 最終round事前宣言 | `gate-review/SKILL.md`、state/gate証跡schema、verdict記録・review起動経路へ、最終roundを開始させるreject時の耐久宣言と直前attempt・作成順序・digest結線を追加。レビュー開始後/結果後の追加・上書きを拒否し、宣言をround導出へ使わない | AC-1, AC-2, AC-6, AC-8 | なし |
| 2 | finding現行追跡 | gate-report findingとGitHub分類記録へ元/分類後severity、理由、4類型外根拠、raw evidence、follow-upを同居させ、`record-verdict`がcurrent record単独で検証 | AC-3〜AC-6 | #1 |
| 3 | 制御レコードの投稿者束縛 | 宣言・分類記録のコメントrecordへ投稿者を持たせ、`execution.trusted_reviewer_actors`で採否を束縛。非trustedは採用せず停止もさせない。作成側の重複検査と解決側の件数検査を同一の絞り込み集合に揃える | AC-2, AC-5, AC-6, AC-8 | #1, #2 |
| 4 | 分類後の判定集約 | 有効sub-verdictの4条件導出と、`rejected`・`approved`・`human_required`の再計算を集約の1箇所へ実装。raw値は書き換えず`subverdict_reclassification`へ併記し、gate-report schemaへ任意フィールドを追加 | AC-3〜AC-6, AC-8 | #2, #3 |
| 5 | worker契約・報告 | `roles.yaml`の4 workerへ非追加手段の優先と必要追加の例外条件を配布し、worker-report schema・`report status`へremediation種別と必要追加理由の条件検査を追加 | AC-7 | なし |
| 6 | 契約単体検査 | 事前宣言の正常遷移、宣言なし/開始後/結果後/上書き、投稿者束縛、有効sub-verdictの4条件を単独で崩した入力、current finding記録、4類型、常時blocking、理由なし必要追加、fallback、誤配布禁止を検証 | AC-1〜AC-8 | #1〜#5 |
| 7 | 配布検査 | init/upgradeのstandard・lightweight fixtureでskill、roles、schemaの展開と同期を検証 | AC-1, AC-2, AC-7, AC-8 | #1〜#6 |
| 8 | 回帰検査 | 既存gate round/evidence/judgmentテスト、build、lint、template syncを実行し、ゲート品質・raw sub-verdictの記録・既存fallbackの不変を確認 | AC-3, AC-4, AC-6, AC-8 | #6, #7 |

## 検証計画

- 常時: `npm run build`、対象unit/integration test、`npm test`、`git diff --check`。
- 規範文書: `lint-references.sh`、`lint-vocab.sh`、`verify-doc-length.sh`。
- 配布: `verify-template-sync.sh` とstandard/lightweightのinit/upgrade integration test。
- ADR: `proposed` の ADR-0077 を追加するため、`adr-lint.sh check` で採番の一意性・`related_adrs` のstale参照が無いこと・accepted ADR-0068 を変更していないことを確認する。
- 判定集約: 有効sub-verdictの4条件（宣言成立・raw `inconclusive` false・未分類blockingの不在・failのfinding裏付け）をそれぞれ単独で崩した入力で `approved` にならないこと、4条件成立時のみ `rejected` が解消すること、raw値が現行記録に残ること、有効sub-verdictを記録した `approved` が既存のpublish整合検査を通ることを検証する。
- 反証ケース: round取得不能、宣言なし・レビュー開始後/結果後の追加・上書き、直前attempt/digest不一致、非trustedな投稿者による宣言・分類記録、非trusted記録単独でのゲート停止、current recordの元severity欠落・raw evidence変更、判定不能を表明したattempt、未分類blockingの残存、follow-up永続化失敗、データ喪失・セキュリティ低下、理由なし必要追加、worker 1ロールだけの契約欠落をそれぞれ失敗または安全側停止として検証する。

## 障害時・ロールバック

schemaまたは配布検査が既存consumer fixtureを壊した場合、任意フィールドと契約追加を同一変更単位で戻し、既存 `round_limit` とruntimeには触れない。判定集約の欠陥が見つかった場合は、有効sub-verdictの導出条件と `subverdict_reclassification` を戻せばraw値による従来判定へ復帰する。実装順序だけの変更はPLANを更新し、配置・責務・永続化境界を変える場合はDESIGNを更新してdesign-gateを再通過する。

## 完了条件・未決事項・対象外

変更単位1〜8が完了し、AC-1〜AC-8の自動証跡が揃い、差分が本計画のassetとテストに限定されることを完了条件とする。未決事項はない。Issue #745の降格台帳・worker除外、別round counter、新設定項目、制御レコード用の別actor一覧・署名鍵、accepted ADR変更、ゲート・レビュア・検査・quick境界の緩和は対象外とする。
