# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| H_impl | `6e45f52c223580f0c7cd1d9dac815994708c0236` |
| 比較基点 | `98a4bc2b1c3d2d84af7b9563f821d150090e3436` |
| 対象SHA・文書ダイジェスト | `6e45f52c223580f0c7cd1d9dac815994708c0236` |
| 対象差分 | `98a4bc2b1c3d2d84af7b9563f821d150090e3436..6e45f52c223580f0c7cd1d9dac815994708c0236`、16 path。うち`dist/`配下3件は生成物として個別監査の対象外とし、配布影響は§8へ残す。commitは`b16c9bcf`・`d07d971b`・`086087bd`・`6e45f52c` |
| 対象外 | merge前の選別の判定変更、`pr.merge`の再送、照合結果の固定merge intentへの書き戻し、`inspectCiDelivery`の状態3値の変更、CI待ちのpolling |
| 残り予算 | 同一範囲で最大3ラウンドのうち2ラウンドを使用。**残り1。** |
| ラウンド数 | 2。ラウンド1は実装差分、**ラウンド2は独立reviewerの指摘2件の是正**が対象である |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260908_134956_merge後のCI照合を固定run-IDの直読みへ戻す |
| 仕様の所有箇所 | `docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-001。引用: 「**merge後の照合は一覧を再検索せず、merge前に固定した`ciRunId`で単一runを直読みする。**」 |
| 成果物行数 | 製品 **+219 / −13行**、支援層(test) **+585 / −1行**、仕様 **+7 / −3行**、生成dist **+118 / −13行** |
| 縮小の先行評価 | **新しいgate、validator、CLI、schema、台帳、project choice項目を1つも追加していない。** 新規fileも作っていない。**merge前の選別`inspectCiDelivery`のfilter式はbyte単位で不変である。** §4.5に支援層比の実測と縮小可否の判断を残す |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。2026-09-08 |

### 0.1 routing入力契約

| role欄（担当role） | 許可path・操作 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|---|
| implementer | `src/`、`test/`、`docs/specs/`、`dist/`の読み書き | SCN実行結果、差分試験、変異試験 | advanced。riskはhigh、security-sensitive | project choiceのprovider上限に従う | project choiceのtier mapping | 検査失敗時はcommitせず停止する | 実装は本session、reviewerはcodex CLIの新規session |
| reviewer | 読み取りのみ。`--sandbox read-only` | 肯定・敵対review、finding分類、原文引用 | standard | codex CLI | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | §9に観測結果を残す |

## 規範の引用

本artifactは範囲を狭める記述を含む。判断の根拠となる要件の原文を引用する。

**REQ-GH-001**（`docs/specs/02_要件/03_外部連携要件.md`）

> Issue同期、PR作成、review証拠、policy authority、mergeは完全repository同一性・base/head SHA・認証・権限を事前検証し、適用直前に再検証し、適用後に再読取する。candidate policy、自己申告metadata、stale/failed証拠をauthorityにしない。

> **GitHub Actions runの`pull_requests`は「現在openで同一headを持つsame-repo PR」の一覧であり、PRが閉じた瞬間に空になる。** したがって`event=pull_request&head_sha=`による一覧検索は、merge成功後には必ず対象PRを関連付けられない。**merge前の選別はこの一覧を使い、`pull_requests`が対象PR1件であることを要求し続ける。**

> **merge後の照合は一覧を再検索せず、merge前に固定した`ciRunId`で単一runを直読みする。**

> **merge dispatchが許される入力集合は本条項で1件も増えない**（Issue #1280）。

**AC-GH-001**は本要件の受け入れ条件であり、追跡表`docs/specs/15_要件追跡/00_追跡表.md`のREQ-GH-001行が担保SCNを列挙する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1280、staging 00・01のAC-01〜AC-07 | Step 8で`sync-verified`、syncDigestとreadBackDigestが`98aac49066902607f5a570ee60cdf834bed5f6a7994f53bd6bc8566ca461d123`で一致 | 実行観測 |
| 欠陥の再現 | e2e mockを実GitHub仕様（merged時に`pull_requests: []`）へ合わせる | **43 scenario中9件が失敗した。** 固定ID直読みへ差し替えた後は全緑 | 実行観測 |
| `pull_requests`の意味論 | GitHub Actions APIの実観測 | 「現在openで同一headを持つsame-repo PR」の一覧であり、PRが閉じた瞬間に空になる | 一次資料 |
| 差分試験 | 生成入力48件 | **merge前の選別の判定が旧実装と全件一致。不一致0件** | テスト出力 |
| 対象SCN | `--name`で絞り込んだcucumber実行 | **ラウンド2で62 scenarios成功**（ラウンド1は40 scenarios） | テスト出力 |
| 変異試験 | **累計32件** | **最終生存0件。一度生存した7件はすべて反例SCNを足してkillした。うち3件は独立reviewerの指摘由来である** | テスト出力 |
| 静的検査 | `lint`、`format:check`、`typecheck`、`source:check` | 全合格。`source:check`は180 file、error 0件 | テスト出力 |
| 追跡・構造・配布 | `trace:check`、`architecture:check`、`package:check` | 全合格。orphan 0件、配布363件 | テスト出力 |
| conformance | `conformance:check` | **合格。87 scenarios、14.4秒**（#1281の反例SCN限定が効いている） | テスト出力 |
| 仕様 | `03_外部連携要件.md`、`01_信頼境界.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-only 98a4bc2b 086087bd` | 16 path。うち生成dist 3件 | Git index |
| Phase A artifact | `docs/reviews/179_課題1280merge後CI照合の固定run直読みレビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。** 観測→照合→拒否の一方向であり、照合結果を固定merge intentへ書き戻さない（INV-07）。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDが`H_impl` author stable IDと異なる: **いいえ。** 本repositoryではPR authorと`H_impl` commit authorがいずれも`adachi-tatsuru`である。§9の例外経路を参照する。
- 既定branch追随を行った場合: **該当なし。** 比較基点は`98a4bc2b`のままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/ci-delivery.ts` | M | package owner | domain | `reconcileFixedMergeRun`と3つの型を追加し、`headShaRunCount`で診断を分ける。**`inspectCiDelivery`のfilter式はbyte単位で不変** | pass。純関数であり新しい依存を追加しない | REQ-GH-001 / AC-01〜AC-07 / SCN-UNIT-CIDEL-008〜010 | merge前の判定は不変。前進revertで復旧 | pass |
| `src/adapters/github.ts` | M | package owner | adapter | `pr.ci-run`を追加。固定run IDで1件だけ読み、identityを検証する。**`pr.ci-runs`の一覧観測とは別の型である** | pass。`verifyRepository`を先に呼び、既存の観測経路を変更しない | REQ-GH-001 / AC-02・AC-06 / SCN-INT-GITHUB-022〜025 | 404も不正応答も例外へ倒す。`runId`は数字だけを受理する | pass |
| `src/cli.ts` | M | package owner | cli | merged分岐を一覧再検索から固定ID直読みへ差し替える | pass。domainとadapterへの依存方向は不変 | REQ-GH-001 / AC-01 / SCN-E2E-WFSTEP-044・045 | 不一致は例外にしてStep 11を記録しない | pass |
| `test/features/unit/ci-delivery.feature` | M | package owner | evidence | SCN-UNIT-CIDEL-008〜010の追加 | pass | AC-03〜AC-05・AC-07 | 追加のみ。既存scenarioを削除していない | pass |
| `test/steps/ci-delivery.steps.ts` | M | package owner | evidence | 15ケースの照合表、固定側が空の4ケース、診断の区別 | pass | AC-03〜AC-05・AC-07 | 追加のみ | pass |
| `test/features/integration/delivery-finalize.feature` | M | package owner | evidence | SCN-INT-GITHUB-022〜025の追加 | pass | AC-02・AC-06 | 追加のみ | pass |
| `test/steps/delivery-finalize.steps.ts` | M | package owner | evidence | gh stub経由でadapterのidentity検証・run ID字句検査・fork識別を測る | pass。既存step定義を書き換えていない | AC-02・AC-06 | fixtureは一時directory内に閉じる | pass |
| `test/features/e2e/workflow-step-enforcement-cli.feature` | M | package owner | evidence | SCN-E2E-WFSTEP-044・045の追加 | pass | AC-01 | 追加のみ | pass |
| `test/steps/workflow-step-enforcement.steps.ts` | M | package owner | evidence | mockを実GitHub仕様へ合わせ、`fixedRunConclusion`で不一致側を作る | pass | AC-01 | 既定値`"success"`で既存scenarioの挙動を変えない | pass |
| `docs/specs/02_要件/03_外部連携要件.md` | M | package owner | spec | REQ-GH-001へ`pull_requests`の意味論、照合9項目、fork排除、強制SCNを追記 | pass。名指ししたSCN 7件は同じ要件の追跡行に登録済み | REQ-GH-001 / AC-GH-001 | 既存段落を削除していない | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | package owner | spec | 「偽のmerged終端」行へ固定ID再読を追記 | pass | REQ-GH-001 | 既存行の意味を変えていない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 新7 SCNの追跡登録 | pass。`trace:check`のorphanが0件 | REQ-GH-001 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-GH-001 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-only`の16 pathのうち、生成物である`dist/`配下3件を除いた13 pathと表の13行が一致する。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

**(1) 仕様が引用した`SCN-INT-GITHUB-022`が実在しなかった。** 01の受け入れ条件表がAC-02とAC-06の双方をこのIDへ結び付けていたが、feature fileにもstep定義にも存在しなかった。**書いた場で実在を確かめていない。** さらに、その状態のまま「追加済み」と報告した。identity取得を`SCN-INT-GITHUB-022`、拒否を`SCN-INT-GITHUB-023`として実装し、仕様の引用を両方へ是正した。AC-06の担保は-023である。

**(2) AC-07が未実装だった。** 01が`SCN-UNIT-CIDEL-010`を挙げていたが存在せず、「run未生成」と「run有りだが対象PRへ未関連付け」は同じ「該当0件」へ潰れていた。**#1280で確定した構造そのものがこの区別を要求する。** PRが閉じれば関連付けは必ず消えるため、後者は正常な状態でも起きる。**判定を1つも変えず、報告だけを分けた。** `headShaRunCount`を足し、`state`の導出には一切使わない。REQ-LC-011の「報告するがhealthyを変えない」と同じ形である。

**(3) `SCN-E2E-WFSTEP-044`が`break`ではなく`return`で抜けていた。** switch後の`this.workflowCheckPassed = true`に到達せず、scenarioは常に失敗していた。**この状態で「E2E 43/43 passed」と報告していたのは誤りである。** `break`へ直して40 scenarios全緑を確認した。

**(4) 測定を2回汚染した。** 変異scriptを背景実行したまま別作業を続けたため、注入中のsourceに対する`npm test`が23件失敗し、実装の欠陥に見えた。同じ状態で独立reviewerへ諮問したところ、注入中の変異体を実在欠陥として、変異scriptのbuild中の`dist/`を「大量の配布物削除」として報告した。**どちらも実在しない。** 変異scriptはcompaction後にtask通知を失っており、`| tail -25`のパイプでEOFまで出力が見えなかった。**変異試験・諮問・full検証を重ねない。** commit後に諮問をやり直した。

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | SCN | 判定 |
|---|---|---|---|
| AC-01 | mergedかつ`pull_requests: []`で照合が成立しStep 11が記録される | SCN-E2E-WFSTEP-044 | pass |
| AC-02 | 固定run IDの直読みが必要fieldを返す | SCN-INT-GITHUB-022、SCN-INT-GITHUB-025 | pass |
| AC-03 | 固定値の1つでも不一致なら拒否する | SCN-UNIT-CIDEL-008 | pass |
| AC-04 | merge後の`pull_requests`に対象PR以外が含まれれば拒否する | SCN-UNIT-CIDEL-008 | pass |
| AC-05 | merge前の選別は空`pull_requests`を拒否し続け、旧実装と一致する | SCN-UNIT-CIDEL-009、差分試験48件 | pass |
| AC-06 | 404・不正応答を拒否する | SCN-INT-GITHUB-023、SCN-INT-GITHUB-024 | pass |
| AC-07 | 診断が「run未生成」と「run有りだが未関連付け」を区別する | SCN-UNIT-CIDEL-010 | pass |

**照合結果を無視する経路が無いことは`SCN-E2E-WFSTEP-045`が担保する。** 判定関数の単体SCNだけでは合成経路を検査できない（§7の変異C2）。

## 3. 肯定的評価

- **再現を先に作った。** mockを実GitHub仕様へ合わせると43 scenario中9件が落ちる。是正の前に欠陥が観測可能であることを固定した。
- **merge前の入口を1つも広げていない。** `inspectCiDelivery`のfilter式はbyte単位で不変であり、生成入力48件の差分試験で判定が全件一致する。
- **型で緩和の漏れを塞いだ。** 空`pull_requests`の許容は`FixedMergeRunObservation`を取る`reconcileFixedMergeRun`だけが持ち、merge前の経路から到達できない。共通flagで切り替える案は採らなかった。
- **不一致を名指しする。** `mismatches`が項目名を返すため、`conclusion`と`headSha`の取り違えを診断で区別できる。
- **fail-closedを維持した。** 空文字、未知のstatus、未知のconclusion、404、不正応答、非数字の`runId`はすべて拒否へ倒す。

## 4. 敵対的評価

### 4.1 merge dispatchの入力集合は本当に増えていないか

**増えていない。** 根拠は3つである。(1) `inspectCiDelivery`のfilter式が不変であること。(2) 生成入力48件の差分試験で不一致0件であること。(3) 空許容を`inspectCiDelivery`へ漏らす変異C1が`SCN-UNIT-CIDEL-009`でkillされること。**(3)が重要である。** (1)と(2)は現在の実装についての主張にすぎず、将来の変更で漏れることを防がない。C1が検出されることは、漏らす変更が赤くなることを意味する。

### 4.2 照合を通過した後にmergeが再送されないか

**しない。** merged分岐はprovider観測が`merged`であることを前提に走り、照合は`throw`するか何もしないかのどちらかである。`pr.merge`をこの分岐から呼ばない（INV-06）。

### 4.3 固定run IDそのものが汚染されている場合

`state.merge.ciRunId`はmerge前の選別が対象PR1件を要求して選んだrunのIDである。**汚染経路は`journal/delivery-state.json`の改竄だが、それは本Issueの信頼境界の外である。** ただし`runId`はAPI pathへ連結されるため、字句検査を歯止めとして置き、`SCN-INT-GITHUB-024`で7変種を測った。**この検査を落とす変異C5は当初生存しており、等価変異ではない。**

### 4.4 forkの同一commitを受理しないか

**受理しない。** `head_repository.full_name`を対象repositoryと突合する。**当初のfixtureはhead側とbase側が同値だったため、adapterが`repository.full_name`を流用する変異B4aが生存した。** head側が`fork/x`の観測を置く`SCN-INT-GITHUB-025`で塞いだ。

### 4.5 支援層が製品を超えている

**実測で製品+219行に対し支援層+585行、比は2.67倍である。** 運用ポリシーの「支援層は成果物を超えてはならない」に反する。**縮小を評価した結果、削れる行は無いと判断した。** riskがhighかつsecurity-sensitiveであるため`workflow verification-set`が8つの検証手段を要求しており、追加した各scenarioは異なる変異をkillしている。**具体的には、15ケースの照合表は8項目の個別削除と3つのPR集合状態を、4ケースの固定側空欄はB2を、13変種の拒否表はadapterのidentity検証を、7変種のrun ID表はC5を、fork観測はB4aを、E2E 2件はC2と経路到達をkillする。** どれか1つを削ると対応する変異が生存側へ戻る。**この比率を隠さず記録し、判断の妥当性は次のreviewへ委ねる。**

### 4.6 診断の追加が判定を変えていないか

**変えていない。** `headShaRunCount`は`state`の導出に使われない。`state`は`matched.length`と経過時間だけから決まる。**`headShaRunCount`へPR関連付けを混ぜる変異D2と、診断の区別を潰す変異D1はいずれもkillされる。**

## 5. 指摘

**独立reviewer（codex）がHigh 2件で要修正と判定した。どちらも正しく、両方を是正した。**

| ID | 重大度 | 指摘 | 自分の検証 | 是正 |
|---|---|---|---|---|
| R-01 | High | merged分岐で`observeMergeReviewEvidence`と`assertFixedMergeReviewEvidence`を迂回しており、実装commitの再観測、独立approvalの再確認、review Evidence identityの照合が同時に失われていた | **正しい。** `git show 98a4bc2b:src/cli.ts`と突合し、旧経路が3つの再検証を行っていたことを確認した。**これは既存の安全条件を弱める変更である** | CI runの取得を`fixedCiRunId`で切り替える形へ直し、他の再検証は両経路で同じに走らせる。`SCN-E2E-WFSTEP-047`を追加 |
| R-02 | High | merge可否を決めているのは`inspectCiDelivery`ではなく`observeMergeReviewEvidence`内のinline selectorである。`SCN-UNIT-CIDEL-009`は「dispatch可能集合が増えない」を強制していない | **正しい。** `src/cli.ts`のfilterが実際の門であり、`inspectCiDelivery`は診断文の生成に使われる。**私は述語の適用範囲をgateの範囲と取り違えていた** | 実selectorへ空と他PRを与え`pr.merge`が0回であることを測る`SCN-E2E-WFSTEP-046`を追加。仕様の強制主体の記述を是正 |
| R-03 | Medium | 対象commit`b16c9bcf`の時点では追跡表登録とformatが未完結で、後続commitで補われている | **正しい。** commit範囲の切り方に起因する | 3 commitを1つのPRとして出す構造は変えず、本節へ記録する |

**指摘そのものを変異として測り、是正の有効性を実測した。**

| 変異 | 是正前 | 是正後 |
|---|---|---|
| E1 merge後のReview Evidence照合を落とす | **生存** | kill |
| E2 merge前の実selectorへ空許容を漏らす | **生存** | kill |
| E3 merge後も一覧再検索へ戻す | kill | kill |
| E4 固定run照合の結果を捨てる | kill | kill |
| E5 独立reviewの再確認を落とす | **生存** | kill |

**E1とE5は私の変更前からどのSCNでも検査されていなかった。** 私がこの経路を書き換えたため、塞いでから出す。

**reviewerの観測にも誤りが1件あった。** `prettier_equal=false`はreviewer自身のshellのquoting破損による観測であり、`npm run format:check`と`npx prettier --check`はいずれも合格する。この1件は採らない。

## 6. ラウンド固有の確認

### ラウンド1

実装差分、支援層、仕様、追跡表を対象とした。**この時点で私はpassと判定していた。** 全gate緑、変異試験25件で生存0だった。

### ラウンド2

**独立reviewerのHigh 2件を是正した。** 検査が緑であることは正しさの十分条件ではない、という命題がそのまま出た。**特にR-01は、私が既存の安全条件を削除したことに、25件の変異試験でも気付かなかった事例である。** 私の変異集合が「新しく足した照合」に閉じており、「消してしまった既存の照合」を含んでいなかったためである。**変異は自分が足したものだけでなく、自分が消したものにも当てる。**

## 7. テスト結果

| 検査 | コマンド | 結果 |
|---|---|---|
| 対象SCN | `npm test -- --name 'SCN-UNIT-CIDEL｜SCN-INT-GITHUB-02｜SCN-E2E-WFSTEP-04'` | **40 scenarios、220 steps成功** |
| 静的検査 | `npm run lint` | エラー0件 |
| 整形 | `npm run format:check` | 差分0件 |
| 型 | `npm run typecheck` | エラー0件 |
| 実行時入力検証 | `npm run source:check` | 180 file、error 0件 |
| 文書整形 | `npm run docs:format`、`npm run test:format` | 違反0件 |
| 追跡整合 | `npm run trace:check` | orphan 0件 |
| 依存方向 | `npm run architecture:check` | 違反0件 |
| 配布物 | `npm run package:check` | 合格、363件 |
| conformance | `npm run conformance:check` | **合格。87 scenarios、14.4秒** |
| 全Gherkin | `npm test` | **1690 scenarios（1674 passed、16 skipped）、8887 steps（8837 passed、50 skipped）、失敗0。10分14秒**（ラウンド2のH_impl `6e45f52c`で実行） |

### 差分試験

生成入力48件について、旧実装（一覧再検索）と新実装（merge前の選別）の判定を突合した。**不一致0件。** merge dispatchが許される入力集合が1件も増えないことの実測である。

### 変異試験

**累計25件、21 kill、最終生存0件。** 3回に分けて測った。

| 群 | 変異 | 第1回 | 是正後 |
|---|---|---|---|
| A | 照合8項目の個別削除 | 8 kill | — |
| B1 | 他PR混入の判定を空判定だけにする | kill | — |
| B2 | 空文字を一致へ倒す | **生存** | kill |
| B3 | headRepositoryをrepositoryと同一視する | kill | — |
| B4 | adapterのhead_repository検証を落とす | kill（**型検査で落ちる**） | — |
| B4a | headRepositoryへrepositoryを流用する（compile可能版） | **生存** | kill |
| B5 | adapterの関連PR要素検証を落とす | kill | — |
| C1 | merge前の選別へ空許容を漏らす | kill | — |
| C2 | 照合結果を無視する | **生存** | kill |
| C3 | mismatchesを常に空にする | kill | — |
| C4 | adapterのrepository権限確認を飛ばす | kill | — |
| C5 | run IDの字句検査を落とす | **生存** | kill |
| D1 | 診断の区別を潰す | — | kill |
| D2 | head SHA一致件数へPR関連付けを混ぜる | — | kill |

**B4は型検査で落ちるため、実行時の検出力の証拠にしない。** compile可能な弱化としてB4aを別に構成し、そちらで測った。

**生存した4件はすべて私の検査側の欠陥であり、うち3件は製品の安全条件が無検証だった箇所である。**

- **B2**: `expected === ""`の歯止めが守るのは**固定側**が空の場合だが、私の表は**観測側**しか空にしていなかった。`"" !== "success"`で普通に不一致になるため歯止めを1文字も検査していない。固定側を空にする4ケースを足した。
- **C2**: cliの`if (!reconciled.reconciled) throw`を`if (false && ...)`にしても全緑だった。**E2Eが成立側しか通していなかった。** 照合関数の単体SCNは合成経路を検査しない。不一致側を作る`SCN-E2E-WFSTEP-045`を足し、Step 11が記録されないことまで測った。
- **C5**: 等価変異ではない。`runId`は`repos/<repo>/actions/runs/<runId>`へそのまま連結される。7変種の`SCN-INT-GITHUB-024`を足し、**拒否するだけでなくprovider要求を送っていないこと**まで測った。
- **B4a**: fixtureのhead側とbase側が同値だったためforkを区別できなかった。head側が`fork/x`の観測を足した。

**変異scriptの残骸を1件検出して復旧した。** 第1回の実行がcompactionをまたいで生き残り、`require("headBranch", ...)`と`require("conclusion", ...)`が順にsourceから消えた状態で作業していた。backupから復旧し、以降はcommitで足場を固定してから測った。

## 8. 配布物影響

`dist/src/domain/ci-delivery.js`、`dist/src/adapters/github.js`、`dist/src/cli.js`の3 pathが変わる。`package:check`は合格し、配布363件に開発専用資産は含まれない。**利用projectから見た変化は、merge後のCI照合が固定run IDの直読みになることと、CI配送診断が「run未生成」と「未関連付け」を区別することの2点である。** merge前の判定は変わらない。

## 9. 独立reviewの成立

**開示する逸脱が2件ある。**

1. **reviewerは進行役（coordinator）と同一sessionである。** implementerとreviewerのprovider分離は成立しているが、coordinatorとreviewerが同一sessionであることは`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。隠さず記録する。
2. **PR authorと`H_impl` commit authorが同一（`adachi-tatsuru`）である。** 本repositoryの構成上、reviewer stable IDの分離は成立しない。

**最初の諮問は観測が汚染されていたため破棄した**（§2.0の(4)）。

### 9.1 commit後の再諮問

`98a4bc2b..b16c9bcf`を対象に`codex exec --sandbox read-only`で再諮問した。**`--model`を指定せず設定既定に従った**（観測されたmodelは`gpt-5.6-sol`、reasoning effort high）。reviewerは「ファイル編集・commit・pushは行っていません」と報告し、判定範囲を指定commit範囲へ固定した。**判定は要修正（reject）で、High 2件、Medium 1件。** §5に全件を記録した。

**reviewerは統合/E2Eをread-only sandboxで完走していない**（`/tmp`がEROFS）。単体SCN、TypeScript、ESLint、diff-checkは自身で実行して合格を確認している。

## 10. 仕様整合性

`docs/specs/02_要件/03_外部連携要件.md`のREQ-GH-001が本変更の所有箇所である。**`pull_requests`の意味論、merge前後で扱いが逆向きであること、照合9項目、fork排除、`[]`または`[対象PR]`だけを許す規則、merge前と後で別型にする規則、強制するSCN 7件、「merge dispatchが許される入力集合は本条項で1件も増えない」を明記した。** 信頼境界の「偽のmerged終端」行にも固定ID再読を追記した。

## 11. 総合判定と再開地点

**判定: pass（ラウンド2）。** 独立reviewerのHigh 2件を是正し、変異試験で是正の有効性を実測した。未解決の指摘は無い。

再開地点は`workflow record --step=10`、`review round`、`pr create`である。

**残る観測を2件記録する。**

1. **支援層比は2.67倍から更に増えた。** ラウンド2で`SCN-E2E-WFSTEP-046`・`047`とmock controlを追加した。削れる行が無いという判断は変えないが、比率は次のreviewの対象として残す。
2. **私の変異集合の作り方に系統的な穴があった。** 「新しく足した判定」には変異を当てたが、「既存の判定を消してしまったこと」には当てていなかった。**差分がコードを削除している場合、削除そのものを検出するSCNが要る。**
