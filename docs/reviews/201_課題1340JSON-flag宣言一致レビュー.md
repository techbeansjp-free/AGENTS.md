# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1340 の実装・test・仕様 |
| ラウンド | 1〜4（4は収束後のHEAD移動に対する取り直し） |
| 対象SHA・文書ダイジェスト | cfb62f81e59fb46e4a89c4b1b2d319fd79227da8 |
| 比較基点 | `ec7a98274b19bcebb1120fa4305eb3cc4514b785` |
| 比較基点の由来 | PR #1353（#1349）を取り込んだ`origin/main`のtip。追随mergeはreview artifact commitより前に置き、個別監査表を`比較基点..H_impl`から再生成した |
| H_impl | `cfb62f81e59fb46e4a89c4b1b2d319fd79227da8` |
| 対象差分 | 8 path。生成済みdist 2 pathは配布物影響で監査する |
| 対象外 | 比較基点に存在し変更されていない範囲。file pathを読む経路の追加、`parseJsonStrict`の共通診断、他commandのflag型（00 §2.2） |
| 残り予算 | 0ラウンド（同一範囲3ラウンドのうち3を使用、取り直し1を使用） |
| ラウンド数 | 4 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260912_014517_routing-rolesとceilingのJSON-flag宣言を実装と一致させ診断で是正操作を示す |
| 仕様の所有箇所 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`の`routing roles`行「`--scope --assignments=<JSON>`」と`routing ceiling`行「`--provider --selection --issue --scope [--override=<JSON>]`」、`docs/specs/02_要件/01_ワークフロー要件.md` REQ-WF-009「usage正本と`src/cli.ts`の実装が読むflagの一致は`scripts/check_cli_usage.ts`が双方向に検証する」「拒否診断は次の1手を含める」 |
| 成果物行数 | 製品 `src/` +36 / −6、生成dist・配布案内 +21 / −6、支援層(test) +241、仕様 +5 / −3 |
| 縮小の先行評価 | 報告の対応策2（宣言を実装へ合わせる）と3（診断へ是正操作）に限り、file pathを読む経路を足していない。新しいgate・validator・CLI command・schema・台帳・project choice項目を追加せず、既存の`parseJsonStrict`の解析errorへ1文を併記する形へ縮小した |
| 実施者・日時 | reviewer: codex exec（read-only、implementerと別context）、進行役が転記、2026-09-12T05:00:00+09:00 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | standard | Codex high以下 | provider既定（`gpt-6-astra`/high）。trusted tierMappingの`codex:provider_recommended_default:high:default: critical` | Critical/High未解決なら停止 | H_impl固定後のread-only review、対象差分の変更なし |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1340、staging `01_要件定義.md` | FR-01〜03、AC-01〜04、INV-01〜03 | 要件文書 |
| 差分 | `ec7a98274b19bcebb1120fa4305eb3cc4514b785..cfb62f81e59fb46e4a89c4b1b2d319fd79227da8` | 8 path、実装2 commit＋追随merge＋test是正 | Git観測 |
| テスト | `npm test`ほか | 1860 scenarios（1844 passed、16 skipped、0 failed） | テスト出力 |
| 仕様 | `docs/specs/` | REQ・AC・SCN・追跡表・変更履歴を更新 | 既存文書 |
| commit前candidate | 上記8 path | H_impl `cfb62f81e59fb46e4a89c4b1b2d319fd79227da8` | Git観測 |
| Phase A artifact | 本file | artifact-only commit後にGit blobとして観測する | Git観測 |
| review session | staging `review-session.json` | round 1〜4、status converged、latest digest `73428cd991df162ddd94684be574307ddc5df02f167fcb7fcfba05e623350c89` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: USAGE-SOURCE → GENERATED-GUIDE、INPUT-HELPER → PARSE-JSONの一方向。本fileは自身のSHAを書かない。pass
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: 本fileのcommit後にauditで検証する
- reviewerの独立性が`context-isolated`の要求水準を満たす: implementer（本session）と別processのcodex exec read-onlyがexact HEADで肯定・敵対評価とfindingを返し、対象差分を変更していない
- Phase BのPR・CI・review一致: PR作成後にtrusted providerから観測する
- 既定branch追随を行った場合、取り込みがreview artifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: はい

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/00_要件一覧.md` | M | spec | requirements | REQ-WF-009の根拠Issue | 一方向追跡 | REQ-WF-009 | revert可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | requirements | 型宣言と実装の一致、診断の是正操作 | 一方向追跡 | REQ-WF-009 | revert可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | trace | SCN-UNIT-JSONFLAG行 | 一方向追跡 | AC-WF-009 | revert可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | history | 変更記録と互換影響 | 追加依存なし | REQ-WF-009 | revert可能 | pass |
| `src/cli-usage.ts` | M | package | source | 2 flagの型・説明・実行例 | 下位依存なし | FR-01、AC-01 | 互換test、revert可能 | pass |
| `src/cli.ts` | M | package | adapter | `inlineJsonInput`による解析errorへの是正操作の併記 | `parseJsonStrict`へ依存 | FR-02、FR-03、INV-02、INV-03 | fileを読まず値本文を転記しない、revert可能 | pass |
| `test/features/unit/routing-json-flag.feature` | A | test | feature | 受入scenario4件 | productionへ非依存 | SCN-UNIT-JSONFLAG-001〜004 | 一時値のみ | pass |
| `test/steps/routing-json-flag.steps.ts` | A | test | steps | scenario実装（実CLI経路をspawn） | CLIを観測 | AC-01〜04 | 隔離実行、revert可能 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: 生成済みdist 2 pathを除く8 pathが一致し、dist 2 pathは配布物影響で確認した。pass
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: REV-01〜04の修正は`cli-usage.ts`・`cli.ts`とそのtestだけで、round 2〜3で再監査した

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1340-01 | round 1で先頭文字gateがscalarの正当なJSON（`null`）をpath扱いにし（REV-02）、`[a].json`は是正操作を示さない（REV-03）ことが判明 | AC-04の追加 | requirement | gateを捨て解析errorへ是正操作を併記する方式へ変更。SCN-UNIT-JSONFLAG-004を追加し01〜03を再確定 | `workflow assess-discovery`=rebaseline-affected-contracts、SCN 4件合格 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-JSONFLAG-001 | `src/cli-usage.ts` | 合格（修正前は失敗を確認） | pass | `npm run test:unit`で合格 |
| AC-02 | SCN-UNIT-JSONFLAG-002 | `src/cli.ts` `inlineJsonInput` | 合格 | pass | 同上 |
| AC-03 | SCN-UNIT-JSONFLAG-003 | `src/cli.ts` | 合格 | pass | 同上 |
| AC-04 | SCN-UNIT-JSONFLAG-004 | `src/cli.ts` | 合格 | pass | 同上 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | policy、credential、GitHub証拠を扱うCLIでありPrivacy/Security by Designを常に適用する | fileを新たに読まない。診断へ値本文（path名を含む）を転記しないことをSCN-UNIT-JSONFLAG-002・004で確認 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 診断、migration journal、metrics、CI/review証拠を運用判断へ使用する | 拒否診断へ是正操作を併記する（INV-03）。新規log・保持・rotationなし |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 現行製品はNode CLIで画面契約とa11y検証の対象を持たない | `package.json`のbinとCLI contract |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 現行製品は画面レイアウトと視覚コンポーネントを所有しない | projectKind=cli、UI sourceなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | round 2でREV-01〜03の解消をreviewerが実測（`--assignments=null`は型診断、`[secret-a].json`は解析診断＋是正操作）、round 3でREV-04の解消を実測 |
| 価値 | 利用者・運用上の目的を満たすか | pass | `/tmp/a.json`と`./o.json`が従来のoffset診断ではなく行動可能な診断になる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | file読取経路や新規依存を追加せず既存CLI境界で完結 |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 仕様06の`<JSON>`契約とusage・実装・診断が一致。round 3でceiling実行例も一致 |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 共通の`inlineJsonInput`へ責務を集約し、値本文を例外へ転記しない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | round 1のREV-02（scalar JSON）を解消し、正当なJSON本文は従来の型診断へ進む |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | 終了値1で拒否し、値本文と`offset`単独の診断を残さない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 先頭空白付きJSON、scalar、`[`で始まるpath、空文字を確認 |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | pathやJSON本文を診断へ埋め込まず、秘密値の漏えいを避ける（SCN-UNIT-JSONFLAG-002・004） |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | fileを読まず、外部状態やauthority判定を変更しない |
| データ損失 | 上書き、削除、部分公開、履歴消失 | not-applicable | read-onlyな検証入力であり永続データを変更しない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | usage・事前診断の局所変更で、差分の取り消しで旧挙動へ戻せる |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | 仕様02・06・追跡表を更新し、生成区画は`cli:check`合格。round 3でceiling実行例をtestが実行して検査する形にした |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-01 | High | `routing ceiling --help`のexampleに`--override`が無くinline JSONの実行例を示さない（AC-01違反） | round 1、`src/cli-usage.ts` | usage | 実行例へ`--override='{…}'`を追加し、testでexampleを検査（commit `c5f3fdbf`） | resolved | なし |
| REV-02 | Medium | `--assignments=null`等のscalar JSONが先頭文字gateでpath扱いになる | round 1、`src/cli.ts` | 入力helper | gateを廃止し解析errorへ是正操作を併記する方式へ変更（commit `c5f3fdbf`） | resolved | なし |
| REV-03 | Medium | `--assignments=[a].json`はgateを通過し`offset`診断だけで是正操作を示さない | round 1、`src/cli.ts` | 入力helper | 同上。SCN-UNIT-JSONFLAG-004で検査 | resolved | なし |
| REV-04 | High | 追加したceiling実行例が固定`expiresAt`失効のためそのまま実行するとexit 1 | round 2、`src/cli-usage.ts` | usage | 実行例へ`--now=2026-09-01T12:00:00Z`を添え、testが実行例をtokenizeして実行する（commit `8ccbcccd`、`cfb62f81`） | resolved | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい
- 指摘を確定した: REV-01（High）、REV-02・REV-03（Medium）
- 次ラウンド対象のCritical/High: REV-01

### ラウンド2

- 未解決Critical/High: REV-04（新規、High）。REV-01〜03はresolved
- 修正差分: `src/cli.ts`、`src/cli-usage.ts`、`test/steps/routing-json-flag.steps.ts`、`test/features/unit/routing-json-flag.feature`、仕様3 file
- 修正で触れた隣接範囲: 型診断が既存検査へ委ねられることを確認
- 既承認・未変更範囲を再走査していない: はい

### ラウンド3

- 全指摘の最終分類: REV-01〜04すべてresolved
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: file読取経路を追加せず、診断の併記だけに留めた
- 同じ範囲の予算を自動更新していない: はい
- AIによる最終裁定: approved

### ラウンド4（収束後のHEAD移動に対する取り直し）

- 対象: `origin/main`（PR #1353）の追随mergeと、SCN-UNIT-JSONFLAG-001のtest helper是正（掲載例のtokenizeで単引用符を除く）
- 判定: approved、findings 0件。reviewerがnet deltaの等価性とtest helper是正が検査を緩めていないことを確認した

## 7. テスト結果

- 実行したcommandの一覧: `npm test`（H_impl `cfb62f81`で再実行）、`npm run conformance:check`、`npm run typecheck`、`npm run lint`、`npx prettier --check src test`、`npm run docs:format`、`npm run test:format`、`npm run trace:check`、`npm run cli:check`、`npm run source:check`、`npm run package:check`、変異試験A〜E
- 全layerの合計: 1860 scenarios（1844 passed、16 skipped、0 failed）。skipは既存の環境依存scenarioで本変更と無関係
- 変異試験: A（assignments型をpathへ戻す）1 failed、B（是正操作の併記除去）2 failed、C（overrideを併記経路へ通さない）1 failed、D（診断からpathの語を落とす）1 failed、E（ceiling実行例からoverride除去）1 failed。全kill
- runner・Gherkin方言: cucumber-js、`gherkinDialect: en`

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `dist/src/cli.js` | 入る | JSON flagの解析errorへ是正操作を併記 |
| `dist/src/cli-usage.js` | 入る | 2 flagの型・説明・実行例 |
| `src/cli.ts` | 入る | 配布buildの元source |
| `src/cli-usage.ts` | 入る | 同上 |

判断: 配布物を更新した

根拠: 公開CLIのusageと診断、および対応する生成済みdistを同じ実装commitで更新した。利用者に見える変化は`--help`の型表示（`<path>`→`<JSON>`）と拒否診断の文言で、値の解釈は変えていないことを変更履歴へ記録した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（`merge.reviewIndependence`未宣言のため既定） |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはClaude Code session（本staging進行役）、reviewerはcodex exec read-only sandboxの別process・別context。exact HEAD `29216512`（round 1）・`c5f3fdbf`（round 2）・`8ccbcccd`（round 3）・`cfb62f81e59fb46e4a89c4b1b2d319fd79227da8`（round 4）で実行 |
| reviewerが対象差分を変更していないこと | はい（read-only sandbox、review後の`git status`に差分なし） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-009）、`02_要件/00_要件一覧.md`、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 新語なし。pass
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass（診断とusageで「inline JSON」「file path」の語を揃えた）
- 要件・変更・SCN・テストの追跡: REQ-WF-009 → AC-WF-009 → SCN-UNIT-JSONFLAG-001〜004 → `test/features/unit/routing-json-flag.feature` → `src/cli-usage.ts`、`src/cli.ts`。`trace:check`合格
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UIなし、token非該当

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: REV-02・REV-03はround 2でresolved
- 判定: approved
- 新しい権限が必要な事項: なし
- 残存リスク: 利用側scriptが`--assignments=<path>`を渡していた場合は診断が変わる（従来も失敗していた）。仕様06は元からinline JSONを契約している
- 次に許可される操作: `workflow record --step=10`、`pr create`
- 次回の再開地点: staging journal Step 10
