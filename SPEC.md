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
- `evidence v3`: `agent-skill-chain/gate-review-evidence/v3`。Issue/gate/profile/target SHA、attempt ID・
  expected count・launcher token digest、reviewerのrun ID/slot/能力、prompt/verdict/artifact digest、
  trusted base/launcher/ephemeral read-only実行、aggregate verdict/provenanceを必須入力とする。
- #274はcore用のローカルreviewer起動とper-review evidence v3生成、#277は一般のStrict集約を担う。
  本Issueは集約済み最終reportを再判定せず、GitHub上でschema/provenance/digestを再検証してCheckへ写像する。

## 要求 → 要件 → 受入条件

### 要求

GitHub Actions内でAIやAPIキーを使わず、ローカルの独立レビュー結果を信頼済みの調整経路から
Check Run正本へ記録し、権限・対象・証跡の不整合を迂回せず全PRを進行可能にする。

### 要件

- 記録処理はdefault branchにあるtrusted workflowとtrusted codeだけを実行し、PR側コードを実行しない。
- `repository_dispatch`の入力は既存PR番号、許可gate名、40桁の対象SHAだけとし、証跡はPR Review APIから再取得する。
- 起動actorの実効権限をGitHub APIで解決し、`write|maintain|admin`だけを許可する。
- PRのcurrent head/default base/Issue/check名、evidence v3、最新attempt、reviewer数・slot・一意run、
  prompt、read-only隔離、verdict、成果物を再検証し、不完全な最新attemptから旧成功へfallbackしない。
- 成果物digestは対象SHAのGit objectからtrusted codeが再計算し、自己申告との不一致を拒否する。
- recorder actorはreviewerではない。同一actorでも独立AI runは許可するが、author本人のhuman review、
  重複run/slot、未登録launcher、candidate baseのlauncherは拒否する。
- `approved`だけをsuccess、`rejected`をfailure、判定不能をaction_requiredとして記録する。
- Check Runは設定中のcanonical `agent-skill-chain/{gate}-gate`名だけを使い、`checks: write`以外は
  contents/pull-requests readに限定する。outputへevidence digest・reviewer/aggregate provenance・
  target・gate・成果物digestを機密を除いて記録する。
- workflowのGitHub Actions App identityを、rulesetのexpected integration（未固定ならcontext-only）と照合する。
  発行後にcurrent SHAのcanonical checkをAPIで再読取し、同一Appの最新runが期待conclusionでなければ完了しない。
- Check outputに検証済み最終reportとevidence digestを耐久保存する。ローカルmaterializeはcurrent SHAの
  latest same-App successと成果物digestを再検証したreportだけを非正本cacheとして復元し、ADR finalizationへ渡す。
- 配布テンプレート、展開済みworkflow、init/upgrade対象、CLI・テストを同期する。
- 初回導入の循環はAC-5の一回限りmigrationで解き、通常運用へ例外を持ち越さない。

### 受入条件（Acceptance Criteria）

#### AC-1: 正常な証跡を現在SHAへ記録できる

- Given: write権限を持つ記録者が、current headを対象にした独立read-onlyレビュー証跡を提出する
- When: default branchのtrusted workflowが入力を検証し、後続の進行役がreport materializeを要求する
- Then: canonical Checkへprovenanceが残り、latest same-App successだけが復元されADR finalizationを進められる
- 検証方法見込み: `automated`

#### AC-2: stale・対象違い・不正gateを拒否する

- Given: 古いSHA、別PR/Issue/default base、許可リスト外gate、または成果物digest不一致がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、success Check Runを発行しない
- 検証方法見込み: `automated`

#### AC-3: 権限と独立性をfail-closedで検証する

- Given: actor権限不足、evidence v3/attempt不足、重複run/slot、非read-only、author自身のhuman review、または判定矛盾がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、PR authorと同じactorであることだけを独立性の根拠にも拒否理由にもしない
- 検証方法見込み: `automated`

#### AC-4: consumerへ安全に配布・更新できる

- Given: 新規導入先または既存導入先がsetup/upgradeを実行する
- When: GitHubテンプレートが展開される
- Then: trusted workflowと検証コードが同期され、AI/API credentialを要求しない
- 検証方法見込み: `automated`

#### AC-5: trusted workflowを含む#274だけを監査可能にbootstrapできる

- Given: owner明示承認・admin bypass許可・Sol/xhigh最終PASS・全非gate CI PASSに加え、#274最終SHAが
  v3 evidence、Check outputの最終report/digest、protected-base materialize経路を含む
- When: 進行役が最終固定した#274/current headだけをadmin mergeする
- Then: 許可者・PR・SHA・verdict・CI・実行者・時刻をPRへ耐久記録し、条件不一致または再利用を拒否する
- 検証方法見込み: `hybrid`

## スコープ外

- ローカルAIレビューハーネス自体の起動・モデル選択・verdict生成・Strict集約
- GitHub App、OpenAI/Anthropic APIキー、self-hosted runnerの導入
- branch protectionやrequired checkの恒久的な緩和、自動的な権限昇格

## 完了条件・未決事項

AC-1〜AC-4の自動テスト・全回帰・同期・権限検査を成功させ、AC-5はowner承認と固定SHAのhybrid証跡を
耐久記録する。以後の通常経路へmigration例外を持ち越さない。未決事項はない。
