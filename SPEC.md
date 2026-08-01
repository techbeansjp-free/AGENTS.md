# SPEC: human gateの停止状態と復帰入口を同じtrusted sessionへ結線する

- Issue: `ISSUE-278` / 作成者: `human_rerun_entry` / 対象ブランチ: `bugfix/278-human-adapter-rerun-entry`

## 目的・背景

GitHubモードのhuman gateは、非同期判定中もrequired Checkでmergeを停止し、停止を作ったPR head・gate・review
profile・Check Runへ人間判定を一回限りで結線する。本Issueは入力をGitHubへ耐久化し、default branchのtrusted処理だけにCheck更新を許してstale、replay、PR codeへのwrite token露出を防ぐ。あわせて、停止時に人間へ提示する復帰手順が実在しない再評価入口を案内して復帰不能にならないよう、案内文言・実在入口・対象SHAを同じsessionへ結線する。

## 前提・用語・入出力

- 対象は`backend=github`、openかつsame-repositoryのPR、`review.adapter=human`。local正本は変更しない。
- Strict集約関数`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）は、I/O・時刻・replay状態を持たない
  純粋関数として現在のmainに実在する。本Issueはこれを再実装せず再利用する（由来: Issue #283 / PR #284）。
- もう一方の前提であるtrust backend（Checks専用App、main限定environment、required contextへの
  `integration_id`固定）はADR-0013が規定するが、ADR-0013は現在`status: proposed`であり実配備もされていない。
  本Issueはこれをacceptedにせず、accepted化と実配備はIssue #283系列の責務として本Issueの対象外に置く。
- したがって本Issueの実装は、trust backendが未accepted・未配備・設定不整合の環境ではhuman gate sessionを
  一切開始せず設定エラーで停止する（fail-closed）ものとして定義する。全ACの証跡はGitHub API stub・fixture・
  workflow定義検査による自動テストで得るため、trust backendの実配備を待たずに検証できる。実環境での機能
  有効化はADR-0013がacceptedかつ配備済みになった後に別途行い、それまで本機能はfail-closedのまま無効である。
- 本SPECで「レビュア独立性」とは、同一review attempt内で各証跡の`run_id`が重複しないこと、`slot`値が重複せず
  必要集合（Strictでは1と2）を満たすこと、全証跡の`launcher_token_digest`が一致し同一のprotected-base隔離
  launcher実行に由来することの3点だけを指す。GitHub actorが別人格であることはこの独立性に含まない。
- `human gate session`はPRを集約ルートとし、required parent Check、slot Check、PR Review inboxで構成する。
- parent一意keyはrepository ID、PR、target SHA、gate、required名、publisher App IDである。
- PR Review inboxはsession/slot/invocation、判定、actor、review ID、submission digestを持つ耐久入力である。
- slot envelopeはsession、base/target、gate/profile、slot/invocation、actor、review/workflow run/Check ID、
  verdict、artifact集合digest、ownership nonce、処理状態を持つ。
- 初回入力はtrusted PR event、判定入力はPR Review IDとsession識別子である。artifactは人間入力にしない。
- 出力は同じparent Check IDの`success|failure|action_required`、人間向けの復帰手順、全provenanceを持つGitHub証跡である。

## 要求・要件

- Checks専用App、main限定environment、required contextの`integration_id`固定を必須前提とする。通常
  `GITHUB_TOKEN`は`checks: none`で、専用App tokenはprotected publisher stepだけが取得する。前提のいずれかが
  欠けるか設定とrulesetが一致しない場合はsessionを開始せず設定エラーで停止し、既存判定をsuccessへ倒さない。
- opener、submit、reconcile、既存gate publisherを同じpublisherへ置換し、parentのcreate/PATCH/sourceを
  同一Appへ限定する。candidate処理はcustom Checkを書かず、PR Reviewからpublisherへhandoffする。
- trusted openerはAPIでbase/targetを固定し、変更pathから`spec→design→implementation→validation`順に
  gate集合を導出する。gateごとに決定的session keyを使い、同一keyの再実行は既存sessionを返す。
- 同じSHA/name/Appのparentは一件だけを許す。複数、別source、設定とrulesetの不一致は選択せず停止する。
- human gateの停止時に人間へ提示する復帰手順は、その時点で実在する再評価入口だけを案内する。案内には対象PR、
  対象SHA、required check名、使用する入口、必要な権限境界を含め、案内文言とworkflow定義の乖離を自動テストで
  検出する。入口を新設するか既存の実在操作へ案内を寄せるかの選択は設計で決める。
- PR Review inboxを先に耐久化し、surviving runと定期sweeperが未処理入力を再走査する。Actions queueは
  correctnessの正本にしない。
- Checks PATCHをCASとは呼ばない。専用Appだけが同一保護environment・PR/gate直列化経路から書き、
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
  `read_only`）、承認成果物のpath集合とdigestが期待値と完全一致する。(4) 前記のレビュア独立性を満たす。
  (5) blocking findingまたは`fail`があればrejected、全て`pass`かつ`inconclusive`が偽ならapproved、
  それ以外はhuman_requiredとする。
- 同関数はactorを許可集合への所属としてのみ検査し、2件のactorが別人格であることを承認条件にしない。
  `actor_relation`（`same_as_writer`/`distinct_from_writer`）は証跡として記録するだけで判定に用いない。
  本Issueもこの契約に合わせ、actorの人格差をapprovedの条件として要求しない。
- 不正入力、`pending`、不足、API/queue/sweeper失敗は親を`action_required`のまま保ち、mergeを許さない。

## 受入条件

### AC-1: trusted sourceと一意session

- Given: human gate対象PRのbase/targetが確定している
- When: openerを再実行する
- Then: 固定順の各gateに同SHA/name/Appのparentが一件だけ作成または再利用される（検証: `automated`）

### AC-2: 専用App以外はCheckを書けない

- Given: candidate、publisher、rulesetが配備されている
- When: 初回・提出・reconcileを実行する
- Then: candidateの`GITHUB_TOKEN`はChecksを書かず、main限定publisher Appだけが全Checkを更新する（検証: `automated`）

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

- Given: 同一attemptのStrict sessionへ2件のslot envelopeがある
- When: `run_id`と`slot`が重複せず必要slot集合を満たし`launcher_token_digest`が一致する2 approve、および
  重複、replay、不足、混合判定を集約する
- Then: 既存の`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）だけが最終判定し、レビュア独立性・
  binding・成果物集合を全て満たす2 approveだけがsuccess、他はfailureまたはaction_requiredとなる。actorは
  許可集合への所属だけを検査し、2件のactorの人格差を承認条件に用いない（検証: `automated`）

### AC-7: status/conclusionとbackend境界

- Given: queued、processing、awaiting、approved、rejected、invalidの各状態がある
- When: Checkへ写像する、またはlocal backendからcommandを呼ぶ
- Then: 規定写像以外を発行せず、localではGitHub APIと成果物を変更しない（検証: `automated`）

### AC-8: 配布・監査契約

- Given: workflow、CLI、adapter、template、rulesetが存在する
- When: session、replay、recoveryを実行する
- Then: 展開元/先が一致し、actor/run/review/session/check/slot/nonceを秘密値なしで追跡できる（検証: `automated`）

### AC-9: 停止からの復帰入口が実在する

- Given: human adapterを選んだgateがrequired Checkを`action_required`にして停止し、人間へ復帰手順が提示される
- When: 人間が提示された手順どおりに対象SHAの再評価を実行する
- Then: 案内される操作は対象workflowが実際に受理する入口だけを指し、対象PR・対象SHA・required check名・
  必要な権限境界が案内内で一意に定まり、案内文言とworkflow定義の乖離を検出する自動テストが存在して
  失敗しない（検証: `automated`）

### AC-10: trust backend未成立時のfail-closed

- Given: 専用App、main限定environment、ruleset `integration_id`固定のいずれかが未配備または不整合である
- When: openerまたはpublisherを実行する
- Then: sessionを開始せずCheckをcreate/PATCHせず設定エラーで停止し、既存gate結果をsuccessへ倒さない（検証: `automated`）

## 制約・完了条件・対象外

公式に存在する`concurrency.queue: max`は100件上限の補助にだけ使い、耐久性を委ねない。4ゲート名、
人間の判定内容生成、credential作成、`verifyGithubReviewEvidence`自体の判定ロジック、local backendは
変更しない。ADR-0013のaccepted化と専用App・environment・rulesetの実配備はIssue #283系列の責務であり
本Issueの対象外で、本Issueはそれらが未成立の場合のfail-closed動作までを実装・検証の範囲とする。
全ACの正常・反例・取消回復・配布同期・回帰証跡を`VALIDATION.md`へ保存して完了する。未決事項はない。
