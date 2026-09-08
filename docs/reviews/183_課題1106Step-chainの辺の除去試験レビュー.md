# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| H_impl | `419c3140331f9d4754a0971a5f3f515daa257df7` |
| 比較基点 | `0c2f7269cfc11a7d5bd973d367f6e9f5f139a8cc` |
| 対象SHA・文書ダイジェスト | `419c3140331f9d4754a0971a5f3f515daa257df7` |
| 対象差分 | `0c2f7269cfc11a7d5bd973d367f6e9f5f139a8cc..419c3140331f9d4754a0971a5f3f515daa257df7`、9 path。**`dist/`配下は0件である。** commitは`419c3140`の1件 |
| 対象外 | **工程の変更。** Stepの削除・順序変更・mode判定の改定。有限レビュー契約の予算3（#1019）。支援層と成果物の行数比。製品codeの変更。測定していないgate（`issue sync`・`review round`・`pr create`・`pr merge`）の判定 |
| 残り予算 | 同一範囲で最大3ラウンド。ラウンド1を使用し、**残り2** |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260909_010755_chore-Step-0-11のどの辺が実際にデータを運んでいるかを除去試験で実測する |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-001。引用: 「**既定は`full`で、`0 → 1 → … → 11`を実行する。**」 **本変更は同要件を1文字も変えない。** |
| 成果物行数 | 測定記録 **+284行**、観測data **+1884行**、測定script **+138行**。製品 **0行**、支援層(test) **0行**、仕様 **0行**、生成dist **0行** |
| 縮小の先行評価 | **新しいgate、validator、CLI、schema、台帳、project choice項目、SCNを1つも追加していない。** 測定scriptは`docs/evidence/`配下へ置き、**`package.json`のscriptsへ登録せずCIからも呼ばない。** 登録すると測定が検査に化ける |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。2026-09-09 |

### 0.1 routing入力契約

| role欄（担当role） | 許可path・操作 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|---|
| implementer | `docs/evidence/`と`docs/reviews/`の読み書き。既存stagingは**読み取りのみ** | 除去試験の全観測、生成順序の突合、決定性の2回実行確認 | routine。riskはlow。製品codeにも認可条件にも触れない | project choiceのprovider上限に従う | project choiceのtier mapping | 検査失敗時はcommitせず停止する | 実装は本session、reviewerはcodex CLIの新規session |
| reviewer | 読み取りのみ。`--sandbox read-only` | 肯定・敵対review、finding分類、原文引用 | standard | codex CLI | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | §9に観測結果を残す |

## 規範の引用

本artifactは測定範囲を限定する記述を含む。判断の根拠となる要件の原文を引用する。

要件 **REQ-WF-001** の原文を`docs/specs/02_要件/01_ワークフロー要件.md`から引く。

> 既定は`full`で、`0 → 1 → … → 11`を実行する。`quick`はQ-01〜Q-08がすべて真かつ根拠付きの場合だけ許可し、`0 → 1 → 4 → 9 → 10 → 11`を実行する。偽、不明、未回答、根拠なし、プロジェクト閾値なしが1つでもあれば`full`とする。

**この条項はStepの順序を定めるが、後段のgateが前段の成果物の内容を読むことを定めていない。** 本測定はその差を測った。**条項を1文字も変えていない。**

耐久トラッカーの定義（`TERM-ASC-007`）も同じ形である。

> セッションをまたいで要求・要件・設計・計画を再開でき、書き込み後読取確認された外部正本

**「再開できること」を求めており、gateが内容を検査することは求めていない。**

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1106、staging 00のAC-01〜AC-07 | Step 4で同期し、syncDigestとreadBackDigestが`4e0b69a2924a33e54a248fd9e8d3b09959ceeba7988fd196dd5b216b1f9d90cf`で一致 | 実行観測 |
| 除去試験 | 12 staging × 4成果物 × 3変種 + baseline 12 | **156観測。`delete`と`gut`は12/12で失敗、`swap`は12/12で成功** | 実行観測 |
| `workflow record` | 新規stagingへ別Issueの00〜03を置いてStep 1〜9を記録 | **1件も拒否されない** | 実行観測 |
| 生成順序 | 63件（うち判定可能59件） | **47件でStep 5・7の記録が実装開始より先。12件で逆。うち7件は1時間未満** | 実行観測 |
| 決定性 | 同じ入力で2回実行 | **156観測が完全一致** | 実行観測 |
| 実stagingの無変更 | `git status --porcelain` | 測定の前後で実stagingの変更は現れない | 実行観測 |
| 静的検査 | `lint`、`format:check`、`typecheck`、`docs:format` | 全合格 | テスト出力 |
| 履歴監査 | `audit:check` | `valid: true` | テスト出力 |
| staging | `issue validate --path=<staging>` | `valid: true` | テスト出力 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。** 対象選択 → 複製 → 変種生成 → gate実行 → 集計 → 記録の一方向であり、記録が対象選択へ戻る経路が無い。**測定scriptの出力をその測定自身の合否判定へ使っていない。** scriptは観測値だけを返し「合格」を返さない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDが`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。§9の例外経路を参照する。
- 既定branch追随を行った場合: **該当なし。** 比較基点は`0c2f7269`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/evidence/1106-step-chain-edges/00_測定手順.md` | A | package owner | evidence | 測定手順、判定の三分、対象の選び方、測定していないgateの列挙、決定性 | pass。記録のみ | REQ-WF-001 / AC-01・AC-02・AC-06 / **新規SCNなし**（§5に理由） | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/01_除去試験の結果.md` | A | package owner | evidence | 主測度の集計とerror文言と判定 | pass | AC-03 | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/02_生成順序の結果.md` | A | package owner | evidence | 副測度の集計と分布と反証の明記 | pass | AC-04・AC-05 | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/03_結論と限界.md` | A | package owner | evidence | 結論、言っていないこと、限界7項目 | pass | AC-05・AC-06 | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/observations.json` | A | package owner | evidence | 156観測の全文。error文言を省略していない | pass | AC-03 | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/generation-order.json` | A | package owner | evidence | 63件の突合data | pass | AC-04 | 追加のみ | pass |
| `docs/evidence/1106-step-chain-edges/scripts/01_select_targets.mjs` | A | package owner | evidence | 対象選択。**実際に走らせたものそのもの** | pass。`package.json`のscriptsへ登録せずCIからも呼ばない | AC-01・AC-02 | 追加のみ。実stagingを読むだけで書かない | pass |
| `docs/evidence/1106-step-chain-edges/scripts/02_removal_trial.mjs` | A | package owner | evidence | 除去試験。複製に対してのみ実行する | pass。同上 | AC-01・AC-03・AC-07 | 追加のみ。複製は各観測後に破棄する | pass |
| `docs/evidence/1106-step-chain-edges/scripts/03_generation_order.mjs` | A | package owner | evidence | 生成順序の突合 | pass。同上 | AC-01・AC-04 | 追加のみ。gitを読むだけ | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-only 0c2f7269 419c3140`は9 pathであり、表の9行と一致する。**`dist/`配下は0件で、除外した行は無い。** 本artifactはH_implの後にcommitされるためこの表の対象ではない。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。** **測定scriptは`docs/evidence/`配下に置き、`scripts/`配下へ置かなかった。** `scripts/`へ置くと製品の検査に見える。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**(1) 起票時の判定基準（二分）では足りなかった。** 「存在検査だけ」と「内容依存」の二分では、`gut`で落ちて`swap`で通る状態を表せない。**予備測定でその状態が実在すると分かったため、三分（存在検査だけ・構造依存・内容依存）へ精緻化し、変種`swap`を足した。** 判定基準の変更を隠さず記録する。

**(2) `H_impl`を副測度に使うと必ず遅い側へ偏る。** 最初はreview artifactの`H_impl`欄を実装時刻として使い、12件全件で「実装が後」という結果を得た。**しかし`H_impl`はreview後の最終実装commitであり、開始時刻ではない。** mainのmerge commitからbranch範囲を取り、`src/`・`test/`・`scripts/`を触った最初のcommitのauthor日時へ測度を差し替えた。**偏った測度の結果を採用しなかった。**

**(3) merge commitの本文にIssue番号が入らない。** Issue番号はbranch名（`bugfix/1271-...`）からしか引けない。最初の実装ではmerge commit本文の`#N`を探しており、63件全件が判定不能になった。**判定不能が全件という結果自体が測定の誤りの信号だった。**

**(4) 実際に走らせたscriptがlintに掛かった。** 集計部の三項演算子の式文が`@typescript-eslint/no-unused-expressions`に掛かった。**等価な`if`文へ直し、その事実を測定手順へ記録した。** 観測値は集計より前に書き出しており影響しない。**黙って清書しない。**

**(5) `workflow record`の最初の測定は測定になっていなかった。** 選んだstagingが既にStep 11へ到達しており、4変種すべてが同じ理由（Step 11後の追記禁止）で拒否された。**変種によらず同じ結果が出たことが、測定になっていない信号だった。** 新規stagingを作る形へ組み直した。

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | 観測 | 判定 |
|---|---|---|---|
| AC-01 | 除去試験の手順が再現可能な形で記録されている | 手順書とscript全文。**決定性を2回実行で確認** | pass |
| AC-02 | 対象が10件以上あり選び方が明示されている | 除去試験12件、生成順序63件。選択基準5項目を記録 | pass |
| AC-03 | 各Step成果物の判定がgateのerror文言を証拠としている | 156観測の全文を`observations.json`へ保存。代表例を表に記載 | pass |
| AC-04 | 実装commitとStep記録の前後関係が全対象で集計されている | 63件中59件を判定。**判定不能4件のtrackerも記録** | pass |
| AC-05 | 反証が観測された場合その旨が結論として記録されている | **副測度で仮説が反証された。結論の2番目に明記** | pass |
| AC-06 | 結論に対する限界が明示されている | 限界7項目。**測定していないgateの一覧を含む** | pass |
| AC-07 | 実stagingとworktreeが1件も変更されていない | 測定前後の`git status`。複製先pathを記録 | pass |

## 3. 肯定的評価

- **決定可能な測度を主測度に置いた。** 「chainが無駄である」という印象を根拠にしていない。過去に同型の因果主張を1件棄却している轍を踏んでいない。
- **反証をそのまま記録した。** 副測度は起票時の仮説を否定した。**仮説に合う結果だけを報告していない。**
- **測っていない範囲を結論が超えていない。** §「何を言っていないか」で、文書を書く行為が判断を良くするかは測っていないことを明記した。
- **偏った測度を採用しなかった。** `H_impl`ベースの測定は12/12で仮説に反する結果を出したが、偏りに気付いて差し替えた。**都合の良い結果を先に得ていたにもかかわらず捨てた。**
- **実stagingを1件も変更していない。** 複製に対してのみ測定した。

## 4. 敵対的評価

### 4.1 対象の選び方に後付けが無いか

**無い。** 選択基準5項目を先に固定し、結果を見てから選び直していない。**ただし「Issue番号昇順の末尾12件」という規則は、直近の案件に偏る。** 古い案件では成果物の書式が違い、結果が変わる可能性がある。**限界として記録した。**

### 4.2 `swap`の入れ替え元の選び方が結果を作っていないか

入れ替え元は対象一覧の隣の要素という固定規則である。**すべて本repositoryのfull mode stagingであり、書式が揃っている。** 書式のまったく違う文書を入れ替えたら`gut`と同じく落ちる可能性がある。**その場合でも結論は変わらない。** 「同じ書式なら中身が違っても通る」ことが示せれば十分だからである。**ただし入れ替え元を変えた測定はしていない。限界として記録した。**

### 4.3 結論が測定範囲を超えていないか

**超えていない。** 結論1は「測った2つのgateは」と範囲を明示している。結論2は副測度の範囲に閉じている。**「Step 2・3・5〜8は無駄である」とは書いていない。**

### 4.4 測定scriptが製品の検査に見えないか

**`docs/evidence/`配下へ置き、`scripts/`配下へ置かなかった。** `package.json`のscriptsへ登録せず、CIからも呼ばない。**scriptは合否を返さず観測値だけを返す。** 「合格」を返す形にすると、測定が検査に化ける。

### 4.5 支援層が製品を超えている

**製品の変更は0行である。** 本変更は測定だけを対象とするため、支援層比という指標が定義できない。**代わりに、測定記録284行・観測data 1884行・script 138行に対し、本artifactが約150行であることを記録する。** 観測dataが最大だが、**これは省略できない。** error文言を要約すると、判定の根拠が読者から見えなくなる。

### 4.6 反証を都合よく解釈していないか

副測度は仮説を反証した。**その事実を結論の2番目に置いた。** 3番目で「2つの結論は矛盾しない」と述べているが、**これは反証を打ち消す主張ではない。** 順序が守られていることと、順序が判定へデータを運ぶことは別だという区別であり、**主測度と副測度が別の問いに答えていることの説明である。**

## 5. 指摘

**本ラウンドで自分が見つけた指摘を記録する。**

| ID | 重大度 | 指摘 | 自分の検証 | 対処 |
|---|---|---|---|---|
| S-01 | High | 起票時の判定基準（二分）では、`gut`で落ちて`swap`で通る状態を表せない | **正しい。** 予備測定でその状態が実在した | 三分へ精緻化し、変種`swap`を足した |
| S-02 | High | `H_impl`を実装時刻に使うと必ず遅い側へ偏る | **正しい。** `H_impl`はreview後の最終commitである | 最初の実装commitのauthor日時へ差し替えた。**先に得ていた12/12の結果を捨てた** |
| S-03 | Medium | merge commitの本文にIssue番号が入らず、63件全件が判定不能になった | **正しい。** branch名からしか引けない | 突合規則を直した。**判定不能が全件という結果が誤りの信号だった** |
| S-04 | Medium | `workflow record`の最初の測定は、変種によらず同じ理由で拒否されており測定になっていなかった | **正しい。** 選んだstagingが既にStep 11へ到達していた | 新規stagingを作る形へ組み直した |
| S-05 | Low | 実際に走らせたscriptがlintに掛かった | **正しい。** 集計部の式文である | 等価な`if`へ直し、その事実を測定手順へ記録した。**黙って清書しない** |

**新規SCNを1件も足さない理由を記録する。** 成果物は測定結果の記録と、それを再現するscriptである。**scriptは観測手段であって製品の判定ではない。** cucumberのどの層でも「正しさ」を担保する対象にならない。代替は決定性の2回実行確認、入出力の全文記録、`audit:check`と`docs:format`である。

**変異試験を行わない理由を記録する。** 注入対象となる製品の判定が本変更に存在しない。**「変異試験を行った」と書かないことが正しい報告である。**

## 6. ラウンド固有の確認

### ラウンド1

測定手順、除去試験、生成順序、結論と限界、測定scriptを対象とした。

## 7. テスト結果

| 検査 | コマンド | 結果 |
|---|---|---|
| 静的検査 | `npm run lint` | エラー0件 |
| 型 | `npm run typecheck` | エラー0件 |
| 整形 | `npm run format:check` | 差分0件 |
| 文書整形 | `npm run docs:format` | 違反0件 |
| 履歴監査 | `npm run audit:check` | `valid: true` |
| staging | `issue validate --path=<staging>` | `valid: true` |
| 決定性 | 測定scriptの2回実行 | **156観測が完全一致** |

**実行しない検査とその理由を明記する。** `npm test`・`source:check`・`architecture:check`・`trace:check`・`conformance:check`・`package:check`は実行していない。**`src/`・`test/`・`docs/specs/`・`package.json`のいずれにも差分が無いためである。** **合格が自明でも、走らせていない検査を合格と書かない。**

**変異試験は行っていない。** 注入対象となる製品の判定が本変更に存在しない。

## 8. 配布物影響

判断: 配布物を更新しない

根拠: 変更した9 pathはすべて`docs/evidence/`配下であり、`package.json`の`files`（全12項目、内訳は`dist/`配下3件・`.agent-skill-chain/`配下6件・root直下3件）に含まれない。`npm pack --dry-run`の実測でも`docs/`は1件も梱包されない。**`dist/`の再生成は不要であり、本変更の差分に`dist/`配下は0件である。**

**利用projectから見た変化は無い。**

## 9. 独立reviewの成立

**開示する逸脱が2件ある。**

1. **本artifactの作成者と進行役（coordinator）が同一sessionである。** `roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。隠さず記録する。
2. **PR authorと`H_impl` commit authorが同一（`adachi-tatsuru`）である。** 本repositoryの構成上、reviewer stable IDの分離は成立しない。

**測定そのものについて、より重い逸脱がある。** **測定の対象となったstagingは、すべて本artifactの実施者が作ったものである。** 単一実施者・dogfoodingのみという限界は`03_結論と限界.md`に明記した。**独立した測定者による再現は行われていない。**

**独立reviewは本artifactのcommit後に行う。** 結果は§5へ追記する。

## 10. 仕様整合性

**`docs/specs/`を1行も変更していない。**

`no-spec-impact`の根拠: 本測定はREQ-WF-001が定めるStep chainを1文字も変えない。要件・受け入れ条件・SCNのいずれも追加も変更もしない。**Issue #1106が「測定結果が出るまで工程を1つも変えない」と明記しており、本変更はそれに従っている。**

**測定結果を根拠に工程を変えるのは別Issueである。** 本artifactはその入力を作っただけである。

## 11. 総合判定と再開地点

**判定: pass（ラウンド1）。**

再開地点は`workflow record --step=10`、`review round`、`pr create`である。

**残る観測を4件記録する。**

1. **測っていないgateが内容を読んでいる可能性は否定できない。** `issue sync`・`review round`・`pr create`・`pr merge`は測っていない。**結論はこの4つを含まない。**
2. **単一実施者・dogfoodingのみである。** 測定対象のstagingはすべて本実施者が作った。書き手が変われば結果は変わりうる。
3. **`swap`の入れ替え元を変えた測定はしていない。** 書式のまったく違う文書を入れ替えた場合は測っていない。
4. **本測定は工程の変更を支持も否定もしない。** 変更を導くには、測っていないgateの確認、quickとfullの品質差の測定、辺を強くする案と外す案の費用比較が要る。**それらは別Issueである。**
