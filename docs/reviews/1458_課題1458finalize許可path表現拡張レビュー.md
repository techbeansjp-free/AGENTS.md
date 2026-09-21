# 04 レビュー

## 要約

| 項目 | 内容 |
|---|---|
| 何が問題だったか | finalize allowlistが日本語segmentと限定的な再帰file名を表現できなかった。 |
| 何を解決しようとしたか | NFC Unicode pathと`**/<filename>`・単一`*`のbasenameを許可し、危険pathとASC内部領域は拒否する。 |
| 何を行ったか | schema/runtimeのpatternを拡張し、exact/wildcard matcherとUnicode・NFC・内部領域の回帰testを追加した。 |
| 何を確認したか | 初回対象7シナリオ・63ステップ、修正後対象5シナリオ・45ステップ、全件2,283シナリオ・21,121ステップ、12品質gateを確認した。 |
| 判定 | approved |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | `.agent-skill-chain/tmp/issues/20260922_044431_1458-finalize-unicode-recursive-files` | AC-1458-01〜04 | 要求・要件 |
| 差分 | `a7f35902f725c0990d9bf7cdacb0c78d3becca2d`..`174a174a0ee7097a9130f6714329a92e3242fdf9` | 15 path | Git |
| 対象test | Cucumber | 修正後5シナリオ・45ステップ合格 | 実行結果 |
| 全件test | `npm run verify:distribution` | 2,256成功・27 skip・失敗0、21,020ステップ成功・101 skip | 実行結果 |
| ローカルLLM | qwen3.8:27b、loopback | schema/runtime整合を分析したがtoken上限で結論欄は空 | 読取専用補助review |
| Codex Sol | exact-head read-only | High 1件、Low 1件。修正差分再確認後approved | 独立review |
| Opus | exact-head read-only | Medium 2件、Low 2件。うち回帰指摘はSolと重複 | 独立review |

- architecture:checkとtrace:checkは合格し、循環・orphanは0件。
- 製品HEADは`174a174a0ee7097a9130f6714329a92e3242fdf9`に固定し、review後の製品差分はない。
- ローカルLLMの出力をformal approvalまたはmerge authorityに使用していない。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | M | package owner | docs | schema利用契約 | docsのみ | AC-1458-01〜04 | revert | pass |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | M | package owner | schema | manifest validation | schema → policy | AC-1458-01・04 / SCN-040 | revert | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | package owner | schema | policy validation | schema → policy | AC-1458-01・04 / SCN-040 | revert | pass |
| `dist/src/domain/worktree-removal-safety.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | AC-1458-01〜04 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | 仕様owner | docs/specs | 用語正本 | spec → src | TERM-ASC-065 | revert | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | 仕様owner | docs/specs | lifecycle要件 | spec → src | REQ-LC-009 | revert | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | 仕様owner | docs/specs | CLI契約 | spec → src | AC-1458-01〜04 | revert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 仕様owner | docs/specs | trace正本 | spec → test | SCN-040〜042・INT-015 | revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 仕様owner | docs/specs | 変更履歴 | docsのみ | Issue #1458 | revert | pass |
| `src/domain/worktree-removal-safety.ts` | M | package owner | domain | parser・matcher | domain内 | AC-1458-01〜04 | fail-closed・revert | pass |
| `test/features/integration/finalize-ignored-artifacts.feature` | M | test owner | test | CLI統合回帰 | test → src | SCN-INT-FINALIGN-015 | revert | pass |
| `test/features/unit/finalize-ignored-artifacts.feature` | M | test owner | test | 契約・反例 | test → src | SCN-040〜042 | revert | pass |
| `test/steps/finalize-ignored-artifacts-cli.steps.ts` | M | test owner | test | integration用の日本語fixture | test → src | SCN-INT-FINALIGN-015 | revert | pass |
| `test/steps/finalize-ignored-artifacts.steps.ts` | M | test owner | test | unit用の日本語fixture | test → src | SCN-040〜042 | revert | pass |

- 差分path集合と14行の監査表は一致する。
- package層へproject固有値や実行authorityを追加していない。

## 2. 受け入れ条件の確認

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1458-01 | SCN-UNIT-FINALIGN-040 | Unicode parserとschema | pass | pass | schema/runtime一致 |
| AC-1458-02 | SCN-UNIT-FINALIGN-041 | exact・単一wildcard matcher | pass | pass | backup名・無関係JSONをblock |
| AC-1458-03 | SCN-UNIT-FINALIGN-041、SCN-INT-FINALIGN-015 | staging固定file名pattern | pass | pass | 広いJSON許可なし |
| AC-1458-04 | SCN-UNIT-FINALIGN-040、042 | NFC・control・内部領域拒否 | pass | pass | negative test |

開発考慮事項の適用判定は`00_要求定義.md` §6.1と同じ。

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | schema・runtime・matcherを同じ代表入力で検証 |
| 価値 | pass | 日本語stagingを手動削除なしでfinalizeできる |
| 実現可能性 | pass | 新依存なし |
| 整合性 | pass | trace・architecture・conformance合格 |
| 保守性 | pass | parserにvalidationとmatchingの意味を集約 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | `**/*`、複数wildcard、backup名、無関係JSONを拒否 |
| 失敗経路 | pass | 不正patternはblock |
| 境界値 | pass | NFC/NFD、Unicode、control、wildcard 0/1/2個を検証 |
| 悪用 | pass | 絶対path、backslash、`.`、`..`、`.git`を拒否 |
| 安全性 | pass | `.agent-skill-chain` recursive許可の迂回を防止 |
| データ損失 | pass | dry-runとapply直前再観測を維持 |
| rollback | pass | commit revertで復帰可能 |
| 範囲漏れ | pass | schema、src、dist、test、仕様を確認 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 対応 | 状態・分類 |
|---|---|---|---|---|---|
| SELF-1458-01 | High | exact basename初版がbackup名まで許可し得た | `staging-record.json.bak`反例 | exact/wildcardを型で分離しtest追加 | resolved |
| QWEN-1458-01 | Low | qwen3.8は2回ともthinkingがtoken上限に達し結論なし | `done_reason=length`・`response=""` | 出力をformal判断に使用せず記録 | inconclusive |
| REV-1458-SOL-01 | High | `**/*.env`が空stemの`.env`まで許可する互換性退行 | base/candidate直接比較 | recursive-extensionを別型に戻し非空stemをtest | resolved |
| REV-1458-OPUS-01 | Medium | `.git`・`.`・`..`のwildcard fragmentをschemaだけ受理 | schema/runtime静的比較 | schemaのnegative lookaheadと代表反例を追加 | resolved |
| REV-1458-OPUS-02 | Medium | 空stem拡張子の互換性退行 | REV-1458-SOL-01と同一経路 | REV-1458-SOL-01で是正 | duplicate |
| REV-1458-OPUS-03 | Low | JSON Schemaだけでは全UnicodeのNFC性を表現できない | singleton-decomposable letterの静的反例 | runtime NFC検証でfail-closed。代表集合一致を維持し残存制約を記録 | record-only |
| REV-1458-SOL-02 | Low | review artifact内のAC・REQ IDが非canonical | 個別監査表 | AC-1458・REQ-LC-009へ修正 | resolved |
| REV-1458-OPUS-04 | Low | matcherがartifactごとにpatternを再parseする | `matchesPrefix`呼出経路 | 最大64件かつ動作影響なし。性能計測なしでscopeを広げず記録 | record-only |

## 6. ラウンド固有の確認

- ラウンド1: Sol・Opusが固定HEAD `6c9e88d1`をreviewし、拡張子pattern回帰とschema/runtime fragment不一致を確定した。
- ラウンド2: 固定HEAD `174a174a`で修正差分、隣接parser/matcher、source/distをSolが再確認しapproved。対象testと全gateが合格し、未解決Critical/Highは0件。
- qwenの結論不成立はLow/inconclusiveとし、ラウンド予算を自動更新していない。

## 7. テスト結果

- 全件: 2,283シナリオ中2,256成功・27 skip・失敗0、21,121ステップ中21,020成功・101 skip。
- 品質gate: project:quality、lint、format:check、typecheck、source:check、build、docs:format、test:format、trace:check、architecture:check、conformance:check、audit:check、package:checkが合格。
- runner・Gherkin方言: cucumber-js、英語keyword・日本語説明。

## 8. 配布物影響

| 変更path | 配布境界 | 影響 |
|---|---|---|
| `.agent-skill-chain/schemas/00_利用案内.md` | 入る | 利用者向け新pattern契約 |
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | 入る | manifestの新patternを受理 |
| `.agent-skill-chain/schemas/project-policy.schema.json` | 入る | policyの新patternを受理 |
| `src/domain/worktree-removal-safety.ts` | 入る | validation・matching拡張 |
| `dist/src/domain/worktree-removal-safety.js` | 入る | build済み生成物 |
| `docs/specs/`・`test/` | 入らない | 仕様・検証証拠 |

判断: 配布物を更新した

根拠: schema・runtime・distをbuildし、package:checkに合格した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい（Codex SolとOpusが実装sessionとは別contextで固定HEADを読み取り専用review） |
| reviewerとimplementerのidentity・context比較 | implementerは進行役、reviewerはCodex Sol別contextとClaude Code Opus。qwenは補助のみ |
| reviewerが対象差分を変更していないこと | はい（両reviewerはread-onlyで変更0件。修正後HEAD `174a174a0ee7097a9130f6714329a92e3242fdf9`もSolが非変更で再確認） |

## 10. 仕様整合性

- 判定: updated。
- 更新した仕様: TERM-ASC-065、REQ-LC-009、CLI契約、追跡表、変更履歴。
- 要件・Issue #1458・SCN・test pathはtrace:checkで追跡可能。
- UI・design token変更はない。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Low: Mediumは全件resolved/duplicate。LowはQWEN-1458-01、Unicode NFCのschema表現制約、再parse改善をrecord-onlyとして記録。
- 判定: approved
- 新しい権限が必要な事項: Issue #1458本文同期とPR作成。
- 残存リスク: doctorの`.gitignore`被覆分析は誤検知範囲が広いため対象外。
- 次に許可される操作: artifact-only commit、Issue同期、PR作成、CI。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | `174a174a0ee7097a9130f6714329a92e3242fdf9` |
| 比較基点 | `a7f35902f725c0990d9bf7cdacb0c78d3becca2d` |
| H_impl | `174a174a0ee7097a9130f6714329a92e3242fdf9` |
| 対象差分 | 15 path、本文§1.1 |
| 対象外 | 比較基点に存在し未変更の範囲 |
| 残り予算 | 2ラウンド |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260922_044431_1458-finalize-unicode-recursive-files |
| 仕様の所有箇所 | lifecycle要件とCLI契約 |
| 成果物行数 | 製品・仕様・test差分: +290/-94 |
| 縮小の先行評価 | 既存patternでは限定file名を表現できず、共通parserの拡張が必要 |
| 実施者・日時 | coordinator、Codex Sol、Claude Code Opus、2026-09-22T06:33:00+09:00 |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対reviewとfinding分類 | project policyが求めるtier | Codex Sol・Claude Code Opus | local qwen3.8は補助のみ | 結論不成立時は停止 | exact HEAD固定・両reviewer対象差分非変更 |
