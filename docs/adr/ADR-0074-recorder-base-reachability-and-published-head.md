# ADR

```yaml
id: ADR-0074
status: proposed
title: 証跡記録処理のbase一致要求を到達可能性へ緩め、記録実行worktreeのHEADはGitHub応答で公開済みと判定する
tags: [gate-review, evidence, trust-boundary, recorder]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

GitHub モードの証跡記録処理（`agent-skill-chain gate submit-evidence`）は、GitHub PR review へ証跡を投稿する前に、記録実行 worktree（進行役が repository default branch を checkout して共有する main worktree）が審査対象に汚染されていないことを検査する。この検査は「記録実行 worktree の HEAD が trusted base SHA と完全一致すること」を要求し、同時に trusted base SHA を GitHub が返す PR の `base.sha` に固定していた。

PR の `base.sha` は当該 PR の ref が最後に更新された時点で固定され、default branch の前進に追随しない。一方 default branch の先端は PR がマージされるたびに前進する（本リポジトリではリリース bump がさらに 1 コミット積む）。したがって 1 本マージした瞬間に、他のすべての open PR で上記 2 条件が同時に成立しなくなり、証跡投稿が停止する。回復には open PR ごとの `update-branch` と各 worktree の同期が必要で、`update-branch` は head SHA を変えるため直前の判定を無効化し、競合時は HTTP 422 で失敗する。既定の並行数（`wip.limit` = 3）を前提とする以上、これは例外ではなく既定運用で必ず起きる退化である。

起動スクリプト側では同種の完全一致要求が既に「default branch を checkout していること」と「base SHA が HEAD から到達可能であること」の 2 条件へ置き換えられており、記録側だけが完全一致のまま取り残されていた。

完全一致の撤廃は、単なる利便性の問題ではなく信頼境界に触れる。記録処理の入力のうち review policy・設定・light review scaffold は、コミットではなく記録実行 worktree の作業ツリーから読まれる。完全一致と clean 検査の組み合わせは、これらの内容を GitHub が attest したコミットのツリーへ transitively 固定していた。完全一致を緩めると、HEAD に任意の子孫コミットを置けるためこの固定が失われ、review policy を記録実行側から差し替えてコアレビュー要否や要求 profile を引き下げる経路が開く。

代替として、ローカルの remote-tracking ref（`refs/remotes/origin/<default branch>`）からの到達可能性で「公開済み」を判定する案を検討したが採用しない。記録実行 worktree は Issue worktree と ref store を共有しており、同じリポジトリで動作する任意のプロセスがローカル ref を更新できるため、審査対象から独立した根拠にならない。ローカルに取得済みの default branch 先端コミットを根拠とする案も採用しない。他者のマージ直後は当該コミットが未取得となり、判定不能による停止が毎回のマージごとに再発して本 Issue の目的を損なう。

## Decision

証跡記録処理の受理条件を次のとおり定める。

1. 「記録実行 worktree の HEAD が trusted base SHA と完全一致すること」の要求を廃し、次の 3 条件の連言へ置き換える。(a) 記録実行 worktree が、GitHub が返す repository default branch 名と一致するブランチを checkout していること（detached HEAD は不一致として扱う）。(b) trusted base SHA が記録実行 worktree の HEAD から到達可能（祖先または同一）であること。当該コミットの Git object が無い場合も到達不能として扱う。(c) 記録実行 worktree の HEAD が公開済みであること。
2. (c) の判定根拠は、GitHub の commit 比較エンドポイントへ HEAD SHA と default branch 名を与えた応答のみとする。応答の関係が「同一」または「default branch が HEAD より進んでいる」ときに公開済みと判定する。記録実行 worktree のローカル ref・ローカル object・環境変数・引数を判定根拠に用いない。応答を得られない場合は公開済みと判定せず拒否する。
3. trusted base SHA は GitHub が返す PR の `base.sha` に固定し続ける。差分基点と trusted base SHA は単一の値として扱い、記録処理は受理判定の先頭で両者の同一性を検査したうえで、差分基点・PR metadata 照合・launcher digest 算出・証跡記録のすべてに同一の値を用いる。証跡は両者を別フィールドとして持たない。
4. 記録処理が読む入力の供給元ツリーを固定する。承認対象成果物の経路集合とコアレビュー要否分類は差分基点と target SHA の三点差分から、各成果物の内容・digest は target SHA のツリーから、launcher 構成の digest は trusted base SHA のツリーから読む。記録実行 worktree の作業ツリーは、これらいずれの供給元にもしない。
5. 拒否は原因ごとに区別できる日本語メッセージを提示し、到達不能を理由とする拒否は記録実行 worktree の取得と早送りを促す。`update-branch` の実行を促さない。
6. 起動スクリプトの受理条件・実行内容、証跡スキーマ、各記録値の意味は変更しない。

## Consequences

- default branch が前進しても、記録実行 worktree の HEAD が先端より古いまま証跡を投稿できる。1 本マージするたびに他の open PR へ `update-branch` を打ち、各 worktree を同期する定型手順と、それに伴う判定のやり直し・競合解消の委譲が不要になる。
- 未 push のローカルコミットを含む HEAD からの投稿は受理されない。この拒否はローカル ref の書き換えでは回避できない。記録実行 worktree に未 push のコミットがある状態は、default branch への変更を PR 経由に限る不変条件 I4 に反する状態であり、拒否が正しい。
- 証跡投稿ごとに GitHub API 呼び出しが 1 つ増える。GitHub へ到達できない場合は投稿せず非0終了する（fail-closed）。レビュア判定は隔離 clone 内で完了しているため、失敗時に失われるのは当該実行 1 回分の投稿のみで、再実行で回復する。
- 拒否理由が増え、進行役の是正操作は「記録実行 worktree 自身の checkout・取得・早送り」へ一本化される。open PR 側への操作を伴う是正は残らない。
- 証跡のスキーマと記録値の意味を変えないため、本決定の適用前に投稿された証跡は適用後も同じ手順で再検証でき、適用中に投稿された証跡は revert 後も検証できる。
- review policy・設定を作業ツリーから読む構造自体は残る。その由来は公開済み HEAD 検査によって GitHub 上の default branch 履歴へ固定されるが、供給元を GitHub 応答へ移す変更は本決定の範囲外であり、必要が生じた時点で別途判断する。
