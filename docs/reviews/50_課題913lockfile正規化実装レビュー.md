# 課題913 lockfile正規化実装レビュー

> 状態: `ready-for-pr`。trusted品質契約の保護snapshotからpackage自身のversionだけを正規化して除く変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `61c6d693c20163518120d9623fb597704668a060` |
| H_impl | `839dc99f7a74b81fce536cecd77ec44540f31776` |
| H_impl tree | `56f98f8a0c39f4193f77d70aec0df4ddc5d7836d` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

**自動releaseがmainのversionを上げると、その時点でopenな全PRの`base validatorで品質自己緩和を拒否`が失敗する。** PR #909とPR #912で観測した。

## 真因（Major）

`PROTECTED_FILES`に`package-lock.json`が含まれ、`protectedSnapshot`が**全内容のSHA-256**を取る。release bump commitは`package.json`と`package-lock.json`の両方のversionを書き換えるため、追随していない全PRで`file:package-lock.json`のhashがtrustedと不一致になる。

`actualChanges`が非空になると事前登録済みproposalとの完全一致を要求するため、**内容がversion文字列だけの差分でも「品質契約の無断変更」と判定される。**

**非対称であった。** `package.json`の`version`は`PROTECTED_PACKAGE_FIELDS`に含まれていない。lockfileだけがpackage自身のversionを保護対象に含めていた。

## 対処

`normalizeLockfileForProtection`を追加し、hash前に次だけを取り除く。

- lockfile最上位の`version`
- `packages`の空keyのentryの`version`

`lockfileVersion`、dependencyのversion、`resolved`、`integrity`、dependencyの追加・削除は**取り除かない。** 保護の目的はdependency構成とintegrityの自己緩和防止であり、それは維持する。

## 実測による確認

candidateを一時treeへ複製し、mainをtrusted rootとして3ケースを評価した。

| ケース | 結果 |
|---|---|
| 無改変 | `valid: true` |
| **package自身のversionだけ変更（release bumpと同型）** | **`valid: true`。本修正の目的** |
| dependencyの`integrity`を改竄 | `valid: false`。`versioned staged proposal`を要求する |

## 2段階適用

是正対象の`scripts/check_project_quality.ts`自身が`PROTECTED_FILES`である。したがってPRを2本に分けた。

| 段階 | PR | 内容 |
|---|---|---|
| 1 | #914 | `TQP-LOCKFILE-VERSION-NORMALIZATION-001`をbaseへ登録する。protected fileを変更しない |
| 2 | 本PR | 正規化を適用し`agentSkillChain.qualityContractVersion`を2から3へ上げる |

`品質契約を有効化するPRで新規proposalを同時登録できません`により1本にまとめられない。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_project_quality.ts` | M | package maintainer | 検査 | lockfileのhash前正規化と、正規化関数のexport | 既存依存のまま。`parseJsonStrict`と`stableJson`を再利用する | REQ-SQ-010、AC-SQ-010、QLT-LOCKPROT-001 | 正規化を戻せば旧挙動へ復帰する。#914のproposal取り消しでrollbackする | pass |
| `package.json` | M | package maintainer | 品質契約 | `agentSkillChain.qualityContractVersion`を2から3へ上げる | なし | REQ-SQ-010 | 2へ戻せば旧契約へ復帰する | pass |
| `test/features/unit/lockfile-protection.feature` | A | package maintainer | test | 正規化の同値・非同値と、契約check全体の合否を反例で固定する | featureからstep定義への参照のみ | SCN-UNIT-LOCKPROT-001〜008 | 反例が消えるとdependency改竄の見逃しへ戻る余地が生じる | pass |
| `test/steps/lockfile-protection.steps.ts` | A | package maintainer | test | 上記featureのstep実装 | `check_project_quality`と一時fixtureだけへ依存 | 同上 | 外部writeを行わない | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | repository maintainer | 仕様 | REQ-SQ-010を一覧へ追加する | 一覧から各所への片方向参照 | REQ-SQ-010 | 行を戻せば旧一覧へ復帰する | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | repository maintainer | 仕様 | REQ-SQ-010の本文と受け入れ条件を定義する | 同上 | REQ-SQ-010 | 同上 | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | repository maintainer | 仕様 | QLT-LOCKPROT-001として保護境界の目的整合を定義する | 同上 | REQ-SQ-010 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | repository maintainer | 仕様 | 追加SCNを追跡表へ追記する | 追跡表から各所への片方向参照 | REQ-SQ-010 | **#881の統合モデルに従う。課題別fileを作らない** | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | repository maintainer | 仕様 | 本変更を記録する | 同上 | REQ-SQ-010 | 行を戻せば旧履歴へ復帰する | pass |

Gitの`61c6d693c20163518120d9623fb597704668a060..839dc99f7a74b81fce536cecd77ec44540f31776`に含まれる9 pathと表の9行は重複なし・欠落なしで一致する。

## ゲート実測

coordinator環境（sandbox外）で実行した。

| コマンド | 結果 |
|---|---|
| `npm run project:quality` | 合格 |
| `npm run quality` | 合格 |
| `npm run docs:format` | 合格 |
| `npm run test:format` | 合格 |
| `npm run trace:check` | 合格 |
| `npm run architecture:check` | 合格 |
| `npm run conformance:check` | 合格 |
| `npm run package:check` | 合格 |
| `npm run workflow:check` | 合格 |

`npm test`は**711 scenarios (711 passed)**。

## 外部レビューの状態

本PRのCodeRabbitレビュー状態はmerge時に記録する。`rate limited`の場合、checkは`pass`と表示されるがレビューは実行されない。repository ownerの確定事項により、`rate limited`のときは待たずにmergeし、その事実を記録する。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 3ケースの実測で、version差分は通り、integrity改竄は拒否されることを確認した |
| 価値・実現可能性 | pass | 自動releaseのたびに全open PRが落ちる状態が解消する |
| 整合性 | pass | `package.json`の`version`が保護package fieldでないことと扱いが一致した |
| 安全性 | pass | dependency構成・integrity・`lockfileVersion`の保護は不変。反例testで固定した |
| 保守性 | pass | 正規化は1関数へ閉じ、exportして直接test可能にした |

## 対象外

- `PROTECTED_FILES`からの`package-lock.json`除外。保護目的は維持する。
- 自動releaseの発火条件。Issue #879で配布digestへ変更済みである。
