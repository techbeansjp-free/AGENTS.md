# DESIGN: human adapterの復帰案内と実行可能なWorkflow入口を一致させる

- Issue: `ISSUE-278`
- 対応する SPEC: `SPEC.md`

## 目的・前提・入出力

GitHubのhuman gateを、通知・手動判定・trusted発行の3責務へ分ける。入力はPR番号、gate、
current head SHA、verdictで、出力は設定済みrequired CheckへのCheck Runである。
workflowはdefault branch上のtrusted CLIだけを実行し、PR側のscriptを実行しない。
GitHubの`workflow_dispatch`を起動できるwrite権限者が明示判定を送ることを前提とする。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | Human notification / Manual gate workflow | 実在名と全入力を通知 |
| AC-2 | Dispatch context validator | open・same-repo・current SHAを照合 |
| AC-3 | Trusted human verdict publisher | gate→config Check名を固定対応 |
| AC-4 | Verdict validator / existing final derivation | 不正・pendingを成功にしない |
| AC-5 | Provider boundary / template sync tests | human以外を変更しない |

## 責務・境界

### Human notification

`.agent-skill-chain/adapters/human.sh`はread-only判定手順と復帰commandだけを通知する。
GitHub Actionsのevent payloadからPR番号を読み、次の固定入口と必須値を表示する。

```text
gh workflow run agent-skill-chain-human-gate.yml --ref <default-branch>
  -f pr_number=<PR> -f gate=<gate> -f target_sha=<40-hex>
  -f verdict_json='<schemaに従うJSON>'
```

adapterはverdictやCheck Runを書かない。Claude Code/Codex adapterは既存の同期自動判定を維持する。
event payloadが無いローカルモードでは既存markerとlocal report手順を使い、GitHub入口を装わない。

### Manual gate workflow

配布元と展開先へ`agent-skill-chain-human-gate.yml`を追加する。入口は
`workflow_dispatch`だけで、権限は`contents: read`、`pull-requests: read`、
`checks: write`とする。default branchを明示checkoutし、そこからtrusted CLIをbuildする。
PR headは`git fetch`してデータとしてだけ読み、PR側のpackage scriptやCLIは実行しない。
同一PR・gateのdispatchはconcurrency groupで直列化し、actorを実行証跡へ残す。

### Dispatch context validator

trusted CLIの`gate human-submit`はGitHub APIのPR情報と入力を照合する。

- PR番号は正整数、gateは固定4値、SHAは40桁hexでなければ拒否する。
- PRはopen、base/head repositoryは実行repositoryと同一、head SHAは入力と完全一致を要求する。
- head branchは設定済みbranch patternへ適合し、そこからIssue IDを一意に導出する。
- target commitがfetch済みであることを確認し、verdictのartifact pathは相対正規pathだけを許す。

いずれかが不一致ならCheckを書かず非0終了する。stale dispatchが新しいheadを承認することはない。

### Trusted human verdict publisher

CLIはstdinのverdictを既存gate-report契約へ結線し、finalを共通規則で機械導出する。
artifact digestは作業treeのpath joinではなく`git show <target>:<path>`から算出し、
path traversalとPR code実行を避ける。`final=approved`だけを`success`、
`rejected`を`failure`、`human_required`を`action_required`として発行する。
Check名は入力にせず`config.checks[gate]`から取得する。

Strictの件数・独立性は一般trusted aggregationの責務であり、本入口はその契約を呼び出す。
単独verdictでStrictを短絡する分岐は持たず、必要件数不足なら`human_required`となる。

## 依存関係

```text
human adapter → GitHub comment → workflow_dispatch
                                  ↓
default-branch workflow → context validator → verdict aggregation → Checks API
                              ↓ read-only
                         PR metadata / target commit
```

書込みはtrusted workflowからChecks APIへの一方向で、reviewerとPR codeへtokenを渡さない。

## 関連ADR

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- stale/closed/external PR、不正verdict、fetch/API失敗はCheckを更新せず既存blockを維持する。
- Checks API失敗はjob failureとして可視化し、successへ倒さない。
- rollbackはworkflow、CLI command、human通知を同時に戻す。通知だけを残してはならない。
- 影響範囲はhuman GitHub gateの復帰経路。Claude Code/Codex、local gate、4ゲート名は不変。

## 完了条件・未決事項

全ACの正常・反例テスト、権限検査、template sync、全回帰を通す。未決事項はない。
