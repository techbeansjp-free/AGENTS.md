# ADR

```yaml
id: ADR-0074
status: accepted
title: 証跡記録処理のbase一致要求を到達可能性へ緩め、公開済みHEADの追加検証に代えて入力の供給元をコミットのツリーへ固定する
tags: [gate-review, evidence, trust-boundary, recorder]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

GitHub モードの証跡記録処理（`agent-skill-chain gate submit-evidence`）は、GitHub PR review へ証跡を投稿する前に、記録実行 worktree（進行役が repository default branch を checkout して共有する main worktree）が審査対象に汚染されていないことを検査する。この検査は「記録実行 worktree の HEAD が trusted base SHA と完全一致すること」を要求し、同時に trusted base SHA を GitHub が返す PR の `base.sha` に固定していた。

PR の `base.sha` は当該 PR の ref が最後に更新された時点で固定され、default branch の前進に追随しない。一方 default branch の先端は PR がマージされるたびに前進する（本リポジトリではリリース bump がさらに 1 コミット積む）。したがって 1 本マージした瞬間に、他のすべての open PR で上記 2 条件が同時に成立しなくなり、証跡投稿が停止する。回復には open PR ごとの `update-branch` と各 worktree の同期が必要で、`update-branch` は head SHA を変えるため直前の判定を無効化し、競合時は HTTP 422 で失敗する。既定の並行数（`wip.limit` = 3）を前提とする以上、これは例外ではなく既定運用で必ず起きる退化である。

起動スクリプト側では同種の完全一致要求が既に「default branch を checkout していること」と「base SHA が HEAD から到達可能であること」の 2 条件へ置き換えられており、記録側だけが完全一致のまま取り残されていた。

完全一致の撤廃は、単なる利便性の問題ではなく信頼境界に触れる。記録処理の入力のうち review policy とその検証スキーマは、コミットではなく記録実行 worktree の作業ツリーから読まれていた。完全一致と clean 検査の組み合わせは、これらの内容を GitHub が attest したコミットのツリーへ transitively 固定していた。完全一致を緩めると、HEAD に任意の子孫コミットを置けるためこの固定が失われ、review policy を記録実行側から差し替えてコアレビュー要否や要求 profile を引き下げる経路が開く。

失われる固定を作り直す代替案として、記録実行 worktree の HEAD が公開済み（GitHub 上の default branch 履歴に含まれる）であることを追加検証する案を検討したが採用しない。この検査は証跡投稿ごとに GitHub への追加問い合わせを要し、応答を得られないときに投稿が止まる新たな停止条件を作る。停止条件の除去こそが本決定の目的であり、目的に反する。ローカルの remote-tracking ref からの到達可能性で公開済みを判定する案も、記録実行 worktree が Issue worktree と ref store を共有し、同じリポジトリで動作する任意のプロセスがローカル ref を更新できるため、審査対象から独立した根拠にならない。作業ツリーからの読み取りを無くせば、固定を作り直す必要そのものが消える。

## Decision

証跡記録処理の受理条件と入力の供給元を次のとおり定める。

1. 「記録実行 worktree の HEAD が trusted base SHA と完全一致すること」の要求を廃し、次の 2 条件の連言へ置き換える。(a) 記録実行 worktree が、GitHub が返す repository default branch 名と一致するブランチを checkout していること（detached HEAD は不一致として扱う）。(b) trusted base SHA が記録実行 worktree の HEAD から到達可能（祖先または同一）であること。当該コミットの Git object が無い場合も到達不能として扱う。
2. 記録実行 worktree の HEAD が公開済みであることの追加検証は行わない。決定 4 により記録処理は作業ツリーからファイルを読まないため、HEAD に置かれたコミットは記録処理の入力・判定・証跡の内容に影響しない。
3. trusted base SHA は GitHub が返す PR の `base.sha` に固定し続ける。差分基点と trusted base SHA は単一の値として扱い、両者を互いに比較するのではなく、双方が当該 PR の `base.sha` と一致することを 1 つの検査で確認する。記録処理は差分基点・PR metadata 照合・launcher digest 算出・review policy の読み取り・証跡記録のすべてに同一の値を用い、証跡は両者を別フィールドとして持たない。
4. 記録処理が読む入力の供給元をコミットのツリーへ固定する。承認対象成果物の経路集合とコアレビュー要否分類の対象経路は差分基点と target SHA の三点差分から、各成果物の内容・digest は target SHA のツリーから、review policy とその検証スキーマおよび launcher 構成の digest は trusted base SHA のツリーから読む。記録実行 worktree の作業ツリーはいずれの入力の供給元にもしない。記録処理は Coordination Backend を GitHub 固定として扱い、設定ファイルを作業ツリーから読まない。
5. 拒否は原因ごとに区別できる日本語メッセージを提示し、到達不能を理由とする拒否は記録実行 worktree の取得と早送りを促す。`update-branch` の実行を促さない。
6. 起動スクリプトの受理条件・実行内容、証跡スキーマ、各記録値の意味は変更しない。記録処理以外の経路（証跡検証・ゲート集約・レビュアプロンプト生成）の入力読み取りも変更しない。

## Consequences

- default branch が前進しても、記録実行 worktree の HEAD が先端より古いまま証跡を投稿できる。1 本マージするたびに他の open PR へ `update-branch` を打ち、各 worktree を同期する定型手順と、それに伴う判定のやり直し・競合解消の委譲が不要になる。
- 記録処理が読む値は、HEAD にどのコミットが置かれていても変更前と同一（trusted base SHA および target SHA のツリーの内容）になる。完全一致検査が transitively 与えていた固定は、検査ではなく読み取り経路そのものによって恒等的に成立するため、信頼境界は緩まない。
- GitHub API 呼び出しは増えない。公開済み判定のための問い合わせを行わないため、証跡投稿が GitHub 側の障害・レート制限で新たに止まることはない。
- 記録実行 worktree に未 push のローカルコミットがある状態は拒否されない。当該状態は default branch への変更を PR 経由に限る不変条件 I4 に反するが、記録処理の出力を汚染しないため本決定では検出しない。検出が必要になった場合は、記録処理の受理条件ではなく worktree の運用側で扱う。
- 拒否理由は 5 原因に整理され、進行役の是正操作は「記録実行 worktree 自身の checkout・取得・早送り」へ一本化される。open PR 側への操作を伴う是正は残らない。
- 証跡のスキーマと記録値の意味を変えないため、本決定の適用前に投稿された証跡は適用後も同じ手順で再検証でき、適用中に投稿された証跡は revert 後も検証できる。
- 記録処理以外の経路は引き続き review policy・設定を作業ツリーから読む。それらの経路の供給元をどう扱うかは本決定の範囲外であり、必要が生じた時点で別途判断する。
