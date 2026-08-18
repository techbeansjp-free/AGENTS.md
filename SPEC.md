# SPEC: PRマージのたびに他のopen PRのゲートレビューがbase SHA不一致で停止する

- Issue: `ISSUE-703`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/703-merge-blocks-parallel-gates`

## 目的・背景

GitHub モードのゲートレビューは、進行役が repository default branch の worktree から起動スクリプト（`.agent-skill-chain/scripts/gate-local-review.sh`）を実行し、隔離 clone 内でビルドしたコードで read-only レビュアを起動し、その判定を証跡記録処理（`agent-skill-chain gate submit-evidence`）が GitHub PR review へ投稿する構成を取る。

この証跡記録処理は現在、次の2条件を同時に要求する。一つは、渡された trusted base SHA が GitHub の当該 PR metadata の `base.sha` と一致すること。もう一つは、記録実行 worktree の HEAD が trusted base SHA と完全一致することである。

GitHub の PR `base.sha` は、その PR の ref が最後に更新された時点の base branch 先端で固定され、base branch の前進に追随しない。一方 default branch の先端は PR がマージされるたびに前進する（本リポジトリではリリース bump のワークフローがさらに1コミット積むため、1回のマージで2コミット前進する）。したがって、ある PR をマージした瞬間に、他のすべての open PR について上記2条件が同時に成立しなくなり、`recorder HEADがtrusted base SHAと一致しません` で証跡投稿が停止する。

その結果、進行役は1件マージするたびに、残りの open PR すべてに対して `update-branch` API を叩き、新しい base SHA を取得し直し、各 worktree を同期する定型手順を人手で踏むことになる。`update-branch` は head SHA を変えるため直前のゲート判定が無効になり、base と head が競合する場合は HTTP 422 で失敗して writer lease を持つワーカーによる競合解消が必要になる。既定の `wip.limit` が 3 でありシステム自身が並行進行を前提としている以上、これは例外的な運用ではなく既定運用で必ず発生する退化である。

本Issueは、default branch が前進しただけでは他の open PR のゲートレビューが停止しないようにすることを目的とする。同時に、実行コードの由来を protected な default branch 上のコミットに限る信頼境界（不変条件 I5「進行役の純粋性」を機械的に支える機構）を一切緩めないことを保証する。

## 対象範囲

本SPECが仕様を定める対象は次に限る。

- 証跡記録処理（`gate submit-evidence`）が投稿前に行う、trusted base SHA・PR metadata・記録実行 worktree に関する受理条件と、その拒否理由の提示。
- 上記変更が、承認対象成果物集合の算出とコアレビュー要否分類の対象範囲に影響を与えないこと。
- 上記変更が、既存の証跡・既存の起動側挙動に回帰を生じさせないこと。

## 前提

- Coordination Backend は GitHub モードである。
- 進行役は repository default branch を checkout した worktree（Issue worktree ではない）から起動する。この worktree は tracked file が clean である。
- 対象 PR の base ref は repository default branch であり、対象 PR の head 側コミットは記録実行 worktree の object store に取得済みである。
- default branch は保護されており、変更は PR 経由でのみ入る。したがって GitHub が PR metadata として返す `base.sha` は、過去に default branch の先端であったコミットであり、審査対象ブランチが値を選べない。
- 差分の算出には三点差分（`base...target`。実体は `base` と `target` の merge-base を基点とする差分）を用いる。
- レビュアは read-only であり、証跡の投稿能力を持たない。

## 用語

本SPEC内で用いる語を次の意味に固定する。

- **記録実行 worktree**: 証跡記録処理が git 操作および GitHub API 呼び出しの基点として用いる作業ツリー。進行役の default branch worktree を指す。
- **trusted base SHA**: 隔離 clone が checkout し、起動スクリプト・CLI・adapter という実行コードの由来となるコミット。証跡の `execution.trusted_base_sha` に記録される。
- **PR base SHA**: GitHub が当該 PR の metadata として返す `base.sha`。
- **差分基点**: 承認対象成果物集合の算出とコアレビュー要否分類に用いる base 側コミット。
- **到達可能**: 対象コミットが指定コミットの祖先であるか、または同一であること。
- **変更前挙動**: 本Issueによる変更を適用する前の実装が示す挙動。

## 入力・出力

入力は、証跡記録処理へ与えられる target SHA・base SHA・trusted base SHA・PR 番号・profile・attempt 情報、GitHub が返す当該 PR および repository の metadata、記録実行 worktree の Git 状態である。出力は、受理時は GitHub PR review として投稿される証跡、拒否時は日本語の理由メッセージと非ゼロ終了である。

## 要求 → 要件 → 受入条件

### 要求

進行役が複数 Issue を並行して進めている状態で、ある PR をマージしても、他の open PR のゲートレビューがそれだけを理由に停止しないこと。停止回避のために `update-branch` を全 open PR へ打って回る定型手順と、それに伴うゲート判定のやり直し・競合解消の委譲を不要にすること。

同時に、実行コードの由来を protected な default branch 上のコミットに限る信頼境界を緩めないこと。審査対象ブランチの内容が記録処理の実行コードや読み取り対象へ混入する経路を新たに開かないこと。

### 要件

- 証跡記録処理は、記録実行 worktree の HEAD と trusted base SHA の完全一致を受理条件としない。代わりに、trusted base SHA が記録実行 worktree の HEAD から到達可能であることを受理条件とする。
- 証跡記録処理は、trusted base SHA が GitHub の当該 PR metadata の `base.sha` と一致すること、当該 PR の base ref が repository default branch であること、当該 PR の head SHA が target SHA と一致することを、引き続き受理条件として要求する。
- 証跡記録処理は、記録実行 worktree が repository default branch を checkout していることを、GitHub が返す default branch 名との一致によって独立に確認する。checkout 対象が default branch でない場合（detached HEAD を含む）は拒否する。
- 証跡記録処理は、Issue worktree からの実行の拒否と、記録実行 worktree の tracked file が clean であることの要求を維持する。
- 承認対象成果物集合とコアレビュー要否分類は、差分基点と target SHA の三点差分に基づいて算出する。記録実行 worktree の HEAD が差分基点より前進していても、算出結果は前進していない場合と同一とする。
- 拒否理由のメッセージは、(a) trusted base SHA が記録実行 worktree の HEAD から到達不能、(b) GitHub の PR metadata と指定値が不一致、(c) 記録実行 worktree が default branch を checkout していない、(d) Issue worktree からの実行、(e) tracked file が dirty、の5つを区別し、進行役が次に取るべき操作を日本語で示す。とくに (a) は default branch worktree の更新（取得と早送り）を促し、`update-branch` を促すものであってはならない。
- 証跡のスキーマと各記録値の意味を変更しない。本変更の適用前に投稿された証跡の再検証は、適用後も引き続き成立する。
- 起動スクリプトの受理条件・実行内容を変更しない。隔離 clone が trusted base SHA を checkout して実行コードを構築すること、default branch の先端が trusted base SHA より前進していても起動が成立すること、default branch から到達不能な base SHA を隔離 clone 作成前に拒否することは、いずれも変更前挙動のままとする。

### 制約

- 一致検査の撤廃、および審査対象ブランチが値を選べる形の base 指定を許容してはならない。緩和は「完全一致から到達可能性へ」の1点に限る。
- 実行コードの由来は、GitHub が PR metadata として attest した default branch 上のコミットに限る。
- スキーマ変更・migration を発生させない。

### 完了条件

全 AC が、追加または更新された自動テストの表明、もしくは変更差分そのものの読解によって確認できること。

### 受入条件（Acceptance Criteria）

#### AC-1: default branch先端が前進していても証跡投稿が成立する

- Given: GitHub モード、記録実行 worktree が repository default branch を checkout し tracked file が clean で、その HEAD が対象 PR の `base.sha` より後の default branch コミットであり、`base.sha` が HEAD から到達可能である状態
- When: 当該 PR の `base.sha` を base SHA および trusted base SHA として証跡記録処理を実行する
- Then: base SHA と HEAD の不一致を理由に拒否されず、GitHub PR review として証跡が投稿される
- 検証方法見込み: `automated`

#### AC-2: 判定対象がdefault branchの前進で変化しない

- Given: 同一の差分基点と target SHA に対し、記録実行 worktree の HEAD が差分基点と一致する場合と、差分基点より前進している場合の2構成
- When: それぞれの構成で承認対象成果物集合とコアレビュー要否分類を算出する
- Then: 2構成の算出結果が一致する。前進した側で、差分基点より後の default branch コミットが変更した経路が対象へ加わらない
- 検証方法見込み: `automated`

#### AC-3: HEADから到達不能なtrusted baseは拒否される

- Given: 指定された trusted base SHA が記録実行 worktree の HEAD から到達不能である状態（記録実行 worktree が当該コミットをまだ取得していない場合、および当該コミットが default branch の履歴に無い場合を含む）
- When: 証跡記録処理を実行する
- Then: 証跡を投稿せず非ゼロ終了し、到達不能である旨と default branch worktree の更新を促す日本語メッセージを出力する
- 検証方法見込み: `automated`

#### AC-4: GitHub PR metadataとの結線が維持される

- Given: 次の3構成——(a) 指定 base SHA が当該 PR の `base.sha` と一致しない、(b) 当該 PR の base ref が repository default branch でない、(c) 当該 PR の head SHA が指定 target SHA と一致しない
- When: それぞれの構成で証跡記録処理を実行する
- Then: 3構成すべてで証跡を投稿せず非ゼロ終了し、PR metadata との不一致である旨の日本語メッセージを出力する
- 検証方法見込み: `automated`

#### AC-5: default branchを離れた記録実行worktreeは拒否される

- Given: 記録実行 worktree が repository default branch 以外のブランチを checkout している構成、および detached HEAD である構成の2つ。いずれも指定 trusted base SHA は HEAD から到達可能である
- When: それぞれの構成で証跡記録処理を実行する
- Then: 2構成とも証跡を投稿せず非ゼロ終了し、default branch worktree から実行する必要がある旨の日本語メッセージを出力する
- 検証方法見込み: `automated`

#### AC-6: Issue worktreeからの実行とdirtyな記録実行worktreeは引き続き拒否される

- Given: 次の2構成——(a) Issue worktree から証跡記録処理を実行する、(b) 記録実行 worktree の tracked file が改変されている。いずれも指定 trusted base SHA は HEAD から到達可能である
- When: それぞれの構成で証跡記録処理を実行する
- Then: 2構成とも変更前挙動と同じく証跡を投稿せず非ゼロ終了する
- 検証方法見込み: `automated`

#### AC-7: 拒否理由が原因ごとに区別でき、取るべき操作を示す

- Given: AC-3・AC-4・AC-5・AC-6 が定める5つの拒否原因
- When: それぞれの原因で証跡記録処理が拒否する
- Then: 5つの原因に対して相互に区別できる日本語メッセージが出力され、いずれも進行役が次に取るべき操作を含む。到達不能を理由とするメッセージは `update-branch` の実行を促さない
- 検証方法見込み: `hybrid`

#### AC-8: 既存証跡の再検証が引き続き成立する

- Given: 本変更の適用前に投稿された、`execution.trusted_base_sha` が当時の PR `base.sha` と一致する既存証跡
- When: 変更適用後の実装で当該証跡を再検証する
- Then: 変更前と同じく有効な証跡として扱われる。証跡スキーマおよび各記録値の意味は変更されていない
- 検証方法見込み: `automated`

#### AC-9: 起動側の挙動が変わらない

- Given: 起動スクリプトを実行する既存の3構成——default branch 先端が指定 base SHA より前進している、記録実行 worktree が default branch でない、指定 base SHA が default branch から到達不能である
- When: それぞれの構成で起動スクリプトを実行する
- Then: 3構成とも変更前挙動と一致する。すなわち1つ目は指定 base SHA の隔離 clone で実行して成功し、残り2つは隔離 clone を作成する前に拒否する
- 検証方法見込み: `automated`

## スコープ外

- マージ前に必要な `update-branch` の実行そのもの。本リポジトリの ruleset は必須チェックの最新性（`strict_required_status_checks_policy`）を要求するため、マージ直前の最新化は引き続き必要である。本Issueが取り除くのはゲートレビュー実行のために強いられる最新化であり、マージ要件は変更しない。したがって「最新化後に CI の再実行を待つ必要があるか」の検討も、マージ要件側の課題として本Issueでは扱わない。
- `update-branch` が競合で失敗する場合の自動解消。競合解消は成果物の変更であり、writer lease を持つセグメント作業ワーカーの責務である。
- `wip.limit` の既定値の見直し。
- ローカルモードのゲート記録経路。本Issueが扱う受理条件は GitHub モードの証跡記録処理にのみ存在する。
- ワーカー終了後の writer lease 残存（別Issue）。
- 証跡スキーマの拡張（差分基点と trusted base を別フィールドとして記録することを含む）。本Issueは両者が同値である現行の記録形式を維持する。

## 未決事項

- 記録実行 worktree の HEAD が、GitHub が返す default branch の現在の先端そのものから到達可能であることまで追加検証するかは、設計セグメントで判断する。追加検証は未 push のローカルコミットを排除できる一方、記録実行 worktree が当該先端を未取得の場合に新たな停止条件を作り得るため、本SPECでは要件として固定しない。
