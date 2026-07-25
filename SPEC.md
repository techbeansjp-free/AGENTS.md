# SPEC: release bump が package-lock.json 不在の consumer project で必ず失敗する

- Issue: `ISSUE-243`
- 作成者: `implementation worker`
- 対象ブランチ: `bugfix/243-release-bump-without-lockfile`

## 目的・背景

`release bump` は lockfile の更新を任意としている一方、commit 前の `git add` は常に lockfile を指定する。そのため lockfile を使わない consumer project の正当な版数更新が停止する。lockfile の有無に応じて、更新・stage・commit の対象を一致させる。

## 要求 → 要件 → 受入条件

### 要求

package-lock.json を採用しない consumer project でも、安全な release bump を完了できること。

### 要件

- lockfile が存在するときは package.json と lockfile の版数を更新して commit する。
- lockfile が存在しないときは package.json だけを stage・commit する。
- PR の許可ファイル集合と既存の admin merge 前スコープ検査を変更しない。
- 両方の構成を CLI 結合テストで成功として検証する。

### 受入条件（Acceptance Criteria）

#### AC-1: lockfile がある bump を維持する

- Given: package.json と package-lock.json がある consumer project
- When: `release bump <target>` を実行する
- Then: 両方の版数を target へ更新した commit と PR が作成され、既存のスコープ検査を通過する
- 検証方法見込み: `automated`

#### AC-2: lockfile がない bump を完了する

- Given: package.json のみがある consumer project
- When: `release bump <target>` を実行する
- Then: package.json のみを更新して commit・PR 作成・admin merge が成功し、lockfile の pathspec エラーにならない
- 検証方法見込み: `automated`

#### AC-3: scope safety を後退させない

- Given: bump PR が package.json と package-lock.json だけを変更する、または許可外ファイルを含む
- When: admin merge 前にスコープを検査する
- Then: 前者は lockfile の有無を問わず許可され、後者は `human_required` で停止する
- 検証方法見込み: `automated`

## スコープ外

- package-lock.json 以外の lockfile の新規対応
- release bump の版数決定、PR 再利用、admin merge 方針の変更
- 既存 consumer project への lockfile 追加・削除

## 制約・完了条件・未決事項

実装は既存の `writeBumpedVersionFiles` と同じ存在判定を stage 対象にも用い、許可ファイル集合を広げない。全単体・結合テスト、型検査、対象範囲の CI 検査が成功したら完了とする。未決事項はない。
