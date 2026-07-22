<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: main リポジトリルート直下に混入した stray なセグメント成果物ファイルの削除

- Issue: `ISSUE-200`
- 対応する SPEC: `SPEC.md`

## 前提

本 Issue は当初、恒久的な設計判断を伴わない単純なファイル削除（`AC-1`・`AC-2`）として開始した。実装の結果、削除自体が引き起こす verify-artifacts 側の自己言及的な検査ロジックの穴（`AC-3`）が判明し、`checkOutputExists()` の検査ロジック一般化という実コード変更を追加スコープとした。この`AC-3`対応は、既存の「現在ファイルが存在するか」という単一観点の検査を「現在存在する、または過去に一度でも存在した実績があるか」という観点へ一般化するものであり、システムの恒久的なアーキテクチャ判断（新規コンポーネント導入・外部依存追加・データモデル変更等）ではない。ADR は「なぜその恒久的判断をしたか」を記録する成果物であり、本 Issue には該当する恒久的判断が存在しないため作成しない。

## 事前調査（削除の安全性確認）

削除対象ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）が、CI・CLI 実装上「main リポジトリルート直下に恒久的に存在すること」を前提にしていないかを `grep` で確認した。結果は以下の通りで、いずれも Issue 固有の worktree 単位でこれらのファイルの有無を検査する設計であり、main のルート直下に恒久的に存在することを前提にしたコードは存在しない。

- `.agent-skill-chain/ci/verify-artifacts.sh` / `.agent-skill-chain/ci/verify-ac-coverage.sh`: いずれも `src/commands/verify.ts` の `artifacts`/`acCoverage` サブコマンドへの薄いラッパーであり、`<issue_id>` 引数から `findIssueWorktree()` で解決した**当該 Issue の worktree パス**（`entry.path`）を基点にファイル存在を確認する。`repoRoot()`（main worktree）は検査対象にしていない。
- `src/commands/verify.ts` の `checkOutputExists()` は `worktreePath` 引数配下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を検査対象とし、常に `artifacts()` から渡される Issue worktree パスに対して実行される。
- `src/commands/verify.ts` の `docLength()` が参照する `SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md` は `.agent-skill-chain/templates/issue/` 配下の**雛形ファイル**であり、本 Issue の削除対象（root 直下の実ファイル）とは別物で影響を受けない。
- `.github/workflows/agent-skill-chain-ci.yml` は `verify-artifacts.sh "$issue_id" "$segment"` の形で PR に対応する Issue 番号を渡しており、root 直下のファイルを直接参照する記述は無い。
- `test/integration/verify.test.ts` 等の既存テストは全て一時リポジトリ・一時 worktree 上で `SPEC.md` 等を作成・検証しており、main リポジトリルートの実ファイルに依存するテストは存在しない。

以上より、root 直下の4ファイル削除は既存 CI・CLI のいずれの前提にも抵触しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（root 直下の stray ファイル削除） | 実装セグメントでの `git rm` 実行 | 対象は root 直下の4ファイルのみ。`.agent-skill-chain/templates/issue/` 配下の雛形・`.worktrees/` 配下の他 Issue 成果物は対象外（要件2） |
| `AC-2`（削除後も CI が通過） | 上記「事前調査」による事前確認 ＋ 実装セグメントでの実際の CI 実行結果確認 | 削除に伴う追加のコード変更は不要（純粋な削除のみで完結する） |
| `AC-3`（成果物ファイルを意図的に削除するIssueでもverify-artifactsが正しく判定する） | `src/commands/verify.ts` の `checkOutputExists()` の拡張（詳細は下記「AC-3対応」節） | AC-1・AC-2とは異なり実際のコード変更を伴う。対象は `checkOutputExists()` のSPEC.md/DESIGN.md/PLAN.md/VALIDATION.md判定のみ |

## AC-3対応: verify-artifacts の自己言及的欠陥の修正

### 問題

`checkOutputExists()` は、spec/design/planセグメントの必須成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`）、およびvalidationセグメントの`acceptance_test_results`・`regression_test_results`（`VALIDATION.md`の存在で代替確認）のいずれについても、「現在の worktree に当該ファイルが存在するか」のみで完了判定している。このため、当該セグメントの成果物ファイル自体を意図的に削除するIssue（本Issue #200のspecセグメント自身、および将来`VALIDATION.md`を意図的に削除するIssue全般のvalidationセグメント）では、作業自体は完了しているにもかかわらず判定が常に失敗する自己言及的な矛盾を抱える。

### 設計判断

`checkOutputExists()`に、「現在存在する」判定に加えて、「当該ブランチのdefaultBranch（main）からの差分コミット履歴の中で、当該ファイルが一度でも追加(A)または変更(M)された記録があるか」を確認する判定を**OR条件**で追加する。いずれかが真であれば、そのセグメントの成果物は「存在した実績あり」と判定し完了扱いとする。

判定コマンドは `git log --diff-filter=AM --name-only <base>...HEAD -- <file>` とし、`src/lib/exec.ts` の `git()` 実行ラッパーを用いる。`<base>` の解決には、既存の `code` 判定（`git diff --stat base...HEAD`）で既に使われている `defaultBranch(worktreePath)`（`src/lib/worktree.ts`）をそのまま再利用し、判定基点解決のロジックを重複させない。

対象は `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の4ファイルの存在判定のみとし、`ADR`（ディレクトリ内ファイル有無判定）・`code`（diff --stat判定）には変更を加えない。

この設計により:
- 通常のIssue（ファイルが最後まで存在し続ける）は「現在存在する」がtrueのため従来どおり合格する。
- 意図的に削除するIssue（本Issue #200のspecセグメント、将来のVALIDATION.md削除Issue等）は、「現在存在する」はfalseだが、削除前に必ず一度はadd/modifyのcommitが当該ブランチに存在するため、履歴判定がtrueとなり合格する。
- 一度も当該ファイルを作成していない未着手セグメントは、「現在存在する」も「履歴上の実績」もともにfalseのままであり、引き続き不合格となる。

### 責務境界

- 本変更は `checkOutputExists()` 内のSPEC.md/DESIGN.md/PLAN.md/VALIDATION.mdの4分岐にのみ閉じる。`artifacts()`本体の呼び出し構造、`ADR`・`code`分岐、および`gateReport()`・`templateSync()`・`adr()`・`acCoverage()`など`verify.ts`内の他のサブコマンドのロジックには一切変更を加えない。
- `acCoverage()`（AC対応表の孤児検出、SPEC.md/VALIDATION.mdの内容を直接読み込んで検証する）は本変更（成果物「完了」判定）の対象外。SPEC.md/VALIDATION.mdを意図的に削除するIssueであっても、`acCoverage()`が検証するAC対応表はマージ前のPRブランチ上のcommit時点の内容であり、削除commitより前の時点でレビュー・検証済みであることを前提とする。この前提の是非・恒久対応は本Issueのスコープ外とする。

### フェイルセーフ方針

`git log`実行（および前段の`defaultBranch()`解決）自体が失敗した場合（例: shallow cloneでマージベースが解決できない、`origin/HEAD`未設定等）は、例外を握りつぶし履歴判定側を「実績なし（false）」として扱う。すなわちOR条件のもう一方である「現在存在する」判定のみに委ねる安全側フェイルバックとする。これにより判定不能を「合格」側へ倒して見逃す方向にはならず、AGENTS.md I8（安全側ラチェット：既定は常に安全側）に整合する。

## 責務・境界

### コンポーネント構成

本 Issue の変更は「root 直下の stray ファイル削除」と「その結果露見したverify-artifactsの検査ロジック拡張」の2つで構成される。新規コンポーネント・新規外部依存の導入はない。

- 実装セグメント: (1) root 直下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を `git rm` で削除する。他の場所（`.agent-skill-chain/templates/issue/`・`.worktrees/`）のファイルには一切触れない。(2) `src/commands/verify.ts` の `checkOutputExists()` を上記「AC-3対応」の設計に従い拡張する。
- 独立検証セグメント: 削除後・拡張後に既存 CI ワークフロー（`.agent-skill-chain/ci/` 配下の `verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-template-sync.sh`・`verify-artifacts.sh`・`verify-ac-coverage.sh`・`verify-adr.sh` および `.github/workflows/agent-skill-chain-ci.yml`）が引き続き成功すること、および `checkOutputExists()` の拡張が意図通り動作すること（PLAN.md の回帰テスト参照）を確認する責務を持つ。

### 依存関係

```text
実装セグメント（git rm ＋ checkOutputExists()拡張） → 独立検証セグメント（既存CIワークフロー実行確認 ＋ 回帰テスト確認） → PR
```

`checkOutputExists()`の拡張は`src/lib/exec.ts`の`git()`・`src/lib/worktree.ts`の`defaultBranch()`という既存の内部依存のみを再利用し、新規の外部依存は発生しない。ただし本変更は本Issue固有のものではなく、`verify artifacts`を利用する全Issueの判定挙動に影響する点に留意する（下記「障害・ロールバック考慮」参照）。

## 関連ADR

該当なし。本 Issue は「AC-3対応」節の検査ロジック一般化を含め恒久的なアーキテクチャ判断を伴わないため ADR を作成しない。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード(1): 削除後に既存 CI が予期せず失敗する（「事前調査」で洗い出せなかった隠れた依存が存在した場合）。
- 想定される失敗モード(2): `checkOutputExists()`拡張後の履歴判定が、意図せず本来不合格であるべきセグメントを合格させてしまう（過剰検出）。ただし判定は`--diff-filter=AM`かつ対象ファイルの完全一致パス指定であり、当該ファイルへの実際のadd/modify commitが当該ブランチの差分区間に存在する場合にのみtrueになるため、恣意的な合格化の余地はない。
- 想定される失敗モード(3): `git log`実行自体が失敗し判定不能になる。「AC-3対応」節のフェイルセーフ方針により「実績なし」に倒れ、既存の「現在存在する」判定のみで従来どおり動作するため、誤って合格判定にはならない。
- ロールバック手順: 本 PR のブランチ（`chore/200-stray-root-artifacts`）は close・破棄すれば main には一切影響しない。万一 main へマージ後に問題が判明した場合も、削除された4ファイル・`checkOutputExists()`の変更のいずれも Git 履歴から `git revert` により復元・撤回可能。
- 影響を受ける既存機能: root 直下4ファイルの削除自体は、過去 Issue（#196・#191）の作業過程で誤って main に混入した stray な成果物の除去であり、他のいかなる機能もこれらの root 直下ファイルの恒久的存在を前提にしていないことを「事前調査」で確認済み。一方、`checkOutputExists()`の拡張は`verify artifacts`を利用する**全Issue**の判定挙動に影響する（本Issue固有ではない）。ただし合格条件を「現在存在する」→「現在存在する OR 過去に一度でもadd/modifyされた実績がある」へ緩和する変更であり、既存の「ファイルが最後まで存在し続ける通常のIssue」の合格判定には影響を与えず、既存の不合格判定（一度も作成していない未着手セグメント）も維持される。
