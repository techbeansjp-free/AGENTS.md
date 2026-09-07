# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1211 の実装に対する内部独立code review |
| ラウンド | 1。保存済みreview-sessionの操作はcoordinator担当 |
| H_impl | `d076737306aeb033e2431030704b164a0116236f` |
| 対象SHA・文書ダイジェスト | H_impl `d076737306aeb033e2431030704b164a0116236f` |
| 比較基点 | `791c5da9cbdd3d91c3c980208b3ee45d2503889c` |
| 対象差分 | 比較基点..H_implの26 path。Gitから個別に列挙して確認 |
| 対象外 | 個別project ruleの実廃止、proposal自動消費、PR・merge等の提出操作 |
| 残り予算 | 通常2回。追加roundを本reviewから要求しない |
| ラウンド数 | 1 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260908_054817_project-ruleの正式な廃止経路を確立する` |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md` REQ-SQ-004「trusted側へ先行登録したproject rule廃止提案とrule ID・trusted fragmentのraw UTF-8 SHA-256が完全一致する完全削除だけを受理する」 |
| 成果物行数 | 製品source +270/-39、schema・配布案内 +67/-13、仕様 +21/-6、test +874/-26、生成dist +172/-30（合計 +1404/-114） |
| 縮小の先行評価 | 既存policy比較・loader・migrationへmatcherを合成。新CLI、service、DB、依存追加なし |
| 実施者・日時 | reviewer `review_1211`、2026-09-07T22:19:57Z以降の同一review turn |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 本文の肯定・敵対評価、finding分類 | critical（authority変更） | 内部Codex agent環境。Claudeではない | 本環境の実行設定。provider model/list・実効model attestationは未取得 | coordinatorから、Claude外部送信の自動審査拒否後の内部代替reviewを明示依頼された | implementerは別CLI context `codex-1211-implementation`、本reviewerは実装に未参加の独立context `review_1211`。`git diff --exit-code H_impl`成功、HEAD一致を観測。product/test/specは変更していない |

project choiceのreviewer mappingはClaudeであり、この内部reviewをそのproviderで実行した証拠へ読み替えない。provider切替の正式routing証拠、外部approval、例外authorityの確認・記録はcoordinator側に残る。本書は内部code reviewであり、外部のimmutable承認を自己発行しない。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | 同staging 00〜03 | AC-1211-01〜11、INV-01〜07、proposal自動消費は対象外 | 既存文書 |
| 差分 | 比較基点..H_impl | 全26 path。読み取り時HEAD一致・tracked差分なし | Git観測 |
| テスト | `.agent-skill-chain/tmp/issue-1211-verification/latest-results.json` と `conformance-check.log` | 全12 command exit 0。1626 scenario成功・16 skip・失敗0 | verifierの実行出力 |
| 実装引継ぎ | `.agent-skill-chain/tmp/1211-implementation-handoff.json` | 87 scenario/450 step成功、変異6件killの実装者記録。旧EPERM失敗を後続verifier結果と区別 | 実装者記録 |
| 仕様 | 用語台帳、REQ-SQ-004、信頼境界、追跡表、変更履歴 | updated | 既存文書 |
| commit前candidate | 引継ぎpath manifest | coordinatorがH_implへ固定。本reviewはcommit後のGit差分を確認 | Git観測 |
| Phase A artifact | `docs/reviews/175_課題1211project-rule廃止経路レビュー.md` | H_implの後に本書だけをcommitする。承認結果は変更しない | finalizerの記録 |
| commit後external | CI run / immutable review | 本reviewerは未観測。成功CIやGitHub approvalを主張しない | 未確認 |

authorityの向きはfixed trusted set→raw source→matcher→candidate判定。candidate proposalを読まず、自己承認・逆依存を追加していない。H_finalとprovider actor一致検証は提出前の後続確認であり、本書だけでは成立しない。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | M | package | package | 二段階登録・raw hash計測・撤回・復元の配布案内 | pass、runtime authorityを発行しない | AC-1211-10 / INT-LEDGER-009 | proposal非消費とstaged復元を説明 | pass |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | M | package | package | manifestのoptional提案と空ruleFiles契約 | pass、型とruntimeへ整合 | AC-1211-04/07/10 | 上限16・未知field禁止を維持 | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | package | package | assembled policyの同一提案契約 | pass、manifestと定義一致 | AC-1211-04/07/10 | 空project rulesだけを許容 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | project | spec | TERM-ASC-095/096の有効定義 | pass、一方向追跡 | REQ-SQ-004 | choice縮小と意味を分離 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | REQ-SQ-004の成立中契約を更新 | pass、実装への参照 | AC-1211-01〜11 | 完全削除限定・floor保持 | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | project | spec | trusted-only authorityの説明 | pass、正本へ参照 | AC-1211-03〜07 | ownerを認証に使わない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新SCNと実装bindingの追記 | pass、追跡方向を保持 | REQ-SQ-004 / LEDGER新SCN | authorityを持たない | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 今回の成立契約・用語変更の記録 | pass、要件参照 | REQ-SQ-004 | optional/sourceなしの従来拒否を明示 | pass |
| `src/cli.ts` | M | package | package | validate/trusted比較/PRへの接続 | pass、policy helper→domain | AC-1211-09 | 固定trusted set由来で候補自己承認を防ぐ | pass |
| `src/domain/delivery.ts` | M | package | package | PR副作用前のpolicy比較入力追加 | pass、型依存と比較へ接続 | AC-1211-09 / INT-LEDGER-008 | source欠落で削除を拒否 | pass |
| `src/domain/enforcement.ts` | M | package | package | missing ruleだけをmatcherへ委譲 | pass、matcher→types/crypto | AC-1211-01〜07/11 | 部分弱化の既存比較は維持 | pass |
| `src/domain/migration.ts` | M | package | package | file migrationのplan/verifyにsource配送 | pass、policy helperを再利用 | AC-1211-08 | plan fingerprint・再比較は維持 | pass |
| `src/domain/policy.ts` | M | package | package | runtime validation・raw source復元 | pass、matcher validator再利用 | AC-1211-04/07/09 | index/ID/semantic/raw対応・一意性検査 | pass |
| `src/domain/project-rule-retirement.ts` | A | package | package | 提案集合検証と完全削除の照合 | pass、IO/Git/candidate proposal依存なし | AC-1211-01〜06 | 不正集合・source不明・hash不一致拒否 | pass |
| `src/types.ts` | M | package | package | optional proposalの型契約 | pass、上位へ依存なし | AC-1211-04/10 | owner/reasonは文字列情報のみ | pass |
| `test/features/integration/project-rule-ledger.feature` | M | project | project | migration/fixed commit/schemaの受入例 | pass、step実装に対応 | AC-1211-08〜10 | 一時fixtureとread-only比較 | pass |
| `test/features/integration/risk-policy-migration.feature` | M | project | project | 空project rulesへの契約更新 | pass、既存SCN維持 | AC-1211-07/11 | 未知field拒否は維持 | pass |
| `test/features/unit/project-rule-ledger.feature` | M | project | project | 正常・撤回・悪用・空inventory・回帰の例 | pass、SCN一意 | AC-1211-01〜07/11 | negative条件を維持 | pass |
| `test/steps/project-rule-ledger.steps.ts` | M | project | project | 値・隔離Git・schema照合の実測assertion | pass、testからdomainへのみ | LEDGER-010〜017 / INT-007〜009 | real remoteを拒否するmock・temp fixture | pass |
| `test/steps/risk-policy.steps.ts` | M | project | project | 既存空rules期待値を新契約へ更新 | pass、schema/runtime対応 | INT-RISK-007 | 未知field診断のassertionを残す | pass |

Git差分26件から生成dist 6件を除いた20件と表が一致。dist 6件も内部reviewで確認し、配布影響を§8へ記録。project固有値や実行authorityをpackage/specへ混入していない。修正差分なし。生成物はsourceとの個別対応とverifier build成功を確認した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1211-001 | 最後のrule廃止に空inventoryが必要 | AC-1211-07 | なし、当初AC内 | project rules空を許容 | UNIT-LEDGER-016 | updated | pass |
| DISC-1211-002 | effectiveでtrusted project ruleを補完すると削除差分が隠れる | AC-1211-07/09 | なし | packageFloorを分離してproject削除を比較へ渡す | UNIT-LEDGER-016、INT-LEDGER-007/008、full conformance | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1211-01 | SCN-UNIT-LEDGER-010 | matcher完全一致・accepted4値 | 成功 | pass | 引継ぎ＋full出力、assertion確認 |
| AC-1211-02 | SCN-UNIT-LEDGER-011 | proposalなしをremainingへ | 成功 | pass | 撤回とASC-TRUST-001 assertion |
| AC-1211-03 | SCN-UNIT-LEDGER-012 | trusted.projectRuleRetirementProposalsだけを渡す | 成功 | pass | candidate-onlyとaccepted空のassertion |
| AC-1211-04 | SCN-UNIT-LEDGER-013 | validator/source/hash診断 | 成功 | pass | 不正集合、1byte差、source重複・欠落・pathの反例 |
| AC-1211-05 | SCN-UNIT-LEDGER-014 | existing rule弱化を既存比較 | 成功 | pass | 部分弱化でaccepted空 |
| AC-1211-06 | SCN-UNIT-LEDGER-015 | per-rule結果と全体allowed | 成功 | pass | 1件未承認拒否・2件承認成功 |
| AC-1211-07 | SCN-UNIT-LEDGER-016 | empty extension/packageFloor/operation | 成功 | pass | floor全rule比較・存在しないrule拒否・復元 |
| AC-1211-08 | SCN-INT-LEDGER-007 | file migration plan/verify | 成功 | pass | 実planとproposal撤回の反例 |
| AC-1211-09 | SCN-INT-LEDGER-008 | fixed commit loader/effective/CLI/delivery | 成功 | pass | Git固定後worktree破損でも固定sourceを使用、preview拒否反例 |
| AC-1211-10 | SCN-INT-LEDGER-009 | 両schema、guide、型 | 成功 | pass | schema property同値・regex・文書手順とpackage check |
| AC-1211-11 | SCN-UNIT-LEDGER-017、既存SCN | rule/choice/conformance回帰 | 成功、fullには別途16 skip | pass | unchanged既存判定とfull conformance結果 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | trusted削除受理条件を追加 | trusted-only matcher、fixed commit source、自己承認・便乗反例 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 受理・拒否対象を運用判断に使う | ID/path/両SHAのみ、reason/ownerは診断へ転記しない。新永続logなし |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLIの比較契約で画面を持たない | package bin、projectKind=cli。CLI回復手順は別途確認 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | UI/theme/layout差分なし | project capabilityと26 path集合 |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | ACを満たすか | pass | AC全11件のsource/SCN照合、full失敗0 |
| 価値 | 不要ruleを廃止できるか | pass | 先行提案と後続完全削除が成立し最後の1件も扱える |
| 実現可能性 | 既存実行環境で成立するか | pass | 静的・型・build・package・conformanceすべてexit0 |
| 整合性 | 計画・実装・仕様の一致 | finding | 製品契約は一致。上流00にLowの旧文言L-1211-01が残る |
| 保守性 | 責務と依存が適切か | pass | matcherは副作用なし、既存loader/比較へ接続、architecture成功 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | candidate-only/不正提案/1byte差 | pass | UNIT-012/013と入力構造を照合 |
| 失敗経路 | source不明・migration再比較 | pass | sourceなしはremaining、plan/verify両方で再比較 |
| 境界値 | 空・16/17件・重複・制御文字 | pass | 空extension、集合validator、schema、boundary assertion |
| 悪用 | pathすり替え・便乗・部分弱化 | pass | source一意対応、path制限、UNIT-014/015 |
| 安全性 | 認証・trusted境界 | pass | ownerを認証に使わず、candidate proposalをauthorityへ配送しない |
| データ損失 | 未承認削除の拡大 | pass | acceptedだけでallowedを立てず、remaining1件でも全体拒否 |
| ロールバック | 撤回・復元・再実行 | pass | proposal撤回拒否、floor/fragment復元例、配布手順 |
| 範囲漏れ | loader/CLI/migration/delivery/dist/schema/docs | pass | 全26pathと各呼び出しを照合。legacy sourceなしは従来拒否 |

## 5. 指摘

Critical/Highの再現可能な製品欠陥はなし。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| M-1211-01 | Medium | 初回引継ぎにscenario全体の交互3回性能測定がなかった | handoff benchmarkScope、および補完された`.agent-skill-chain/tmp/issue-1211-scenario-benchmark.json`と同名`.mjs` | 性能の検証証拠 | 同一15既存scenario/75 stepを交互3回、全6実行成功。process全体中央値5166.62354ms→4884.596663ms、-5.458630%。scriptと結果、baseline rootのHEAD=比較基点を確認 | resolved、同一round内の証拠補完 | NFR-1211-04の15%以内を満たす。matcher microbenchmarkとは別測定 |
| L-1211-01 | Low | 00の3箇所にproposal消費を含む旧表現が残る | 同staging `00_要求定義.md:154,183,206`。同文書の対象外・01〜03・runtime/guideは自動消費なし | 上流staging、H_impl製品差分外 | 次回文書整理時に対象外と一致させる。自動消費の実装追加はしない | out-of-scope（製品差分外）、文言不整合自体は確認済み | 上流の読み手が消費も実装済みと誤解する可能性 |

Medium/Lowを理由に停止、実装修正、追加roundを要求しない。

## 6. ラウンド固有の確認

### ラウンド1

全5肯定・8敵対評価を確認し、上記2件の非停止指摘を確定。次round対象のCritical/Highなし。

### ラウンド2

未実施・不要。実装変更なし。

### ラウンド3

未実施・不要。予算を自動更新していない。

## 7. テスト結果

独立verifierの実行出力を使用し、このreviewerは全testを重複実行していない。runnerはcucumber-js、gherkinDialect=en、project layer順はunit/integration/e2e。

`project:quality`、`lint`、`format:check`、`typecheck`、`source:check`、`docs:format`、`test:format`、`trace:check`、`architecture:check`、`build`、`package:check`、`conformance:check`の12件をlatest-resultsでexit0確認。

fullは1642 scenario中1626成功・0失敗・16 skip、8632 step中8582成功・0失敗・50 skip。引継ぎのtargeted 87 scenario/450 step成功、変異M1〜M6 killは実装者測定として参照し、独立再実行とは称さない。

| project layer | 失敗 | skip | 理由・証拠 |
|---|---:|---:|---|
| integration | 0 | 16 scenario / 50 step | `@actual-graphqlite`のstore14件・runtime2件。既存`ASC_GRAPHQLITE_TEST_EXTENSION`未指定条件。feature tagとstep内の環境変数参照を確認し、件数はcoordinator/verifierの観測を参照。実extension試験は未実行であり、成功へ読み替えない |

性能測定は同一既存15 ledger scenario/75 stepの変更前後交互3回、全6実行成功。`.agent-skill-chain/tmp/issue-1211-scenario-benchmark.json`と`.mjs`を読み、baselineのHEADが比較基点であることをGitで確認。process開始〜終了中央値は5166.62354ms→4884.596663ms（-5.458630%）で、NFR-1211-04の15%以内を満たす。全suite停止後に測定したことはcoordinatorの実施記録による。

GitHub成功CI run ID/URLとH_finalは本review時点で未観測。local verifier出力をimmutable外部CI証拠へ読み替えない。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/schemas/`の3変更file | 入る | 新optional提案、空inventory、二段階手順 |
| `src/`の7変更fileおよび対応`dist/`6file | 入る | trusted proposalによる完全削除判定と入口配送 |
| `docs/specs/`5file、`test/`5file | 入らない | 開発上の追跡・検証 |

判断: 配布物を更新した

根拠: schema利用案内とdist/sourceを同時更新し、build・package検査exit0。配布文書に二段階登録、hash計測、撤回、rollbackを記載。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | 本reviewerは未観測。これは内部独立code review |
| reviewerがPR author・実装commit authorと異なる | 内部identity/contextは実装者と異なる。provider stable actor ID比較は未観測 |
| 観測したreview commentとapprovalの件数 | 未観測。0件と断定しない |
| 適用する例外の識別子 | 本reviewerは発行・適用していない。coordinatorが正本とprovider実体を確認する |
| 観測値 | coordinatorの依頼によりClaude送信が自動審査拒否された後の内部review。Claude実行証拠とは扱わない |

## 10. 仕様整合性

判定: updated。用語台帳TERM-ASC-095/096、REQ-SQ-004、信頼境界、追跡表、変更履歴の5fileで成立中実装へ追随。未定義語・重複定義・意味の無根拠変更・置換先なし廃止は製品差分に見当たらない。AC→LEDGERのSCN→feature/step→実装を照合した。UI/token変更なし。上流00の旧文言はL-1211-01に限定して記録した。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0。
- Medium/Low: M-1211-01は証拠補完でresolved。L-1211-01だけ残存、非停止。
- 判定: approved（H_implの内部独立code review）。
- 新しい権限が必要な事項: 本reviewでは外部操作なし。外部CI/review・routing/例外・提出authorityは本書から生成しない。
- 残存リスク: proposalは自動消費されないため、同ID・同raw再導入後の再利用を避ける撤回はowner運用。これは承認済み対象外として配布文書にも明示済み。
- 次に許可される操作: coordinatorによる正式review artifact作成、既存authorityに従った提出判断。
- 次回の再開地点: H_implを保持し、外部証拠を別途確認する。reviewerはcode/test/specを変更せず提出操作も行っていない。

### finalizerによる提出時の補足

内部reviewのapproved判定・findingは上記のとおり保持する。coordinator/analyst/verifier/finalizerはroot、implementerは別CLI context、reviewerは別内部contextであり、verifierは独立して12 commandを完走した。既定Claude mappingに対する外部送信は自動審査に拒否され、内部reviewへ代替した。これは既定providerの実行・実効tier attestationを満たしたという主張ではない。今回の明示された自走・merge authorityの下、この相違を記録して可逆なPR/mergeへ進める。project choiceや安全gateは変更せず、release・registry公開は実行しない。

外部review不成立の既存例外は`.agent-skill-chain/review-exceptions.json`の`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`を参照する。ただし本書作成時点では適用していない。PR作成後にreview comment・approvalの実体を観測し、その条件を満たす場合にのみ外部記録へ適用値を残す。内部reviewをGitHubのimmutable approvalへ読み替えない。

