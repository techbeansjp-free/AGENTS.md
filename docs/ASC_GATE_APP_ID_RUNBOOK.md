# ASC_GATE_APP_ID_RUNBOOK.md — 専用GitHub App作成・installation手順

## 目的・対象範囲

本ドキュメントは、`agent-skill-chain setup ruleset`（`setup github` から内部的に実行される場合を含む）が要求する環境変数 `ASC_GATE_APP_ID` を用意するための運用手順（runbook）である。対象は、required gate Check（`agent-skill-chain/{spec,design,implementation,validation}-gate`）を発行する専用GitHub Appを、まだ作成・installationしていない対象リポジトリの管理者である。

本ドキュメントの内容だけで、専用GitHub Appの新規作成から `ASC_GATE_APP_ID` への設定までを完了できる。他の成果物（README.md・AGENTS.md・ADR・ソースコード等）を参照する必要はない。

## 前提・用語

- **専用GitHub App**: `agent-skill-chain setup ruleset` が対象リポジトリの branch ruleset（`required_status_checks`）へ `integration_id` として固定する、gate Check発行専用のGitHub App。標準のGitHub Actions App（App ID `15368`）とは別の、新規作成したAppを指す。
- **App ID**: GitHub App自体を一意に識別する数値ID（GitHub Appの設定ページに表示される「App ID」欄の値）。installation ID（Appを特定の組織・リポジトリへ導入した際に発行される別のID）とは異なる値であり、本ドキュメントで扱うのはApp IDである。
- **installation**: 作成したGitHub Appを、対象の組織またはリポジトリへ導入し、実際にアクセスできるようにする操作。
- **`ASC_GATE_APP_ID`**: `agent-skill-chain setup ruleset` 実行時に読み取る環境変数。値は専用GitHub AppのApp ID（10進数の正整数の文字列）で、secretではない（Appの秘密鍵ではなく単なる識別子のため）。

## 手順

### 1. 専用GitHub Appの作成

1. 対象リポジトリが組織（Organization）配下の場合: 組織の Settings > Developer settings > GitHub Apps > New GitHub App を開く。個人アカウント配下の場合: 自分のアカウントの Settings > Developer settings > GitHub Apps > New GitHub App を開く。
2. GitHub App名（例: `<repo-name>-asc-gate`）、Homepage URL（対象リポジトリのURLで可）を入力する。
3. Webhook は不要（"Active" のチェックを外す）。本Appはgate Checkの発行にのみ使用し、Webhookイベントを受信しない。
4. Repository permissions で以下を設定する（他のpermissionは既定値のままでよい）。
   - **Checks**: Read and write（gate Checkの作成・更新に必須）
   - **Metadata**: Read-only（GitHub Appの必須既定権限。変更不要）
5. "Where can this GitHub App be installed?" は対象リポジトリのオーナーアカウントのみに導入する場合は "Only on this account" を選ぶ。
6. "Create GitHub App" を押して作成する。

### 2. 対象リポジトリへのinstallation

1. 作成したGitHub Appの設定ページ（`https://github.com/settings/apps/<app-slug>`、または組織配下の場合は `https://github.com/organizations/<org>/settings/apps/<app-slug>`）を開く。
2. 左メニューの "Install App" を選び、対象の組織またはアカウントを選択する。
3. "Only select repositories" を選び、gate Checkを発行する対象リポジトリだけを選択する（全リポジトリへの導入は不要）。
4. "Install" を押して installation を完了する。

### 3. App IDの確認

1. 作成したGitHub Appの設定ページ（手順2と同じURL）を開く。
2. ページ上部の "About" セクションにある **App ID** 欄の数値を確認する（installation IDではなく、Appそのものの数値ID）。
3. この数値が標準GitHub Actions AppのID `15368` と一致しないことを確認する（一致する場合は誤って標準Appのページを見ている）。

### 4. `ASC_GATE_APP_ID` への設定

確認したApp IDを、`agent-skill-chain setup ruleset`（または `setup github`）を実行する環境の環境変数 `ASC_GATE_APP_ID` へ設定する。

```bash
export ASC_GATE_APP_ID=<手順3で確認したApp ID>
npx github:techbeansjp-free/AGENTS.md setup ruleset [owner/repo]
```

`ASC_GATE_APP_ID` はsecretではなく単なる識別子のため、CI環境で設定する場合も通常の環境変数（GitHub Actionsの `env:` 等）でよく、暗号化されたsecretストレージへ格納する必要はない。

### 5. 設定の確認

`setup ruleset` が正常終了（終了コード0）し、標準出力に適用したrulesetの内容（`required_status_checks` の各 `context` に対応する `integration_id` が手順3のApp IDと一致すること）が表示されれば、設定は完了している。`ASC_GATE_APP_ID` が未設定・不正・標準GitHub Actions AppのIDの場合は、`setup ruleset` はrulesetを適用せずエラー終了する。

## 制約

- 本手順は専用GitHub Appの作成・installation・App ID取得・環境変数設定までを対象とする。作成したAppの秘密鍵を使ってgate Check（`check_run`）を実際に発行する側（`agent-skill-chain gate publish` 等の呼び出し元）の認証方法は、本手順の対象外である（「対象外」節を参照）。
- 対象リポジトリで branch ruleset を変更する権限（Administration権限を持つGitHub認証情報での `gh` CLIログイン等）が別途必要である。これは専用GitHub Appの権限とは別に、`setup ruleset` を実行する人間・進行役の既存の認証情報が担う。

## 完了条件・検証方法

- 完了条件: 対象リポジトリで `agent-skill-chain setup ruleset` が `ASC_GATE_APP_ID` を用いて終了コード0で完了し、`required_status_checks` の各gate Check contextへ手順3で確認したApp IDが `integration_id` として設定されていること。
- 検証方法: `setup ruleset` の標準出力に表示されたrulesetのJSONを確認し、`agent-skill-chain/{spec,design,implementation,validation}-gate` の4件それぞれで `integration_id` が期待するApp IDと一致することを目視確認する。

## 未決事項

- 専用GitHub Appの秘密鍵を使って実際にCheck Run（`check_run`）をこのApp identityで発行する自動化経路（`ASC_GATE_APP_PRIVATE_KEY` を用いる `record-trusted-check` 等）は、本ドキュメント作成時点でこのリポジトリのworkflowから配線されていない未実施の運用ギャップであり、別途の判断・実装を要する。本ドキュメントはApp自体の準備（作成・installation・App ID設定）のみを扱う。

## 対象外

- 専用GitHub Appの秘密鍵（`ASC_GATE_APP_PRIVATE_KEY`）を用いたCheck Run発行の自動化フロー設計・実装。
- `agent-skill-chain setup ruleset` 以外のセットアップ手順（`setup labels`・`sync templates` 等）。
- branch rulesetそのものの構造・強制内容（`required_status_checks` 以外のルール）。
