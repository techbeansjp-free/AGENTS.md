# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | `759117e608d35721647a94fe5713f6c7e2690c07` |
| 比較基点 | `6a2bdcbb791e6b677995d70dd5c60e150358add0` |
| H_impl | `759117e608d35721647a94fe5713f6c7e2690c07` |
| 対象差分 | `6a2bdcbb791e6b677995d70dd5c60e150358add0..759117e608d35721647a94fe5713f6c7e2690c07`。21 file、548挿入、853削除 |
| 対象外 | `packed-bin`と`scale-output`の実行位置、3機構の検査内容、`02_品質基準.md`の改訂、`docs/reviews/`配下の過去証跡 |
| 残り予算 | 同一範囲で最大3ラウンドのうち2ラウンドを使用。残り1ラウンド |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260906_073424_consumer-acceptance-gateが実行されないjobの中にあり-releaseで一度も走っていない |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-027。引用: 「**機構1はrelease workflowの`validate` jobで、tag作成より前に実行する。**」 |
| 成果物行数 | 製品の変更行数 約210行（workflow 62、release.ts 118、plan_release 2、仕様 28）。削除 約530行（inject script 104、そのstep 116、npm公開job 約310）。支援層 約340行 |
| 縮小の先行評価 | 新jobを作らず`validate`のstepにした。`package:check`のmechanisms一覧へは足さない（全PRへ42秒が乗る）。**round 1の指摘を受け、条件付き許可ではなく存在の禁止へ倒した。** 代替4案の不採用理由は`02_設計.md`§12に記録 |
| 実施者・日時 | reviewer（codex、implementerと別identity・別context） / 2026-09-06 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、差分全文 | standard（riskはmedium、scopeは配布経路） | project choiceのprovider上限に従う。観測値はcodex CLI | project choiceのtier mappingに従う | 未解決Critical/Highがあれば停止し次roundで再評価する | reviewerはcodex、implementerはClaude。identityとcontextが異なる。reviewerは対象差分pathを1件も変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1216、staging `01_要件定義.md`§9 | AC-01〜AC-04、INV-01〜INV-04 | 一次資料 |
| 差分 | `6a2bdcbb791e6b677995d70dd5c60e150358add0..759117e608d35721647a94fe5713f6c7e2690c07` | 21 file、548挿入、853削除 | 既存コード |
| テスト | `npm run conformance:check`（全suite内包） | 1533 scenarios（1517 passed、16 skipped）、失敗0 | テスト出力 |
| 仕様 | `docs/specs/02_要件/`、`11_非機能/`、`12_運用保守/`、`13_移行・廃止/`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | 本artifactを除く21 file | `759117e608d35721647a94fe5713f6c7e2690c07` | Git index |
| Phase A artifact | `docs/reviews/156_課題1216consumer-acceptance実行位置レビュー.md` | 本commitで追加する1 fileのみ | Git観測 |
| commit後external | trusted providerのPR / CI run | PR作成後に観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **確認した。** job依存は`validate`→`tag`→`github_release`の直列1本で、GitHub Actionsが循環を許さない。本artifactへ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl`は`759117e608d35721647a94fe5713f6c7e2690c07`。本artifactの1 fileだけを加えて`H_final`にする
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: reviewerはcodex、implementerとPR authorはClaude/tatsuru。異なる
- 既定branch追随を行った場合: **行っていない。** baseは`6a2bdcbb`のままである

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/workflows/release.yml` | M | 本repository | project | `validate`へ`npm pack`と`git-dependency` acceptanceを追加し、`npm_publish` jobと`publish_npm`入力を削除。tagとgithub_releaseの条件へjob結果を要求 | pass。job依存は`validate`→`tag`→`github_release`の直列1本 | REQ-SQ-027、REQ-GH-002、REQ-GH-003 / AC-01〜AC-04 / SCN-UNIT-AUTOREL-020〜026 | acceptance失敗でtagが作られない。残る状態は「merge済みだがtagなし」で復旧可能 | pass |
| `src/domain/release.ts` | M | 本repository | package | release planからnpm stageを削除し、workflow検証へacceptance実行・job結果・npm公開不在の3検査を追加 | pass。追加importは0件 | 同上 | 読み取りのみ。判定不能を合格へ倒さない | pass |
| `scripts/plan_release.ts` | M | 本repository | project | `publishNpm`入力の受け渡しを削除 | pass | 同上 | 入力fieldが1つ減るだけ | pass |
| `scripts/inject_publish_version.ts` | D | 本repository | project | **npm公開専用のversion注入。公開経路が無くなったため削除する** | pass。他の呼び出し元は0件 | REQ-GH-003 | revertで復元可能 | pass |
| `test/features/unit/auto-release.feature` | M | 本repository | evidence | `SCN-UNIT-AUTOREL-020`〜`026`のscenario定義 | pass | AC-01〜AC-04 | workflow定義の読み取りのみ | pass |
| `test/features/unit/release-plan.feature` | M | 本repository | evidence | `SCN-UNIT-RELEASE-006`をnpm stage不在の検査へ差し替え | pass | AC-03 | `planRelease`を直接呼び実workflowを起動しない（SCN-UNIT-RELEASE-006） | pass |
| `test/features/integration/auto-release.feature` | M | 本repository | evidence | `SCN-INT-AUTORELEASE-011`をnpm公開経路の不在検査へ差し替え、注入scenario 2件を削除 | pass | AC-03 | 同上 | pass |
| `test/features/integration/consumer-acceptance.feature` | M | 本repository | evidence | `SCN-INT-CONSUMER-009`をvalidateでのtarball作成とgit-dependency検査へ差し替え | pass | AC-01 | 同上 | pass |
| `test/steps/auto-release.steps.ts` | M | 本repository | evidence | 上記scenarioのstep定義。npm公開経路前提の未使用helperを削除 | pass | AC-01〜AC-04 | 同上 | pass |
| `test/steps/release.steps.ts` | M | 本repository | evidence | npm stage前提のfixtureとassertionを更新 | pass | AC-03 | 同上 | pass |
| `test/steps/consumer-acceptance.steps.ts` | M | 本repository | evidence | workflow参照の検査をvalidate経路へ更新 | pass | AC-01 | 同上 | pass |
| `test/steps/publish-version-injection.steps.ts` | D | 本repository | evidence | **削除したscriptのstep定義** | pass | REQ-GH-003 | revertで復元可能 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | 本repository | spec | TERM-ASC-019・020からnpm公開の記述を削除 | pass | REQ-GH-003 | 追加なし | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | 本repository | spec | REQ-GH-002・003からnpm公開stageと注入経路の記述を削除 | pass | REQ-GH-002、REQ-GH-003 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | 本repository | spec | REQ-SQ-027へ3機構の実行位置と停止点を明記し、強制するSCNを名指し | pass | REQ-SQ-027、AC-SQ-027 | 同上 | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | 本repository | spec | QLT-DISTGATE-005をnpm公開経路の不在契約へ書き換え | pass | REQ-SQ-027 | 同上 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | 本repository | spec | 権限境界表と復旧表からnpm行を削除し、acceptanceの実行位置を明記 | pass | REQ-GH-003 | 同上 | pass |
| `docs/specs/13_移行・廃止/01_移行方針.md` | M | 本repository | spec | 移行方針からnpm公開の記述を削除 | pass | REQ-GH-003 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 本repository | spec | REQ-SQ-027へ新規SCN行を追加し、削除したSCNと実装pathを外す | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 本repository | spec | 本変更の履歴行 | pass | 同上 | 同上 | pass |
- 基準SHAとの差分path集合と表のpath集合が完全一致する: **確認した。** `git diff --name-status`が返す21件のうち生成物である`dist/src/domain/release.js`は`isGeneratedDistributionPath`により個別監査の対象外であり、残る20件と表の20行が一致する
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **確認した。** workflow固有の判定は`release.ts`の検証器へ、実行はworkflowのstepへ置いた
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **確認した。** round 1のF-01〜F-05は`release.yml`・`release.ts`・`test/`3件・`docs/specs/`6件・削除2件に閉じている

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 独立reviewerが5件を検出。**F-01（Critical）: `tag` jobの条件が`always()`と保存済みstateだけで、`needs.validate.result == 'success'`を要求していなかった。** `plan_outputs`はacceptanceより前でstateを出力するため、acceptanceが落ちてもtagとGitHub Releaseが作られる | **本変更の目的そのものを満たしていなかった。** AC-01・AC-02・AC-04とINV-03の直接違反 | 契約変更なし。ACとINVの本文を変えていない | job結果の要求、`always()`混入の拒否、acceptance stepのskip・握り潰し・位置の検査、npm公開不在検査の正規化、削除の取り残しの掃き出し | commit `759117e608d35721647a94fe5713f6c7e2690c07`。変異12件を全件kill | updated | pass |

**#1229で入れた帰属文の突合検査が、本変更のSCN未結線を実際に検出した。** 追跡表へ結線して解消している。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-AUTOREL-020、025 | `validate`のacceptance step | 26 scenarios passed | pass | 行の削除・`if`・`continue-on-error`・`\|\| true`のいずれでも拒否される |
| AC-02 | SCN-UNIT-AUTOREL-024 | tagとgithub_releaseの条件 | 同上 | pass | job結果の要求を外すか`always()`を足すと拒否される |
| AC-03 | SCN-UNIT-AUTOREL-022、026、SCN-UNIT-RELEASE-006 | release planと workflow検証 | 同上 | pass | stage一覧が3件で、quoted keyと行継続のnpm公開も拒否される |
| AC-04 | SCN-UNIT-AUTOREL-021、023 | step位置とjob一覧 | 同上 | pass | acceptanceが`tag` jobより前にあり、job名の集合が3件である |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | not-applicable | 認証・認可・信頼境界の判定logicを追加・変更しない。**npm registryのtokenを使う経路を削除するため扱う秘密情報が1つ減る** | `id-token: write`権限をもつjobが1つ減る。追加したimportは0件で`src/lib/security.ts`へ触れない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | どのstepがどのjobに現れるかを確定する必要がある。受け入れ条件が「runのjob一覧とstep結果から観測できる」を要求する | `SCN-UNIT-AUTOREL-021`がstep位置を、`023`がjob一覧を検査する。保持はGitHub Actionsのlog保持に従い、rotationと監視は該当しない。復旧はmainへ修正commitをmergeして再実行することである |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | UIを実装しない。成果物はGitHub Actions workflowとTypeScriptのrelease planである | 差分21 fileのいずれも表示層に属さない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UIが無いためtokenの適用対象が存在しない | DC-UXと同じ根拠 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | AC-01〜AC-04が`SCN-UNIT-AUTOREL-020`〜`026`で観測でき、変異12件を全件killした |
| 価値 | 利用者・運用上の目的を満たすか | pass | `npx github:`での導入が3条件で検証済みのversionだけがtagとして出る |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存packageを1件も追加しない。手元3回の実測でacceptance単体42秒 |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | `trace:check`と`conformance:check`が合格し、**#1229の帰属文突合も通る** |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 判定logicを新設せず既存の`check_consumer_acceptance.ts`を呼ぶ |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | finding | **round 1のF-01。** acceptanceが落ちてもtagが作られた。job結果の要求で解消 |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | acceptance失敗で`validate`がfailureになり、tagもGitHub Releaseも起動しない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | quoted key、行継続、shell quoteを正規化してから判定する |
| 悪用 | 注入、経路脱出、権限外操作等 | finding | **round 1のF-02・F-04。** `continue-on-error`・`if`・`\|\| true`・quoted keyで迂回できた。すべて拒否するようにした |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 扱う秘密情報が1つ減る。**本検査は信頼境界ではない。** `release.yml`は`PROTECTED_FILES`に属さず候補側で緩和できる |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 削除853行はnpm公開経路とその証跡であり、Git tagとGitHub Releaseの自動化は残る |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 当該変更のrevertで戻る。`private: true`は#1215で既に強制点として存在する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | finding | **round 1のF-03。** 用語台帳・移行方針・品質要件・dead executableが取り残されていた。すべて掃いた |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| F-01 | Critical | `tag`の条件が`always()`と保存済みstateだけで、acceptance失敗後もtagとGitHub Releaseが作られる | reviewerがGitHub Actionsのjob依存仕様と`plan_outputs`の位置から導出 | 本変更の目的そのもの | 両jobへ先行jobの`result == 'success'`を要求し、`always()`の混入も拒否する | resolved | なし |
| F-02 | High | acceptance検査が文字列の存在しか見ておらず、`continue-on-error`・`if`・`\|\| true`・commentへのmarker退避で迂回できる | reviewerが5変異すべてで`valid: true`を実測 | 回帰検出の有効性 | stepのskip・握り潰し・位置を検査する | resolved | markerを実行位置から離す高度な形は検出しきれない |
| F-03 | High | 削除の取り残し。QLT-DISTGATE-005の契約、dead executable、用語台帳・移行方針の記述が残る | reviewerが仕様とscriptを走査 | INV-04 | 契約を書き換え、`inject_publish_version.ts`とそのstep・SCN 2件を削除し、記述を掃いた | resolved | なし |
| F-04 | High | npm公開不在検査がquoted keyと行継続で迂回できる | reviewerが3表現で`valid: true`を実測 | 方針の強制 | 行継続とquoteを正規化してから判定する | resolved | なし |
| F-05 | Low | 所要時間の比較対象が不足している | reviewerの指摘 | 常設可否の判断 | **主張を訂正した。** acceptance単体42秒に`npm pack`13秒を加えて約55秒であり、20分はacceptance専用ではない。**localのwarm cache 3回ではcold CIの上限を証明できない** | resolved | **CI上の実測は初回のrelease runで取る** |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: **確認した。** 固定initial HEAD `dafaadbb`に対する全scope reviewとして実施した
- 指摘を確定した: F-01（Critical）、F-02〜F-04（High）、F-05（Low）の5件
- 次ラウンド対象のCritical/High: F-01・F-03がblocking。**F-02とF-04も同じroundで是正した**

### ラウンド2

- 未解決Critical/High: **0件。** F-01〜F-04はcommit `759117e608d35721647a94fe5713f6c7e2690c07`で解消した
- 修正差分: `dafaadbb..759117e608d35721647a94fe5713f6c7e2690c07`。`release.yml`、`release.ts`、`test/`2件、`docs/specs/`6件、削除2件
- 修正で触れた隣接範囲: 追跡表のSCN一覧と実装path、品質要件のQLT-DISTGATE-005、用語台帳・移行方針・運用設計のnpm記述
- 既承認・未変更範囲を再走査していない: **確認した。** `plan_release.ts`と`release-plan.feature`はラウンド1で承認済みで、ラウンド2では再走査していない

### ラウンド3

- 全指摘の最終分類: **実施していない。** ラウンド2で収束した
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 該当なし
- 同じ範囲の予算を自動更新していない: **確認した。** 残り1ラウンドを消費していない
- AIによる最終裁定: approved

## 7. テスト結果

実行したcommandの一覧: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run source:check`、`npm run docs:format`、`npm run test:format`、`npm run skills:check`、`npm run cli:check`、`npm run package:check`、`npm run architecture:check`、`npm run project:quality`、`npm run trace:check`、`npm run conformance:check`、`npm run build`

全layerの合計: **1533 scenarios（1517 passed、16 skipped）、失敗0件。**

失敗またはskipがある層: skipは16 scenarioで、いずれも本変更以前から存在する環境依存scenarioである。失敗は0件のため展開する層は無い。

対応する成功CI runの参照: **PR作成後に観測する。** 本artifact作成時点では未生成である。

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は英語keyword・日本語説明である。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/workflows/release.yml` | 入らない | なし。ただし**releaseの出方が変わる**（acceptance失敗でtagが出ない） |
| `src/domain/release.ts` | 入る | release planのstageからnpmが消える。workflow検証の受理集合が狭まる |
| `dist/src/domain/release.js` | 入る | 上記のbuild生成物 |
| `scripts/plan_release.ts` | 入る | `publishNpm`入力を受け付けなくなる |
| `scripts/inject_publish_version.ts` | 入る | **削除。** npm公開専用であり呼び出し元が無い |
| `test/`配下6件 | 入らない | なし |
| `docs/specs/`配下8件 | 入らない | なし |

判断: 配布物を更新した

根拠: `src/domain/release.ts`と`scripts/`の変更が利用者から見える。**`npm publish`はもともと`private: true`により成立しないため、削除で失われる機能は無い。**

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | あり |
| reviewerがPR author・実装commit authorと異なる | はい |
| 観測したreview commentとapprovalの件数 | reviewerはcodex CLIで実施。round 1でfinding 5件（Critical 1、High 3、Low 1）を提出。PR上のcommentとapprovalはPR作成後に観測する |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `01_システム概要/02_用語・略語.md`、`02_要件/03_外部連携要件.md`、`02_要件/04_仕様・品質管理要件.md`、`11_非機能/01_品質要件.md`、`12_運用保守/00_運用設計.md`、`13_移行・廃止/01_移行方針.md`、`15_要件追跡/`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **台帳への追加・変更・廃止は0件である。** TERM-ASC-019・020の定義文からnpm公開の記述を外したが、用語そのものは維持している
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **確認した。** `conformance:check`が合格している
- 要件・変更・SCN・テストの追跡: REQ-SQ-027 → AC-SQ-027 → SCN-UNIT-AUTOREL-020〜026。`trace:check`でorphan 0件
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UI無し

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件**
- Medium/Lowの記録: F-05をresolvedとして記録した
- 判定: approved
- 新しい権限が必要な事項: **なし。** `PROTECTED_FILES`所属fileを1件も変更していない
- 残存リスク: **CI上の`git-dependency`の所要時間は未実測である。** 手元のwarm cache 3回ではcold CIの上限を証明できない。**本変更のmerge後の自動releaseが、変更後のworkflowで実行される最初のrunである。** job一覧とstep結果を観測する。**`02_品質基準.md`の停止規定との整合はowner確認事項として残す**
- 次に許可される操作: `workflow record --step=10`、その後`pr create`
- 次回の再開地点: 本staging配下の`journal/steps.jsonl`の最終行
