# SPEC: release bump の既存ブランチ再利用が、複数PR連続マージ時に main 基準で内容を作り直さずマージ不能なコンフリクトを生む

- Issue: `ISSUE-228`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/228-release-bump-stale-branch-rebuild`

## 目的・背景

`agent-skill-chain release bump`（`src/commands/release.ts` の `bump()`。`.agent-skill-chain/scripts/release-bump.sh` 経由で `agent-skill-chain / release` ワークフローが呼び出す）は、リリース版数を上げる `package.json` / `package-lock.json` の変更を `release/bump-v<target>` ブランチ・PR として作成し、`gh pr merge --admin --squash` で main へ反映する。

現行実装は、`release/bump-v<target>` ブランチが既にリモートに存在する場合、その中身を一切更新せず（版数ファイルの再生成ブロックを丸ごとスキップし）、`gh pr merge --admin` のみを再試行する。この「再試行すれば直る」という前提は、実行1回目と2回目の間で main の内容が変化していない一時的な API レース（例: GraphQL "Base branch was modified"）にのみ有効であり、main の内容自体が進んだケースには対処できない。

そのため、短時間に複数の PR が main へ連続マージされると、既存 bump ブランチが古い main を基準にした内容のまま取り残され、実際のマージコンフリクトを起こして PR がマージできなくなる。2026-07-24 に実際に発生した障害では、当時の main（version `0.2.5`）を基準に `release/bump-v0.2.7` ブランチが `0.2.5→0.2.7` の差分で作成された後、別経路で main が `0.2.6` へ進んだ。既存ブランチは更新されず PR は `0.2.5→0.2.7` のままとなり、`package.json` / `package-lock.json` の同一行で実質的なコンフリクトが生じ、`gh pr merge --admin` が "the merge commit cannot be cleanly created" で失敗し続けた。進行役が手動で当該ブランチを現行 main（`0.2.6`）基準へ作り直し（`git reset --hard origin/main` 後に `0.2.6→0.2.7` を再生成）、force push してから admin merge することで初めて解消した。本 Issue はこの構造的欠陥を是正し、`release bump` がどのような呼ばれ方をしても常に正しい差分でマージを試みるようにする。

## 要求 → 要件 → 受入条件

### 要求

リリース自動化の運用者・進行役として、複数の PR（例: Dependabot PR の連続マージ）が短時間に main へマージされる状況でも、`release bump` が人手の介入なしに正しくリリース版数 PR をマージできること。既存 bump ブランチが古い main を基準に取り残されたことで解決不能なコンフリクトを起こし、進行役の手動作り直しを要求する現状を解消したい。

### 要件

- 既存 `release/bump-v<target>` ブランチが存在する場合、その内容が現在の main を基準にしているかを検知する（main がブランチ作成後に進んでいる＝ベースが乖離しているかを判定する）。
- ベースが乖離している場合は、ブランチ内容を現在の main 基準の正しい `<現行version>→<target>` 差分へ作り直してから（force push または新規コミット追加）マージを試みる。
- ベースが乖離していない（純粋な一時的 API レースのみの）場合は、内容の再生成・不要な force push を行わず、従来通りマージ再試行のみを行う（冪等性・無駄な処理回避を維持）。
- いずれの経路でも、最終的に `gh pr merge --admin` に渡される変更内容は常に「現在の main からの正しい `<現行version>→<target>` 差分」であり、変更ファイルが `package.json` / `package-lock.json` のみであることを検査する `checkBumpPrScope` を通過する。
- 既存の「ブランチ未存在時の新規作成」「スコープ逸脱時の `human_required` 停止」「既存 Release 検出時の冪等スキップ」の挙動を維持する。

### 受入条件（Acceptance Criteria）

#### AC-1: 既存ブランチのベース乖離時に main 基準へ作り直す

- Given: `release/bump-v<target>` ブランチが既存で、そのベースが現在の main より古い（main 側にブランチ作成後の新規コミットがある）。
- When: `release bump <target>` を再実行する。
- Then: ブランチの内容が現在の main 基準の正しい `<current>→<target>` 差分へ作り直される。
- 検証方法見込み: `automated`（擬似的にブランチを古い base で作成→main を進める→再実行、のシナリオを単体/結合テストで再現し検証する）。

#### AC-2: ベース一致時は再生成せずマージ再試行のみ

- Given: 既存 `release/bump-v<target>` ブランチのベースが現在の main と一致している（乖離していない）。
- When: `release bump <target>` を再実行する。
- Then: 内容の再生成を行わず、既存のマージ再試行のみを行う（不要な force push・無駄な処理が発生しない）。
- 検証方法見込み: `automated`（再生成処理・force push が呼ばれないことを単体/結合テストで確認する）。

#### AC-3: 実障害シナリオの再現と自動是正

- Given: `release/bump-v0.2.7` ブランチが `0.2.5→0.2.7` の古い差分のままで、main が `0.2.6` へ進んでいる（本 Issue が実際に発生させた障害状態）。
- When: 修正後の `release bump 0.2.7` を実行する。
- Then: ブランチが `0.2.6→0.2.7` の正しい差分へ是正され、自動でマージ可能な状態になる。
- 検証方法見込み: `automated`（当該状態を再現するテストケースを追加し、修正後にマージ可能状態へ是正されることを確認する）。

#### AC-4: 既存挙動への非回帰

- Given: 「ブランチ未存在時の新規作成」「スコープ逸脱時の `human_required` 停止」「既存 Release 検出時の冪等スキップ」の各既存挙動。
- When: 本修正適用後に各シナリオを実行する。
- Then: いずれの挙動にも回帰がない。
- 検証方法見込み: `automated`（各既存挙動に対する単体/結合テストが引き続き通過することを確認する）。

## スコープ外

- ADR-0005 が確定した版数体系（semver）・main 反映方式（PR 経由 admin merge）・marketplace/apm 廃止方針自体の見直し。
- GitHub Actions 側のジョブ同時実行制御（`concurrency` 設定）の見直し。本 Issue はワークフロー呼び出し頻度を減らすのではなく、`release bump` コマンド自体がどのような呼ばれ方をしても正しい差分でマージを試みるよう是正することを扱う。
