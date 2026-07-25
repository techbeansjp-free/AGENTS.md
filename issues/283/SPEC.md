# SPEC: trusted workflowでローカルレビュー証跡をCheck Run正本へ記録する

- Issue: `ISSUE-283`
- 作成者: `bootstrap_gate_provenance`
- 対象ブランチ: `bugfix/283-gate-check-bootstrap`

## 目的・背景

GitHubモードのゲート正本はCheck Runだが、ローカルで独立レビューを完了しても、GitHub Actions内に
AI認証を置かずにその判定を安全にCheck Runへ記録する経路がない。このためdesign gate承認を前提に
するADR finalizationが循環停止する。進行役がCodex・Claude Code・Cursor等へローカル委譲して得た
構造化証跡を、default branch上のtrusted workflowが再検証して現在のPR SHAだけへ記録できるようにする。

## 要求 → 要件 → 受入条件

### 要求

GitHub Actions内でAIやAPIキーを使わず、ローカルの独立レビュー結果を信頼済みの調整経路から
Check Run正本へ記録し、権限・対象・証跡の不整合を迂回せず全PRを進行可能にする。

### 要件

- 記録処理はdefault branchにあるtrusted workflowとtrusted codeだけを実行し、PR側コードを実行しない。
- 入力は既存PR番号、許可gate名、40桁の対象SHA、構造化レビュー証跡とし、PRのcurrent head/base/Issueを照合する。
- 起動actorは対象リポジトリへのwrite以上の権限を必要とする。actorは証跡の記録者であり、PR authorとの一致だけで拒否しない。
- reviewerの独立性・read-only性・対象SHA・gate・判定・成果物digestは証跡契約で検証し、不足時は成功を発行しない。
- `approved`だけをsuccess、`rejected`をfailure、判定不能をaction_requiredとして記録する。
- 配布テンプレート、展開済みworkflow、init/upgrade対象、CLI・テストを同期する。

### 受入条件（Acceptance Criteria）

#### AC-1: 正常な証跡を現在SHAへ記録できる

- Given: write権限を持つ記録者が、current headを対象にした独立read-onlyレビュー証跡を提出する
- When: default branchのtrusted workflowが入力とGitHub上のPR状態を検証する
- Then: 許可されたgate名のCheck Runが証跡判定に対応するconclusionで対象SHAへ発行される
- 検証方法見込み: `automated`

#### AC-2: stale・対象違い・不正gateを拒否する

- Given: 古いSHA、別PR/Issue/base、または許可リスト外gateを含む入力がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、success Check Runを発行しない
- 検証方法見込み: `automated`

#### AC-3: 権限と独立性をfail-closedで検証する

- Given: actorの権限不足、証跡不足、重複reviewer、非read-only、または判定矛盾がある
- When: trusted記録処理を実行する
- Then: 非zeroで停止し、PR authorと同じactorであることだけを独立性の根拠にも拒否理由にもしない
- 検証方法見込み: `automated`

#### AC-4: consumerへ安全に配布・更新できる

- Given: 新規導入先または既存導入先がsetup/upgradeを実行する
- When: GitHubテンプレートが展開される
- Then: trusted workflowと検証コードが同期され、AI/API credentialを要求しない
- 検証方法見込み: `automated`

## スコープ外

- ローカルAIレビューハーネス自体の起動・モデル選択・verdict生成
- GitHub App、OpenAI/Anthropic APIキー、self-hosted runnerの導入
- branch protectionやrequired checkの緩和、admin bypass、自動的な権限昇格
