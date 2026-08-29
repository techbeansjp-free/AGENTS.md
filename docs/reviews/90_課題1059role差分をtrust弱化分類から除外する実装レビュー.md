# 90 課題1059 role差分をtrust弱化分類から除外する 実装レビュー

> 状態: `approved`。Codexラウンド1はrouting不成立で停止したが、Claude Opus 5・effort highの独立reviewerが同じH_implをラウンド2でレビューし、Critical/High 0件、product code変更要求0件で承認した。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 比較基点 | `05e6365768219dca5b0c42c619bfdc9cbad5cf07` |
| H_impl | `6722ce3211869c18b5e1538ddd88c7538512517a` |
| 対象SHA・文書ダイジェスト | H_impl `6722ce3211869c18b5e1538ddd88c7538512517a`、tree `b65d194e6395d28b124fdb782c3423545af19384` |
| 比較基点 | main `05e6365768219dca5b0c42c619bfdc9cbad5cf07` |
| 対象差分 | `05e6365768219dca5b0c42c619bfdc9cbad5cf07..6722ce3211869c18b5e1538ddd88c7538512517a`の5 file |
| 対象外 | `development.json`、PR #1057、#1051、#1047、#1058、push、PR、merge、release、publish、cleanup。PR-Aの確定scope外または別authorityのため |
| 残り予算 | Step 10の同一scopeで最大3ラウンドのうち残り1 |
| ラウンド数 | 3（Step 7が1、Step 10が2） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260829_021751_role差分を非強制宣言として扱いtrust弱化分類から除外する |
| 仕様の所有箇所 | `docs/specs/10_セキュリティ/01_信頼境界.md`のproject choice差分表、`docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-003 |
| 成果物行数 | 製品・仕様・test合計 +51/-41行。内訳はsource +2/-28、test +47/-11、spec +2/-2。review artifactは支援層 |
| 縮小の先行評価 | 既存`classifyRoleContracts`、既存SCN-INT-ROLE-003、既存2仕様を再利用し、追加のscenario・helper・gate・registry・termを導入していない |
| 実施者・日時 | ラウンド1: `/root/pr_a_step3_reviewer`（Codex）、2026-08-29T13:17:48+09:00。ラウンド2: Claude Opus 5・effort high。双方ともimplementer `/root/pr_a_step9_implementer`と別provider/identity/context |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、independence | critical（authority risk） | Claude | Opus 5、effort high。project choiceの`project_default`を満たす割当 | ラウンド1は停止し、Claude reviewerへ再割当 | Claudeは実装者Codexと別provider/identity/context。inline材料だけを使いtoolsなし・非永続でreviewし、5 product fileを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1059、#1054 issuecomment-5459725185、確定00〜03 | role 2分類解除、validationと隣接分類維持、5 file、choice非包含、release停止 | 一次資料・承認済み成果物 |
| 差分 | base..H_impl | 5 file、+51/-41。H_implの親はbaseと完全一致 | Git観測 |
| targeted test | `npm test -- --name "SCN-INT-ROLE-003"` | 1 scenario / 6 steps成功 | テスト出力 |
| 隣接test | `npm test -- --name "SCN-UNIT-CHOICE"` | 8 scenarios / 40 steps成功 | テスト出力 |
| 直接反例 | `classifyProjectChoiceDiff`へ6入力を与えるread-only実行 | contract全体削除、未知role/field、型不正、tier低下、非role弱化をすべて`weakened`へ分類 | 実行観測 |
| risk比例gate | targeted、typecheck、trace、architecture、sandbox外`verify:distribution`、package check | lint、format、typecheck、source品質、test、build、docs、Gherkin、trace、architecture、conformanceが成功。full 1042 scenarios / 5524 steps。Phase A前の`audit:check`だけが5 product fileを余分として非0。package checkは個別実行で成功 | テスト出力 |
| 仕様 | 2仕様の各1行 | role分類を弱化一覧から除き、schema/type/未知field・tier等の拒否を維持 | 既存文書 |
| commit前candidate | H_impl tree | `b65d194e6395d28b124fdb782c3423545af19384` | Git観測 |
| Phase A artifact | 本file | H_implへ本artifact 1件を加える。content固定後のSHA-256・blob OID・H_finalはtracked artifactへ自己記載せず外部報告する | Git観測 |
| commit後external | Claude Opus 5 reviewer応答 | 同じH_implへapproved、Critical/High 0、product code変更要求0。inline材料だけを使いtoolsなし・非永続。PR・CI・immutable GitHub reviewは未作成 | 独立review応答 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。`development.json`非包含、Claude独立review、artifact自己SHA非記載を確認。
- `H_impl`が`H_final`のancestorで差分がreview artifactだけである: Phase A commit後に確認し、外部報告する。
- reviewer stable IDが実装者と異なる: pass。Claude reviewerは実装者Codexと別provider/identity/context。
- 既定branch追随: not-applicable。H_implはbaseの直接の子である。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/project-choice-diff.ts` | M | package owner | package | validなrole contract内の4 field差分をallowedへ記録 | pass。既存validator→classifier→diffの方向を維持 | FR-01、AC-01/02、SCN-INT-ROLE-003 | 変更分岐をbaseへrevert | pass |
| `test/features/integration/role-tier.feature` | M | package owner | package | 既存SCN-INT-ROLE-003の外部観測契約を更新 | pass。SCN→step→実装 | FR-01/02、AC-01 | feature行をbaseへrevert | pass |
| `test/steps/role-tier.steps.ts` | M | package owner | package | 隔離fixtureで4 fieldとtierを完全一致assert | pass。read-only choice cloneからclassifierへ単方向 | AC-01/02、SCN-INT-ROLE-003 | step差分をbaseへrevert | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | package owner | spec | 弱化一覧からroleの2分類を除く | pass。成立中runtime契約を記録 | FR-01/02、AC-03 | 仕様行と実装を一体でrevert | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | package owner | spec | REQ-SQ-003の弱化対象からroleを除く | pass。要件正本から実装へ単方向 | FR-02、AC-03 | 仕様行と実装を一体でrevert | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass。5件で一致する。
- package/project/spec/evidence層の責務混入: pass。`development.json`、用語台帳、追跡表、workflow、release差分なし。
- 個別finding修正後の再監査: not-applicable。product findingなし。

## 2. 受け入れ条件の確認

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-ROLE-003 | `ROLE_CONTRACT_FIELDS`の差分pathをallowedへ追加 | 1 scenario / 6 steps成功 | pass | 4 path完全一致、role weakeningなし、tier 2 path完全一致 |
| AC-02 | EVIDENCE-ADJACENT-01 | validator、全体削除、tier、非role分岐はsource非変更 | 8 scenarios / 40 steps、直接6反例、full 1042/5524成功 | pass | unknown role/field、bad type、whole delete、tier、strictを実測 |
| AC-03 | EVIDENCE-DIFF-01 | exact 5 file、choice非変更 | 5 path完全一致 | pass | `git diff --name-status` |
| AC-04 | EVIDENCE-OPS-01 | release workflow差分なし | baseline mainの直近push runはfailure。workflow fileとchoiceはcandidate非変更 | pass | Git差分とGitHub read-only観測 |

### 2.1 開発考慮事項の適用判定

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | trust分類と自己許可境界を変更 | exact 5 file、choice非包含、6反例 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | diff pathとtest結果を判断証拠にする | exact H_impl、targeted/full出力。新規log・保存なし |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 非UIのNode CLI内部分類 | projectKind=cli、UI差分なし |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 画面・theme・layoutなし | capabilityとchanged path |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | 4 fieldはallowed、tierだけweakenedを直接assert |
| 価値 | 通常PR経路復旧へ寄与するか | pass | classifierと宣言を分離し、candidate自己許可を作らない |
| 実現可能性 | 実行環境・依存で成立するか | pass | 既存関数内の純粋分類で新規依存なし |
| 整合性 | コード、test、仕様が一致するか | pass | 5 fileとSCN・2仕様が同じrole分類契約を表す |
| 保守性 | 責務と変更量が妥当か | pass | 2 loopを既存field台帳の1 loopへ縮小しhelperを追加しない |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 非対象入力を誤許可しないか | pass | contract全体削除、未知role/field、型不正、tier、非roleを直接実測 |
| 失敗経路 | gate不明・失敗を安全に扱うか | pass | routing不成立のラウンド1を停止し、適合するClaude reviewerへ再割当した |
| 境界値 | 全体削除とfield差分を混同しないか | pass | 全体削除の先行分岐は不変で直接weakenedを観測 |
| 悪用 | candidate自己許可が成立しないか | pass | `development.json`とrouting/conformance assetの差分なし |
| 安全性 | authority・identity・Zero Trust | pass | Claude reviewerはprovider指定と実装者からの独立性を満たし、candidate自己許可もない |
| データ損失 | 永続データを損なわないか | not-applicable | 純粋分類でmigration・保存なし |
| ロールバック | 一体で復旧できるか | pass | 5 fileのimplementation commitをrevertし、PR-B/#1051/releaseを停止 |
| 範囲漏れ | 呼出し元・仕様・配布物を覆うか | pass | compile対象source、直接SCN、2仕様、package checkを監査 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| H-01 | High | ラウンド1でStep 10 reviewerのprovider routingが確定入力契約と不一致 | project choiceと03 T05はClaude、実担当はCodexだった | Step 10承認 | Claude Opus 5・effort highが同じH_implを独立review | resolved | なし |
| F1 | Low | `roleContracts`は差分・型・policy validationで参照されるが、`validateRoleOperation`のruntime consumerがない | `rg -n roleContracts src bin`、`rg validateRoleOperation src bin scripts test`。製品側は`src/domain/role.ts`の定義1件、ほかはtest | role宣言の実効性 | #1047が強制点を所有し、強制前条件を維持 | valid / accepted | PR-Aはruntime enforcementを主張しない |
| F2 | Low | role強制前の復元条件を後続へ明示する必要がある | Issue #1047 commentに同条件と#1058参照が存在 | 後続Issue | 既存記録を正本として外部更新しない | resolved | なし |
| F3 | Low | feature本文の4 stepに対しraw targeted出力が6 steps | featureのGiven/When/Then/And 4件、`test/support/world.ts`のBefore/After各1 hook | test証拠の計数 | Cucumberがhookをstepsへ含めるため1 scenario / 6 stepsが正しい | false-positive | なし |
| F4 | Low | 信頼境界仕様に弱化・許可行が二重に存在する | `docs/specs/10_セキュリティ/01_信頼境界.md`の表 | 既存仕様 | ownerが指定したline 17のrole分類だけを更新し、既知の重複行は本scopeで変更しない | out-of-scope | 別変更で整理可能 |
| F5 | Low | testがweakened entryの`path: reason`直列化に`split(": ")`で依存する | `test/steps/role-tier.steps.ts`のtier assertion | 将来の出力構造変更 | 現行string契約では受容し、将来weakenedを構造化するときの破壊点として記録 | valid / accepted | 出力構造変更時にtest同期が必要 |
| F6 | Low | 空配列化はallowed、field key削除はweakenedとなる非対称がある | validatorは4 fieldを必須string arrayとして検証し、classifierはvalid inputの差分をallowedへ送る | role field分類 | schema key必須性を維持する意図どおりの設計判断 | valid / accepted | schema必須契約の維持が前提 |
| F7 | Low | 初回要約にlint・format・source品質・test決定性の個別記録がなかった | sandbox外`verify:distribution`の実出力 | gate証拠 | 本artifactのrisk比例gateと§7へ各段成功を記録 | resolved | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。肯定5観点、敵対8観点、全5 file、AC-01〜04、配布・仕様・routingを確認した。
- 指摘を確定した: H-01 High 1件。product findingは0件。
- 次ラウンド対象のCritical/High: H-01、適合providerによるreviewとその隣接証拠。

### ラウンド2

- 未解決Critical/High: なし。Claude Opus 5 reviewerはapproved、Critical/High 0、product code変更要求0。
- 修正差分: product差分なし。H-01を適合providerの独立reviewでresolvedとし、F1〜F7を分類した。
- 修正で触れた隣接範囲: routing、runtime consumer、#1047/#1058、Cucumber hook計数、既存仕様重複、test直列化、schema必須性、gate実測。
- 既承認・未変更範囲を再走査していない: はい。Claudeはinline材料だけを使いtoolsなし・非永続で、製品差分を変更していない。

### ラウンド3

- ラウンド3: not-applicable（ラウンド2で収束したため実施せず）。
- 任意の危険範囲を安全側へ縮小した結果: PR-Aをexact 5 fileに維持し、runtime enforcementは#1047へ残した。
- 同じ範囲の予算を自動更新していない: pass。
- AIによる最終裁定: not-applicable。

## 7. テスト結果

runnerは`cucumber-js`、Gherkin dialectは`en`。sandbox内full gateのEPERM結果は製品判定に用いず、sandbox外で再実行した。

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `git diff --check`、docs/Gherkin/trace/architecture/conformance | 5 file・全trace | 全件 | 0 | 0 | pass |
| unit | `npm test -- --name "SCN-UNIT-CHOICE"` | 8 | 8 | 0 | 0 | pass |
| integration（統合） | `npm test -- --name "SCN-INT-ROLE-003"` | 1 | 1 | 0 | 0 | pass |
| e2e | sandbox外`npm run verify:distribution`内のfull `npm test` | 1042全層の一部 | full集計へ包含 | 0 | 0 | pass |
| 型・既存一式・配布物 | project quality、lint、format、typecheck、source品質、full test、build、docs、Gherkin形式・test決定性、trace、architecture、conformance、package check | 1042 scenarios / 5524 steps | 1042 / 5524 | 0 | 0 | pass。`test:format`がGherkin形式とtest決定性を検査。`audit:check`はPhase A後に実行 |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/project-choice-diff.ts` | 入る（`files`の`dist/src/`へcompile） | valid role contractの4 field差分をallowed分類する |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | 入らない | repository内の信頼境界仕様を同期 |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | 入らない | repository内REQ-SQ-003を同期 |
| `test/features/integration/role-tier.feature` | 入らない | 既存acceptance scenarioを同期 |
| `test/steps/role-tier.steps.ts` | 入らない | 既存fixture・期待値を同期 |

判断: 配布物を更新した
根拠: compile対象sourceの外部観測可能な分類が変わり、配布packageの`dist/src/`へ反映される。repository仕様2件も成立中の契約へ同期し、package contents検査は269件で成功した

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | Claude Opus 5 reviewerのcurrent session応答あり。immutable GitHub reviewはPR未作成のためなし |
| reviewerがPR author・実装commit authorと異なる | はい。Claude reviewerは実装者Codexと別provider/identity/context。PR authorは未観測 |
| 観測したreview commentとapprovalの件数 | agent review 1件 / approved 1件。GitHub review 0件 |

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | 該当なし。通常のClaude reviewer経路が成立 |
| 観測値 | Claude reviewer 1件、approved 1件、Critical/High 0件、product code変更要求0件 |

## 10. 仕様整合性

- 判定: updated。
- 更新した仕様: 信頼境界の弱化一覧、REQ-SQ-003。
- ドメイン用語台帳の追跡: pass。TERM-ASC-002/004/005の既存語を参照し、台帳差分なし。
- 未定義語・重複・根拠なしの意味変更: pass。
- 要件・変更・SCN・テストの追跡: pass。FR-01/02→AC-01〜04→SCN-INT-ROLE-003 / 隣接証拠→5 file。
- `no-spec-impact`: not-applicable。仕様更新あり。
- UI・token: not-applicable。非UI CLI内部変更。

## 規範の引用

一次資料 #1054 issuecomment-5459725185:

> **`development.json` を含めない。**
>
> **schema/type検証と未知field拒否は残す**
>
> 上記分類を直接検証している既存テスト・fixture の role差分の期待値だけを更新

03 実装計画:

> T05 | reviewer | role-log/tmp、肯定・敵対review | review・finding・independence | critical | claude、project_default/high | reviewer不在なら停止

引き継ぎ指示:

> 自動releaseは停止したまま。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。H-01はresolved。
- Medium/Lowの記録: F1〜F7。F1/F4/F5/F6はacceptedまたはout-of-scope、F2/F7はresolved、F3はfalse-positive。
- 判定: approved。
- 新しい権限が必要な事項: なし。本reviewはPR・merge・release・cleanupを認可しない。
- 残存リスク: role実行時強制は未結線で#1047が所有する。testの`path: reason`依存とschema key必須性は将来契約変更時に再評価する。
- 次に許可される操作: artifactだけをPhase A commitにし、H_impl..H_final、audit、packageを検証した後、coordinatorがStep 10を記録する。
- 次回の再開地点: Step 11 PR作成。push・PRはfinalizer authorityで実行し、merge・releaseは別authorityとする。
