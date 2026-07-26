# SPEC: human gateの停止状態と復帰入口を同じtrusted sessionへ結線する

- Issue: `ISSUE-278` / 作成者: `human_rerun_entry` / 対象ブランチ: `bugfix/278-human-adapter-rerun-entry`

## 目的・背景

GitHubモードのhuman gateは、非同期判定中もrequired Checkでmergeを停止し、停止を作ったPR head・gate・review
profile・Check Runへ人間判定を一回限りで結線する。本Issueは入力をGitHubへ耐久化し、default branchのtrusted処理だけにCheck更新を許してstale、replay、PR codeへのwrite token露出を防ぐ。

## 前提・用語・入出力

- 対象は`backend=github`、openかつsame-repositoryのPR、`review.adapter=human`。local正本は変更しない。
- 前提依存は、Issue #283 / PR #284が実装したStrict独立2レビュア集約（`src/lib/review-evidence.ts`の
  `verifyGithubReviewEvidence`、I/Oなし純粋関数として現在のmainに実在する）と、同PRが導入したaccepted
  ADR-0013の専用App trust backendである。未導入・未構成ならsessionを開始せず設定エラーにする。
- `human gate session`はPRを集約ルートとし、required parent Check、slot Check、PR Review inboxで構成する。
- parent一意keyはrepository ID、PR、target SHA、gate、required名、publisher App IDである。
- PR Review inboxはsession/slot/invocation、判定、actor、review ID、submission digestを持つ耐久入力である。
- slot envelopeはsession、base/target、gate/profile、slot/invocation、actor、review/workflow run/Check ID、
  verdict、artifact集合digest、ownership nonce、処理状態を持つ。
- 初回入力はtrusted PR event、判定入力はPR Review IDとsession識別子である。artifactは人間入力にしない。
- 出力は同じparent Check IDの`success|failure|action_required`と、全provenanceを持つGitHub証跡である。

## 要求・要件

- #283が配備するChecks専用App、main限定environment、required contextの`integration_id`固定を必須とする。
  通常`GITHUB_TOKEN`は`checks: none`で、専用App tokenはprotected publisher stepだけが取得する。
- opener、submit、reconcile、既存gate publisherを同じpublisherへ置換し、parentのcreate/PATCH/sourceを
  同一Appへ限定する。candidate処理はcustom Checkを書かず、PR Reviewからpublisherへhandoffする。
- trusted openerはAPIでbase/targetを固定し、変更pathから`spec→design→implementation→validation`順に
  gate集合を導出する。gateごとに決定的session keyを使い、同一keyの再実行は既存sessionを返す。
- 同じSHA/name/Appのparentは一件だけを許す。複数、別source、設定とrulesetの不一致は選択せず停止する。
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
- Strictは既存の`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）が要求する入力形へGitHub slot
  envelopeを写像して渡す。replay・nonce・Check読書きは同関数の外に置き、別actor・別invocationの2 approve
  かつbinding完全一致だけをapprovedにする（同関数の既存判定規則をそのまま踏襲する）。
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

- Given: Strict sessionへ2件のslot envelopeがある
- When: 別actor・別invocationの2 approve、重複、replay、不足、混合判定を集約する
- Then: 既存の`verifyGithubReviewEvidence`（`src/lib/review-evidence.ts`）だけが最終判定し、正常2件だけ
  success、他はfailureまたはaction_requiredとなる（検証: `automated`）

### AC-7: status/conclusionとbackend境界

- Given: queued、processing、awaiting、approved、rejected、invalidの各状態がある
- When: Checkへ写像する、またはlocal backendからcommandを呼ぶ
- Then: 規定写像以外を発行せず、localではGitHub APIと成果物を変更しない（検証: `automated`）

### AC-8: 配布・監査契約

- Given: workflow、CLI、adapter、template、rulesetが存在する
- When: session、replay、recoveryを実行する
- Then: 展開元/先が一致し、actor/run/review/session/check/slot/nonceを秘密値なしで追跡できる（検証: `automated`）

## 制約・完了条件・対象外

公式に存在する`concurrency.queue: max`は100件上限の補助にだけ使い、耐久性を委ねない。4ゲート名、
人間の判定内容生成、credential作成、`verifyGithubReviewEvidence`自体の判定ロジック・#283の責務、
local backendは変更しない。全ACの正常・反例・
取消回復・配布同期・回帰証跡を`VALIDATION.md`へ保存して完了する。未決事項はない。
