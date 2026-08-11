<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: root-cleanup runを永続main worktreeから直接実行すると実行後に一時ブランチのまま取り残されmainへ戻らない

- Issue: `ISSUE-619`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/619-root-cleanup-branch-restore`

## 目的・背景

`agent-skill-chain root-cleanup run` は、repoRoot直下に混入したIssueセグメント成果物（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`）を検出し、短命な作業用ブランチを作成してそれらを削除・commit・push・PR作成・admin mergeまでを自動実行するコマンドである。想定される実行環境は `.github/workflows/agent-skill-chain-root-cleanup.yml` のCIランナー（実行ごとに使い捨てられるcheckout）だが、進行役が調整状態を直接操作する永続的なmain worktree（人間・エージェントが継続して利用するローカル作業ツリー）から直接実行することもできる。

永続main worktreeから直接実行した場合、コマンド完了後もチェックアウト中のブランチが作業用の一時ブランチ（`chore/root-cleanup-<timestamp>` 形式）のままとなり、実行前にチェックアウトしていたブランチ（多くの場合 `main` などのdefault branch）へ戻らない。

AGENTS.mdが定めるGitHub Coordination Backendの各種コマンド（例: `pr merge`）は「repoRootはmain worktreeであり、default branchをチェックアウトしている」ことを前提として動作するものが存在する。この前提が `root-cleanup run` の直接実行によって崩されると、後続のコマンド・操作（例: `main` への `--ff-only` な追従取得）が失敗するなど、永続main worktreeを使う進行役の実務に実害が生じる。本Issueは、コマンド完了後に実行前のブランチへ確実に戻る動作を要求する。

## 要求 → 要件 → 受入条件

### 要求

`agent-skill-chain root-cleanup run` を永続的なmain worktree（人間・進行役が継続利用し、実行前後でチェックアウト状態が保持され続けるworktree）から直接実行しても、実行後にworktreeのチェックアウト状態が実行前と一致していること。使い捨てcheckout（CIランナー）で実行した場合の既存の完了後の振る舞い（PRが作成・admin mergeされ、コマンドが成功終了コードで完了すること）に回帰がないこと。

### 要件

- コマンドは実行開始時点でチェックアウトされていたブランチを記録する。
- コマンドが作業用の一時ブランチへチェックアウトを切り替えた場合、そのコマンド呼び出しの終了（正常終了・異常終了を問わない、コマンドプロセスが `root-cleanup run` の呼び出し元へ制御を返す時点）までに、記録しておいた実行前のブランチへチェックアウトを戻す。
- 実行開始時点で作業用の一時ブランチへの切り替えが一度も発生しなかった場合（例: 削除対象ファイルが0件のno-op終了、または既存のOPENな一時ブランチ・PRをそのまま再利用し新規チェックアウトを行わなかった場合）は、チェックアウト状態を変更しない。
- ブランチの復元処理自体が失敗した場合は、コマンドをエラー終了させ、標準エラー出力へ復元に失敗した旨と現在チェックアウトされているブランチ名を含める。復元失敗を握りつぶして成功として終了しない。
- 実行前にチェックアウトしていたのがブランチではない状態（例: detached HEAD）であった場合は、完了後も同じcommitへのdetached HEADへ戻す。

### 受入条件（Acceptance Criteria）

#### AC-1: mainをチェックアウト中に実行し、削除対象が存在する場合、完了後にmainへ戻る

- Given: 永続worktreeで `main`（default branch）をチェックアウトしており、repoRoot直下に削除対象ファイル（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`のいずれか1件以上）が存在する
- When: `agent-skill-chain root-cleanup run` を実行し、コマンドが正常終了する
- Then: コマンド終了後、worktreeのチェックアウト中ブランチが `main` に戻っている（一時ブランチ `chore/root-cleanup-<timestamp>` のままになっていない）
- 検証方法見込み: `automated`

#### AC-2: main以外のブランチをチェックアウト中に実行した場合、完了後に元のブランチへ戻る

- Given: 永続worktreeで `main` 以外の任意のブランチ（例: 進行役が作業中の別ブランチ）をチェックアウトしており、repoRoot直下に削除対象ファイルが1件以上存在する
- When: `agent-skill-chain root-cleanup run` を実行し、コマンドが正常終了する
- Then: コマンド終了後、worktreeのチェックアウト中ブランチが実行前と同じブランチに戻っている
- 検証方法見込み: `automated`

#### AC-3: 削除対象が0件のno-opの場合、チェックアウト状態が変化しない

- Given: repoRoot直下に削除対象ファイルが1件も存在しない
- When: `agent-skill-chain root-cleanup run` を実行し、no-opとして正常終了する
- Then: コマンド実行前後でチェックアウト中のブランチが変化していない（新規ブランチの作成・チェックアウト切り替えが一切発生していない）
- 検証方法見込み: `automated`

#### AC-4: 既存のOPENな一時ブランチ・PRを再利用する場合、チェックアウト状態が変化しない

- Given: 既に他プロセス・過去の実行によってOPENな `chore/root-cleanup-<timestamp>` ブランチとそのPRが存在し、スコープ検査を通過する状態である。実行worktreeは新規チェックアウトを行わずにその既存ブランチ・PR情報のみを参照してマージ処理へ進む
- When: `agent-skill-chain root-cleanup run` を実行し、コマンドが正常終了する
- Then: コマンド終了後、worktreeのチェックアウト中ブランチが実行前から変化していない（このコマンド呼び出し自身は一度もチェックアウト切り替えを行っていないため）
- 検証方法見込み: `automated`

#### AC-5: commit・push・PR作成等の途中でコマンドが異常終了した場合も、チェックアウト状態が実行前へ戻る

- Given: 永続worktreeで `main` をチェックアウトしており、削除対象ファイルが1件以上存在し、一時ブランチへのチェックアウト切り替え後、完了前の何らかの処理（例: push・PR作成）が失敗する状況にある
- When: `agent-skill-chain root-cleanup run` を実行し、コマンドがエラー終了する
- Then: コマンドはエラー終了コードで終了し、かつ終了後のworktreeのチェックアウト中ブランチが実行前の `main` に戻っている
- 検証方法見込み: `automated`

#### AC-6: 使い捨てcheckout（CIランナー）から実行した場合の既存の完了後の振る舞いに回帰がない

- Given: CIランナーの使い捨てcheckoutのように、コマンド完了後にworktree自体が破棄され、以後チェックアウト状態を参照するプロセスが存在しない実行環境で、削除対象ファイルが1件以上存在する
- When: `agent-skill-chain root-cleanup run` を実行する
- Then: これまでと同様に、削除対象ファイルの検出・一時ブランチでのcommit・push・PR作成・スコープ検査・admin mergeが成功し、コマンドが成功終了コード・PR番号の標準出力で完了する（チェックアウト復元処理の追加によって、これらの既存の成功時の振る舞い・出力形式に回帰が生じない）
- 検証方法見込み: `automated`

## スコープ外

- `root-cleanup run` 以外のコマンド（`root-cleanup`の他サブコマンドが将来追加される場合を含む）のチェックアウト状態管理。
- CIランナーのworkflow定義（`.github/workflows/agent-skill-chain-root-cleanup.yml`）自体の変更。使い捨てcheckoutという実行環境の性質そのものは変更しない。
- 削除対象ファイル（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`）の検出条件・削除範囲・スコープ検査ロジック（ADR-0007で確定済みの既存仕様）の変更。
- 複数プロセス・複数worktreeが同一repoRootに対して同時に `root-cleanup run` を実行する場合の一般的な同時実行制御（本Issueはチェックアウト状態の復元のみを扱う）。
- worktree自体の作成・削除（`cleanup` コマンド等）や、writer leaseの取得・解放の仕組みの変更。
