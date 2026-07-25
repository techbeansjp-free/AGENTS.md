# SPEC: コア監査のローカル独立レビュー契約

- Issue: `ISSUE-271`
- 対象ブランチ: `process/271-core-audit-model-selection`

## 目的・背景

コア規約・状態遷移・ゲート・Coordination Backend・配布ルールの変更または監査には、最上位能力の独立レビューが必要である。ただし、AI レビューを GitHub Actions 内で実行すると model provider の API credential または self-hosted runner を要求し、利用者が既にローカルの Codex / Claude Code へログインしている実態と一致しない。

本変更では、進行役がローカルの adapter を通じて独立レビュアを起動する。GitHub Actions は AI を実行せず、GitHub Review API に保存された構造化証跡を検証し、対象 SHA の Check Run を記録する。Codex では `gpt-5.6-sol` / `xhigh`、Claude Code では実行環境が検証した同等能力を要求する。Cursor は adapter と非対話 capability probe が未実装であるため利用可能と推測しない。

## 対象・用語・入出力

- 対象: GitHub/ローカル両 Coordination Backend の全 gate reviewer。コア変更では Strict を必須とする。
- ローカル独立レビュー: 成果物を書けないレビュアプロセスが、ローカル CLI の既存ログインを使って verdict を返すこと。
- 構造化証跡: Issue、gate、target SHA、prompt digest、adapter 能力、reviewer run ID/slot、Coordination Backend が記録した writer run ID、成果物 digest、verdict を含む GitHub PR review。
- 入力: Issue ID、gate、profile、target SHA、変更差分、選択 adapter、reviewer/writer run ID。
- 出力: 検証済み gate report と Check Run、または `human_required` / `action_required`。
- 永続先: GitHub モードは PR review と Check Run、ローカルモードは `reviews/<gate>.yaml`。branch 内の自己申告証跡は GitHub モードの承認根拠にしない。

## 要求

- コア変更は manifest の exact path / path prefix、コア監査は GitHub の `review:core-audit` label またはローカル state の `core_audit` から機械分類し、Strict の独立 reviewer 2体を要求する。差分または正本入力を解決できなければ `human_required` とする。
- AI は進行役がローカル adapter へ委譲する。CI は model provider を呼ばず証跡検証と Check Run 記録だけを行う。
- reviewer は read-only、証跡の GitHub Review API 送信は trusted adapter/CLI、成果物変更は writer に限定する。
- provider 差異は vendor-neutral capability contract と capability probe で扱い、未実装 provider の能力を捏造しない。

## 受入条件

### AC-1: ローカル実行と CI 責務が分離される

- Given: GitHub モードで gate 対象 SHA が push される
- When: gate workflow が実行される
- Then: OpenAI/Anthropic API credential と self-hosted runner を要求せず、GitHub Review API の証跡検証と Check Run 発行だけを行う
- 検証方法: `automated`

### AC-2: コア能力契約を provider ごとに検証する

- Given: コア変更または `core_audit` をローカル reviewer が判定する
- When: adapter と capability probe を解決する
- Then: Codex は `gpt-5.6-sol` / `xhigh` / read-only、Claude Code は `frontier_coding` / `maximum_reasoning` / read-only の検証済み実在設定だけを許可し、Cursor等の未登録 adapter は `human_required` になる
- 検証方法: `automated`

### AC-3: 古いSHA・改変証跡を拒否する

- Given: PR review 証跡の投稿者が登録済み trusted recorder でない、または target SHA、GitHub review の commit ID、prompt digest、成果物 digest のいずれかが現在の対象と異なる
- When: CI の trusted CLI が証跡を検証する
- Then: 承認を生成せず `action_required` とし、branch 内ファイルだけで証跡を代替できない
- 検証方法: `automated`

### AC-4: 自己承認とStrict件数不足を拒否する

- Given: reviewer run ID が Coordination Backend の writer run ID と一致する、reviewer run ID/slot が重複する、trusted recorder による実行 attestation がない、または Strict の有効証跡が slot 1・2 の2件揃わない
- When: trusted CLI が証跡を集約する
- Then: gate は approved にならず、1件でも blocking/fail があれば rejected、判定不能・不足は `human_required` になる
- 検証方法: `automated`

### AC-5: BDD追跡を保つ

- Given: 各 gate の構造化証跡が存在する
- When: verdict と成果物を集約する
- Then: conformance/falsification、全 AC-ID、finding origin、approved artifact digest が gate report に保存され、AC変更時は下流 gate が無効化される
- 検証方法: `automated`

### AC-6: 通常作業とローカルbackendを維持する

- Given: 非コア作業またはローカル Coordination Backend である
- When: 明示選択された既存 adapter を起動する
- Then: 通常作業のモデル選択をコア固定値へ置換せず、ローカル backend は検証済み gate report を正本として従来どおり動作する
- 検証方法: `automated`

### AC-7: 正本と配布物が一致する

- Given: policy、schema、adapter、workflow template、展開済み workflow、テストが存在する
- When: schema、template sync、policy、adapter、回帰検査を行う
- Then: API key / Codex Action / CI 内 AI 実行への依存がなく、全層が同じローカルレビュー契約を表す
- 検証方法: `automated`

## 制約・完了条件

- I2/I5/I7/I8、1 Issue = 1 branch = 1 worktree = 1 PR、writer lease、4 checkpoint を維持する。
- GitHub review の author/id/commit_id は API 応答を正本とし、author は manifest の `trusted_reviewer_actors` に一致しなければならない。証跡本文の自己申告値で上書きしない。
- trusted recorder は、ローカル adapter の capability probe 成功、read-only 起動、reviewer run ID/slot と verdict の対応を GitHub review の投稿によって attest する。CI は未登録 actor の本文や branch 内ファイルを信頼しない。
- reviewer と writer の credential/capability は role contract で分離し、worker に Review API と trusted recorder credential を与えない。writer run ID は Coordination Backend の worker report から検証し、本文の自己申告だけを信頼しない。
- 証跡未到着・分類不能・capability 未証明・件数不足は成功や `neutral` にしない。
- 全 AC の自動テスト、型検査、lint、SAST、依存関係・secret scan、template sync を実行して push する。

## 対象外・未決事項

- API key、self-hosted runner、CI 内 model inference の導入。
- Cursor adapter/CLI の推測実装。将来は同じ capability contract と probe を満たす別 Issue で追加する。
- model 出力そのものの暗号学的証明。偽造耐性は trusted recorder の登録・credential 分離、GitHub API metadata、Coordination Backend の writer report、digest 再計算で担保する。
- 未決事項はない。
