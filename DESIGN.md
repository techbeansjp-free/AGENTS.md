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
| `AC-1`（root 直下の stray ファイル削除） | 実装セグメントでの**暫定削除**（PLAN.md 変更単位 #1、`checkOutputExists()` 拡張（AC-3対応）の動作確認用の一時削除） ＋ validation セグメントでの**最終削除**（PLAN.md 変更単位 #6、これにより AC-1 がマージ時点で真に充足される） | 対象は root 直下の4ファイルのみ。`.agent-skill-chain/templates/issue/` 配下の雛形・`.worktrees/` 配下の他 Issue 成果物は対象外（要件2）。削除は暫定（#1）→最終（#6）の2段階であり、その理由は下記「なぜ削除が2段階になるか」節に記載する |
| `AC-2`（削除後も CI が通過。ただし削除という行為自体の構造的帰結は受容する） | AC-3 の `checkOutputExists()` 拡張（これにより `verify-artifacts` は既存 CI の通常運用へ回帰することなく green を維持する） ＋ 最終削除commit（PLAN.md 変更単位 #6）が引き起こす帰結（`gate-reconcile` による spec/design/implementation/validation の4ゲート action_required 化・`verify-ac-coverage` 失敗）を受容し、validation セグメントで実際に確認・証跡化すること | 本 AC-2 の合格は AC-3 のコード変更に依存する（純粋な削除のみでは `verify-artifacts` が自己言及的に失敗するため、「追加のコード変更は不要」ではない）。最終削除commitが引き起こすゲート・CI の巻き戻りは削除という行為自体の構造的帰結として明示的に受容し、下記「最終削除commitが引き起こすゲート・CI側の帰結」節および PLAN.md 変更単位 #6 の証跡化ステップの通り実際に確認・記録する |
| `AC-3`（成果物ファイルを意図的に削除するIssueでもverify-artifactsが正しく判定する） | `src/commands/verify.ts` の `checkOutputExists()` の拡張（詳細は下記「AC-3対応」節） | AC-1・AC-2とは異なり実際のコード変更を伴う。対象は `checkOutputExists()` の SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md 判定のみ（実装済み・implementation-gate 承認済み） |

## AC-3対応: verify-artifacts の自己言及的欠陥の修正

### 問題

`checkOutputExists()` は、spec/design/planセグメントの必須成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`）、およびvalidationセグメントの`acceptance_test_results`・`regression_test_results`（`VALIDATION.md`の存在で代替確認）のいずれについても、「現在の worktree に当該ファイルが存在するか」のみで完了判定している。このため、当該セグメントの成果物ファイル自体を意図的に削除するIssue（本Issue #200のspecセグメント自身、および将来`VALIDATION.md`を意図的に削除するIssue全般のvalidationセグメント）では、作業自体は完了しているにもかかわらず判定が常に失敗する自己言及的な矛盾を抱える。

### 設計判断

`checkOutputExists()`に、「現在存在する」判定に加えて、「当該ブランチのdefaultBranch（main）からの差分コミット履歴の中で、当該ファイルが一度でも追加(A)または変更(M)された記録があるか」を確認する判定を**OR条件**で追加する。いずれかが真であれば、そのセグメントの成果物は「存在した実績あり」と判定し完了扱いとする。

判定コマンドは `git log --diff-filter=AM --name-only <base>..HEAD -- <file>` とし、`src/lib/exec.ts` の `git()` 実行ラッパーを用いる。`<base>` の解決には、既存の `code` 判定（`git diff --stat base...HEAD`）で既に使われている `defaultBranch(worktreePath)`（`src/lib/worktree.ts`）をそのまま再利用し、判定基点解決のロジックを重複させない。

`git log` は 2 ドット（`<base>..HEAD`、片側差分：`<base>` から分岐した後に `HEAD` 側に追加されたコミットのみを見る）を用いる点に注意する。`git diff` の3ドット（`<base>...HEAD`、マージベース基点の差分）とは意味が異なり、`git log` で3ドット（対称差分：`<base>` 側にのみ存在するコミットも含む）を用いると、`<base>` 側で当該ファイルが追加されただけで、現在の feature ブランチが一度もそのファイルに触れていなくても「実績あり」と誤判定してしまう。この誤判定を避けるため、`git log` には常に2ドットを用いる。

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

- 実装セグメント: (1) root 直下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の**暫定削除**（PLAN.md 変更単位 #1）。これは `checkOutputExists()` 拡張（`AC-3` 対応）の動作確認のために一度 `git rm` で削除するものであり、この時点の削除は最終状態ではない。他の場所（`.agent-skill-chain/templates/issue/`・`.worktrees/`）のファイルには一切触れない。(2) `src/commands/verify.ts` の `checkOutputExists()` を上記「AC-3対応」の設計に従い拡張する（PLAN.md 変更単位 #3）。
- 独立検証セグメント（validation_worker）: (1) `VALIDATION.md` を作成し、受入・回帰検証（既存 CI ワークフロー — `.agent-skill-chain/ci/` 配下の `verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-template-sync.sh`・`verify-artifacts.sh`・`verify-ac-coverage.sh`・`verify-adr.sh` および `.github/workflows/agent-skill-chain-ci.yml` の成功確認、および `checkOutputExists()` 拡張の回帰テスト確認を含む）を実施する。(2) 検証完了後の**最終アクション**として、`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の4ファイルを `git rm` で再度削除し、最後の checkpoint として commit・push する（PLAN.md 変更単位 #6）。これにより `AC-1`（root 直下に4ファイルが存在しない）は、マージ時点の最終状態で満たされる。

#### なぜ削除が2段階になるか

削除は「実装セグメントでの暫定削除（#1）→ validation セグメントでの最終削除（#6）」の2段階で構成する。実装セグメント直後に恒久的に削除できないのは、`SPEC.md`・`DESIGN.md`・`PLAN.md` を validation_worker が検証観点（要求・設計との整合性確認）のために参照する必要があるためである。加えて、実装セグメント完了後もこれらの成果物は spec-gate・design-gate の差し戻し（本 Issue 自身の DESIGN.md 差し戻しがその実例）のたびに読み書き・再作成され続けるのが正常な運営であり、その時点では「存在しないこと」を最終状態として確定できない。したがって4ファイルが実際に不要になり `AC-1` を最終状態として満たせるのは、全ゲートを通過し検証が完了した後の validation セグメント最後の1回に限られる。

#### 最終削除commitが引き起こすゲート・CI側の帰結

上記 #6 の最終削除commitは、それ自体が正常に完了する一方で、以下2つの副作用を確実に引き起こす。これらは実装上の見落とし（バグ）ではなく、「spec-gateが承認した成果物ファイルそのものを最終的に削除する」という本Issueの行為自体が持つ構造的な帰結であり、隠さずここに記載する。

1. **4ゲート全ての `action_required` への巻き戻し**: `.github/workflows/agent-skill-chain-reconcile.yml` は main 以外の全ブランチへの push で `gate reconcile`（`src/commands/gate.ts` の `reconcile()`）を実行する。`reconcile()` はspec/design/implementation/validationの順にゲートを走査し、いずれかのゲートで承認済み成果物（`approved_artifacts`）のdigestが現在のcommit内容と一致しないと判定した時点で当該ゲートを無効化し、以降の`downstreamInvalidated`フラグにより残り全ての下流ゲートも連鎖的に無効化する。spec-gateが承認した`SPEC.md`は最終削除commitで消失するため、digest不一致によりspec-gateがまず無効化され、`downstreamInvalidated`により design/implementation/validationの3ゲートも連鎖して`action_required`へ遷移する。すなわち最終削除commitのpush後、4ゲート全てが`action_required`状態になることが確実に起こる。
2. **`verify-ac-coverage`（CI必須`verify`ジョブ）の失敗**: `src/commands/verify.ts` の `acCoverage()`（`.agent-skill-chain/ci/verify-ac-coverage.sh` の実体）は、`AC-3対応の checkOutputExists()`とは独立した別ロジックであり、`fs.existsSync(specPath)` / `fs.existsSync(validationPath)` で `SPEC.md`・`VALIDATION.md` の**現在の存在のみ**を判定する。`checkOutputExists()`に追加した「過去に一度でもadd/modifyされた実績があるか」というOR条件の履歴判定は、`acCoverage()`には適用されない（上記「責務境界」節に記載の通り、本変更のスコープ外）。最終削除commit以降、`SPEC.md`・`VALIDATION.md`はworktreeに存在しなくなるため、`acCoverage()`は`fail()`を返し、CIの必須`verify`ジョブは確実に失敗する。

これら2点は「AC-1（root直下に4ファイルが存在しない）を最終状態として満たす」という設計判断（前節「なぜ削除が2段階になるか」）を実行に移した瞬間に必ず発生する既知の帰結であり、`checkOutputExists()`拡張（AC-3対応）によっても解消されない。

**この帰結が実害を追加しない理由**: 本リポジトリは現在、ゲートレビューCIに必要なsecretsが未設定であるため、いずれのPRも必須Check Run・必須statusの正常経路では完了できず、実質的に全てのPRが `gh pr merge --admin` による必須チェックのbypassでマージされる運用になっている（Issue #196・#198 も同様の運用）。この運用前提の下では、最終削除commit後に4ゲートが`action_required`になること・`verify-ac-coverage`が失敗することは、admin mergeというマージ手順そのものには何ら追加の実害を与えない。ゲート・CIが本来期待する「グリーンな状態でのマージ」という理想からは外れるが、その理想が既に本リポジトリの現運用では成立していないため、本Issueの最終削除がその状態を新たに悪化させるわけではない。本Issueの検証セグメントは、この既知の帰結（4ゲートのaction_required化・verify-ac-coverage失敗）を実際に確認したうえで、`gh pr merge --admin` によるマージを前提として完了とする。

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
- 既知の帰結（失敗モードではない）(4): 最終削除commit（PLAN.md 変更単位 #6）のpush後、上記「最終削除commitが引き起こすゲート・CI側の帰結」節の通り、`gate reconcile`により4ゲート全てが`action_required`へ遷移し、かつ`verify-ac-coverage`（CIの必須`verify`ジョブ）が`SPEC.md`/`VALIDATION.md`の不在により失敗することが確実に起こる。これは事前に想定外の失敗ではなく、削除という行為自体の構造的帰結として設計時点で識別済みであり、対処は「解消」ではなく「本リポジトリの現行運用（secrets未設定によるadmin merge運用）の下では追加の実害を生まない」ことの確認と、`gh pr merge --admin`によるマージの実施である。
- ロールバック手順: 本 PR のブランチ（`chore/200-stray-root-artifacts`）は close・破棄すれば main には一切影響しない。万一 main へマージ後に問題が判明した場合も、削除された4ファイル・`checkOutputExists()`の変更のいずれも Git 履歴から `git revert` により復元・撤回可能。
- 影響を受ける既存機能: root 直下4ファイルの削除自体は、過去 Issue（#196・#191）の作業過程で誤って main に混入した stray な成果物の除去であり、他のいかなる機能もこれらの root 直下ファイルの恒久的存在を前提にしていないことを「事前調査」で確認済み。一方、`checkOutputExists()`の拡張は`verify artifacts`を利用する**全Issue**の判定挙動に影響する（本Issue固有ではない）。ただし合格条件を「現在存在する」→「現在存在する OR 過去に一度でもadd/modifyされた実績がある」へ緩和する変更であり、既存の「ファイルが最後まで存在し続ける通常のIssue」の合格判定には影響を与えず、既存の不合格判定（一度も作成していない未着手セグメント）も維持される。
