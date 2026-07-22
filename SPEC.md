<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: PRマージのたびにSPEC/DESIGN/PLAN/VALIDATION.mdがmainルート直下へ恒久的に混入する構造的欠陥の解消

- Issue: `ISSUE-208`
- 作成者: `spec_worker`
- 対象ブランチ: `process/208-stray-root-artifact-permanence`

## 目的・背景

AGENTS.md §ディレクトリ構成は、main リポジトリルート直下を `AGENTS.md`・`CLAUDE.md`・`README.md`・`docs/`・`.github/`・`.worktrees/` のみに限定すると規定している。しかし現行の運用では、Issue 毎の worktree 直下で作業ワーカーが作成する当該 Issue 固有のセグメント成果物ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）が、squash merge によって PR がマージされるたびに main のリポジトリルート直下へ持ち込まれ、次の Issue がマージされるまで恒久的に残存し続ける。本 Issue は、この「マージのたびに再生産される」構造的な欠陥を解消することを目的とする。

Issue #200 は、当時 main ルート直下に混入していた同4ファイルを削除するとともに、`checkOutputExists()`（`src/commands/verify.ts`）が「現在の worktree にファイルが存在するか」のみで成果物完了を判定していたために、成果物ファイル自体を意図的に削除する Issue 自身を誤って不合格にしてしまう自己言及的な欠陥を、`wasEverAddedOrModified()`（base ブランチとの `git log --diff-filter=AM --name-only base..HEAD` による履歴上の実績確認をOR条件で加えるフォールバック）の導入で修正した。この判定は当該 Issue 自身の worktree・ブランチの履歴のみを見るため、main ルート直下に前 Issue の成果物ファイルが残存しているか否かには依存しない。

Issue #200 自身の SPEC.md は、次のとおり「マージのたびに main へ恒久的に混入する」構造的原因そのものへの恒久対策を明示的にスコープ外とし、別 Issue での検討へ先送りしていた。

> 「PR マージ後にセグメント成果物ファイルが main へ恒久的に混入する」という、より一般的な構造的原因（マージ時にこれらのファイルを main から除外する仕組みが存在しないこと）の恒久的解決策の設計・実装。別 Issue で検討する。

この別 Issue はこれまで起票されていなかった。実際、`git log --oneline -- SPEC.md DESIGN.md PLAN.md VALIDATION.md` で確認する限り、Issue #200（マージ commit `d772946`）以降にマージされた Issue のうち `#204`・`#202` は、自身の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を root 直下から削除せずにマージされている（`#198`（マージ commit `b40ded4`）はこの4ファイルへの変更を一切含まないマージであったため、本構造的欠陥の実例ではない）。そのため、Issue #202 マージ後の現在の main HEAD でも、この4ファイルは Issue #202 由来の内容のまま root 直下に残存していることを本 Issue の起票にあたり実測で確認した。新規 Issue の worktree は常に main（`defaultBranch()`）から分岐するため、この4ファイルが root 直下に残存している限り、新規 worktree 直下には最初から前回マージ Issue の成果物ファイルが存在してしまい、AGENTS.md が定める root 直下構成の不変条件に違反した状態がマージのたびに再生産される。

さらに、複数 Issue が並行して存在する期間に、あるIssueのマージによって main 上のこれら4ファイルの内容が別 Issue 由来の内容へ変化した場合、他の並行 Issue のブランチ側でも同名ファイルを変更していると、次のリベース・マージ時に想定外の削除/変更コンフリクトが発生しうることが運用上確認されている。

なお、この恒久混入は副作用として Issue #202（`unit_test_results` 判定が `VALIDATION.md` の存在に不適切に結合していた欠陥）を長期間マスクし続けていたことが判明しているが、これは Issue #202 で独立に対応済みであり、本 Issue の対象外とする。

## 要求 → 要件 → 受入条件

### 要求

通常の Issue 開発フロー（spec→design→implementation→validation→マージ）を経ても、その Issue 自身が一時的に作成した `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` が main リポジトリルート直下へ恒久的に残存しないようにしたい、というメンテナ（進行役）からの要求。あわせて、この対策の導入によって、Issue #200 で修正済みの verify-artifacts の成果物完了判定（履歴ベースのフォールバックを含む）が壊れないこと、複数 Issue の並行作業に悪影響（想定外のマージコンフリクトの恒常化等）を与えないことも要求に含む。

### 要件

- 要件1: 通常の Issue 開発フロー（spec→design→implementation→validation→マージ）の完了後、main リポジトリルート直下に、当該 Issue が一時的に作成した `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` が残存しないこと。
- 要件2: 要件1の対策適用後も、`checkOutputExists()`／`wasEverAddedOrModified()`（`src/commands/verify.ts`）による各セグメントの成果物完了判定が、本来完了すべきタイミングで正しく合格・不合格を判定し続けること。
- 要件3: 要件1の対策適用後も、複数 Issue が並行して存在する状況において、あるIssueのマージが他の並行 Issue のブランチ・worktree 内の同名成果物ファイルへ悪影響（想定外のマージ/削除コンフリクトの恒常的な発生等）を与えないこと。
- 要件4: 要件1〜3の対策を、実際に1つ以上の Issue を通しでマージする形で実地回帰確認し、main ルート直下に成果物ファイルが混入しないことを確認すること。
- 要件5: `.agent-skill-chain/templates/issue/` 配下の雛形ファイル自体、および4セグメント・4ゲートモデル自体（`.agent-skill-chain/config/segments.yaml` の `outputs` の意味的定義等）は変更しないこと。
- 要件6: 要件1の対策として「誰が／どの仕組みが root 直下の成果物ファイルを扱うか」を DESIGN 段階で具体化する際は、AGENTS.md I5（進行役の純粋性：進行役は成果物の著述・内容の取り込みを行わない）との整合を確認すること。

### 受入条件（Acceptance Criteria）

#### AC-1: 通常フロー完了後にmainルート直下へ成果物ファイルが恒久的に残存しない

- Given: あるIssueが通常の Issue 開発フロー（spec→design→implementation→validation）の全セグメントを完了し、対応する PR が main へマージされた状態
- When: マージ後の main HEAD のリポジトリルート直下を確認する
- Then: 当該 Issue 自身が一時的に作成した `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` のいずれも、リポジトリルート直下（`.agent-skill-chain/` 配下・`.worktrees/` 配下・他 Issue の worktree を除く）に存在しない
- 検証方法見込み: `automated`（マージ後の main HEAD に対する root 直下ファイル一覧チェック）

#### AC-2: verify-artifactsによる成果物完了判定が引き続き正しく機能する

- Given: AC-1 の対策が適用されている状態で、あるIssueが spec・design・implementation・validation の各セグメントを順に進めている（各セグメント完了直後、および未完了の時点をそれぞれ含む）
- When: 各セグメントの完了時点・未完了時点それぞれで `verify artifacts` （`checkOutputExists()`／`wasEverAddedOrModified()` による履歴ベースのフォールバックを含む）を実行する
- Then: 各セグメントが本来完了すべきタイミングでは合格、未完了の時点では不合格と、Issue #200 導入時と同等に正しく判定される（AC-1 の対策導入によって誤って合格・不合格が反転する回帰が発生しない）
- 検証方法見込み: `automated`（既存の `verify artifacts` に対する回帰テスト・実行結果の確認）

#### AC-3: 並行する他Issueのブランチ・worktreeへ悪影響を与えない

- Given: 複数の Issue が並行してそれぞれ独自のブランチ・worktree で作業中であり、各々が自身の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を保持している状態
- When: そのうち1つの Issue の PR が AC-1 の対策のもとで main へマージされる
- Then: 他の並行 Issue のブランチ・worktree 内の同名ファイルの内容・Git 履歴が意図せず改変されず、当該他 Issue が後日 main と同期（rebase・merge 等）する際にも、この対策自体が原因の想定外の削除/変更コンフリクトが恒常的に発生しない
- 検証方法見込み: `hybrid`（自動化可能な範囲は自動確認し、複数 worktree を跨いだ並行状態の再現・確認は手順を明記した上で実行者が確認する。自動化できない理由・手順・実行者は VALIDATION.md で確定する）

#### AC-4: 対策適用後の実地回帰確認

- Given: AC-1〜AC-3 の対策が適用された状態
- When: 実際に1つ以上の Issue を通常の Issue 開発フロー（spec→design→implementation→validation→マージ）で最後までマージする
- Then: マージ後の main ルート直下に、その Issue 自身の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` が混入していないことが実地で確認される
- 検証方法見込み: `manual`（自動化できない理由: 実際の PR マージという1回性のイベントを伴う実地確認であるため。検証手順・実行者・証跡は VALIDATION.md で確定する）

## スコープ外

- `checkOutputExists()` の判定ロジック自体の詳細変更（Issue #202 が別途対応済み）。
- `.agent-skill-chain/templates/issue/` 配下の雛形ファイル自体の変更。
- 4セグメント・4ゲートモデル自体の変更（AGENTS.md が定める破壊的変更であり ADR を要する。本 Issue はあくまで運用上の恒久混入の解消が対象）。
- 対策の具体的な実現方式（例: マージ前に成果物ファイルを削除する、マージ時に除外する等）そのものの設計・実装。これは DESIGN 段階の責務であり、本 SPEC では要求・要件・受入条件のみを定める。
