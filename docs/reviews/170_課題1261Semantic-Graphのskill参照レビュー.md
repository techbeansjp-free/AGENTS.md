# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| H_impl | `37eef6f71352e0fbd8647b66699ba82793def950` |
| 比較基点 | `5f6a652a6b46bb892fa7b027e74d7a8ca7e816a3` |
| 対象SHA・文書ダイジェスト | `37eef6f71352e0fbd8647b66699ba82793def950` |
| 対象差分 | `5f6a652a6b46bb892fa7b027e74d7a8ca7e816a3..37eef6f71352e0fbd8647b66699ba82793def950`、9 path |
| 対象外 | Graph Evidenceのgate化、CIとnpm scriptからの呼び出し、投影の必須化、node列挙APIの追加、新しいCLIとschema、Issue #1259が所有するmutation-testの選択経路 |
| 残り予算 | 同一範囲で最大3ラウンドのうち1ラウンドを使用。**残り2。** 収束後のHEAD移動に対する取り直し1ラウンドは未使用 |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260907_124810_Semantic-GraphをStep-skillから参照させ実行するAIへ届ける |
| 仕様の所有箇所 | `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-011。引用: 「公開CLIは少なくとも`graph install`、`graph rebuild`、`graph status`、`graph impact`、`graph path`、`graph order`を分離する」 |
| 成果物行数 | 配布文書 +36、test +72、仕様 +4/-1 |
| 縮小の先行評価 | CIまたはnpm scriptからgraphを呼ぶ案は、構築費用と未導入projectでの失敗を理由に不採用。Step 2とStep 6へも置く案は影響範囲の特定が主責務でないため不採用。**新しい検査器を作らず、既存の`skills:check`のdocs link検査とSCN 2件で足りると判断した** |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。reviewer: codex CLI / 設定既定model / reasoning effort high。2026-09-07 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、原文引用 | advanced。riskはmedium、外部契約変更あり | codex CLI。Codexの推論レベル上限highの範囲内 | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | implementerはClaude Code、reviewerはcodexの新規session。`--sandbox read-only`で起動し対象pathを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1261、staging 01のAC-1261-01とAC-1261-02 | Step 8で`sync-verified`、syncDigestとreadBackDigestが一致 | 実行観測 |
| 欠陥の実測 | `grep -rn 'graph' .agent-skill-chain/skills/` ほか | skill 0件、配布template 0件、CIとnpm script 0件 | 実行観測 |
| 費用と利得 | Issue #1261 のissuecomment-5563691358 | 追跡の問いでgrepは偽陽性7/18件、graphは偽陽性0件・取りこぼし0件 | 実行観測 |
| 差分 | `5f6a652a..37eef6f7` | 9 path | 既存コード |
| テスト | `--name 'SCN-UNIT-PACKAGE-02[45]'` | 2 scenarios、10 steps、すべて成功 | テスト出力 |
| 変異試験 | 12件 | 11 kill。生存1件はAC範囲外 | テスト出力 |
| 仕様 | `docs/specs/02_要件/05_グラフ投影要件.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-status 5f6a652a 37eef6f7` | 9 pathすべてM | Git index |
| Phase A artifact | `docs/reviews/170_課題1261Semantic-Graphのskill参照レビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。**
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDがPR author/`H_impl` author stable IDと異なる: **満たす。**
- 既定branch追随を行った場合: **該当なし。** 比較基点は`5f6a652a`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package owner | package | 判断材料の正本。edge種別の選び分け、構築費用、退避先 | pass。Graph Evidenceの扱いは`02_品質基準.md`へ参照し再定義しない | REQ-GR-011 / AC-1261-02 / SCN-UNIT-PACKAGE-025 | 既存段落を削除していない。前進revertで復旧 | pass |
| `.agent-skill-chain/skills/step-05-design/SKILL.md` | M | package owner | package | 設計工程での手段選択の指示 | pass。templateへのlink集合は不変で`skills:check`が合格 | AC-1261-01 / SCN-UNIT-PACKAGE-024 | 追加のみ | pass |
| `.agent-skill-chain/skills/step-09-implement/SKILL.md` | M | package owner | package | 実装工程での仕様更新範囲の特定 | pass | AC-1261-01 / SCN-UNIT-PACKAGE-024 | 追加のみ | pass |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | M | package owner | package | レビュー工程での追跡先確認 | pass | AC-1261-01 / SCN-UNIT-PACKAGE-024 | 追加のみ | pass |
| `test/features/unit/review-policy-package.feature` | M | package owner | evidence | SCN-UNIT-PACKAGE-024と025の2件 | pass | AC-1261-01 / AC-1261-02 | 追加のみ。既存scenarioを変更していない | pass |
| `test/steps/unit.steps.ts` | M | package owner | evidence | 参照の到達性と契約文の実在の観測 | pass。既存step定義を変更していない | AC-1261-01 / AC-1261-02 | 追加のみ | pass |
| `docs/specs/02_要件/05_グラフ投影要件.md` | M | package owner | spec | REQ-GR-011へStep skillからの参照契約を追記 | pass。名指ししたSCNは同じ要件の追跡行に登録済み | REQ-GR-011 / AC-GR-011 | 既存段落を削除していない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 追加SCNの追跡行1件 | pass。`trace:check`のorphanが要件・SCN・実装とも0件 | REQ-GR-011 / AC-GR-011 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-GR-011 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-status`の9 pathと表の9行が一致する。生成distの変更はない。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **満たす。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 実装者自身が`--edge-kinds=supported-by`だけで問うて2件しか返らず誤答しかけた | 参照だけでは誤答する | なし | edge種別の選び分けをFR-02として要件へ昇格させた | SCN-UNIT-PACKAGE-025 | REQ-GR-011へ追記 | pass |
| DISC-002 | 独立reviewerがSCN-UNIT-PACKAGE-024の回避を構成した。括弧の中身だけを検査していたため、段落を裸のpath文字列へ置き換えても合格した | AC-1261-01の担保範囲 | なし | 期待値をMarkdown link全体と読取指示へ強化した | 変異12件中11 kill | 不要 | pass |
| DISC-003 | 利用節のGraph Evidence正本への参照lineを落とす変異が生存する | AC-1261-02の範囲外 | なし | **assertionをACを超えて広げない。** この参照は判断材料ではなく案内であり、落ちてもauthorityは変わらない | 変異12件中の生存1件 | 不要 | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1261-01 | SCN-UNIT-PACKAGE-024 | Step 5・9・10のskillへの相対link | 合格 | pass | 3 skillそれぞれの参照を落とす変異と、裸のpath文字列へ退化させる変異の計6件をkillする |
| AC-1261-02 | SCN-UNIT-PACKAGE-025 | 利用節の4つの契約文 | 合格 | pass | 追跡edge、言及edge、退避先、前提でないことの4文を個別に落とす変異とanchorを壊す変異の計5件をkillする |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | not-applicable | 参照を追加するだけで、信頼境界、認可、秘密情報の扱いとGraph Evidenceのauthorityを変更しない | 差分にauthorityとgateの変更が無いことを独立reviewerが確認した |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 未導入または構築失敗時に実行者が次に採る行動を判断できる記述が要る | 利用節の退避先の記述と、それを落とす変異のkill |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLIでありGUIを追加しない。変更は配布Markdownの本文である | projectKindはcliである。差分に視覚要素はない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚componentとtokenを追加しない | project choicesのcapabilities.designTokensに従う |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | AC-1261-01とAC-1261-02をともに成立と判定した |
| 価値 | 利用者・運用上の目的を満たすか | pass | 実行するAIが読む文書から手段へ辿れる。実測で追跡の問いの偽陽性が39%から0%になる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 新しいCLI、schema、validator、deny gate、依存packageを追加していない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02の§2.2に列挙した変更箇所と実差分の9 pathが一致する |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 判断本文は利用節1箇所。**独立reviewerの指摘を受けて3 skillから退避契約の複製を削った** |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | 変異12件中11 kill。生存1件はAC範囲外の案内lineである |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 投影の未導入と構築失敗をStepの失敗にしない旨を利用節へ明記した |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | anchorを壊す変異、段落を裸のpath文字列へ退化させる変異をkillする |
| 悪用 | 注入、経路脱出、権限外操作等 | not-applicable | 新しい入力経路と権限を追加していない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | Graph Evidenceの`authority: "none"`を変更していない。**無限定な「gateを通さない」という記述は、既存REQ-GR-010の「構造Evidenceとして入力される」と衝突しうるため削り、正本への参照へ置き換えた** |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 既存段落と既存scenarioを削除していない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 前進revertで復旧する |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | templateへのlink集合を変更していない。REQ-GR-011と変更履歴へ反映した |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-01 | Medium | SCN-UNIT-PACKAGE-024が括弧の中身だけを検査しており、段落を裸のpath文字列へ置き換えても合格する。仕様の「この不変条件を強制する」は過大 | reviewerが該当入力で合格することを示した | AC-1261-01、仕様の主張 | 期待値をMarkdown link全体と読取指示へ強化し、仕様の主張を「参照と判断材料の欠落を検出する回帰検査である」へ狭めた | resolved | なし |
| M-02 | Medium | 「Graph Evidenceはgateを通さない」が無限定で、既存REQ-GR-010の「既存Gateへ構造Evidenceとして入力されるだけとする」と衝突しうる | reviewerが両者の原文を対比 | 規範文書の整合 | 当該文を削り、Graph Evidenceの扱いは`02_品質基準.md`が所有すると参照させた | resolved | なし |
| L-01 | Low | 退避契約を3 skillへ複製しており、「同じ契約を複数文書へ複製しない」に反する | reviewerが3 skillの共通文を示した | 保守箇所 | 3 skillから共通文を削り、各Step固有の利用場面と正本への読取指示だけを残した | resolved | なし |
| L-02 | Low | `skills:check`のdocs link検査はfragmentへも小文字化と記号除去を適用するため、「anchorの実在を一般に強制する」とは言えない | reviewerが`#Semantic-Graphの利用`など3例が受理されることを示した | 記録の正確性 | 変更履歴の記述を訂正した。**既存検査の欠陥であり本件が導入したものではない。** 現行3 linkはSCN-UNIT-PACKAGE-024の固定文字列照合が併せて担保する | resolved | 既存検査の過剰正規化は残る。本件のscope外 |
| L-03 | Low | 利用節のGraph Evidence正本への案内lineを落とす変異が生存する | 変異試験の生存1件 | AC-1261-02の範囲外 | 記録のみ。**assertionをACを超えて広げない。** 落ちてもauthorityは変わらない | valid | 案内が消えても検出しない |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。AC-1261-01とAC-1261-02、INV-1261-01からINV-1261-03を原文引用で判定した。
- 指摘を確定した: M-01、M-02、L-01、L-02、L-03。**Critical/Highは0件。**
- 次ラウンド対象のCritical/High: なし。M-01、M-02、L-01、L-02はこのラウンド内で是正した。
- verdictはAPPROVE_WITH_FINDINGS。

## 7. テスト結果

実行したcommandの一覧。

- `npm run docs:format`
- `npm run skills:check`
- `npm run trace:check`
- `npm run typecheck`
- `npm run verify:distribution`
- `node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --name 'SCN-UNIT-PACKAGE-02[45]'`

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は`en`、`projectChoices.testLayers`は`unit`、`integration`、`e2e`である。

対象シナリオの実行は2 scenarios、2 passed、0 failed、0 skipped。10 steps、10 passed。

失敗またはskipがある層: **対象シナリオの実行では0件である。** 全suiteの結果は`verify:distribution`の実行ログを正本とする。

対応する成功CI runの参照: **本artifactの作成時点では存在しない。** branchを未pushであるため、run IDとURLと対象HEADは提出時に別途記録する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | 入る | Semantic Graphの利用節に、edge種別の選び分け、構築費用、退避先が増える |
| `.agent-skill-chain/skills/step-05-design/SKILL.md` | 入る | 影響範囲を特定するときの手段選択の指示が1文増える |
| `.agent-skill-chain/skills/step-09-implement/SKILL.md` | 入る | 仕様更新の範囲を決めるときの指示が1文増える |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | 入る | 追跡先を確認するときの指示が1文増える |
| `docs/specs/`の3 file | 入らない | ASC自身の仕様と追跡であり配布物に含まれない |
| `test/`の2 file | 入らない | 配布境界外の検証資産である |

判断: 配布物を更新した

根拠: `.agent-skill-chain/docs/`と`skills/`はいずれも配布されるpackage所有資産であり、利用者が読む実行契約が変わる。**Graphの導入は必須にならない。** 未導入と構築失敗は既存手段へ退避してよいと明記した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | 本artifactの作成時点ではなし。提出時にPRとCI runで観測する |
| reviewerがPR author・実装commit authorと異なる | はい。reviewerはcodex CLIの独立sessionであり、commitのauthorではない |
| 観測したreview commentとapprovalの件数 | 1ラウンド。Medium 2件・Low 3件を確定。Critical/Highは0件 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/05_グラフ投影要件.md`のREQ-GR-011、`docs/specs/15_要件追跡/00_追跡表.md`、`01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **満たす。** 用語を追加していない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **満たす。** L-01で3 skillの複製を解消した。
- 要件・変更・SCN・テストの追跡: REQ-GR-011、AC-GR-011、SCN-UNIT-PACKAGE-024、SCN-UNIT-PACKAGE-025。`trace:check`のorphanが要件・SCN・実装とも0件。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: DC-UXとDC-TOKENSはともにnot-applicable。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。
- Medium/Lowの記録: M-01、M-02、L-01、L-02はresolved。L-03はvalidとして記録のみとする。追加loopとgate停止を生じさせない。
- 判定: approved
- 新しい権限が必要な事項: なし。push、PR作成、mergeはユーザーが2026-09-07に明示承認している。merge承認は`pr.merge`だけを許可し、branch削除、Issue終了、release、公開、cleanupを連結しない。
- 残存リスク: L-03により、利用節のGraph Evidence正本への案内lineが消えても検出しない。L-02の既存検査の過剰正規化は本件のscope外として残る。
- **主張の範囲。** 本件が担保するのは、Step 5・9・10のskillから利用節へ辿れることと、利用節が判断材料を持つことである。**実行するAIがそれを読んで正しく使うことまでは担保しない。** また、Graphの投影が実際に構築できるかはIssue #1262が解消済みであり本件の対象外である。
- 次に許可される操作: 本artifactをH_implの後に単独commitしてH_finalとし、`audit:check`と`verify:distribution`をH_finalで実行する。その後にbranchをpushしPRを作成する。
- 次回の再開地点: H_finalでの配布gate実行。
