# 72 課題986 Step chain証跡実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #986 |
| 比較基点 | `c5c6a3038f389ee9cac3f0858be4bc6d58d4f72d` |
| H_impl | `c3e1531a057f4659347243211688438047685f60` |
| reviewer | claude（変異試験で独立に検証） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 3（設計諮問1、自動review1を含む） |
| Step chain | 迂回: 本Issueが対象とする手書き運用そのものであり、製品経路を通していない |

**このartifactは本PRが追加した検査の最初の適用対象である。** `Step chain`欄の`迂回`申告は、まさに#986が記録に残そうとしている事実そのものである。

### 0.1 routing入力契約

Issue本文、既存実装、既存artifactの原文を入力にした。変異試験は判定の後に独自に設計し、生存した変異を指摘として扱った。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #986、`REQ-SQ-023`、`AC-SQ-023` | 規律の判定根拠を経路から成果物へ移す | 一次資料 |
| ラウンド上限の実装 | `src/domain/review.ts:546` | `round < 1 \|\| round > 3`で`throw` | 既存コード |
| ラウンド上限の規範 | `.agent-skill-chain/docs/02_品質基準.md:49` | 「同じ範囲の上限は3ラウンドで、自動更新しない」 | 一次資料 |
| **実害の実測** | `docs/reviews/69_*.md` | **`ラウンド数`が`4`。上限3を超えた記録が残っている** | 実行観測 |
| 依存Issueの解消 | #951（PR #989） | merge済み。迂回の動機は解消済み | 実行観測 |
| 既存の記法 | artifact 25件 | `ラウンド数`欄は7件のみ。値は自由文 | 実行観測 |
| 差分 | `c5c6a303`..`c3e1531a` | 11 path（release bumpを除く） | 既存コード |
| 保護対象の差分 | 同上 | **0件** | 実行観測 |
| trusted-base相当 | `--root=候補 --trusted-root=既定branch` | `valid: true` | 実行観測 |
| 静的検査 | 13種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 962 scenario全通過、5120 step全通過 | テスト出力 |
| 検査の変異試験 | 7経路 | 生存した変異のたびにscenarioを追加し、最終的に7経路すべて検出 | 実行観測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/templates/issue/04_レビュー.md` | M | package owner | 配布template | ラウンド数とStep chain欄の宣言 | 参照のみ | REQ-SQ-023 | 2行の除去で戻る | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | change owner | 仕様 | REQ-SQ-023の登録 | 参照のみ | REQ-SQ-023 | 行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | change owner | 仕様 | REQ-SQ-023の定義 | 参照のみ | REQ-SQ-023 | 節の除去で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-STEPCHAIN-001の定義 | 参照のみ | REQ-SQ-023 | 行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | REQ-SQ-023の追跡1行 | 参照のみ | REQ-SQ-023 | 行の除去で戻る | pass |
| `scripts/check_file_audit.ts` | M | package owner | gate script | ラウンド数とStep chain申告の解析と必須化 | 追加依存なし | REQ-SQ-023、SCN-INT-STEPCHAIN-001〜009 | 追加関数と検証の除去で戻る | pass |
| `test/features/integration/audit-artifact-selection.feature` | M | package owner | test | 受け入れ例8件 | 実装へ単方向 | SCN-INT-STEPCHAIN-001〜009 | scenarioの除去で戻る | pass |
| `test/steps/audit-artifact-selection.steps.ts` | M | package owner | test | step定義とartifact fixture | 実装へ単方向 | SCN-INT-STEPCHAIN全件 | step定義の除去で戻る | pass |
| `test/steps/audit-bump-exclusion.steps.ts` | M | package owner | test | artifact fixtureへ2欄を追加 | 実装へ単方向 | SCN-INT-AUDITBUMP | 2行の除去で戻る | pass |
| `test/steps/merge-integrity.steps.ts` | M | package owner | test | artifact fixtureへ2欄を追加 | 実装へ単方向 | SCN-INT-MERGEINT | 2行の除去で戻る | pass |
| `test/steps/unit.steps.ts` | M | package owner | test | artifact fixtureへ2欄を追加 | 実装へ単方向 | SCN-UNIT-PACKAGE-011 | 2行の除去で戻る | pass |

### 保護対象との照合

**保護fileとpackageの保護fieldは1件も変更していない。**品質契約proposalを要さない。`--root=候補 --trusted-root=既定branch`が`valid: true`を返すことで確認した。

### 既定branch追随の扱い

実装commitの後、review artifact commitより前に`origin/main`を取り込んだ。取り込んだのはPR #990（`v0.3.1-beta.31`へのrelease bump）で、差分は`package.json`と`package-lock.json`の2 fileだけである。**`check_file_audit.ts`のrelease bump除外が働き、監査対象pathは11件のままである。**個別監査表は追随後の`比較基点..H_impl`から再生成している。

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| 上限超過のラウンド数を拒否する | 充足 | SCN-INT-STEPCHAIN-001 |
| ラウンド数の記録欠落を拒否する | 充足 | SCN-INT-STEPCHAIN-002 |
| Step chain申告の欠落を拒否する | 充足 | SCN-INT-STEPCHAIN-003 |
| 理由を伴わない迂回申告を拒否する | 充足 | SCN-INT-STEPCHAIN-004 |
| 経由の申告を記録として受理する | 充足 | SCN-INT-STEPCHAIN-005 |
| 短い迂回理由を受理する | 充足 | SCN-INT-STEPCHAIN-006 |
| 注記付きの記法を受理する | 充足 | SCN-INT-STEPCHAIN-007 |
| 先頭が整数でない記録を欠落として扱う | 充足 | SCN-INT-STEPCHAIN-008 |
| 節の外の記述を申告として数えない | 充足 | SCN-INT-STEPCHAIN-009。**ラウンド3で追加** |
| 手書き運用を禁止しない | 充足 | 迂回申告は理由付きで通る。SCN-006以外の全fixtureが迂回申告 |
| 新しいgateを追加しない | 充足 | `audit:check`の既存解析器へ2欄を追加しただけ |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データを扱わない。journalは既存の一時ステージング配下 |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない。診断文だけを返す |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **判定の根拠を経路から成果物へ移した。**規律を守らせる手段が「製品を使わせること」である限り、使わなければ無効化される。成果物へ申告を要求すれば、経路に依存せず既定branch側の検査が判定できる。
- **新しいgateもCI stepも作っていない。**`check_file_audit.ts`は既に`audit:check`として必須check内で走り、artifact本文を解析している。同じ解析器へ2欄を足しただけである。
- **検証できないものを検証しなかった。**独立oracleを持たない申告に検証を被せると、充足不能な要求か、破れる見せかけの障壁のどちらかになる。記録に徹した。
- **手書き運用を禁止していない。**運用ポリシーは「手段が開発速度を損なうとき、縮小するのは手段の側である」と定める。迂回を申告して理由を書けば通る。Issue本文も「迂回した事実が記録に残ればよい」としている。
- **注記を許した。**既存artifactの記法は`4（うち1ラウンドは自動review）`のような自由文である。厳格な整数だけを要求すると既存の書き方を一律に壊し、**記法の問題を規律の問題として扱う**ことになる。先頭の整数だけを読む。
- 依存する#951を先に解消してから着手した。迂回の動機を残したまま検査を足すと「守れないルールを検査する」状態になる。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| ラウンド上限の実装が存在しない可能性 | **不成立。**`review.ts:546`に実在することを確認 |
| 上限超過の実害が無い可能性 | **不成立。**`docs/reviews/69_*.md`が`4`を記録している |
| 厳格な整数要求が既存の記法を壊す | **成立。**注記を許す形にして回避 |
| 経由を必須にすると手書き運用が成立しなくなる | **成立。**迂回申告を用意して回避 |
| **`validateStepJournal`の`errors`だけを読むと不整合を素通りする** | **成立。**下記「専用fieldの見落とし」を参照 |
| 受理側だけを検証すると拒否側が固定されない | **成立。**SCN-008を追加して回避 |
| 申告が自己申告であり、経由と偽れる | 成立。**構造的限界。**下記「残存risk」を参照 |
| 既定branch追随のrelease bumpが監査pathを汚す | **不成立。**既存の除外機構が働くことを実測 |

### 専用fieldの見落とし（ラウンド1）

初稿は`validateStepJournal`の戻り値から`errors`だけを読んでいた。この関数は不整合を`missingSteps`など専用fieldへ入れ、`errors`は入力検証だけを持つため、必須Stepが欠けたjournalを合格として通していた。**ただしこの是正は後にjournal検証ごと撤回した。**

### journal検証の撤回（ラウンド2）

**設計諮問により、journal検証そのものが誤りであると判明した。**是正ではなく削除した。

#### 理由1: 既定branch側で充足不能である

一時ステージングは`.gitignore`の対象で、追跡fileが0件である。

```console
$ git check-ignore -v .agent-skill-chain/tmp/
.gitignore:13:.agent-skill-chain/tmp/	.agent-skill-chain/tmp/
$ git archive HEAD | tar -x -C "$T" && find "$T/.agent-skill-chain" -name steps.jsonl | wc -l
0
```

**既定branch側のcheckoutにjournalは存在しない。**`経由`と申告すると`audit:check`は必ず失敗し、`迂回`は常に通る。**規律を守って正直に申告した者だけが拒否される。**誘因が逆転しており、全artifactを`迂回`申告へ強制する仕掛けになっていた。

さらに、stagingがローカルに在る開発者は`prepack`で合格し、既定branch側で失敗する。環境依存の乖離も生じる。

#### 理由2: 捏造への障壁にならない

**初稿の受容根拠は実測で反証された。**artifactには「捏造には11 stepの整合した記録を作る必要があり、正しく運用するより手間が大きい」と書いていた。しかし`validateStepJournal`は在否、順序、modeしか見ず、`artifacts`と`evidence`は repository 状態へ束縛されない自由文字列である。**12行の生成scriptで`evidence: "forged"`のまま`valid: true`が得られる。**捏造は正しい運用より安い。

#### 判断

**独立oracleを持たない申告を、検証したふりをしない。**個別監査表がcandidateの記述でありながら成立するのは、宣言したpath集合をGit差分と突合する独立oracleがあり、`個別監査とGit差分path集合が一致しません`で反証できるためである。ラウンド数とStep chainにはそれが無い。

journalを追跡pathへcommitさせる案も評価した。**採らない。**一時ライフサイクル領域の分類はREQ-SQ-019（#959）が所有しており、その変更は本Issueの範囲外である。Issue #986の要求は「迂回した事実が記録に残ればよい」であり、記録の存在で満たされる。

### 迂回理由の長さ判定の撤回（ラウンド2）

初稿は迂回理由に10文字以上を要求していた。**削除した。**

要求は記録の存在であって理由の質ではない。**この repository の実際の迂回理由は`CI障害`のように短く、長さで測ると実質的な理由ほど落ちる。**一方`とりあえず迂回します`は通り、水増しで自明に突破できる。代理指標として逆相関している。非空はparserの`(.+)`が保証済みで、追加の判定を置く必要が無い。

### 残存risk

**ラウンド数とStep chainは自己申告であり、独立oracleが無い。**4ラウンド回して`3`と書けば通る。

**当初はこれを「捏造コストが高いので動機が薄い」と受容していたが、その根拠は誤りである。**正しい受容根拠は次である。

運用ポリシーは「candidateによる自己評価、tracked artifactへの自己commit SHA、相互参照で成立する承認・証拠を禁止する」と定める。禁じているのは**承認・証拠を成立させる**自己評価である。ラウンド数とStep chainは記述fieldであり、**下流の承認入力にしない限り循環を生まない。**

本PRが解くのは「規定はあるのに記録されず、超過が誰にも見えない」状態である。実際に`docs/reviews/69_*.md`へ`4`が残っていた。**本PR以前は申告欄すら無く、超過を検出する手段が1件も存在しなかった。**意図的な虚偽記載は別の信頼境界が扱う。

ラウンド数の実数を独立に導出する手段も検討した。GitHub reviews APIは既定branch側から到達可能だが、PR #989では33秒間に11件のsubmissionが束で入り、件数はラウンド数にならない。加えて**artifact自身がPR内でcommitされる**ため、その後のラウンドを申告値は原理的に含められない。突合は著しい過少申告の反証までしかできない。

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S72-H-01 | High | `validateStepJournal`の`errors`だけを読み、journal不整合を素通りさせていた | **撤回。**ラウンド2でjournal検証ごと削除したため最終実装に該当箇所が無い |
| S72-M-01 | Medium | 受理側のscenarioだけでは整合検証が固定されない | **撤回。**同上 |
| S72-H-02 | High | **`経由`申告が既定branch側で充足不能で、誘因が逆転していた** | 是正済み。journal検証を削除 |
| S72-M-02 | Medium | 捏造コストに関する受容根拠が誤っていた | 是正済み。根拠を差し替え |
| S72-M-03 | Medium | 迂回理由の長さ判定が実質的な理由ほど落としていた | 是正済み。判定を削除 |
| S72-M-04 | Medium | **申告の抽出が全文検索で、本文やcode fenceの記述を申告として受理していた** | 是正済み。SCN-009で確認 |
| S72-L-03 | Low | artifactのcode fenceに言語識別子が無かった（MD040） | 是正済み |
| S72-L-01 | Low | Step chainの申告が自己申告である | 未是正。**独立oracleが無い記述field。**下流の承認入力にしない |
| S72-L-02 | Low | ラウンド数が自己申告である | 未是正。同上 |

### ラウンド予算による打ち切り

**ラウンド3で収束した。**未解決のCritical/Highは0件、High 2件（うち1件は撤回）とMedium 4件（うち1件は撤回）はいずれも決着済み、残るLow 2件は独立oracleの不在という構造的限界である。**ラウンド3は上限であり、これ以上のラウンドへ自動更新しない。**

## 6. ラウンド固有の確認

### ラウンド1

全評価基準を確認した。High 1、Medium 1、Low 2。変異試験で`errors`だけを読む欠陥を検出し是正した。判定 **rejected（設計諮問を待つ）**。

### ラウンド2（設計諮問）

High 1、Medium 2。**`経由`申告が既定branch側で充足不能であり、規律を守った申告だけが拒否される誘因の逆転**を検出した。journal検証と迂回理由の長さ判定をいずれも削除し、両分岐を純粋な記録に揃えた。捏造コストに関する受容根拠の誤りも訂正した。判定 **rejected（自動reviewを待つ）**。

### ラウンド3（自動review）

Major 1、Minor 3。**Major 1は申告の抽出が全文検索で、識別情報の節に欄が無くても本文やcode fenceへ書けば通る欠陥である。**#986の監査目的を直接迂回するため是正した。既存の`extractMarkdownSection`で節を限定し、`withoutMarkdownCode`でcodeを除く。**いずれも#951で main へ入れた既存関数の流用で、新しい解析は書いていない。**Minor 3はartifactの記録矛盾2件とMD040で、いずれも訂正した。判定 **approved**。

**同じ欠陥を#951で是正した直後に再生産した。**#951では「codeを除いた行全体一致」へ是正しており、本Issueでは全文検索を書いた。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run cli:check`、`npm run workflow:check`、`npm run skills:check`、`npm run trace:check`、`npm run architecture:check` | exit 0 | pass |
| 統合 | `npm test` | 962 scenario全通過、5120 step全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |
| 既定branch比較 | `--root=候補 --trusted-root=既定branch` | `valid: true` | pass |

検査の変異試験。

| 変異 | 失敗scenario数 |
|---|---|
| ラウンド上限判定を外す | 1 |
| ラウンド数の欠落判定を外す | 1 |
| Step chain申告の欠落判定を外す | 2 |
| 申告の形式判定を緩める | 1 |
| 先頭整数の抽出を全文数値化へ | 1（SCN-008の追加前は0） |
| 識別情報の節への限定を外す | 1（SCN-009の追加前は0） |
| codeの除去を外す | 1（SCN-009の追加前は0） |
| 変異なし | 0（9件全通過） |

**変異試験の前に作業treeをcommit済みにした上で実施し、各変異の後は退避した原本の複写で復元した。**`git checkout`を後始末に使っていない。`npm test`と`conformance:check`は直列で実行している。並行すると`dist/bin`が再構築されE2Eが落ちる。

### 既存fixtureへの影響

必須欄を追加したため、artifactを組み立てる既存fixture4件が失敗した。いずれも2欄を追加して是正した。**これは意図した結合である。**fixtureが契約を満たさなくなったことを型でもテストでも検出できるのは、契約が実際に強制されている証拠である。

| fixture | 対応 |
|---|---|
| `test/steps/audit-artifact-selection.steps.ts` | `auditMarkdown`へidentity引数を追加 |
| `test/steps/audit-bump-exclusion.steps.ts` | 2欄を追加 |
| `test/steps/merge-integrity.steps.ts` | 2欄を追加 |
| `test/steps/unit.steps.ts` | 2欄を追加 |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/templates/issue/04_レビュー.md` | 入る | review templateに2欄が加わる。利用者はこの欄を記入する |
| `docs/specs/**` | 入らない | 製品仕様 |
| `scripts/**` | 入らない | repository局所の検査 |
| `test/**` | 入らない | test資産 |

判断: 配布物を更新した

根拠: `.agent-skill-chain/templates/`は`package.json`の`files`に含まれ配布境界へ入る。review templateの0節へ`ラウンド数`と`Step chain`の2欄を追加した。**利用者から観測できる変化がある。**利用側projectが`scripts/check_file_audit.ts`相当の監査を持たない場合、この2欄は記入項目が増えるだけで拒否は発生しない。`npm run package:check`と`npm run skills:check`がいずれもexit 0であることを確認した。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。差分と実測値だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。2ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**変異試験が`errors`だけを読む欠陥を検出した。**静的検査13種と、SCN-006を含む7 scenarioはすべて通過しており、実行だけでは検出できなかった。受理側だけを書いていたことが原因である。

## 10. 仕様整合性

`docs/specs/`の4 fileを更新した。REQ-SQ-023、AC-SQ-023、QLT-STEPCHAIN-001を採番し、追跡表でSCN-INT-STEPCHAIN-001〜009へ結び付けた。

要件IDは`REQ-SQ-023`である。`REQ-SQ-021`は#977、`REQ-SQ-022`は#951が使用済みで、いずれも既定branchへmerge済みであることを分岐前に確認している。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 0件
- 記録したLow: 3件（S72-L-01、S72-L-02は独立oracleの不在という構造的限界。S72-L-03は是正済み）

再開地点: ステップ11（PR作成）
