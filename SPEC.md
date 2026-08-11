<!--
このファイルはAGENTS.mdが定める4セグメント・4ゲートの規約に基づく雛形であり、Issue毎に複製して使う（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: gate-local-review.sh が共有 protected base worktree の HEAD を PR base_sha へ detach checkout することを要求し、並行Issue運用（wip_limit > 1）と実質的に両立しない

- Issue: `ISSUE-643`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/643-gate-local-review-shared-worktree-conflict`

## 目的・背景

`.agent-skill-chain/scripts/gate-local-review.sh` は、実行前提の一つとして「protected base
worktree（repository default branch をチェックアウトしている進行役の main worktree）の
HEAD が、対象 PR の `base_sha` と完全一致していること」を要求する。

しかし `base_sha` は PR 作成（更新）時点の default branch の SHA であるため、並行 Issue の
マージ等で default branch が前進すると、実行時点の HEAD が `base_sha` と一致しない状態が
常態化する。この条件を満たすには、進行役が全 Issue で共有する main worktree を過去コミット
（`base_sha`）へ一時的に detach checkout するしかなく、これは `wip_limit`（既定3）による
並行 Issue 運用と衝突する。detach 中は他 Issue の進行役操作（worktree 管理・レビュー実施
判断等）が safe に行えない状態になり得る。

本スクリプトはこの前提チェック直後に、自ら隔離 clone（`TRUSTED_ROOT`）を作成し
`base_sha` を detach checkout した上で、以降のレビュー実体（build・adapter起動・証跡生成）
をすべて隔離 clone 内で行っている。すなわち base source の同一性担保は隔離 clone 側で
既に実現されており、共有 worktree 側の HEAD が `base_sha` と一致していることはレビューの
実体には使われていない。この結果、実運用では「安全機構（前提チェック）が安全動作
（ゲートレビューの実施）自体の回避を誘発する」という逆転が実際に発生している
（由来: techbeansjp/chintainet-wp-theme Issue #55 の進行役記録）。

本 Issue は、protected-base 実行 attestation（Issue worktree／candidate code からの実行を
拒否し、default branch の信頼済み worktree からのみ実行されたことを担保する）という
目的を保ったまま、共有 protected base worktree の HEAD を動かすことなく
`gate-local-review.sh` を実行可能にすることを目的とする。

## 要求 → 要件 → 受入条件

### 要求

進行役は、並行して複数の Issue を進行中（`wip_limit` に基づく複数 worktree 運用下）でも、
共有 protected base worktree の HEAD を変更・占有することなく、対象 PR に対する
`gate-local-review.sh` によるローカル独立ゲートレビューを実行できなければならない。

### 要件

- `gate-local-review.sh` の実行前提チェックは、「共有 protected base worktree が
  Issue worktree／candidate code ではなく、repository default branch をチェックアウトした
  信頼済み worktree であること」を引き続き検証する。
- 実行前提チェックは、共有 protected base worktree の HEAD を `base_sha` に一時的にも
  変更することを要求しない。
- 実行前提チェックは、`base_sha` が default branch 上の到達可能な（過去または現在の）
  コミットであることを検証する。到達不能な `base_sha`（存在しない・改ざんされた・
  default branch の履歴に無いコミット）を指定した実行は拒否する。
- レビュー実体（隔離 clone の作成・build・adapter起動・証跡生成）は現行どおり
  `base_sha` を checkout した隔離 clone 内でのみ行う。この経路・safety propertyは
  変更しない。
- 実行前提チェックが緩和された後も、共有 protected base worktree が dirty である場合の
  拒否（未 commit の変更が隔離 clone へ意図せず混入することの防止）は維持する。
- 前提チェック失敗時のエラーメッセージは、operator に共有 worktree の detach checkout を
  促す内容（例: 現行の `expected=<base_sha>`）を含まない。緩和後の実際の失敗理由
  （例: 共有 worktree が default branch でない、`base_sha` が default branch から
  到達不能）を示す。
- 本修正は `gate-local-review.sh` が呼び出す隔離 clone 生成・build・adapter起動・
  trusted recorder への証跡投稿の既存ロジック（`TRUSTED_ROOT` 作成、`origin` remote 除去、
  `ASC_TRUSTED_BASE_SHA` 等の環境変数受け渡し）を変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: 共有 worktree の HEAD が base_sha と異なっていても実行できる

- Given: 進行役の protected base worktree（repository default branch をチェックアウト済み、
  かつ clean）の HEAD が、対象 PR の `base_sha` より新しいコミットを指している
  （並行 Issue のマージにより default branch が前進した状態）。かつ `base_sha` は
  default branch 上で到達可能な過去コミットである。
- When: `gate-local-review.sh <issue> <gate> <profile> <target_sha> <base_sha> <pr> <adapter>`
  を実行する。
- Then: 実行前提チェックで拒否されず、隔離 clone が `base_sha` を checkout して以降の
  レビュー処理（build・adapter起動）へ進む。共有 protected base worktree の HEAD は
  実行前後で変化しない。
- 検証方法見込み: `automated`

#### AC-2: 共有 worktree が default branch の worktree でない場合は拒否する

- Given: 実行時の `REPO_ROOT`（`gate-local-review.sh` が解決する対象 worktree）が
  repository default branch をチェックアウトした worktree ではない
  （Issue worktree や candidate code から実行しようとしている、または worktree root が
  想定と異なる）。
- When: `gate-local-review.sh` を実行する。
- Then: 実行前提チェックで拒否され、隔離 clone の作成・レビュー実体の起動は行われない。
  エラーメッセージは worktree が default branch のものでないことを示す。
- 検証方法見込み: `automated`

#### AC-3: base_sha が default branch から到達不能な場合は拒否する

- Given: 共有 protected base worktree は default branch をチェックアウトした clean な状態
  である。指定された `base_sha` が、その worktree の default branch 履歴上に存在しない
  （到達不能な）コミットである。
- When: `gate-local-review.sh` を実行する。
- Then: 実行前提チェックで拒否され、隔離 clone の作成・レビュー実体の起動は行われない。
  エラーメッセージは `base_sha` が default branch から到達不能であることを示す。
- 検証方法見込み: `automated`

#### AC-4: 共有 worktree が dirty な場合は引き続き拒否する

- Given: 共有 protected base worktree は default branch をチェックアウトしており、
  `base_sha` は到達可能なコミットであるが、worktree に未 commit の変更が存在する
  （`git status --porcelain` が非空）。
- When: `gate-local-review.sh` を実行する。
- Then: 実行前提チェックで拒否され、"protected base worktreeがdirtyです" 相当の
  エラーメッセージを出力する。隔離 clone の作成・レビュー実体の起動は行われない。
- 検証方法見込み: `automated`

#### AC-5: レビュー実体は引き続き base_sha を checkout した隔離 clone 内でのみ行われる

- Given: AC-1 の前提（共有 worktree の HEAD が `base_sha` と異なる、かつ実行前提を満たす）
  が成立している。
- When: `gate-local-review.sh` を実行する。
- Then: 隔離 clone（`TRUSTED_ROOT` 相当）が `base_sha` を detach checkout し、`origin`
  remote を持たない状態で build・adapter起動・証跡生成が行われる。共有 protected base
  worktree の内容・HEAD・remote 設定は実行前後で変化しない。
- 検証方法見込み: `automated`

#### AC-6: エラーメッセージが共有 worktree の detach checkout を促さない

- Given: AC-2 または AC-3 の拒否条件が成立している。
- When: `gate-local-review.sh` を実行する。
- Then: 出力されるエラーメッセージに、共有 protected base worktree を `base_sha` へ
  detach checkout するよう促す文言（現行の `expected=<base_sha>` 形式を含む）は
  含まれない。
- 検証方法見込み: `manual`

## スコープ外

- `gate-local-review.sh` が呼び出す隔離 clone 生成後の build・adapter起動・trusted
  recorder への証跡投稿ロジック自体の変更。
- protected-base 実行 attestation の仕組み自体の再設計（本 Issue は既存 attestation の
  目的を保った上での前提条件緩和のみを扱う）。
- `wip_limit` の既定値変更や、writer lease・worktree 管理ロジックの変更。
- GitHub モードにおける I2（セグメントゲート）の自動 CI 強制化。本 Issue は進行役が
  手動起動する `gate-local-review.sh` の実行可否条件のみを扱う。
- 「または、スクリプト自身が一時的な専用 base worktree を作成・使用・削除する」という
  Issue 本文中の代替案（`git worktree add --detach` 方式）の採用可否判断。本 SPEC は
  「共有 worktree の HEAD 変更を不要にする」という受入条件（AC-1〜AC-6）のみを規定し、
  実現方式（前提チェック緩和 vs. 専用一時 worktree）の選択は DESIGN.md で確定する。
