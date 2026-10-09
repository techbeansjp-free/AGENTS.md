---
name: step-10-review
description: exact-headの実装をGitから直接reviewし、finding状態と検証Evidenceを構造化して残し、PR作成可否を判定する。
---

# ステップ10: 実装レビュー

**reviewの目的は仕様適合（Conformance）、security、正しさ（Correctness）の確認であり、文章の審査ではない。** 入力はGitと仕様であり、実装者が変更内容を説明し直した文書ではない。成果物はreview sessionの構造化data（finding状態、round digest、固定HEAD）と、収束後に`review export`が生成するreview証跡1 fileである。人もAIもreview証跡の本文を書かない。影響不明時のfull確認と未解決blockerの扱いは[品質基準のレビュー収束契約](../../docs/02_品質基準.md#レビュー収束契約)に従う。**Step 10はPR作成前に完了する。** PR番号・Actions run ID・GitHub review IDはこの時点で存在しないので要求しない。

## 入力

- round 1: 承認済み計画（封印済み00〜03と`05_計画変更.md`）、`docs/specs/`、比較基点SHA、候補HEAD（Step 9の`implementationHeadSha`）。reviewerは`git diff <base>..<head>`、`git log`、`git show`でcode・test・仕様の変更を自分で読む。
- round 2以降: `review round --init`が生成する骨子の`focus`（前round未解決blocker、前回review済みHEADからの`fixedDiff`、影響集合から導出した`adjacentScope`）と、骨子の`inspection`・必要時の`cumulative`。計画全文、過去roundの記録全文、仕様全体を再投入しない。Verificationの`full`だけを全体再reviewの理由にしない。骨子が隣接範囲を限定できない、または`inspection`/`cumulative`が全体検分を要求する場合は、その割当どおり広げる。

## 調査の入口と終了

coordinatorは生成済み`agentDispatch`と正式round骨子のpointerを渡し、実装説明を再生成しない。reviewerは以下をGit・骨子・関連契約から確認する。新しい探索表や報告書は作らない。

- 対象と契約: `inspection`/`cumulative`の比較基点・HEAD・pathとanchorのAC/Invariant。契約IDで該当節を検索し、既知の要求全体を再起草しない。
- 失敗経路と反例: 変更の入力境界・error path・security・data整合性、既存testの見落とす反例。round 2以降は`previousBlocking`、修正差分、失効した契約から始める。
- 必要な既存code: `focus.adjacentScope`の根拠を起点に直接依存・consumerを読む。範囲外の根拠は生成された割当に求め、到達不能だけで安全と判断しない。
- 拡張: 契約矛盾、未知のconsumer、security/trust境界、反例、隣接範囲の証明不能があれば該当依存へ広げる。割当済みの全体/累積検分を狭めない。
- 終了: 割当scopeの契約・失敗経路を検分し、前blockerを再評価し、新しい具体的疑問が残らなければfindingを記録して返す。必要な反例探索や独立性を時間上限で打ち切らない。

## 手順

1. `review round --init --staging=<staging> --head=<H_impl>`（round 1は`--base`・`--scope`・`--ac`を加える）で骨子を生成し、reviewの指摘だけを`findings`へ書いて`review round --apply`で記録する。入力JSON fileはstagingの外に置く。blocking findingの`contractId`はanchorのAcceptance Criteria IDまたはInvariant IDに一致させる。
2. **findingは状態として扱う。** 前round blockerは同じIDのまま骨子へ写されるので、是正済みなら`status`を`resolved`へ変え、`evidence`へ確認した事実を1行で書く。新しい文章として作り直さない。`adjacentScope`は手で書き換えない。記録時にGitから導出し直し、一致しなければ拒否される。
3. 評価基準（`02_品質基準.md`のレビュー収束契約が定める肯定・敵対）は全roundで確認するが、`pass`の項目を文章で残さない。残すのはfindingと判定だけである。
4. 修正可否は派生欠陥一般則よりreview admissionを優先する。正本のbatch規則に従い、安全にまとめられる全blockerを1 batchの前進修正とし、次roundは`previousBlocking`・修正差分・Git由来の隣接範囲を見る。admission規則、発散warning、取り直しの規則は`02_品質基準.md`のレビュー収束契約が所有する。
5. 検証前に`verify plan --staging=<staging> --base=<同じ比較基点SHA>`を一度実行する。`status=observed`なら束縛が一致した`observed`の記録IDを再利用し、同じcommandを再実行しない。`status=required`なら`required`配列の各`scope`と`command`で`verify run`を実行する。`status=blocked`なら理由を解消し、同じ不成立commandを繰り返さない。planはread-onlyのadvisoryであり、後続gateはHEAD・trusted policy等を再照合する。HEADや入力が変わった場合は再観測する。

   Step 9の`H_impl`・比較基点・影響集合を固定した変更のないworktreeで、手順1〜4の独立reviewと並行して`verify run --staging=<staging> --base=<同じ比較基点SHA> --scope=targeted|full -- <検証commandのargv>`を開始できる。session作成前・未収束でも`--base`を明示すれば開始できる。reviewerは読み取り専用で確認し、検証中はHEADとworktreeを変更しない。journalへの書込みは進行役が直列化する。修正は独立reviewと検証の両方の終了または明示中止後に行い、新HEADでは必要な検証と独立reviewを再実施する。同HEAD・同argv等の束縛条件を満たす既存成功記録は正本の再利用条件で参照し、重複実行しない。argvは既定branchのproject policyが`verification`で宣言したcommandだけを受理する（`full`は`fullCommand`そのもの、`targeted`は`targetedRunner`の後ろに影響集合のfeatureを並べたもの）。commandはshellを通さず実行され、HEAD・影響集合digest・終了値がstagingの観測記録へ追記される。影響集合が`full`なら`--scope=full`の実行が必要である。**検証の合格は申告ではなく観測である。** 「実行した」と書いても証跡にはならない。
6. 同じ`H_impl`・比較基点・影響集合について独立reviewが収束し、必要な検証が成功したことを確認してから、`review export --staging=<staging> --issue=<番号> --reviewer=<reviewer ID> --implementer=<implementer ID>`でreview証跡（`<Issue番号>_review.json`）を生成し、実装commitの後にその1 fileだけをcommitして`H_final`にする。証跡の検証欄は`H_impl`と影響集合に一致する合格した観測記録から導出され、無ければ生成しない。reviewer・implementer・独立性は`declared`（申告）として記録され、hard gateの根拠にならない。`workflow record --step=10`は`H_final`で実行でき、bindingはsessionのcandidate HEAD（`H_impl`）のまま記録される。

## reviewerと判定

### routing入力契約

role欄の担当roleが`reviewer`であること、必要能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄、対象差分を変更していない証拠を実装時のrouting evidenceと突合する。providerとmodel設定はproject choiceの入力契約として扱い、固有のmodel slugからreview authorityを推測しない。Codex起動差分では`routing launch`の観測時刻・入口・selectedModel/dispatchedModel・trusted selector採用tier・policy SHA・終了eventを確認し、dispatch引数をproviderが実効modelをattestした証拠へ読み替えない。

### 委譲と独立review

ローカルまたはユーザー共通のローカルLLM reviewer設定が有効なら、`routing delegated-review-diff --root=<root> --base=<比較基点SHA> --head=<H_impl> --staging=<staging>`で委譲し、返った候補を進行役がHEADのcode・仕様・test・失敗経路で確かめて採否を決める。ローカルLLMの判定を最終判定へ直結しない。利用可能な別reviewer（Codex SolまたはOpus）にも同じ固定HEADを独立にreviewさせる。

- 分類（severity等）と理由の記入（DCAND-006）は人・進行役の直接分類（`decisionRef: null`）を標準とする。曖昧な分類を委譲して得た提案を記録する場合だけ、`agent-skill-chain decision invoke --type=DCAND-006 --staging=<staging> --input=<file> --apply`を使う。これは外部LLM呼出ではなくself-serveの提案記録であり、advisoryとして進行役が確認して`confirmedBy`を付け、`effectiveValue`確定後の`decisionRecordId`を`decisionRef`へ書く。提示した参照の機械検証は維持する。曖昧な分類への助言を活用しても、決定論的admissionはruntimeだけが導出する。
- reviewer選定（DCAND-009）は`decision invoke --type=DCAND-009`で行う。`candidateSet`と`proposedValue`はprovider ID（`codex`・`claude`）。
- CodeRabbitの利用枠制限の判定（DCAND-008）は`decision invoke --type=DCAND-008`で行う。`confirmed-limited`ならOpusとCodex Solの両方へ独立reviewを委譲し、片方を利用できなければ未実施として人間へ再開条件の判断を求める。

モデルの多数決や`decision`だけで承認・却下しない。候補0件やモデル間の一致だけを承認根拠にしない。

**独立性はproject policyの`merge.reviewIndependence`が決める。** `context-isolated`（既定）はimplementerと別session/context、exact HEAD固定、対象差分を変更していないことを要求し、同一GitHub actorでも成立する。`actor-independent`はPR author・implementation commit authorと別のstable actor IDを要求する。要求水準を確認できなければ承認しない。reviewerはfindingを隠す修正を行わない。

## securityと非code成果物

security境界（認証、認可、秘密情報、入力境界、filesystem、process実行、network、不可逆操作、依存、data整合性、権限、並行性）に触れる変更は、影響集合の`securitySensitive`にかかわらず毎回確認する。securityは縮小の対象にしない。

差分が実装言語以外の成果物（shell script、Makefile、CI workflow）を含む場合は、その種別の静的解析を当てる。これらは検査する側の仕組みであり、壊れると他のすべての検査が黙って素通りする。当てられるツールが無い場合はその事実をfindingの`evidence`へ残し、当てたものとして扱わない。

Makefileは`make -n <target>`で展開した実commandへ当てる。**ただし`make -n`は安全な静的展開器ではない。** 読み込み時に評価される`$(shell ...)`は`-n`でも実行されるため、書き込み不可のfilesystem、network分離、資源制限を持つsandbox内で差分が触れたtargetに限って実行する。**sandboxは認証情報も分離する。** 環境変数は許可listだけを渡し、credential mountとagent socketを到達不能にし、出力に認証情報が混入していないことを確認する。変数展開後の定数比較に対する指摘は、その比較が設計上つねに定数になる場合に限り誤検知であり、未定義変数や誤記で意図せず定数化した場合は真の欠陥として扱う。

## PR作成後の指摘

`pr-bound`後の是正・既定branch追随は、同じsessionへ`review round --init --head=<H_impl>`の割当どおりのroundを記録する。雛形の`inspection`（必要時`cumulative`）が示す`git diff`範囲・pathをreviewerへ渡し、割当を書き換えずに`--apply`する。既定branch追随で比較基点が動いた場合、雛形は`followOnly`を立てず`actualAuditBase`からの全体検分（`cumulative.scope=all`）を割り当てる。notesが追随後の`--base`を示した場合は、`verify run`と`review export`へその`--base`を渡す。`pr merge`の拒否診断（REQ-WF-005）が名指しする次の操作に従う。全体検分round・累積検分roundは`review round --init`が割り当てる。`review replace`を名指しされた場合や、旧形式sessionを暫定guardが比較基点・実効H_impl・counted round数で拒否した`pr-bound`のPRは、current H_implで収束済みなら同じPR・同じstagingのまま`review replace --staging=<staging> --dry-run`で前提を確かめてから`--apply`で置換する。置換前に実装を是正した場合は、先に旧sessionのpost-PR intake roundを収束させ、`workflow record --step=10 --post-pr-intake`、`review export`、push、`pr reanchor`でPR束縛を前進させてから置換する。続けて置換記録のH_implへdetachし、`review round --init --head=<H_impl> --base=<git merge-base <H_impl> refs/remotes/origin/HEAD>`でround 1（full-scope）を収束させる。このmerge-baseが旧chainのbaseと一致しなければ、R6または基点不一致の既存診断に従う。必要なら`verify run`し、branchへ戻って`workflow record --step=10 --post-pr-intake`、`review export`、push、`pr reanchor`の順に進める。`review-session.json`を削除・編集しない。未収束のsessionは置換できないので、先にpost-PR intakeで収束させる。

`pr create`より後に届いた外部reviewerの指摘は、条件を満たす場合に同じPRへ取り込む。条件と手順の正本は[01_開発ワークフロー.md](../../docs/01_開発ワークフロー.md#レビュー配置と前向きな変更処理)であり、ここへ複写しない。Step 11前の`pr-bound`中は`workflow record --step=10 --post-pr-intake`、Step 11記録後は`--post-terminal-intake`を使う。取り直しroundは収束後にHEADが動いたとき同sessionの次roundとして開き、round数を分離・停止の理由にしない（記録できるroundは数えないroundを含め64件まで）。分離6条件のいずれかに該当する指摘だけをfollow-up Issueとする。指摘を無記録で通過させない。

review中またはPR review中に見つけた欠陥の修正可否は[品質基準のレビュー収束契約](../../docs/02_品質基準.md#レビュー収束契約)に従う。修正対象のfindingは[派生した欠陥の是正原則](../../docs/01_開発ワークフロー.md#派生した欠陥の是正原則)に従い、分離6条件のいずれかに該当しない限り同じIssue・同じPRで直すfindingにする。round数が多いことは分離の理由にしない。目的にASC本体の保守を含まないIssueで、その欠陥がASC本体側にある場合は[ASC本体の是正を作業scopeへ入れない](../../docs/01_開発ワークフロー.md#asc本体の是正を作業scopeへ入れない)に従う。

## review証跡の配置

**review証跡のテンプレートはない。** 証跡は`review export`が収束済みreview sessionから生成する`docs/reviews/<Issue番号>_review.json`であり、人もAIも手で書かない。`staging.tracked=false`のstagingは版管理外である。`staging.tracked=true`ではstagingの計画文書を版管理するが、どちらの場合もstaging内のfileをreview証跡として扱わない。証跡は`docs/reviews/`または`.agent-skill-chain/reviews/`配下へ置き、実装commitの後にその1 fileだけをcommitして`H_final`にする。この証跡commitに対する取り直しroundは要らない。H_final後は証跡を更新しない。是正が必要なら前進commitで次roundを収束させ、`review export`で生成し直す。

## execution context境界

標準の`short-lived`方式では、[開発ワークフローのexecution context境界](../../docs/01_開発ワークフロー.md#execution-context境界)に従い、この担当work unitへfresh contextを割り当てる。repository/stagingから復元し、完了後に別工程・別review round・finding是正を同じcontextへ追加しない。workerの成果物・検証・必要なcommit・返却・終了の後でcoordinatorがStep/roundを記録する。`compatible`の既存動作と品質gateは維持する。

## テンプレート契約

差分が触れた範囲の追跡先を確認するときは[Semantic Graphの利用](../../docs/01_開発ワークフロー.md#semantic-graphの利用)を読み、影響集合は`impact`で導出する。

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)と[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を読み、成果物間の責務越境、封印済み計画の書き換え、対象版とシステム仕様書の不一致、未定義語・重複定義・根拠なしの意味変更をfindingにする。

project choicesと対象成果物のDC行を読み、**DC判定が`applicable`の領域と、対象差分が実際に触れた領域だけ**、作業開始前に対応するtemplateの全文を読む。同じcontextで既読かつ変更のないtemplateを再読せず、担当外のtemplateへ読取を広げない。[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)はDC-PRIVACYが`applicable`のとき、[利用性・互換性・保守性](../../templates/specs/11_非機能/02_利用性・互換性・保守性.md)と[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)はDC-OBSERVABILITYが`applicable`のとき、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)と[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)は差分がsourceまたはtestを含むとき、[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)はUIまたはtoken capabilityが`not-applicable`でないときに読む。`not-applicable`と判定した領域のtemplateを読む固定費を課さない。

`verify run`または`review export`が検証command未宣言で停止した場合は、`doctor`の`workflowReadiness.verification`を確認する。利用projectの実検証argvをmanifestの`verification.fullCommand`・`targetedRunner`へ宣言し、既定branchへの先行導入後に実検証をやり直す。candidate側だけの追記や手書きのレビューMarkdownを正式証跡として代用しない。実DBでの並行性など未実施の検証は未実施のまま残し、単体test成功で実環境の観測を主張しない。
