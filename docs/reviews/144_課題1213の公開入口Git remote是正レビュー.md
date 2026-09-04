# 144 課題1213の公開入口Git remote是正レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1213 |
| ラウンド | Step 10 ラウンド1〜2 |
| 比較基点 | `34935668c086db9a819b2feda9553298fff80272` |
| H_impl | `86153571bef659264fad316a1ebebe2daf789d70` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | full（Q-01がfalse） |
| 対象差分 | 8 file、+240 -8。commitは`47030988`と`86153571`（取り込みの前進commit）。取り込みroundでは`比較基点..H_impl`へ最初のartifact commitが入る |
| 対象外 | `prepare`の承認待ち（**#1187**。承認機構つき環境で`dist/`が生成されない）。npm registryへの公開（**#984 で対応しないと決裁済み**）。`cli-usage.ts`の48件のusage例。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **1**（同一範囲で最大3ラウンド、収束後にHEADが動いたときの取り直しを1回まで） |
| ラウンド数 | 2。ラウンド2は`pr create`後の外部指摘の取り込みである（#1194・#1201の経路） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260904_161231_公開入口の取得元をnpm-registryからGit-remoteへ是正する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-005（**改訂**） |
| 成果物行数 | 配布文書 **+21 -2行**（README +8、中央利用案内 +11 -1、機能仕様 +1 -1）。仕様 **+2 -1行**。支援層 **+20 -3行**（既存scenarioの延長のみ）。**支援層/成果物 = 0.95倍** |
| 縮小の先行評価 | **48件のusage例を書き換える案を先に評価し、採らなかった。** `check_cli_contract.ts` が README・中央利用案内へ `npx agent-skill-chain <command>` の字面を要求しており、書き換えると検査も同時に変える必要がある。**短縮表記の定義を1箇所へ置けば、48件は定義により正しくなる。** 新規SCNも足していない |
| 決裁 | **owner決裁（2026-09-04）。**「Git以外で公開するつもりがない」「npxでのインストール及びアップデートしか対応しない」 |
| 実施者・日時 | reviewer（claude）、2026-09-04（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、**判断の根拠をすべて実行結果に置いたこと**（`npx` 3形式の実測、`check_cli_contract.ts` の実読）、両方向の変異試験を行ったことである。
2. **本Issueの起点は、自分の誤った推論である。** 「仕様が `npx agent-skill-chain` と定めている」から「publishが必要」と結論し、owner へ token 登録と environment 作成を要求した。**実測が先だった。** 5節F-03に記録する。
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| registryの状態 | `npm view agent-skill-chain version` | `npm error code E404` | 実行記録 |
| Git remote経路（最新） | `npx --yes "github:techbeansjp-free/AGENTS.md" --help` | **成立。`real 0m21.288s`** | 実行記録 |
| 同（subcommand） | `npx --yes "github:..." doctor --help` | 成立 | 実行記録 |
| 同（版固定） | `npx --yes "github:...#v0.3.1-beta.83" --help` | 成立 | 実行記録 |
| 字面の要求 | `scripts/check_cli_contract.ts:80-84` | README・中央利用案内へ `npx agent-skill-chain <command>` を要求する | 一次資料 |
| 誤った版固定形 | `.agent-skill-chain/00_利用案内.md` | 「versionを固定するときはpackage名を`agent-skill-chain@<version>`とする」。**registryを引く形で成立しない** | 一次資料 |
| テスト | `npm run conformance:check` | `1495 scenarios (1479 passed, 16 skipped)` | テスト出力 |
| commit前candidate | 6 file | working tree clean | Git index |
| Phase A artifact | `docs/reviews/144_課題1213の公開入口Git remote是正レビュー.md` | `H_impl` = `47030988`。`H_impl..H_final`の差分pathは本file 1件 | Git観測 |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `README.md` | M | project | project | 入口の節を1つ足した。**既存のlifecycle表と48件の例を変えていない** | 適合 | REQ-SQ-005 / AC-02〜AC-04 / SCN-UNIT-README-001 | 記述だけで実行authorityを持たない | pass |
| `.agent-skill-chain/00_利用案内.md` | M | project | project | 同じ節を足し、registry前提の版固定形を `#<tag>` へ直した | 適合 | 同上 + INV-03 | 同上 | pass |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | M | project | spec | 公開入口の定義を取得元まで含めて述べ直した | 適合 | REQ-SQ-005 / AC-01 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | project | spec | REQ-SQ-005へ取得元の要求を追記した | 適合 | REQ-SQ-005 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴を1行足した | 適合 | 同上 | 同上 | pass |
| `test/features/unit/root-readme.feature` | M | package | package | 既存scenarioの説明文を新しい性質へ直した。**scenario数を増やしていない** | 適合 | AC-05 | fixtureは実fileの読み取りで外部へ到達しない | pass |
| `test/steps/root-readme.steps.ts` | M | package | package | 既存 `SCN-UNIT-README-001` のWhenへ中央利用案内の読み取りを足し、Thenへ肯定assertと否定assertを置いた。取り込みで否定assertを両文書へ広げ、devDependencies取得のassertを足した。**新規SCNを足していない** | 適合 | AC-02〜AC-05 | fixtureは実fileの読み取りで外部へ到達しない | pass |
| `docs/reviews/144_課題1213の公開入口Git remote是正レビュー.md` | A | project | project | 本artifact。**取り込みroundでは`比較基点..H_impl`へ最初のartifact commitが入るため、自身を個別監査行に持つ**（#1194の新経路の構造的帰結） | 適合 | REQ-SQ-005 | 記述だけで実行authorityを持たない | pass |

## 2. 受け入れ条件の確認

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | 原文読解 | 機能仕様 | — | pass | 「取得元はnpm registryではなくGit remoteである」を書いた |
| AC-02 | SCN-UNIT-README-001 | README・中央利用案内 | `1 scenario (1 passed)` | pass | 両文書へ `npx github:techbeansjp-free/AGENTS.md ` をassertする |
| AC-03 | SCN-UNIT-README-001 | 同上 | 同上 | pass | `npx github:techbeansjp-free/AGENTS.md#<tag>` をassertする。変異M2でkill |
| AC-04 | SCN-UNIT-README-001 | 同上 | 同上 | pass | `短縮表記` をassertする。**48件のusage例の差分は0行である** |
| AC-05 | SCN-UNIT-README-001 | — | 同上 | pass | 既存scenarioを延ばした |
| AC-06 | cli:check、SCN-UNIT-README-001〜004 | 変更なし | `cli:check valid True`、`20 steps (20 passed)` | pass | 字面を保持した |

### 2.2 不変条件

| INV ID | 内容 | 判定 | 証拠 |
|---|---|---|---|
| INV-01 | `npx agent-skill-chain <command>` の字面を保持する | pass | lifecycle表を変えていない。`cli:check` 合格 |
| INV-02 | 旧CLI aliasを公開commandとして案内しない | pass | `SCN-UNIT-README-002` が合格を維持する |
| INV-03 | registry前提の版固定形を案内しない | pass | 否定assertを置いた。変異M1でkill |

## 3. 肯定的評価

- **実測が結論を覆した。** 「仕様が `npx agent-skill-chain` と定めている」から publish 必要と考えていたが、`npx` は Git remote から21秒で動いた。**誤っていたのは実態ではなく記述だった。**
- **owner の手間をゼロにした。** token 発行も environment 作成も不要になった。
- **48件を書き換えなかった。** `check_cli_contract.ts` の要求を先に読み、短縮表記の定義を1箇所へ置く形にした。**差分は0行である。**
- **否定assertを置いた。** registry前提の版固定形が残っていないことを要求しないと、併記が通る。
- **新規SCNを足さなかった。** `SCN-UNIT-README-001` が同じ対象・同じ向きである。

## 4. 敵対的評価

| 観点 | 攻撃 | 結果 |
|---|---|---|
| 記述の後退 | 中央利用案内の版固定形をregistry前提へ戻す | 変異M1でkill |
| 記述の欠落 | READMEから版固定の行を削る | 変異M2でkill |
| 片側だけの是正 | READMEだけ直して中央利用案内を残す | **両方をassertした** |
| 字面の破壊 | lifecycle表をGit remote形へ書き換える | `cli:check` が `npx agent-skill-chain <command>` を要求して失敗する |
| 実効性の欠落 | 文書を直しても承認機構つき環境では動かない | **成立する。** 5節ADV-01に記録し #1187 へ委ねる |
| 陳腐化 | 具体的なtag番号を書くと古くなる | **`#<tag>` の記号形にした。** 具体値は例示の括弧内だけである |

## 5. 指摘

| ID | severity | 事実 | 観測 | 由来 | 対処 | 判定 | 残余 |
|---|---|---|---|---|---|---|---|
| F-01 | **High** | **案内どおり実行すると404になっていた。** README・中央利用案内・機能仕様が registry を前提にしており、`npm view agent-skill-chain` は E404 である | 実行記録 | 実測 | 取得元をGit remoteとして記述し直した | valid / resolved | ADV-01 |
| F-02 | Medium | **中央利用案内がregistry前提の版固定形を案内していた。** `agent-skill-chain@<version>` はregistryを引く形で成立しない | 原文読解 | 実測 | `#<tag>` へ直し、否定assertで固定した | valid / resolved | なし |
| F-03 | **High** | **「publishが必要」という自分の結論が誤りだった。** 仕様の記述を実態と取り違え、owner へ token 登録と environment 作成を要求した | 自己観測 | 実測 | 実測して撤回し、#984 を「対応しない」でcloseした。**#1199 の D-3（実測できることを推論しない）へ記録する** | valid / resolved | なし |
| DISC-1102 | Low | **`check_cli_contract.ts` が字面を要求する。** 48件の書き換え案が成立しない | 実コード読解 | 実測 | 短縮表記の定義を1箇所へ置く形にした | valid / resolved | なし |
| ADV-01 | **High** | **文書を直しても、承認機構つき環境では入口が成立しない。** `npx github:` 経路は `prepare` を走らせて `dist/` を作るが、pnpm は既定で `onlyBuiltDependencies` の承認を要求する。**利用側は pnpm である** | 敵対評価 | 実測（#1187） | **本Issueでは修正しない。** 配布境界の変更でありowner決裁を要する。**#1187 へ案A〜Dの決裁材料を掲示した。#1025 の唯一のブロッカーである** | valid / record-only | 承認機構つき環境で入口が成立しない |

| F-04 | **Major** | **「registryは一切介在しない」は言い過ぎだった。** Git取得時は`prepare`が`npm run build`を実行するため、その過程でdevDependenciesをregistryから取得する。**registryから解決しないのは本package自体だけである** | PR #1214 の外部review | 外部review | 両文書へdevDependenciesの取得を明記し、`agent-skill-chain@<version>`が成立しない理由も書いた。assertで固定した。変異M3でkill | valid / resolved | なし |
| F-05 | Minor | **旧版固定形の否定assertが中央利用案内だけだった。** READMEへ復活しても通る | 同上 | 外部review | 両文書へ広げた。変異M4でkill | valid / resolved | なし |
| F-06 | — | 「短縮表記の定義をREADMEから消し中央利用案内へ集約せよ」 | 同上 | 外部review | **valid でない。** READMEは`.agent-skill-chain/`を開かない読者のための公開入口であり、参照だけにすると入口の意味が失われる。**両方に置くのは意図した重複である**。`SCN-UNIT-README-001`も両文書を検査する | **invalid** | 定義が2箇所にある |
| F-07 | — | 「独立review完了前にapprovedを記録するな」 | 同上 | 外部review | **valid / out-of-scope。** 0.2節に逸脱として開示済みであり、本repositoryの全ASC PRに共通する構造条件である。指摘された是正（review例外の正本registry登録）は配布契約変更でありowner決裁を要する。canonical Issueは #1036 | valid / out-of-scope | #1036 |

**未解決のCritical / Highは0件である。** F-01・F-03・F-04は解消済み、ADV-01は記録のみで #1187 へ委譲した。

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | 入る | 利用側が**実際に動く入口**を読める。registry前提の版固定形が消える |
| `README.md` | 入る（`files`に含まれる） | 同上 |
| `docs/specs/04_機能/01_ワークフローv0.3.md` | 入らない | project所有の仕様であり利用projectには不在 |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | 入らない | 同上 |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | 同上 |
| `test/features/unit/root-readme.feature` | 入らない | `package.json`の`files`に含まれない |
| `test/steps/root-readme.steps.ts` | 入らない | 同上 |

判断: 配布物を更新した
根拠: 配布文書2件を更新した。**実行コードは変えていない。** `npx github:` 経路は元から成立しており、記述だけが実態と食い違っていた。

## 6. ラウンド固有の確認

### ラウンド1

- 対象: 実装差分の8 file。
- 確認: 個別監査8行、AC-01〜06、INV-01〜03、肯定5観点、敵対6観点、変異2件。
- 結果: blocking 0件。record-only 1件（ADV-01）。resolved 4件（F-01・F-02・F-03・DISC-1102）。

### ラウンド2

- 対象: `pr create`後に届いた外部指摘4件（F-04〜F-07）。**#1194・#1201 で入れた取り込み経路の適用である。**
- 確認: F-04を実コードの経路で確認した（`prepare` → `npm run build` → devDependencies取得）。**自分の記述が過大だった。** F-05・F-06は両文書の役割から判断した。是正は前進commitで行い、amendを使っていない。
- 結果: blocking 0件。resolved 2件（F-04・F-05）。**F-06は根拠つきでinvalid、F-07は範囲外と判定した。**

## 7. テスト結果

**表を書く前に1本ずつ実行した。**

| 層・検査 | コマンド | 件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---|---:|---:|---:|---|
| unit・integration・e2e | `npm run conformance:check`（内部で`npm test`を実行する） | 1495 | 1479 | 0 | 16 | pass |
| 静的検査 | `lint`・`format:check`・`typecheck`・`source:check`・`trace:check`・`architecture:check`・`project:quality`・`cli:check`・`workflow:check`・`package:check`・`skills:check`・`docs:format`・`test:format` | 13 | 13 | 0 | 0 | pass |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |

### 7.1 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | 中央利用案内の版固定形をregistry前提へ戻す | kill |
| M2 | READMEから版固定の行を削る | kill |
| M3 | READMEからdevDependencies取得の記述を削る | kill |
| M4 | READMEへ旧版固定形を書き足す | kill |

**4件ともkill。** M3とM4は外部指摘を受けて足した。 復元後に `SCN-UNIT-README-00` 系4件の再実行で緑を確認している。

## 8. 総合判定と再開地点

**approved。** 未解決のCritical / Highは0件である。再開地点は実装計画1節の順序表。
