# SPEC: trusted workflowでローカルレビュー証跡をCheck Run正本へ記録する

- Issue: `ISSUE-283`
- 作成者: `bootstrap_gate_provenance`
- 対象ブランチ: `bugfix/283-gate-check-bootstrap`

## 目的・背景

GitHubモードのゲート正本はCheck Runだが、ローカルで独立レビューを完了しても、GitHub Actions内に
AI認証を置かずにその判定を安全にCheck Runへ記録する経路がない。このためdesign gate承認を前提に
するADR finalizationが循環停止する。進行役がCodex・Claude Code・Cursor等へローカル委譲して得た
構造化証跡を、default branch上のtrusted workflowが再検証して現在のPR SHAだけへ記録できるようにする。

## 前提・用語・境界

- `recorder_actor`: GitHubへ証跡とdispatchを記録する進行役のidentity。PR authorと同一でもよい。
- `reviewer`: read-only隔離runで判定したAIまたは人間。human reviewerがPR author本人なら独立と認めない。
- `evidence v2`: `agent-skill-chain/gate-review-evidence/v2`。Issue/gate/profile/target SHA、reviewerの
  run ID・slot・adapter・model・reasoning・read-only capability、prompt digest、verdict、
  trusted base SHA・launcher digest・ephemeral clone・read-only sandboxを必須入力とする。
- #274がローカルreviewer起動・evidence v2記録・Strict集約を担い、本IssueはGitHub上の再検証と
  Check Run発行だけを担う。入力のverdictやdigestを無条件に信用しない。

## 要求 → 要件 → 受入条件

### 要求

GitHub Actions内でAIやAPIキーを使わず、ローカルの独立レビュー結果を信頼済みの調整経路から
Check Run正本へ記録し、権限・対象・証跡の不整合を迂回せず全PRを進行可能にする。

### 要件

- 記録処理はdefault branchにあるtrusted workflowとtrusted codeだけを実行し、PR側コードを実行しない。
- `repository_dispatch`の入力は既存PR番号、許可gate名、40桁の対象SHAだけとし、証跡はPR Review APIから再取得する。
- 起動actorの実効権限をGitHub APIで解決し、`write|maintain|admin`だけを許可する。
- PRのcurrent head、default base、Issue、canonical check名、evidence v2の全必須field、review profile、
  reviewer数・slot・一意run、prompt、read-only隔離、verdict、成果物を再検証する。
- 成果物digestは対象SHAのGit objectからtrusted codeが再計算し、自己申告との不一致を拒否する。
- recorder actorはreviewerではない。同一actorでも独立AI runは許可するが、author本人のhuman review、
  重複run/slot、未登録launcher、candidate baseのlauncherは拒否する。
- `approved`だけをsuccess、`rejected`をfailure、判定不能をaction_requiredとして記録する。
- Check Runは設定中のcanonical `agent-skill-chain/{gate}-gate`名だけを使い、`checks: write`以外は
  contents/pull-requests readに限定する。outputへevidence digest・reviewer/aggregate provenance・
  target・gate・成果物digestを機密を除いて記録する。
- 配布テンプレート、展開済みworkflow、init/upgrade対象、CLI・テストを同期する。
- 初回導入の循環は、#284に限り明示承認された管理者が独立Sol/xhighレビューと全非ゲートCIの
  証跡をPRへ残した後にadmin mergeする一回限りのmigrationで解く。以後この例外を使用しない。

### 受入条件（Acceptance Criteria）

#### AC-1: 正常な証跡を現在SHAへ記録できる

- Given: write権限を持つ記録者が、current headを対象にした独立read-onlyレビュー証跡を提出する
- When: repository_dispatchでdefault branchのtrusted workflowが入力とGitHub上のPR状態を検証する
- Then: canonical gate名のCheck Runが証跡判定に対応するconclusionで対象SHAへ発行され、検証済みprovenanceが残る
- 検証方法見込み: `automated`

#### AC-2: stale・対象違い・不正gateを拒否する

- Given: 古いSHA、別PR/Issue/default base、許可リスト外gate、または成果物digest不一致がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、success Check Runを発行しない
- 検証方法見込み: `automated`

#### AC-3: 権限と独立性をfail-closedで検証する

- Given: actorの権限不足、evidence v2不足、重複run/slot、非read-only、author自身のhuman review、または判定矛盾がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、PR authorと同じactorであることだけを独立性の根拠にも拒否理由にもしない
- 検証方法見込み: `automated`

#### AC-4: consumerへ安全に配布・更新できる

- Given: 新規導入先または既存導入先がsetup/upgradeを実行する
- When: GitHubテンプレートが展開される
- Then: trusted workflowと検証コードが同期され、AI/API credentialを要求しない
- 検証方法見込み: `automated`

## スコープ外

- ローカルAIレビューハーネス自体の起動・モデル選択・verdict生成・Strict集約
- GitHub App、OpenAI/Anthropic APIキー、self-hosted runnerの導入
- branch protectionやrequired checkの恒久的な緩和、自動的な権限昇格

## 完了条件・未決事項

AC-1〜AC-4の自動テスト、全回帰、template sync、権限最小化検査が成功し、#284の一回限りmigrationと
以後の通常dispatchを監査可能に記録する。未決事項はない。
