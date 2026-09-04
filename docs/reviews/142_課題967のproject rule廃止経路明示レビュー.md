# 142 課題967のproject rule廃止経路明示レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #967 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `9a3303f28c1c1e1ac0fa095596cadd99bd682926` |
| H_impl | `41002b265280f3f8871a50d26c276567121ab244` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | full（Q-01がfalse） |
| 対象差分 | 8 file、+230 -4。commitは`aa13fd10`と`41002b26`（取り込みroundでartifact commitが`比較基点..H_impl`へ入る） |
| 対象外 | **廃止経路そのものの新設**（配布契約変更でowner決裁が要る）。`policy validate`が削除予定rule IDを機械可読に返すこと（**削除が受理されない現状では返す対象が無い**）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで） |
| ラウンド数 | 2。ラウンド2は`pr create`後の外部指摘の取り込みである（#1194・#1201の経路） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260904_112453_project-ruleの廃止経路と遷移モデルを診断と文書へ明示する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-004（**改訂**） |
| 成果物行数 | 製品 **+10 -2行**（`enforcement.ts`。うち7行はdoc comment）。配布文書 **+18行**（`00_利用案内.md`）。仕様 **+2 -2行**。支援層 **+68行**（feature +5、steps +63）。**支援層/成果物 = 2.4倍** |
| 縮小の先行評価 | **廃止経路の新設を先に評価し、採らなかった。** `projectChoiceShrinkProposals` をruleへ広げれば報告の要望を満たせるが、**検知の緩和条件を新設する配布契約変更**であり #1044 の先例どおりowner決裁を要する。また **新規SCNを1件だけにした。** `ASC-EFFECTIVE-001` 側は文言だけの変更であり、既存 `SCN-E2E-RISK-002` と重ならないため原文読解で足りる。**診断1つにつきscenario 1つを機械的に足さない** |
| 決裁 | 利用側報告 #967 への対応 |
| 実施者・日時 | reviewer（claude）、2026-09-04（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する。**本Issueの起点は外部の利用側報告である** |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、**要求の出所が外部の利用側projectであること**、報告の中心主張を実測で検証して差を特定したこと、両方向の変異試験を行ったことである。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 削除の拒否 | `compareTrustedPolicy` の直接呼び出し | `allowed: false`、理由 `trusted ruleを削除している` | 実行記録 |
| 現行 `next` | 同上 | `trusted条件を維持し、独立reviewと既定ブランチへの正規migrationを行ってください` | 実行記録 |
| 案内先の不在 | `src/domain/migration.ts:432`・`534` | `policy migrate` も `compareTrustedPolicy` を互換性判定に使う。**「正規migration」は製品内に無い** | 一次資料 |
| 二段階提案の対象 | `src/domain/project-choice-shrink.ts` | `SHRINKABLE_FIELD_PATHS` は `projectChoices` の3 fieldだけ。**ruleは対象外** | 一次資料 |
| 報告との差 | 報告本文 | 「manifestから外すと`policy validate`は成功する」は `--trusted-commit` なしの実行である | 一次資料 |
| 既存要求の維持 | `SCN-E2E-RISK-002` | `next` から「独立review」を落とすと失敗する。**実際に1度落として検出した** | テスト出力 |
| テスト | `npm run conformance:check` | `1495 scenarios (1479 passed, 16 skipped)` | テスト出力 |
| commit前candidate | 7 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/142_課題967のproject rule廃止経路明示レビュー.md` | `H_impl` = `41002b26`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/enforcement.ts` | M | package | package | 2つの診断の `next` 文字列だけを差し替えた。**判定分岐を1つも変えていない** | 適合。新しいimportを増やしていない。`architecture:check`合格 | REQ-SQ-004 / AC-01〜AC-03・AC-05 / SCN-UNIT-LEDGER-008 | 拒否集合・理由・`requiredAuthority`・`rollback` が同一である。revertで戻る | pass |
| `.agent-skill-chain/schemas/00_利用案内.md` | M | project | project | 「project ruleの廃止」節を1つ足した。既存節の順序を変えていない | 適合 | REQ-SQ-004 / AC-04 | 記述だけで実行authorityを持たない | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | REQ-SQ-004へ診断の要求を追記した | 適合 | REQ-SQ-004 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | 新規SCN 1件を結線した | 適合 | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴を1行足した | 適合 | 同上 | 同上 | pass |
| `test/features/unit/project-rule-ledger.feature` | M | package | package | scenario 1件を追加した。既存7件を1件も変えていない | 適合 | AC-01・AC-02・AC-05 | fixtureは構築したobjectで外部へ到達しない | pass |
| `test/steps/project-rule-ledger.steps.ts` | M | package | package | 対応するstep定義とworld fieldを追加した | 適合 | 同上 | 同上 | pass |
| `docs/reviews/142_課題967のproject rule廃止経路明示レビュー.md` | A | project | project | 本artifact。**取り込みroundでは`比較基点..H_impl`へ最初のartifact commitが入るため、自身を個別監査行に持つ**（#1194の新経路の構造的帰結） | 適合 | REQ-SQ-004 | 記述だけで実行authorityを持たない | pass |

## 2. 受け入れ条件の確認

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-LEDGER-008 | `ASC-TRUST-001` の `next` | `1 scenario (1 passed)` | pass | `既定branchのproject policy owner` と `候補側から適用する経路は製品CLIにありません` をassertする。変異M1でkill |
| AC-02 | SCN-UNIT-LEDGER-008 | 同上 | 同上 | pass | `manifestから外すだけでは受理されません` をassertする。変異M1でkill |
| AC-03 | 原文読解 | `ASC-EFFECTIVE-001` の `next` | — | pass | 「`active`から`disabled`へ戻せません」「既定branchのproject policy ownerのauthority操作になります」を書いた |
| AC-04 | 原文読解 | `00_利用案内.md` | — | pass | 拒否される5種の変更、遷移モデル、二段階提案がruleには無いことを書いた |
| AC-05 | SCN-UNIT-LEDGER-008、SCN-E2E-RISK-002 | 変更なし | `8 scenarios (8 passed)`、`1 scenario (1 passed)` | pass | 理由 `trusted ruleを削除している` と `requiredAuthority` を assert する。変異M2でkill |

### 2.2 不変条件

| INV ID | 内容 | 判定 | 証拠 |
|---|---|---|---|
| INV-01 | `compareTrustedPolicy` の拒否条件を1つも変えない | pass | 差分は文字列2箇所とdoc commentだけである |
| INV-02 | `requiredAuthority` を弱めない | pass | `default branch policy owner` のまま。変異M2でkill |
| INV-03 | 「独立review」の語を診断から落とさない | pass | `SCN-E2E-RISK-002` が要求する。**1度落として実際に失敗させ、戻した**（DISC-903） |

## 3. 肯定的評価

- **報告の中心主張と実測の差を特定した。** 「正規経路が機能する」は `--trusted-commit` なしの実行だった。**報告を字面で受け取ると、存在しない機能を前提に文書を書くことになる。**
- **案内先が製品内に無いことを実測で確かめた。** `policy migrate` も同じ判定を使う。**推論せず呼び出し元を全数確認した。**
- **判定を1つも変えていない。** 文言だけの変更に留め、authorityも弱めていない。
- **既存要求を1度壊し、機構が止めた。** `next` から「独立review」を落としたら `SCN-E2E-RISK-002` が失敗した。**削る前に何が依存しているかを検査が教えた。**
- **経路の新設を勝手に採らなかった。** #1044 の先例どおりowner決裁の対象である。

## 4. 敵対的評価

| 観点 | 攻撃 | 結果 |
|---|---|---|
| 文言の後退 | `next` を旧文言へ戻す | 変異M1でkill |
| authorityの弱化 | `requiredAuthority` を `project policy owner` へ | 変異M2でkill |
| 判定の緩和 | 削除を `allowed` にする | `SCN-UNIT-LEDGER-008` の `allowed === false` がkillする |
| 既存要求の破壊 | 「独立review」を落とす | `SCN-E2E-RISK-002` がkillする（**実際に発生した**） |
| 過剰な検査 | 診断ごとにscenarioを足す | **採らない。** `ASC-EFFECTIVE-001` 側は文言だけで、既存scenarioと重ならない |
| 実害の残存 | 廃止経路が製品内に無い状態は変わらない | **成立する。** 5節ADV-01に記録する |

## 5. 指摘

| ID | severity | 事実 | 観測 | 由来 | 対処 | 判定 | 残余 |
|---|---|---|---|---|---|---|---|
| F-01 | **High** | **拒否診断の案内先が製品内に存在しない。** 「既定ブランチへの正規migration」を案内するが、`policy migrate` も `compareTrustedPolicy` を使うため同じ理由で拒否する。**利用者を循環させる** | 実行記録と実コード読解 | 実測 | authorityと候補側経路の不在を返す形へ改めた。変異M1でkill | valid / resolved | ADV-01 |
| F-02 | Medium | **廃止手順と遷移モデルが配布文書に無かった。** 利用者は「active ruleは永久に廃止できない」と誤認する | 利用側報告 #967 | 外部の判断 | `00_利用案内.md` へ節を足した | valid / resolved | なし |
| F-03 | — | 「rule fileをmanifestから外すと `policy validate` は成功する」 | 同上 | 外部の判断 | **valid でない。** `--trusted-commit` なしの実行である。trusted比較を配線した環境では拒否される | **invalid** | 利用側CIの配線状況に依存する |
| DISC-901 | **High** | **廃止経路が製品内に存在しない。** 報告のAC-3（削除予定rule IDの機械可読な返却）は返す対象が無いため成立しない | 実測 | 実測 | 本Issueの範囲を診断と文書へ絞り、経路の新設を別Issueへ分離した | valid / record-only | ADV-01 |
| DISC-903 | Low | **`next` から「独立review」を落として既存 `SCN-E2E-RISK-002` を壊した** | `conformance:check` の失敗 | 機構 | 語を残す形へ直した。**機構が私の削りすぎを止めた** | valid / resolved | なし |
| ADV-01 | **Medium** | **project ruleの廃止経路が製品内に無い状態は本PRで変わらない。** `02_品質基準.md` の「永久に塞がる門を作らない」に対する未解決事項である | 敵対評価 | 敵対評価 | **本Issueでは修正しない。** 検知の緩和条件の新設は配布契約変更でありowner決裁を要する。**別Issueへ分離する。** 本PRはその状態を**隠さず返す**ようにした | valid / record-only | 廃止経路が無いまま残る |

| F-04 | Minor | **入力証拠表の集計が実行結果と食い違っていた。** 1節が `1478 passed`、7節が `1479 passed` で、1節は合計 1495 とも整合しない | PR #1210 の外部review | 外部review | 実行logの原文と照合して `1479 passed` へ是正した | valid / resolved | なし |

**未解決のCritical / Highは0件である。** F-01は解消済み、DISC-901は記録のみでADV-01へ集約した。

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/enforcement.ts` | 入る（`dist/src/`経由） | 利用側が受け取る拒否診断が、必要authorityと候補側経路の不在を返すようになる |
| `.agent-skill-chain/schemas/00_利用案内.md` | 入る | 利用側が廃止手順と遷移モデルを読める |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | 入らない | project所有の仕様であり利用projectには不在 |
| `docs/specs/15_要件追跡/00_追跡表.md` | 入らない | 同上 |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | 同上 |
| `test/features/unit/project-rule-ledger.feature` | 入らない | `package.json`の`files`に含まれない |
| `test/steps/project-rule-ledger.steps.ts` | 入らない | 同上 |

判断: 配布物を更新した
根拠: 実行コードと配布文書を更新した。**拒否する集合は変わらない。** 変わるのは利用者へ返す案内だけである。

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分の7 file。
- 確認: 個別監査8行、AC-01〜05、INV-01〜03、肯定5観点、敵対6観点、変異2件。
- 結果: blocking 0件。record-only 2件（DISC-901・ADV-01）。resolved 3件（F-01・F-02・DISC-903）。**F-03は実測で否定した。**

### ラウンド2

- 対象: `pr create`後に届いた外部指摘1件（F-04）。**#1194・#1201 で入れた取り込み経路の適用である。**
- 確認: 1節の入力証拠表の集計が `1478 passed` となっており、7節の `1479 passed` と食い違っていた。**実行logの原文（`1495 scenarios (1479 passed, 16 skipped)`）と照合して是正した。** 是正は前進commitで行い、amendを使っていない。
- 結果: blocking 0件。resolved 1件（F-04）。

## 7. テスト結果

**表を書く前に1本ずつ実行した。**

| 層・検査 | コマンド | 件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---:|---:|---:|---|
| unit・integration・e2e | `npm run conformance:check`（内部で`npm test`を実行する） | 1495 | 1479 | 0 | 16 | pass |
| 静的検査 | `lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`project:quality`・`cli:check`・`workflow:check`・`package:check`・`docs:format`・`test:format` | 12 | 12 | 0 | 0 | pass |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

**初回の `conformance:check` は1件失敗した。** `SCN-E2E-RISK-002` が `next` の「独立review」を要求しており、削ってしまっていた。語を戻して再実行し全合格を確認している。

### 7.1 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | `next` を旧文言へ戻す | kill |
| M2 | `requiredAuthority` を `project policy owner` へ弱める | kill |

**2件ともkill。** 復元後に `SCN-UNIT-LEDGER-0` 系8件の再実行で緑を確認している。

## 8. 総合判定と再開地点

**approved。** 未解決のCritical / Highは0件である。再開地点は実装計画1節の順序表。
