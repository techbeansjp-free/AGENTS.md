# SPEC: human gateの停止状態と復帰入口を同じtrusted sessionへ結線する

- Issue: `ISSUE-278`
- 作成者: `human_rerun_entry`
- 対象ブランチ: `bugfix/278-human-adapter-rerun-entry`

## 目的・背景

GitHubモードのhuman gateは、非同期判定を待つ間required Checkを`action_required`にする。
復帰操作は単なるworkflow再実行ではなく、停止を作ったPR head・gate・review profile・Check Runへ
一回限りで結線されなければならない。本Issueは初回通知と判定提出をdefault branchのtrusted処理へ
限定し、PR codeへのwrite token露出、別Checkへの承認、replay、backend二重化を防ぐ。

## 前提・用語・入出力

- 対象: `coordination.backend: github`、openかつsame-repositoryのPR、`review.adapter: human`。
- human gate session: required Check Runを親とし、session ID、publisher App、PR、Issue、gate、target SHA、
  profile、trusted CLI SHA、期待slot、状態、submission digestを保持するGitHub正準レコード。
- 状態: `awaiting`、`consuming`、`approved`、`rejected`、`human_required`、`invalidated`。
- 初回入力: trustedなPR event、base/head repository、PR番号、branch、head SHA、label、gate。
- 判定入力: 親Check Run ID、session ID、slot、invocation ID、PR番号、gate、target SHA、
  conformance/falsification、origin付きfinding。artifact path/digestは人間入力にしない。
- 出力: 同じ親Check Run IDの`success|failure|action_required`と、actor・workflow run・slot判定を含む証跡。
- ローカルモードの正本は従来どおり`reviews/<gate>.yaml`であり、GitHub sessionを作らない。

## 要求・要件

human adapterの停止通知から判定提出までを、default branchのtrusted CLI、GitHub正準session、
target commitのread-only Git objectという3境界へ分離する。

- 初回通知はPR codeを実行せず、required Check summaryへ実在workflow名、全入力、権限を記録する。
- session作成・提出はopen/same-repo/current head、branch、Issue、human adapter、profileを再検証する。
- 親Checkの`external_id`と機械可読outputを一回限りCAS相当で更新し、別Checkをsuccessとして作らない。
- Check名はdefault branch設定の`config.checks[gate]`からのみ導出する。
- expected artifact full-setはtrusted処理がbase/target差分とsegment出力から導出し、target Git objectから
  全digestと集合digestを計算する。空・不足・余分・重複を成功にしない。
- Standardは1 slot、Strictは別actor・別invocationの固定2 slotをGitHub上で耐久化し、
  一般trusted aggregationの完全一致・優先順位規則で親Checkを確定する。
- verdict欠落、不正JSON、不正finding、`pending`、判定不能、stale session、API失敗はsuccessにしない。
- 同じsession・submission digestのreplayは既存結果を返し、異なる再提出は新sessionなしでは拒否する。

## 受入条件

### AC-1: trustedな初回通知

- Given: GitHub human gateが開始される
- When: trusted default-branch workflowがsessionを作る
- Then: PR codeへwrite tokenを渡さず、親`action_required` Checkに実行可能な復帰commandと全識別子を記録する（検証: `automated`）

### AC-2: 現在headと停止Checkへの結線

- Given: 人間が判定を提出する
- When: PRがclosed/external、head・gate・Issue・adapter・profile・session・Check IDのいずれかが不一致である
- Then: Checkを更新せず明示エラーで停止する（検証: `automated`）

### AC-3: 一回限りCASと冪等性

- Given: `awaiting` sessionがある
- When: 同一PR/gateの提出が並行または再実行される
- Then: 1件だけが`consuming`へ遷移し、同一digest replayはno-op、相反提出は拒否され、新Checkを作らない（検証: `automated`）

### AC-4: required Check名とfull-set証跡

- Given: 検証済みsessionとtarget commitがある
- When: trusted処理が最終判定を発行する
- Then: config由来の同じ親Checkだけを更新し、全期待artifactのGit object digestと集合digestを保存する（検証: `automated`）

### AC-5: 不完全・不正な判定はfail-closed

- Given: JSON欠落、不正値、`pending`、空/不一致artifact集合、判定不能、API/fetch失敗がある
- When: 復帰workflowが処理する
- Then: `success`を発行せず、sessionを再利用可能な成功状態へ倒さない（検証: `automated`）

### AC-6: Strict 2-slotの正常復帰

- Given: session profileがStrictである
- When: 別actor・別invocationの2 slotが同じ対象へ判定を提出する
- Then: 2件を耐久証跡から集約し、両方approveかつ証跡一致時だけ親Checkをsuccessにする（検証: `automated`）

### AC-7: backend・role境界

- Given: CLIがlocal backend、または自動adapter選択で呼ばれる
- When: human GitHub session commandが要求される
- Then: GitHub API前に拒否し、local report、自動adapter、writer lease、成果物branchを変更しない（検証: `automated`）

### AC-8: 配布・監査契約

- Given: workflow、human adapter、CLI、テンプレートが存在する
- When: sessionを開始・提出・replayする
- Then: 配布元/展開先が一致し、actor・run/session/check/slot IDを秘密値なしで再現できる（検証: `automated`）

## 制約・完了条件・対象外

- 4ゲートとrequired Check名は変更しない。workflow権限は`contents: read`、`pull-requests: read`、
  `checks: write`に限定し、Issue書込み権限を追加しない。
- verdictはenv経由でstdinへ渡し、workflow式をshell本文へ展開しない。入力・Check outputは上限を設ける。
- Strict集約規則はIssue #277由来の共通契約を再利用し、本IssueはGitHub耐久化と復帰結線だけを担う。
- 正常、stale、external、権限、replay、並行、Strict不足/正常、artifact反例、local拒否を自動検証し、
  全AC証跡を`VALIDATION.md`へ保存すれば完了する。
- 対象外: 人間のレビュー内容生成、credential作成、Claude Code/Codexの自動判定実装、4ゲート変更。
