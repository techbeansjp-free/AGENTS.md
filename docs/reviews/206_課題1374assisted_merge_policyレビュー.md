# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

**本templateを埋めた成果物は版管理下へ置く。** 一時ステージングに置いたままでは`review evidence`も履歴監査も成立しない。`docs/reviews/`または`.agent-skill-chain/reviews/`配下へ複写し、実装commitの後にその1 fileだけをcommitする。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | 6361432bb58e72eaef0256c9a6240b09589e6211 |
| 比較基点 | `19196a3d05056c39a721d514e94af8f68a45a08c` |
| H_impl | `6361432bb58e72eaef0256c9a6240b09589e6211` |
| 対象差分 | .agent-skill-chain/project-policy.json、docs/specs/10_セキュリティ/01_信頼境界.md、docs/specs/12_運用保守/00_運用設計.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、test/features/integration/project-policy-satisfiability.feature、test/steps/project-policy-satisfiability.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | 5 counted round |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260913_113857_merge-policy-assisted |
| 仕様の所有箇所 | `docs/specs/12_運用保守/00_運用設計.md`のAgent Routing、`docs/specs/10_セキュリティ/01_信頼境界.md`のcandidate policy境界、REQ-WF-013 |
| 成果物行数 | 製品40変更行、支援層0行 |
| 縮小の先行評価 | 既存assisted runtimeを流用し、runtime変更なしのproject policy・test・specだけへ縮小した |
| 実施者・日時 | reviewer: Anthropic Claude Code Opus 5 / high / 別session、2026-09-13T03:30:00Z |

`比較基点`と`H_impl`の2行は`review reanchor`と`audit:check`が機械的に読む。値は40桁の小文字hexをbacktickで囲んだものだけにし、注記・branch名・短縮SHAを同じcellへ書かない（識別行が一意に解決できず`identity-unresolvable`で拒否される）。由来の説明は`比較基点の由来`のような別行へ書く。

### 0.1 routing入力契約

providerとmodel設定はproject choiceとrouting evidenceの観測値を用い、固有のmodel slugだけからreview authorityを推測しない。

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding 6件の分類 | critical | Claude | project_default / high / standard（実効Opus 5） | 未解決Critical/Highなら停止 | implementerのCodex sessionと別Claude session。read-only plan modeで対象7 pathを変更していない |

## 1. 入力証拠

レビュー証拠は二段階で完成させる。**Phase Aはtracked review artifactであり、PR作成前に確定する。** 製品・仕様・testを固定した`H_impl`の後、tracked review artifactだけを加えた`H_final`を作る。`H_impl`は`H_final`のancestor、commit間差分はproject policyが選ぶevidence-only pathだけとし、artifact path、SHA-256、Git blob OIDを観測する。**Phase Aで観測するのは`H_impl` commit SHA/author ID、repository、review sessionのanchorとroundである。** **PR number、Actions run ID、immutable review IDはPR作成後にしか存在しないので、tracked review artifactへ書かない**。旧版はこれらをPhase Aへ要求しつつ「H_final後はartifactを更新しない」と定めていたため、**PR作成前は埋められず作成後は直せない循環になっていた。**

**Phase Bはtracked artifactの外にある。** PR作成後、trusted providerからPR number/current head/author ID、Actions run ID/event/head/conclusion/関連PR番号、immutable review ID/commit/user ID/submittedAt/stateを実観測し、**`review evidence`とdelivery stateへappend-onlyで記録する。** PR・成功CI・承認reviewは`H_final`へ一致させる。**完了はtrusted providerの外部attestationだけで記録し、head変更時は外部証拠を作り直す。** caller申告actor、任意JSON、別PRのrun、COMMENTED、未完了CIは承認証拠にしない。

**reviewerの独立性はproject policyの`merge.reviewIndependence`が決める**。`context-isolated`（未宣言時の既定）はimplementerと別session/contextであること、exact HEADを固定したこと、reviewerが対象差分を変更していないこと、肯定・敵対レビューとfindingの記録を要求する。**同一GitHub actorでも成立する。** `actor-independent`はPR authorおよびobserved implementation commit authorと別のstable actor IDを要求し、**高リスク変更・不可逆操作・release・外部公開でproject policyが宣言して引き上げる。** **どちらのモードでもAPPROVED verdictとexact HEAD一致は必須である。** tracked文書へ自身のcommit SHAを書かず、H_final後はartifactを更新しない。

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260913_113857_merge-policy-assisted | staging digest f7de899dc4d3406a1d7fcf7d8647af360ba52de80a8fc07aaa5b650adddfce8d | 既存コード |
| 差分 | `19196a3d05056c39a721d514e94af8f68a45a08c`..`6361432bb58e72eaef0256c9a6240b09589e6211` | 7 path | 既存コード |
| テスト | targeted、full、後段gate | targeted 36/36、full 1923 pass・16 skip・追跡path誤記2 failを修正後2/2 pass、conformance 87/87、audit/package合格 | テスト出力 |
| 仕様 | 信頼境界、運用設計、追跡表、変更履歴 | updated | 既存文書 |
| commit前candidate | .agent-skill-chain/project-policy.json、docs/specs/10_セキュリティ/01_信頼境界.md、docs/specs/12_運用保守/00_運用設計.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、test/features/integration/project-policy-satisfiability.feature、test/steps/project-policy-satisfiability.steps.ts | H_impl 6361432bb58e72eaef0256c9a6240b09589e6211 | Git index |
| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260913_113857_merge-policy-assisted | session `7af93cd2c8897aee96dc63f4f4b6c35bacddad513199df8f921d495c5cc80c07`、round `acc260371e9cbe3a187a40944f5662ae0e118c61df429a8db5a25fa74f3fdacd` | Git観測 |

**Phase Bの外部証拠をこの表へ書かない。** PR number、Actions run ID、immutable review IDはPR作成後にしか存在しない。**それらは`review evidence`とdelivery stateがappend-onlyで保持する正本であり、tracked review artifactは参照先を持たない。**

重要判断を推論だけで承認しない。新しい権限が必要な場合は、対象操作と決定権者を明示する。

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: H_final作成時にGitで確認する
- reviewerの独立性が`merge.reviewIndependence`の要求水準を満たす: context-isolatedの別provider/sessionでpass
- **（Phase B。ここでは判定しない）** trusted providerが観測したPR/CI/reviewが`H_final`へ一致することは、PR作成後に`review evidence`が観測して記録する: PR後に実施
- 既定branch追随を行った場合の再固定: 追随なし。baseは`19196a3d05056c39a721d514e94af8f68a45a08c`

### 1.1 変更ファイル個別監査

追加・変更・削除した全ファイルを省略せず1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけによる代替を認めない。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/project-policy.json` | M | repository owner | project | repository固有merge選択 | package runtimeへ逆依存なし | AC-MP-01〜04、SCN-INT-SAT-003 | revertでdisabledへ復旧 | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | package owner | spec | candidate自己適用禁止 | trusted loader境界を説明 | AC-MP-04 | admin bypass禁止 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | package owner | spec | repository運用値 | policyと同方向 | AC-MP-01〜05 | owner指示待ち | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 要件・SCN結線 | 多対多追跡 | REQ-WF-013、SCN-INT-SAT-003 | 追跡追加のみ | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | decision記録 | authorityの重複定義なし | REQ-WF-013 | 履歴追加のみ | pass |
| `test/features/integration/project-policy-satisfiability.feature` | M | package owner | test | repository contract例 | stepsへ一方向 | SCN-INT-SAT-003 | test追加のみ | pass |
| `test/steps/project-policy-satisfiability.steps.ts` | M | package owner | test | exact policy値assert | policy loaderを利用 | SCN-INT-SAT-003 | runtime変更なし | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass、7 path
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: pass
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 修正なし。Medium/Lowはrecord-only

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

モード別実装計画（fullは03、quickとpocは集約00）の発見記録を全件転記せずIDで参照し、最終状態とEvidenceを確認する。目的、scope、受け入れ条件、security境界、不可逆操作を変えなかった発見は上流再起動を要求しない。契約を変えた発見は、影響する成果物だけが再確定されていることを確認する。

発見IDはモード別実装計画（fullは03、quickとpocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDに言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-MP-001 | 計画時追加発見なし | なし | なし | 継続 | assess-discovery | no-spec-impact | pass |
| DISC-MP-002 | base SHA転記誤り | authority evidence | なし | 実SHAへ訂正しStep 1/6/8再確定 | worktree createとjournal | no-spec-impact | pass |
| DISC-MP-003 | 既存SCNでrepository policyを検証可能 | test構成のみ | なし | SCN-INT-SAT-003へ集約 | targeted 36/36 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-MP-01 | SCN-INT-SAT-003 | assisted固定 | pass | pass | project-policyとtargeted test |
| AC-MP-02 | SCN-INT-SAT-003 | 8 branch glob固定 | pass | pass | exact配列assert |
| AC-MP-03 | SCN-INT-MERGE-013〜016 | review/CI拒否回帰 | pass | pass | 4 scenarios targeted |
| AC-MP-04 | SCN-INT-SAT-003 | trusted policy境界 | pass | pass | loader call graphと信頼境界spec |
| AC-MP-05 | SCN-INT-SAT-003 | spec・追跡・rollback | pass | pass | trace:checkと変更履歴 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | merge authorityを変更する | candidate自己適用禁止、trusted loader、review/CI維持 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | merge再開・rollbackを明記する | policy PRはowner待ち、revertで復旧 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | UI、画面、対話契約を変更しない | project設定のみ |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI・token・layoutを変更しない | 対象path 7件にUIなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | assisted、merge-only、8 glob、review 1がexact assertと一致 |
| 価値 | 利用者・運用上の目的を満たすか | pass | ownerの明示指示時だけ既存merge経路を利用可能にする |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 既存assisted runtimeを変更せず利用する |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | 4 specと追跡、targeted testが一致 |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | project選択値をproject-policyへ限定 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | disabled/automatic、squash/rebase、glob不足はexact assertが拒否 |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | CI/review/protection不足は既存deny経路を維持 |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | schemaとexact集合検査を維持 |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | candidate policyは当該PRのauthorityにならない |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | origin/defaultのtrusted commitとPR単位owner指示を分離 |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | merge commit限定、削除操作なし |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 未mergeならclose、反映後はmerge commit revert |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | policy、test、運用、安全、追跡を更新 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-1374-01 | High | review-exceptionがassisted経路をfail-openにする懸念 | conformance以外の参照0、trusted loader→authorizeMerge、SCN-INT-MERGE-013〜016 pass | merge authority | call graphと実testで反証 | false-positive / record-only | なし |
| REV-1374-02 | Medium | merge globとallowedBranchTypesの同期assert | exact値は双方一致 | test保守性 | 今scopeでは変更しない | valid / record-only | 将来の片側追加は別変更で検出強化可能 |
| REV-1374-03 | Medium | SCNの二重要件mapping | traceは多対多契約でvalid | 追跡 | 変更しない | false-positive / record-only | なし |
| REV-1374-04 | Medium | 自己適用禁止の強制主体名指し | 規範と既存call graphは一致 | spec明瞭性 | 今scopeでは変更しない | valid / record-only | 実装の強制は維持 |
| REV-1374-05 | Low | requiredChecks空の反証検査不足 | 運用設計がCI runとprotection/ruleset gateを明記 | evidence | 変更しない | false-positive / record-only | なし |
| REV-1374-06 | Low | test証拠をartifactへ記録 | §1・§7へ記録 | evidence | artifactで対応 | valid / record-only | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。Claude Opus/highが肯定・敵対観点を確認した
- 指摘を確定した: 6件。High 1件はcall graphとtestでfalse-positive、他はrecord-only
- 次ラウンド対象のCritical/High: なし

### ラウンド2

- 未解決Critical/High: なし
- 修正差分: なし。Medium/Lowは自動修正しない
- 修正で触れた隣接範囲: なし
- 既承認・未変更範囲を再走査していない: 該当なし

### ラウンド3

- 全指摘の最終分類: false-positive 3、valid record-only 3
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: runtime変更なし、現行disabledで当該PR自己適用不可
- 同じ範囲の予算を自動更新していない: はい
- AIによる最終裁定: approved

## 7. テスト結果

- 実行したcommandの一覧: `npm run verify:distribution`、targeted Cucumber、`npm run conformance:check`、`npm run audit:check`、`npm run package:check`
- 全layerの合計: full Cucumber 1941 scenarios中1923成功・16 skip・2失敗。2失敗は追跡path誤記で修正後2/2成功、最終の対象失敗0件。conformance 87/87成功
- skip層: full suite既定の16 skip。変更対象SCNにskipなし
- runner・Gherkin方言: cucumber-js、en keyword・日本語説明

## 8. 配布物影響

projectがpackageとして配布される場合だけ記入する。配布境界はpackage manifestの配布file指定を単一正本とし、compileされて配布される`source`も配布境界に含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/project-policy.json` | 入らない | 本repositoryのdogfood選択だけが変わる |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | 入らない | system spec更新 |
| `docs/specs/12_運用保守/00_運用設計.md` | 入らない | system spec更新 |
| `docs/specs/15_要件追跡/00_追跡表.md` | 入らない | 追跡更新 |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | 変更履歴更新 |
| `test/features/integration/project-policy-satisfiability.feature` | 入らない | 開発test更新 |
| `test/steps/project-policy-satisfiability.steps.ts` | 入らない | 開発test更新 |

判断: 配布物を更新しない

根拠: 既存assisted runtimeと配布契約は変更せず、このrepository自身のtracked project choiceだけを変更するため。

**runtimeの挙動が変わるのに配布文書が追随していない状態を残さない。** 利用者は配布物だけを読むため、repository内部の仕様書へ書いても届かない。

## 9. 独立reviewの成立

**この節はPhase Aで埋める。** 記入するのはPR作成前に観測できるものだけであり、**immutable review IDやapprovalの件数などPR作成後にしか存在しない値は書かない。** それらはPhase Bで`review evidence`が観測して記録する。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（未宣言時の既定） |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはCodex subagent session、reviewerは別Anthropic Claude Code Opus 5 session `81104c6a-c9e9-427b-abb0-53ab57a23bfa` |
| reviewerが対象差分を変更していないこと | はい。plan mode・Read限定で、review前後のtracked HEADは`6361432bb58e72eaef0256c9a6240b09589e6211`のまま |

外部への不可逆な配布で独立reviewの外部証拠を要求され、かつそれが無い場合だけ記入する。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | 対象外 |
| 観測値 | 外部reviewerを実行済みのため例外不使用 |

**承認元、承認者、承認日時、失効日時は正本を参照し、ここへ複製しない。**

例外が正本に無い、または失効している場合は進めない。記録があれば実装・PR・mergeは進み、mergeを契機に自動で走るtag作成とReleaseも進む。止めても不可逆な行為を防げないためである。package registryへの公開など外部への不可逆な配布だけが、記録の有無にかかわらず独立reviewの外部証拠を要求する。削除、force push、履歴書き換えは独立reviewの対象外であり、既存のauthority経路で守る。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: 信頼境界、運用設計、追跡表、変更履歴
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 新規用語なし、既存TERM-ASC-001/004/088を維持
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: pass
- 要件・変更・SCN・テストの追跡: REQ-WF-013、AC-WF-013、SCN-INT-SAT-003へ結線
- `no-spec-impact`の場合の限定的根拠: 非該当
- UI・トークンの判断: UI/token変更なし

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件
- Medium/Lowの記録: Medium 3件、Low 2件をrecord-only。うちfalse-positive 2件
- 判定: approved
- 新しい権限が必要な事項: PR作成は既承認範囲。mergeは当該PRを通常の保護手続で取り込むrepository owner authorityが別途必要
- 残存リスク: Mediumのbranch type同期検査と強制主体名指しは保守性・明瞭性の改善余地として記録。現行受け入れ条件と実装gateは満たす
- 次に許可される操作: review artifactだけをcommitしH_finalを作成、audit/package/Step 10後にpush・PR作成
- 次回の再開地点: H_finalとreview session digestを固定したStep 10
