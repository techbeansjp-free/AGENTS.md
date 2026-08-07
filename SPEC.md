# SPEC: pr merge が base branch の最新性を保証せず、--admin 常用運用が strict_required_status_checks_policy を事実上バイパスする

- Issue: `ISSUE-493`
- 作成者: `run-ff07e56b`
- 対象ブランチ: `bugfix/493-pr-merge-base-freshness`

## 目的・背景

`agent-skill-chain pr merge`（`src/commands/pr.ts` の `merge()`）は、受け取った引数を検証・加工せずそのまま `gh pr merge` へ透過的に渡すだけで、マージ対象PRのhead branchがbase branch（`main`）の最新コミットに対して最新（ahead/behindでbehind=0）かどうかを事前にチェックしない。

GitHub ruleset側で `strict_required_status_checks_policy: true` を設定していても、`gh pr merge --admin` はブランチ保護ルールを管理者権限でバイパスして実行されるため、この設定は実質的に無効化される。本リポジトリでは、ブランチ保護で拒否された際に `gh pr merge --admin` を都度確認なしで実行する運用（過去のユーザー承認による標準運用）が定着しており、これが `strict_required_status_checks_policy` を継続的にバイパスし続けている。

調査で判明した事実は次の通りである。

1. `merge()`（`src/commands/pr.ts`）は `.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.autonomous` の確認（I8 安全側ラチェット、人間承認の有無）を行った後、`gh(['pr', 'merge', ...args], root)` を素通しで呼ぶのみである。base branchの最新コミットとPRブランチの分岐状況（ahead/behind）を確認する処理は存在しない。
2. マージ成功後には `syncMainWorktree()` が呼ばれ、進行役のmain worktreeのローカル `main` を `origin/main` へ fast-forward 同期する処理はある。しかしこれは「マージ後にローカル環境を追随させる」処理であり、「マージ前にPRブランチ自体がbase branchに追随しているか」を保証する処理ではない。
3. 実際に、並行セッションによる `main` への直接pushが発生し、あるPRが古い `main` を base にしたままマージされかけてコンフリクトした実例が発生している（Issue #484対応PR#485で発生）。
4. `strict_required_status_checks_policy: true`（`.agent-skill-chain/templates/github/provisioning/rulesets/main.json` 等で設定想定）は、本来「PRのhead branchがbaseの最新コミットに対して必須チェックを通過していること」を要求するGitHub側の機構だが、`--admin` によるバイパスの前では無力である。
5. `gh pr merge` 自体に `--auto`（auto-merge有効化。stale化時は自動的に更新を待つ）や、事前に `gh api repos/{owner}/{repo}/pulls/{number}/update-branch` でPRブランチを最新化するオプションが存在するが、現状の `pr merge` コマンドはこれらを一切利用していない。

複数PRが並行してマージされる本リポジトリの実運用では、base branchに対して古いPRブランチがマージされると、直後のコンフリクト・後続PRのCI失敗・mainの一時的な不整合を招く。`--admin` 常用運用がある限り、GitHub ruleset側の設定だけでは実害を防げず、CLIツール側（`pr merge` コマンド）でのチェックが唯一の実効的な防御線になる。本Issueは、この防御線を `pr merge` コマンド自体に追加することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

進行役が `agent-skill-chain pr merge` を実行してPRをマージする際、対象PRのhead branchがbase branch（`main`）の最新コミットに対して最新でない状態のままマージが成立しないことを保証してほしい。`--admin` 引数の有無に関わらず、この保証は維持されなければならない。

### 要件

- 要件1: `pr merge` はマージ実行前に、対象PRのhead branchがbase branchの最新コミットに対して最新（behind=0）であるかどうかを確認する。
- 要件2: 確認の結果、最新でないと判明した場合、`gh pr merge` を素通しで呼び出す従来の挙動をそのまま実行してはならない。最新化してから改めて確認する、または日本語エラーメッセージでマージを中断し人間判断へ委ねる、のいずれかの安全側の挙動を取る。どちらを採用するか、および自動最新化を既定とするかどうかは設計セグメントで確定する。
- 要件3: 最新化を試みる設計を採用する場合、最新化がコンフリクト等により完了できないときは、マージを実行せず日本語エラーメッセージで中断する。
- 要件4: このチェックは `--admin` を含むどの `gh pr merge` オプションが渡された場合でも迂回できない。`--admin` はGitHubブランチ保護のstatus check必須化をバイパスするための引数であり、本チェックはCLIツール側で独立に強制する。
- 要件5: 最新性の確認処理自体が失敗した場合（GitHub APIエラー等）、マージを実行せず日本語エラーメッセージで停止する。
- 要件6: 対象PRのhead branchが確認時点（または最新化後）でbase branchに対して最新である場合は、既存の `gh pr merge` 呼び出しおよびマージ成功後の `syncMainWorktree()` によるローカルmain同期処理を、本Issue対応前と同一の挙動で実行する（回帰させない）。

### 受入条件（Acceptance Criteria）

#### AC-1: 最新でないPRはそのままマージされない

- Given: 対象PRのhead branchがbase branch（`main`）の最新コミットに対して最新でない（behind>0）
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する（`merge.autonomous: true` は設定済みとする）
- Then: 最新化されないままの状態で `gh pr merge` によるマージが成立することはない。最新化を試みる設計であれば最新化後に改めてbehindを確認したうえでのみマージへ進み、中断を選ぶ設計であれば終了コード1以上と日本語エラーメッセージで停止する
- 検証方法見込み: `automated`

#### AC-2: 最新化がコンフリクト等で完了できない場合はマージを実行せず中断する

- Given: 対象PRのhead branchが最新でなく、かつ最新化（base branchの取り込み等）を試みてもコンフリクト等により完了できない状態にある
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: `gh pr merge` によるマージは実行されず、終了コード1以上を返し、日本語エラーメッセージで人間判断を促して停止する
- 検証方法見込み: `automated`

#### AC-3: `--admin` を指定してもチェックは迂回できない

- Given: 対象PRのhead branchがbase branchの最新コミットに対して最新でない（behind>0）
- When: `agent-skill-chain pr merge`（対象PR番号に加え `--admin` を含む引数）を実行する
- Then: `--admin` によってGitHub側のブランチ保護（status check必須化）がバイパスされる場合でも、本チェックにより最新でないPRのマージは成立しない（AC-1と同じ安全側挙動を取る）
- 検証方法見込み: `automated`

#### AC-4: 最新性確認自体が失敗した場合はマージを実行しない

- Given: 対象PRのhead/base間のahead/behind情報取得（GitHub API呼び出し等）が何らかの理由で失敗する
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: `gh pr merge` によるマージ実行前にこの失敗を検知し、マージを実行せず、終了コード1以上・日本語エラーメッセージで停止する
- 検証方法見込み: `automated`

#### AC-5: 最新であるPRの正常系は既存の挙動から回帰しない

- Given: 対象PRのhead branchが確認時点でbase branchの最新コミットに対して最新（behind=0）である
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: 従来通り `gh pr merge` が呼び出されてマージが成立し、成功後は `syncMainWorktree()` によるローカルmain同期が本Issue対応前と同一の挙動で実行され、全体として終了コード0を返す
- 検証方法見込み: `automated`

#### AC-6: マージ自体が失敗した場合の出力はチェック追加後も維持される

- Given: 最新性チェックを通過した（または不要と判定された）PRに対して `gh pr merge` 自体がGitHub側の理由（権限不足・必須チェック未達等）で失敗する
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: `gh pr merge` の終了コード・標準エラー出力がそのまま返され、`syncMainWorktree()` は呼び出されない（本Issue対応前の既存挙動を維持する）
- 検証方法見込み: `automated`

## スコープ外

- GitHub ruleset側の `strict_required_status_checks_policy` 設定自体の見直し。
- `--admin` を都度確認なしで実行する運用ルール自体の是非（運用ポリシーの変更は別途判断）。
- `gh pr merge --auto`（auto-merge）をデフォルト運用にするかどうかの判断。
- `src/commands/pr.ts` の `merge()` 以外の経路から直接 `gh(['pr', 'merge', ...])` を呼び出している箇所（`src/commands/release.ts`・`src/commands/root-cleanup.ts` 等の機械生成PRマージ処理）への同様のチェック追加。これらは対象PRの性質（機械生成・単独運用）が異なり、必要性の判断を含め別Issueで扱う。
- ローカルモード（`config.coordination.backend === 'local'`）における同等の保証。ローカルモードではPRではなくIntegration Recordを用いるため、GitHub PRのahead/behind概念自体が存在せず対象外とする。
- 最新化を自動で行うかどうかのデフォルト値、および自動最新化の具体的な実現手段（`update-branch` API・ローカルでのrebase/merge等）の確定。これは設計セグメントで確定する設計判断であり、本SPECは「最新でない状態のままマージが成立してはならない」という受入条件のみを規定する。
