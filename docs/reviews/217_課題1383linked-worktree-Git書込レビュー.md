# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1383 linked worktree Git書き込み対応 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | `a51238a3d913d0bf419bdfe28fc0609fe8beb247` |
| 比較基点 | `dbeb61ce2c95e92acbc1628aa4fa51ed1e492a59` |
| H_impl | `a51238a3d913d0bf419bdfe28fc0609fe8beb247` |
| 対象差分 | 19 path |
| 対象外 | Codex sandbox本体、任意write root、read-onlyのwrite権限、Windows、既存用語表分断 |
| 残り予算 | 4 counted round |
| ラウンド数 | 2 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260913_223745_routing-linked-worktree-git-write` |
| 仕様の所有箇所 | `docs/specs/01_システム概要/`、`02_要件/`、`04_機能/`、`06_外部インターフェース/`、`10_セキュリティ/`、`12_運用保守/`、`14_開発・品質/`、`15_要件追跡/` |
| 成果物行数 | 19 path、基礎差分+972/-0とmain追随後の局所調整 |
| 縮小の先行評価 | gitDirだけではcommon objects・refs等を満たさないため、相互検証したgitDir/commonDirだけを配送する |
| 実施者・日時 | Claude Opus read-only reviewer、2026-09-14T06:55:00+09:00 |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding、exact-head | critical | Claude | `opus`、high、実効`claude-opus-5` | Critical/High未解決なら停止 | 別context、Read/Grep/Globのみ、変更0件 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1383 staging | AC-1383-01〜04、INV-1383-01〜03、digest `d9d56b55c47188defcba46fb1abdecbfe51c0787a14e9105831760dab786becf` | staging |
| 差分 | `dbeb61ce2c95e92acbc1628aa4fa51ed1e492a59`..`a51238a3d913d0bf419bdfe28fc0609fe8beb247` | 19 path | Git |
| テスト | exact H_impl | 4 scenarios / 20 steps、canonical macOS 11 / 55、mutation、実Codex成功 | 実行観測 |
| 仕様 | 8領域 | updated、TERM-ASC-116とAC/SCN追跡あり | 既存文書 |
| commit前candidate | 変更19 path | H_impl `a51238a3d913d0bf419bdfe28fc0609fe8beb247` | Git |
| Phase A artifact | 本file | H_impl後のartifact-only commitで固定予定 | Git |
| review session | staging | session `fe212bc20c7cf0a066eadc149642127e46409534c7036c5cb99d2e8af5542078`、Round 2 `8f6bff5a606824579b51a428aacae5027aa773b5f40295dcd844f61b577b4178`、converged、内容等価reanchor済み | 耐久session |

- Evidence graphはIssue→RQ/INV→resolver→argv→result→test/reviewの一方向で、cycle・自己評価・artifact自己SHAなし。
- `H_impl`はartifact-only `H_final`の親としてcommit後に確認する。
- Claude CLIの別sessionへRead/Grep/Globだけを許可し、対象差分変更は0件。
- Phase BのPR・CI証拠はPR作成後にdelivery stateへ記録する。
- main追随mergeは両親のtokenを保持し、TERM-ASC-116訂正を後続commitへ分離した。review済みtreeとの内容等価性は`review reanchor`が確認した。

### 1.1 変更ファイル個別監査

生成済み`dist/`3 pathは配布物影響で監査し、個別監査表からは規約どおり除外する。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/01_システム概要/02_用語・略語.md` | M | spec | terminology | TERM-ASC-116 | 要件→仕様 | 全AC | 既存分断記録 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | requirements | write契約 | 要件→実装 | 全AC | fail-closed | pass |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | M | spec | feature | launch挙動 | 要件参照 | AC-01〜03 | fail-closed | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec | interface | CLI/argv | adapterへ | 全AC | 任意flagなし | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | security | security | path境界 | resolverへ | 全INV | 残差記録 | pass |
| `docs/specs/12_運用保守/00_運用設計.md` | M | operations | operations | rejection復旧 | result参照 | AC-02 | generic診断 | pass |
| `docs/specs/14_開発・品質/02_テスト標準.md` | M | quality | quality | test限界 | SCN参照 | 全SCN | dogfood補完 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | trace | trace | AC→SCN | verified | 全AC/SCN | orphan 0 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | trace | history | #1383履歴 | 仕様参照 | 全AC/SCN | base固定 | pass |
| `src/adapters/codex-execution.ts` | M | runtime | adapter | 固定argv | roots受領 | AC-01/03 | shell不使用 | pass |
| `src/adapters/codex-launch.ts` | M | routing | application | preflight | resolver→execute | AC-02/04 | dispatch前拒否 | pass |
| `src/adapters/git-workspace.ts` | A | routing | adapter | topology resolver | 逆依存なし | 全AC/INV | symlink/TOCTOU拒否 | pass |
| `test/features/integration/codex-launch.feature` | M | test | integration | linked成功例 | launch観測 | SCN-INT-ROUTING-1383-001 | fixture | pass |
| `test/features/unit/codex-launch.feature` | M | test | unit | rejection例 | launch観測 | SCN-UNIT-ROUTING-1383-002〜004 | hostile入力 | pass |
| `test/steps/git-workspace.steps.ts` | A | test | adapter | argv/Git観測 | feature→runtime | 全SCN | leakage assertion | pass |
| `test/support/git-workspace-fixture.ts` | A | test | support | linked fixture | test専用 | 全SCN | repo外tmp | pass |

- 差分path集合から生成物3件を除く16 pathと表は完全一致する。
- package、spec、test、evidenceの責務越境はない。
- Medium/Lowはrecord-onlyとしてproduct差分を自動拡大していない。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1383-001 | sourceとCLI helpが2 root設計を支持 | 全AC | なし | Redから実装 | Red→Green、mutation、dogfood | updated | pass |
| DISC-1383-002 | 旧用語IDが使用済み | 用語 | なし | 前向き訂正 | staging/spec一致 | updated | pass |
| DISC-1383-003 | mainがTERM-ASC-115を#1389へ割当済み | 用語 | なし | #1383を116へ訂正 | exact base、trace | updated | pass |
| DISC-1383-004 | 統合Whenが既定5秒超過 | test | なし | 当該stepだけ15秒 | 4 scenarios / 20 steps | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1383-01 | SCN-INT-ROUTING-1383-001 | roots配送 | pass | pass | exact argv・index・dogfood |
| AC-1383-02 | SCN-UNIT-ROUTING-1383-002 | provider前拒否 | pass | pass | hostile topology、execute 0 |
| AC-1383-03 | SCN-UNIT-ROUTING-1383-003 | legacy argv | pass | pass | read-only・primary |
| AC-1383-04 | SCN-UNIT-ROUTING-1383-004 | generic診断 | pass | pass | private値非包含 |

### 2.2 開発考慮事項の適用判定

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | filesystem境界変更 | link・symlink・env・TOCTOU・漏洩反例 |
| DC-OBSERVABILITY | Secure Logging・Observability | applicable | false success解消 | rejected、dispatched=false、generic診断 |
| DC-UX | UI/UX・アクセシビリティ | not-applicable | 画面契約なし | CLI JSON/errorのみ |
| DC-TOKENS | Design/Layout Token | not-applicable | layout変更なし | UI pathなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | linkedだけへroots配送 | pass | 3責務と4 SCN |
| 価値 | worktreeとGit書込を両立 | pass | dogfood成功 |
| 実現可能性 | 新規runtime依存なし | pass | 固定argv |
| 整合性 | source/dist/spec/test一致 | pass | gates、19 path |
| 保守性 | resolverを分離 | pass | cycleなし |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | forged・別repo・bare・非Git | pass | negative variants |
| 失敗経路 | Git失敗・途中変化 | pass | 観測前拒否・再検証 |
| 境界値 | 空・複数行・Unicode・上限 | pass | validators |
| 悪用 | traversal・symlink・fake Git | pass | O_NOFOLLOW・argv array |
| 安全性 | 権限過大 | finding | commonDir残差 |
| データ損失 | preflight writeなし | pass | read-only query |
| ロールバック | 未起動で保持 | pass | 単一revert可能 |
| 範囲漏れ | 環境差 | finding | Git版等を記録 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| F-1383-R2-01 | Medium | 既存用語表分断 | mainと65fac234 | docs | follow-up候補 | valid / out-of-scope / record-only | 表外表示 |
| F-1383-R2-02 | Medium | commonDirはhooks/config含む | resolver L167 | linked Git | 採用trade-off | valid / record-only | 操作単位認可でない |
| F-1383-R2-03 | Medium | 広いfail-closed | resolver | workspace-write | 仕様確定 | valid / record-only | 一部互換性縮小 |
| F-1383-R2-04 | Low | timeout 15秒 | test L70 | test | bounded | valid / record-only | 再接近時最適化 |
| F-1383-R2-05 | Low | 最終拒否は例外表現 | execution | CLI | 未起動 | valid / record-only | state表現差 |
| F-1383-R2-06 | Low | Git 2.31以上 | path-format | 旧Git | generic拒否 | valid / record-only | version不明 |
| F-1383-R2-07 | Low | test Git操作はsandbox外 | test | evidence | dogfood補完 | valid / record-only | CI非実Codex |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。
- 指摘を確定した: Medium 3、Low 4、全てrecord-only。
- 次ラウンド対象のCritical/High: なし。

### ラウンド2

- 未解決Critical/High: なし。
- 修正差分: main追随、TERM-ASC-116、bounded timeout、base SHA訂正。
- 修正で触れた隣接範囲: target 19とstaging 00〜03。
- 既承認・未変更範囲を再走査していない: parent全19 review後、closureは2 specsとstaging 03。

### ラウンド3

- 全指摘の最終分類: Round 2で収束。
- 危険範囲の縮小: 相互検証済みlinkedだけ。
- 同じ範囲の予算を自動更新していない: はい。
- AIによる最終裁定: Critical/High 0でapproved。

## 7. テスト結果

- 実行command: `cucumber --tags @routing-1383`、canonical `TMPDIR`の`@codex-launch`、typecheck、lint、format、docs、trace、Linux distribution gate、実routing dogfood。
- 全layer: 4 scenarios / 20 steps成功、canonical macOS 11 / 55成功。mutation kill。Linux broad 1975中1947 pass・16 skip・12 failは既存PoCの`/usr/bin/bwrap`欠落。macOS非canonical `/var/...`の334件は`/var -> /private/var`のsymlink祖先拒否で、canonical対象run全成功のため拒否を緩和しない。
- runner・方言: Cucumber.js、en、unit/integration/e2e。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `dist/src/` | 入る | source対応生成物 |
| `src/adapters/codex-execution.ts` | 入る | linked rootsの固定argv |
| `src/adapters/codex-launch.ts` | 入る | 起動前拒否と再検証 |
| `src/adapters/git-workspace.ts` | 入る | topology解決 |
| `docs/specs/` | 入る | 公開契約と追跡 |
| `test/` | 入らない | 品質証拠 |

判断: 配布物を更新した

根拠: sourceとdistを同期し、外部観測可能なCLI・sandbox境界変更を仕様へ反映した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementer Codexとは別provider。Claude session `ae1cd178-21fd-4aaa-ac29-6382388820ba`と`70638264-3fec-48a0-a3e7-107ee6435559`、実効`claude-opus-5` |
| reviewerが対象差分を変更していないこと | はい（Read/Grep/Globのみ、変更0件） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: 用語、要件、機能、CLI、信頼境界、運用、test標準、追跡、履歴。
- ドメイン用語台帳: #1389のTERM-ASC-115を保持し#1383をTERM-ASC-116へ訂正。
- 未定義・重複・意味変更: #1383範囲ではなし。既存表分断は対象外記録。
- 要件・SCN・test: AC 4件とSCN 4件がsource/testへ到達しtrace valid。
- `no-spec-impact`: 該当なし。
- UI・token: 非該当。UI/layout/theme変更なし。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Low: Round 2 digest `8f6bff5a606824579b51a428aacae5027aa773b5f40295dcd844f61b577b4178`へrecord-only保存。
- 判定: approved
- 新しい権限が必要な事項: 新branch pushとPR作成。merge・release・cleanupは別authority。
- 残存リスク: commonDir、互換性縮小、旧Git、実Codex CI非自動、既存用語表分断。
- 次に許可される操作: artifact-only commit、Step 10、push、PR作成。
- 次回の再開地点: H_final作成とStep 10。
