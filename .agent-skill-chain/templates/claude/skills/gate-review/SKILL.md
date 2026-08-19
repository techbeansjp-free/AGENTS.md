---
name: gate-review
description: Run conformance and falsification review for a completed agent-skill-chain segment (spec-gate, design-gate, implementation-gate, or validation-gate) and record the verdict.
when_to_use: Use when a segment worker has finished a segment and gate review should be performed before moving to the next segment or merging the PR.
---

# gate-review

## 目的

各セグメント完了時に、立証(conformance)＋反証(falsification)の2観点レビューでゲートを通過させる（AGENTS.md 不変条件I2）。ローカルモードでは不変条件、GitHubモードでは自動CI強制の無いガイドラインであり、実施要否は進行役が判断する。

## 対象範囲

1つのゲート（spec-gate / design-gate / implementation-gate / validation-gate）に対する、レビュア起動から判定記録までを担当する。次セグメントの起動・差し戻し先の決定・マージ可否の判断は進行役が行う（本スキルの対象外）。

## 前提

- 対象セグメントの成果物がcommit・push済みであること（`segment-work` スキル完了後）。
- read-onlyのゲートレビュアは複数並列実行できる（writer leaseとは独立）。

## 用語

- **review profile**: Standard（レビュア1体、既定）／Light（人間の明示要求時のみ、危険信号で自動Strict固定）／Strict（`risk != normal` または `autonomy == full`、専任2体）。
- **gate-report**: `.agent-skill-chain/schemas/gate-report.schema.yaml` 準拠の判定記録。
- **round**: 初回をround 0とする同一Issue・同一gateのreview反復。既定は全4 gateで最終round 4、最大5回。

## 入力

- Issue ID、gate_id（`spec|design|implementation|validation`）、review profile、target_sha

## 出力

- gate-report（`conformance`・`falsification`・`final` の判定、blockers一覧）
- GitHubモード: Check Run（`agent-skill-chain/<gate>-gate`）へ発行した場合はその結果。ローカルモード: `reviews/<gate>.yaml`

## 手順

1. `review.round_limit`の既存導出値を使う。値を解決できない場合はroundを推測せず、打ち切り・warning降格・取得不能だけを理由とする`human_required`を適用しない。通常のblocking差し戻しを維持する。
2. rejectされた反復の次が解決済み最終roundになる場合、差し戻しを確定する同じ状態遷移で `.agent-skill-chain/scripts/gate-declare-final-round.sh <issue_id> <gate_id> <pr_number>` を実行する。宣言は次回が最終、直前attempt、最終round、下記4類型、類型外findingのwarning化とfollow-upを含む不変記録であり、round導出元には使わない。
3. `.agent-skill-chain/scripts/gate-review.sh <issue_id> <gate_id> <profile> [target_sha]` を実行する。trusted launcherはreviewer起動前に宣言の作成順序・canonical digest・直前attempt・最終roundを照合する。宣言なし、review開始後/結果後の追加、上書き、digest不一致は`human_required`へ安全側停止する。
4. レビュアはconformanceを先に、falsificationを続けて判定する。Strictは専任2体を独立起動し、両者を集約する。gate・2観点・検査・必要レビュア数・Strict固定・quick境界はroundを理由に減らさない。
5. 最終round後もblockingとするのは、(a)既出blocking未是正、(b)Issue目的の直接阻害、(c)test/build失敗または回帰、(d)データ喪失またはセキュリティ低下だけである。(d)はround・risk・profileにかかわらず常時blocking。1件でも残れば`human_required`とし、進行役の裁量で追加差し戻し・承認を行わない。
6. 4類型外findingは削除せず同じcurrent findingのseverityをwarningにする。GitHubではfollow-up Issue永続化後に`.agent-skill-chain/scripts/gate-classify-finding.sh`を使い、ローカルではgate-reportの同じfindingへ記録する。`reclassification`へ元/分類後severity、理由、4類型外の根拠、未改変のraw evidence、follow-up Issue番号を残す。follow-up永続化前・必須値欠落・raw evidence変更は`human_required`とし、便宜的にblockingへ戻さない。GitHubのraw PR reviewは削除・改変しない。
7. blockingがあれば`finding.origin`を確認して差し戻し先を報告する。`.agent-skill-chain/scripts/gate-publish.sh <issue_id> <gate_report_path>`で発行し、成果物変更時は`gate-reconcile.sh`で当該gateと下流gateを無効化・再照合する。

## 制約

- レビュアはread-onlyであり、成果物の著述・修正は行わない。
- `gate-report`（`.agent-skill-chain/schemas/gate-report.schema.yaml` 準拠ファイル）を、判定結果の記録以外の目的で書き換えない。
- Light profileは人間の `review:light` 等の明示シグナルがある場合のみ適用し、危険信号があれば自動的にStrictへ固定する。
- round budget宣言を追加round counter、別の閾値設定、またはround導出元として使用しない。
- 最終round後の4類型blockingに対する追加修正roundは、人間が回数と条件を明示した場合だけ開始する。

## 完了条件

- 対象ゲートの `final` が確定している（pass、または人間判断への昇格 `human_required`）。
- blockersがある場合、差し戻し先（`finding.origin`）が進行役へ報告されている。

## 検証方法

- gate-reportのスキーマ適合を `.agent-skill-chain/ci/verify-gate-report.sh` で確認する。
- GitHubモードでCheck Runへ発行した場合はCheck Run結果を確認する。

## 未決事項

なし。

## 対象外

- 次セグメントの起動判断、人間判断への昇格判断、マージ条件確認（進行役の責務）。
- 成果物自体の作成・修正（`segment-work` スキルの対象）。
