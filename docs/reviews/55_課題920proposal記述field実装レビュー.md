# 課題920 proposal記述field実装レビュー

> 状態: `ready-for-pr`。登録済み品質proposalの比較対象を契約fieldへ限定する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `ad9f7566a3f203c7c3796486ad40fde1ee63650b` |
| H_impl | `d99896ace2868a2570de33ef3ec144eceaf40c85` |
| H_impl tree | `1fa0be427d4111e43af478e08e2c46c1253f5b31` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

PR #919のCodeRabbitレビューで、`TQP-DOGFOODING-DOCTOR-CI-001`の`rollback`手順が**validatorで実行できない**と指摘された。事実であり同PRで是正したが、**merge済みの`TQP-LOCKFILE-VERSION-NORMALIZATION-001`には同じ誤った文言が残っている。**

## 真因（Major）

`validateTrustedQualityMigration`がtrusted registryのproposalとcandidate側を`stableJson`で**全field比較**していた。

```
if (stableJson(candidateProposal) !== stableJson(trustedProposal))
  errors.push(`${trustedProposal.proposalId}のtrusted品質proposalは削除・変更できません`);
```

不変にすべきなのは**契約の中身**であり、記述fieldではない。記述fieldまで不変にすると、**実行不可能な手順が正本へ残ったまま訂正できない。** 訂正できないため「別の場所に注記する」しかなく、同じ事実が2箇所へ分かれて突合されないという本repositoryの主要欠陥類型を新たに作る。

## 対処

比較対象を契約fieldへ限定した。

| 分類 | field | 扱い |
|---|---|---|
| 契約field | `proposalId`、`status`、`fromVersion`、`toVersion`、`targets` | 不変。変更を拒否する |
| 記述field | `owner`、`rationale`、`rollback` | 値の更新だけを許可する |

削除は`candidateProposal === undefined`で個別に拒否し、診断文言も「削除できません」と「契約fieldは変更できません」へ分離した。**何が起きたのかが診断から判る。**

記述fieldの空文字列化と削除は、既存の`readProposalRegistry`が拒否する。`exactKeys`でfield集合を、`rationale`と`rollback`は12文字以上を要求している。**そのため実装側へ重複した検査を足していない。** 同じ事実を2箇所に持たない。

## 実測

複製したrepositoryのregistryを1件ずつ改変し、8ケースを確認した。

| ケース | 期待 | 実測 |
|---|---|---|
| `rollback`の更新 | 受理 | 受理 |
| `rationale`の更新 | 受理 | 受理 |
| `owner`の更新 | 受理 | 受理 |
| 記述fieldの空文字列化 | 拒否 | 拒否 |
| 記述fieldの削除 | 拒否 | 拒否 |
| `targets`の変更 | 拒否 | 拒否 |
| 契約versionの変更 | 拒否 | 拒否 |
| proposalの削除 | 拒否 | 拒否 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_project_quality.ts` | M | package maintainer | 検査 | 比較対象を契約fieldへ限定し、削除と契約field変更の診断を分離する | 既存依存のまま | REQ-SQ-012、AC-SQ-012、QLT-PROPFIELD-001 | **protected file。** #923で事前登録した`TQP-PROPOSAL-DESCRIPTION-FIELDS-001`で適用する。rollbackは前進proposalで行う | pass |
| `package.json` | M | package maintainer | 品質契約 | `agentSkillChain.qualityContractVersion`を4から5へ上げる | なし | REQ-SQ-012 | 同上 | pass |
| `test/features/unit/proposal-description-fields.feature` | A | package maintainer | test | 記述fieldの更新受理と、契約field・削除・空文字列化の拒否を反例で固定する | featureからstep定義への参照のみ | SCN-UNIT-PROPFIELD-001〜008 | 反例が消えると契約fieldの改変を見逃す余地が生じる | pass |
| `test/steps/proposal-description-fields.steps.ts` | A | package maintainer | test | 上記featureのstep実装 | 検査scriptと一時fixtureだけへ依存 | 同上 | 複製は`git ls-files`で作り一時領域に閉じる | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | repository maintainer | 仕様 | REQ-SQ-012を一覧へ追加する | 一覧から各所への片方向参照 | REQ-SQ-012 | 行を戻せば旧一覧へ復帰する | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | repository maintainer | 仕様 | REQ-SQ-012の本文と受け入れ条件を定義する | 同上 | REQ-SQ-012 | 同上 | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | repository maintainer | 仕様 | QLT-PROPFIELD-001として正本訂正可能性を定義する | 同上 | REQ-SQ-012 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | repository maintainer | 仕様 | 追加SCNを追跡表へ追記する | 追跡表から各所への片方向参照 | REQ-SQ-012 | **#881の統合モデルに従う。課題別fileを作らない** | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | repository maintainer | 仕様 | 本変更を記録する | 同上 | REQ-SQ-012 | 行を戻せば旧履歴へ復帰する | pass |

Gitの`ad9f7566a3f203c7c3796486ad40fde1ee63650b..d99896ace2868a2570de33ef3ec144eceaf40c85`に含まれる9 pathと表の9行は重複なし・欠落なしで一致する。

## 未達の受け入れ条件

`TQP-LOCKFILE-VERSION-NORMALIZATION-001`の実行不可能な`rollback`文言の訂正は、**本PRでは行わない。** 本PRはbaseの旧validatorで評価されるため、訂正は依然として拒否される。本変更のmerge後、3本目のPRで訂正する。

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
| base validator（mainをtrusted rootとする） | 合格。`valid: true`、`errors: []` |

`npm test`は**737 scenarios (737 passed)**。

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
| 正しさ | pass | 8ケースの実測で、記述fieldの更新受理と契約field・削除・空文字列化の拒否を確認した |
| 価値・実現可能性 | pass | 訂正できない正本が残らなくなる。既に残っている1件も訂正可能になる |
| 整合性 | pass | 空文字列化と12文字未満はschemaが拒否する。実装側へ重複検査を足していない |
| 安全性 | pass | **緩和である。** 緩和対象を記述fieldへ限定し、契約fieldと削除の拒否は反例で固定した |
| 保守性 | pass | 診断文言を「削除できません」と「契約fieldは変更できません」へ分離した |

## 対象外

- proposal registryのschema変更。field集合と文字数制約は変えない。
- 契約fieldの可変化。
