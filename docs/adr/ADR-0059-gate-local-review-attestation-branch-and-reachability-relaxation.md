# ADR

```yaml
id: ADR-0059
status: proposed
title: gate-local-review.shのprotected base attestationをHEAD完全一致からdefault branch到達可能性判定へ緩和する
tags: [gate-review, protected-base, attestation, worktree]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/gate-local-review.sh` は、レビュー実体（隔離clone作成・build・adapter起動・trusted recorderへの証跡投稿）を開始する前提として、共有 protected base worktree（進行役が全Issueで共有する、repository default branchをチェックアウトしたmain worktree）が「Issue worktree／candidate codeではなく信頼済みの実行環境であること」を検証するattestationを持つ。

このattestationはこれまで、共有worktreeのHEADが対象PRの`base_sha`と完全一致することを要求してきた。しかし`base_sha`はPR作成（更新）時点のdefault branchのSHAであり、並行Issueのマージにより共有worktreeのHEADは前進し続けるため（`.agent-skill-chain/standards/GIT_CONVENTIONS.md`が定める`agent-skill-chain pr merge`のfetch+fast-forward自動同期による）、実行時点でHEAD一致条件が成立しない状態が常態化する。この条件を満たすには、進行役が全Issueで共有するmain worktreeを過去コミット（`base_sha`）へ一時的にdetach checkoutするしかなく、これは`wip_limit`（既定3）による並行Issue運用と衝突する。実運用では、この前提条件を満たせないためにゲートレビューの実施自体が見送られる事例が確認されている（由来: ISSUE-643、techbeansjp/chintainet-wp-theme Issue #55の進行役記録）。

一方で本スクリプトはこの前提チェック直後に、自ら隔離clone（`TRUSTED_ROOT`）を作成し`base_sha`をdetach checkoutした上で、以降のレビュー実体をすべて隔離clone内で行っている。base sourceの同一性担保は隔離clone側で既に実現されており、共有worktree側のHEADが`base_sha`と一致していることはレビューの実体には使われていない。

## Decision

`gate-local-review.sh` の前提チェックにおける「共有 protected base worktree の信頼性」判定を、次の2条件へ置き換える。

1. 共有worktree（`REPO_ROOT`）が、repository default branch（GitHub APIから取得した`default_branch`）をチェックアウトしていること（`git symbolic-ref --quiet --short HEAD` と比較。detached HEAD・Issue branchは不一致として拒否）。
2. 対象PRの`base_sha`が、共有worktreeのHEADから見て到達可能な（祖先である）コミットであること（`git merge-base --is-ancestor "$BASE_SHA" HEAD`）。

worktree root一致判定（既存）と、共有worktreeがdirty（未commitの変更を持つ）場合の拒否（既存）はそのまま維持する。共有worktreeのHEADを`base_sha`へ一時的にでも変更することは要求しない。レビュー実体（隔離cloneの作成・`base_sha`のdetach checkout・build・adapter起動・trusted recorderへの証跡投稿）は、この判定の変更によらず現行の隔離clone内実行を継続する。

代替案として、本スクリプト自身が`git worktree add --detach <一時パス> "$base_sha"`で専用の一時base worktreeを作成・使用・削除する方式も検討したが、採用しない。共有worktreeへ一切触れずに済む点は同等だが、（a）レビュー実体は既に独立した隔離clone（`TRUSTED_ROOT`）内で完結しており、追加のworktree層を設ける必然性がない、（b）一時worktreeの作成・削除は共有リポジトリのworktreeメタデータへの書込みを伴い、進行役のworktreeライフサイクル管理（`git worktree list --porcelain`を正本とする）と並行して実行された場合の競合を新たに生む、という理由から、既存の隔離clone機構をそのまま活かせる前提チェック緩和の方が変更範囲が小さく安全である。

## Consequences

- 進行役は、並行Issue運用下（`wip_limit`>1）で共有protected base worktreeのHEADを変更・占有することなく`gate-local-review.sh`を実行できるようになり、「安全機構が安全動作（ゲートレビューの実施）自体の回避を誘発する」という逆転が解消される。
- attestationの本質的目的（Issue worktree／candidate codeからの実行拒否、default branchの信頼済み経路からの実行担保）は、判定条件の入れ替え後も同等に満たされる。到達可能性判定により、存在しない・改ざんされた・default branchの履歴に無い`base_sha`を指定した実行は引き続き拒否される。
- 共有worktreeがPRマージ後の自動同期に失敗し、ローカルHEADが最新のdefault branch履歴（`base_sha`を含む）へ追従していない場合、到達可能性判定は安全側（fail-closed）に拒否側へ倒れる。運用対応は進行役が共有worktreeを`git pull --ff-only`等で最新化した上で再実行することであり、detach checkoutと異なりwip_limitに基づく並行Issue運用とは衝突しない。
- 前提チェック失敗時のエラーメッセージは、拒否理由（root不一致／default branch不一致／到達不能／dirty）のみを述べ、共有worktreeのdetach checkoutを促す文言（`expected=<base_sha>`形式を含む）を含まない。
