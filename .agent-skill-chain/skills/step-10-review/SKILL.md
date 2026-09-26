---
name: step-10-review
description: exact-headの実装をGitから直接reviewし、finding状態と検証Evidenceを構造化して残し、PR作成可否を判定する。
---

# ステップ10: 実装レビュー

**reviewの目的は仕様適合（Conformance）、security、正しさ（Correctness）の確認であり、文章の審査ではない。** 入力はGitと仕様であり、実装者が変更内容を説明し直した文書ではない。成果物はreview sessionの構造化data（finding状態、round digest、固定HEAD）と、収束後に`review export`が生成するreview証跡1 fileである。人もAIもreview証跡の本文を書かない。影響不明または未解決Critical/Highは停止する。**Step 10はPR作成前に完了する。** PR番号・Actions run ID・GitHub review IDはこの時点で存在しないので要求しない。

## 入力

- round 1: 承認済み計画（封印済み00〜03と`05_計画変更.md`）、`docs/specs/`、比較基点SHA、候補HEAD（Step 9の`implementationHeadSha`）。reviewerは`git diff <base>..<head>`、`git log`、`git show`でcode・test・仕様の変更を自分で読む。
- round 2以降: `review round --init`が生成する骨子の`focus`（前round未解決blocker、前回review済みHEADからの`fixedDiff`、影響集合から導出した`adjacentScope`）と、`impact --base=<前回HEAD> --head=<現在HEAD>`の結果だけ。計画全文、過去roundの記録全文、仕様全体を再投入しない。`impact`が`full`を返したら全体を見る。

## 手順

1. `review round --init --staging=<staging> --head=<H_impl>`（round 1は`--base`・`--scope`・`--ac`を加える）で骨子を生成し、reviewの指摘だけを`findings`へ書いて`review round --apply`で記録する。入力JSON fileはstagingの外に置く。blocking findingの`contractId`はanchorのAcceptance Criteria IDまたはInvariant IDに一致させる。
2. **findingは状態として扱う。** 前round blockerは同じIDのまま骨子へ写されるので、是正済みなら`status`を`resolved`へ変え、`evidence`へ確認した事実を1行で書く。新しい文章として作り直さない。`adjacentScope`は手で書き換えない。記録時にGitから導出し直し、一致しなければ拒否される。
3. 評価基準（`02_品質基準.md`の有限レビュー契約が定める肯定・敵対）は全roundで確認するが、`pass`の項目を文章で残さない。残すのはfindingと判定だけである。
4. 修正は前進commitで行い、次roundは修正差分と影響集合だけを見る。予算と取り直しの規則は`02_品質基準.md`の有限レビュー契約が所有する。
5. 収束したら`H_impl`をcheckoutした変更のないworktreeで`verify run --staging=<staging> --scope=targeted|full -- <検証commandのargv>`を実行する。argvは既定branchのproject policyが`verification`で宣言したcommandだけを受理する（`full`は`fullCommand`そのもの、`targeted`は`targetedRunner`の後ろに影響集合のfeatureを並べたもの）。commandはshellを通さず実行され、HEAD・影響集合digest・終了値がstagingの観測記録へ追記される。影響集合が`full`なら`--scope=full`の実行が必要である。**検証の合格は申告ではなく観測である。** 「実行した」と書いても証跡にはならない。
6. `review export --staging=<staging> --issue=<番号> --reviewer=<reviewer ID> --implementer=<implementer ID>`でreview証跡（`<Issue番号>_review.json`）を生成し、実装commitの後にその1 fileだけをcommitして`H_final`にする。証跡の検証欄は`H_impl`と影響集合に一致する合格した観測記録から導出され、無ければ生成しない。reviewer・implementer・独立性は`declared`（申告）として記録され、hard gateの根拠にならない。`workflow record --step=10`は`H_final`で実行でき、bindingはsessionのcandidate HEAD（`H_impl`）のまま記録される。

## reviewerと判定

### routing入力契約

role欄の担当roleが`reviewer`であること、必要能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄、対象差分を変更していない証拠を実装時のrouting evidenceと突合する。providerとmodel設定はproject choiceの入力契約として扱い、固有のmodel slugからreview authorityを推測しない。Codex起動差分では`routing launch`の観測時刻・入口・selectedModel/dispatchedModel・trusted selector採用tier・policy SHA・終了eventを確認し、dispatch引数をproviderが実効modelをattestした証拠へ読み替えない。

### 委譲と独立review

ローカルまたはユーザー共通のローカルLLM reviewer設定が有効なら、`routing delegated-review-diff --root=<root> --base=<比較基点SHA> --head=<H_impl> --staging=<staging>`で委譲し、返った候補を進行役がHEADのcode・仕様・test・失敗経路で確かめて採否を決める。ローカルLLMの判定を最終判定へ直結しない。利用可能な別reviewer（Codex SolまたはOpus）にも同じ固定HEADを独立にreviewさせる。

- 分類（severity等）と理由の記入（DCAND-006）は`agent-skill-chain decision invoke --type=DCAND-006 --staging=<staging> --input=<file> --apply`で行う。advisoryなので進行役が確認して`confirmedBy`を付けて再実行し、`effectiveValue`確定後の`decisionRecordId`をfindingの`decisionRef`へ書く。人・進行役が直接分類した場合は`null`。
- reviewer選定（DCAND-009）は`decision invoke --type=DCAND-009`で行う。`candidateSet`と`proposedValue`はprovider ID（`codex`・`claude`）。
- CodeRabbitの利用枠制限の判定（DCAND-008）は`decision invoke --type=DCAND-008`で行う。`confirmed-limited`ならOpusとCodex Solの両方へ独立reviewを委譲し、片方を利用できなければ未実施として人間へ再開条件の判断を求める。

モデルの多数決や`decision`だけで承認・却下しない。候補0件やモデル間の一致だけを承認根拠にしない。

**独立性はproject policyの`merge.reviewIndependence`が決める。** `context-isolated`（既定）はimplementerと別session/context、exact HEAD固定、対象差分を変更していないことを要求し、同一GitHub actorでも成立する。`actor-independent`はPR author・implementation commit authorと別のstable actor IDを要求する。要求水準を確認できなければ承認しない。reviewerはfindingを隠す修正を行わない。

## securityと非code成果物

security境界（認証、認可、秘密情報、入力境界、filesystem、process実行、network、不可逆操作、依存、data整合性、権限、並行性）に触れる変更は、影響集合の`securitySensitive`にかかわらず毎回確認する。securityは縮小の対象にしない。

差分が実装言語以外の成果物（shell script、Makefile、CI workflow）を含む場合は、その種別の静的解析を当てる。これらは検査する側の仕組みであり、壊れると他のすべての検査が黙って素通りする。当てられるツールが無い場合はその事実をfindingの`evidence`へ残し、当てたものとして扱わない。

Makefileは`make -n <target>`で展開した実commandへ当てる。**ただし`make -n`は安全な静的展開器ではない。** 読み込み時に評価される`$(shell ...)`は`-n`でも実行されるため、書き込み不可のfilesystem、network分離、資源制限を持つsandbox内で差分が触れたtargetに限って実行する。**sandboxは認証情報も分離する。** 環境変数は許可listだけを渡し、credential mountとagent socketを到達不能にし、出力に認証情報が混入していないことを確認する。変数展開後の定数比較に対する指摘は、その比較が設計上つねに定数になる場合に限り誤検知であり、未定義変数や誤記で意図せず定数化した場合は真の欠陥として扱う。

## PR作成後の指摘

`pr create`より後に届いた外部reviewerの指摘は、条件を満たす場合に同じPRへ取り込む。条件と手順の正本は[01_開発ワークフロー.md](../../docs/01_開発ワークフロー.md#レビュー配置と前向きな変更処理)であり、ここへ複写しない。Step 11前の`pr-bound`中は`workflow record --step=10 --post-pr-intake`、Step 11記録後は`--post-terminal-intake`を使う。取り直しroundは収束後にだけ開き、未解決blockerを抱えたまま予算を使い切った`budget-exhausted`からは開かない。予算超過、受け入れ条件の不充足、安全境界・authority・不可逆操作へ及ぶ指摘はfollow-up Issueとする。指摘を無記録で通過させない。

## review証跡の配置

**review証跡のテンプレートはない。** 証跡は`review export`が収束済みreview sessionから生成する`docs/reviews/<Issue番号>_review.json`であり、人もAIも手で書かない。`staging.tracked=false`のstagingは版管理外である。`staging.tracked=true`ではstagingの計画文書を版管理するが、どちらの場合もstaging内のfileをreview証跡として扱わない。証跡は`docs/reviews/`または`.agent-skill-chain/reviews/`配下へ置き、実装commitの後にその1 fileだけをcommitして`H_final`にする。この証跡commitに対する取り直しroundは要らない。H_final後は証跡を更新しない。是正が必要なら前進commitで次roundを収束させ、`review export`で生成し直す。

## テンプレート契約

差分が触れた範囲の追跡先を確認するときは[Semantic Graphの利用](../../docs/01_開発ワークフロー.md#semantic-graphの利用)を読み、影響集合は`impact`で導出する。

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)と[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を読み、成果物間の責務越境、封印済み計画の書き換え、対象版とシステム仕様書の不一致、未定義語・重複定義・根拠なしの意味変更をfindingにする。

project choicesと対象成果物のDC行を読み、**DC判定が`applicable`の領域と、対象差分が実際に触れた領域だけ**、作業開始前に対応するtemplateの全文を読む。[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)はDC-PRIVACYが`applicable`のとき、[利用性・互換性・保守性](../../templates/specs/11_非機能/02_利用性・互換性・保守性.md)と[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)はDC-OBSERVABILITYが`applicable`のとき、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)と[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)は差分がsourceまたはtestを含むとき、[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)はUIまたはtoken capabilityが`not-applicable`でないときに読む。`not-applicable`と判定した領域のtemplateを読む固定費を課さない。
