# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| ラウンド数 | 2 |
| 比較基点 | `9eaa3c6bd2efa1dd198ef45a587bed6b31ed81c3` |
| H_impl | `9b6bf0194ae8f5c010a227872593d7731c7fc850` |
| 対象差分 | Issue #1461の実装commitと本review artifact |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260922_172952_Ollama大規模promptのheadersTimeoutを設定値と整合させる` |
| 仕様の所有箇所 | 信頼境界、追跡表、利用案内 |
| 成果物行数 | 製品・仕様・test差分は+1,851/-402、支援層はreview artifact |
| 縮小の先行評価 | transport、入力・出力budget、端末別設定へ限定 |
| 実施者・日時 | coordinator、Opus、qwen3.8:27b、2026-09-22 |

## 要約

| 項目 | 内容 |
|---|---|
| 問題 | Ollamaの非stream応答がNode HTTP clientのheader timeoutへ先に到達し、巨大promptを27B modelが処理できなかった。 |
| 対応 | 標準HTTP requestとstream応答、既定15分の総deadline、既定24 KiB入力分割、既定2,048 token出力上限を実装し、端末別設定を初回・第二passへ貫通した。 |
| 検証 | 対象8 scenario、全2,295 scenario・21,235 step、12品質gateが合格。Opus指摘を再検証して成立分を是正した。Qwen実機はtoken上限終了を`unknown`として安全検出した。 |
| 判定 | approved |

## 1. 入力証拠

| 証拠 | 観測結果 |
|---|---|
| 比較基点 | `9eaa3c6bd2efa1dd198ef45a587bed6b31ed81c3` |
| H_impl | `9b6bf0194ae8f5c010a227872593d7731c7fc850` |
| 実Ollama | 19,239 byte入力は58,494 msで成功。旧350,144 byte一括入力は設定済み900秒でtimeoutし、300秒の先行header timeoutは発生しなかった。 |
| Qwen差分review | 生成物を除く確定差分106,649 byteを5分割。chunk 1は22,677 byte、318,769 ms後に`done_reason=length`となり、実装どおり`unknown`へ倒れた。findingとして採用しない。 |
| Opus review | 全chunkへの指示欠落、token上限終了の成功扱い、未信頼見出しのbudget超過、第二passの入力上限迂回、統合後finding上限漏れを指摘。現行コードで再現し修正した。その他は既存fail-closed契約または本Issue範囲外と判定した。 |

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | M | package owner | docs | 端末別設定案内 | docsのみ | Issue #1461 | revert | pass |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package owner | docs | 進行役の上限遵守 | docsのみ | Issue #1461 | revert | pass |
| `.agent-skill-chain/schemas/supplemental-review-config.schema.json` | M | package owner | schema | 設定範囲 | schema → config | SCN-UNIT-DELEGREVIEW-028〜030 | 範囲外拒否・revert | pass |
| `dist/src/adapters/delegated-review-launch.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-UNIT-DELEGREVIEW-027〜030 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/adapters/local-llm-execution.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-INTEGRATION-REVIEW-1461-001〜003 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/adapters/review-finding-verification.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-UNIT-DELEGREVIEW-030 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/adapters/review-launch.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | Issue #1461 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/adapters/review-prompt-batching.js` | A | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-SUPPL-021 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/adapters/supplemental-review-launch.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-SUPPL-021 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/domain/delegated-review-config.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | SCN-UNIT-DELEGREVIEW-028〜030 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/domain/local-review-limits.js` | A | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | Issue #1461 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `dist/src/domain/supplemental-review-config.js` | M | package owner | dist | 生成物。生成元との対応を再build後のclean差分で確認 | src → dist | Issue #1461 | §8の配布物影響表とpackage:checkで確認。revert | pass |
| `docs/reviews/1461_課題1461Ollama大規模prompt制御レビュー.md` | A | review owner | review artifact | ラウンド1の証拠とラウンド2の前進是正を同一正本に記録 | artifactのみで製品依存なし | Issue #1461、CR-01〜04 | audit:checkでpath集合とH_implを検証。revert | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | spec owner | specs | transport・budget境界 | specs → implementation | Issue #1461 | loopback維持・revert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec owner | specs | scenario追跡 | specs → test | 新規7 SCN | orphan 0・revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec owner | specs | 変更履歴 | docsのみ | Issue #1461 | revert | pass |
| `src/adapters/delegated-review-launch.ts` | M | package owner | adapter | 分割・統合・設定伝播 | adapter → domain | SCN-UNIT-DELEGREVIEW-027〜030 | fail-closed・revert | pass |
| `src/adapters/local-llm-execution.ts` | M | package owner | adapter | HTTP stream・timeout | adapter → HTTP | SCN-INTEGRATION-REVIEW-1461-001〜003 | loopback・有限上限・revert | pass |
| `src/adapters/review-finding-verification.ts` | M | package owner | adapter | 第二pass分割 | adapter → Git | SCN-UNIT-DELEGREVIEW-030 | exact HEAD・revert | pass |
| `src/adapters/review-launch.ts` | M | package owner | adapter | 既定timeout同期 | adapter → executor | Issue #1461 | fail-closed・revert | pass |
| `src/adapters/review-prompt-batching.ts` | A | package owner | adapter | UTF-8入力分割 | adapter → domain | SCN-SUPPL-021 | 有限budget・revert | pass |
| `src/adapters/supplemental-review-launch.ts` | M | package owner | adapter | 分割・統合・設定伝播 | adapter → domain | SCN-SUPPL-021 | fail-closed・revert | pass |
| `src/domain/delegated-review-config.ts` | M | package owner | domain | 端末別設定解決 | domain内 | SCN-UNIT-DELEGREVIEW-028〜030 | 範囲外拒否・revert | pass |
| `src/domain/local-review-limits.ts` | A | package owner | domain | 共通有限上限 | domain内 | Issue #1461 | min/max検証・revert | pass |
| `src/domain/reviewer-provider.ts` | M | package owner | domain | executor入力型 | domain内 | Issue #1461 | 任意field・revert | pass |
| `src/domain/supplemental-review-config.ts` | M | package owner | domain | 端末別設定読込 | domain内 | Issue #1461 | 範囲外拒否・revert | pass |
| `test/features/integration/review-launch.feature` | M | test owner | test | stream・token回帰 | test → adapter | SCN-INTEGRATION-REVIEW-1461-001〜003 | 隔離loopback・revert | pass |
| `test/features/unit/delegated-review.feature` | M | test owner | test | 委譲review回帰 | test → adapter | SCN-UNIT-DELEGREVIEW-027〜031 | 隔離fixture・revert | pass |
| `test/features/unit/review-finding-verification.feature` | M | test owner | test | 大規模fileの投稿前検証回帰 | test → adapter | SCN-UNIT-FINDVERIFY-016 | 隔離fixture・revert | pass |
| `test/features/unit/supplemental-review.feature` | M | test owner | test | 入力分割回帰 | test → adapter | SCN-SUPPL-021・022 | 隔離fixture・revert | pass |
| `test/steps/delegated-review.steps.ts` | M | test owner | test | 委譲fixture | test → adapter | SCN-UNIT-DELEGREVIEW-027〜031 | tmp隔離・revert | pass |
| `test/steps/review-finding-verification.steps.ts` | M | test owner | test | 大規模file fixture | test → adapter | SCN-UNIT-FINDVERIFY-016 | tmp隔離・revert | pass |
| `test/steps/review-launch.steps.ts` | M | test owner | test | loopback fixture | test → adapter | SCN-INTEGRATION-REVIEW-1461-001〜003 | loopbackのみ・revert | pass |
| `test/steps/supplemental-review.steps.ts` | M | test owner | test | 分割fixture | test → adapter | SCN-SUPPL-021・022 | tmp隔離・revert | pass |

## 2. 受け入れ条件の確認

| 条件 | 判定 | 根拠 |
|---|---|---|
| 24 KiB・2,048 tokenを既定にする | pass | 共通定数とrequest回帰 |
| 端末別に変更可能にする | pass | schema・config・SCN-UNIT-DELEGREVIEW-028〜030 |
| 進行役と第二passへ適用する | pass | workflow正本とStep 10回帰 |
| loopback等の安全境界を維持する | pass | 既存全件testと信頼境界 |

## 3. 肯定的評価

- Node clientの先行header timeoutを除去し、設定した総deadlineへ一元化した。
- 入力・出力を有限化し、端末性能差はGit管理外設定で吸収できる。

## 4. 敵対的評価

- 長大な見出し、複数chunk、token上限終了、第二pass迂回を反例として検査した。
- 途中失敗は部分成功へ倒さず`degraded`または`unknown`を返す。

## 5. 指摘

| ID | 重大度 | 内容 | 採否・対応 |
|---|---|---|---|
| OPUS-01 | High | 2個目以降のchunkへreview指示が残らない | valid。固定prefixへ移し全chunkへ反復、回帰追加。 |
| OPUS-02 | High | `done_reason=length`を成功扱いする | valid。`unknown`と専用診断へ変更、実機・回帰で確認。 |
| OPUS-03 | High | 第二passが24 KiB設定を迂回する | valid。finding単位batchへ分割し同じ総deadline・上限を適用。 |
| OPUS-04 | Medium | 統合後に100件上限を超え第二passが暗黙無効になる | valid。統合後にも上限を検査して`degraded`へ倒す。 |
| OPUS-05 | Medium | 1 chunk失敗で先行結果を破棄する | invalid。未完了reviewを部分成功として提示しないfail-closed契約である。 |
| OPUS-06 | Medium | 第二passが総deadline残量を使う | invalid。timeout増幅を防ぐ明示要件であり、未成立は`null`で進行役へ渡す。 |
| OPUS-07 | Medium | formal replace経路の2,048 tokenを端末別変更できない | out-of-scope。個人設定がformal authorityへ影響しない既存trust境界を維持する。上限到達は安全に`unknown`となる。 |
| QWEN-01 | - | chunk 1で生成token上限へ到達 | inconclusive。findingは成立せず、専用診断と端末別上書き経路が機能した。 |
| CR-01 | High | chunk配列をdelimiter結合するdigestは要素境界が曖昧になる | valid。prompt・output配列のJSON直列化をdigest入力にし、SCN-UNIT-DELEGREVIEW-031を追加。 |
| CR-02 | High | 24KiB超のfileで投稿前第二passがexecutor未起動になる | valid。finding行を中心とするUTF-8安全な有限excerptへ切り替え、SCN-UNIT-FINDVERIFY-016を追加。 |
| CR-03 | High | 差分外findingの多数応答が対象内上限より先にdegradedを起こす | valid。scope除外後の対象内findingだけに100件上限を適用し、除外件数は保持。SCN-SUPPL-022を追加。 |
| CR-04 | Low | 変更関数のDocstring coverage 80%未満 | invalid。repoの品質gateway契約になく、自明な内部helperへの一律コメント追加は保守性を上げない。 |

未解決Critical/Highは0件。

## 6. ラウンド固有の確認

- Opusの読み取り専用reviewを2回行い、最終roundのHigh 1件とMedium 1件を追加是正した。
- Qwenは実機でtoken上限終了し、finding不成立として分離した。
- ラウンド2でCodeRabbitの3指摘を現行コードに対して再現し、すべて前進commitで是正した。

## 7. テスト結果

- 追加対象: 3 scenario、28 step、失敗0。
- 関連回帰: 77 scenario、704 step、失敗0。
- 全件: 2,298 scenario中2,271成功・27 skip・失敗0。21,263 step中21,162成功・101 skip・失敗0。
- `project:quality`、`lint`、`format:check`、`typecheck`、`source:check`、`build`、`docs:format`、`test:format`、`trace:check`、`architecture:check`、`conformance:check`、`package:check`に合格。
- ラウン2の`audit:check`を含む全gateが合格した。

## 8. 配布物影響

| 変更path | 配布境界 | 影響 |
|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | 入る | 利用者向け端末別設定 |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | 入る | 進行役の遵守事項 |
| `.agent-skill-chain/schemas/supplemental-review-config.schema.json` | 入る | 設定schema |
| `dist/src/` | 入る | 実行時生成物 |
| `src/adapters/delegated-review-launch.ts` | 入る | 配布source |
| `src/adapters/local-llm-execution.ts` | 入る | 配布source |
| `src/adapters/review-finding-verification.ts` | 入る | 配布source |
| `src/adapters/review-launch.ts` | 入る | 配布source |
| `src/adapters/review-prompt-batching.ts` | 入る | 配布source |
| `src/adapters/supplemental-review-launch.ts` | 入る | 配布source |
| `src/domain/delegated-review-config.ts` | 入る | 配布source |
| `src/domain/local-review-limits.ts` | 入る | 配布source |
| `src/domain/reviewer-provider.ts` | 入る | 配布source |
| `src/domain/supplemental-review-config.ts` | 入る | 配布source |
| `docs/specs/`・`test/` | 入らない | 開発・検証証拠 |

判断: 配布物を更新した

根拠: `npm run build`と`package:check`でsource・dist・package内容を同期した。

## 9. 独立reviewの成立

- Opusはread-onlyで差分を変更していない。
- Qwenはloopbackのread-only実行で、結果をformal approvalへ使用していない。

## 10. 仕様整合性

- `provider=ollama`、loopback限定、redirect拒否、非永続、no-telemetryを維持する。
- 個人設定はformal approvalとmerge authorityを構成しない。
- 信頼境界、利用案内、workflow、追跡表、変更履歴を同期した。
- trace orphanは0件である。

## 11. 総合判定と再開地点

- 判定: approved。
- 次の操作: ラウン2 artifact commit、全gate、branch push、レビュースレッド解決。
- 停止点: PR作成。merge、Issue終了、branch削除、release、finalize、cleanupはowner承認待ち。
