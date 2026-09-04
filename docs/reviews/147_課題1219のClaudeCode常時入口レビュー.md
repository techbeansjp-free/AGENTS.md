# 147 課題1219のClaude Code常時入口レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1219 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `de9dee38ea854f2021b6fc4e90fcaa9ebe3ddf20` |
| H_impl | `90b52cd93b0f47bd6758f941e4bf69cef3f70759` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | full（Q-01がtrue。配布物のfile一覧と`install`の展開対象が変わる） |
| 対象差分 | 7 file、+65 -8。commitは`90b52cd9` 1件 |
| 対象外 | hookの展開（#1105）。`.claude/`配下への資産追加。`AGENTS.md`の内容変更。3規範文書の内容変更。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **2**（同一範囲で最大3ラウンド。以降は収束後のHEAD移動に対する取り直し1回のみ） |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260905_080836_Claude-Code側に常時の入口が無く規範文書へ到達しない |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-001（**改訂**） |
| 成果物行数 | 製品 **+27行**（`CLAUDE.md` +5、`src/domain/lifecycle.ts` +16 -2、`package.json` +2 -1）。仕様 **+2 -1行**。支援層 **+23 -2行**（`test/steps/lifecycle-isolation.steps.ts`）。**支援層/成果物 = 0.85倍** |
| 縮小の先行評価 | **新しい機構を1つも足していない。** 既存の`ROOT_ASSETS`が配列であることをそのまま使い、既存 SCN-E2E-LIFECYCLE-001 の判定を強くした。**新規SCNを作らず、新規の強制点も足さなかった。** 代替3案（symlink、規約の要約転記、`HOST_SKILL_TARGETS`への追加）をいずれも棄却した。設計12節に理由を記す |
| 決裁 | **owner指摘（2026-09-05）。**「そもそもclaude.mdをリポジトリ直下に作成してないのも問題です」 |
| 実施者・日時 | reviewer（claude）、2026-09-05（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、判定の根拠をすべて実行結果に置いたこと（`install` previewの観測、変異試験2件、`npm pack`のfile数）と、**両方向の変異試験を行ったこと**である。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 欠落の実在 | `ls CLAUDE.md` / `find . -name CLAUDE.md -not -path ./node_modules/*` / `grep -rn CLAUDE.md src/ scripts/` | いずれも**0件**。repositoryにも製品にも存在しなかった | 実行記録 |
| host非対称 | `src/domain/lifecycle.ts` の `ROOT_ASSETS` と `HOST_SKILL_TARGETS` | 変更前の`ROOT_ASSETS`は`["AGENTS.md"]`の1件。`HOST_SKILL_TARGETS`は skill 2件のみ | 一次資料 |
| 展開の成立 | `install --root=<隔離先>`（preview） | `assets` に `<root>/AGENTS.md` と `<root>/CLAUDE.md` の**両方**が現れる | 実行記録 |
| 所有判定の重複 | M2適用後の `update --apply` | `managed asset recordが不正です: CLAUDE.md`。**展開はされるがrecord検証が拒否する** | 実行記録 |
| 配布 | `npm pack --dry-run --ignore-scripts --json` | **343 file**（変更前342）。`CLAUDE.md` と `AGENTS.md` の両方が含まれる | 実行記録 |
| 正本単一化の限界 | `.agent-skill-chain/policy/canonical-contracts.json` の走査対象 | `.agent-skill-chain/docs/`・`templates/`・`docs/specs/`。**repository rootは対象外** | 一次資料 |
| テスト | `npm run conformance:check` | `1497 scenarios (1481 passed, 16 skipped)`、`7886 steps`。project rule 21件、orphan 0件 | テスト出力 |
| 追跡 | `npm run trace:check` | valid。orphan 0件 | テスト出力 |
| commit前candidate | 7 file | working tree clean | Git index |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `CLAUDE.md` | A | project | project | Claude Codeの常時入口。**規約を1つも定義せず`AGENTS.md`を指す。** Claude固有の事実（skill登録口の位置と、skillが常時読まれないこと）だけを持つ | 参照は`AGENTS.md`への一方向。循環なし | REQ-LC-001 / AC-01・AC-02・AC-03 | 内容は公開文書であり秘密を含まない。revertで消える | pass |
| `package.json` | M | project | project | 配布file一覧へ`CLAUDE.md`を1行足す。**`files`は`PROTECTED_PACKAGE_FIELDS`に含まれない** | 適合 | REQ-LC-001 / AC-04 | `npm pack`で343 fileを実測した。revertで戻る | pass |
| `src/domain/lifecycle.ts` | M | package | domain | `ROOT_ASSETS`へ1要素を足し、`isPackageOwnedPath`のfile名直書きを`ROOT_ASSETS`参照へ置き換える。**展開側と所有判定側の正本を1つにする** | `isPackageOwnedPath` → `ROOT_ASSETS` の単方向。定数配列は逆参照を持たない | REQ-LC-001 / AC-05 / SCN-E2E-LIFECYCLE-001 | 変異試験M1・M2でkillを確認。revertで戻る | pass |
| `test/steps/lifecycle-isolation.steps.ts` | M | package | test | `ROOT_HOST_ENTRIES`を定義し、install直後の存在とdelete後の非存在を全要素について検査する | test層のみ。製品を参照しない | SCN-E2E-LIFECYCLE-001 / AC-06 | 隔離consumerのみを扱う | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | project | spec | REQ-LC-001を改訂する。host入口の複数展開、host skillが代替にならないこと、展開対象一覧の正本化 | 適合 | REQ-LC-001 / AC-LC-001 | 記述のみ | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | 変更履歴を1行足す | 適合 | 同上 | 記述のみ | pass |

**`dist/src/domain/lifecycle.js` は個別監査の対象外である。** `scripts/check_file_audit.ts` の `isGeneratedDistributionPath` が生成物を個別監査から除外する（#1187）。配布物影響の検査には境界単位（`dist/src/`）で残る。

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `CLAUDE.md` | **入る** | `package.json` の `files` へ加えた。**配布物へ入ることが本PRの目的である** |
| `src/domain/lifecycle.ts` | **入る** | `files` は `dist/` を配るが、実装の正本はここである。`install`/`update` の展開対象が1件増える |
| `dist/src/` | **入る** | 上記のcompile結果。`npm run build` で再生成し版管理へ入れた（#1187） |
| `package.json` | 入る | 配布file一覧そのものである |
| `test/steps/lifecycle-isolation.steps.ts` | 入らない | `files` に `test/` が無い |
| `docs/specs/` 2件 | 入らない | project所有の仕様であり利用projectには不在 |

判断: 配布物を更新した
根拠: **配布file数が342から343へ増える。** `npm pack --dry-run --ignore-scripts --json` で実測した。増えたのは `CLAUDE.md` 1件である。`install --apply` の展開対象も1件増え、`delete --apply` の除去対象も同じ1件増える。

## 2. 差分の要約

| 変更 | 内容 |
|---|---|
| 入口の追加 | repository直下に `CLAUDE.md` を置き、`ROOT_ASSETS` と `package.json` の `files` へ加えた |
| 正本の一本化 | `isPackageOwnedPath` が持っていた file 名の複製を `ROOT_ASSETS` 参照へ直した |
| 判定の強化 | SCN-E2E-LIFECYCLE-001 が install 直後の存在も検査するようにした |
| 仕様 | REQ-LC-001 を改訂した |

## 3. 肯定review

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | `install` preview が両入口を列挙する。`npm pack` が343 fileを返す。変異試験2件がkillされる |
| 価値 | pass | Claude Codeの利用者と本repositoryの作業者が、規範文書へ常時読まれる入口から到達する |
| 実現可能性 | pass | 既存機構をそのまま使う。新しい機構を足していない |
| 整合性 | pass | REQ-LC-001 / AC-LC-001 / SCN-E2E-LIFECYCLE-001 へ結線し `trace:check` が valid |
| 保守性 | pass | **host入口を次に足すときは `ROOT_ASSETS` の1箇所で済む。** 変更前は2箇所だった |

## 4. 敵対review

| 反例・攻撃 | 検証 | 結果 |
|---|---|---|
| `ROOT_ASSETS` から `CLAUDE.md` を消しても通るのではないか | 変異M1を適用して SCN-E2E-LIFECYCLE-001 を実行 | **kill。** `[true, false]` が期待値 `[true, true]` と一致しない |
| `isPackageOwnedPath` の一本化を戻しても通るのではないか | 変異M2を適用して同上 | **kill。** CLI が status 1 を返す。診断は `managed asset recordが不正です: CLAUDE.md` |
| delete後の非存在だけで足りるのではないか | install直後の観測を外すと、**最初から作られていない場合と区別できない** | 観測点を install 直後にも置いた。M1はこの観測点で落ちる |
| `CLAUDE.md` が規約の複製になっていないか | 内容読解。5行、規約の記述0件 | **pass。** ただし機構は無い（下記） |
| 利用者の既存 `CLAUDE.md` を壊さないか | 既存の変更済み資産保持（hash検証）を通る | `delete` は record に載りhashが一致するfileだけを取り除く。**新しい経路を足していない** |
| `AGENTS.md` の挙動が変わっていないか | `ROOT_ASSETS` の第1要素は不変。`isPackageOwnedPath` は同じ集合を返す | 回帰なし。SCN-E2E-LIFECYCLE-001・002 が合格 |
| symlink で済むのではないか | 既存機構が symlink を一律拒否する | 設計12節で棄却した |

## 5. finding分類

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| DISC-01 | resolved | `ROOT_ASSETS` へ足しただけでは `update`/`delete` が `managed asset recordが不正です: CLAUDE.md` で落ちる。`isPackageOwnedPath` が file 名を直接持っていた | 実装で `ROOT_ASSETS` 参照へ一本化した。M2で回帰を検出できることを確認した |
| ADV-01 | record-only | **`ASC-CANON-SINGLE-SOURCE-001` の token 検査は repository root を走査しない。** `CLAUDE.md` が将来規約の複製へ育っても機構は止めない | **強制点を足さない。** 走査対象の拡大は既存の検査対象全体へ影響し、運用ポリシーの「手段の追加より既存手段の縮小を先に評価する」に反する。設計12節と仕様へ記述で残す |
| ADV-02 | record-only | 本変更は入口の**存在**を保証するが、入口が読まれて規範文書へ到達したことは保証しない | 観測不能な条件をACにしない。**効果は次に同種の取り違えが起きるかで測る** |

**blocking 0件。未解決のCritical / High 0件。**

## 6. 検証結果

| 検査 | 結果 |
|---|---|
| `npm run conformance:check` | `1497 scenarios (1481 passed, 16 skipped)`、`7886 steps (7836 passed, 50 skipped)`。project rule 21件、orphan 0件 |
| `npm run lint` | エラー0件 |
| `npm run format:check` | 差分0件 |
| `npm run typecheck` | 型error 0件 |
| `npm run source:check` | 合格 |
| `npm run project:quality` | 合格 |
| `npm run directories:check` | 合格 |
| `npm run skills:check` | 合格 |
| `npm run cli:check` | 合格 |
| `npm run workflow:check` | 合格 |
| `npm run docs:format` | 合格 |
| `npm run test:format` | 合格 |
| `npm run package:check` | 合格。**343 file**（変更前342） |
| `npm run architecture:check` | 合格 |
| `npm run trace:check` | valid。orphan 0件 |
| `npm run audit:check` | Step 11直前に実行する |

### 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | `ROOT_ASSETS` から `CLAUDE.md` を外す | **kill**（SCN-E2E-LIFECYCLE-001） |
| M2 | `isPackageOwnedPath` を file 名直書きへ戻す | **kill**（同上。診断 `managed asset recordが不正です: CLAUDE.md`） |

**2件ともkill。** 変異は複写で戻し、`git diff --stat` で復元を確認した。

## 7. 仕様更新

- **REQ-LC-001 を改訂した。** host入口がhostごとにfile名が違い複数を展開すること、host skillが常時の入口の代替にならないこと、展開対象一覧を正本としrecord検証がfile名を別に持たないことを明記した
- **新規SCNを作らなかった。** 既存 SCN-E2E-LIFECYCLE-001 が同じ機構の同じ境界（install/update/deleteの往復）を検査しており、判定を強くするだけで足りる
- **既存SCNを1件も削除していない**
- 用語台帳の差分なし

## 8. 判定

**承認。** blocking 0件、未解決のCritical / High 0件。record-only 2件（ADV-01・02）、resolved 1件（DISC-01）。
