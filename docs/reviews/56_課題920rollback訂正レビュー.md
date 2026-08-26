# 課題920 rollback訂正レビュー

> 状態: `ready-for-pr`。登録済み品質proposalの実行不可能なrollback手順を訂正する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `1215ed2fccc86e06bcb1e3a7a2a85dd290f9b69e` |
| H_impl | `a2087200119c9928f25e0797d536a83b136063cf` |
| H_impl tree | `9eb40feb01281d57e1b0cf0ad151ea54a23d656a` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

PR #925で記述fieldの更新が可能になった。**本PRはその機構を使い、訂正できずに残っていた正本を訂正する。** Issue #920の最後の受け入れ条件である。

## 訂正対象の洗い出し

registry内の全5件を点検した。**3件が実行不可能な手順を持っていた。** うち2件はIssue #920の起票時点で未検出であった。

| proposal識別子 | 訂正前 | 判定 |
|---|---|---|
| `TQP-QUALITY-SCAN-BOUNDARY-001` | 本proposalをregistryから取り消し、除外追加前の走査範囲へ戻して全品質検査を再実行する | **実行不可能。** 削除が拒否される |
| `TQP-WORKFLOW-STEP-GATE-001` | 本proposalをregistryから取り消し、prepack連鎖から`workflow:check`を除いた10 gate構成へ戻して全品質検査を再実行する | **実行不可能。** 同上 |
| `TQP-LOCKFILE-VERSION-NORMALIZATION-001` | 本proposalをregistryから取り消し、正規化前の全内容hashへ戻して`qualityContractVersion`を2へ復帰し、全品質検査を再実行する | **実行不可能。** 削除もversion減少も拒否される |
| `TQP-DOGFOODING-DOCTOR-CI-001` | 登録済みproposalは削除・変更できず…（前進手順） | 実行可能。ただし「変更できず」は#925で古くなった |
| `TQP-PROPOSAL-DESCRIPTION-FIELDS-001` | 前進手順 | 実行可能。訂正不要 |

## 訂正内容

3件を前進手順へ書き換え、1件の陳腐化した文言を是正した。全て次を含む。

- 登録済みproposalは削除できず`qualityContractVersion`の減少も受理されないこと
- rollbackは当該変更を戻す**新規proposalを次版として登録し2段階で適用する**こと
- validatorを経由しない緊急手順は、repository ownerがprotected設定を一時的に外して直接revertし、その事実と復旧を記録すること

`TQP-DOGFOODING-DOCTOR-CI-001`は「削除・変更できず」を「削除できず。契約fieldも変更できない」へ是正した。#925以降、記述fieldは変更できる。

## 本PRが成立すること自体が検証である

**本PRは、#925以前であれば`trusted品質proposalは削除・変更できません`で拒否されていた。** mainのvalidatorで`valid: true`・`errors: []`を確認しており、これが#925の機構が意図どおり動く実測証拠である。

契約fieldは1件も変更していない。`rollback`だけを更新した。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約 | 4件の`rollback`を実行可能な前進手順へ訂正する | registryから各所への片方向参照 | REQ-SQ-012 | 記述fieldのみの変更であり、契約fieldとtargetsは不変。文言を戻す再訂正も同じ経路で可能である | pass |

Gitの`1215ed2fccc86e06bcb1e3a7a2a85dd290f9b69e..a2087200119c9928f25e0797d536a83b136063cf`に含まれる1 pathと表の1行は重複なし・欠落なしで一致する。

## ゲート実測

coordinator環境（sandbox外）で実行した。`origin/main`をdetached worktreeへ展開し、それをtrusted rootとしてcandidateを評価した。

| コマンド | 結果 |
|---|---|
| base validator（mainをtrusted rootとする） | 合格。`valid: true`、`errors: []` |

## 外部レビューの状態

本PRのCodeRabbitレビュー状態はmerge時に記録する。`rate limited`の場合、checkは`pass`と表示されるがレビューは実行されない。

### `rate limited`時のmerge例外

| 項目 | 値 |
|---|---|
| 承認元 | repository ownerの明示指示 |
| 対象scope | 本repositoryのPR全般 |
| 承認者 | repository owner |
| 理由 | `rate limited`中は待機してもレビューが実行される保証がない |
| 承認日時 | 2026-08-26 |
| 失効日時 | 未設定 |
| 記録先 | 各PRのreview artifactの本節 |

この例外を正本へ移す作業はIssue #921で扱う。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | registry全5件を点検し、実行可能性を1件ずつ判定した |
| 価値・実現可能性 | pass | 事故時に読まれる手順が実行可能になった。**起票時に把握していなかった2件も是正した** |
| 整合性 | pass | 契約fieldとtargetsを1件も変更していない |
| 安全性 | pass | 記述fieldのみの変更であり、validatorの拒否条件を1つも緩めていない |
| 保守性 | pass | 全件で同じ構造の手順に揃えた |

## 対象外

- proposal registryのschema変更。
- 契約fieldの変更。
