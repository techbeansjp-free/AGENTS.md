# SPEC: human gateの停止状態と復帰入口を同じtrusted sessionへ結線する

- Issue: `ISSUE-278` / 作成者: `human_rerun_entry` / 対象ブランチ: `bugfix/278-human-adapter-rerun-entry`

## 目的・背景

GitHubモードのhuman gateは、非同期判定中もrequired Checkでmergeを停止し、停止を作ったPR head・gate・review
profile・Check Runへ人間判定を一回限りで結線する。本Issueは入力をGitHubへ耐久化し、trust backendが揃った
環境ではdefault branchのtrusted処理だけにCheck更新を許してstale、replay、PR codeへのwrite token露出を防ぐ。
あわせて、停止時に人間へ提示する復帰手順が実在しない再評価入口を案内して復帰不能にならないよう、案内文言・
実在入口・対象SHAを結線し、案内どおりの起動が当該SHAに対して実際に再評価を走らせ、走ったことを機械的に
証明できる新しい証跡を残すところまでを要求する。本Issueは「起動すれば承認される」ことも「起動すれば必ず
結論が確定する」ことも要求しない。要求するのは「案内どおりに操作すれば実在する処理が本当に動き、放置も
無視もされない」ことである。

## 前提・用語・入出力

- 対象は`backend=github`、openかつsame-repositoryのPR、`review.adapter=human`。local正本は変更しない。
- 本SPECで「コア分類」とは、当該gateの集約入力`coreReviewRequired`が真になる状態を指す。真になる条件は
  (a) base...targetの変更pathが登録済みproject policyのcore trigger（exact path: `AGENTS.md`・`package.json`・
  `package-lock.json`／prefix: `.agent-skill-chain/`配下のproject・config・schemas・adapters・scripts・ci・
  templates/github、`.github/`、`src/commands/`、`src/lib/`）のいずれかに該当する、(b) 明示監査区分
  `review:core-audit`が付与される、(c) base...targetの差分自体を解決できない（非コアへ推測せず安全側で真とする）、
  の三つである。本Issue自身の変更面（`.agent-skill-chain/adapters/`・`src/lib/`・`.github/`）は(a)に該当するため、
  本Issue自身のPRは常にコア分類である。
- コア分類のgateでは、Strict profileが強制され、各証跡は`model_tier=frontier_coding`かつ
  `reasoning_tier=maximum_reasoning`の能力証明を要し、`adapter=human`の証跡はこの能力を証明できないものとして
  常に不合格となり`human_required`へ倒れる。これはproject policyが`core_review.adapters.human.behavior:
  human_required`として明示する既定であり、本Issueはこれを変更しない。したがって本Issueが約束するhuman gateの
  承認到達（`success`）は非コア分類のgateに限る。コア分類のgateでは、human gateが承認へ到達せず停止し続け
  人間判断を要求し続けることが正常な仕様であり、欠陥ではない。
- 本SPECはhuman gateの停止状態を二つに区別し、以降のACはどちらを対象とするかを明示する。
  (1) `human gate deferral状態`＝human adapterが判定を人間へ委ね、gate-reportを`final=human_required`にし、
  通知（GitHubモードはIssueコメントと`gate:<gate>:awaiting-human`ラベル、ローカルモードはmarkerファイル）を
  発行してdeferred（終了コード3）を返した結果、当該gateのrequired Checkが対象SHAで`action_required`のまま
  mergeを止めている状態。この状態は専用App・environment・rulesetの成否と無関係に現行実装だけで成立する。
  (2) `human gate session`＝本Issueが新設するtrusted sessionで、trust backend状態が`consistent`であることを
  必須前提とする。AC-9は(1)からの復帰入口だけを対象とし、AC-10は(2)の開始可否だけを対象とする。
- 本SPECで`trust backend状態`とは、(i) Checks専用Appの配備、(ii) main限定environmentの配備、
  (iii) required contextへの`integration_id`固定、の三条件の充足状況を指し、次の3値に分類する。
  `absent`＝三条件のいずれも充足しない。`consistent`＝三条件すべてを充足し、かつruleset固定値と配備済み
  App IDが一致する。`inconsistent`＝一部だけを充足する、または三条件を充足するが固定値とApp IDが一致しない。
  この分類は設定値とGitHub API応答だけから決定的に導ける。
- 上記に対応して、required Checkを書く主体を`有効publisher`と呼び、状態ごとに一つだけ存在させる。
  `absent`（フェーズA・既存publisher期）では既存gate publisherが有効publisherであり、本Issueが新設する
  trusted sessionは開始せず、trust主張を一切行わない。`consistent`（フェーズB・専用App期）では専用App
  publisherが唯一の有効publisherとなり、既存publisherのChecks書込みは無効化される。`inconsistent`では
  sessionを開始せず設定エラーで停止する（fail-closed）。
- フェーズAで既存publisherを残すことが安全側である理由を明示する。本Issueが新設するtrust主張（専用Appだけが
  writerであること、replay耐性、source一意性）はフェーズAでは一切主張されず、承認基準は本Issue以前と同一で
  あって緩められない。逆にフェーズAで既存publisherを止めると、required Checkを発行する主体自体が消え、
  `action_required`によるmerge停止も`human gate deferral状態`も成立しなくなり、安全性はむしろ下がる。よって
  本SPECにおけるfail-closedとは「前提が揃わない環境で新しいtrust主張を有効化しない」ことを意味し、「既存の
  停止力を取り除く」ことを意味しない。
- 本SPECで`再評価証跡`とは、gate再評価が実際に走ったことを起動単位で示す耐久recordであり、
  `rerun_invocation_id`（起動ごとに一意）、`pr_number`、`evaluated_target_sha`、`evaluated_at`、
  `evaluation_input_digest`、`evaluation_outcome`（`approved`／`rejected`／`human_required`／`config_error`／
  `sha_mismatch`）、`publisher_phase`（`legacy`／`dedicated_app`）を持つ。有効publisherはrequired Checkを
  書くたびにこのrecordを当該CheckのoutputへJSONとして上書き保存する。起動前のCheckにrecordが存在しない場合は
  「起動前値なし」として扱い、起動後にrecordが存在すれば区別が成立したものとする。
- Strict集約関数`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）は、I/O・時刻・replay状態を持たない
  純粋関数として現在のmainに実在する。本Issueはこれを再実装せず再利用する（由来: Issue #283 / PR #284）。
- trust backendの内容（Checks専用App、main限定environment、required contextへの`integration_id`固定）は
  ADR-0013が規定するが、ADR-0013は現在`status: proposed`であり実配備もされていない。本Issueはこれを
  acceptedにせず、accepted化と実配備はIssue #283系列の責務として本Issueの対象外に置く。したがって現時点の
  本リポジトリはフェーズA（`absent`）で稼働しており、本Issueの実装はフェーズAでもフェーズBでも成立する
  ことを要件とする。全ACの証跡はGitHub API stub・fixture・workflow定義検査による自動テストで得るため、
  実配備を待たずに検証できる。
- 本SPECで「レビュア独立性」とは、同一review attempt内で各証跡の`run_id`が重複しないこと、`slot`値が重複せず
  必要集合（Strictでは1と2）を満たすこと、全証跡の`launcher_token_digest`が一致し同一のprotected-base隔離
  launcher実行に由来することの3点だけを指す。GitHub actorが別人格であることはこの独立性に含まない。
- `human gate session`はPRを集約ルートとし、required parent Check、slot Check、PR Review inboxで構成する。
- parent一意keyはrepository ID、PR、target SHA、gate、required名、publisher App IDである。
- PR Review inboxはsession/slot/invocation、判定、actor、review ID、submission digestを持つ耐久入力である。
- slot envelopeはsession、base/target、gate/profile、slot/invocation、actor、review/workflow run/Check ID、
  verdict、artifact集合digest、ownership nonce、処理状態を持つ。
- 初回入力はtrusted PR event、判定入力はPR Review IDとsession識別子である。artifactは人間入力にしない。
- 出力は同じparent Check IDの`success|failure|action_required`、その各更新に付随する再評価証跡、人間向けの
  復帰手順、全provenanceを持つGitHub証跡である。

## 要求・要件

- trust backend状態を`absent`／`consistent`／`inconsistent`へ決定的に分類し、状態ごとに有効publisherを
  ちょうど一つに定める。`inconsistent`ではsessionを開始せず設定エラーで停止し、既存判定をsuccessへ倒さない。
  通常`GITHUB_TOKEN`は、フェーズBでは`checks: none`とし、専用App tokenはprotected publisher stepだけが取得する。
- 既存gate publisherの専用Appへの置換は、trust backend状態が`consistent`である場合にのみ有効化される条件付き
  要求として定義する。フェーズAでは置換を行わず、opener・submit・reconcile・既存gate publisherは現行の
  `GITHUB_TOKEN`経路のまま従来と同一の判定基準で動作し、Check outputへ`publisher_phase: legacy`と
  「trust主張なし」を明記してフェーズBの証跡と取り違えられないようにする。フェーズBでは、opener・submit・
  reconcile・既存gate publisherを同じ専用Appへ置換し、parentのcreate/PATCH/sourceを同一Appへ限定する。
  いずれの状態でも同名required Checkに有効なwriterが同時に二つ存在してはならない。
- フェーズA→フェーズBの移行は、人間による配備行為（App・environment・ruleset固定の3点を揃えること）だけが
  起こす。実装が自動で昇格させてはならない。フェーズBから`inconsistent`へ落ちた場合はフェーズAへ自動
  fallbackせず、設定エラーで停止する。trust主張の自動降格でmergeを通すことを禁じるためである。
- candidate処理はcustom Checkを書かず、PR Reviewからpublisherへhandoffする。
- trusted openerはAPIでbase/targetを固定し、変更pathから`spec→design→implementation→validation`順に
  gate集合を導出する。gateごとに決定的session keyを使い、同一keyの再実行は既存sessionを返す。
- 同じSHA/name/Appのparentは一件だけを許す。複数、別source、設定とrulesetの不一致は選択せず停止する。
- `human gate deferral状態`で人間へ提示する復帰手順は、その時点で実在する再評価入口だけを案内する。案内には
  対象PR、対象SHA、required check名、使用する入口、必要な権限境界を含め、案内文言とworkflow定義の乖離を
  自動テストで検出する。入口を新設するか既存の実在操作へ案内を寄せるかの選択は設計で決める。
- 案内する入口は、対象PR番号と対象SHAを入力として受理し、起動によって当該SHAのgate再評価を実際に走らせ、
  有効publisherを通じて新しい再評価証跡を残す契約を持つ。対象SHAへbindできない入口（起動時点のPR headが
  案内の対象SHAと一致しない、PR番号を入力に取れない、別SHAを暗黙に評価する等）は案内対象にしない。
  bindできない場合は再評価を行わず`evaluation_outcome=sha_mismatch`として不一致を明示して停止する。
- 復帰入口の起動に対する要求は「再評価が実際に走ったこと」までであり、到達する結論の種別は要求しない。
  再評価の結果として`action_required`が維持される場合も要求を満たす。逆に、起動しても新しい再評価証跡が
  生成されない（workflow runが作られない、`rerun_invocation_id`・`evaluated_at`が変わらない）ことは
  要求違反とする。いかなる場合も、再評価を経ずに`action_required`を`success`へ倒してはならない。
- PR Review inboxを先に耐久化し、surviving runと定期sweeperが未処理入力を再走査する。Actions queueは
  correctnessの正本にしない。
- Checks PATCHをCASとは呼ばない。フェーズBでは専用Appだけが同一保護environment・PR/gate直列化経路から書き、
  nonce所有、API再読取、冪等retry、terminal postcondition検証で非atomic更新を収束させる。
- Actions runがpendingまたはprocessing中に取消されても、後続runは前runのterminal状態を確認してnonceを
  引き継ぐ。同じdigestのterminal結果はno-op、異なるdigestまたは相反結論は上書きせず新sessionを要求する。
- gate別artifactはsegmentの抽象outputを具体pathへ分類し、base/targetのA/M/D全件をcanonical recordにする。
  deletionはbase digestを含むtombstoneとし、path順の集合digestを保存する。
- submit時はbase/head/profile/App/sessionとartifact recordを再導出し、保存集合と導出集合を双方向比較する。
  欠落、余分、重複、digest差、不明path、取得不能をsuccessにしない。
- Strictは既存の`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）へGitHub slot envelopeを写像して
  渡し、最終判定を同関数だけに委ねる。replay選択、nonce、Check読書きは同関数の外に置く。
- 同関数が担保する契約は次のとおりで、本Issueはこれを変更しない。(1) 最新`attempt_id`の証跡だけを選び、
  profile対応の`expected_count`（Strictは2、Standardは1）と件数が一致することを要求する。(2) 各証跡のactorが
  trusted recorderの許可集合に属し、reviewがdismiss済みでなく、API上のcommit SHAがtarget SHAと一致する。
  (3) prompt digest、protected-base実行attestation（trusted base SHA、launcher digest、`ephemeral_clone`、
  `read_only`）、レビュアの`capability.read_only`、承認成果物のpath集合とdigestが期待値と完全一致する。
  (4) 前記のレビュア独立性を満たす。(5) PR/commitのwriter actorを完全に解決できること（未解決actorが存在する、
  または解決済みwriter actorが0件のときは判定へ進まず`human_required`とする）。(6) コア分類のとき、profileが
  Strictであること、各証跡が`model_tier=frontier_coding`かつ`reasoning_tier=maximum_reasoning`を証明すること、
  `adapter=codex`の証跡がpolicy指定のmodel/reasoningと一致すること、`adapter=human`の証跡は能力証明不能として
  必ず不合格になることを要求する。(7) 前記を全て満たしたうえで、blocking findingまたは`fail`があればrejected、
  全て`pass`かつ`inconclusive`が偽ならapproved、それ以外はhuman_requiredとする。
- 上記(5)(6)により、コア分類のgateでは`adapter=human`の証跡だけを集めても最終判定は必ず`human_required`となる。
  本Issueはこの帰結を仕様として受け入れ、写像側で能力値を偽装・補完・迂回して承認へ倒すことを禁止する。
- 同関数はactorを許可集合への所属としてのみ検査し、2件のactorが別人格であることを承認条件にしない。
  `actor_relation`（`same_as_writer`/`distinct_from_writer`）は証跡として記録するだけで判定に用いない。
  本Issueもこの契約に合わせ、actorの人格差をapprovedの条件として要求しない。
- 不正入力、`pending`、不足、API/queue/sweeper失敗は親を`action_required`のまま保ち、mergeを許さない。

## 受入条件

### AC-1: trusted sourceと一意session

- Given: human gate対象PRのbase/targetが確定している
- When: openerを再実行する
- Then: 固定順の各gateに同SHA/name/Appのparentが一件だけ作成または再利用される（検証: `automated`）

### AC-2: 有効publisherは常に一つで、フェーズごとに書込み境界が決まる

- Given: trust backend状態が`absent`・`consistent`・`inconsistent`のいずれかである
- When: 初回・提出・reconcile・復帰入口の起動を実行する
- Then: `consistent`ではcandidateの`GITHUB_TOKEN`はChecksを書かず、main限定publisher Appだけが全required
  Checkを更新する。`absent`では専用App経路を有効化せず、既存publisherだけが従来と同一の判定基準で
  required Checkを更新し、Check outputへ`publisher_phase: legacy`とtrust主張なしを明記する。`inconsistent`では
  AC-10の設定エラー停止に至る。いずれの状態でも同名required Checkに有効なwriterが同時に二つ存在しない
  （検証: `automated`）

### AC-3: non-atomic更新を安全に再開する

- Given: parentまたはslotのPATCH応答不明、run取消、並行提出がある
- When: publisherまたはsweeperが再試行する
- Then: nonce所有と再読取で同一結果へ収束し、相反terminalを上書きしない（検証: `automated`）

### AC-4: durable inboxでqueue損失を回復する

- Given: PR Reviewへ有効判定を記録後、dispatch/pending runが取消される
- When: 後続triggerまたはsweeperが未処理inboxを走査する
- Then: 判定を失わず一度だけslotへ記録する（検証: `automated`）

### AC-5: artifact full-setを厳密照合する

- Given: 各gateにA/M/D artifactがある
- When: openとsubmitが集合を導出する
- Then: tombstoneを含む同一canonical集合だけを受理し、片方向一致では承認しない（検証: `automated`）

### AC-6: Strict集約境界

- Given（成功系・非コア分類）: 当該gateが非コア分類であり、writer actorが完全に解決でき、同一attemptの
  Strict sessionへ2件のslot envelopeがある
- When: `run_id`と`slot`が重複せず必要slot集合を満たし`launcher_token_digest`が一致する2 approve、および
  重複、replay、不足、混合判定を集約する
- Then: 既存の`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）だけが最終判定し、レビュア独立性・
  binding・成果物集合を全て満たす2 approveだけがsuccess、他はfailureまたはaction_requiredとなる。actorは
  許可集合への所属だけを検査し、2件のactorの人格差を承認条件に用いない（検証: `automated`）
- Given（停止系・コア分類またはwriter actor未解決）: 当該gateがコア分類である、あるいはwriter actorを完全に
  解決できない状態で、独立性・binding・成果物集合を全て満たす`adapter=human`の2 approveがある
- When: 同じ集約を実行する
- Then: コア分類では当該証跡がコア必須能力を証明できないものとして承認されず、writer actor未解決では判定へ
  進まず、いずれもsuccessへ倒れずparentは`action_required`のまま`human_required`を保つ。写像側は能力値・
  actor集合を補完も迂回もせず、この停止を正常な終局として記録する。この停止は再評価が走った結果として
  導かれた判定であり、`evaluation_outcome=human_required`の再評価証跡を伴う（検証: `automated`）

### AC-7: status/conclusionとbackend境界

- Given: queued、processing、awaiting、approved、rejected、invalidの各状態がある
- When: Checkへ写像する、またはlocal backendからcommandを呼ぶ
- Then: 規定写像以外を発行せず、localではGitHub APIと成果物を変更しない（検証: `automated`）

### AC-8: 配布・監査契約

- Given: workflow、CLI、adapter、template、rulesetが存在する
- When: session、replay、recoveryを実行する
- Then: 展開元/先が一致し、actor/run/review/session/check/slot/nonceを秘密値なしで追跡できる（検証: `automated`）

### AC-9: 復帰入口が実在し、起動が実際に再評価を走らせる

- Given: human adapterを選んだgateが`human gate deferral状態`にある（gate-reportが`final=human_required`、
  通知が発行済み、当該gateのrequired Checkが対象SHAで`action_required`）。当該Checkのoutputには起動前の
  再評価証跡（`rerun_invocation_id=R0`、`evaluated_at=T0`。存在しない場合は「起動前値なし」）が記録されている。
  本ACの対象はこのdeferral状態からの復帰起動だけであり、trust backend状態ごとの経路可否はAC-2・AC-10が定める
- When: 人間が案内された入口を、案内に含まれる対象PR番号と対象SHAを入力として実際に起動する
- Then: (a) 案内される操作は対象workflow定義に実在する入口だけを指し、対象PR・対象SHA・required check名・
  必要な権限境界が案内内で一意に定まる。(b) 当該入口は対象PR番号と対象SHAを入力として受理し、起動時点の
  PR headが案内の対象SHAと一致しない場合は再評価を行わず、`evaluation_outcome=sha_mismatch`として不一致理由を
  明示して停止する。(c) headが一致する場合、起動によって当該対象SHAのgate再評価が実際に走る。すなわち
  (c-1) 当該PR番号・対象SHA・gateへ束縛された新しいworkflow runが作成されて完了し、(c-2) 有効publisherが
  当該required Checkのoutputへ、起動前と異なる`rerun_invocation_id`（R1≠R0）・`evaluated_at`（T1>T0）・
  その時点の`evaluation_input_digest`・`evaluation_outcome`を持つ再評価証跡を上書き保存する。(d) 本ACは
  再評価後のCheck結論の種別を要求しない。`success`・`failure`・`action_required`のいずれでもよい。
  `action_required`のまま留まる場合、それは「再評価を実行した結果、現時点では承認条件を満たさないと判定
  された」ことを意味し、(c-2)の新しい証跡によって起動前の放置された（stale）`action_required`と機械的に
  区別できる。(e) 起動が再評価証跡を何も更新しない（新しいworkflow runが作成されない、`rerun_invocation_id`と
  `evaluated_at`が起動前と同一のまま）ことは本ACの不合格とする。(f) いかなる場合も、再評価を経ずに
  `action_required`を`success`へ倒さない。(g) 案内文言とworkflow定義の乖離、(b)の不一致停止、(c)の証跡更新、
  (e)の不合格条件をGitHub API stubで観測する自動テストが存在して失敗しない（検証: `automated`）

### AC-10: trust backend不整合時のfail-closedと停止力の維持

- Given: trust backend状態が`inconsistent`である（専用App・main限定environment・ruleset `integration_id`固定の
  一部だけが配備されている、または三点を充足するが固定値と配備済みApp IDが一致しない）。本ACの対象は
  `human gate session`の開始可否と専用App publisher経路だけであり、AC-9が対象とする`human gate deferral状態`は
  この状態でも成立し続ける
- When: opener、publisher、または復帰入口の起動を実行する
- Then: (a) sessionを開始せず専用App経路でCheckをcreate/PATCHせず、設定エラー理由を明示して停止する。
  (b) この停止は「何も起きなかった」ではなく、`evaluation_outcome=config_error`と新しい`rerun_invocation_id`・
  `evaluated_at`を持つ再評価証跡として記録され、AC-9の(c-2)を満たす。(c) 既存publisherが発行済みの
  required Checkは無効化されず、対象SHAで`action_required`のままmergeを止め続ける。(d) `absent`から
  `consistent`への移行は人間の配備行為だけが起こし、`consistent`から`absent`への自動fallbackは実装しない。
  いかなる場合も既存gate結果をsuccessへ倒さない（検証: `automated`）

## AC-6とAC-9の両立

AC-6とAC-9は要求する対象が異なり、直交する。AC-9が要求するのは「起動によって再評価が実際に走り、走った
ことを示す新しい証跡が残ること」だけであり、到達する結論の種別を一切要求しない。AC-6が要求するのは
「集約が到達すべき結論の種別」だけであり、再評価が何回走るか・いつ走るかを要求しない。したがって
「コア分類×`adapter=human`では承認へ倒れず停止し続ける」というAC-6の停止系Thenと、AC-9の後件は同一
シナリオで同時に成立する。

本Issue自身のPR（`bugfix/278-human-adapter-rerun-entry`）はコア分類であり、`review.adapter=human`である。
この組み合わせでAC-9を満たす状態を具体例として書き下す。

- 起動前: spec-gateのrequired Checkが対象SHA `S` に対し`action_required`であり、outputの再評価証跡は
  `rerun_invocation_id=R0`・`evaluated_at=T0`・`evaluation_outcome=human_required`である。human adapterの
  通知が発行済みで、`gate:spec:awaiting-human`ラベルが付いている。
- 起動: 人間が案内された入口を、案内に記載された対象PR番号 `P` と対象SHA `S` を入力として起動する。
- 起動時の照合: 入口は`P`のcurrent headをAPIで取得し`S`と一致することを確認する。一致しなければ
  `evaluation_outcome=sha_mismatch`で停止する（AC-9の(b)）。
- 再評価の実行: 一致したので、対象SHA `S` の証跡集合を再導出し`verifyGithubReviewEvidence`へ写像して集約する。
  当該gateはコア分類であり証跡は`adapter=human`であるため、同関数は能力証明不能として`human_required`を返す。
- 起動後: 有効publisherが同じrequired Checkを更新し、outputの再評価証跡は`rerun_invocation_id=R1`（≠`R0`）・
  `evaluated_at=T1`（>`T0`）・`evaluation_outcome=human_required`になる。Checkの結論は`action_required`の
  ままである。
- 判定: AC-9は満たされる。新しいworkflow runが作られ、`R1`・`T1`という起動前と異なる証跡が残り、
  「案内どおりに操作したのに何も起きなかった」状態と機械的に区別できるからである。AC-6の停止系Thenも同時に
  満たされる。`success`へ倒れず`human_required`を保っているからである。両者は矛盾しない。

矛盾を生んでいたのは「起動すれば必ずterminal（`success`または`failure`）へ遷移する」という強すぎる後件であり、
本SPECはそれを採らない。コア分類×`adapter=human`のgateは、何度再評価しても`human_required`へ収束することが
正常であり、その収束を繰り返し再計算できること自体がIssue #278の求めた復帰可能性である。承認到達には
コア必須能力を証明するAI adapterの証跡が別途必要であり、それは本Issueの対象外である。

## 制約・完了条件・対象外

公式に存在する`concurrency.queue: max`は100件上限の補助にだけ使い、耐久性を委ねない。4ゲート名、
人間の判定内容生成、credential作成、`verifyGithubReviewEvidence`自体の判定ロジック、local backendは
変更しない。コア分類のgateを`adapter=human`の証跡だけで承認へ到達させることは対象外であり、その承認には
コア必須能力を証明するAI adapterの証跡を要する（本Issueはコア分類時のhuman gateについて、停止の維持と
復帰入口の実在・対象SHAへの結線・再評価証跡の生成までを責務とする）。ADR-0013のaccepted化と専用App・
environment・rulesetの実配備はIssue #283系列の責務であり本Issueの対象外で、本IssueはフェーズA（`absent`）
での動作、`inconsistent`でのfail-closed停止、フェーズB（`consistent`）での置換有効化までを実装・検証の
範囲とする。フェーズBの実環境smokeは配備後に別途行う。
全ACの正常・反例・取消回復・配布同期・回帰証跡を`VALIDATION.md`へ保存して完了する。未決事項はない。
