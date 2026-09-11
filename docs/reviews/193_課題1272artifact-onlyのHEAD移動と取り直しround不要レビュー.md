# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1272 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `492197d4a68e061bcc49624829748d2aa6658e18` |
| H_impl | `0fb9c70fb6450b5cb0c406207ef3630c6c99a8b5` |
| 比較基点の由来 | PR #1328のmerge commitである`origin/main`のtip。是正commitの後にこれをbranchへmergeして追随した（merge commitが`H_impl`であり、artifact commitより前にある） |
| Step 10のreview session ID | `7f8fc3592ec8dc4f235a318a8a0da498faef092322241abdd749fb85eb8ba5bd` |
| モード | full |
| 対象差分 | `src/adapters/review-session.ts`、`src/cli.ts`、`src/domain/review.ts`、`dist/src/`の生成物、`test/features/unit/evidence-only-head.feature`、`test/steps/evidence-only-head.steps.ts`、規範文書01・02、step-10 skill、`docs/specs/`4件 |
| 対象外 | 製品差分を含むHEAD移動の受理、2 path以上・複数commitの受理、bindingへH_finalを書くこと、本repoの`audit:check`が`.agent-skill-chain/reviews/`を受理しない件（REV-M-01、repo固有の制約） |
| 残り予算 | 1（同一範囲で最大3ラウンド。ラウンド1で独立reviewerのHigh 2件・Medium 2件、ラウンド2で是正差分を再reviewして収束。**本artifactのcommitに取り直しroundは要らない**。本変更そのものが、artifact 1 fileを加えたH_finalをcandidate HEADと同一視するためで、Step 10は本変更のbuildを使ってH_finalで記録する。収束後の取り直し1ラウンドの別枠は未使用） |
| ラウンド数 | 2 |
| Step chain | 経由: /home/tatsuru/Projects/techbeansjp-free/AGENTS.md/.worktrees/20260911_110531-1272-evidence-only-head-binding/.agent-skill-chain/tmp/issues/20260911_112204_artifact-onlyのHEAD移動に取り直しroundを要求せずStep-10とPRを結び付ける |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md` REQ-WF-005「収束後にHEADが変われば同sessionの次roundで実Gitの修正差分だけを再reviewし、新しいStep 10 bindingが無いPR作成を拒否する」。artifact 1 fileだけのHEAD移動の扱いは規定されておらず、本PRで同節へ「evidence-only suffix」を追記した |
| 成果物行数 | 製品 +95 / −2行（`review-session.ts`の述語と合成が約70行、`cli.ts`の合成が約15行、`review.ts`のexportが約8行）。test +448行（feature 11 scenario、steps）。規範文書・skill・仕様 +8 / −3行。支援層（staging 00〜03と本artifact）は約800行 |
| 縮小の先行評価 | 2案を先に評価した。(1) bindingへH_finalを書く案は`audit:check`の`H_impl`と食い違い再固定chainの意味も変わるため不採用。(2) 2 path以上・複数commitを受理する案はartifact 1 fileの既存契約に反し、複数commitではmerge認可が`H_final^`を実装commitと誤認する（ラウンド1 REV-H-02）ため不採用。採用した述語は1関数で、2箇所の既存assertが合成する |
| 実施者・日時 | reviewer（codex、別process）とcoordinator（Claude Code）、2026-09-11 |

### 0.1 routing入力契約

providerとmodel設定はproject choiceとrouting evidenceの観測値を用い、固有のmodel slugだけからreview authorityを推測しない。

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | advanced | codex（`codex exec --sandbox read-only`） | provider既定 | Critical/High未解決なら停止 | implementer（Claude Code session）とreviewer（codex別process、read-only sandbox）は別context。reviewerの変更path集合は空 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1272 、AC-01〜AC-03、INV-01〜INV-04、owner決裁コメント（2026-09-11） | Step 4で00・01を、Step 8で00〜03を同期し`sync-verified`。01〜03の開発考慮事項欄は参照行（#1327の機構）を自己適用 | 耐久トラッカー |
| 差分 | `492197d4..0fb9c70f` | 15 file（`dist/`3件を含む）。製品差分は`src/`3 file、+95 / −2行 | 既存コード |
| テスト | `npm test`、`npm run conformance:check` | 7節 | テスト出力 |
| 仕様 | `docs/specs/`4 file | updated | 既存文書 |
| commit前candidate | 15 file（個別監査12行と`dist/`生成物3件） | working tree clean | Git index |
| Phase A artifact | `docs/reviews/193_課題1272artifact-onlyのHEAD移動と取り直しround不要レビュー.md` | `H_impl` = `0fb9c70f`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: 成立する。`cli → review-session → review`の一方向で`architecture:check`合格。bindingはcandidate HEADのままでartifact自身のSHAを書かない（INV-04）
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl` = `0fb9c70f`は`H_final`の唯一の親であり、差分pathは本artifact 1件（evidence-only suffix）
- reviewerの独立性が`merge.reviewIndependence`の要求水準を満たす: 満たす。既定`context-isolated`で、reviewerはcodexの別process
- 既定branch追随を行った場合: 行った。`origin/main`のtip `492197d4`（PR #1328のmerge）を是正commitの後、本artifact commitの前にmergeした。`比較基点`はその取り込んだtipで、`H_impl`はmerge commit（artifact直前の最新commit）である。個別監査表は`比較基点..H_impl`から再生成した

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/adapters/review-session.ts` | M | package | package | `evidenceOnlySuffix`（唯一の親・`--raw --no-renames`・mode 100644・allowlist）と`assertConvergedReviewSession`への合成 | domain/review（allowlist）への依存を追加。循環なし | REQ-WF-005、AC-01・AC-02、SCN-UNIT-EVIDHEAD-001〜011 | 読み取りのみ。差し戻しで復旧 | pass |
| `src/cli.ts` | M | package | package | `assertCurrentReviewJournalBinding`への合成（pr create・pr mergeの3呼び出しが共有） | cli → adapters | AC-01、SCN-UNIT-EVIDHEAD-001 | 同上 | pass |
| `src/domain/review.ts` | M | package | package | `isEvidenceOnlyPath`のexport。allowlistを複製しない | なし | INV-01 | なし | pass |
| `test/features/unit/evidence-only-head.feature` | A | package | package | 新規Feature 1 file 11 scenario | steps 1 fileへ | AC-01〜AC-03 | fixtureは一時repository | pass |
| `test/steps/evidence-only-head.steps.ts` | A | package | package | 実git repositoryとstagingでsession・binding・CLI記録を検証。非ancestorはcherry-pick＋amendで別commitにする（SCN-UNIT-EVIDHEAD-006） | src/cli、src/adapters | 同上 | 同上 | pass |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package | package | 「artifact 1 fileだけを加えるHEAD移動には取り直しroundを要求しない」の段落 | なし | FR-05、AC-03 | `workflow:check`合格 | pass |
| `.agent-skill-chain/docs/02_品質基準.md` | M | package | package | bindingを「sessionのcandidate HEAD」へ改め、current HEADの許容形を明記（REV-M-02） | なし | AC-03 | 合格 | pass |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | M | package | package | 取り直し不要と記録手順の1文 | なし | FR-05、AC-03 | `skills:check`合格 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | spec | spec | TERM-ASC-101を追加（main mergeでTERM-ASC-100と整列） | なし | TERM-ASC-101 | なし | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | spec | REQ-WF-005へevidence-only suffixの段落 | なし | REQ-WF-005 | なし | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | spec | REQ-WF-005のunit行を1行追加 | なし | SCN 11件 | なし | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | spec | header直後へ1行 | なし | 同上 | なし | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: 一致する（`git diff --name-only 492197d4 0fb9c70f`の15件のうち`dist/`の生成物3件を除く12件と上表12行。生成物は8節で`dist/`1件として扱う）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: していない。allowlistは製品の固定値で、project policyから緩和できない
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: ラウンド2は`review-session.ts`・test 2 file・規範文書02・`docs/specs/`3 fileだけを再監査した

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | 非ancestor fixtureを「別branchでartifactをcommit」だけで作ると差分が2 pathになりancestor検査を外す変異M6が隠れて生存。さらにcherry-pickは同一秒内で元commitと同じSHAになりancestorに化ける（全体実行で1回flake） | NFR-01 | なし | cherry-pick＋amendで「treeは同一だが非ancestor」を作る（SCN-UNIT-EVIDHEAD-006） | M6 kill、EVIDHEAD 3回連続合格 | なし | pass |
| DISC-002 | ラウンド1の独立reviewでHigh 2件・Medium 2件（5節） | INV-01、規範文書の整合 | なし | 述語を狭め、02を是正、SCN 4件追加 | 変異M8〜M10 kill | REQ-WF-005 | pass |
| DISC-003 | ラウンド1の入力で`contractId`を未設定にしたためHigh 2件がrecord-onlyとして認められ、sessionがround 1で収束した。是正はround 2（収束後の追加review）として記録した | review sessionのblocking履歴 | なし | 事実を記録。`--init`のnotesへcontractIdの案内を足す件を#1331へ追記 | なし | なし | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-EVIDHEAD-001、002 | `evidenceOnlySuffix`、`assertConvergedReviewSession`、`assertCurrentReviewJournalBinding` | 2/2合格 | pass | 7節。本Issue自身のStep 10を、本artifactをcommitしたH_finalで取り直しround無しに記録する（自己適用） |
| AC-02 | SCN-UNIT-EVIDHEAD-003〜006、008〜011 | 同上 | 8/8合格 | pass | 7節 |
| AC-03 | SCN-UNIT-EVIDHEAD-007 | 規範文書01・02、step-10 skill | 1/1合格 | pass | 7節 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | delivery認可の緩和を「唯一の親がcandidate HEADの1 commit、allowlist配下の通常file 1件」に限定し、rename・mode・merge・複数commitを拒否する | INV-01・INV-02、SCN-UNIT-EVIDHEAD-003〜006・008〜011、変異M1〜M10 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否文言は変更前と同一。受理時に追加出力を出さない | INV-02 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | GUI・画面契約とa11y検証の対象を持たない（helpと診断文言はCLI契約としてREQ-WF-009が扱う） | project choiceのcapability選択 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 画面・themeを持たない | project choiceのcapability選択 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | 11 SCN合格。本Issueが自身のStep 10をH_finalで取り直しround無しに記録できることを本artifactのcommit後に観測する |
| 価値 | 利用者・運用上の目的を満たすか | pass | #1324・#1323で毎回消費していたartifact取り直しroundが不要になり、収束後の別枠がPR作成後の外部指摘に残る |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存追加なし。保護fileに触れない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 02 §2.2の部品3点が実装と一致。規範文書01・02とREQ-WF-005を同じ語で更新した |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 述語1関数を2箇所が合成し、判定を複製しない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | finding（REV-H-01、resolved） | `--name-only`はrename先だけを出すため`git mv src/a.ts docs/reviews/x.md`が1 pathに見えた。`--raw --no-renames`と到達後mode 100644で拒否しSCN-UNIT-EVIDHEAD-008・010で固定 |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | git観測の失敗はundefinedにし、呼び出し側が従来文言で拒否する |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 空差分（005）、1 commit対2 commit（001対009）、通常file対実行権限（001対010） |
| 悪用 | 注入、経路脱出、権限外操作等 | finding（REV-H-02、resolved） | artifact-only commitを2本積むとmerge認可が`H_final^`のauthorを実装者と誤認しうる。唯一の親がcandidate HEADの1 commitに限定しSCN-UNIT-EVIDHEAD-009・011で固定 |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | allowlistは製品固定値で`..`と制御文字を拒否する既存述語を再利用 |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 削除（dst mode 000000）は拒否。書き込みを行わない |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 述語の差し戻しで旧挙動へ戻る（変異M2・M3で確認） |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | finding（REV-M-01 record-only、REV-M-02 resolved） | 本repoの`audit:check`は`docs/reviews/`固定で製品allowlistより狭い（repo固有、変更しない）。規範文書02の「exact current HEADをbinding」を是正 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-H-01 | High | `--name-only`だけを数えるため、renameで製品fileをartifact pathへ移した差分が1 pathとして受理される | reviewerが`git mv`で再現 | INV-01 | `--raw --no-renames`、到達後mode 100644。SCN-UNIT-EVIDHEAD-008・010 | resolved / invariant-violation | なし |
| REV-H-02 | High | 任意距離のH_finalを受理するため、artifact commit 2本ではmerge認可が`H_final^`のauthorを実装者と誤認する | reviewerがH_impl(Alice)→A1(Bob)→A2(Bob)の反例を提示 | INV-04、REQ-WF-005 | 唯一の親がcandidate HEADの1 commitに限定。SCN-UNIT-EVIDHEAD-009・011 | resolved / invariant-violation | なし |
| REV-M-01 | Medium | 製品allowlistの`.agent-skill-chain/reviews/`を本repoの`audit:check`は受理しない | `scripts/check_file_audit.ts`の`AUDIT_DIRECTORY` | 本repoの運用 | 変更しない。製品allowlistは利用側の配置自由度であり、本repoは`docs/reviews/`だけを使う | record-only / out-of-scope | なし |
| REV-M-02 | Medium | 規範文書02が「exact current HEADをjournalへbinding」と書き、01・REQ-WF-005と矛盾 | `02_品質基準.md` §review | 規範文書の整合 | 「sessionのcandidate HEAD」へ改め、current HEADの許容形を明記 | resolved / acceptance-violation | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: 確認した。対象はcommit `aa4346fe`の全差分（`review-session.json` round 1、digest `33ff5b05`）
- 指摘を確定した: REV-H-01・REV-H-02・REV-M-01・REV-M-02。**入力の`contractId`を未設定にしたため4件はrecord-onlyとして認められ、sessionはround 1で収束した（DISC-003）。coordinatorはHigh 2件をblockingとして扱い是正した**
- 次ラウンド対象のCritical/High: REV-H-01・REV-H-02

### ラウンド2

- 未解決Critical/High: 0件
- 修正差分: `src/adapters/review-session.ts`、test 2 file、規範文書02、`docs/specs/`3 fileと、`origin/main`（#1328）のmerge（`review-session.json` round 2の`fixedDiff` 23件。追随mergeの差分を含む）
- 修正で触れた隣接範囲: `dist/`の生成物
- 既承認・未変更範囲を再走査していない: `cli.ts`・`review.ts`・規範文書01・step-10 skillはラウンド1のまま（mergeによる自動統合を除く）

### ラウンド3

- 実施していない。本artifactのcommitは本変更の規則によりcandidate HEADと同一視され、取り直しroundを要しない

## 7. テスト結果

実行runnerは`cucumber-js`（`node --import tsx`経由）、`projectChoices.gherkinDialect`は`en`、test layerはunit・integration・e2eの3層である。

- 実行したcommand: `npm test`、`npm run conformance:check`、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test:format`、`npm run docs:format`、`npm run trace:check`、`npm run workflow:check`、`npm run skills:check`、`npm run cli:check`
- 全layer合計: 1804 scenario（合格1787、skip 16、失敗1）。失敗1件はSCN-INT-GITHUB-031（待機時間の実測が600ms未満）で、本変更が触れていない`delivery-finalize`の壁時計依存scenarioであり、単独実行で3回連続合格した。本変更に由来する失敗は0件（`origin/main` merge後のH_implでの実測）
- `conformance:check`: 87 scenario（合格87）
- 静的gate 9本: すべてexit 0
- 変異試験: 10件。M1 session検査を常時受理、M2 session側の受理削除、M3 binding側の受理削除、M4 path件数を1以上へ、M5 allowlist削除、M6 ancestor検査削除、M7 rename検出を戻す、M8 親検査削除、M9 mode検査削除、M10 merge親検査削除。生存はM7のみで、`--raw`はrenameを2 pathで出すため件数検査が先に落とす等価変異（`--no-renames`は防御として残す）。M6は初回生存しfixture強化後にkill
- 自己適用: 本artifactをcommitしたH_finalで`workflow record --step=10`を取り直しround無しに実行する（結果はStep 10のevidenceに残す）

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/review-session.ts` | 入る（`package.json`の`files`が`dist/src/`を列挙する） | `workflow record --step=10`がevidence-only suffixのHEADを受理 |
| `src/cli.ts` | 入る | `pr create`・`pr merge`のbinding検査が同じHEADを受理 |
| `src/domain/review.ts` | 入る | exportの追加のみ |
| `dist/` | 入る | 上記のcompile生成物 |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | 入る | 取り直し不要の記述 |
| `.agent-skill-chain/docs/02_品質基準.md` | 入る | bindingの記述の整合 |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | 入る | 取り直し不要と記録手順 |
| `test/`、`docs/specs/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/adapters/review-session.js`と`dist/src/cli.js`の受理条件が広がり、artifact 1 fileのcommitに取り直しroundが不要になる。拒否文言・journal構造・binding値は変えていない。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（`merge.reviewIndependence`未宣言の既定） |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはClaude Code session（commit author `tatsuru`）、reviewerは`codex exec --sandbox read-only`の別process。同一GitHub actorだが別session/contextである |
| reviewerが対象差分を変更していないこと | はい（read-only sandbox。review前後で`git status`に差分なし） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `02_要件/01_ワークフロー要件.md`（REQ-WF-005）、`15_要件追跡/00_追跡表.md`、`15_要件追跡/01_変更履歴.md`、`01_システム概要/02_用語・略語.md`（TERM-ASC-101）
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 00 §4.2 TERM-001（候補）→ 01 §2.1 TERM-ASC-101（確定）→ 用語台帳 TERM-ASC-101（active）
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: ない。「evidence-only suffix」で統一
- 要件・変更・SCN・テストの追跡: REQ-WF-005 → AC-WF-005 → SCN-UNIT-EVIDHEAD-001〜011 → `evidence-only-head.feature`（`trace:check`合格）
- `no-spec-impact`の場合の限定的根拠: 該当なし
- UI・トークンの判断: UI無し

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件
- Medium/Lowの記録: REV-M-01（record-only）、REV-M-02（resolved）
- 判定: approved
- 新しい権限が必要な事項: なし
- 残存リスク: 受理する形は「candidate HEADを唯一の親とする1 commitで通常file 1件の追加または変更」に限る。artifactを2 commitで書いた場合は従来どおり取り直しroundが要る
- 次に許可される操作: `workflow record --step=10`（H_finalで）、`pr create`
- 次回の再開地点: Step 11
