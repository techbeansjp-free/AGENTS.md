# 課題1404 Issue着手Project反映 実装レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1404 実装 |
| 比較基点 | `c004eb8d13050f2373b9ba9060c7417d3cfa5a70` |
| H_impl | `bb6ebe82acd40d9b99b6951ab7e679d461df717c` |
| ラウンド数 | 3（初回指摘、修正確認、PR #1405外部レビュー取り込み） |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260916_061307_GitHub-Issue着手時にProjectへ自動追加しIn-progressへ移動する` |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`、`docs/specs/10_セキュリティ/01_信頼境界.md` |
| 成果物行数 | 30 files、1685 insertions、7 deletions |
| 縮小の先行評価 | GitHubの自動追加だけでは着手Status同期、権限・identity検証、部分失敗復旧を満たさないため、optional policyと専用CLIへ限定した |
| 実施者・日時 | implementer: Codex root、reviewer: context-isolated review_1404、2026-09-16T08:00:00+09:00 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical相当 | local context-isolated agent | high reasoning | blocker時は修正後roundへ継続 | implementerと別context、対象差分変更なし |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1404 staging 00〜03 | AC-01〜06、INV-01〜05 | staging |
| 差分 | base..H_impl | 30 paths、1685 insertions、7 deletions | Git |
| テスト | 対象Cucumber、`npm test`、`npm run verify:distribution` | 対象15/15、全体2067中2051 pass・16 skip・失敗0 | 実行出力 |
| 仕様 | 用語・要件・機能・外部IF・security・運用・trace・変更履歴 | updated | tracked文書 |
| review session | `f39eb273ca17c8c7eac9c5f8218a8410ede62578b8ea3bbcb2dee28d9e7e35d4` | round 3 converged、digest `6f6c2cae937573d179a4664c1290791ff9a7d2a0a2b816a6c44f7ba66b25faf6` | 保存session |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい
- `H_impl`固定後は本review artifactだけを追加する: はい
- provider上のPR/CI証拠はPR作成後のPhase Bへ保存する: はい

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | M | package | schema docs | policy利用案内 | schemaへ参照 | AC-04 | optional設定を外せる | pass |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | M | package | schema | manifest契約 | runtime validatorと整合 | AC-04 | 未設定は互換 | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | package | schema | monolith契約 | runtime validatorと整合 | AC-04 | 未設定は互換 | pass |
| `.agent-skill-chain/skills/step-04-issue-sync/SKILL.md` | M | workflow | skill | 着手操作の入口 | CLIのみを呼ぶ | AC-01〜03 | preview可能 | pass |
| `docs/PROJECT_MANAGEMENT.md` | M | project | operations docs | Project運用入口 | package機構を参照 | AC-01〜03 | 二段階activation | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | specs | terminology | TERM-ASC-120 | 要件へ追跡 | AC-01 | 既存語非変更 | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | specs | requirements | REQ-GH-006索引 | 詳細要件へ参照 | AC-01〜06 | scope限定 | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | specs | requirements | GitHub契約 | adapterへ追跡 | AC-01〜06 | Zero Trust | pass |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | M | specs | functional | 着手flow | CLIへ追跡 | AC-01〜05 | preview/apply分離 | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | specs | interface | CLI/GraphQL契約 | adapterへ追跡 | AC-01〜06 | exact identity | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | specs | security | authority境界 | policy/providerへ追跡 | AC-04 | fail closed | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | specs | operations | 失敗・再開運用 | CLI結果へ追跡 | AC-05 | read-back再開 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | specs | trace | SCN対応 | 要件からtestへ接続 | AC-01〜06 | orphanなし | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | specs | history | Issue #1404判断 | 仕様変更を記録 | AC-01〜06 | activation分離 | pass |
| `docs/reviews/222_課題1404Issue着手Project反映レビュー.md` | A | project | evidence | 初回review artifact | ラウンド3で新H_implまでの差分に入る | AC-01〜06 | 証拠のみ、実行authorityなし | pass |
| `src/adapters/github.ts` | M | package | adapter | GitHub read/write境界 | domainへ観測値を返す | AC-01〜05・SCN-001〜015 | viewerCanUpdate・read-back | pass |
| `src/cli-usage.ts` | M | package | CLI contract | usage定義 | CLIから参照 | AC-06 | additive | pass |
| `src/cli.ts` | M | package | application | issue start orchestration | domain/adapterへ一方向 | AC-01〜06 | provider tip・staging再検証 | pass |
| `src/domain/enforcement.ts` | M | package | domain | trusted policy選択 | candidate依存なし | AC-04 | floorへ縮退 | pass |
| `src/domain/issue-start.ts` | A | package | domain | pure start plan | adapter非依存 | AC-01〜05 | 重複・権限拒否 | pass |
| `src/domain/policy.ts` | M | package | domain | issueProject検証 | schemaと整合 | AC-04 | legacy・不正値拒否 | pass |
| `src/types.ts` | M | package | types | policy型 | domainから参照 | AC-04 | optional | pass |
| `test/features/integration/issue-project-start.feature` | A | test | integration/E2E | 15反例 | step定義へ接続 | SCN-001〜015 | write回数検証 | pass |
| `test/steps/issue-project-start.steps.ts` | A | test | fixture | fake GitHubとassertion | product非依存 | SCN-001〜015 | 隔離Git・SCN-001〜015 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい（30 paths）
- package層へproject固有値、project層へ汎用機構を混入していない: はい。Project #8のactivation値は後続PRへ分離
- 修正13pathと隣接依存を第2ラウンドで再監査した: はい

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-ACTIVATION-001 | 機構追加とProject #8設定を同一PRにするとbase validatorが未知fieldを拒否 | delivery | 二段階delivery | 本PRは機構のみ、merge後にactivation PR | candidate policyを含めず全gate成功 | 03計画・Issue body | pass |
| DISC-TERM-120 | 既存用語IDと衝突 | terminology | ID変更 | TERM-ASC-120へ確定 | 用語・履歴・trace照合 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-GHPROJ-001 | Project追加とStatus更新 | pass | pass | 対象15 scenarios |
| AC-02 | SCN-INT-GHPROJ-002 | 着手済みno-op | pass | pass | mutation 0件 |
| AC-03 | SCN-E2E-GHPROJ-003・006 | 未設定互換・preview | pass | pass | provider/write 0件 |
| AC-04 | SCN-INT-GHPROJ-004・007〜015 | trusted authority・曖昧性・race・staging境界拒否 | pass | pass | write/provider call 0件反例 |
| AC-05 | SCN-INT-GHPROJ-005 | 部分失敗後のread-back再開 | pass | pass | add再送なし |
| AC-06 | 全SCN・usage/check | schema/CLI/docs/trace | pass | pass | trace orphan 0 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | GitHub write authorityを扱う | provider tip、repository、Project権限、identityをwrite前検証 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 部分失敗から再開する | operation/read-backとreconciliation-requiredを出力 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | GUI・画面・対話componentを持たないCLI契約 | usageと構造化JSONを検証 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚UIを追加しない | code/CLIのみ |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | Project追加・In progress・no-op | pass | 15 scenarios |
| 価値 | 着手時の看板更新忘れを防ぐ | pass | Step 4から専用CLIへ接続 |
| 実現可能性 | GitHub Projects v2権限とGraphQL | pass | repository/default tip/Project権限を実行時観測 |
| 整合性 | schema、code、dist、docs、trace | pass | 配布ゲートのartifact監査前工程が合格 |
| 保守性 | planとprovider境界を分離 | pass | `planIssueStart`はpure、GitHub I/Oはadapter |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 未設定、重複、race、tip不一致、symlink祖先 | pass | SCN-003・004・007〜015 |
| 失敗経路 | mutation失敗・部分完了 | pass | read-back後だけ成功、未確定は停止 |
| 境界値 | 空白、不正設定、pagination | pass | runtime/schema、SCN-008・009 |
| 悪用 | symlink、candidate自己認可 | pass | canonical staging guard、SCN-007・013・015 |
| 安全性 | provider tip、Project write authority | pass | 第2roundでH01/H03解消 |
| データ損失 | 削除・上書き | pass | add/setのみ、削除なし |
| ロールバック | optional機構とactivation分離 | pass | policy除去・revert可能 |
| 範囲漏れ | source/dist/docs/test/trace | pass | 30path個別監査 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-1404-H01 | High | local refをprovider tipへ束縛していない | round 1 | trusted policy | provider authority再観測と固定commit load | resolved | なし |
| REV-1404-H02 | High | stagingのsymlink祖先・非直下を許す | round 1 | staging identity | canonical guard共有 | resolved | SCN-013と015で分岐を独立検証 |
| REV-1404-H03 | High | Project write権限と直前状態を未確認 | round 1 | GitHub mutation | viewerCanUpdateと直前再inspect | resolved | provider側同時変更はfail closed |
| REV-1404-M01 | Medium | schema/runtimeの空白受理差 | round 1 | policy authoring | schema patternを修正 | resolved | NFCはruntime検証 |
| REV-1404-M02 | Medium | 部分失敗出力がmessage中心 | round 1 | 運用観測 | 現scopeではread-backと再開契約を維持 | valid・record-only | JSON診断拡張余地 |
| REV-1404-M03 | Medium | trust/race反例test不足 | round 1 | tests | SCN-011〜015追加 | resolved | なし |
| CR-4021116880 | Medium | 機能仕様のSCN-011〜014列挙漏れ | PR #1405 inline review | 仕様追跡 | 007〜015へ更新 | resolved | なし |
| CR-4021116896 | Medium | 変更履歴のSCN-011〜014列挙漏れ | PR #1405 inline review | 変更追跡 | 007〜015へ更新 | resolved | なし |
| CR-4021116905 | Medium | 非直下fixtureでsymlink祖先分岐を検証できない | PR #1405 inline review | staging反例test | SCN-013と015へ分割 | resolved | なし |
| CR-DOCSTRING | Low | Docstring Coverage 5.88% | PR #1405 CodeRabbit概要 | repository全体 | 現行quality/CI gate外でACと無関係のため変更しない | false-positive / out-of-scope | policy化する場合は別Issue |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。Critical 0、High 3、Medium 3
- 指摘を確定した: round digest `8aac060c7fff6cdc4a0a69bb30294da79470cbb8cbaf67b8b82975256066122b`
- 次ラウンド対象のCritical/High: REV-1404-H01、H02、H03

### ラウンド2

- 未解決Critical/High: なし
- 修正差分: 13 files、211 insertions、33 deletions
- 修正で触れた隣接範囲: schema、domain、GitHub adapter、CLI、dist、trace、integration test
- 既承認・未変更範囲を再走査していない: はい。固定diffと隣接範囲へ限定
- round digest: `99014c5f8ff8c57e1a9a6dfaa66eaf46ab0c5ebc443bed71e19fe4be3e2948ea`

### ラウンド3

- 契機: PR #1405のCodeRabbit指摘3件とdocstring coverage警告を、約定どおり鵜呑みにせず再評価した
- 判定: inline 3件は妥当で修正済み。docstring coverageは現行repository gate外かつ本PRのAC外のためfalse-positive / out-of-scope
- 固定差分: 旧review artifact 1 pathと是正5 paths。実装者と別contextのreviewerがexact `bb6ebe82acd40d9b99b6951ab7e679d461df717c`をread-only再検分し、新規finding 0件でapproved
- 未解決Critical/High: なし
- round digest: `6f6c2cae937573d179a4664c1290791ff9a7d2a0a2b816a6c44f7ba66b25faf6`

## 7. テスト結果

- 実行したcommandの一覧: 対象Cucumber、`npm run lint -- --quiet`、`npm run format:check`、`npm run typecheck`、`npm run test:format`、`npm run trace:check`、`npm test`、`npm run verify:distribution`
- 対象: 15 scenarios、75 steps、全件pass
- 全layer: 2067 scenarios（2051 pass、16 skip）、10840 steps（10790 pass、50 skip）、失敗0
- 配布ゲート: project quality、lint、format、typecheck、source、全test、build、docs、Gherkin、trace、architecture、conformance 87/87までpass。artifact確定前のauditだけ旧H_impl検出で停止し、本artifact確定後に再実行する
- runner・Gherkin方言: cucumber-js、日本語説明・英語keyword

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | 入る | optional `issueProject`の利用案内 |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | 入る | manifest schemaへ`issueProject`追加 |
| `.agent-skill-chain/schemas/project-policy.schema.json` | 入る | monolith schemaへ`issueProject`追加 |
| `.agent-skill-chain/skills/step-04-issue-sync/SKILL.md` | 入る | Issue同期後の着手操作を追加 |
| `dist/src/` | 入る | build済みCLI・domain・adapterを更新 |
| `src/adapters/github.ts` | 入る | Projects v2 read/writeと権限観測を追加 |
| `src/cli-usage.ts` | 入る | `issue start` usageを追加 |
| `src/cli.ts` | 入る | `issue start` orchestrationを追加 |
| `src/domain/enforcement.ts` | 入る | trusted `issueProject`伝播を追加 |
| `src/domain/issue-start.ts` | 入る | 着手planを追加 |
| `src/domain/policy.ts` | 入る | policy検証を追加 |
| `src/types.ts` | 入る | policy型を追加 |
| `docs/**`・`test/**` | 入らない | repository内の運用・追跡・検証 |

判断: 配布物を更新した

根拠: source、生成済みdist、schema、CLI usage、Step 4 skillを同時更新し、package検査対象へ含めた。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい（別session/contextで3ラウンド実施） |
| reviewerとimplementerのidentity・context比較 | implementer `/root` と reviewer `/root/review_1404` は別context。reviewerは固定HEAD 11107669、3b108081、bb6ebe82をread-only検分 |
| reviewerが対象差分を変更していないこと | はい（変更pathなし） |

外部Claude advisorはrepository情報の外部送信承認がないため使用せず、情報も送信していない。formal reviewは上記context-isolated reviewerが実施した。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: 用語、要件一覧、外部連携要件、workflow、CLI/GitHub契約、信頼境界、運用、trace、変更履歴
- ドメイン用語: TERM-ASC-120から実装・testへ一方向追跡できる
- 未定義語・重複定義・表記揺れ: なし
- 要件・変更・SCN・testの追跡: REQ-GH-006 / AC-GH-006からSCN-001〜015へ接続、orphan 0
- UI・トークン: GUIなし、非適用

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: M02をrecord-only。M01/M03とCodeRabbit inline 3件は修正済み。docstring coverageはfalse-positive / out-of-scope
- 判定: approved
- 新しい権限が必要な事項: PR作成。merge、Issue close、Project #8 policy activationは本PRの権限外
- 残存リスク: Project item 100件超は安全拒否。部分失敗の構造化診断拡張余地。実Project #8への設定追加は機構merge後のactivation PRが必要
- 次に許可さる操作: 本artifactだけをH_impl後にcommitし、post-PR intakeのStep 10を再記録してPR bindingを再固定
- 次回の再開地点: H_final、review session round 3、PR #1405のreanchorとreview thread解決
