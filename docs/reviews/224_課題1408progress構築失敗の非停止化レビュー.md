# 04 レビュー

> 肯定と敵対の両観点を毎ラウンド確認する。指摘なしの承認は有効。Medium/Lowは記録するだけで、自動修正・追加ラウンド・ゲート停止を起こさない。用語と責務の境界は`成果物用語と責務境界`（`.agent-skill-chain/docs/01_開発ワークフロー.md`）を正本とする。
>
> 埋めた成果物は`docs/reviews/`または`.agent-skill-chain/reviews/`へ置き、実装commitの後にその1 fileだけをcommitする。

| 読者 | 読む節 |
|---|---|
| 発注・評価する人 | 要約 → §5 指摘 → §11 総合判定 |
| 実装・レビューする人 | 全節 |
| 運用する人 | 要約 → §8 配布物影響 → §10 仕様整合性 |

## 要約

**この5行だけで、何を見たreviewかが分かるように書く。** 各行は1〜2文。詳細は対応する節が持つ。

| 項目 | 内容 |
|---|---|
| 何が問題だったか | `umask 002`の環境で`full`が必ずStep 10へ到達できなかった。真因はREQ-WF-021の明文違反で、`review round --init`がoptionalなprogress inventoryの構築例外をreview本線へ伝播させていた。umaskはそれを発火させる条件にすぎない |
| 何を解決しようとしたか | 構築失敗をreview gateの拒否理由にせず、行動可能な案内を返す。あわせて03の生成modeを実行環境のumaskとtemplateのon-disk modeから独立させる。既存stagingの一括是正と判定側の緩和は対象外 |
| 何を行ったか | 構築の成否を例外でなく判別可能な値で返す形へ変え、分類済みの不成立だけを案内へ回した。`issue create`と`workflow promote-full`の両producerで生成modeを`chmod`で固定した。不成立の案内を分類ごとの行動・authority・rollback付きで生成する純関数を足した |
| 何を確認したか | 同一staging・同一HEADで是正前後を公開CLIで対比し、終了値が1から0へ変わることを実測した。`npm test` 2,096 scenarios失敗0、`conformance:check` 87合格、静的検査10種合格。変異試験は本体29件＋再発8件で、生存は等価と実証した1件のみ |
| 判定 | approved |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260916_161015_progressの構築失敗でreview-gateを止めず生成modeをumaskから独立させる | staging digest e729dba5a74f5cb9b5bcaa1fa0874bc6cd11e7a7334528c033908e53537e7eb6 | 既存コード |
| 差分 | `85160d595296982485886ff3f46f9064dd86e6e4`..`1e9ef564d268a529c4d43cbabfdd4a6e3d8fce44` | 18 path | 既存コード |
| テスト | `npm test` / `npm run conformance:check` / 静的検査10種 | 2,096 scenarios（2,080 passed、16 skipped、失敗0）、conformance 87 scenarios合格、静的検査10種すべて合格 | テスト出力 |
| 仕様 | `docs/specs/`6 file | updated。REQ-WF-021・TERM-ASC-125・管理データ・CLI契約・追跡表・変更履歴 | 既存文書 |
| commit前candidate | dist/src/adapters/review-session.js、dist/src/adapters/workflow-journal.js、dist/src/domain/issue.js、dist/src/domain/review-progress.js、docs/reviews/224_課題1408progress構築失敗の非停止化レビュー.md、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/07_データ/01_管理データ.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/review-session.ts、src/adapters/workflow-journal.ts、src/domain/issue.ts、src/domain/review-progress.ts、test/features/e2e/review-progress-cli.feature、test/features/integration/review-progress.feature、test/features/unit/review-progress.feature、test/steps/review-progress.steps.ts | H_impl 1e9ef564d268a529c4d43cbabfdd4a6e3d8fce44 | Git index |
| Phase A artifact | 本file | H_impl直後の1 commitで追加する evidence-only suffix | Git観測 |
| review session | session `cf4ce1f280591ed22ec3092bc66c9e19977c53f4fde08a6dca4c5f9259535d53` | counted round 2で`converged`。latest round digest `bbef65b04c24cd1c51a8376477f75ee33057e655d5671ea679719c5f4ef99a42` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。新規componentは純関数2つでdomain内に閉じ、外向き依存を持たない。本fileへ自身のcommit SHAを書いていない。診断は判定を持たず、承認・証拠の入力にならない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: はい。本fileだけを`H_impl`の直後に1 commitで載せる
- reviewerの独立性が要求水準を満たす: はい。§9に観測値を記録した
- 既定branch追随を行った場合…: 該当なし。`比較基点`は`origin/main`のtipのままで、追随mergeを行っていない

### 1.1 変更ファイル個別監査

全ファイルを1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。版管理下の生成物（`dist/`等）は`audit:check`が照合対象外とするため本表に載せず、生成元を監査して配布影響を§8で判定する。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `dist/src/adapters/review-session.js` | M | package | 生成物 | `src/adapters/review-session.ts`のcompile結果。生成元と1対1で対応し手書きしていない | 生成元 → 生成物 | AC-WF-021 | §8の配布物影響表とpackage filesで確認。生成元をrevertして再buildすれば戻る | pass |
| `dist/src/adapters/workflow-journal.js` | M | package | 生成物 | `src/adapters/workflow-journal.ts`のcompile結果 | 生成元 → 生成物 | AC-WF-021 | §8の配布物影響表とpackage filesで確認。生成元をrevertして再buildすれば戻る | pass |
| `dist/src/domain/issue.js` | M | package | 生成物 | `src/domain/issue.ts`のcompile結果 | 生成元 → 生成物 | AC-WF-021 | §8の配布物影響表とpackage filesで確認。生成元をrevertして再buildすれば戻る | pass |
| `dist/src/domain/review-progress.js` | M | package | 生成物 | `src/domain/review-progress.ts`のcompile結果 | 生成元 → 生成物 | AC-WF-021 | §8の配布物影響表とpackage filesで確認。生成元をrevertして再buildすれば戻る | pass |
| `docs/reviews/224_課題1408progress構築失敗の非停止化レビュー.md` | A | reviewerが確認（領域: docs/reviews） | evidence | 本review成果物。外部review取り込み（ラウンド3）のcommitが既定branch追随mergeより前にあるため、監査範囲`比較基点..H_impl`へ自身が入る | evidence。循環なし（本文へ自身のcommit SHAを書いていない） | 該当なし（監査記録） | 文書。revert | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package owner | spec | TERM-ASC-125を1行追加。既存語の再定義なし | なし（文書） | REQ-WF-021 / 全AC | 追記のみでrevert可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package owner | spec | REQ-WF-021へ非停止・案内・producer mode契約を追加 | なし（文書） | REQ-WF-021 / AC-1408-01〜07 | 既存文『modeを100644へ閉じ』を変更していない | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | package owner | spec | CLI外部契約へ非停止・案内・生成modeを追加 | なし（文書） | REQ-WF-021 / AC-1408-02、04 | 段落の主語をREV-13で是正済み | pass |
| `docs/specs/07_データ/01_管理データ.md` | M | package owner | spec | inventory不成立時の扱いを追記 | なし（文書） | REQ-WF-021 / AC-1408-01 | 既存宣言を書き換えず追記のみ | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 新規SCN 14件と実装欄を反映 | なし（文書） | 全SCN | 件数はfeature実数と一致 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | header区切りの直後へ1行追加 | なし（文書） | 全SCN | 9列で既存行と一致 | pass |
| `src/adapters/review-session.ts` | M | package | adapter | round初期化のanchor構築だけを変更。判定はdomainへ委譲 | adapter→domainの一方向。循環なし | REQ-WF-021 / AC-1408-01、02、05 / SCN-INT-PROGRESS-026〜029、035〜038 | 案内は表示専用のnotesへ載せanchorを変えない。revert可能 | pass |
| `src/adapters/workflow-journal.ts` | M | package | adapter | 昇格補完で生成する03のmodeを固定（第2 producer） | 既存依存のまま | REQ-WF-021 / AC-1408-04 / SCN-INT-PROGRESS-039 | best-effortで昇格を止めない | pass |
| `src/domain/issue.ts` | M | package | domain | staging生成物のmodeを宣言値へ固定 | なし（node:fsのみ） | REQ-WF-021 / AC-1408-04 / SCN-INT-PROGRESS-031〜033 | 原子公開前の一時directory内。best-effort | pass |
| `src/domain/review-progress.ts` | M | package | domain | 構築の成否を値で返す層と案内を生成する層を追加。両者はfilesystemもpathも参照せず引数だけから出力を決める（SCN-UNIT-PROGRESS-022〜025、040が同一入力に対する出力の一致を固定する） | domain内に閉じ外向きimportなし（SCN-UNIT-PROGRESS-017） | REQ-WF-021 / AC-1408-02、03 / SCN-UNIT-PROGRESS-022〜025、040 | 既存の判定順序・error文言・schema・型を保存 | pass |
| `test/features/e2e/review-progress-cli.feature` | M | package | test | E2E 1件を追加 | feature→stepsの一方向。製品codeへ依存しない | AC-1408-07 / SCN-E2E-PROGRESS-034 | 既存3 scenarioを変更せず追記のみ。revertで元へ戻る | pass |
| `test/features/integration/review-progress.feature` | M | package | test | integration 13件を追加 | feature→stepsの一方向。製品codeへ依存しない | AC-1408-01、04、05、06 / SCN-INT-PROGRESS-026〜039 | 既存10 scenarioを変更せず追記のみ。revertで元へ戻る | pass |
| `test/features/unit/review-progress.feature` | M | package | test | unit 5件を追加 | feature→stepsの一方向。製品codeへ依存しない | AC-1408-02、03 / SCN-UNIT-PROGRESS-022〜025、040 | 既存8 scenarioを変更せず追記のみ。revertで元へ戻る | pass |
| `test/steps/review-progress.steps.ts` | M | package | test | 上記19 SCNのstepを追加。既存stepを変更していない | test→src の一方向 | 全AC | 製品templateのmodeをAfter hookで無条件復元 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい。`比較基点..H_impl`の差分18 pathのうち、版管理下の生成物である`dist/`配下4件は本表の対象外として§8で配布影響を判定し、残る14 pathを1行ずつ載せた
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: はい。追加したのはpackage所有のdomain純関数・adapter分岐・spec本文だけで、project固有値を持ち込んでいない
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: はい。round 2の是正は§5の16件に対応するfileと、その直接の呼び出し元だけを対象にした

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1408-01 | INV-01とAC-1408-01が「構築可否はsession digestを変えない」と書いていたが、anchorは成立時だけinventory keyを持つ | 受け入れ条件が要件と別の量を測っていた | AC | anchorの各fieldを名指しする形へ是正し、Step 2を再確定 | `issue validate --stage=requirements` valid true | updated | pass |
| DISC-1408-02 | 本Issue自身のstagingが是正前の`issue create`で作られ03が0664。自分が直す欠陥を自分で再現している | 是正前は拒否、是正後はroundが開く | なし | 迂回の`chmod`を当てず、そのままbug-reproductionの対比に使った | 公開CLIで終了値1→0を実測 | no-spec-impact | pass |
| DISC-1408-03 | 「exact mode比較がinit時点でsymlinkを拒否する唯一の条件」は過大な評価だった。`calculateStagingDigest`と`listStagingArtifacts`が先に拒否する | symlinkに関する安全側の主張が実際より弱い防御を根拠にしていた | なし | 00 Q-03根拠・01 §10・02 §5を実態へ是正 | symlinkの03で`成果物はsymlinkでない通常fileが必要です`を実測 | no-spec-impact | pass |
| DISC-1408-04 | 変異D-04（adapterがmode-mismatchのときだけ案内する）が全gate緑のまま生存した。unitが`describeReviewProgressUnbuildable`を直接呼ぶだけで、adapterがどの分類で案内を出すかという合成経路を検査していなかった（SCN-INT-PROGRESS-035で是正） | AC-1408-02の観測が合成経路に無かった | AC | SCN-INT-PROGRESS-035を追加し観測をintegration層へ移した | 同じ変異を再実行してkillを確認 | updated | pass |
| DISC-1408-05 | round 2の是正後に再発変異8件を当てたところ5件が生存した。コードを直してtestを足していなかった | 是正そのものが未検証だった | なし | SCN-UNIT-PROGRESS-040とSCN-INT-PROGRESS-036〜039を追加 | 再実行で7件kill、残1件は等価と実証 | updated | pass |
| DISC-1408-06 | `lstat`のENOENT限定分岐は観測できない。stagingが走査不能なら`readStoredStagingRecord`が先にEACCESで落ちる | そのために書いたSCN-036が狙った分岐に対して空虚だった | なし | SCN-036のscenario名とコメントを実際に検証している内容へ縮小。分岐は防御として残す | `Error: EACCES ... staging-record.json at readStoredStagingRecord`を実測 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1408-01 | SCN-INT-PROGRESS-026、027 | `src/adapters/review-session.ts`のanchor構築 | 合格 | pass | roundが開きanchorにinventoryが無く、差がinventory keyだけ |
| AC-1408-02 | SCN-UNIT-PROGRESS-022、024、025、040、SCN-INT-PROGRESS-035、038 | `src/domain/review-progress.ts`の案内純関数 | 合格 | pass | 分類・実測・期待・相対name・行動・authority・rollbackを合成経路で観測 |
| AC-1408-03 | SCN-UNIT-PROGRESS-023、SCN-INT-PROGRESS-037 | 同上のsymlink・非通常file分岐 | 合格 | pass | `chmod`を案内せず対象を名指しする |
| AC-1408-04 | SCN-INT-PROGRESS-031、032、033、039 | `src/domain/issue.ts`、`src/adapters/workflow-journal.ts` | 合格 | pass | `umask 0002`/`0077`/template `0664`/昇格経路で`0644` |
| AC-1408-05 | SCN-INT-PROGRESS-028、029、036 | adapterの分岐と`src/adapters/review-progress.ts` | 合格 | pass | 分類外はEACCESを名指しして拒否、不成立sessionは直列経路を案内 |
| AC-1408-06 | SCN-INT-PROGRESS-030 | 消費側3経路（無変更） | 合格 | pass | `fileMode`が実測modeと一致しinit後のmode変化を拒否 |
| AC-1408-07 | SCN-E2E-PROGRESS-034 | 配布CLIのargv経路 | 合格 | pass | `main()`経由で終了値0、手動`chmod`なしでinventory固定 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | staging filesystemがtrust boundaryで、file mode・種別・link数がidentity判定に使われる | 脅威はsymlink・非通常file・TOCTOU・診断からの情報漏洩。SCN-UNIT-PROGRESS-023、024、SCN-INT-PROGRESS-037で確認。案内はstaging相対nameとcommand名だけを出し絶対path・環境変数・tokenを出さない。秘密情報を扱わず保持対象を持たない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 本変更の成果物そのものが拒否時の案内であり、利用者はこの出力だけで処置を決める | SCN-INT-PROGRESS-035が分類・実測・期待・行動・authority・rollbackの合成経路出力を固定。新規log fileもmetricsも作らないため保持・rotationは対象外。復旧は`chmod`再実行で観測できる |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 本製品はNode CLIであり、画面契約とa11y検証の対象となる画面・操作・支援技術interfaceを一切所有しない。JSON出力であることを根拠にしていない | `package.json`の`bin`が提供面の全体で、UI sourceもdesign tokenも存在しない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 画面レイアウトと視覚コンポーネントを所有しない | projectKind=cli、UI sourceなし |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | REQ-WF-021の明文「progressの失敗を拒否理由にしない」に実装を一致させた。同一staging・同一HEADで終了値が1→0へ変わることを公開CLIで実測 |
| 価値（利用者・運用上の目的） | pass | `umask 002`と`0077`の環境で`full`が完走する。optionalな補助機能の失敗が主経路を止めない構造になり、marker不正・task ID欠落という同型の停止も同時に解けた |
| 実現可能性（環境・依存・権限） | pass | 依存を追加せずnode:fsだけを使う。`chmod`がumaskから独立する根拠は実測済みで、`src/lib/atomic.ts`の`fchmodSync`先例と整合する。modeを保持しないfilesystemでも生成を止めない |
| 整合性（設計・コード・テスト・仕様） | pass | 02の設計判断3件が実装と一致する。round 1で4箇所の記述と実装の食い違い（REV-01）と自分の契約違反（REV-04）を検出し、round 2で解消した |
| 保守性（責務・命名・変更容易性） | pass | 構築・案内・表示を3責務へ分離し、分類を閉じた列挙として型で閉じた。分類名はTERM-ASC-125の定義と1対1 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | 変異試験を本体29件・再発8件で実施。生存はREV-02の是正に対する1件だけで、観測不能であることを実測で示した（DISC-1408-06）。削除変異が全killでも検出力を示さないため、値の空洞化・走査条件外配置・条件の狭めを別枠で持った |
| 失敗経路（外部失敗・部分失敗） | pass | 分類外のI/O失敗は例外のまま伝播する（SCN-INT-PROGRESS-028がEACCESを名指し）。`chmod`の失敗は生成・昇格を止めない。round 1でfail-open経路（REV-02）を検出し是正した |
| 境界値（空、最大、最小、重複、Unicode） | pass | mode `0644`/`0664`/`0600`/`0755`/`0777`、3桁未満の`0o044`、`0o100644`、marker 0組・1組・2組・片側、task ID 0件を観測。Unicodeは新しい文字列入力を受け取らないため対象外 |
| 悪用（注入、経路脱出、権限外） | pass | symlinkはmode比較より前に`not-regular-file`へ落ち`chmod`を案内しない。案内の純関数はpathを受け取らないので絶対path・環境変数・tokenが構造的に出ない。inventory不成立でauthorityは増えず`review progress`は従来どおり拒否する |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | 新しいauthorityも承認経路も作らない。消費側3経路の再検証を変えていない。producerの申告を信頼せず消費側が毎回`lstat`で再検証する構造を維持 |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | `calculateStagingDigest`はpathとcontentだけでmodeを含まないため既存stagingのdigestは不変。`chmod`は原子公開前の一時directory内。migrationも永続schema変更もない |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | 全変更がrevert可能。案内を永続化せず、review sessionを変更しない |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | round 1で第2のproducer（REV-05 `workflow promote-full`）の取りこぼしを検出し是正した。`dist/`を再生成済みで、src変更のcommit漏れがない |

## 5. 指摘

指摘なしの場合は「指摘なし」と明記する。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-01 | High | chmodが無保護で、EPERM/ENOTSUPを返すfilesystemで`issue create`全体が失敗する。要件・設計・doc comment・自己申告のすべてが「失敗しても拒否しない」と書いていたのに実装だけが停止点を作っていた | `src/domain/issue.ts`のchmod呼び出し。AC-1408-04はumask 3条件しか検査していなかった | staging生成の全経路 | best-effortへ変更 | resolved / acceptance-violation | なし |
| REV-02 | High | `fs.existsSync`はEACCESでもfalseを返すため、読めない03を「03が無い」と誤認して案内も出さずroundを開くfail-open経路があった | 親directory`0o000`で`existsSync=false`、`lstatSync=EACCES`を実測 | review round --initの全入力 | `lstatSync`へ置き換えENOENTだけを不在扱い | resolved / acceptance-violation | なし。ENOENT限定分岐自体は観測不能（DISC-1408-06） |
| REV-03 | High | `readFileSync`が種別判定より前にあり、directory・FIFO等が「通常fileでない」の分類へ到達しなかった | REQ-WF-021の閉じた列挙と実装の食い違い | 非通常fileの03 | `isFile()`を読み取りより前に判定 | resolved / acceptance-violation | なし |
| REV-04 | High | `splitTarget`を包括catchしており、「分類を例外捕捉で束ねない」という要件・設計・コメント・自己申告のすべてに反していた | `src/domain/review-progress.ts`の当該catch | 将来splitTargetへ足す失敗 | `trySplitTarget`を値返しにしてcatchを撤去 | resolved / invariant-violation | なし |
| REV-05 | High | 03のproducerは2つあり、`workflow promote-full`の昇格補完が未是正だった。昇格経路の03はtemplateのon-disk modeを継ぐ | `promoteWorkflowStagingToFullLocked`の`copyFileSync`にchmodが無い | quick/pocからfullへ昇格した全staging | 同じ固定を追加し要件の主語を両経路へ拡張 | resolved / acceptance-violation | なし |
| REV-06 | Medium | SCN-INT-PROGRESS-027が別repoを作り直してcommit SHAを比較しており、秒境界を跨ぐとCIが確率的に赤くなる | fixtureが`GIT_AUTHOR_DATE`を固定していない | 当該SCN | 同一repo・同一stagingでの比較へ変更 | resolved / fix-regression | なし |
| REV-07 | Medium | 案内の必要authority・rollback・影響を合成経路で一度も検査していなかった | SCN-INT-PROGRESS-026、035のThen | AC-1408-02の観測 | SCN-035へ3項目の検査を追加 | resolved / acceptance-violation | なし |
| REV-08 | Medium | SCN-E2E-PROGRESS-034が「配布CLI」を名乗りながらadapterを直接呼び、終了値も`src/cli.ts`も通っていなかった | scenario名・AC証拠欄・追跡表の実装欄と実体の不一致 | AC-1408-07の観測 | `main()`のargv経路と終了値0の観測へ変更 | resolved / acceptance-violation | なし |
| REV-09 | Medium | SCN-INT-PROGRESS-033が製品repositoryの追跡済みtemplateをchmodし、復元が`finally`頼みだった。gitは0644と0664の差を追跡しないため残留を検出できない | 当該Given | 製品repositoryのtemplate mode | After hookで無条件復元 | resolved / improvement | 隔離できていない点は残る。`issueTemplateRoot`を注入可能にする是正は本Issueのscope外 |
| REV-10 | Medium | 片側markerだけの03が分類も案内も経由せず無言でinventoryなしになっていた | adapterのmarker判定 | 壊れたmarkerを持つstaging | 片側でも判定へ回す | resolved / acceptance-violation | なし |
| REV-11 | Medium | 必要authorityが全分類でmode変更権限。marker是正やfile置換はその権限では実行できず案内が行動可能にならない | 案内純関数 | AC-1408-02 | 分類ごとに分離 | resolved / improvement | なし |
| REV-12 | Low | `padStart(3)`と`& 0o777`を落とす変異が全testを生存した。unitが渡すmodeが3桁octalだけだった | 案内の桁組み立て | 3桁未満のmode | `0o044`と`0o100644`の観測を追加 | resolved / improvement | なし |
| REV-13 | Low | 段落分割で`issue validate`のplaceholder検査に属する2文の主語が切れた | CLI契約文書 | 読者の誤読 | 元の段落末尾へ戻した | resolved / improvement | なし |
| REV-14 | Low | INV-01の「round recordのdigestは当該keyの有無ぶんだけ変わる」は誤り。roundDigestはanchorを含まないため不変で、変わるのはanchorから導くsession ID | `computeRound`の`roundWithoutDigest` | 要件とINVの記述 | 記述を是正 | resolved / improvement | なし |
| REV-15 | Low | `notes`の内容契約はREQ-WF-014が所有するが、項目を足したのに関係が明記されていなかった | REQ-WF-021とREQ-WF-014 | 仕様の所有境界 | 所有を明記 | resolved / improvement | なし |
| REV-16 | Low | dead codeが残っていた | stepDefinitionsの戻り値をvoidで捨てる行 | 保守性 | 削除 | resolved / improvement | なし |
| EXT-01 | Medium | `describeReviewProgressUnbuildable`がdirectory・FIFOの実測modeをGit風の`100${octal}`で案内しており、`100755`のような存在しない観測値を出していた | 外部review（CodeRabbit）の指摘。`isSymbolicLink`が偽の分類はすべて`100`接頭辞へ落ちていた | 非通常fileの03に対する案内文 | `isRegularFile`を入力へ加え、通常file以外はpermissionだけを示す | resolved / acceptance-violation | なし |
| EXT-02 | Medium | template mode復元のAfter hookが`catch`で失敗を握り潰しており、追跡済みtemplateが0664のまま後続scenarioと開発環境へ残る経路があった | 外部reviewの指摘。gitは0644と0664の差を追跡しないので`git status`もCIのclean検査も検出しない | test fixture全体と開発環境 | 失敗を集約してAfter hookからthrowする | resolved / invariant-violation | なし |
| EXT-03 | Minor | REQ-WF-021は`issue create`と`workflow promote-full`の両方を対象にするのに、管理データと変更履歴が`issue create`だけを記載していた | 外部reviewの指摘。仕様本文と実装（REV-05で両経路を是正済み）の食い違い | 仕様2文書 | 両文書へ`workflow promote-full`を追記 | resolved / acceptance-violation | なし |
| EXT-04 | Major | SCN-E2E-PROGRESS-034が`createIssueStaging`を直接呼んでおり、「配布CLIのissue create出力」を名乗りながら公開CLIのhandlerを一行も実行していなかった | 外部reviewの指摘。doc commentは公開CLI経路と書いていたが実装が伴っていなかった | E2Eの合成経路検査 | `main(["issue","create",...])`経由へ変更。mode固定を落とす変異でkillすることを確認した | resolved / invariant-violation | なし |
| EXT-05 | Low | R-01の生存変異を「観測可能な差を作れない」として等価と判定していたが、`EIO`や`ESTALE`は先行するrecord読み取りが成功したうえでも起こり得るため、主張が証拠を超えていた | 外部reviewの指摘 | 本artifactの記述 | 「現在のfixtureでは観測できない」という限定へ書き換え、等価とは判定しないことを明記した | resolved / improvement | 当該分岐を観測するfixtureは持たない |
| EXT-06 | Minor | `describeReviewProgressUnbuildable`が`not-regular-file`のとき`isSymbolicLink`を見ずに常に「symlinkです」と案内しており、directoryやFIFOへsymlink固有の理由（chmodがlink先を書き換える）を出していた | 外部reviewの追加指摘。`observed`欄はEXT-01で種別を区別済みだったが`action`欄の是正が漏れていた | 通常fileでない03に対する案内文 | `isSymbolicLink`で案内を分岐。あわせてSCN-INT-PROGRESS-037へ案内本文を名指しするassertionを足し、分岐を潰す変異でkillすることを確認した | resolved / acceptance-violation | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。H_impl `10242151` に対し、独立reviewer（context B）とcodexの敵対reviewを別contextで実施した
- 指摘を確定した: 16件（High 5、Medium 6、Low 5）。両reviewerが独立にREV-01とREV-04を検出した
- 次ラウンド対象のCritical/High: REV-01、REV-02、REV-03、REV-05（`invariantIds`が空のためREV-04はblockingに数えられていないが、同じroundで是正した）

### ラウンド2

- 未解決Critical/High: 0件。REV-01〜16をすべて`resolved`として再評価した
- 修正差分と、触れた隣接範囲: H_impl `1e9ef564`。fixed diff 15 path（`src/`4、`test/`3、`docs/specs/`4、`dist/`4）。隣接範囲は`workflow promote-full`の昇格補完で、REV-05の是正として意図的に触れた
- 既承認・未変更範囲を再走査していない: はい。round 1で判定済みかつ未変更のpathを再監査していない

### ラウンド3（外部reviewの取り込み）

- 全指摘の最終分類: 外部review（CodeRabbit）の指摘6件をEXT-01〜06として確定し（うちEXT-06は追随merge後の再reviewで受領）、実コードで1件ずつ再現を確かめてから是正した。Major 1・Medium 2・Minor 2・Low 1で、Critical/Highは0件
- 是正差分と、触れた隣接範囲: 実装commit `81ae6c62`とEXT-06の`5bbd25c2`。`src/`2、`test/`1、`docs/specs/`4、`dist/`2。隣接範囲はEXT-04の合成経路変更に伴うSCN-E2E-PROGRESS-034のGivenのみで、判定側（`review round --init` handler）は変更していない
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: EXT-01は案内文字列だけを変え、受理・拒否の集合を変えていない。EXT-02はtestのAfter hookのみで製品コードに触れない
- 同じ範囲の予算を自動更新していない: はい。counted roundは3で、予算6・通算8の範囲内
- 検査が空虚でないことの確認: EXT-04の是正について、`issue create`のmode固定を落とす変異を注入し、SCN-E2E-PROGRESS-034がkillすることを実測した。復元は複写で行い`git checkout`を使っていない

## 7. テスト結果

- 実行したcommandの一覧: `npm test`、`npm run conformance:check`、`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run source:check`、`npm run docs:format`、`npm run test:format`、`npm run trace:check`、`npm run architecture:check`、`npm run workflow:check`、`npm run cli:check`
- 全layerの合計: 既定branch追随merge（`d82f93b1`）後のHEADで再実行し、`npm test` 2,154 scenarios（2,138 passed、16 skipped、**失敗0**）、17,769 steps（17,719 passed、50 skipped）。`conformance:check`・`package:check`・`project:quality`・`lint`・`format:check`・`typecheck`・`source:check`・`docs:format`・`test:format`・`trace:check`・`architecture:check`・`audit:check`はいずれも合格。**追随merge前のラウンド2時点の実測は2,096 scenarios・13,098 stepsであり、増分は取り込んだ既定branch側のSCNである。**
- runner・Gherkin方言: cucumber-js、`gherkinDialect=en`、日本語step。project choicesの`testLayers`は`unit`/`integration`/`e2e`で、新規19 SCNは各層へ配置した

### 変異試験

**契約本文の側から変異を作った。** assertionが名指しした字面だけから作ると、自分が見ている場所を自分で消して気付いただけの結果になる。

| 枠 | 件数 | kill | 生存 | 備考 |
|---|---|---|---|---|
| A 削除 | 6 | 6 | 0 | A-04は`error TS2873`によりtypecheckがkill |
| B 値の空洞化 | 7 | 7 | 0 | 欄名を残して値だけを空にする変異 |
| C 走査条件外への同形配置 | 5 | 4 | 1 | 生存1件は等価（union 2状態の言い換え） |
| D 条件を狭める | 5 | 5 | 0 | D-04は当初生存し、SCN-INT-PROGRESS-035の追加でkill |
| E 自分が消した安全条件 | 3 | 3 | 0 | 削除した`if (fileMode !== 0o644) throw`等へ当てた |
| R 是正の再発 | 8 | 7 | 1 | 生存1件は観測不能（下記） |

**特筆すべき2件。**

1. **B-06**: Issue #1408の案1を字面どおり実装する変異（`writeFileSync`へ`mode`を渡す）は、**4 SCN中3件を素通りし`umask 0077`のSCN-INT-PROGRESS-032だけがkillした。** CIのumaskは0022なので、この1件が無ければ誤った実装が全green で通っていた。
2. **R-01**: `lstat`のENOENT限定をbare catchへ戻す変異は生存する。**現在のfixtureでは観測できない。** `lstat(03)`がENOENT以外で失敗する経路として実測できたのはstaging directoryが走査不能な場合だけであり、そのとき必ず先に`readStoredStagingRecord`が`staging-record.json`の読み取りでEACCESを投げる。**等価とは判定しない。** `EIO`や`ESTALE`は先行するrecord読み取りが成功したうえでも起こり得るため、bare catchへ戻すと本来ENOENT以外であるべき失敗を「03が無い」として扱う意味の差が残る。この差を観測するfixtureを現在持たないという限定で記録する。分岐は防御として残す。

**C枠の生存1件**（`outcome.state === "built"`を`!== "unbuildable"`へ）は、`ReviewProgressInventoryOutcome`が2状態のunionであるため論理的に同値であり、等価と判定した。

変異の復元は複写で行い、`git checkout`を使っていない。復元後に`dist/`を再生成し、src/testとの一致を確認した。

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/review-progress.ts` | 入る | `review round --init`がprogress inventoryを構築できない入力で拒否しなくなる。分類つきの案内が`notes`へ出る |
| `src/adapters/review-session.ts` | 入る | 同上。読めない03を不在扱いしなくなる |
| `src/domain/issue.ts` | 入る | `issue create`が生成する`03_実装計画.md`のmodeが実行環境のumaskに依存せず`100644`になる |
| `src/adapters/workflow-journal.ts` | 入る | `workflow promote-full`の昇格補完で生成する03も同じmodeになる |
| `dist/src/domain/review-progress.js` | 入る | 上記srcの生成物 |
| `dist/src/adapters/review-session.js` | 入る | 同上 |
| `dist/src/domain/issue.js` | 入る | 同上 |
| `dist/src/adapters/workflow-journal.js` | 入る | 同上 |
| `docs/specs/`配下6 file | 入らない | 利用projectの`docs/specs/`は利用側所有。package配布物に含まれない |
| `test/`配下4 file | 入らない | package配布物に含まれない |

判断: 配布物を更新した

根拠: `src/`4 fileと対応する`dist/`4 fileがpackage配布境界に入る。`review round --init`の終了値と診断、`issue create`と`workflow promote-full`が生成する03のmodeという外部観測可能な振る舞いが変わる。いずれも受理集合を広げる方向で、既存の成立入力の結果・inventory schema・型・消費側3経路を変えない

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはこのsessionのcontext A。reviewerは2体で、いずれも別contextかつ`H_impl`を固定して読み取り専用で実行した。(1) context B（Claude、read-onlyの独立session、`10242151`固定、file変更なしを`git status` cleanで自己申告し、本文書作成前に終了）。(2) codex（別provider、`codex exec --sandbox read-only`、同じ`10242151`を対象）。両者は独立にREV-01とREV-04を検出しており、観点が重複しただけの単一source ではない |
| reviewerが対象差分を変更していないこと | はい。round 1のreview実行中は作業treeを触っていない。reviewは`git diff 85160d59 10242151`とcommit済みblobに対して行われ、是正commit `1e9ef564`は両review完了後に作成した |

外部への不可逆な配布で外部証拠を要求され、かつ無い場合だけ次を記入する。承認元・承認者・承認日時・失効日時は正本を参照し複製しない。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | {正本fileのexceptionId} |
| 観測値 | {未実行と判定した根拠の実測値} |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-021）、`01_システム概要/02_用語・略語.md`（TERM-ASC-125追加）、`07_データ/01_管理データ.md`、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: はい。00 §4.2の候補 → 01 §2.1の確定 → 耐久台帳のTERM-ASC-125という一方向。TERM-ASC-107は参照のみで再定義していない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。TERM-ASC-125の分類語は実装の`REVIEW_PROGRESS_UNBUILDABLE_REASONS`と1対1で、SCN名・案内文・仕様本文で同じ語を使う。廃止した用語はない
- 要件・変更・SCN・テストの追跡: REQ-WF-021 → AC-WF-021 → SCN-UNIT-PROGRESS-022〜025・040、SCN-INT-PROGRESS-026〜039、SCN-E2E-PROGRESS-034。新規SCNはいずれも要件本文から到達でき、`trace:check`が合格している
- `no-spec-impact`の場合の限定的根拠: 該当なし
- UI・トークンの判断: DC-UXとDC-TOKENSは`not-applicable`（§2.2に理由と証拠）

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。round 1のHigh 5件はすべてround 2で`resolved`
- Medium/Lowの記録: Medium 6件・Low 5件をすべて§5へ記録し、いずれも是正済み。REV-09だけ残存リスクを明記した
- 判定: approved
- 新しい権限が必要な事項: なし。本変更は新しいauthorityも承認経路も作らない
- 残存リスク: (1) REV-09のtemplate mode隔離。`issueTemplateRoot`を注入可能にする是正は本Issueのscope外で、別Issue候補。(2) `review artifact --init`の既定出力名`<Issue番号>_レビュー.md`が`pr reanchor`の`REVIEW_ARTIFACT_NAME`（`/^\d+_課題\d+.*レビュー\.md$/`）に一致しない。本PRでは`--out`で規約名を指定して回避したが、製品の既定値としては別Issue候補
- 次に許可される操作: `workflow record --step=10` → 本fileのcommit（`H_final`）→ `pr create`。`merge.mode=assisted`のためPR作成で停止し、mergeはowner承認を待つ
- 次回の再開地点: session `cf4ce1f280591ed22ec3092bc66c9e19977c53f4fde08a6dca4c5f9259535d53`、latest round digest `bbef65b04c24cd1c51a8376477f75ee33057e655d5671ea679719c5f4ef99a42`、`H_impl` `1e9ef564d268a529c4d43cbabfdd4a6e3d8fce44`

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 3 |
| 対象SHA・文書ダイジェスト | 5bbd25c2efaee97caab9e5615936b8858da84545 |
| 比較基点 | `a52fffcce1bf0dee0213bbe34b80b364f0580c3f` |
| H_impl | `5bbd25c2efaee97caab9e5615936b8858da84545` |
| 対象差分 | dist/src/adapters/review-session.js、dist/src/adapters/workflow-journal.js、dist/src/domain/issue.js、dist/src/domain/review-progress.js、docs/reviews/224_課題1408progress構築失敗の非停止化レビュー.md、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/07_データ/01_管理データ.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/review-session.ts、src/adapters/workflow-journal.ts、src/domain/issue.ts、src/domain/review-progress.ts、test/features/e2e/review-progress-cli.feature、test/features/integration/review-progress.feature、test/features/unit/review-progress.feature、test/steps/review-progress.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | counted round 3（同一scope最大6、通算8） |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260916_161015_progressの構築失敗でreview-gateを止めず生成modeをumaskから独立させる |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-021「review、test、PR、merge、releaseのgateは専用journalもprojectionも読まず、progressの失敗を拒否理由にしない」 |
| 成果物行数 | 製品（`src/`4 file）+248 / -30行。支援層は`test/`+610行、`docs/specs/`+32行。testが製品の約2.5倍なのは、変異試験で検出した穴（D-04、R-01〜R-09）を合成経路の観測で塞いだため |
| 縮小の先行評価 | 既存手段の縮小で足りる方向に倒した。本変更の中心（構築失敗をreview gateの拒否理由にしない）は門の**追加ではなく適用範囲の縮小**であり、新しい門・authority・stateを1つも足していない。診断はREQ-WF-024が確立済みの「判定を持たない純関数が案内を生成し、判定・終了値を変えない」機構の再利用で、新機構ではない。生成modeの固定は`src/lib/atomic.ts`の`fchmodSync`、`adapters/graphqlite.ts`、`adapters/poc-execution.ts`と同じ既存patternの適用。Issue案2（判定側の緩和）は`0o600 & 0o755 = 0o600`のため`umask 0077`を解消せず、init時のmode固定という性質も失うため採らなかった |
| 実施者・日時 | reviewer（context-isolated、context B + codexの2体）、2026-09-16T11:30:00Z |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review各8観点とfinding 16件の分類を§3〜§5へ記録 | critical（risk=high、外部契約変更、security境界に触れる） | claude（上限Opus）、codex（上限high） | project choiceの`modelMapping.roles.reviewer`（claude / project_default / high / standard） | 未解決Critical/Highが残る場合はPR作成へ進まず停止。再開地点は§11 | §9のとおり。reviewerは別contextで読み取り専用、対象差分pathを変更していない |
