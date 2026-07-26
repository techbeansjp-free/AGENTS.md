# DESIGN: 期限切れ writer lease の再開と秘密情報の隔離

- Issue: `ISSUE-286`
- 対象ブランチ: `bugfix/286-expired-writer-lease-resume-and-redaction`
- 関連 ADR: `ADR-0014-expired-writer-lease-resume-and-redaction`

## 目的・対象範囲

GitHub backend の writer lease を、期限切れ後も同一作業の dirty worktree だけは安全に再開できる
状態にする。同時に、lease token を commit subject、Issue comment、CLI 出力から除去する。対象は
lease acquire、renew、release、resume、reconcile と GitHub lease ref の表現である。

## 責務と境界

| Context | 入力 | 出力 | 責務 | 禁止 |
|---|---|---|---|---|
| LeaseRepository | issue、segment、holder、lease ref | 現在 lease と CAS 結果 | ref の読取り、比較更新、削除 | token を可視 Git metadata に書く |
| CredentialStore | lease、専用 worktree、branch | owner-only credential | Git common directoryへの原子的な保存・読取り・削除 | Git管理対象やCLI出力へtokenを渡す |
| ResumeLeasePolicy | 期限切れ lease、専用 worktree、resume proof | resumed / human_required | 同一作業の証明と安全な移譲 | 異なる holder や worktree の奪取 |
| LeasePresentation | lease の公開可能な属性 | comment、CLI 表示 | holder、期限、状態だけを表示 | token や secret payload の直列化 |
| Reconciler | 期限切れ lease と worktree 状態 | reclaimed / human_required | clean は回収、dirty は保護・再開案内 | dirty 変更の削除、勝手な再開 |

## 構造と依存方向

```mermaid
flowchart LR
  W[Worker resume] --> P[ResumeLeasePolicy]
  P --> I[Worktree identity check]
  P --> R[LeaseRepository CAS]
  R --> F[Git lease ref]
  R --> V[LeasePresentation]
  V --> C[Issue comment and CLI]
  X[Reconciler] --> P
  I -->|mismatch| H[human_required]
  R -->|CAS conflict| H
```

`LeaseRepository` が token を含む非表示 payload を ref object に保存する唯一の境界である。
`LeasePresentation` は公開 DTO を受け取り、token を持たないため、表示経路が token を誤って
出力できない。resume は既存 ref の object ID を期待値とする compare-and-swap を使い、検査後に
別作業者が更新した場合も上書きしない。

`CredentialStore` は `.git` の実パスではなく Git が返す common directory を基準にするため、
linked worktree からも同じ credential を参照できる。credential directory は mode `0700`、
Issue ごとの YAML は mode `0600` とし、Git index・commit・push の対象外に置く。acquire は
公開 lease のみを stdout へ返し、renew と release は credential を暗黙に読み取る。これにより
token を可視出力へ戻さず、従来の acquire→renew/release ライフサイクルを維持する。

## データと状態遷移

lease ref の commit subject は、schema version、Issue、segment、holder、取得時刻、期限、状態を
含む token 非含有の公開 YAML とする。token は commit の tree に置く非表示 payload に保持し、
commit subject・Issue comment・CLI では `holder` と `expires_at` だけを表示する。
新規形式は payload を先に検証し、payload が存在しない場合だけ token 含有の旧 commit message を
legacy reader で解釈する。raw legacy message は成功・失敗のどちらの表示にも連結しない。

```mermaid
stateDiagram-v2
  [*] --> Active: acquire
  Active --> Active: renew with token and CAS
  Active --> Expired: time passes
  Expired --> Reclaimed: clean or absent worktree
  Expired --> Resumed: same holder and worktree proof + CAS
  Expired --> HumanRequired: dirty mismatch or CAS conflict
  Resumed --> Active
  Reclaimed --> [*]
  HumanRequired --> [*]
```

旧形式 ref は reader が検出した時点で legacy と扱う。期限切れなら reconcile が token を表示せず
削除できる。正当な resume は新形式 ref に比較更新する。期限内の旧形式 lease は既存の holder が
renew/release するまで token の露出範囲を拡大せず、他作業者に取得させない。

## 再開証明

resume は `issue start` で作った worktree を `git worktree list --porcelain` から解決し、次を
すべて検査する。

- ref の Issue と segment がコマンド引数に一致する。
- resume proof の holder が ref の holder に一致する。
- credential の token が ref payload の token と一致し、Issue と segment も一致する。
- worktree の branch が Issue の branch 命名規約と ref の Issue に一致する。
- credential に worktree と branch が記録されている場合、現在の実体と一致する。
- worktree が dirty であり、reconcile が保護対象と判断する状態である。
- ref の object ID が read 時から CAS 更新時まで変化していない。

いずれかが不成立なら、ref、worktree、local branch を変更せず `human_required` を返す。
旧形式では credential がまだ存在しないため、保護された互換入力の token と現在の Issue 専用
worktree・branch を検査する。成功時は token をローテーションし、新形式 payload と credential
へ一度で移行する。以後は旧 token を受理しない。

## 障害時の扱い

- GitHub API、fetch、push、credential が失敗した場合は成功として扱わず、既存 ref と worktree を
  変更しない。
- legacy payload の parse に失敗した場合は token を含む raw text をエラーへ連結せず、unknown
  legacy lease として `human_required` にする。
- Issue comment や label の更新失敗は正本ではないため lease の成否を変更しないが、token 非露出を
  守る presenter を必ず経由する。

## 完了条件と検証

AC-1〜AC-3 は Git/gh stub を用いる統合テストで、正常、CAS 競合、mismatch、各表示経路を
検証する。AC-4 は旧 commit subject を fixture で作り、token の absence を自動検査した上で、
実 GitHub ref に対する migrate/reclaim の実行手順を `VALIDATION.md` に残す。
