# 課題921 review例外実装レビュー

> 状態: `ready-for-pr`。独立reviewが成立しない場合の扱いをrisk比例で定め、承認済み例外を正本管理する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `fe820de59442c934de032e6ba7919112e4a3ec41` |
| H_impl | `d3177c53ddfc5766b73957ca0a9668a43610f855` |
| H_impl tree | `27d517fc550fdbfdc7a5637e2c543c85758ac4b0` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

CodeRabbitの`rate limited`でreviewが実行されないままmergeした運用を、review artifactの散文としてしか記録していなかった。

調査の過程で、より重い欠落が判明した。**配布物には独立reviewが成立しない場合の規定が一切無い。** 配布物は`exact-head review`を無条件必須としており、逃げ道も記録の型も無い。配布先が同じ状況（reviewer不在、サービス障害、単独メンテナ）に陥ると、**黙って契約違反にするか、止まるかの二択しかない。**

配布物に`CodeRabbit`という語は1件も無い。要件はprovider非依存であり、**特定サービスの問題ではなく、独立reviewが成立しない場合の規定が無いという設計の欠落**であった。

## 設計の4回の是正

repository ownerの指摘により、設計を4回作り直した。**いずれも私の初期案に実害のある穴があった。**

### 1回目: ベンダー名の混入

例外識別子を`RVX-CODERABBIT-RATE-LIMITED-001`とした。**特定サービス名を正本へ焼き付けると、移行時に意味を失う。** provider非依存の`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`へ改めた。

### 2回目: 既定を「停止」にした

fail-closedを流れそのものへ適用した。**AI駆動でnonstopに進めるという目的に反する。** 独立reviewの不在それ自体は何も壊さない。既定を「停止」から**「無記録での通過の禁止」**へ改めた。

### 3回目: mergeを通してreleaseを止めた

releaseはmergeを契機に自動発火する。mergeを通してreleaseを止めると、**mainには変更が入りtagが無い中途半端な状態が残るだけで何も守れない。** 判断基準を明示した。

> **門を置くのは、止めた場合に残る状態が復旧可能であり、かつ止めることで不可逆な行為を防げるところだけ。**

| 対象 | 止めたら残る状態 | 止めて防げる不可逆な行為 | 門 |
|---|---|---|---|
| merge | PRのまま。復旧可能 | 無い。revertできる | 置かない |
| tag作成とRelease | tagが無い状態。復旧可能 | 無い。どちらも削除できる | 置かない |
| package registryへの公開 | tagはあるが未公開。後から公開でき復旧可能 | **ある。** 取り消しは事実上できない | **置く** |

あわせて、削除・force push・履歴書き換えを独立reviewの対象から外した。**reviewが見るのは変更であって操作ではない。** これらはpreview、承認hash、authorize、branch保護の既存authority経路で守る。同じものへ別の門を二重に作らない。

### 4回目: 外部reviewerが実在しないprojectで公開が永久に塞がる

公開へ門を置いた結果、**単独メンテナとAIという構成では公開できなくなった。** この製品が最も想定すべき構成である。

門の目的はownerの判断を妨げることではなく、**黙って、誰の判断か分からないまま行われることを防ぐこと**である。したがって例外は公開も覆える。代わりに**宣言の強さを不可逆性へ比例させた。**

| 対象 | 宣言に求めるもの |
|---|---|
| 可逆な操作 | 通常の宣言。失効日時に無期限を示す値を置いてよい |
| 外部への不可逆な配布 | 対象に含める旨の明示と、**期限付きの失効日時。** 無期限を認めない |

一度書いて忘れたまま公開され続ける状態を作らない。

## 3つの状況の切り分け

| 状況 | 扱い |
|---|---|
| 外部reviewサービスを使っていない | 例外が要るとは限らない。要件は「PR authorとも実装commit authorとも異なるreviewer」であり、人でもよい。**独立reviewerが実在しない構成のときだけ**宣言する |
| 一時的な失敗 | **例外にできない。** 再試行が既定であり、上限超過時に他の種別へ宣言し直す |
| 成功と表示されるがreviewが実行されていない | checkの結論を証拠にせず、review commentとapprovalの実体を観測して未実行と判定し、適用PRと観測値を記録する |

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/docs/02_品質基準.md` | **入る** | 独立review不成立時の規定を新設。**配布先はこれまで規定なしだった** |
| `.agent-skill-chain/schemas/project-review-exception.schema.json` | **入る** | 例外正本のschemaを新設。配布先も同じ形式で宣言できる |
| `.agent-skill-chain/templates/issue/04_レビュー.md` | **入る** | 独立reviewの成立を記録する節を追加。既存節は10・11へ繰り下げ |
| `src/domain/conformance.ts` | **入る** | `validateReviewExceptions`をexport。既存exportの挙動は変えていない |
| `.agent-skill-chain/review-exceptions.json`、`.agent-skill-chain/project/rules/review-exception.json`、`.agent-skill-chain/project-policy.json` | 入らない | project設定であり`files`に無い |
| `scripts/check_conformance.ts` | 入らない | `scripts/`は`files`に無い |
| `test/`配下2件 | 入らない | `test/`は`files`に無い |
| `docs/specs/`配下5件 | 入らない | `docs/specs/`は`files`に無い |

判断: 配布物を更新した

根拠: 本Issueの核心が配布物の規定欠落そのものである。**配布先には独立reviewが成立しない場合の逃げ道も記録の型も無かった。** 利用者に見える変化がある。既定は従来どおり外部証拠を要求するため、既存の利用projectが新たに止まることはない。例外を宣言した場合にだけ挙動が変わる。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/docs/02_品質基準.md` | M | package maintainer | 配布規範 | 独立review不成立時の門の置き方と例外の要件を定める | 規範から各所への片方向参照 | REQ-SQ-015、AC-SQ-015、QLT-RVX-001 | 節を削れば旧規定（無条件必須）へ復帰する | pass |
| `.agent-skill-chain/schemas/project-review-exception.schema.json` | A | package maintainer | 配布schema | 例外正本の構造を定義する | 依存なし | REQ-SQ-015 | schemaを削れば宣言できなくなり無条件必須へ戻る | pass |
| `.agent-skill-chain/templates/issue/04_レビュー.md` | M | package maintainer | 配布template | 独立reviewの成立と適用例外を記録する節を追加する | templateから配布docsへの片方向参照 | REQ-SQ-015 | 節を戻せば旧templateへ復帰する | pass |
| `src/domain/conformance.ts` | M | package maintainer | domain | 例外正本の検証と、rule enforcement pointの登録 | 既存依存のまま。fsへ触れない純関数である | REQ-SQ-015 | export追加のみ。既存exportの挙動は不変 | pass |
| `scripts/check_conformance.ts` | M | package maintainer | 検査 | 例外正本の検証をconformance:checkへ連結する | domain exportを追加参照 | REQ-SQ-015 | 連結を外せば旧挙動へ復帰する | pass |
| `.agent-skill-chain/review-exceptions.json` | A | repository maintainer | project設定 | 本repositoryの承認済み例外を宣言する | 検査から参照される | REQ-SQ-015 | entryを削れば例外なしへ戻る | pass |
| `.agent-skill-chain/project/rules/review-exception.json` | A | repository maintainer | project rule | 例外の正本管理を要求する | conformance検査から参照される | REQ-SQ-015 | ruleを外せば旧要求へ復帰する | pass |
| `.agent-skill-chain/project-policy.json` | M | repository maintainer | project policy | 追加ruleをinventoryへ登録する | policy manifestからruleへの片方向参照 | REQ-SQ-015 | 行を戻せば旧inventoryへ復帰する | pass |
| `test/features/unit/review-exception.feature` | A | package maintainer | test | 必須field欠落、未知field、失効、無期限の区別、種別、重複、時刻不正、不可逆配布の期限必須を反例で固定する | featureからstep定義への参照のみ | SCN-UNIT-RVX-001〜013 | 反例が消えると例外が無検証になる | pass |
| `test/steps/review-exception.steps.ts` | A | package maintainer | test | 上記featureのstep実装 | domain exportと相対時刻helperだけへ依存 | 同上 | 外部writeを行わない | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | repository maintainer | 仕様 | REQ-SQ-015を一覧へ追加する | 一覧から各所への片方向参照 | REQ-SQ-015 | 行を戻せば旧一覧へ復帰する | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | repository maintainer | 仕様 | REQ-SQ-015の本文と受け入れ条件を定義する | 同上 | REQ-SQ-015 | 同上 | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | repository maintainer | 仕様 | QLT-RVX-001として例外の可視性を定義する | 同上 | REQ-SQ-015 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | repository maintainer | 仕様 | 追加SCNを追跡表へ追記する | 追跡表から各所への片方向参照 | REQ-SQ-015 | **#881の統合モデルに従う。課題別fileを作らない** | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | repository maintainer | 仕様 | 本変更を記録する | 同上 | REQ-SQ-015 | 行を戻せば旧履歴へ復帰する | pass |

Gitの`fe820de59442c934de032e6ba7919112e4a3ec41..d3177c53ddfc5766b73957ca0a9668a43610f855`に含まれる15 pathと表の15行は重複なし・欠落なしで一致する。

## 受け入れ条件の実測

| 受け入れ条件 | 実測 |
|---|---|
| 例外がproject ruleとして定義され、`conformance:check`が検証する | `ASC-DOGFOOD-REVIEW-EXCEPTION-001`を追加。19 ruleで合格 |
| review artifactが正本を参照し、承認元・承認者・日時を複製しない | 配布templateの節を「正本の識別子を参照し複製しない」と定義した |
| 失効した例外を`conformance:check`が拒否する | SCN-UNIT-RVX-004で固定した |
| 失効日時未設定を、未記入と区別して保持する | nullは無期限の明示として受理し、keyの省略は拒否する。SCN-UNIT-RVX-005と006で固定した |
| 反例testがある | 13 scenarioが必須field、未知field、失効、無期限の区別、種別、重複、時刻不正、不可逆配布の期限必須を固定する |

## 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **なし** |
| reviewerがPR author・実装commit authorと異なる | 該当なし |
| 観測したreview commentの件数 | **0件**（`pulls/944/comments`を全page観測） |
| 観測したapprovalの件数 | **0件**（`pulls/944/reviews`の`APPROVED`を全page観測） |
| checkの表示 | `pass`（`Review rate limited`） |
| 適用する例外の識別子 | `RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001` |

**checkは`pass`と表示するが、実体は0件である。** 本節はcheckの結論ではなく実体の観測値を根拠とする。本PRは自身が定めた規定を自身へ適用した最初の例である。

**承認元、承認者、承認日時、失効日時は`.agent-skill-chain/review-exceptions.json`を参照する。本書へ複製しない。**

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

`npm test`は**784 scenarios (784 passed)**。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 13 scenarioで正本の構造と失効と種別を固定した。門の位置は判定基準から導いた |
| 価値・実現可能性 | pass | 配布先に規定が生まれた。**永久に塞がる門を作っていない** |
| 整合性 | pass | 削除・force pushを対象外とし、既存authority経路と二重にならない |
| 安全性 | pass | 既定は従来どおり外部証拠を要求する。例外を宣言した場合にだけ挙動が変わる |
| 保守性 | pass | 不可逆な配布を含む宣言は期限必須であり、放置できない |

## 対象外

- 外部reviewサービスのrate limit自体の緩和。外部サービスの制約である。
- 適用したPRの一覧の遡及作成。Issue #906の事後レビューで扱う。
- 例外の自動適用。宣言と記録は人の判断である。
