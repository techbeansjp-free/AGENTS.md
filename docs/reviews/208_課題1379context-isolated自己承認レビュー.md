# 04 レビュー

## 0. レビュー識別情報

| 項目                      | 内容                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| 対象                      | Issue #1379 の実装・テスト・仕様                                                     |
| ラウンド                  | 3                                                                                    |
| 対象SHA・文書ダイジェスト | `05ce9ee3d89b2d46d2b4124596ddaf5ab8adf44c`                                           |
| 比較基点 | `2f4cc0721a444ddeee143dfc3ae4d0a309751d4e` |
| H_impl | `05ce9ee3d89b2d46d2b4124596ddaf5ab8adf44c` |
| 対象差分                  | 30 path、794 insertions、120 deletions                                               |
| 対象外                    | 比較基点に存在し変更されていない範囲                                                 |
| 残り予算                  | 0ラウン（承認に収束）                                                                |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260913_162706_context-isolated-review-approval |
| 仕様の所有箇所            | ワークフロー要件、CLI/GitHub契約、信頼境界                                           |
| 成果物行数                | 794行追加、120行削除                                                                 |
| 縮小の先行評価            | 既存session bindingとartifact validatorを再利用し、mode別approval選択だけに限定      |
| 実施者・日時              | reviewer、2026-09-13T18:40:00+09:00                                                  |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠                      | 必要model tier | provider欄 | model設定欄              | fallback欄                | 独立性証拠欄・非変更証拠                 |
| ------------------ | ----------------------------- | -------------- | ---------- | ------------------------ | ------------------------- | ---------------------------------------- |
| reviewer           | 肯定・敵対review、finding分類 | critical       | Claude     | trusted recommended high | 未解決Critical/Highで停止 | implementerと別context、candidate変更0件 |

## 1. 入力証拠

| 証拠               | 参照先                        | 観測結果                                                                                                                                                              | 根拠種別        |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 要求・受け入れ条件 | staging                       | ISSUE-1379、AC-112-01..04、INV-01..04                                                                                                                                 | staging/session |
| 差分               | base..H_impl                  | 30 path                                                                                                                                                               | Git             |
| テスト             | Round3 exact-head             | 対象3 scenarios / 15 steps成功、trace orphan 0                                                                                                                        | Cucumber/gate   |
| 仕様               | 要件・CLI契約・信頼境界・追跡 | updated                                                                                                                                                               | 既存文書        |
| commit前candidate  | Git index                     | H_impl `05ce9ee3d89b2d46d2b4124596ddaf5ab8adf44c`                                                                                                                     | Git             |
| Phase A artifact   | 本file                        | H_impl後の証拠専用commitで固定予定                                                                                                                                    | Git             |
| review session     | `review-session.json`         | session `bd9f758070935c7fb7dc1ea047d6d25d8bafffdb04f10a0c275c5a425634a4f3`、round digest `1bbdf9c6f39a2762483554fca7a76096dfee79fc162f1be96c60177e4f8ba4f5`、収束済み | 耐久session     |

- authority graph: trusted policy→session/round→tracked artifact→exact HEAD→merge authority。candidate自己申告を含まない。
- H_impl/H_final: artifact commit後にaudit gateでancestorとartifact-only差分を検証する。
- reviewer独立性: 別contextがexact H_implを対象に3 roundを実施し、candidate差分を変更していない。
- Phase B: PR作成後に`review evidence`とdelivery stateへ追記する。
- 既定branch追随: 対象外（review session中に取り込みなし）。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
| --------------------------------------------------------------- | -------- | --------------- | ------------ | ------------------------ | ------------------------- | ---------------------- | --------------------- | -------- |
| `.agent-skill-chain/docs/00_運用ポリシー.md`                    | M        | policy owner    | docs         | review modeとauthority   | Review Evidence→Delivery  | INV-04                 | actor-independent維持 | pass     |
| `.agent-skill-chain/docs/01_開発ワークフロー.md`                | M        | workflow owner  | docs         | Step 10/11契約           | workflow→delivery         | AC-112-01..04          | exact-head維持        | pass     |
| `.agent-skill-chain/schemas/delivery-state.schema.json`         | M        | delivery owner  | schema       | authority evidenceの保存 | schema→domain state       | AC-112-04              | closed schema         | pass     |
| `.agent-skill-chain/skills/step-11-pr/SKILL.md`                 | M        | workflow owner  | skill        | Step 11操作authority     | docsを参照                | INV-04                 | explicit authorize    | pass     |
| `.agent-skill-chain/templates/issue/04_レビュー.md`             | M        | review owner    | template     | Phase A証拠欄            | artifact contract         | AC-112-02              | candidate-only拒否    | pass     |
| `docs/specs/01_システム概要/02_用語・略語.md`                   | M        | spec owner      | terminology  | TERM-ASC-112             | requirementsを参照        | AC-112-01..04          | mode混同防止          | pass     |
| `docs/specs/02_要件/00_要件一覧.md`                             | M        | spec owner      | index        | REQ-WF-112索引           | requirementsを参照        | REQ-WF-112             | trace gate            | pass     |
| `docs/specs/02_要件/01_ワークフロー要件.md`                     | M        | spec owner      | requirements | mode別approval           | policy→workflow           | FR-112 / NFR-112       | fail-closed           | pass     |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M        | interface owner | CLI contract | authorize/provider観測   | CLI→domain/provider       | AC-112-01              | write authority観測   | pass     |
| `docs/specs/10_セキュリティ/01_信頼境界.md`                     | M        | security owner  | security     | quality/operation境界    | trusted policy anchor     | INV-01..04             | candidate-only拒否    | pass     |
| `docs/specs/15_要件追跡/00_追跡表.md`                           | M        | trace owner     | trace        | AC→SCN→実装              | verified-by               | AC-112 / SCN-019..021  | orphan 0              | pass     |
| `docs/specs/15_要件追跡/01_変更履歴.md`                         | M        | trace owner     | history      | Issue #1379の理由        | specを参照                | REQ-WF-112             | 旧契約差分保存        | pass     |
| `src/cli-usage.ts`                                              | M        | CLI owner       | adapter      | merge usage              | CLI→domain                | AC-112-01              | 明示操作              | pass     |
| `src/cli.ts`                                                    | M        | CLI owner       | application  | evidence配線             | adapter→domain            | AC-112-01..04          | digest/HEAD不一致停止 | pass     |
| `src/domain/delivery-state.ts`                                  | M        | delivery owner  | domain       | durable authority state  | domain内                  | AC-112-04              | intentから再開        | pass     |
| `src/domain/delivery.ts`                                        | M        | delivery owner  | domain       | approval数/authority     | policy/evidenceを入力     | AC-112-01/03           | provider call前停止   | pass     |
| `src/domain/review-artifact.ts`                                 | M        | review owner    | domain       | semantic approval検証    | artifact単体は非authority | AC-112-02/04           | placeholder拒否       | pass     |
| `test/features/e2e/workflow-step-enforcement-cli.feature`       | M        | test owner      | e2e          | 同一actor到達性          | CLI観測                   | SCN-E2E-WFSTEP-057     | exact digest assert   | pass     |
| `test/features/integration/delivery-finalize.feature`           | M        | test owner      | integration  | count/攻撃反例           | delivery観測              | SCN-INT-MERGE-019..021 | provider call 0/1     | pass     |
| `test/features/unit/review-artifact-validation.feature`         | M        | test owner      | unit         | artifact正負例           | validator観測             | SCN-UNIT-REVARTVAL-004 | placeholder拒否       | pass     |
| `test/features/unit/review-policy-package.feature`              | M        | test owner      | unit         | audit回帰                | gate観測                  | AC-112-02/04           | H_impl/H_final境界    | pass     |
| `test/steps/delivery-finalize.steps.ts`                         | M        | test owner      | adapter      | delivery fixture         | feature→domain            | SCN-019..021           | actor/count固定       | pass     |
| `test/steps/review-artifact-validation.steps.ts`                | M        | test owner      | adapter      | artifact反例fixture      | feature→validator         | SCN-REVARTVAL-004      | invalidを拒否         | pass     |
| `test/steps/unit.steps.ts`                                      | M        | test owner      | adapter      | audit fixture            | feature→gate              | audit scenarios        | generated/tracked分離 | pass     |
| `test/steps/workflow-step-enforcement.steps.ts`                 | M        | test owner      | adapter      | exact binding反例        | feature→CLI               | SCN-020/057            | 改竄拒否              | pass     |

- 差分path集合と表は一致（決定的生成物`dist/`は個別監査対象外）。
- 責務越境なし。Round2/3でfinding修正pathと隣接依存を再確認した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID       | 事実                                         | 影響                          | 契約変更 | 対処                            | Verification Evidence | 仕様反映 | 判定 |
| ------------ | -------------------------------------------- | ----------------------------- | -------- | ------------------------------- | --------------------- | -------- | ---- |
| DISC-1379-01 | #1317 E2Eは同一PR authorを検証していなかった | context-isolatedのmerge到達性 | なし     | exact bindingをmerge gateへ接続 | SCN-057/019/020       | updated  | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID     | SCN ID                      | 実装                       | テスト結果 | 判定 | 証拠                                     |
| --------- | --------------------------- | -------------------------- | ---------- | ---- | ---------------------------------------- |
| AC-112-01 | SCN-057 / SCN-019           | approval selector          | pass       | pass | formal 1件 + provider approval           |
| AC-112-02 | SCN-REVARTVAL-004 / SCN-020 | exact binding              | pass       | pass | untracked・HEAD・digestセsession改竄拒否 |
| AC-112-03 | SCN-051 / SCN-021           | actor-independent selector | pass       | pass | stable actor分離維持                     |
| AC-112-04 | SCN-057                     | delivery-state reviewId    | pass       | pass | latestRoundDigestと一致                  |

### 2.2 開発考慮事項の適用判定（必須）

| ID               | 考慮事項                      | 判定           | 理由                                          | 実装・検証証拠      |
| ---------------- | ----------------------------- | -------------- | --------------------------------------------- | ------------------- |
| DC-PRIVACY       | Privacy/Security by Design    | applicable     | merge authorityの信頼境界を変更               | INV-01..04、SCN-020 |
| DC-OBSERVABILITY | Secure Logging・Observability | applicable     | session/digest/authorityをdurable stateに記録 | SCN-057             |
| DC-UX            | Human-Centered UI/UX          | not-applicable | CLI権限判定でUI/a11y対象なし                  | UI sourceなし       |
| DC-TOKENS        | Design/Layout Token           | not-applicable | 視覚componentなし                             | token pathなし      |

## 3. 肯定的評価

| 観点       | 確認内容                          | 判定 | 根拠                         |
| ---------- | --------------------------------- | ---- | ---------------------------- |
| 正しさ     | mode別approval                    | pass | AC-112-01..04 BDD            |
| 価値       | 同一actorのcontext-isolated merge | pass | SCN-057                      |
| 実現可能性 | GitHub自己APPROVED制限を回避      | pass | tracked artifact/session     |
| 整合性     | spec/source/dist/test/trace       | pass | conformance/trace/build      |
| 保守性     | 既存validatorの合成               | pass | review-artifact/delivery/CLI |

## 4. 敵対的評価

| 観点         | 確認内容                                    | 判定 | 根拠                              |
| ------------ | ------------------------------------------- | ---- | --------------------------------- |
| 反例         | untracked・artifact-only・HEAD/digest不一致 | pass | SCN-020                           |
| 失敗経路     | assisted authority未成立                    | pass | explicit authorize + assert-write |
| 境界値       | requiredReviews=2                           | pass | SCN-019                           |
| 悪用         | candidate-only/placeholder                  | pass | provider call 0                   |
| 安全性       | actor-independent分離                       | pass | SCN-051/021                       |
| データ損失   | 検証失敗時の外部変更                        | pass | provider call 0                   |
| ロールバック | commit revert・durable intent再開           | pass | delivery state                    |
| 範囲漏れ     | CLI/domain/schema/dist/docs/spec/trace      | pass | 個別監査                          |

## 5. 指摘

| ID          | 重大度 | 内容                                     | 証拠     | 影響範囲 | 対応                    | 状態・分類 | 残存リスク |
| ----------- | ------ | ---------------------------------------- | -------- | -------- | ----------------------- | ---------- | ---------- |
| REV-1379-01 | High   | formal qualityとassisted authorityが混同 | Round1   | delivery | authorityを分離         | resolved   | なし       |
| REV-1379-02 | High   | requiredReviews&gt;1が到達不能           | Round1   | count    | formal + providerで合算 | resolved   | なし       |
| REV-1379-03 | High   | exact binding反例不足                    | Round1/2 | tests    | SCN-020/057強化         | resolved   | なし       |
| REV-1379-04 | High   | SCN-019..021が孤立                       | Round2   | trace    | feature/trace同期       | resolved   | なし       |

未解決の指摘なし。

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準: 確認済み。
- 確定finding: REV-1379-01..03。

### ラウンド2

- 未解決High: REV-1379-03/04。
- 修正差分: authority分離、review count、反例BDD、trace。

### ラウンド3

- 最終分類: REV-1379-01..04 resolved。
- 縮小結果: actor-independent/provider gateとassisted operation authorityを維持。
- 予算の自動更新: なし。
- AI最終裁定: approved、Critical 0 / High 0。

## 7. テスト結果

- 実行command: 対象Cucumber、`npm run test:unit`、`npm run conformance:check`、`npm run trace:check`、`npm run typecheck`、`npm run test:format`、`npm run docs:format`、`npm run package:check`、`git diff --check`。
- 合計: unit 1165 scenarios / 5987 steps成功、対象review 3 scenarios / 15 steps成功、conformance 87 scenarios / 468 steps成功。sandbox内の`spawnSync git/gh EPERM`は環境失敗と分離し、権限付き製品結果はGREEN。
- runner・Gherkin方言: Cucumber.js、ja、unit/integration/e2e。

## 8. 配布物影響

| 変更path                                                | 配布境界に入るか | 影響                                 |
| ------------------------------------------------------- | ---------------- | ------------------------------------ |
| `.agent-skill-chain/docs/00_運用ポリシー.md`            | 入る             | review/merge authority契約           |
| `.agent-skill-chain/docs/01_開発ワークフロー.md`        | 入る             | Step 10/11契約                       |
| `.agent-skill-chain/schemas/delivery-state.schema.json` | 入る             | delivery state schema                |
| `.agent-skill-chain/skills/step-11-pr/SKILL.md`         | 入る             | 配布skill                            |
| `.agent-skill-chain/templates/issue/04_レビュー.md`     | 入る             | review template                      |
| `dist/src/`                                             | 入る             | CLI/domain実行ロジック               |
| `src/cli-usage.ts`                                      | 入る             | compileされるCLI usage source        |
| `src/cli.ts`                                            | 入る             | compileされるCLI application source  |
| `src/domain/delivery-state.ts`                          | 入る             | compileされるdelivery state source   |
| `src/domain/delivery.ts`                                | 入る             | compileされるmerge authority source  |
| `src/domain/review-artifact.ts`                         | 入る             | compileされるreview validator source |

判断: 配布物を更新した

根拠: sourceから再buildした`dist/src/`と、配布対象の文書・schema・skill・templateを同一差分で同期した。

## 9. 独立reviewの成立

| 項目                                         | 内容                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい（implementerと別context） |
| reviewerとimplementerのidentity・context比較 | implementer `/root/context_isolated_approval`とは別のreviewer contextがsession `bd9f758070935c7fb7dc1ea047d6d25d8bafffdb04f10a0c275c5a425634a4f3`のexact candidate HEADを評価 |
| reviewerが対象差分を変更していないこと | はい（review JSON/sessionのみ、candidate path変更0件） |

## 10. 仕様整合性

- 判定: updated
- 更新仕様: REQ-WF-112、TERM-ASC-112、CLI/GitHub契約、信頼境界、追跡表、変更履歴。
- 用語の一方向追跡: 成立。未定義・重複定義・根拠なし変更・表記揺れ・置換先なし廃止はなし。
- 要件・SCN・テスト追跡: `trace:check` valid=true、orphan 0。
- no-spec-impact: 該当なし。
- UI・トークン: not-applicable。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: なし
- 判定: approved
- 新しい権限が必要な事項: push/PRはrepository write authority、mergeはrootが管理。
- 残存リスク: PR/CI exact-head証拠はPhase Bで観測する。
- 次に許可される操作: artifact-only H_final、Step 10、Step 11 PR。
- 次回の再開地点: Step 11 PR作成前。
