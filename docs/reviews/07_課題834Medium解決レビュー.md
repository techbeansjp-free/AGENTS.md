# 課題834 Medium解決レビュー

## 判定

| 項目 | 値 |
|---|---|
| 状態 | approved |
| 比較基点 | `efa92cf677bf9ae3cf7000273628944d14c30a75` |
| H_impl | `7f5b83e7a12df3fd1c58aa2d6d0bfe23826cd993` |
| H_impl tree | `28ae0a6161096523d1f577696e3190f59c2f3128` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| merge | H_finalへ一致するCI、CodeRabbit、独立reviewの外部証拠確認後に許可 |

既存のM-RUNTIME-VALIDATION-001とM-TRUSTED-MIGRATION-001を解決した。外部JSONは構文解析時に`unknown`のまま保持し、入力種別別validatorで型と未知fieldを検証してからdomainへ渡す。品質契約はbase事前登録済みの版付き`staged` proposalとprotected対象のbefore/after SHA-256が完全一致する次PRだけを許可し、同一PRでの登録・利用、既存proposalの変更・削除、部分適用、version飛越しを拒否する。

## 開発考慮事項

| ID | 考慮事項 | 判定 | 理由 | 要求・確認証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 外部JSONとauthorityを扱うため、型偽装とcandidate自己承認をfail-closedにする必要がある | `src/adapters/json-input.ts`、trusted base validator、SCN-UNIT-QUALITY-006・009・010 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否理由、proposal ID、対象境界を機械可読なgate結果で観測する | `project:quality`、runtime error、BDD反例 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLI入力境界とrepository品質gateの変更で画面実装を含まない | 差分pathとproject choice |
| DC-TOKENS | Design System・Design/Layout Token契約 | not-applicable | 視覚component、layout、token変更を含まない | 差分pathとproject choice |

## Medium解決証拠

- M-RUNTIME-VALIDATION-001: generic `readJson<T>`と無条件castを除去し、JSON reader、CLI orchestration、入力種別別validatorを分離した。policy、assessment、spec review、operation、migration manifest/state、finalize、PR evidenceを検証し、review、trace、conformanceも`unknown`入力からfail-closedにする。
- M-TRUSTED-MIGRATION-001: `.github/trusted-quality-proposals.json`、`qualityContractVersion`、protected file・package fieldのSHA-256比較を追加した。baseに存在しないproposalは現在変更のauthorityにならず、有効化PRで新規proposalを同時登録できない。
- SCN-UNIT-QUALITY-008: base事前登録済みproposalと完全一致する強化を許可した。
- SCN-UNIT-QUALITY-009: candidateが同一PRで登録したproposalによる自己承認を拒否した。
- SCN-UNIT-QUALITY-010: 型不正・未知fieldを持つmanifest/stateを副作用前に拒否し、generic JSON castの再混入がないことを確認した。
- 全BDD: 276 scenarios、1564 steps、失敗0。lint、Prettier、TypeScript strict、source quality、build、文書、Gherkin、trace、architecture、package内容検査も合格した。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/project/choices/development.json` | M | repository maintainer | project | このrepositoryのruntime validation選択を明文化 | 汎用validatorを選択する片方向参照で逆流なし | FR-834-15、AC-834-17 | project choiceだけを戻せるが実装との乖離をgateが拒否 | pass |
| `.agent-skill-chain/project/conformance/bindings.json` | M | repository maintainer | project | 新しい反例SCNをI6へ拘束 | project証拠から汎用不変条件への片方向参照 | SCN-UNIT-QUALITY-008〜010、I6 | SCN欠落をconformanceで拒否 | pass |
| `.agent-skill-chain/project/rules/code-quality.json` | M | repository maintainer | project | repository固有の入力型・品質契約更新ruleを所有 | package文書へ固有値を逆流させない | FR-834-15、AC-834-17 | gateを維持したまま変更単位をrollback | pass |
| `.github/trusted-quality-proposals.json` | A | repository maintainer | project | 品質契約変更authorityの版付き台帳 | trusted baseからcandidateを検証する一方向で自己参照なし | TERM-ASC-010、SCN-UNIT-QUALITY-008〜009 | 既存entry変更・削除と同一PR利用を拒否 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | change owner | spec | trusted品質proposalの意味と反例を定義 | 実装語彙を仕様正本から参照 | TERM-ASC-010、FR-834-15 | 廃止時は置換先と適用版を記録 | pass |
| `docs/specs/10_セキュリティ/00_信頼境界.md` | M | security owner | spec | 品質validator自己変更の脅威と制御を追加 | trusted baseからcandidateへの一方向比較 | I4、I6、SCN-UNIT-QUALITY-009 | 未登録・部分一致・version飛越しを拒否 | pass |
| `docs/specs/11_非機能/00_品質要件.md` | M | quality owner | spec | 入力安全性と品質契約更新性を非機能要件化 | schema、runtime、CI証拠への一方向追跡 | AC-834-17、SCN-UNIT-QUALITY-006・008〜010 | fail-closedと段階rollbackを明示 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | operations owner | spec | proposal登録と有効化を二PRに分離 | candidateが現在のauthorityを所有しない | TERM-ASC-010、FR-834-15 | versionとprotected対象を前状態へ戻す | pass |
| `docs/specs/14_開発・品質/01_コーディング標準.md` | M | quality owner | spec | JSON readerと入力validatorの責務を規定 | reader、adapter、domainの一方向依存 | M-RUNTIME-VALIDATION-001、AC-834-17 | generic cast再導入を反例で拒否 | pass |
| `docs/specs/14_開発・品質/02_テスト標準.md` | M | quality owner | spec | runtime境界と二段階migrationの対テストを規定 | BDDから公開境界への片方向依存 | SCN-UNIT-QUALITY-008〜010 | 成功・自己承認・型不正を対で保持 | pass |
| `docs/specs/15_要件追跡/01_課題834追跡.md` | M | change owner | spec | AC-834-17へ実装とSCNを完全追跡 | 要件から実装・testへの一方向参照 | FR-834-15、I2・I4・I6・I10・I12 | rollback時も追跡欠落をgateで検出 | pass |
| `package.json` | M | repository maintainer | project | 品質契約versionとformatter対象を所有 | project validatorが読むだけで製品runtime依存なし | AC-834-17、SCN-UNIT-QUALITY-008〜009 | versionはproposal完全一致時だけ1段階更新 | pass |
| `scripts/check_project_quality.ts` | M | repository maintainer | project | trusted品質契約migrationを検証 | base scriptがcandidateをread-only検証しcandidate codeを実行しない | M-TRUSTED-MIGRATION-001、SCN-UNIT-QUALITY-006・008〜009 | exact hash不一致、自己登録、同時登録を拒否 | pass |
| `src/adapters/json-input.ts` | A | package maintainer | package | 外部JSONの構文解析と入力種別別narrowingを局所化 | CLIからadapter、domain型への一方向依存 | M-RUNTIME-VALIDATION-001、SCN-UNIT-QUALITY-010 | 未知field・型不正を副作用前に拒否 | pass |
| `src/cli.ts` | M | package maintainer | package | CLIをorchestrationへ戻し専用readerを呼ぶ | CLIからadapter・domainへの一方向依存で循環なし | AC-834-17、SCN-UNIT-QUALITY-010 | invalid入力時はwrite前に停止 | pass |
| `src/domain/conformance.ts` | M | package maintainer | package | conformance evidenceをunknownから検証 | domain内で完結しCLI型を参照しない | I6、SCN-UNIT-CONFORMANCE群 | 未知fieldと不正配列を拒否 | pass |
| `src/domain/review.ts` | M | package maintainer | package | review evidenceのtop・nested構造を検証 | domain内で完結しadapterへの逆依存なし | FR-834-11、review既存SCN | 不正入力を非承認結果へ縮退 | pass |
| `test/features/unit/source-quality.feature` | M | repository | evidence | Medium 2件の成功・反例をGherkin化 | 公開CLI・project gateへの片方向依存 | SCN-UNIT-QUALITY-008〜010 | 自己承認と不正入力の再発を拒否 | pass |
| `test/steps/risk-policy.steps.ts` | M | repository | evidence | migration E2E失敗時の操作別診断を改善 | domain変更なしで観測情報だけを追加 | SCN-E2E-RISK-006 | stdout・stderrを秘密fixtureなしで表示 | pass |
| `test/steps/unit.steps.ts` | M | repository | evidence | proposalとruntime JSONの隔離fixtureを実装 | temp rootから公開checker・CLIへの片方向依存 | SCN-UNIT-QUALITY-006・008〜010 | 実repositoryを書かず一時directoryをcleanup | pass |

Gitの`efa92cf677bf9ae3cf7000273628944d14c30a75..7f5b83e7a12df3fd1c58aa2d6d0bfe23826cd993`に含まれる20 pathと表の20行が完全一致する。package、project、spec、evidenceの所有境界に逆流はなく、新規dependency cycleもない。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ・整合性 | pass | 仕様、project rule、runtime、CI、BDDがAC-834-17へ一致 |
| 保守性 | pass | JSON境界をadapterへ分離しCLIの責務を縮小 |
| 反例・境界値 | pass | 型不正、未知field、未登録、部分一致、同一PR自己承認を拒否 |
| authority・安全性 | pass | trusted baseの既存proposalだけが次変更を承認可能 |
| データ損失・rollback | pass | validatorはread-onlyで、proposalにrollbackを必須化 |
| 範囲漏れ | pass | policy、manifest/state、review、trace、conformance、finalize、PR evidenceを確認 |

## 指摘

| ID | 重大度 | 内容 | 証拠 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|
| M-RUNTIME-VALIDATION-001 | Medium | generic JSON castで入力型を偽装できた | 旧`src/cli.ts`とSCN-UNIT-QUALITY-010 | unknown readerと入力種別別validatorへ統一 | resolved | なし |
| M-TRUSTED-MIGRATION-001 | Medium | byte完全一致だけでは品質強化を通常更新できなかった | 旧project品質gateとSCN-UNIT-QUALITY-008〜009 | base事前登録済み版付きproposalの二段階migrationを実装 | resolved | proposal内容の妥当性は独立reviewが判断 |

新規のCritical、High、Medium、Low findingはない。

## テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| unit・integration・e2e | `npm test` | 276 scenarios、1564 steps | 1564 | 0 | 0 | pass |
| Medium反例 | Cucumber name filter | 4 scenarios、21 steps | 21 | 0 | 0 | pass |
| 型・lint・format・source | `project:quality`、`lint`、`format:check`、`typecheck`、`source:check` | source 48 files | 5 gates | 0 | 0 | pass |
| build・配布物 | `npm run build`、`npm run package:check` | package 191 files | 2 gates | 0 | 0 | pass |
| 文書・追跡・構造 | `docs:format`、`test:format`、`trace:check`、`architecture:check` | 全対象 | 4 gates | 0 | 0 | pass |

## 仕様整合性と総合判定

- 仕様影響: updated。
- 更新先: 用語、信頼境界、品質要件、運用設計、コーディング標準、テスト標準、課題834追跡。
- 要件・変更・SCN・テストはAC-834-17とSCN-UNIT-QUALITY-006・008〜010で追跡できる。
- UI・Design/Layout Tokenは非UI変更のためnot-applicableである。
- 未解決Critical、High、Medium、Lowは0件で、実装review判定はapprovedである。
- H_impl後に許可する変更は本review artifactだけとし、H_finalへ一致する外部CI、CodeRabbit、独立reviewを再取得する。
