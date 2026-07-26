# ADR

```yaml
id: ADR-0014
status: proposed
title: 期限切れ writer lease の再開証明と token 非表示化
tags: [lease, resume, security, redaction]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

writer lease の token を commit subject と Issue comment に含める実装は、Git 履歴と可視 API 応答へ
認可子を複製する。さらに、dirty worktree に対応する期限切れ ref は正当に保護される一方、同じ
作業者が再開するための比較更新経路を持たない。

## Decision

lease ref の commit subject と Issue comment は token を含まない公開表現だけを使う。token は
lease ref の非表示 payload で管理し、公開表現を生成する関数は token にアクセスしない。
CLI は acquire 時に Git common directory 配下の Git 管理対象外ファイルへ token、holder、
Issue、segment、worktree、branch を mode `0600` で保存し、stdout には公開表現だけを返す。
renew と release はこの credential を暗黙に利用する。旧形式移行用の明示 token 入力は受理するが、
stdout と stderr へ値を含めない。

期限切れの dirty lease は、同一 Issue、segment、holder、専用 worktree、branch を検査した
resume proof を持つ作業者だけが object ID 比較更新で再開できる。検査不一致、legacy parse 失敗、
または CAS 競合は human_required とし、他作業者への自動移譲はしない。
resume 成功時は token をローテーションし、旧 token を再利用不能にする。ref 削除も検査時 SHA を
force-with-lease 条件にして、検査後に更新された lease を削除しない。

## Consequences

Git の commit subject、Issue comment、CLI logs から token が除去される。resume は安全な再開を
可能にするが、作業者は holder を安全に保持する必要がある。既存 legacy refs は token を表示せず、
再開時に新形式へ移行するか、clean 状態なら回収する。
ローカル credential を失った場合は自動再開せず human_required になる。GitHub credentialによる
ref操作権限だけでは、別 holder の dirty lease を自動取得できない。

## Alternatives considered

- 期限切れ ref を無条件に削除する: dirty worktree の未保存変更を別作業者が奪えるため不採用。
- token を hash 化して commit subject に残す: bearer token の複製と辞書攻撃の懸念を残すため不採用。
- Issue comment を lease 正本にする: GitHub backend の単一正本と原子的 CAS を失うため不採用。
