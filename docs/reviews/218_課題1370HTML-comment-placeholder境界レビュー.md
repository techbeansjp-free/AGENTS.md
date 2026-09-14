# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `62b5f4f987af41a0bb7ac7fa3b8592dc25269e81`、diff SHA-256 `2c122007dbf4878aca8ac09a1e2fc6e10b2915e267f94dab2fde89513743fec9` |
| 比較基点 | `b4eaa5ad2c7c0c29ea32e63c312b7d4c2e996a91` |
| H_impl | `62b5f4f987af41a0bb7ac7fa3b8592dc25269e81` |
| 対象差分 | 比較基点からH_implまでの11 path |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | counted round 5、収束後のHEAD移動に対する取り直し2 |
| ラウンド数 | 1 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260914_180711_parallel-progress-markerのplaceholder誤検知を修正する` |
| 仕様の所有箇所 | REQ-SQ-008、REQ-WF-021、CLI契約、要件追跡表、変更履歴 |
| 成果物行数 | 製品source・dist 51追加2削除、test 299追加1削除、仕様15追加5削除 |
| 縮小の先行評価 | 既存`unresolvedPlaceholders`の単一入口を流用した。marker allowlistはcomment一般の契約を満たさず、既存code/Gherkin除外だけではHTML commentを扱えない |
| 実施者・日時 | reviewer: Claude Opus 5 / effort high / read-only、2026-09-14T10:41:00Z。coordinatorは証拠を集約 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点、敵対8観点、finding分類 | critical | Claude上限 | Opus 5、effort high | reviewer不成立または未解決Critical/Highなら停止 | implementerはCodex routing launchの別context。review前後diff digest一致、reviewerの変更path 0件 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1370、staging 00〜03 | AC-SQ-008、AC-WF-021、INV-1370-01〜04 | 既存文書 |
| 差分 | `b4eaa5ad2c7c0c29ea32e63c312b7d4c2e996a91`..`62b5f4f987af41a0bb7ac7fa3b8592dc25269e81` | 11 path、diff digest `2c122007dbf4878aca8ac09a1e2fc6e10b2915e267f94dab2fde89513743fec9` | Git観測 |
| テスト | `npm test -- ...`、`npm run verify:distribution` | 2014 scenarios、失敗0、全配布gate合格 | coordinator実行のテスト出力 |
| 仕様 | `docs/specs/02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | 11 path manifest | H_impl `62b5f4f987af41a0bb7ac7fa3b8592dc25269e81` | Git観測 |
| Phase A artifact | 本file | H_impl後に本fileだけをcommitしてH_finalとする | Git観測 |
| review session | 同staging、round 1 | anchorはexact H_impl、AC・INV・diff digestへbinding | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。
- `H_impl`から`H_final`への差分は本artifact 1 fileだけにする: はい。
- reviewerの独立性は`context-isolated`を満たす: はい。
- Phase BのPR・CI証拠は本artifactへ書かず、PR作成後の`review evidence`へ委譲する: はい。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | spec | markerとprogressの所有契約 | 要件から実装へ一方向 | AC-WF-021 | 文書と実装を同時revert | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | spec | spec | placeholder境界の所有契約 | 要件から実装へ一方向 | AC-SQ-008 | 文書と実装を同時revert | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec | spec | CLI外部契約 | 要件を参照 | AC-SQ-008、AC-WF-021 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | spec | AC・SCN・実装の対応 | cycleなし | 全ISSUECOMMENT SCN | 行の前進修正 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | spec | 変更理由と互換性 | cycleなし | Issue #1370 | 行の前進修正 | pass |
| `src/domain/issue.ts` | M | package | package | 共有placeholder検出 | Issue/PRから単方向呼出 | AC-SQ-008、INV-1370-01〜04 | 関数変更をrevert | pass |
| `test/features/e2e/issue-placeholder-cli.feature` | A | test | project | 配布CLIの実process確認 | CLIへ単方向 | SCN-E2E-ISSUECOMMENT-001 | test追加のrevert | pass |
| `test/features/integration/issue-template-contract.feature` | M | test | project | validationとreview初期化の結合確認 | adapterへ単方向 | SCN-INT-ISSUECOMMENT-001 | test追加のrevert | pass |
| `test/features/unit/issue-template-contract.feature` | M | test | project | comment境界の例示 | domainへ単方向 | SCN-UNIT-ISSUECOMMENT-001〜004 | test追加のrevert | pass |
| `test/steps/issue-template-contract.steps.ts` | M | test | project | 上記SCNの実行step | domain/adapterへ単方向 | 全ISSUECOMMENT SCN | 一時fixtureのみ | pass |

- 基準SHAとの差分から生成済み配布物`dist/`を除いた個別監査対象と表のpath集合が完全一致する: はい、10件。`dist/src/domain/issue.js`は配布物影響を8節で別途監査する。
- package層へproject固有値、spec/evidence層へ実行authorityを混入していない: はい。
- 個別findingはF-01、F-02として記録し、Medium/Lowだけを理由に自動修正していない。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

03の発見記録は「現時点で発見なし」。Step 9でSCNとintegration証拠の計画不一致をcoordinatorが検出し、独立implementerへ差し戻して同期済み計画へ一致させた。要求・scope・security境界・不可逆操作は変更していない。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-SQ-008 | SCN-UNIT-ISSUECOMMENT-001〜004 | `src/domain/issue.ts` | 19実行ケース合格 | pass、F-01/F-02を残存記録 | Cucumber全体結果とClaude read-only反例 |
| AC-WF-021 | SCN-INT-ISSUECOMMENT-001 | `src/domain/issue.ts`、`src/domain/review-progress.ts`、`src/adapters/review-session.ts` | 1ケース合格 | pass | 同じ03 bytesのinventory bindingと非永続preview |
| AC-SQ-008、AC-WF-021 | SCN-E2E-ISSUECOMMENT-001 | `dist/bin/agent-skill-chain.js` | 1ケース合格 | pass | 配布CLI exit 0、valid true、marker保持 |

### 2.2 開発考慮事項の適用判定

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | validatorの除外境界は品質gateの盲点になり得る | 未終端・Unicode・comment外・件数上限SCN、F-01/F-02 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | placeholder診断を運用判断に使う | 原文全体を追加保存せず候補5件と残数を維持 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | Node CLIのvalidator変更で、画面・操作順・支援技術向けUIを所有しない | package.jsonのbin、CLI契約、UI sourceなし |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚component、theme、breakpoint、layoutを所有しない | projectKind=cli、UI sourceなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 正規markerと完全commentを除外し未終端を保持 | pass | Claudeが配布distで正規marker、未終端、sort/dedup、5件上限を実測 |
| 価値 | 配布templateとvalidatorの自己矛盾を解消 | pass | marker付きfull stagingがvalidになる |
| 実現可能性 | 新依存・I/O・権限なし | pass | 文字列変換のみを追加し、SCN-UNIT-ISSUECOMMENT-001〜004で検証 |
| 整合性 | 要求・設計・source・dist・SCN・仕様 | pass | trace/conformance/build合格 |
| 保守性 | 共有入口1箇所の最小追加 | pass | Issue/PRの2 callerが同じ関数を利用 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | commentとfence/Gherkinの交差 | finding | F-01、F-02 |
| 失敗経路 | 未終端、comment外、PR見出し | pass | SCN-UNIT-ISSUECOMMENT-003/004 |
| 境界値 | 空、複数行、隣接、Unicode、最大件数 | pass | 19 unit実行ケースとClaude実測 |
| 悪用 | 後続placeholderを隠す入力 | finding | F-01 |
| 安全性 | 認証・authority・秘密情報への影響 | pass | 外部状態を扱わない文字列変換であり、SCN-UNIT-ISSUECOMMENT-001〜004で検証 |
| データ損失 | 入力fileを変更しない | pass | validation後の03 bytes一致 |
| ロールバック | source・dist・仕様を前進revert可能 | pass | 永続形式・migrationなし |
| 範囲漏れ | Issue/PR caller、progress、dist、仕様 | pass | 11 path監査、F-01/F-02は記録済み |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| F-01 | Medium | comment除外がcode除外より前で行構造を書き換え、comment内外に奇数個のfence delimiterが交差すると後続placeholderを隠せる | `src/domain/issue.ts:694`。Claudeがbaseでは候補あり、H_implでは候補なしの3入力を実測 | 00〜03結合検証とPR本文 | Mediumのため自動修正せず記録 | valid / invariant-violation | consumer文書の特殊なcomment/fence交差で品質gateの受理集合が広がる |
| F-02 | Low | 単一行commentを改行へ置換するとGherkin step末尾comment後のbrace tokenが既存除外から外れる | `src/domain/issue.ts:681`。`Given 前提 <!-- c --> {outside}`の挙動差 | Gherkinを含むIssue/PR本文 | Lowのため自動修正せず記録 | valid / fix-regression | 従来有効な特殊行がinvalidになる |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。肯定5観点、敵対8観点、生成済み配布物を除く個別監査対象10 pathを確認。配布物1 pathは8節で確認。
- 指摘を確定した: F-01 Medium、F-02 Low。
- 次ラウンド対象のCritical/High: なし。

### ラウンド2

- 対象外: Critical/Highがなく、Medium/Lowだけを理由に追加roundを起こさない。

### ラウンド3

- 対象外: round 1で収束。

## 7. テスト結果

- 実行したcommand: `npm test -- test/features/unit/issue-template-contract.feature test/features/integration/issue-template-contract.feature test/features/e2e/issue-placeholder-cli.feature`（Cucumber設定により全Featureと結合）、`npm run verify:distribution`。
- 全layerの合計: 2014 scenarios、1998成功、失敗0、16 skip。10554 steps、10504成功、失敗0、50 skip。
- skipがある層: project選択3層を含む全体で16 scenario・50 step。既存条件付きskipであり本変更の失敗ではない。
- runner・方言: cucumber-js、`en`。説明は日本語。
- Claude reviewerはsuiteを再実行せず、coordinatorの出力整合とsource/distをread-onlyで確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/issue.ts` | 入る | IssueとPR本文の完全HTML comment内placeholderを除外する |
| `dist/src/domain/issue.js` | 入る | 上記sourceの配布生成物 |

判断: 配布物を更新した

根拠: source、対応dist、CLI外部契約、要件、追跡を同じH_implで更新した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはCodex routing launchの別context、reviewerはClaude Opus 5のread-only非永続context |
| reviewerが対象差分を変更していないこと | はい。review前後のtarget diff SHA-256は`2c122007dbf4878aca8ac09a1e2fc6e10b2915e267f94dab2fde89513743fec9`、変更path 0件 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: REQ-WF-021、REQ-SQ-008、CLI契約、要件追跡表、変更履歴。
- ドメイン用語台帳: TERM-ASC-107を既存意味のまま参照し、新語・意味変更なし。
- 未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止: なし。
- 要件・変更・SCN・テストの追跡: trace check合格。4 unit SCN・19実行ケース、1 integration、1 E2Eと表が一致。
- `no-spec-impact`の場合の限定的根拠: 非該当。
- UI・トークンの判断: いずれもnot-applicableで、CLI/非UIの根拠あり。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。
- Medium/Lowの記録: F-01 Medium、F-02 Low。
- 判定: approved
- 新しい権限が必要な事項: Phase A artifact commit、push、PR作成、merge。repository ownerから自走mergeまで承認済み。
- 残存リスク: commentとfence/Gherkinが交差する特殊入力でF-01/F-02の受理集合差がある。現行template・staging corpusに到達例はない。
- 次に許可される操作: round 1を保存し、本artifactだけをcommitしてH_finalを固定し、Step 10記録後にPR作成へ進む。
- 次回の再開地点: review session latest round digest、H_impl、H_final、Project #8の#1370=`In progress`。
