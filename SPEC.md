# SPEC: human adapterの復帰案内と実行可能なWorkflow入口を一致させる

- Issue: `ISSUE-278`
- 作成者: `human_rerun_entry`
- 対象ブランチ: `bugfix/278-human-adapter-rerun-entry`

## 目的・背景

GitHubモードのhuman gate reviewerは、判定を非同期の人間へ委ねると
`human_required`を記録し、required Checkを`action_required`として停止する。
現在の通知は判定後のworkflow再実行を案内するが、実在する手動起動入口と、
どのPR head SHAをどのrequired Checkとして再評価するかの契約がない。
本Issueは、停止後に実行できる復帰入口と自己完結した案内を提供し、
誤ったSHAへの承認やadapterの権限拡大を防ぐ。

## 前提・用語・入出力

- 前提: GitHubモードで、対象PRはopenかつ同一repository内にあり、human reviewerを選択している。
- 「復帰入口」: write権限を持つ人間が明示起動でき、trusted処理がCheck Runを発行するGitHub Actions workflow。
- 入力: PR番号、gate ID、40桁のtarget SHA、人間のconformance/falsification verdictとorigin付きfinding。
- 出力: target SHAに結線された`agent-skill-chain/<gate>-gate` Check Runと、成功または安全側停止の実行記録。
- 権限境界: 人間レビュアはread-onlyで判定を返し、Check Run書込みはtrusted workflowだけが行う。

## 要求 → 要件 → 受入条件

### 要求

human adapterが`action_required`で停止した後、通知どおりの実在する操作だけで、
対象PRの現在のhead SHAを安全に再評価できるようにする。

### 要件

- 配布元と展開先の両方に、明示的な手動起動入口を持つ。
- 復帰処理はopen PR、同一repository、現在のPR head SHA、許可されたgate IDを照合する。
- Check名は設定済みrequired Check名から導出し、入力で任意名を指定させない。
- verdictをschema準拠reportへtrusted処理で結線し、`pending`や不正入力を成功にしない。
- human adapterの通知は実在するworkflow名、必須入力、対象SHA、権限要件を示す。
- Claude Code/Codexの自動reviewer経路とhumanの非同期責務を混在させない。

### 受入条件（Acceptance Criteria）

#### AC-1: 実在する復帰入口を案内する

- Given: GitHubモードのhuman gate reviewerが`action_required`で停止する
- When: human adapterが復帰手順を通知する
- Then: 実在する手動workflow入口、PR番号、gate ID、target SHA、verdict、必要権限が自己完結して示される
- 検証方法見込み: `automated`

#### AC-2: 現在のPR head SHAだけを再評価する

- Given: 人間が復帰workflowを起動する
- When: PRがclosed、別repository由来、または入力SHAが現在のPR head SHAと異なる
- Then: Check Runを成功として発行せず、明示エラーで停止する
- 検証方法見込み: `automated`

#### AC-3: required Check名とgateを固定対応させる

- Given: 許可されたgate IDと検証済みtarget SHAがある
- When: trusted workflowが人間verdictを発行する
- Then: 設定から導出した当該gateのrequired Check名だけをtarget SHAへ発行する
- 検証方法見込み: `automated`

#### AC-4: 不完全・不正なverdictはfail-closedになる

- Given: verdictが欠落、不正JSON、schema不適合、`pending`、または判定不能である
- When: 復帰workflowがverdictを処理する
- Then: `success`を発行せず、既存の`action_required`を解除しない
- 検証方法見込み: `automated`

#### AC-5: adapter責務と配布同期を維持する

- Given: Claude Code、Codex、humanのadapterとGitHub workflowテンプレートが存在する
- When: 復帰入口を追加する
- Then: humanだけが非同期復帰手順を案内し、自動adapterの起動責務は変えず、配布元と展開先が一致する
- 検証方法見込み: `automated`

## 制約・完了条件・検証

- 4ゲート、Check名、gate-report schema、adapter選択規則は変更しない。
- workflow権限は`contents: read`、`pull-requests: read`、`checks: write`の最小範囲とする。
- 正常、stale SHA、closed/外部PR、不正gate、不正verdict、通知とworkflow定義の一致を自動テストする。
- 全ACの証跡と回帰結果を`VALIDATION.md`へ記録し、配布同期検査を通過すれば完了とする。
- 未決事項: なし。

## スコープ外

- 人間のレビュー内容そのものの自動生成
- GitHub利用者・token・secretの作成や権限付与
- Claude Code/Codexの認証・モデル選択・自動reviewer実装
- Strict profileの独立レビュア件数集約（Issue #277の責務）
- `action_required`以外のゲート状態モデル変更
