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
| 何が問題だったか | ASCに有限選択判断（deterministic codeでもGenerative Modelの深い推論でもない判断）を機械的に切り出す型と候補一覧が無く、Semantic Graphと同じ「実装されているが誰も呼ばない」再発リスクがあった |
| 何を解決しようとしたか | Decision Contract型（値・confidence・呼び出し先）と、Step skill・src配下の候補一覧（file:line、採否、除外理由）を届ける。routing/authorityへの実際の組込みとJev固有実装は対象外（v0.4.2以降） |
| 何を行ったか | `src/domain/decision-contract.ts`を新設（DecisionContract/DecisionCandidateEntry discriminated union/DecisionJournalField/DECISION_CANDIDATES）。候補12件（採用5・除外7）を実行時grepで実在確認。`docs/specs`6fileへ反映。main追随によりREQ-WF-026/AC-WF-026をREQ-WF-029/AC-WF-029へ改名（#1482との採番衝突回避） |
| 何を確認したか | `npm run typecheck`/`lint`/`format:check`/`quality`系全gate。`npm test`全件（最終2352 scenario、0 failed）。独立reviewer（Codex round 1、CodeRabbit round 2）による肯定・敵対評価。main追随（round 3）はself-auditで再検証 |
| 判定 | approved（§11参照） |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260925_170425_v0.4.1-Decision-Contract定義-呼び出し元の名指し | staging digest d892890acafc72b036ea169df21b986225b347b5d1c9ee86ea2b5cbe6bca17e9 | 既存コード |
| 差分 | `824b83710909bf81d2eb988606e0e43b46b76545`..`f8053815a2bba5fd3fe9cd257a084311b113ac06` | 10 path | 既存コード |
| テスト | 2352 scenarios中2335 passed・17 skipped・0 failed（`npm test`全layer再実行） | 合格 | テスト出力 |
| 仕様 | `docs/specs`6fileへ反映済み（§10参照） | updated | 既存文書 |
| commit前candidate | dist/src/domain/decision-contract.js、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/00_要件一覧.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/03_アーキテクチャ/00_全体構成.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/domain/decision-contract.ts、test/features/unit/decision-contract.feature、test/steps/decision-contract.steps.ts | H_impl f8053815a2bba5fd3fe9cd257a084311b113ac06 | Git index |
| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260925_170425_v0.4.1-Decision-Contract定義-呼び出し元の名指し | round1〜3、`status=converged`、`latestRoundDigest=c927b2800323e553b576c4b527cd8987b2bd83761c1b6cccc6eb5c04a9c74524` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。`architecture:check`合格、依存辺0本
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_final`確定後に`audit:check`で検証する（本artifact commitが唯一の追加）
- reviewerの独立性が要求水準を満たす: はい。`merge.reviewIndependence`未宣言のため既定`context-isolated`。round 1 reviewer(Codex)・round 2 reviewer(CodeRabbit)いずれもimplementer(Claude、本worktree session)と別context
- 既定branch追随を行った場合、取り込みがartifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: **該当する。** round 3でIssue #1482（PR #1492）のmain先行mergeを取り込んだ。round 2のH_final `5e326d15`（review artifact含む）へ`git merge origin/main`（`824b8371`）を実施し、共有台帳2file（00_要件一覧.md、01_ワークフロー要件.md）の衝突を**両親の内容をそのまま保持する形**で解消してmerge commit`bb4392c5`を作成した（`02_品質基準.md`「安定IDの意図的な削除はmerge commitでは行わず、mergeの後の通常commitで行う」に従い、この時点ではREQ-WF-026の改名を行わない）。続く1つの通常commit`f8053815`で、(1) Issue #1483側のREQ-WF-026/AC-WF-026をREQ-WF-029/AC-WF-029へ改名、(2) main追随によるsrc/cli.ts行shiftへcaller citationを追随（H-06、§5参照）、(3) round 2のreview artifact（この時点でtreeがmergeから継承していた）の除去、の3点を1commitへまとめて反映した。`audit:check`のH_impl自動導出は評価対象path全てがevidence-only allowlist配下の commit を遡って読み飛ばすため、review artifact削除だけを独立commitにすると誤って読み飛ばされ`H_impl`が1つ手前のcommitへ後退してしまう（実測で発見・是正）。3点を1commitへまとめることでこの後退を避け、`f8053815`を`H_impl`として確定させた。`比較基点..H_impl`の差分からreview artifactが完全に外れることを`git diff --name-only`で確認済み。`比較基点`=`824b8371`（取り込んだmain tip）、`H_impl`=`f8053815`。個別監査表は`824b8371..f8053815`から`review artifact --init`で再生成した（round 2以前の11file表は流用していない）。`node --import tsx scripts/check_file_audit.ts`のmerge-integrity検査（両親の安定IDが保持されているか）およびH_impl自動導出の完全一致で確認済み

### 1.1 変更ファイル個別監査

基準SHAとの差分にある全ファイルを、生成物（`dist/`等）も含めて1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。`audit:check`の他の検査対象外となる生成物でも、各行へ生成元との対応確認方法と配布影響の確認方法を記録し、差分path集合と表のpath集合を一致させる。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `dist/src/domain/decision-contract.js` | A | package（ASC本体、生成物） | 生成物 | 生成物。`src/domain/decision-contract.ts`からの`npm run build`出力（tsc compile）。生成元との対応は`git diff`で確認済み（手編集なし）。merge後`npm run build`を再実行しdist差分0件を確認 | 生成元 → 生成物 | src側と同じRQ-01〜04/AC-01〜05 | §8の配布物影響表とpackage filesで確認。`git rm`で即時rollback可能 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package（ASC本体） | docs/specs | システム仕様書。TERM-DC-001（Decision Contract）を追加する1行。main追随でIssue #1482のTERM-ASC-131〜133と隣接するが行は独立（衝突なし、auto-merge） | spec → src（許可された向き） | TERM-DC-001、RQ-01 | システム仕様書。追記のみで既存行を変更しない。`git revert`で即時rollback可能 | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | package（ASC本体） | docs/specs | システム仕様書。REQ-WF-029を追加する1行（main先行のREQ-WF-026/027採番衝突を避け026→029へ改名。028は#1484用に予約）。mergeでは両親の行（main側のREQ-WF-026/027含む）を両方保持し、改名は後続の通常commitで実施 | spec → src（許可された向き） | REQ-WF-029 | システム仕様書。追記のみ。`git revert`で即時rollback可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package（ASC本体） | docs/specs | システム仕様書。REQ-WF-029の詳細節とAC-WF-029を追加（同上、026→029へ改名。main側のREQ-WF-026/027節はmergeで無変更のまま保持） | spec → src（許可された向き） | REQ-WF-029、AC-WF-029 | システム仕様書。末尾への追記のみで既存節を変更しない。`git revert`で即時rollback可能 | pass |
| `docs/specs/03_アーキテクチャ/00_全体構成.md` | M | package（ASC本体） | docs/specs | システム仕様書。境界づけられたコンテキスト一覧へDecision Contractを1項目追加 | spec → src（許可された向き） | RQ-01〜04 | システム仕様書。既存mermaid図・component表は変更しない（新規componentIDを持たないため）。`git revert`で即時rollback可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package（ASC本体） | docs/specs | システム仕様書。追跡表へ1行追加（REQ-WF-029、auto-merge） | spec → src（許可された向き） | REQ-WF-029、AC-WF-029、SCN-UNIT-DC-001〜005 | システム仕様書。追記のみ。`git revert`で即時rollback可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package（ASC本体） | docs/specs | システム仕様書。変更履歴へ1行追加（header直後、REQ-WF-029、auto-merge） | spec → src（許可された向き） | REQ-WF-029、AC-WF-029 | システム仕様書。追記のみ。`git revert`で即時rollback可能 | pass |
| `src/domain/decision-contract.ts` | A | package（ASC本体） | domain | 有限選択判断の型契約（DecisionContract）と候補一覧（DECISION_CANDIDATES）・journal field設計（DecisionJournalField）の定義に単一責務を限定。既存`src/domain/`の他fileへ依存しない独立module | 依存辺0本（`architecture:check`合格、`decision-contract`nodeは下流を持たない） | RQ-01〜04/AC-01〜05（REQ-WF-029/AC-WF-029）、SCN-UNIT-DC-001〜005 | secret/PIIを持たない設計（DC-PRIVACY）。新規fileのみのため`git rm`で即時rollback可能 | pass |
| `test/features/unit/decision-contract.feature` | A | package（ASC本体） | test | SCN-UNIT-DC-001〜005のGherkinシナリオ。単一feature fileに閉じる | test → 対象（許可された向き） | AC-01〜05を1シナリオ1AC対応で被覆 | testのみで副作用なし。`git rm`で即時rollback可能 | pass |
| `test/steps/decision-contract.steps.ts` | A | package（ASC本体） | test | feature内Given/When/Thenの実装。DECISION_CANDIDATESの構造検証・4 schemaとのfield名diff・TypeScript Compiler APIによる型陰性testを担う | test → 対象（許可された向き）。`typescript`packageは既存devDependency | AC-01〜05に対応する検証ロジックを実装 | filesystem読み取りは`.agent-skill-chain/schemas/*.schema.json`の読み取り専用open限定。`git rm`で即時rollback可能 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい。round 3で`review artifact --init --base=824b8371 --head=f8053815`を再実行し10 pathを機械抽出、上表と一致（review artifact自身はH_implのtreeに存在しないため対象外。round 2で生じていた11件目の自己参照行は、main追随でH_implをartifact非包含の整理commitへ置き直したことで解消した）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: はい
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: round 3はmain追随に伴う衝突解消（2file）とREQ-WF-026→029改名・citation行shift是正（decision-contract.ts含む6file）に限定し、他fileは再監査していない

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | SCN-UNIT-DC-004の初回実行で`DecisionJournalField`の`recordedAt`が既存journal schema4file全てと、`decisionId`が`delivery-state.schema.json`と衝突すると判明した | AC-04（journal schemaとのfield名非衝突） | 種別: interface（`DecisionJournalField`のfield名） | `recordedAt`→`decidedAt`、`decisionId`→`decisionRecordId`へ改名し、比較対象を3→4 schemaへ拡大 | `node --import tsx cucumber.js --name "SCN-UNIT-DC-00[1-5]"`で5 scenario全合格（改名前は1件失敗を実測） | updated（01/02/03、`docs/specs/02_要件/01_ワークフロー要件.md`のAC-WF-029記述） | pass |
| DISC-002 | Issue #1482（PR #1492）がmainへ先行mergeされ、そのREQ-WF-026/027とIssue #1483のREQ-WF-026が番号衝突した | 要件ID体系の一意性（`docs/specs/02_要件/00_要件一覧.md`規約「末尾の3桁連番は各コンテキスト内の安定番号」） | 種別: requirement（要件ID、内容は不変） | owner指示によりIssue #1483側のREQ-WF-026/AC-WF-026をREQ-WF-029/AC-WF-029へ改名（028は並行Issue #1484用に予約） | `grep -rn "REQ-WF-026\|AC-WF-026"`で改名対象6fileを特定し全件改名、main側の同名tokenは保持したまま残存0件を確認 | updated（00_要件一覧.md、01_ワークフロー要件.md、15_要件追跡/00_追跡表.md・01_変更履歴.md、decision-contract.ts） | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-DC-001 | `src/domain/decision-contract.ts`の`DecisionContract`interface | pass | pass | `npm run typecheck`合格、feature実行5/5 pass |
| AC-02 | SCN-UNIT-DC-002 | `DECISION_CANDIDATES`（採用5件） | pass | pass | feature実行、各候補のfile:line実在をgrepで再現確認 |
| AC-03 | SCN-UNIT-DC-003 | `DECISION_CANDIDATES`（除外7件） | pass | pass | feature実行、除外理由が全件非空 |
| AC-04 | SCN-UNIT-DC-004 | `DecisionJournalField`＋4 schema fieldのdiff | pass | pass | feature実行。DISC-001対応後に衝突0件を確認 |
| AC-05 | SCN-UNIT-DC-005 | `callableTarget`のunion型＋TypeScript Compiler APIによる陰性test | pass | pass | feature実行。fail-open literal代入がTS2322 compile errorになることを確認 |

### 2.2 開発考慮事項の適用判定（必須）

00の判定・理由・証拠から差分が無ければ、表の代わりに`開発考慮事項の適用判定は00_要求定義.md §6.1と同じ`の1行を置ける（01〜03と同じ参照行）。差分がある行だけを表に残してよい。**`review validate`はこの§2.2の内容を検証しない**（01〜03の`issue validate`と異なり、review artifactのDC判定に対する機械検証は無い）。記述量を減らすための人・エージェント向けの案内であり、参照行を置いても4行の表を書いても合否は変わらない。

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | policy、credential、GitHub証拠を扱うCLIでありPrivacy/Security by Designを常に適用する | `DecisionCallableTarget`がfail-open値を型として持たずINV-01を実装で強制（SCN-UNIT-DC-005で実測）。secret/credential fieldなし |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 診断、journal、review証拠を運用判断へ使用する | `DecisionJournalField`はPII非対象のvalue/confidence/callableTargetラベルのみ。既存4 schemaとのfield名非衝突をSCN-UNIT-DC-004で実測確認 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 現行製品はNode CLIでありGUI/Web UIを提供しない。本Issueは新規CLI subcommandも追加しない | package.jsonのbinとCLI contract。`git diff`で`src/cli.ts`・`src/cli-usage.ts`のDecision Contract関連差分が無いことを確認 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 現行製品は画面レイアウトと視覚コンポーネントを所有しない | projectKind=cli、UI sourceなし |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | C-01〜C-04（Issue #1483）に対応するAC-01〜05が全てfeature実行で実測合格（§2.1） |
| 価値（利用者・運用上の目的） | pass | v0.4.2実装者が候補一覧（5採用・7除外、file:line付き）をそのまま実装対象の起点として使える。Semantic Graphと同型の「実装されているが誰も呼ばない」再発を防ぐ目的を充足 |
| 実現可能性（環境・依存・権限） | pass | 新規外部依存なし（`typescript`は既存devDependency）。`npm run typecheck`・`npm run lint`・`npm test`全て既存CIコマンドで検証可能 |
| 整合性（設計・コード・テスト・仕様） | pass | 02設計・03実装計画の記述とsrc実装が一致（discriminated union、4 schema対象、decidedAt/decisionRecordIdの改名、REQ-WF-029改名を含め同期済み） |
| 保守性（責務・命名・変更容易性） | pass | 新規file1つに閉じ既存`src/domain/`への変更なし。型名・field名は英語、JSDocで日本語説明を付与し既存style（`ci-delivery.ts`等）と一致 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | `DecisionCandidateEntry`はTypeScript discriminated unionで"adopted"にcallerFile/callerLine、"excluded"にexclusionReasonを型として強制し、両方欠けた候補を作成不能。SCN-UNIT-DC-005は実際にfail-open literal代入を試み、型システムが拒否することを実測（自己申告ではなくcompile診断を検証） |
| 失敗経路（外部失敗・部分失敗） | pass | 外部プロセス・ネットワーク呼び出しを持たないため部分失敗が構造的に発生しない。schema読み込み失敗時は`fs.readFileSync`が例外を投げ、testがfailする（silent failureにならない） |
| 境界値（空、最大、最小、重複、Unicode） | pass | 採用候補5件ちょうど（最低値）でAC-02が満たされることを確認。file:line形式は正規表現`FILE_LINE_PATTERN`で範囲表記（"39-45"等）も許容 |
| 悪用（注入、経路脱出、権限外） | not-applicable | 外部入力・ユーザー入力を受理しない静的data・型定義のため注入・経路脱出の攻撃面が無い |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | secret/credential fieldを持たない設計（DC-PRIVACY）。候補file:lineは実行時に自分でgrep・読み込みして実在確認済み（P-07 Zero Trust） |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | main追随のmerge衝突解消で両ブランチの追記を両方残したことを`node --import tsx scripts/check_file_audit.ts`のmerge-integrity検査（損失検知token）で機械確認した（Issue #1482側のREQ-WF-026/027・TERM-ASC-131〜133が失われていないことを実測）。round 2のreview artifact自体は整理commitで意図的に除去したが、内容は本artifactへ全面的に引き継いでいる（削除ではなく置き直し） |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | 新規file4つ・追記6fileのみで`git revert`/`git rm`により即時ロールバック可能（§1.1個別監査）。main追随のmerge commit・整理commit自体もrevert可能 |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | C-02/C-03の呼び出し元名指しがこのIssueの中心目的であり全12候補で実施済み。配布物影響は§8で確認、文書はTERM-DC-001・変更履歴・追跡表・要件一覧・ワークフロー要件・全体構成の6fileへ反映済み。REQ-WF-026→029改名も6file全件で漏れなく実施（`grep`で残存0件を確認）。main追随によるsrc/cli.ts行shiftもH-06として検出・是正済み |

## 5. 指摘

指摘元は独立reviewer（round 1: Codex、`codex exec -s read-only`。round 2: CodeRabbit、PR #1490自動review）、および進行役自身のself-audit（round 3、H-06）。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| H-01 | High | `SCN-UNIT-DC-002`（および`SCN-UNIT-DC-003`）がfile:line形式とfile存在しか検査せず、claimした行番号の内容が実際にその主張と一致するかを検査していなかった。DCAND-006のlabelが「finding severityの分類そのもの」としていたが、SKILL.md:14の原文は severity分類を名指しした記述ではなく検証記録の記入項目一般（分類と理由の記入）についての記述だった | `test/steps/decision-contract.steps.ts:112-159`（是正前）、`.agent-skill-chain/skills/step-10-review/SKILL.md:14` | `DECISION_CANDIDATES`全12件のfile:line主張の信頼性、C-02/C-03の充足根拠 | `anchorPresent`関数を追加し、各候補へ`decisionSiteAnchor`（採用候補は`callerAnchor`も）を必須fieldとして追加。行近傍の実文字列一致をSCN-UNIT-DC-002/003の両方で機械検証するようにした。検証を追加した結果、DCAND-009・DCAND-011のanchor文字列が実際の原文と一致していなかったことを追加で発見し修正した（本指摘の是正作業そのものが新たな不一致を検出した）。DCAND-006のlabelと除外理由も、SKILL.md:14が実際に説明する内容（進行役による検証記録の記入項目）へ即した記述へ訂正した | resolved | 残存なし。今後`DECISION_CANDIDATES`へ候補を追加する際は`decisionSiteAnchor`が無いとtypecheckが通らないため、同種の不一致は構造的に混入しにくい |
| H-02 | High | DCAND-012の除外理由「production codeに呼び出し元が無い」に対し、`pathIsSensitive`/`contentIsSensitive`が`validatePackageManifest`（同fileのenforcement.ts）から呼ばれている点が未考慮ではないかとの指摘 | `src/domain/enforcement.ts:1546-1549`（`validatePackageManifest`内の呼び出し） | DCAND-012の除外根拠（BR-01）の正確性 | 進行役が`grep -rn "classifyPackageAssets\|validatePackageManifest" src scripts bin`を実施し、両関数とも`src/cli.ts`・`scripts/check_package_contents.ts`を含むproduction経路から一切呼ばれていないことを実測で再確認した（該当するのは`test/steps/risk-policy.steps.ts`のtestだけ）。指摘が示す呼び出しは`validatePackageManifest`という同じく未使用の関数の内部実装同士の呼び出しであり、「判断結果を消費する呼び出し元」（BR-01が問う対象）には当たらない。ただし指摘を機に、除外理由を`classifyPackageAssets`単体の言及から`classifyPackageAssets`と`validatePackageManifest`の両方を明示し、`pathIsSensitive`/`contentIsSensitive`が後者の内部から呼ばれるが後者自体が到達不能である旨を明記する形へ精度を上げた | false-positive（reviewerの指摘した呼び出し関係自体は事実だが、BR-01が問う「判断結果を消費する呼び出し元」には該当しないため除外の結論は変わらない。exclusionReasonの記述精度は是正した） | 残存なし。除外理由の記述精度向上により同種の誤解を防止 |
| H-03 | Medium | CodeRabbit inline comment（`docs/specs/02_要件/01_ワークフロー要件.md:388`）: DISC-001での`decisionId`→`decisionRecordId`改名が1箇所だけ追随していなかった | GitHub review comment id `4103345636` | AC-04の記述整合性 | 進行役が実コード・実文書と照合し有効と判断。当該行を`decisionRecordId`へ修正（commit `da6fcd96`） | resolved | 残存なし |
| H-04 | Medium | CodeRabbit inline comment（`src/domain/decision-contract.ts:53`）: `AdoptedDecisionCandidateEntry`が基底型の`direction: "fail-closed"｜"fail-open"`をそのまま継承し、REQ-WF-029（採用候補はfail-closed限定）を型として強制できていなかった | GitHub review comment id `4103345646` | INV-01、C-03のfail-open除外原則の型的強制力 | 進行役が実コードで検証し有効と判断。`AdoptedDecisionCandidateEntry`へ`readonly direction: "fail-closed"`を追加（commit `da6fcd96`）。既存5採用候補は全件fail-closedのためdata変更不要、`npm run typecheck`合格を確認 | resolved | 残存なし。今後fail-openの採用候補を追加しようとしてもtypecheckが拒否する |
| H-05 | Low | CodeRabbit nitpick（review id `5316234453`）: SCN-UNIT-DC-005のThenステップが診断メッセージの正規表現一致だけで、対象がcallableTarget/DecisionCallableTarget/該当literalかを見ておらず、無関係なcompile errorでもscenarioが誤って成功しうる | `test/steps/decision-contract.steps.ts:269-331`（是正前） | AC-05の検証の実効性 | 進行役がtsc診断を手元で再現し有効と判断。診断`code=2322`へ限定し、メッセージが対象literalと`DecisionCallableTarget`の両方を含むことを検証するよう強化（commit `da6fcd96`） | resolved | 残存なし |
| H-06 | Medium | main追随（Issue #1482/PR #1492）のmergeでsrc/cli.tsへ行が追加され、DCAND-002のcallerLine「1726」とDCAND-003のcallerLine「7066」が実際のinspectCiDelivery呼び出し・validateSpecs呼び出し行と一致しなくなった | merge直後`npm test`全件再実行でSCN-UNIT-DC-002のanchorPresent検証が失敗（AssertionError: DCAND-002のcallerAnchorがsrc/cli.ts:1726近傍に見つかりません） | AC-02/AC-03の呼び出し元citation精度 | `grep -n "inspectCiDelivery(" src/cli.ts`・`grep -n "validateSpecs(root" src/cli.ts`で実測した新しい行番号（1738、7139）へ、REQ-WF-026→029改名・review artifact除去と同じcommit`f8053815`で修正。SCN-UNIT-DC-001〜005再実行5/5 pass、`npm test`全件2352 scenarios中2335 passed・17 skipped・0 failedを確認 | resolved（source=audit、round 3で発見・同commitで解消） | 残存なし。H-01が追加した`anchorPresent`機構が意図どおりこの破損を検出した事例であり、main追随のたびにcli.ts等の行番号citationが無言で陳腐化しない設計であることを裏付けた |

Low（Codex round 1指摘、記録のみ）:
- Low: `DecisionCandidateEntry.id`が`DCAND-###`形式であることをJSDocコメントで案内しているが型（string）としては強制していない。対象外: 型でformatまで強制すると``readonly id: `DCAND-${number}` ``のようなtemplate literal型が必要になり、3桁ゼロ埋め表現（例: `001`）をTypeScriptのnumber型で自然に表現できず可読性が下がる。`DECISION_CANDIDATES`が12件と少数であり目視確認で足りると判断し対象外とした

CI失敗（`日本語文書・Gherkin・型・配布物の品質検証`、round 2で発見）: `docs/reviews/1483_課題1483DecisionContract定義レビュー.md`の見出し「review session」が`check_japanese_docs.ts`の日本語文字数判定に抵触した。「レビューセッション」「セッションID」へ訳語化して解消。findingとしては計上せず、CI設定検証の直接対応として記録する。

Markdown表記（CodeRabbit review id `5318667595`、H_final `f4718330`確定後にPR #1490で発見）: 本節の「Low（Codex round 1指摘、記録のみ）」段落内、`DecisionCandidateEntry.id`のtemplate literal型例（`` `readonly id: \`DCAND-${number}\`` ``）が単一バッククォートの code span 内でバッククォートをエスケープしようとしており、Markdown上は正しく描画されない。進行役が実際の行内容で再現・有効と判断し、二重バッククォート区切りへ修正（forward commit、H_implは移動しない。`evidenceOnlySuffix`が許す初回artifact＋前進是正の範囲内）。findingとしては計上せず、review artifact自身の表記是正として記録する。

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい（§3肯定的評価5観点、§4敵対的評価8観点を全てpass/not-applicableで判定）
- 指摘を確定した: はい（H-01、H-02。Critical 0件）
- 次ラウンド対象のCritical/High: 無し。H-01は`anchorPresent`機構の追加で是正・実測合格。H-02は実測の結果false-positiveと判定し是正不要（ただし記述精度は向上）

### ラウンド2

pr-bound後にPR #1490のCI失敗とCodeRabbit reviewの指摘を取り込んだ取り直しラウンド（`workflow record --step=10 --post-pr-intake`で記録）。

- 未解決Critical/High: 無し（Critical/High自体が今回0件。H-03〜H-05はMedium/Lowでいずれもresolved）
- 修正差分と、触れた隣接範囲: `docs/specs/02_要件/01_ワークフロー要件.md`（1行）、`src/domain/decision-contract.ts`（`AdoptedDecisionCandidateEntry`へ1 field追加）、`test/steps/decision-contract.steps.ts`（SCN-UNIT-DC-005のThenステップ強化）。いずれも指摘対象そのものであり隣接範囲への波及なし（`npm test`全件0 failedで確認）
- 既承認・未変更範囲を再走査していない: はい。round 1で承認済みの`DECISION_CANDIDATES`データ・§1〜§4の評価・§7〜§10は再走査せず、`focus.fixedDiff`の4 fileだけを対象にした

### ラウンド3

main追随（Issue #1482のmain先行merge取り込み）とREQ-WF-026→029改名、main追随由来のcitation行shift是正（H-06）を伴う取り直しラウンド。`review round --init/--apply`（round 3、`roundDigest=c927b2800323e553b576c4b527cd8987b2bd83761c1b6cccc6eb5c04a9c74524`）で記録し、`workflow record --step=10 --post-pr-intake`で再記録する。

- 全指摘の最終分類: H-06（Medium）を新規に確定・即時resolved。H-01〜H-05は変更なし（全件resolved/false-positive）。新規指摘は他に無い（DISC-002は指摘ではなく実装中発見として§2.0に記録）
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 該当なし（round 3はmerge衝突解消・機械的改名・citation行番号の実測修正のみで、安全境界・authority・不可逆操作に触れない）
- 同じ範囲の予算を自動更新していない: はい。`review round`のround数として3を記録した（同一sessionの通算round数。上限6のうち3消費、取り直し予算2のうち1消費）

## 7. テスト結果

- 実行したcommandの一覧: `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run source:check`、`node --import tsx scripts/check_trace.ts`、`node --import tsx scripts/check_dependency_graph.ts`、`node --import tsx scripts/check_project_quality.ts`、`node --import tsx scripts/check_workflow_steps.ts`、`node --import tsx scripts/check_skill_templates.ts`、`node --import tsx scripts/check_directory_guides.ts`、`node --import tsx scripts/check_cli_contract.ts`、`node --import tsx scripts/check_package_contents.ts`、`node --import tsx scripts/check_file_audit.ts`、`npm test`
- 全layerの合計: round 1・round 2で`npm test`（unit/integration/e2e全layer） 2329 scenarios中2312 passed・17 skipped・0 failed、21544 steps中21489 passed・55 skipped・0 failedを2回連続で再現。個別filter実行`--name "SCN-UNIT-DC-00[1-5]"`でも5/5 pass
- runner・Gherkin方言: Node.js + `@cucumber/cucumber`、`gherkinDialect=en`（project choice `development.json`と一致）
- round 3の再検証: main追随merge`bb4392c5`直後に`npm test`全件を実行し、main追随由来のsrc/cli.ts行shiftによりSCN-UNIT-DC-002が1件失敗（H-06として記録）。REQ-WF-026→029改名・review artifact除去と同じcommit`f8053815`（H_impl）で是正し、`SCN-UNIT-DC-00[1-5]`個別filterで5/5 pass。`npm ci --ignore-scripts && npm run build`を再実行しdist差分0件を確認。`npm test`全件を再実行し**2352 scenarios中2335 passed・17 skipped・0 failed、21769 steps中21714 passed・55 skipped・0 failed**（0 failedを確認）。`npm run typecheck`・`npm run lint`・`npm run format:check`・trace/dependency-graph/source-quality/project-quality系gateも再実行し全合格。`node --import tsx scripts/check_file_audit.ts`のmerge-integrity検査（損失検知token）で、merge commit`bb4392c5`が両親の安定ID（REQ-WF-026/027等）を保持していることを確認

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| dist/src/ | 入る | `dist/src/domain/decision-contract.js`が新規追加される。package publicエントリポイント（`bin`のみ宣言、`exports`/`main`/`types`なし）からexportされないため、配布はされるが公開契約としては提供しない |
| docs/specs/01_システム概要/02_用語・略語.md | 入らない | なし（`package.json`の`files`は`docs/`を含まない） |
| docs/specs/02_要件/00_要件一覧.md | 入らない | なし |
| docs/specs/02_要件/01_ワークフロー要件.md | 入らない | なし |
| docs/specs/03_アーキテクチャ/00_全体構成.md | 入らない | なし |
| docs/specs/15_要件追跡/00_追跡表.md | 入らない | なし |
| docs/specs/15_要件追跡/01_変更履歴.md | 入らない | なし |
| src/domain/decision-contract.ts | 入る | `package.json`の`files`に`dist/src/`はあるが`src/`自体は無い。TypeScript sourceは配布されず、対応する`dist/src/domain/decision-contract.js`（上行）が配布される |
| test/features/unit/decision-contract.feature | 入らない | `package.json`の`files`は`test/`を含まない |
| test/steps/decision-contract.steps.ts | 入らない | 同上 |

判断: 配布物を更新した

根拠: `dist/src/domain/decision-contract.js`が新規追加され配布物へ含まれる。ただしpackage publicエントリポイント（`exports`/`main`/`types`未宣言）からexportされないため、既存consumerの`import`解決や公開契約に対する外部観測可能な振る舞いの変更は無い（deep import経路の到達可能性は既存`src/domain/`全fileと同一で変化しない、01 §6.1参照）

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい（project policyに`merge.reviewIndependence`未宣言のため既定値`context-isolated`を適用） |
| reviewerとimplementerのidentity・context比較 | implementer: Claude（Sonnet 5、本worktree内の対話session、product code編集）。round 1 reviewer: Codex（`codex exec -s read-only`、別process・別provider・別contextで起動、product code非変更）。round 2 reviewer: CodeRabbit（GitHub App、PR #1490上で自動実行される別process・別provider・別context、product code非変更）。round 3はowner（coordinator）の明示指示に基づく実装作業（main追随・改名）と、それに伴うself-auditでの新規発見（H-06）であり、新規外部reviewerは介在しない |
| reviewerが対象差分を変更していないこと | はい（round 1・2のreviewerはいずれも読み取り専用または外部コメントのみでproduct codeを直接変更しない） |

外部への不可逆な配布で外部証拠を要求され、かつ無い場合だけ次を記入する。承認元・承認者・承認日時・失効日時は正本を参照し複製しない。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | {正本fileのexceptionId} |
| 観測値 | {未実行と判定した根拠の実測値} |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/01_システム概要/02_用語・略語.md`（TERM-DC-001追加）、`docs/specs/02_要件/00_要件一覧.md`（REQ-WF-029追加）、`docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-029節・AC-WF-029追加）、`docs/specs/03_アーキテクチャ/00_全体構成.md`（Decision Contractコンテキスト追加）、`docs/specs/15_要件追跡/00_追跡表.md`（追跡行追加）、`docs/specs/15_要件追跡/01_変更履歴.md`（変更履歴行追加）
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: はい。00の候補（TERM-DC-001、candidate）→01で確定（TERM-DC-001、active、Issue #1483根拠）→`02_用語・略語.md`で現在有効な定義として追加
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。TERM-DC-001は新規追加のみで既存語の変更・廃止を伴わない。main追随後もIssue #1482のTERM-ASC-131〜133との重複・矛盾なし
- 要件・変更・SCN・テストの追跡: REQ-WF-029 → AC-WF-029 → SCN-UNIT-DC-001〜005 → `test/features/unit/decision-contract.feature`/`test/steps/decision-contract.steps.ts` → `src/domain/decision-contract.ts`の一方向traceを`docs/specs/15_要件追跡/00_追跡表.md`へ記録し、`trace:check`が合格（孤立SCN・孤立実装0件）
- `no-spec-impact`の場合の限定的根拠: 該当なし（updatedのため）
- UI・トークンの判断: 対象外（DC-UX/DC-TOKENSがnot-applicable、§2.2参照）

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- 解決済みの指摘: H-01〜H-06（全件resolvedまたはfalse-positive）。詳細は§5参照
- Medium/Lowの記録: 記録済み（§5）。対応不要と判断したものは理由を記録済み
- 判定: approved
- 新しい権限が必要な事項: 無し
- 残存リスク: 無し。`DECISION_CANDIDATES`拡張時は`decisionSiteAnchor`/`callerAnchor`が型として必須のため、将来の候補追加でも同種の不一致は機械検証される
- 次に許可される操作: review artifactを`docs/reviews/`へ確定commit（H_final）し、push・CI確認・PR reviewスレッド解決を行う。mergeは別セッションの権限確認後
- 次回の再開地点: 本staging、branch `feature/1483-decision-contract`

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 3 |
| 対象SHA・文書ダイジェスト | f8053815a2bba5fd3fe9cd257a084311b113ac06 |
| 比較基点 | `824b83710909bf81d2eb988606e0e43b46b76545` |
| H_impl | `f8053815a2bba5fd3fe9cd257a084311b113ac06` |
| 対象差分 | dist/src/domain/decision-contract.js、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/00_要件一覧.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/03_アーキテクチャ/00_全体構成.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/domain/decision-contract.ts、test/features/unit/decision-contract.feature、test/steps/decision-contract.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | 通算8ラウンドのうち3消費（当初予算6のうち2＝round1・2、取り直し予算2のうち1＝round3）。取り直し予算の残り1、収束済み |
| ラウンド数 | 3（`review round --apply`で記録済み、`status=converged`。round 3はmain追随・REQ-WF-026→029改名・citation行shift是正の取り直し） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260925_170425_v0.4.1-Decision-Contract定義-呼び出し元の名指し |
| レビューセッション | セッションID `d0fc134ae90c871fa20335542a2d92092a862567897cd895c46d32257278c09c`から継続。round 3のroundDigestは`c927b2800323e553b576c4b527cd8987b2bd83761c1b6cccc6eb5c04a9c74524` |
| 仕様の所有箇所 | 着手時点で新規概念のため`docs/specs/`に所有箇所は無し（01 §0管理情報、00_要求定義.md §0参照）。実装成立後の本Issueで`docs/specs/03_アーキテクチャ/00_全体構成.md`（境界づけられたコンテキスト一覧）が新たに所有する |
| 成果物行数 | 製品: `src/domain/decision-contract.ts` 236行、`docs/specs`6file追記 計約65行（round 3のREQ-WF-029改名差分含む）。支援層: `test/features/unit/decision-contract.feature` 27行、`test/steps/decision-contract.steps.ts` 291行、本review artifact。判断のある箇所だけを記述し閾値判定はしない |
| 縮小の先行評価 | 00 §3問3と同じ（`memo`計画時点の評価）。main追随はrebaseでなくmergeで行い（`asc-follow-main-by-merge-not-rebase`）、新規機構を追加せず既存の`review artifact --init`・`review round`機構をそのまま再利用した |
| 実施者・日時 | implementer: Claude（Sonnet 5、本worktree session）2026-09-25。round 1 reviewer: Codex（`codex exec`、別context）2026-09-25。round 2 reviewer: CodeRabbit（GitHub App）2026-09-25。round 3: owner指示に基づきimplementer自身がmain追随・改名を実施し、`npm test`全件再実行によるself-auditでH-06を検出・即時是正、進行役（Claude、本session）が採否を確認・記録 |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer（round 1） | 肯定・敵対review（§3・§4）、finding分類（§5） | advanced（risk=low、scope=1 file、Codex推論レベルはprovider既定=high、上限内） | codex（Codex Sol基本候補。ローカルLLM設定なしのため既定候補を使用） | provider既定modelをそのまま使用（`--model`で固定しない、asc-codex-model-must-be-provider-default） | Codex利用不能ならOpus等別reviewerへ切替え理由をjournal evidenceへ記録する（今回は到達可能につき未発動） | implementer(Claude、本worktree session、product code編集)とreviewer(Codex、別process起動、`-s read-only`でproduct code非変更)のidentity・provider・context分離を確認。review後`git status`で対象差分不変を確認 |
| reviewer（round 2） | PR差分に対するfinding分類（§5 H-03〜H-05） | advanced相当（PR上のCI/自動reviewのfixed pipeline） | CodeRabbit（GitHub App、PR #1490で自動起動） | CodeRabbit既定設定（ASC側でmodel選択を制御しない） | CodeRabbitが利用枠制限中の場合はOpus/Codex Solへ委譲する規定だが、今回は正常完走（rate limitなし）につき未発動 | implementer(Claude)とreviewer(CodeRabbit、GitHub App、別process・別provider)のidentity分離を確認。GitHub App はPRのcommit権限を持たずcomment投稿のみのためproduct code非変更。進行役が3件の指摘を実コード照合で採否確認 |
| implementer（round 3） | main追随のmerge・衝突解消・REQ-WF-029改名・citation行shift是正（H-06）（§1.1、§2.0 DISC-002、§5） | advanced（risk=low、common-ledger conflict、owner明示指示に基づく機械的改名） | claude（本worktree session、Sonnet 5） | project_default | 到達不能なら停止し人間へ再開条件を報告する（未発動、到達可能） | round 3はowner指示の直接実行でありreviewer roleを新設しない。指示内容・実施内容・実測結果（H-06含む）を§2.0/§5/§6/§7で記録し追跡可能にする |
