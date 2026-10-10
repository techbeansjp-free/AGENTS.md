---
name: step-11-pr
description: 承認済みexact-headでPRを作成し、modeとtrusted delivery policyに従ってmergeまたは明示停止まで進行する。
---

# ステップ11: PR作成とdelivery進行

入力は承認済みStep 10、同じ対象HEADの検証記録、固定repository・Issue・head/base、trusted delivery policyと操作authority。finalizerは製品・計画・review判断を変更しない。`workflow advance --staging=<staging>`のpreviewとhandoffを照合して開始する。

## PR作成の実行順

1. 以下のtemplate契約に従い、確定済み要求・変更差分・`review export`の証跡から本文と事前確認を作る。既存のreview/verification証拠を参照し、同じHEAD・policy・scopeに対する調査やtestを再実行しない。不一致・欠測・最新失敗があればStep 10へ戻す。独立reviewの代行や自己承認をしない。
2. `pr create --help`を一度全文読み、掲載された`--evidence`の入力例と必須引数を使う。rootから段階的にhelpを探索せず、先頭だけを切り出して型を実装ソースで探さない。Evidenceの各値は実際の承認・検証・仕様証拠に対応させる。`no-spec-impact`は文言等の限定された変更に限り、対象範囲を限定した12文字以上の`spec.rationale`を記録する。
3. exact HEADをpushした後、同じstagingを指定して`pr create ... --dry-run`を実行し、成功した入力と操作authorityで`--apply`へ進む。CLIがStep 4/10、sync、seal、trusted policy、独立性、exact HEAD、remote、本文、provider read-backを検証する。journalやdelivery stateを手で作成・修正しない。拒否時は診断された不一致を解決する。
4. `poc`と`merge.mode=disabled`はPRで停止する。PoCはその旨と期限をPR本文に保持する。PR URLだけで完了を宣言せず、CLIが固定PR bindingと`outcome=pull-request`のStep 11終端を記録したことを確認する。merge・Issue手動終了・branch削除・release・cleanupを追加しない。

## merge・復旧が必要な場合

full/quickの`assisted`または`automatic`では、create前に[Delivery詳細契約](delivery-details.md)を全文読み、policyとauthorityに従って継続する。`merge-observed`のauto-merge/queue登録は終端ではなく、providerのmerged read-back後だけStep 11を記録する。assistedで必要authorityがなければ再開条件を返す。

通信失敗・応答不明・`reconciliation-required`、既存PRの再固定、外部merge取り込み、終端後のredeliveryでは、同じ[Delivery詳細契約](delivery-details.md)の該当段落を操作前に読む。外部create/mergeを盲目的に再送せず、provider read-backと保存済みintentから復旧する。CLIが示す復旧以外のjournal/state書換えは行わない。

## role・tier入力契約

PR作成前にcoordinator、analyst、implementer、reviewer、verifier、finalizerの担当記録、implementerとreviewerがproject policyの`merge.reviewIndependence`の要求水準を満たすこと（未宣言の既定は`context-isolated`であり、別session/contextなら同一GitHub actorでも成立する）、reviewerの非変更証拠、verifierの独立検証、必要model tierとmappingを確認する。不明なrole・tier・独立性証拠をmodel能力やPR作成authorityで補わず、fail-closedで停止する。担当finalizerは要件とproductを変更せず、承認済みreview結果を改変しない。

## テンプレート契約

作業開始前に[プルリクエスト事前確認](../../templates/issue/11_プルリクエスト事前確認.md)と[プルリクエスト本文](../../templates/issue/11_プルリクエスト本文.md)を全文読む。前者の全項目を満たして事前表示・操作authorityを確認した後、後者の見出し構造と必須欄を使って本文を作成する。自由形式の本文で代替しない。
