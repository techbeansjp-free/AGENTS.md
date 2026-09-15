# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

**本templateを埋めた成果物は版管理下へ置く。** 一時ステージングに置いたままでは`review evidence`も履歴監査も成立しない。`docs/reviews/`または`.agent-skill-chain/reviews/`配下へ複写し、実装commitの後にその1 fileだけをcommitする。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | 0c06312698ab667ef74f91bd4f388adb7f491a65 |
| 比較基点 | `6159c46897c39ce0a185ae3468e6b0b729c1bb69` |
| H_impl | `0c06312698ab667ef74f91bd4f388adb7f491a65` |
| 対象差分 | .agent-skill-chain/docs/01_開発ワークフロー.md、.agent-skill-chain/skills/step-10-review/SKILL.md、dist/src/adapters/review-session.js、dist/src/cli.js、dist/src/domain/workflow.js、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/00_要件一覧.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/review-session.ts、src/cli.ts、src/domain/workflow.ts、test/features/integration/staging-digest-recovery-hint-cli.feature、test/features/unit/staging-digest-recovery-hint.feature、test/steps/staging-digest-recovery-hint-cli.steps.ts、test/steps/staging-digest-recovery-hint.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲。`appendWorkflowJournalEntryLocked`の受理集合、`workflow record --reconfirm`の実装、staging digestの算出式は本変更の対象外で1行も変更していない |
| 残り予算 | counted round 2、上限4のため残り2ラウンド。収束後のHEAD移動に対する取り直しは未使用 |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260915_152055_staging-digest不一致の診断が実在しない復旧手順を案内する |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-024（本変更で新設）。着手時、staging digest不一致の診断文言を所有していたのは同fileのREQ-WF-009で、その本文は「staging digestの不一致が案内する手順」を無条件に最新Stepの再記録と述べていた。**その記述自体が本Issueの欠陥だった**ため、REQ-WF-009からは所有を外してREQ-WF-024へ委譲し、同段落が自ら宣言する「同じ事実を二度書かない」を維持した |
| 成果物行数 | 製品`src/`116追加6削除、生成物`dist/`106追加6削除（`npm run build`の出力で手書きなし）、支援層`test/`445追加0削除、仕様`docs/specs/`19追加2削除、配布規範`.agent-skill-chain/`4追加0削除。支援層対製品は3.84倍。閾値判定はせず記録だけを残す |
| 縮小の先行評価 | 最小形は既存の定数`STAGING_DIGEST_RERECORD_HINT`の文字列を書き換えるだけ（1行）で、Step 10後の誤案内は消える。**これを採らなかった理由は、Step 10前には旧案内が実際に成功するため、一律置換は正しい案内を壊す点にある。** 状態に依存する以上、分岐を持つ関数が必要になる。分岐の置き場所として3 call siteへの個別実装も評価したが、文言が複製されて片方だけ実態から外れても検出できないため、判定を持たない単一関数への集約を選んだ。CLI flag・schema・delivery stateの新設、`appendWorkflowJournalEntryLocked`の受理集合変更はいずれも不要と判断し実装していない |
| 実施者・日時 | reviewer: 独立context（Claude、読み取り専用）2026-09-15。round 1でchanges-requested、round 2でapproved。coordinatorがGit・gate・変異の一次証拠を照合 |

`比較基点`と`H_impl`の2行は`review reanchor`と`audit:check`が機械的に読む。値は40桁の小文字hexをbacktickで囲んだものだけにし、注記・branch名・短縮SHAを同じcellへ書かない（識別行が一意に解決できず`identity-unresolvable`で拒否される）。由来の説明は`比較基点の由来`のような別行へ書く。

### 0.1 routing入力契約

providerとmodel設定はproject choiceとrouting evidenceの観測値を用い、固有のmodel slugだけからreview authorityを推測しない。

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点、敵対8観点、finding 12件（High 4・Medium 3・Low 5）、自作変異9件 | advanced（risk medium・診断文言の配布interface変更） | claude（project choiceの上限Opus） | project_default、effort high | 未解決Critical/Highがあれば停止しfallbackしない | implementerのcontextと別sessionで起動。reviewerが変更したpathは0件で、開始時と終了時の`git status`が同一であることを本人が報告 |

## 1. 入力証拠

レビュー証拠は二段階で完成させる。**Phase Aはtracked review artifactであり、PR作成前に確定する。** 製品・仕様・testを固定した`H_impl`の後、tracked review artifactだけを加えた`H_final`を作る。`H_impl`は`H_final`のancestor、commit間差分はproject policyが選ぶevidence-only pathだけとし、artifact path、SHA-256、Git blob OIDを観測する。**Phase Aで観測するのは`H_impl` commit SHA/author ID、repository、review sessionのanchorとroundである。** **PR number、Actions run ID、immutable review IDはPR作成後にしか存在しないので、tracked review artifactへ書かない**。旧版はこれらをPhase Aへ要求しつつ「H_final後はartifactを更新しない」と定めていたため、**PR作成前は埋められず作成後は直せない循環になっていた。**

**Phase Bはtracked artifactの外にある。** PR作成後、trusted providerからPR number/current head/author ID、Actions run ID/event/head/conclusion/関連PR番号を実観測し、**`review evidence`とdelivery stateへappend-onlyで記録する。** `actor-independent`ではimmutable review ID/commit/user ID/submittedAt/stateもproviderから観測する。PR・成功CIは`H_final`へ一致させ、approvalは下のmode別権限に従う。head変更時は証拠を作り直す。caller申告actor、任意JSON、別PRのrun、COMMENTED、未完了CIは承認証拠にしない。

**reviewerの独立性はproject policyの`merge.reviewIndependence`が決める**。`context-isolated`（未宣言時の既定）はimplementerと別session/contextであること、exact HEADを固定したこと、reviewerが対象差分を変更していないこと、肯定・敵対レビューとfindingの記録を要求する。**同一GitHub actorでも成立し、tracked artifactの`approved`と保存済みreview session/Step 10 bindingがformal approvalになる。** `actor-independent`はPR authorおよびobserved implementation commit authorと別のstable actor IDのprovider `APPROVED`を要求し、**高リスク変更・不可逆操作・release・外部公開でproject policyが宣言して引き上げる。** 両modeともexact HEAD一致は必須である。tracked文書へ自身のcommit SHAを書かず、H_final後はartifactを更新しない。

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260915_152055_staging-digest不一致の診断が実在しない復旧手順を案内する | checkpoint 8で`sync-verified`。00〜03が同期済みでREQ-WF-024・AC-WF-024・INV-01〜03を固定 | 既存文書 |
| 差分 | `6159c46897c39ce0a185ae3468e6b0b729c1bb69`..`0c06312698ab667ef74f91bd4f388adb7f491a65` | 17 path（A 4・M 13）。うち`dist/`3 pathは`npm run build`の生成物 | Git観測 |
| テスト | `npm test`、`npm run verify:distribution` | §7に実測を記録。unit・integration・E2E全layer合格 | テスト出力 |
| 仕様 | `docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/15_要件追跡/00_追跡表.md` | REQ-WF-024を新設しAC-WF-024へ9 SCNを追跡。`npm run trace:check`が`orphanRequirements`・`orphanScenarios`・`orphanImplementations`すべて0件 | 既存文書 |
| commit前candidate | 上記17 path | H_impl 0c06312698ab667ef74f91bd4f388adb7f491a65、作業tree clean | Git index |
| Phase A artifact | `docs/reviews/221_課題1312staging-digest復旧手順案内レビュー.md` | 本fileをH_implの子として単独commitしH_finalにする | Git観測 |
| review session | review-session.json（sessionId `5a8f07e1707f0a735d6ae7e1f1286b8472d5df1bfeceba7c241912d1c69439c7`） | status `converged`、round 2、latestRoundDigest `c7fcfe0af9c2411af8b68c7c3575001b7268732399a3362938aff41b3da28f3d`、latestCandidateHeadSha `0c063126…` | Git観測 |

**Phase Bの外部証拠をこの表へ書かない。** PR number、Actions run ID、immutable review IDはPR作成後にしか存在しない。**それらは`review evidence`とdelivery stateがappend-onlyで保持する正本であり、tracked review artifactは参照先を持たない。**

重要判断を推論だけで承認しない。新しい権限が必要な場合は、対象操作と決定権者を明示する。

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。本artifactは自身のcommit SHAを書かず、`H_impl`は本fileをcommitする前の実装commitを指す。`npm run architecture:check`が依存graphの循環0件を報告する。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: はい。本fileだけを`0c063126`の子として単独commitする。`docs/reviews/`は`src/domain/review.ts`の`EVIDENCE_ONLY_PREFIXES`が定めるevidence-only pathである。
- reviewerの独立性が`merge.reviewIndependence`の要求水準を満たす: はい。policyに宣言が無く既定の`context-isolated`を適用し、implementerと別session・別contextで実施した。詳細は§9。
- **（Phase B。ここでは判定しない）** trusted providerが観測したPR/CI/reviewが`H_final`へ一致することは、PR作成後に`review evidence`が観測して記録する: 本artifactへは書かない。
- 既定branch追随を行った場合、取り込みがreview artifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: **該当しない。** 既定branch追随は行っていない。`比較基点`の`6159c468`はbranch作成時点のorigin/mainのtipであり、`git merge-base --is-ancestor`で`H_impl`の祖先であることを確認した。PR作成前に`mergeStateStatus`を確認し、`BEHIND`なら本artifact commitより前にmergeで追随する（rebaseは使わない。review sessionのanchorを壊し`reanchor`も`implementation-diff-changed`で拒否するため）。

### 1.1 変更ファイル個別監査

追加・変更・削除した全ファイルを省略せず1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけによる代替を認めない。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package | package | 復旧経路の唯一の所有者。既存の`--reconfirm`段落の直後へ1段落を隣接配置し、導出元と離さない | 規範は下流を参照しない | AC-WF-024 / SCN-UNIT-RECOVERYHINT-004 | 1段落revert | pass |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | M | package | package | Step 10入口からの到達点。条件と手順の正本は規範文書と明記し本文を複写しない | skill→規範の一方向 | SCN-UNIT-RECOVERYHINT-004 | 1段落revert | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package | spec | TERM-ASC-119「上流再確定」1行。着手時の最大IDは118で他branchのstagingにも119の採番なし | 用語→要件 | TERM-ASC-119 | 1行revert | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | package | spec | REQ-WF-024行をREQ-WF-023の直後へ | 一覧→要件本文 | REQ-WF-024 | 1行revert | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package | spec | REQ-WF-024本文とAC-WF-024を新設し、REQ-WF-009からは所有を外して委譲した（round 1のI-02） | 要件→実装path | REQ-WF-024 / AC-WF-024 | 追加分revert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | unit行とintegration行の2行。`trace:check`合格 | 要件→SCN→feature→実装 | 全9 SCN | 2行revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | header区切りの直後へ挿入し末尾の移行表へ混入していない | 記録のみ | REQ-WF-024 / TERM-ASC-119 | 1行revert | pass |
| `src/adapters/review-session.ts` | M | package | src | review session更新前検査の診断を`recoveryHint`経由へ委譲。journal・delivery stateの読み取り失敗をcatchし、案内の生成でdigest不一致の判定を止めない | adapters→domainの一方向。`architecture:check`合格 | SCN-INT-RECOVERYHINT-009 | 委譲を定数へ戻せばrevert | pass |
| `src/cli.ts` | M | package | src | delivery直前検査と再配送直前検査の2 call site。`STAGING_DIGEST_RERECORD_HINT`のimportを削除し、同じ関数へ委譲する`stagingRecoveryHint`を置いた | cli→domain・adapters | SCN-INT-RECOVERYHINT-005 | 同上 | pass |
| `src/domain/workflow.ts` | M | package | src | 案内生成の単一所有者`stagingDigestRecoveryHint`を追加。判定・受理集合・CLI終了値を1つも変更しない | domainは外向き依存を持たない | REQ-WF-024 / SCN-UNIT-RECOVERYHINT-001〜003・006〜008 | 関数削除でrevert | pass |
| `test/features/integration/staging-digest-recovery-hint-cli.feature` | A | package | evidence | CLI経路2 scenario。3 call siteのうちcli.ts側とreview-session.ts側の合成経路を観測する | feature→steps | SCN-INT-RECOVERYHINT-005・009 | file削除 | pass |
| `test/features/unit/staging-digest-recovery-hint.feature` | A | package | evidence | unit 7 scenario。AC-WF-024の各条項へ1対1で対応する | feature→steps | SCN-UNIT-RECOVERYHINT-001〜004・006〜008 | file削除 | pass |
| `test/steps/staging-digest-recovery-hint-cli.steps.ts` | A | package | evidence | 隔離stagingを作りCLI経路の診断文を実観測する。実repositoryのstagingを読まない | steps→src・filesystem | SCN-INT-RECOVERYHINT-005・009 | 隔離dirのみ書く | pass |
| `test/steps/staging-digest-recovery-hint.steps.ts` | A | package | evidence | 案内文の字面と、案内した手順が実際に受理されることの両方を観測する | steps→src・filesystem | SCN-UNIT-RECOVERYHINT-001〜004・006〜008 | file削除 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい、**14件**（A 4・M 10）。`git diff --name-status`の17 pathのうち`dist/src/adapters/review-session.js`・`dist/src/cli.js`・`dist/src/domain/workflow.js`の3 pathを除外した。`scripts/check_file_audit.ts`の`isGeneratedDistributionPath`が生成物を個別監査の対象から外すためで、**表へ書くと`個別監査とGit差分path集合が一致しません`で落ちる。** 生成物は§8の配布物影響で`dist/src/`として1行で扱う。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: はい。案内文はstagingの相対pathとcommand名だけを含み、環境変数・token・絶対pathを出さない。`schemas/`・`policy/`・保護fileへの変更は0行で、proposal二段階を要さない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: はい。round 2の修正は9 pathに限られ、上流の00要求定義は目的・scopeが変わらないため変更していない。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

モード別実装計画（fullは03、quickとpocは集約00）の発見記録を全件転記せずIDで参照し、最終状態とEvidenceを確認する。目的、scope、受け入れ条件、security境界、不可逆操作を変えなかった発見は上流再起動を要求しない。契約を変えた発見は、影響する成果物だけが再確定されていることを確認する。

発見IDはモード別実装計画（fullは03、quickとpocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDに言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | unit層だけでは3 call siteの委譲を観測できない。案内生成が正しいままcall siteの委譲を旧定数へ戻す変異が生存する | 受け入れ条件。AC-WF-024へ「3 call siteすべての診断に案内が届く」を追加しSCN集合が拡大した | あり（受け入れ条件の追加） | integration層のSCN-INT-RECOVERYHINT-005を追加。round 2でreview-session経路のSCN-INT-RECOVERYHINT-009も追加し、2経路を実観測する形にした | 変異D3（review-session.tsの委譲を定数へ戻す）が全1,918 scenarioで生存したことをround 1のreviewerが実証。SCN-009追加後は同変異がkillされる | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-WF-024（Step 10記録後は記録済みの上流Stepだけを名指しする） | SCN-UNIT-RECOVERYHINT-001、SCN-UNIT-RECOVERYHINT-008 | `src/domain/workflow.ts`の`stagingDigestRecoveryHint` | 2 scenario合格 | pass | 001は案内が`--reconfirm`と対象Step範囲を名指しすることを観測する。008はquickのStep集合（0,1,4,9,10,11）を与え、案内が記録済みの上流Stepだけを名指しし未記録の2,3,5,6,7,8を含まないことを観測する |
| AC-WF-024（Step 10記録前は従来の案内を返す） | SCN-UNIT-RECOVERYHINT-002 | 同上 | 1 scenario合格 | pass | 案内が最新Stepの再記録を示し、上流再確定を名指ししないことを観測する。既存の診断契約SCN-UNIT-DIAGHINT-001・002が検査する字面を変えていない |
| AC-WF-024（Step 11記録済みとterminal delivery stateでは上流再確定を名指しせず内容を戻す手順を返す） | SCN-UNIT-RECOVERYHINT-006、SCN-UNIT-RECOVERYHINT-007 | 同上 | 2 scenario合格 | pass | 006はjournalのStep 11 entry、007はdelivery stateの`merge-observed`を入力にする。**007はround 1のI-01で追加した。** `recordStep11`は`merge-observed`からしか遷移しないため、merge観測とStep 11記録の間に必ずこの窓が開き、journalのStep集合だけを見ると見落とす |
| AC-WF-024（案内した手順がその状態で実際に受理されstaging digestが再固定される） | SCN-UNIT-RECOVERYHINT-003 | 同上・`workflow record --reconfirm` | 1 scenario合格 | pass | 隔離stagingでStep 10まで記録しstagingを編集したうえで、案内が名指しする上流Stepの再確定を実際に適用し、追記が受理されstaging digestが再固定されることを観測する。**申告ではなく実行結果を測る。** round 1のI-04で、それまでのSCN-003が02設計の定義した量と別の量を測っていたため差し替えた |
| AC-WF-024（規範文書とStep skillの双方から到達できる） | SCN-UNIT-RECOVERYHINT-004 | `.agent-skill-chain/docs/01_開発ワークフロー.md`、`.agent-skill-chain/skills/step-10-review/SKILL.md` | 1 scenario合格 | pass | 両方に上流再確定の記述があることを観測し、あわせてSKILLが規則本文を複写していないことを3字面で検査する（round 1のI-10で1字面から拡張） |
| AC-WF-024（3 call siteすべての診断に案内が届く） | SCN-INT-RECOVERYHINT-005、SCN-INT-RECOVERYHINT-009 | `src/cli.ts`、`src/adapters/review-session.ts` | 2 scenario合格 | pass | 005はCLI経路のdelivery直前検査、009はreview session更新前検査を実行し、返された診断に上流Step再確定の案内が含まれることを観測する。**判定関数を直接呼ばず合成経路を通す。** |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 診断文は利用者の端末へ出力され、CI logやIssueへ転記されうる。案内文へ何を含めるかがそのまま情報露出の範囲になる | 案内文に含めるのはcommand名（`workflow record --step=<N> --reconfirm`）と固定語のみで、stagingの絶対path・環境変数・token・repository名を1つも含まない。REQ-WF-024が「案内文にはstagingの相対pathとcommand名以外を含めず、環境変数・token・絶対pathを出さない」と定め、`test/steps/staging-digest-recovery-hint.steps.ts`が生成文字列を直接観測する。個人情報の取得・保持・削除は発生しない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 本変更の目的そのものが運用可能性の是正である。拒否診断が「次に採れる行動」を返さないと利用者は復旧できない | 3 call siteの診断文が状態に応じた実在の手順を返す。伏字化の対象となる値を案内文へ入れないため追加のmasking処理は不要。判定・受理集合・CLI終了値を変更しないため、既存のlog相関と監視閾値に影響しない。復旧結果はSCN-UNIT-RECOVERYHINT-003が実際の受理とdigest再固定まで観測する |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | applicable | CLIの診断文は利用者が読む唯一の出口であり、文言の内容が復旧できるかどうかを決める。JSON出力であることを非適用の根拠にしない | 利用taskは「staging digest不一致から復旧する」。状態は3つ（Step 10未記録・Step 10記録済みかつ非terminal・terminal）で、それぞれに実行可能な次の1手を返す。terminal時も「編集前の内容へ戻す」という行動を返す（round 1のI-07で追加。それ以前は行動を持たない文だった）。画面契約・色・focus順序・screen readerの対象となるUI要素を持たないため、a11y検証の対象は存在しない。非UI証拠として上記7 unit scenarioの文字列観測を置く |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 本変更が触るのはCLIが標準出力へ返すplain textの診断文だけで、design token・component state・breakpoint・layoutを持つ描画層を1つも含まない。変更した3 fileはいずれもNode.jsのdomain/adapters/CLI層であり、stylesheet・theme定義・UI componentへの変更は0行である | 非該当証拠として、差分17 pathにstylesheet・theme・component fileが1件も含まれないことを`git diff --name-status`で確認した。描画層が存在しない以上、token整合性の検証対象も存在しない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | AC-WF-024の6条項すべてに対応SCNがあり、9 scenarioが全合格する。**とくに中心条項「案内した手順がその状態で実際に受理される」を、申告ではなく`workflow record --reconfirm`の実行結果で測る**（SCN-UNIT-RECOVERYHINT-003）。案内が正しいことを案内文の字面だけで主張していない |
| 価値 | 利用者・運用上の目的を満たすか | pass | 是正前は、Step 10記録後にstagingを編集した利用者が診断どおり`workflow record --step=10`を実行すると`assertConvergedReviewSession`が`assertStoredStagingDigest`を先に呼ぶため必ず拒否され、製品内に出口が無いと誤認した。是正後は同じ状態で`--reconfirm`が名指しされ、SCN-UNIT-RECOVERYHINT-003がその手順の受理を実測する |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 追加の依存・権限・環境変数・設定を要さない。`stagingDigestRecoveryHint`はjournalのStep番号集合とboolean 1個だけを引数にとり、filesystem・network・processへ触れない（`src/domain/workflow.ts`の実装本文。SCN-UNIT-RECOVERYHINT-001〜008が引数だけを与えて生成文字列を観測する） |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | REQ-WF-024本文の3分岐（Step 10未記録・Step 10記録済み・Step 11記録済みまたはterminal）と実装の3 return、SCN 001/002/006/007が1対1で対応する。`trace:check`が`orphanRequirements`・`orphanScenarios`・`orphanImplementations`すべて0件を報告し、`workflow:check`も合格する。round 1のI-02で残っていたREQ-WF-009本文との矛盾は、上流のREQ-WF-009側を委譲へ直して解消した |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | 案内生成が1箇所に集約され、3 call siteは委譲するだけになった。**文言を変えるときに触る場所が1つに定まる。** あわせて`STAGING_DIGEST_RERECORD_HINT`のexportを削除しmodule surfaceは縮小している（`src/cli.ts`のimport削除を差分で確認） |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | round 1のreviewerが2件の反例を実証した。(1) delivery stateが`merge-observed`でjournalにStep 11 entryが無い状態では`--reconfirm`も拒否される（I-01）。(2) quick/pocは`MODE_STEP_SEQUENCES`が`0,1,4,9,10,11`のため「1〜9のいずれか」の案内は実測9件中6件が拒否される（I-03）。**どちらも本変更が直そうとした欠陥と同型の誤案内だった。** 前者はdelivery stateを入力へ加えて、後者は記録済みStepだけを具体値で名指しする形へ狭めて解消し、SCN-007と008が観測する |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | journalとdelivery stateの読み取りは3 call siteすべてでtry/catchに包み、失敗時は既定の案内へ倒す。**案内の生成で本来のdigest不一致診断を別の診断へ置き換えない。** round 1のI-08で`src/cli.ts`側の2 call siteだけ保護が無く非対称だったため、`stagingRecoveryHint`を置いて対称にした |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 空のStep集合（`stagingDigestRecoveryHint([])`）はcatch経路の既定値として実際に使われ、従来の案内を返す。Step 10と11の同時記録済みはterminal分岐が優先する。上流Step候補は`step >= 1 && step <= 9`で閉じ昇順に整列するため、重複と順不同を持ち込めない。`Set`で重複除去する |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | 案内文は固定literalと`1〜9`に閉じた数値の連結だけで構成され、利用者入力・path・環境変数を1文字も埋め込まない。**文字列連結による注入面を持たない。** stagingのpathを案内文へ入れていないため経路脱出の余地もない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 認証・承認の判断に一切関与しない。`assertStoredStagingDigest`と`assertWorkflowReadyForDelivery`の**拒否条件を1文字も変更していない**（差分では`throw new Error`の引数末尾だけが定数から関数呼び出しへ変わっている）。案内が緩む方向へ判定を動かしていないことは、変更前後で受理集合が同一であることから従う |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 書き込みを1件も行わない。terminal分岐は`--reconfirm`を案内せず「編集前の内容へ戻す」を案内するため、**置けない再確定entryをjournalへ追記させようとして利用者を失敗させることがない。** 案内に従った操作はいずれも既存の受理集合の内側にある |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | `src/domain/workflow.ts`の関数を削除し3 call siteを定数へ戻せば完全にrevertできる。永続状態のschema・delivery state・journal形式を変更していないため、revert時のmigrationが不要である |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `STAGING_DIGEST_RERECORD_HINT`の参照元をgrepで全件洗い出し3 call siteすべてを委譲へ変えた。旧定数はexportを失い、残る参照は0件である。配布物は`dist/src/`を再buildし、`.agent-skill-chain/docs/01_開発ワークフロー.md`と`step-10-review/SKILL.md`の2面へ規範と入口を置いた（SCN-UNIT-RECOVERYHINT-004が両方からの到達を観測する） |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| I-01 | High | merge-observedのdelivery stateではjournalにStep 11 entryが無いのに`appendWorkflowJournalEntryLocked`がStep 0〜10の追記を拒否する。案内は`--reconfirm`を名指しするが必ず失敗する | `recordStep11`は`merge-observed`からしか遷移しないため、merge観測とStep 11記録の間に必ずこの窓が開く | `src/domain/workflow.ts`、3 call site全て | delivery stateを案内の入力へ加え、`merge-observed`と`step11-recorded`では上流再確定を名指ししない。3 call siteすべてで渡す | resolved | なし。SCN-UNIT-RECOVERYHINT-007が観測し変異C7がkillされる |
| I-02 | High | REQ-WF-009本文がstaging digest不一致に最新Stepの再記録を無条件で案内すると規範として述べ続けており、REQ-WF-024と矛盾する。同段落は自ら「同じ事実を二度書かない」と宣言している | `docs/specs/02_要件/01_ワークフロー要件.md` L196 | 仕様の一貫性 | 当該文をREQ-WF-024への委譲へ置換した。**上流を直したので下流の矛盾が個別是正なしに消えた** | resolved | なし。旧字面の残存0件をgrepで確認 |
| I-03 | Medium | 「1〜9のいずれか」という数量条項がquick/pocで偽。`MODE_STEP_SEQUENCES`がquick/pocで`0,1,4,9,10,11`のため2,3,5,6,7,8は先行通常entryが無く拒否される | 実測で9件中6件がREJECTED | 案内文の正確性 | 記録済みの上流Stepだけを具体値で名指しする形へ狭めた | resolved | なし。SCN-UNIT-RECOVERYHINT-008が未記録Stepを含まないことを観測する |
| I-04 | High | AC-WF-024の中心条項「案内した手順がその状態で実際に受理される」を測るscenarioが無い。SCN-003は02設計が定義した量と別の量を測っている | `test/features/unit/staging-digest-recovery-hint.feature` | 受け入れ条件の充足判定 | SCN-003を設計どおり`--reconfirm`の実行と受理とdigest再固定の観測へ差し替え、分離した条項をSCN-006へ移した | resolved | なし |
| I-05 | Medium | SCN-INT-RECOVERYHINT-005の実装欄に`src/adapters/review-session.ts`を記載しているが当該経路を通らない | 変異D3が全1,918 scenarioで生存して実証された | `docs/specs/15_要件追跡/00_追跡表.md` | SCN-INT-RECOVERYHINT-009を追加してreview-session経路を実際に通し、実装欄の記載を事実にした | resolved | なし。変異D3がkillされる |
| I-06 | Medium | Step 11分岐がAC-WF-024の列挙条項に無く、対応するAC条項を持たないSCNが存在する | `docs/specs/02_要件/01_ワークフロー要件.md` | 受け入れ条件の網羅 | AC-WF-024の条項へStep 11・terminal delivery・記録済み上流Step・3 call siteを追加した | resolved | なし |
| I-07 | Low | Step 11分岐の案内が行動可能な次の1手を持たない。診断は既にstagingを編集した後にしか出ないため「編集しない」と返しても復旧できない | `src/domain/workflow.ts` | 診断の有用性 | terminal時の案内へ「編集前の内容へ戻すとdigestは一致する」を加えた | resolved | なし。変異B2がkillされる |
| I-08 | Low | `src/cli.ts`の2 call siteだけtry/catchが無く、`readWorkflowJournal`の例外でdigest不一致の診断が別診断へ置き換わりうる。review-session.ts側と非対称 | `src/cli.ts` | 失敗経路 | cli.ts側にもtry/catchを持つ`stagingRecoveryHint`を置き、review-session側と対称にした | resolved | なし |
| I-09 | Low | docstringが「この定数は」と述べるが実体は関数`recoveryHint`である | `src/adapters/review-session.ts` | 可読性 | docstringを「この関数は」へ訂正した | resolved | なし |
| I-10 | Low | SKILL複写禁止の検査が「順序判定から除外」の1字面のみで、他の規則本文を複写しても検出しない | `test/steps/staging-digest-recovery-hint.steps.ts` | 検査の強度 | skill複写禁止の検査を3字面へ広げた | resolved | なし |
| I-11 | Low | export削除によりmodule surfaceは縮小しており、変更履歴の「後方互換」の記載が厳密には過大 | `docs/specs/15_要件追跡/01_変更履歴.md` | 記録の正確性 | module surfaceが縮小した事実を記載へ加えた | resolved | なし |
| M-SURVIVE | High | implementerの自作変異7件は「名指しした字面を落とす」ものに偏り、値の空洞化・条件の狭窄・走査回避を十分に作っていない。reviewerの自作変異9件中8件が生存し、うちC5・D2・D3は全1,918 scenarioでも生存した | round 1 reviewerの変異実行結果 | 検査の強度全体 | reviewerが生存させた8変異を再実行して全killを確認し、B1相当の狭窄変異2件を追加した。数量条項を具体値で縛り、3 call siteそれぞれの合成経路を観測する形にした | resolved | なし。**変異11件すべてkill・生存0**（round 2で実行しreview sessionへ記録） |
| L-01 | Low | `docs/specs/15_要件追跡/01_変更履歴.md`の当該行のSCN列が`SCN-UNIT-RECOVERYHINT-001〜004、SCN-INT-RECOVERYHINT-005`のままで、round 2で追加したSCN-UNIT-RECOVERYHINT-006〜008とSCN-INT-RECOVERYHINT-009を含まない | round 2のcommit `0c063126`が`00_追跡表.md`は更新したが`01_変更履歴.md`は触れていない（`git show --stat`で確認） | 記録の可読性のみ。追跡の正本である`00_追跡表.md`は9 SCN全件を持ち`trace:check`も合格する | **是正しない。** `docs/specs/02_要件/04_仕様・品質管理要件.md` L59が個別列挙を要求するのは用語ID列だけで、**SCN列には網羅を要求する規則が無く**、隣接行（`SCN-UNIT-ADMIT-001〜006`、`SCN-UNIT-ISSUECOMMENT-001〜004`）も範囲記法を用いている。**適用される規則はすべて満たしているため個別判定はpassである。** 全件列挙は望ましいが要件ではないので、次にこのfileへ触れる変更で揃える | valid | 変更履歴の当該行だけを読むとSCNが5件に見える。追跡の正本は`00_追跡表.md`であり、そちらは9件全件で一致する |

指摘なしの場合は「指摘なし」と明記する。本ラウンドの未解決Critical/Highは0件である。

## 6. ラウンド固有の確認

**ラウンドの数え方。** 数えるのはStep 10のreview roundだけである。Step 7の設計レビューは数えない。本Issueはround 1とround 2の2ラウンドで収束し、`audit:check`の上限4に対して2ラウンドを残している。

### ラウンド1

- 全評価基準を確認した: はい。肯定5観点・敵対8観点をすべて確認し、reviewerが自作変異9件を実行した。
- 指摘を確定した: はい。12件（High 4・Medium 3・Low 5）。blockingはI-01・I-02・I-04の3件。
- 次ラウンド対象のCritical/High: I-01（terminal delivery stateでの誤案内）、I-02（REQ-WF-009との規範矛盾）、I-04（中心条項を測るscenarioの不在）、M-SURVIVE（自作変異9件中8件が生存、うち3件は全1,918 scenarioでも生存）。

### ラウンド2

- 未解決Critical/High: 0件。I-01・I-02・I-04・M-SURVIVEすべてresolvedで、blockingは空である。
- 修正差分: 9 path。`src/domain/workflow.ts`（delivery state引数の追加、上流Stepの具体値名指し、terminal時の行動追加）、`src/cli.ts`と`src/adapters/review-session.ts`（3 call siteへdelivery stateを渡す、cli側のtry/catch対称化、docstring訂正）、`docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-009の委譲化、AC-WF-024への条項追加）、`docs/specs/15_要件追跡/00_追跡表.md`（SCN-009追加）、`docs/specs/15_要件追跡/01_変更履歴.md`（module surface縮小の記載）、2 feature fileと2 steps file（SCN-003差し替え、SCN-006〜009追加、複写禁止検査の拡張）。
- 修正で触れた隣接範囲: `src/cli.ts`の`stagingRecoveryHint`は既存の`assertWorkflowReadyForDelivery`と`assertWorkflowReadyForTerminalRedelivery`の2 call siteだけに影響し、他のCLI subcommandへ波及しない。`readStoredDeliveryState`のimport追加は読み取り専用で、delivery stateの書き込み経路へ触れていない。
- 既承認・未変更範囲を再走査していない: はい。round 1でpass判定した`.agent-skill-chain/`の2 file、`docs/specs/01_システム概要/02_用語・略語.md`、`docs/specs/02_要件/00_要件一覧.md`は変更が無いため再走査の対象にしていない。

### ラウンド3

**実施していない。** round 2でblockingが空になり収束したため、ラウンド3の予算は消費していない。

- 全指摘の最終分類: 該当なし（round 2で確定済み。valid 13件のうちresolved 12件、未解決はLowのL-01 1件のみ）。
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 該当なし。
- 同じ範囲の予算を自動更新していない: はい。上限4に対して2ラウンドで収束し、予算の引き上げを行っていない。
- AIによる最終裁定: 該当なし。

## 7. テスト結果

- 実行したcommandの一覧: 本ラウンドで実際に実行し、結果を観測したものだけを挙げる。
  - `npm test`（全layer）: **2,048 scenarios（2,032 passed・16 skipped）、10,745 steps（10,695 passed・50 skipped）、7分50秒、exit 0。** 失敗0件。
  - `--name "RECOVERYHINT"`絞り込み: **9 scenarios（9 passed）、45 steps（45 passed）、0.25秒。** 本変更で追加した9 SCN（unit 7・integration 2）が全件合格する。
  - `npm run project:quality`・`lint`・`format:check`・`typecheck`・`source:check`・`docs:format`・`test:format`・`architecture:check`: 全件合格。
  - `npm run conformance:check`: **87 scenarios（87 passed）、468 steps、合格**（project rule 21件、orphan 0件、I1〜I12、実在source/export、成功SCN証拠、固定model slug 0件）。
  - `npm run trace:check`: 合格。`orphanRequirements`・`orphanScenarios`・`orphanImplementations`いずれも0件。
  - `npm run workflow:check`: 合格（steps 12・modes 3）。
  - `npm run package:check`: 合格（実行・配布ファイル388件）。
  - `npm run build`後の`git status`: `docs/reviews/`の本artifact以外に差分なし。**committed済みの`dist/`がcompile結果と一致する**ことを確認した（`asc-stale-dist-hides-regressions`の回帰防止）。
- 全layerの合計: 2,048 scenarios中2,032合格・16 skip・**失敗0**。skip 16件はいずれも本変更の対象外で、比較基点`6159c468`時点と同数である。
- runner・Gherkin方言: `@cucumber/cucumber`（`cucumber.mjs`のconfig）。方言は英語キーワード（`Feature`/`Scenario`/`Given`/`When`/`Then`）で、scenario名とstep本文は日本語。`npm run test:format`が全feature fileの書式を検査して合格する。
- **`npm run audit:check`は本artifactをcommitした後に実行する。** 本fileが`H_final`として存在しない状態では監査対象が確定しないため、この時点では未実行である。`npm run verify:distribution`も同じ理由でartifact commit後に通す。
- **変異試験はround 2で実行し、review sessionへ記録した（本ラウンドで再実行していない）。** 変異11件すべてkill・生存0。内訳は系統A削除2件、B分岐反転・狭窄4件、C走査回避3件、D合成経路2件。round 1ではreviewerの自作変異9件中8件が生存し、うちC5・D2・D3の3件は全1,918 scenarioでも生存した。その8件を再実行して全killを確認し、狭窄変異2件を追加したのがround 2の最終形である。

## 8. 配布物影響

projectがpackageとして配布される場合だけ記入する。配布境界はpackage manifestの配布file指定を単一正本とし、compileされて配布される`source`も配布境界に含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| dist/src/ | 入る | `package.json`の`files`が`dist/src/`を含む。`review-session.js`・`cli.js`・`workflow.js`の3 fileが`npm run build`で再生成された。利用者が受け取る診断文が状態に応じて変わる。**API・CLI flag・終了値は変わらない。** |
| .agent-skill-chain/docs/01_開発ワークフロー.md | 入る | 復旧手順の規範が1段落増える。利用者はStep 10記録後の是正で上流再確定を採れることを配布物だけで知れる |
| .agent-skill-chain/skills/step-10-review/SKILL.md | 入る | Step 10入口から復旧手順の正本へ到達する1段落が増える。規則本文は複写していない |
| src/domain/workflow.ts | 入る | **compileされて配布されるsourceは配布境界に含まれる。** `src/domain/conformance.ts`の`distributedPaths`が`dist/src/`の存在をもって`src/`を配布境界へ写像する。案内生成の単一所有者で、利用者が受け取る診断文の内容を決める |
| src/adapters/review-session.ts | 入る | 同上の写像による。review session更新前検査の診断が委譲経由になる |
| src/cli.ts | 入る | 同上の写像による。delivery直前検査と再配送直前検査の2 call siteの診断が委譲経由になる |
| docs/specs/01_システム概要/02_用語・略語.md | 入らない | repository内部の仕様書で`files`に含まれない |
| docs/specs/02_要件/00_要件一覧.md | 入らない | 同上 |
| docs/specs/02_要件/01_ワークフロー要件.md | 入らない | 同上 |
| docs/specs/15_要件追跡/00_追跡表.md | 入らない | 同上 |
| docs/specs/15_要件追跡/01_変更履歴.md | 入らない | 同上 |
| test/features/unit/staging-digest-recovery-hint.feature | 入らない | testは`files`に含まれない |
| test/features/integration/staging-digest-recovery-hint-cli.feature | 入らない | 同上 |
| test/steps/staging-digest-recovery-hint.steps.ts | 入らない | 同上 |
| test/steps/staging-digest-recovery-hint-cli.steps.ts | 入らない | 同上 |

判断: 配布物を更新した

根拠: runtimeの診断文が状態に応じて変わるため、配布される規範文書`.agent-skill-chain/docs/01_開発ワークフロー.md`とStep入口`.agent-skill-chain/skills/step-10-review/SKILL.md`の双方へ復旧手順を反映し、`dist/src/`を同じcommitへ再buildして含めた。利用者は配布物だけを読むため、repository内部の`docs/specs/`へ書いても届かない。

**runtimeの挙動が変わるのに配布文書が追随していない状態を残さない。** 利用者は配布物だけを読むため、repository内部の仕様書へ書いても届かない。

## 9. 独立reviewの成立

**この節はPhase Aで埋める。** 記入するのはPR作成前に観測できるものだけであり、**immutable review IDやapprovalの件数などPR作成後にしか存在しない値は書かない。** それらはPhase Bで`review evidence`が観測して記録する。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（`merge.reviewIndependence`に宣言が無いため既定を適用した） |
| その要求を満たすこと | はい。implementerと別session・別contextでreviewerを起動し、exact HEADを`5e7f9026`（round 1）・`0c063126`（round 2）で固定した |
| reviewerとimplementerのidentity・context比較 | implementerはcoordinator sessionから起動した実装context。reviewerは別プロセスの独立contextで、実装の判断過程・中間成果物・staging編集履歴を引き継いでいない。同一GitHub actor（tatsuru）だが`context-isolated`はactor一致を妨げない。reviewerはround 1で12件のfindingとchanges-requestedを返し、**implementerの自作変異7件に対し自作変異9件を独立に作って8件を生存させた。** 判断が実装側へ追従していないことの観測値である |
| reviewerが対象差分を変更していないこと | はい。reviewerが変更したpathは0件。review session（`review-session.json`）のround記録は`recordReviewRound`だけが書き、実装差分は`5e7f9026`と`0c063126`の2 commitに閉じている。round 2のcandidate HEAD `0c063126`はimplementerのcommitであり、reviewerによるcommitは存在しない |

外部への不可逆な配布で独立reviewの外部証拠を要求され、かつそれが無い場合だけ記入する。**本変更は該当しない。** package registryへの公開を行わないため、この例外表は使用しない。

**承認元、承認者、承認日時、失効日時は正本を参照し、ここへ複製しない。**

例外が正本に無い、または失効している場合は進めない。記録があれば実装・PR・mergeは進み、mergeを契機に自動で走るtag作成とReleaseも進む。止めても不可逆な行為を防げないためである。package registryへの公開など外部への不可逆な配布だけが、記録の有無にかかわらず独立reviewの外部証拠を要求する。削除、force push、履歴書き換えは独立reviewの対象外であり、既存のauthority経路で守る。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/00_要件一覧.md`（REQ-WF-024行）、`docs/specs/02_要件/01_ワークフロー要件.md`（REQ-WF-024本文・AC-WF-024の新設と、REQ-WF-009からREQ-WF-024への委譲）、`docs/specs/01_システム概要/02_用語・略語.md`（TERM-ASC-119）、`docs/specs/15_要件追跡/00_追跡表.md`（unit行・integration行）、`docs/specs/15_要件追跡/01_変更履歴.md`（1行）。配布側は`.agent-skill-chain/docs/01_開発ワークフロー.md`と`.agent-skill-chain/skills/step-10-review/SKILL.md`。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: はい。TERM-ASC-119「上流再確定」を`active`・`v0.3.2`・廃止なしで登録し、成立例（Step 10後に`--reconfirm`でStep 1へ追記しdigestを再固定）と反例（Step 11記録後の同じ操作は拒否される）の両方を持つ。着手時の最大IDは118で、他branchのstagingを含めて119の採番が無いことを確認した。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。TERM-ASC-119は禁止表現として「やり直し」「再実行」「Step 0からの再開」を明示し、規範文書・SKILL・実装docstring・診断文がすべて「上流再確定」で揃っている。`STAGING_DIGEST_RERECORD_HINT`は置換先（`stagingDigestRecoveryHint`）を持って削除した。
- 要件・変更・SCN・テストの追跡: REQ-WF-024 → AC-WF-024 → 9 SCN（unit 7・integration 2）→ 2 feature file → 2 steps file → 実装3 fileと配布2 file。`npm run trace:check`が`orphanRequirements`・`orphanScenarios`・`orphanImplementations`すべて0件を報告する。
- `no-spec-impact`の場合の限定的根拠: 該当しない。判定は`updated`である。
- UI・トークンの判断: DC-TOKENSを`not-applicable`と判定した。描画層を持たずstylesheet・theme・componentへの変更が0行であるため。DC-UXは`applicable`として、CLI診断文を利用者が読む唯一の出口と位置づけ3状態それぞれに実行可能な次の1手を置いた。
- 既知の未解決: §5のL-01。`docs/specs/15_要件追跡/01_変更履歴.md`のSCN列がround 2で追加した4 SCNを含まない。**SCN列に網羅を要求する規則は無く**（`04_仕様・品質管理要件.md` L59が個別列挙を課すのは用語ID列だけ）、隣接行も範囲記法を用いるため規則違反ではない。**追跡の正本は`00_追跡表.md`であり、そちらは9件全件で一致する。**

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。round 1のblocking 3件（I-01・I-02・I-04）とM-SURVIVEはすべてround 2でresolvedになり、round 2のblockingは空である。
- Medium/Lowの記録: Medium 3件（I-03・I-05・I-06）はすべてresolved。Low 6件のうちI-07〜I-11の5件はresolved、L-01（変更履歴のSCN列が4件不足）はvalidのまま残す。SCN列に網羅を要求する規則が無いため個別監査はpassで、次にこのfileへ触れる変更で揃える。
- 判定: approved
- 新しい権限が必要な事項: なし。保護fileへの変更が0行のためproposal二段階を要さない。branch protection・authority境界・merge権限のいずれも変更していない。
- 残存リスク: L-01のみ。変更履歴の当該行だけを読むとSCNが5件に見える。実装・test・追跡表・配布物への影響は無い。
- 次に許可される操作: 本artifactを`H_impl`の子として単独commitして`H_final`にする → `workflow record --step=10 --review-session-digest=c7fcfe0af9c2411af8b68c7c3575001b7268732399a3362938aff41b3da28f3d` → `npm run verify:distribution` → push → `pr create --issue=1312 --canonical-issue=1312 --head-sha=<H_final>`。**`pr create`の前に`mergeStateStatus`を確認し、`BEHIND`ならmergeで追随する（rebaseは使わない）。**
- 次回の再開地点: PR作成後のPhase B。`review evidence`がPR number・Actions run ID・CI conclusionを実観測して記録する。CodeRabbitのreviewはDraft解除後に走るため、実装完了時点でreadyにしておく。
