---
name: step-10-review
description: exact-headの実装・テスト・仕様証拠を有限にレビューし、PR作成可否を判定する。
---

# ステップ10: 実装レビュー

入力は正確な先頭SHA・差分、受け入れ条件・シナリオ・Verification Evidence・実装中発見記録・仕様の証拠。判断の正本は`review round`で記録するreview session（finding・severity・relation・round）であり、Step 10の成果物は`review export`がそのsessionから生成するreview証跡`docs/reviews/<Issue番号>_review.json`である。影響不明または未解決Critical/Highは停止する。修正後は修正差分と隣接依存だけを再検証し、目的または受け入れ契約が変わらない限り上流工程を再起動しない。**Step 10はPR作成前に完了する。** 収束したreview sessionを`workflow record --step=10`でexact-head・test・仕様整合をevidenceとしてjournalへ追記する。**PR番号・Actions run ID・GitHub review IDはこの時点で存在しないので要求しない。** それらはPR作成後に`review evidence`とdelivery stateへappend-onlyで記録する。

各`review round`の入力JSON fileはstagingの外に置く。blocking findingの`contractId`はanchorのAcceptance Criteria IDまたはInvariant IDに一致させ、単な記録対象へ読み替えない。

ローカルまたはユーザー共通のローカルLLM reviewer設定が有効なら、進行役は各対象roundで`routing delegated-review-diff --root=<対象worktreeのroot> --base=<比較基点SHA> --head=<H_impl> --staging=<対象staging>`を実行してreviewを委譲する。`state=needs_coordinator_review`の肯定・敵対評価、対象内の初回候補、第二passの参考提案と`verificationAssessments`、差分外の除外件数を読む。進行役が確定HEADのコード・仕様・test・失敗経路に照らして候補ごとに採否を判断し、`review round`のadmission規則で根拠付き分類を記録する。入力・出力digest、model、固定HEADはroundのfinding evidenceへ記録する。`degraded`をローカルLLMのreview完了とみなさず、別reviewerの証拠で確認を続ける。`disabled`なら利用可能な別reviewerで確認する。候補0件やモデル間の一致だけを承認根拠にせず、テスト・仕様・独立性・非変更の証拠を確認する。進行役による候補分類をformal independent approvalへ読み替えず、ローカル設定とLLM応答だけからmerge authorityを導かない。

候補ごとの検証記録には、候補ID・主張、出典のcommit/file/位置、成立条件と到達経路、支持根拠、反証候補、実施した検証方法と観測結果を残す。**分類（severity等）と理由の記入（DCAND-006）は`agent-skill-chain decision invoke --type=DCAND-006 --staging=<対象staging> --input=<file> --apply`で行う。** `--input`は`{candidateHeadSha, subjectRef（対象finding ID）, payload: {path, evidence}, proposedValue（提案する分類）}`を持つJSON fileで、`authorityMode=advisory`のため出力の`effectiveValue`は既定で`null`（未確認）になる。進行役が提案を確認したら`--input`へ`confirmedBy=<進行役識別子>`を加えて再実行し、`effectiveValue`が確定してから採用する。出力の`decisionRecordId`をfindingの`decisionRef`欄へ書き、findingの`evidence`には`adjudicationReason`を転記する。人・進行役が直接分類した場合は`decisionRef`をnullのままにする。未確認項目は「未確認」と明記し、モデルの自己申告を観測済みtestへ書き換えない。`verificationAssessments`の`faultCode`・`blockingCode`は第二passの引用主張であり、`sourceCommit`のGit blobと照合する。`evidenceStatus=quote_matched`は引用文字列がblob内にあることだけを示し、到達可能性・意味論・severityを証明しない。`conflicting`または`unsubstantiated`でも初回候補を捨てず、何が矛盾または未裏付けかを記録する。進行役はguard、呼出元の契約、例外経路などの反証を確かめ、再現testまたは静的な経路確認の実測から結論を導く。

表示profileで隠れた`suppressedFindings`も候補として確認し、差分reviewの第二passでは全対象内候補の検証結果を照合する。`verificationAssessments.findingIndex`は`firstPassFindings`の元の順序に対応させる。

進行役はローカルLLMの判定を最終判定へ直結せず、同じ固定HEADと仕様・test証拠を利用可能な別reviewerにも独立に渡す。**reviewer選定（DCAND-009）は`agent-skill-chain decision invoke --type=DCAND-009 --staging=<対象staging> --input=<file> --apply`で行う。** `--input.payload.candidateSet`には、Policy Allowed ∩ Configured/Dispatchable ∩ Independence Eligibleの交差からなる候補集合を渡し、`proposedValue`にはその中から選ぶ**provider ID**（`codex`または`claude`。大文字小文字は無視される）を渡す。モデル名（Codex SolやOpusなど）は`proposedValue`ではない。provider選定後にどのモデルを使うか（ローカルLLM設定が無ければcodexでCodex Sol相当、利用できない環境ではclaudeでOpus相当など）は別途の運用判断であり、`routing`入力契約のmodel設定欄で扱う。**`decision invoke`自身はPolicy Allowed（`role.ts`の`PROVIDER_AUTONOMOUS_CEILINGS`が定めるreviewer providerの集合、`codex`・`claude`）だけを実際に強制し、宣言された候補集合をこの集合と積集合してから判定する。** Configured/Dispatchable・Independence Eligibleの絞り込みはこの積集合に含まれず、進行役が候補を選ぶ時点で別途確認する必要がある（disclosed residual gap、Issue #1485）。積集合が空、または提案が積集合外の値は`rejected`で拒否される（`authorityMode=constrained-choice`）。ローカルLLM設定時は別の独立reviewerを少なくとも1人必ず使う。**CodeRabbitが利用枠の制限中かの判定（DCAND-008）は`agent-skill-chain decision invoke --type=DCAND-008 --staging=<対象staging> --input=<file> --apply`で行う。** `--input.payload`には`{latestHeadSha, observations}`（対象PR最新HEADに対するGitHub check・review・通知の観測一覧）を渡す。deterministic resolverが明示的なrate limit言及を最新HEAD上で確認できれば`confirmed-limited`としてauthoritativeに確定し、確認できなければ`unknown`としてadvisoryでprovider（進行役自身の判断）へ委譲する。`confirmed-limited`の場合はOpusとCodex Solの両方に固定HEADの独立レビューを委譲し、片方を利用できないときは未実施を成果物へ記録して人間へ再開条件の判断を求める。両decisionの`decisionRecordId`と判定文言・観測URL・時刻をroundのfinding evidenceへ記録する。複数reviewerのfindingは出典、成立条件、反証、再現結果を進行役が確認して採否を記録し、多数決やモデルの`decision`のみで承認・却下しない。追加reviewerが利用不能な場合は試した経路と理由を成果物へ記録し、独立性と未解決Critical/Highの条件を満たせないときは停止する。

## routing入力契約

role欄の担当roleが`reviewer`であること、必要能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄、肯定・敵対review、finding分類、対象差分を変更していない証拠を実装時のrouting evidenceと突合する。providerとmodel設定はproject choiceの入力契約として扱い、固有のmodel slugからreview authorityを推測しない。**reviewerの独立性はproject policyの`merge.reviewIndependence`が決める。** `context-isolated`（既定）はimplementerと別session/context、exact HEAD固定、対象差分を変更していないこと、肯定・敵対レビューとfinding記録を要求し、**同一GitHub actorでも成立する。** `actor-independent`はPR author・implementation commit authorと別のstable actor IDを要求し、高リスク変更・不可逆操作・releaseでpolicyが宣言して引き上げる。**要求水準を独立性証拠欄で確認できない場合は停止条件を適用し、承認しない。** **同一provider・同一論理tierだけを理由に独立性違反としない。**reviewerはfindingを隠す修正を行わない。

Codex起動差分では`routing launch`の観測時刻・入口・selectedModel/dispatchedModel・high/default・trusted selector採用tier・policy SHA・終了eventを確認する。dispatch引数の証拠をproviderが実効modelをattestした証拠へ読み替えない。古いresolve結果や固定slugが起動経路へ残った場合はfindingにする。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、成果物間の責務越境、上流の暗黙変更、対象版とシステム仕様書の不一致をfindingにする。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)と要求・要件の用語差分、耐久用語台帳を作業開始前に全文読む。未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止、成果物間の表記揺れをfindingにする。

**review証跡のテンプレートはない。** review証跡は`review export --staging=<staging> --issue=<Issue番号> --reviewer=<reviewer identity> --implementer=<implementer identity> --verified=<実行して合格したcommand>`（`--verified`は繰り返し指定）が、収束済みreview session・trusted policyの`merge.reviewIndependence`・current HEAD（`H_impl`）から`docs/reviews/<Issue番号>_review.json`へ生成する。**人もAIも手で書かない。** Gitが示す差分path・変更種別・配布物影響は書き直さない。sessionが収束していない、未解決Critical/Highが残る、reviewerとimplementerが同一、検証commandが無い場合は生成されない。生成後は`review validate --artifact=<path> --staging=<staging>`で保存済みsessionとGitに照合できる。H_final後は証跡を更新しない。検証記録を加える同一pathの前進修正とpath是正だけを`pr reanchor`が受理する。

各roundの入力JSONは`review round --init`が生成した骨子を充填し、[読取と書込の量](../../docs/01_開発ワークフロー.md#読取と書込の量)に従って是正はfindingの該当行だけを差分で書く。`review round --init`はsessionがあるとき前round blockerのfindingを雛形へ写すので、statusの更新と新規findingだけを書く。round JSONの全文をheredocで書き直さない。

**`pr create`より後に届いた外部reviewerの指摘は、条件を満たす場合に同じPRへ取り込む。** 守る性質は「独立reviewerが確認した内容とmergeされる内容が一致すること」であり、HEADが動いても同sessionの次roundで再reviewすれば保たれる。**条件と手順の正本は`../../docs/01_開発ワークフロー.md`である。ここへ複写しない。** 記録は`workflow record --step=10 --post-terminal-intake`で行い、Step 11より後に置く。**取り直し1ラウンドは収束後にだけ開く。** 未解決blockerを抱えたまま予算を使い切った`budget-exhausted`からは開かない。開くと任意の1 pushで新品の予算をもらえる。**予算を超える指摘、受け入れ条件を満たさない指摘、安全境界・authority・不可逆操作へ及ぶ指摘は取り込まず、follow-up Issueとする。** いずれの場合も元のPRのreviewスレッドへ判定を返信して解決する。**指摘を無記録で通過させない。**

**差分が実装言語以外の成果物を含む場合、その種別に対応する静的解析を当てる。** 実装言語にはprojectのlintと型検査が当たるが、shell script、Makefile、CI workflowのようなrepository運用の足回りは、どの工程でも解析されないまま既定branchへ到達しうる。**これらは検査する側の仕組みであり、壊れると他のすべての検査が黙って素通りする。** 字面の照合は実行可能性を見ないため、種別に対応する解析の代替にならない。当てられるツールが環境に無い場合は、その事実と理由をfindingのevidenceへ記録し、当てたものとして扱わない。

**Makefileは`make -n <target>`で展開した実コマンドへ当てる。** レシピ本文をそのまま解析器へ渡すと`$$`と`@`が未展開のままparseが途中で止まり、**本物の欠陥が報告されない。**「当てたが指摘は無かった」という誤結論の原因になる。**ただし`make -n`は安全な静的展開器ではない。** 読み込み時に評価される`$(shell ...)`は`-n`でも実行されるため、候補が制御するMakefileへそのまま実行すると任意のコマンド実行になる。**書き込み不可のfilesystem、network分離、資源制限を持つsandbox内で実行し、対象targetを差分が触れた範囲に限る。** **sandboxは認証情報も分離する。** 環境変数は許可listだけを渡し（`env -i`相当）、credential mountとagent socketを到達不能にする。取得した出力に認証情報が混入していないことを確認し、review記録とCI logへ残さない。 変数展開後の定数比較に対する指摘は、**その比較が設計上つねに定数になる場合にかぎり**誤検知である。未定義変数や変数名の誤記で意図せず定数化した場合は真の欠陥であり、比較ごとに判断する。

**承認済み計画は封印済みであり、Step 10でも編集しない。** 計画の変更は`05_計画変更.md`へ追記する。上流再確定（`--reconfirm`）は廃止した。staging digest不一致の診断が、変化した成果物とその状態で成立する次の行動を返す。

**成果物は版管理下へ置く。** `staging.tracked=false`のstagingは版管理外である。`staging.tracked=true`では文書00〜04を版管理するが、どちらの場合もstaging内の`04_レビュー.md`はformal approval artifactとして扱わない。収束後に`review export`で`docs/reviews/`配下へreview証跡を生成し、実装commitの後にその1 fileだけをcommitして`H_final`にする。**このartifact commitに対する取り直しroundは要らない。** `workflow record --step=10`は`H_final`で実行でき、bindingはsessionのcandidate HEAD（`H_impl`）のまま記録される。`pr create --head-sha=<H_final>`も同じ規則で受理する。

`staging.tracked=true`でround 1にprogress targetを明示した場合、sealed journalからbyte一致を検証できる投影targetとformal artifactを同じrecord layer commitへ置ける。対象path、mode、marker外byte、journal bindingのいずれかを検証できない場合はartifact-onlyへ暗黙縮退せず拒否する。

前述の外部reviewer指摘をStep 11前の`pr-bound`中に取り込む場合は、正本に従って`workflow record --step=10 --post-pr-intake`を使う。`--post-terminal-intake`はStep 11記録後の経路に限る。

差分が触れた範囲の追跡先を確認するときは[Semantic Graphの利用](../../docs/01_開発ワークフロー.md#semantic-graphの利用)を読み、追跡の問いと言及の問いでedge種別を選び分ける。

project choicesと対象成果物のDC行を読む。**DC判定が`applicable`の領域と、対象差分が実際に触れた領域だけ**、作業開始前に対応するtemplateの全文を読む。[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)はDC-PRIVACYが`applicable`のとき、[利用性・互換性・保守性](../../templates/specs/11_非機能/02_利用性・互換性・保守性.md)と[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)はDC-OBSERVABILITYが`applicable`のとき、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)と[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)は差分がsourceまたはtestを含むときに読む。**`not-applicable`と判定した領域のtemplateの全文を読む固定費を課さない。** 判定自体の妥当性は対象成果物のDC欄でreviewする。UIまたはtoken capabilityが`not-applicable`でない場合は[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)も全文読み、判定・理由・実測証拠の欠落をfindingにする。
