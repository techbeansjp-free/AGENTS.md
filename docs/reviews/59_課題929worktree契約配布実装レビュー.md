# 課題929 worktree契約配布実装レビュー

> 状態: `ready-for-pr`。worktree作成契約を配布文書へ正本から生成して届ける変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `94dedb140e117cacd4621eb87964d536c9345a4d` |
| H_impl | `99692d5d5d6d0522531ea9ad8929eb2a3cec6087` |
| H_impl tree | `50dc546905bc02162b2eb79648856ca96cdc39e1` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

Issue #928の配布物影響調査で検出した。`worktree create`のruntimeはdirectory名の書式、timestampの10分窓、未来の非許容、trusted boundaryの優先評価を拒否条件として持ち、**`dist/`として配布済みである。しかし配布物にこの規則を述べた正本が無かった。**

利用projectは拒否されるが、なぜ拒否されたかを配布物から知れない。

## 設計判断の是正

**初回の実装は二重管理であった。** 定数を`src/domain/worktree.ts`に、同じ事実を日本語の散文として配布文書に、それぞれ人が書き、検査が突合する形にした。

repository ownerの指摘により作り直した。**照合機構を足しても、正本が2つある事実は消えない。** 本repositoryが繰り返し戦ってきた「同じ事実を2箇所に持ち、突合していない」欠陥を、是正の名目で新たに作っていた。

正しい形は正本1つと、そこからの導出である。

| 役割 | 実体 |
|---|---|
| 正本 | `src/domain/worktree.ts`の`WORKTREE_NAME_FORMAT`と`WORKTREE_TIMESTAMP_MAX_AGE_MINUTES` |
| 導出 | `scripts/generate_worktree_contract.ts`が配布文書の生成区画を描画する |
| 検査 | `conformance:check`は生成区画が正本の描画結果と一致するかだけを見る |

**人が同じ事実を二度書く箇所は無い。** 検査が失敗したときの指示も「文書を直せ」ではなく「生成commandを実行してcommitせよ」である。

## 実測

正本の定数を10から15へ変えると、生成区画が古くなり検査が拒否する。

```
.agent-skill-chain/docs/01_開発ワークフロー.mdの自動生成区画が正本と一致しません。
node --import tsx scripts/generate_worktree_contract.tsを実行して差分をcommitしてください
```

生成を適用すると再び合格する。SCN-UNIT-WTDOC-006でこの往復を固定した。

正本が述べる書式をruntimeの`WORKTREE_NAME`が受理することも同時に検証する。**書式の文字列と正規表現が乖離すれば検出される。**

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | **入る** | worktree作成契約の生成区画を追加。利用者は拒否条件の理由を配布物から知れる |
| `src/domain/worktree.ts` | **入る** | `WORKTREE_NAME_FORMAT`をexportした。既存exportと拒否条件の挙動は変えていない |
| `scripts/generate_worktree_contract.ts`、`scripts/check_worktree_contract.ts`、`scripts/check_conformance.ts` | 入らない | `scripts/`は`files`に無い |
| `test/`配下2件 | 入らない | `test/`は`files`に無い |
| `docs/specs/`配下4件 | 入らない | `docs/specs/`は`files`に無い |

判断: 配布物を更新した

根拠: 本Issueの目的が配布物の記述欠落の是正そのものである。runtimeの拒否条件は変えておらず、既に配布済みの挙動へ理由を与えるだけである。`WORKTREE_NAME_FORMAT`のexport追加は表示用の定数であり、利用者から見た振る舞いは変わらない。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/worktree.ts` | M | package maintainer | domain | 書式の表示用定数をexportする | 依存追加なし | REQ-LC-010、AC-LC-010、QLT-WTDOC-001 | export追加のみ。拒否条件は不変 | pass |
| `scripts/generate_worktree_contract.ts` | A | package maintainer | 生成 | 正本から配布文書の生成区画を描画し適用する | domain定数だけへ依存 | REQ-LC-010 | 生成区画を手書きへ戻せば旧状態へ復帰する | pass |
| `scripts/check_worktree_contract.ts` | A | package maintainer | 検査 | 生成区画の鮮度と、書式のruntime受理を検証する | 生成scriptとdomainへ依存 | REQ-LC-010 | 検査を外すと配布文書が黙って古くなる | pass |
| `scripts/check_conformance.ts` | M | package maintainer | 検査 | 上記検査をconformance:checkへ連結する | 検査scriptを追加参照 | REQ-LC-010 | 連結を外せば旧挙動へ復帰する | pass |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package maintainer | 配布文書 | worktree作成契約の生成区画を保持する | 文書から配布docsへの片方向参照 | REQ-LC-010 | 区画を削れば旧文書へ復帰する。**内容は人が書かない** | pass |
| `test/features/unit/worktree-contract-document.feature` | A | package maintainer | test | 鮮度検出、marker欠落、文書欠落、書式受理、生成の往復を反例で固定する | featureからstep定義への参照のみ | SCN-UNIT-WTDOC-001〜007 | 反例が消えると配布文書の陳腐化が無音で戻る | pass |
| `test/steps/worktree-contract-document.steps.ts` | A | package maintainer | test | 上記featureのstep実装 | 生成・検査scriptと一時fixtureだけへ依存 | 同上 | 配布文書の複製を一時領域で改変し、実fileを変更しない | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | repository maintainer | 仕様 | REQ-LC-010へ配布と生成の要求を追記する | 一覧から各所への片方向参照 | REQ-LC-010 | 段落を戻せば旧要件へ復帰する | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | repository maintainer | 仕様 | QLT-WTDOC-001として正本の単一性を定義する | 同上 | REQ-LC-010 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | repository maintainer | 仕様 | 追加SCNを追跡表へ追記する | 追跡表から各所への片方向参照 | REQ-LC-010 | **#881の統合モデルに従う。課題別fileを作らない** | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | repository maintainer | 仕様 | 本変更を記録する | 同上 | REQ-LC-010 | 行を戻せば旧履歴へ復帰する | pass |

Gitの`94dedb140e117cacd4621eb87964d536c9345a4d..99692d5d5d6d0522531ea9ad8929eb2a3cec6087`に含まれる11 pathと表の11行は重複なし・欠落なしで一致する。

## 受け入れ条件の実測

| 受け入れ条件 | 実測 |
|---|---|
| 配布物にworktree作成の命名・時刻・境界評価順の契約が記述されている | 生成区画として記述した |
| 記述とruntimeの拒否条件が一致している | 記述は正本の定数から生成する。人が二度書かない |
| 一致を機械検証する。片側だけの変更を拒否する | 定数を変えて生成を忘れると`conformance:check`が拒否する。実測で確認した |
| 反例testがある | 7 scenarioが鮮度、marker欠落、文書欠落、書式受理、生成の往復を固定する |

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

`npm test`は**758 scenarios (758 passed)**。

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
| 正しさ | pass | 定数を変えて生成を忘れた状態を実測で拒否できることを確認した |
| 価値・実現可能性 | pass | 利用者が拒否理由を配布物から知れる。生成なので陳腐化しない |
| 整合性 | pass | **二重管理を作らない形へ設計し直した。** 人が同じ事実を二度書く箇所が無い |
| 安全性 | pass | runtimeの拒否条件を変更していない。生成は配布文書の1区画だけを書き換える |
| 保守性 | pass | 検査の指示が「文書を直せ」ではなく「生成を実行せよ」である |

## 対象外

- 10分窓の値そのものの見直し。
- worktree削除の契約。既に配布物へ記述がある。
- 配布文書の他の区画の生成化。本Issueの範囲はworktree作成契約に限る。
