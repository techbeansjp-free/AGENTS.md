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

なお、この防御線は「最新性の確認」と「`gh pr merge` の実行」という2段階の処理で構成されるため、確認から実行までの間に別セッションが `main` へ新規マージを行うと、確認時点では最新だった対象PRが実行時点では最新でなくなる TOCTOU（Time-of-check to time-of-use）競合が理論上残る。GitHub APIには「最新性確認とマージ実行を単一の不可分操作にする」手段が無いため、この競合を完全に排除することはできない。本Issueが規定する「保証」は、この残存リスクを許容したうえでの多段防御（確認→最新化→再確認、および実行結果の安全側検知）を意味する。残存リスクの扱いは「未決事項」に明記する。

## 要求 → 要件 → 受入条件

### 要求

進行役が `agent-skill-chain pr merge` を実行してPRをマージする際、対象PRのhead branchがbase branch（`main`）の最新コミットに対して最新でない状態のままマージが成立しないことを保証してほしい。`--admin` 引数の有無に関わらず、この保証は維持されなければならない。

ここでいう「保証」は、確認・最新化・再確認・実行結果検知の各段階を組み合わせたベストエフォート的な多段防御を指す。GitHub API側に最新性確認とマージ実行を単一の不可分操作にする手段が存在しない以上、確認から `gh pr merge` 実行までの間隔に発生する残存リスク（TOCTOU競合、「未決事項」参照）を技術的に完全排除することまでは求めない。その代わり、当該残存リスクが顕在化してマージが実行された場合には、これを検知できないまま見過ごさず安全側エラーとして扱うことを要求する（要件7・AC-7）。

### 要件

- 要件1: `pr merge` はマージ実行前に、対象PRのhead branchがbase branchの最新コミットに対して最新（behind=0）であるかどうかを確認する。
- 要件2: 確認の結果、最新でないと判明した場合、`gh pr merge` を素通しで呼び出す従来の挙動をそのまま実行してはならない。最新化してから改めて確認する、または日本語エラーメッセージでマージを中断し人間判断へ委ねる、のいずれかの安全側の挙動を取る。どちらを採用するかは設計セグメントで確定する。ただし、自動最新化を実装する設計を採用する場合であっても、自動最新化を既定で有効にしてはならない。既定の挙動は日本語エラーメッセージでマージを中断し人間判断へ委ねることとし、自動最新化を有効化するには進行役による明示的な設定（オプトイン）を要する。
- 要件3: 最新化を試みる設計を採用する場合、最新化がコンフリクト等により完了できないときは、マージを実行せず日本語エラーメッセージで中断する。
- 要件4: このチェックは `--admin` を含むどの `gh pr merge` オプションが渡された場合でも迂回できない。`--admin` はGitHubブランチ保護のstatus check必須化をバイパスするための引数であり、本チェックはCLIツール側で独立に強制する。
- 要件5: 最新性の確認処理自体が失敗した場合（GitHub APIエラー等）、マージを実行せず日本語エラーメッセージで停止する。
- 要件6: 対象PRのhead branchが確認時点（または最新化後）でbase branchに対して最新である場合は、既存の `gh pr merge` 呼び出しおよびマージ成功後の `syncMainWorktree()` によるローカルmain同期処理を、本Issue対応前と同一の挙動で実行する（回帰させない）。
- 要件7: 最新性確認（要件1）から `gh pr merge` 実行までの間隔に発生するTOCTOU競合（「未決事項」参照）を技術的に完全排除することは求めないが、この競合により確認通過後の `gh pr merge` 自体がGitHub側で失敗した場合（例: マージ実行時点でのコンフリクト・必須チェック未達等）、その失敗を検知し、マージが成立しなかったことを示す終了コード1以上・日本語エラーメッセージで停止しなければならない。確認通過後の `gh pr merge` 失敗を成功として扱ってはならない。本要件は、要件1の最新性確認通過後に発生した `gh pr merge` 失敗のうち、要件6が扱う「base branchとの最新性とは明らかに無関係な失敗（権限不足・PRが既にクローズ・マージ済み等）」以外の全て（必須チェック未達を含む）を対象とする。失敗原因の切り分けが実装上困難な場合は、安全側として本要件7の挙動（日本語エラーメッセージでの停止）を優先してよい。

### 受入条件（Acceptance Criteria）

#### AC-1: 最新でないPRはそのままマージされない

- Given: 対象PRのhead branchがbase branch（`main`）の最新コミットに対して最新でない（behind>0）
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する（`merge.autonomous: true` は設定済みとする）
- Then: 最新化されないままの状態で `gh pr merge` によるマージが成立することはない。最新化を試みる設計であれば最新化後に改めてbehindを確認したうえでのみマージへ進み、中断を選ぶ設計であれば終了コード1以上と日本語エラーメッセージで停止する。進行役が自動最新化を明示的に有効化するオプトイン設定を行っていない既定状態では、自動最新化を試みず終了コード1以上・日本語エラーメッセージで停止する
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

- Given: 最新性チェックを通過した（または不要と判定された）PRに対して `gh pr merge` 自体が、base branchとの最新性とは明らかに無関係な失敗原因（例: 対象リポジトリへの書き込み権限が無い、PRが既にクローズ・マージ済みである等）で失敗する
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: `gh pr merge` の終了コード・標準エラー出力がそのまま返され、`syncMainWorktree()` は呼び出されない（本Issue対応前の既存挙動を維持する）
- 適用範囲: 本ACは、失敗原因がbase branchとの最新性に無関係であることが明らかな場合にのみ適用される。必須チェック未達等、TOCTOU競合に起因しうる失敗はAC-7が優先して扱う
- 検証方法見込み: `automated`

#### AC-7: 確認通過後にTOCTOU競合でマージが失敗した場合も安全側エラーとして扱う

- Given: 最新性チェックを通過した（behind=0と確認された、または最新化後に再確認済みの）PRに対して、確認から `gh pr merge` 実行までの間に別のマージが `main` へ成立し、その結果 `gh pr merge` 自体がGitHub側で失敗する（必須チェック未達を含む）
- When: `agent-skill-chain pr merge`（対象PR番号とオプション引数を伴う）を実行する
- Then: `gh pr merge` の失敗が検知され、終了コード1以上・日本語エラーメッセージで停止する。この失敗は成功として扱われず、`syncMainWorktree()` は呼び出されない
- 優先順位: 本ACは、要求の最新性確認通過後に発生した `gh pr merge` 失敗のうち、AC-6が扱う「最新性と明らかに無関係な失敗」以外の全てを扱う（必須チェック未達を含む）。失敗原因の切り分けが実装上困難な場合は、安全側としてAC-7の挙動（日本語エラーメッセージでの停止）を優先してよい
- 検証方法見込み: `automated`

## 用語

- **head branch / base branch**: GitHub PRにおいて、マージ元のブランチ（変更を含む側）を head branch、マージ先のブランチ（本Issueでは `main`）を base branch と呼ぶ。
- **ahead/behind**: あるブランチが基準ブランチに対して、基準ブランチに存在せず自身にだけ存在するコミット数を ahead、自身に存在せず基準ブランチにだけ存在するコミット数を behind と呼ぶ。本SPECでの「最新（behind=0）」は、対象PRのhead branchがbase branchの最新コミットに対してbehind=0であることを指す。
- **strict_required_status_checks_policy**: GitHub ruleset（`.agent-skill-chain/templates/github/provisioning/rulesets/main.json` 等）における、PRのhead branchがbase branchの最新コミットに対して必須status checkを通過済みであることをマージ条件として要求する設定。head branchがbehind状態のままではマージを許可しない。
- **TOCTOU（Time-of-check to time-of-use）競合**: 状態を確認した時点（time-of-check）と、その確認結果に基づき操作を実行する時点（time-of-use）の間に状態が変化し、確認結果と実行時点の実際の状態が食い違う競合状態。本SPECでは、最新性確認と `gh pr merge` 実行の間に別セッションが `main` へ新規マージすることで発生し得る。

## 未決事項

- 「目的・背景」および「要求」に記載の通り、最新性確認と `gh pr merge` 実行は不可分な単一操作にできないため、確認から実行までの間隔に発生するTOCTOU競合を技術的に完全に排除することはできない。本SPECはこの残存リスクを許容したうえで、(1) 確認から実行までの間隔を要求として明示的に規定しない範囲で実装が可能な限り短くすること、(2) 競合が顕在化して `gh pr merge` が失敗した場合はこれを安全側エラーとして検知すること（要件7・AC-7）、の2点を多段防御として要求する。base branchへの書き込みを確認から実行完了まで単一操作として不可分化する仕組みはGitHub API側に存在せず、本Issueのスコープでは採用しない。
- 確認から実行までの間隔をどこまで短縮するか（例: 確認直後に即座に `gh pr merge` を呼ぶ、リトライ回数の上限を設けるか等）の具体的な実現方法は、要求としての結論を出さず設計セグメントで確定する。

## スコープ外

- GitHub ruleset側の `strict_required_status_checks_policy` 設定自体の見直し。
- `--admin` を都度確認なしで実行する運用ルール自体の是非（運用ポリシーの変更は別途判断）。
- `gh pr merge --auto`（auto-merge）をデフォルト運用にするかどうかの判断。
- `src/commands/pr.ts` の `merge()` 以外の経路から直接 `gh(['pr', 'merge', ...])` を呼び出している箇所（`src/commands/release.ts`・`src/commands/root-cleanup.ts` 等の機械生成PRマージ処理）への同様のチェック追加。これらは対象PRの性質（機械生成・単独運用）が異なり、必要性の判断を含め別Issueで扱う。
- ローカルモード（`config.coordination.backend === 'local'`）における同等の保証。ローカルモードではPRではなくIntegration Recordを用いるため、GitHub PRのahead/behind概念自体が存在せず対象外とする。
- 自動最新化を実装する設計を採用するかどうか自体の選択、および採用する場合の具体的な実現手段（`update-branch` API・ローカルでのrebase/merge等）の確定。これらは設計セグメントで確定する設計判断である。ただし、自動最新化を採用する場合の既定有効/無効値は要件2が「既定は無効（オプトイン制）」と規定済みであり、設計セグメントの裁量範囲に含まない。
