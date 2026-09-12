# 04 レビュー（Claude公式default観測）

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Claude Code公式initialize観測、selector採用tier、CLI・仕様・test |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `0feb6e9fa4379ebeabeb60f7dc39ef1c012645df` |
| 比較基点 | `9b5467ce1d8c46b434ea24e5ee10380c9eb26b25` |
| H_impl | `0feb6e9fa4379ebeabeb60f7dc39ef1c012645df` |
| 対象差分 | `9b5467ce1d8c46b434ea24e5ee10380c9eb26b25..0feb6e9fa4379ebeabeb60f7dc39ef1c012645df`の22 path |
| 対象外 | Claude task自動起動、Claude APIへのprompt送信、merge・release |
| 残り予算 | 2ラウンド。PR後のexternal finding取り直し1ラウンドは別枠 |
| ラウンド数 | 1 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260912_172422_課題1343-Claude公式観測selector` |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-007、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`の`routing tier` |
| 成果物行数 | H_impl差分590追加・86削除。製品source・生成dist・仕様・testを含む |
| 縮小の先行評価 | `claude-opus-5[1m]`の逐語mapping追加だけでは次のhost default変更で再発するため、既存ProviderObservationとselector tier validatorを再利用した |
| 実施者・日時 | implementer兼PR前監査: Codex root context、2026-09-12T18:28:00+09:00。外部reviewerはPR後に観測する |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、targeted test | critical | CodexまたはCodeRabbit | provider公式推奨/high | external reviewer不在時はmerge停止 | PR前監査はimplementerと同一context。H_impl後の変更は本artifactだけ |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1343、staging 00〜03 | 公式観測model→抽象selector→project採用tier | 人間判断・GitHub・一次資料 |
| 差分 | `9b5467ce`..`0feb6e9f` | 22 path、590追加・86削除 | Git観測 |
| テスト | targeted、static、conformance | targeted 3 scenarios/21 steps、conformance 87 scenarios/468 steps、失敗0 | テスト出力 |
| 仕様 | 用語、要件、機能、CLI、security、運用、追跡 | updated | 既存文書 |
| commit前candidate | 22 path manifest | H_impl `0feb6e9f` | Git index |
| Phase A artifact | 本file | H_impl後のevidence-only file。SHA-256・blob OIDはcommit後に観測 | Git観測 |
| review session | staging `review-session.json` | session `ef1f98b6ceb3b79c1e7cf74c2a213fae783f7fc956c8e4457aa5e8cf8623815b`、round digest `c5dd918c6939f3d7d043b7a409b3c1f11c4da3c0c4326b4b02b9854cbb88280b` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: pass。公式応答→observation→selector→trusted mapping→必要tierの一方向。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: artifact commit後に検証する。
- reviewerの独立性が要求水準を満たす: 未成立。PR後のCodeRabbitまたはGitHub approvalをPhase Bで観測するまでmergeしない。
- Phase BのPR/CI/review exact-head一致: PR作成後に`review evidence`で観測する。
- 既定branch追随: 行っていない。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/project/choices/development.json` | M | project owner | project | Claude selector採用tier | policy→CLI | AC-1343-01 | exact slugを保持、revert可能 | pass |
| `dist/src/adapters/provider.js` | M | package | package | provider adapter配布物 | sourceから生成 | AC-1343-01〜03 | buildで再生成 | pass |
| `dist/src/cli-usage.js` | M | package | package | CLI usage配布物 | sourceから生成 | AC-1343-01 | buildで再生成 | pass |
| `dist/src/cli.js` | M | package | package | CLI配布物 | sourceから生成 | AC-1343-01〜04 | buildで再生成 | pass |
| `dist/src/domain/role.js` | M | package | package | tier validator配布物 | sourceから生成 | AC-1343-02 | buildで再生成 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package | spec | selectorとClaude観測用語 | 要件へ一方向 | TERM-ASC-094/111 | 文書revert | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | package | spec | REQ-WF-007索引 | 要件正本へ一方向 | REQ-WF-007 | 文書revert | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package | spec | 公開振る舞い要件 | 実装へ一方向 | REQ-WF-007 | 文書revert | pass |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | M | package | spec | routing機能 | adapter/CLIへ一方向 | AC-1343-01 | 文書revert | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | package | spec | CLI契約 | CLIへ一方向 | AC-1343-01〜03 | 文書revert | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | package | spec | parser/trusted境界 | CLIへ一方向 | AC-1343-02/03 | fail-closed | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | package | spec | 障害・復旧 | CLIへ一方向 | AC-1343-03/04 | fallback禁止 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | spec | SCN追跡 | test/sourceへ一方向 | REQ-WF-007 | 文書revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | spec | 変更判断履歴 | 依存なし | Issue #1343 | append記録 | pass |
| `src/adapters/provider.ts` | M | package | package | Claude read-only観測/parser | process→domain observation | AC-1343-01〜03 | timeout・strict parse・secret非出力 | pass |
| `src/cli-usage.ts` | M | package | package | provider/usage help | CLIへ一方向 | AC-1343-01 | revert可能 | pass |
| `src/cli.ts` | M | package | package | trusted policyと観測の合成 | adapter/domainを利用 | AC-1343-01〜04 | candidate自己認可なし | pass |
| `src/domain/role.ts` | M | package | package | provider非依存tier validator | CLIから利用 | AC-1343-02 | pure、revert可能 | pass |
| `test/features/unit/provider-adapter-routing.feature` | M | package | test | protocol受け入れ例 | steps→source | SCN-UNIT-ROUTING-009 | fixtureのみ | pass |
| `test/features/unit/routing-tier-provenance.feature` | M | package | test | Claude CLI受け入れ例 | steps→CLI | SCN-UNIT-TIERPROV-001/005 | fixtureのみ | pass |
| `test/steps/provider-adapter-routing.steps.ts` | M | package | test support | process/parser反例 | sourceを実行 | SCN-UNIT-ROUTING-009 | tmp fixture、secret非出力 | pass |
| `test/steps/routing-tier-provenance.steps.ts` | M | package | test support | trusted repo/CLI fixture | build済みCLIを実行 | SCN-UNIT-TIERPROV-001/005 | tmp Git repoのみ | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: pass（22/22）。
- package/project/specの責務方向に循環はない: pass。
- 個別finding修正: Unicode Control/Separator拒否をH_impl固定前に追加し、隣接adapter/test/distを再検証した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1343-01 | Claude公式initializeがdefault/resolvedModel/effortを返す | 固定slug追加でなくselector経路が成立 | なし | 00〜03と実装を公式観測経路へ整合 | 実機initialize、公式docs、BDD、assess-discovery=continue | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1343-01 | SCN-UNIT-TIERPROV-005 | provider/role/CLI/selector choice | pass | pass | selectorと`claude-opus-5[1m]`を分離してexit 0 |
| AC-1343-02 | SCN-UNIT-ROUTING-009 | strict parser/tier validator | pass | pass | wrong request、欠落ID、Unicode Control/Separator、exact slug mappingだけを拒否 |
| AC-1343-03 | SCN-UNIT-ROUTING-009 | unknown observation/diagnostic | pass | pass | stderr secret非出力、timeout上限 |
| AC-1343-04 | SCN-UNIT-TIERPROV-001〜004 | provider allowlistと既存経路 | 対象3 scenarios pass、既存trace/conformance pass | pass | Codex/未指定処理を共通化せず維持 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 外部subprocess応答とtrusted policyを扱う | metadataのみ抽出、raw/stderr非出力、Unicode Control/Separator拒否 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | entrypoint/provenance/usage/理由を返す | process fixtureとCLI output assertion |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 画面・対話UI・a11y対象を追加せず既存CLI JSON契約だけを拡張 | package `bin`とCLI feature |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚component、layout、theme、tokenを変更しない | UI sourceなし、変更path manifest |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 公式host defaultと逐語IDを取得する | pass | 実機とprocess fixtureが同じcontrol initializeを使用 |
| 価値 | host ID更新ごとのmapping保守を無くす | pass | selectorだけをtrusted mappingへ登録 |
| 実現可能性 | 既存Claude Code CLIでread-only観測できる | pass | 2.1.269実機initialize、timeout 10秒 |
| 整合性 | 設計、コード、test、仕様、dist | pass | trace/architecture/build/package gate合格 |
| 保守性 | Codex固有parserを崩さずprovider分岐を追加 | pass | generic tier validatorだけ共通化 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | default 0/複数、wrong request、high非対応 | pass | unique alias validationとCLIのexact 1/high照合 |
| 失敗経路 | spawn、timeout、nonzero、malformed | pass | `unknownObservation`へ固定理由で収束 |
| 境界値 | 空、重複、制御文字、Unicode separator | pass | strict shape、Set、Unicode property拒否 |
| 悪用 | shell注入、任意argv、candidate自己昇格 | pass | fixed argv、spawn配列、trusted loader |
| 安全性 | secret/raw応答、認可誤表示 | pass | metadataのみ出力、provenance/usage分離 |
| データ損失 | read-only観測によるwrite | pass | initialize control requestのみ、永続file操作なし |
| ロールバック | 観測失敗時の代替 | pass | old model/provider fallbackせず非0、revert可能 |
| 範囲漏れ | routing observe/resolve、dist、仕様 | pass | call-site検索、生成dist、trace/package検査 |

## 5. 指摘

指摘なし。H_impl固定前の自己監査でUnicode bidi等を受理する範囲を発見し、`0feb6e9f`でUnicode Control/Separator拒否と反例を追加済み。PR後のexternal findingは鵜呑みにせず、再現・公式契約・既存testで裏取りする。

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。
- 指摘を確定した: exact H_implに未解決findingなし。
- 次ラウンド対象のCritical/High: 0件。

### ラウンド2

- 未実施。PR後の有効なexternal findingがある場合だけ取り直す。

### ラウンド3

- 未実施。同じ範囲の予算を自動更新しない。

## 7. テスト結果

- 実行command: `npm run format:write`、`npm run typecheck`、targeted `npm run test:unit -- --name 'SCN-UNIT-(ROUTING-009|TIERPROV-001|TIERPROV-005)'`、`npm run build`、`npm run docs:format`、`npm run test:format`、`npm run trace:check`、`npm run architecture:check`、`npm run conformance:check`、`npm run audit:check`、`npm run package:check`。
- 対象合計: 3 scenarios中3成功、21 steps中21成功、失敗0、skip 0。conformanceは87 scenarios中87成功、468 steps中468成功、失敗0、skip 0。
- 全layer suiteは隔離macOSの既定`TMPDIR=/var/...` symlink拒否とsandbox外npm cache書込みで環境失敗したため証拠に採用せず、canonical `TMPDIR=/private/tmp`と隔離npm cacheでconformanceを再実行して合格した。全layerはPR CIの通常環境でPhase Bとして確認する。
- runner・Gherkin方言: Cucumber.js、英語keyword・日本語説明。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/provider.ts`、`src/domain/role.ts`、`src/cli.ts`、`src/cli-usage.ts` | 入る | Claude公式観測、selector tier、CLI provider/helpを追加 |
| `dist/src/adapters/provider.js`、`dist/src/domain/role.js`、`dist/src/cli.js`、`dist/src/cli-usage.js` | 入る | sourceと一致するcompile済みruntime |
| `.agent-skill-chain/project/choices/development.json` | 入らない | repositoryのproject採用tier |
| `test/`、`docs/specs/`、`docs/reviews/` | 入らない | 検証・仕様・review evidence |

判断: 配布物を更新した

根拠: package manifestが含む`dist/src/`をbuildで更新し、配布CLIの`routing tier --provider=claude`契約が変わる。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（未宣言時の既定） |
| その要求を満たすこと | いいえ。PR前はimplementerと同じCodex root contextの敵対監査 |
| reviewerとimplementerのidentity・context比較 | 同一identity・同一context。Claude CLIは未login、外部Codex reviewerはsandbox authority不足で起動せず |
| reviewerが対象差分を変更していないこと | はい。review roundの対象は固定済みH_impl `0feb6e9f`、以後は本artifactだけ |

独立approvalはPhase BでCodeRabbitまたはGitHub reviewerのexact-head証拠を観測する。自己監査を独立reviewへ読み替えず、成立しなければmergeしない。

## 10. 仕様整合性

- 判定: updated。
- 更新した仕様: TERM-ASC-094/111、REQ-WF-007、機能、CLI、信頼境界、運用、追跡、変更履歴。
- ドメイン用語台帳は公式default観測→selector採用tier→trusted mappingを一方向に追跡できる。
- 未定義語・重複定義・根拠なしの廃止はない。既存`claude-opus-5` mappingは互換用に保持した。
- 要件・変更・SCN・testはREQ-WF-007からSCN-UNIT-ROUTING-009/TIERPROV-001〜005へ追跡する。
- UI・tokenは変更対象なし。

## 11. 総合判定と再開地点

- 未解決Critical/High: product差分0件。独立review evidenceはPR後まで未成立。
- Medium/Lowの記録: 0件。
- 判定: approved（PR作成まで）。mergeはexternal exact-head reviewとCIが成立するまで拒否。
- 新しい権限が必要な事項: PR作成は利用者承認済み。mergeは利用者許可済みでもtrusted policy `merge.mode=disabled`を優先する。
- 残存リスク: Claude Code initializeの非公開control schemaが将来変わればfail-closedで停止する。最低対応versionは固定していない。
- 次に許可される操作: artifact-only commit、Step 10記録、PR作成、CI/CodeRabbit観測。
- 次回の再開地点: PR headのexternal findingsとchecks。
