# DESIGN: root-cleanup runを永続main worktreeから直接実行すると実行後に一時ブランチのまま取り残されmainへ戻らない

- Issue: `ISSUE-619`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（mainチェックアウト中の復元） | `captureCheckoutState`・`restoreCheckoutState`（`src/lib/checkout-state.ts`）、`run()` オーケストレーション（`src/commands/root-cleanup.ts`） | 一時ブランチ作成前に記録し、ローカルgit操作完了直後に復元する |
| `AC-2`（main以外チェックアウト中の復元） | 同上 | `captureCheckoutState` はブランチ種別を問わずリテラルなブランチ名を記録する |
| `AC-3`（no-opでのチェックアウト状態不変） | 既存の早期 `return ok(...)`（`detectStrayRootArtifacts` が0件の分岐、変更なし） | `captureCheckoutState` 呼び出し自体に到達しない経路を維持する |
| `AC-4`（既存OPENブランチ・PR再利用時のチェックアウト状態不変） | 既存の `existingBranch && pr` 分岐（変更なし） | `performCleanupBranch` を呼ばない経路を維持し、`captureCheckoutState`/`restoreCheckoutState` を一切実行しない |
| `AC-5`（push・PR作成失敗時も復元） | `performCleanupBranch`（`src/commands/root-cleanup.ts`、既存 `if (!pr)` 内ロジックの抽出）、`run()` の復元呼び出し | `performCleanupBranch` がエラーを返しても `restoreCheckoutState` を必ず呼ぶ |
| `AC-6`（CIランナー既存動作への非回帰） | `run()` オーケストレーション（復元成功時のみスコープ検査・admin mergeへ進む既存フローを維持） | 復元処理の追加が成功時の標準出力・終了コード形式を変更しないことをテストで確認する |
| 要件（detached HEADからの復元） | `captureCheckoutState`／`restoreCheckoutState` の `CheckoutState` 判別共用体（`{ kind: 'branch'; name }` \| `{ kind: 'detached'; sha }`） | `git rev-parse --abbrev-ref HEAD` が文字列 `HEAD` を返す場合はdetachedとして現在commitのSHAを記録し、復元時は当該SHAへ `git checkout <sha>` する |
| 要件（復元失敗時のエラー終了・現在ブランチ名の出力） | `restoreCheckoutState` の戻り値（エラーメッセージ文字列 \| `undefined`）、`run()` のfail-closed分岐 | 復元失敗時は `checkRootCleanupPrScope`・`gh pr merge --admin` を実行せず即座にエラー終了する |
| 要件（root-cleanup run自身のadmin mergeがbase branchを前進させた場合のローカル反映。design-gate再通過分：validation-gateで発見された回帰への是正） | `syncBaseBranchAfterAdminMerge`（`src/commands/root-cleanup.ts`、新規） | admin merge成功直後、`captureCheckoutState` で現在のチェックアウト状態を再取得し、`{ kind: 'branch', name: base }`（`base` は今回のPRのマージ先＝`defaultBranch(root)`）と一致する場合のみ `git fetch origin <base>` + `git merge --ff-only origin/<base>` でローカル内容を追随させる。detached HEADの場合、または `base` 以外のブランチへ復元・滞在している場合（AC-2相当）は何もしない。`!pr` 経路（一時ブランチ作成→復元）・`existingBranch && pr` 再利用経路（一切チェックアウトを切り替えない）の両方で、admin merge成功後に共通して1回だけ呼ぶ |

## 是正の背景（validation-gateで発見された回帰）

本Issueの当初設計（ADR-0048決定1）は、チェックアウト状態の復元（`restoreCheckoutState`）をスコープ検査・admin mergeより前に行うことのみを決定しており、admin merge自体が`base`branchの origin 先端を前進させること自体への追随は考慮していなかった。

validation-gateで、`pr merge`（`src/commands/pr.ts`）が`syncMainWorktree()`でmain worktreeを最新化した直後に同一プロセス内で`root-cleanup run`を連鎖呼び出しする既存の構成（ISSUE-590/ADR-0046）において、`root-cleanup run`自身が実行するadmin merge成功後、main worktreeの`main`ローカルブランチ参照が新しいorigin/mainへ追随せず、削除したはずの混入ファイルが復元後のworktreeへ再出現する回帰（`test/integration/pr-merge.test.ts`「pr merge (ISSUE-590 AC-3)」）が発見された。

この回帰は`root-cleanup run`自身の admin merge が引き起こす副作用（自分が進めた`base`の先端に、自分が戻ったチェックアウトを追随させていないこと）であり、`.github/workflows/agent-skill-chain-root-cleanup.yml`が既存で持つ「Sync local checkout to latest main」ステップ（CIランナーの使い捨てcheckoutで同様の目的のために実行される、独立した既存の追従処理）と同種の追従を、`root-cleanup run`自身の内部でも行う設計に是正する。`pr merge`（`src/commands/pr.ts`）自体の変更は不要であり、SPEC.mdのスコープ外節が明示的に除外する「`root-cleanup run` 以外のコマンドのチェックアウト状態管理」には踏み込まない——本是正は`root-cleanup run`自身のチェックアウト状態管理（自身のadmin mergeが生んだ状態への追随）に閉じている。

## 責務・境界

### コンポーネント構成

- `src/lib/checkout-state.ts`（新規）: worktreeのチェックアウト状態（ブランチ名 or detached HEADのSHA）の記録・復元のみを担当する。root-cleanup固有のロジック（対象ファイル検出・PR作成・スコープ検査・マージ判断）には一切関与しない。`src/lib/worktree.ts` の `resolveCurrentBranchInfo`（CI環境の `GITHUB_HEAD_REF` 代替を伴う、検証目的の論理ブランチ名解決）とは別関数として実装する。復元対象は実行前にチェックアウトしていた**実際のref**（ブランチ名またはcommit SHA）であり、CI都合の代替名へすり替えてはならないため。
  - `captureCheckoutState(root): CheckoutState`: 実行開始時点のチェックアウト状態を記録する。
  - `restoreCheckoutState(root, state): string | undefined`: 記録した状態へチェックアウトを戻す。成功時は `undefined`、失敗時は復元先・現在のブランチ名を含むエラーメッセージ文字列を返す（例外を投げない、呼び出し元が確実にハンドリングできるようにするため）。
- `src/commands/root-cleanup.ts`（変更）:
  - `performCleanupBranch(root, branch, stray): { pr: OpenPr } | { error: string }`（新規、既存の `if (!pr)` 内ロジックのリファクタ抽出）: `git checkout -b`・`ensureGitIdentity`・`git rm`・`git commit`・`git push`・`gh pr create` を行い、ローカルのチェックアウト切り替えを伴う処理をこの関数内に閉じ込める。マージ判断・スコープ検査には関与しない（既存の責務分担を維持）。
  - `syncBaseBranchAfterAdminMerge(root, base): string | undefined`（新規、design-gate再通過分）: admin merge成功直後にのみ呼ぶ。`captureCheckoutState(root)` で現在のチェックアウト状態を確認し、`{ kind: 'branch', name: base }` と一致する場合のみ `git fetch origin <base>` + `git merge --ff-only origin/<base>` を実行してローカル内容を追随させる。それ以外（detached HEAD・`base` 以外のブランチ）は何もせず `undefined` を返す。失敗時は復元失敗と同型の、追従先・失敗理由・手動対応を促す日本語エラーメッセージ文字列を返す（例外を投げない）。マージ判断・スコープ検査・`performCleanupBranch` には関与せず、`captureCheckoutState`（`checkout-state.ts`、既存）のみに依存する薄いオーケストレーション補助である。
  - `run()`（変更）: オーケストレーションのみを担当する。`existingBranch && pr` の再利用経路（AC-4）では従来どおり `captureCheckoutState`/`performCleanupBranch`/`restoreCheckoutState` を一切呼ばない。新規ブランチ作成が必要な経路（`!pr`）でのみ、`captureCheckoutState` → `performCleanupBranch` → `restoreCheckoutState` の順に呼ぶ。両経路とも、`gh pr merge --admin` が成功した直後に共通して1回だけ `syncBaseBranchAfterAdminMerge(root, base)` を呼び、失敗時はその戻り値でエラー終了する（admin merge自体の成立は取り消さない）。
- `test/helpers/gh-stub.ts`（変更）: 既存の `failMergeCount`/`failMergeMessage`（admin merge失敗の疑似）と同型の `failPrCreateCount`/`failPrCreateMessage` を追加し、`gh pr create` 呼び出しを意図的に失敗させられるようにする（AC-5の統合テストで、一時ブランチへの切り替え後・PR作成前後の失敗を再現するため）。

### 依存関係

```mermaid
graph LR
  run["run()<br/>(src/commands/root-cleanup.ts)"]
  capture["captureCheckoutState<br/>(src/lib/checkout-state.ts)"]
  restore["restoreCheckoutState<br/>(src/lib/checkout-state.ts)"]
  perform["performCleanupBranch<br/>(src/commands/root-cleanup.ts)"]
  scope["checkRootCleanupPrScope<br/>(既存)"]
  merge["gh pr merge --admin<br/>(既存)"]
  sync["syncBaseBranchAfterAdminMerge<br/>(src/commands/root-cleanup.ts)"]
  git["git checkout/rm/commit/push/fetch/merge --ff-only"]
  ghcreate["gh pr create"]

  run --> capture
  run --> perform
  run --> restore
  run --> scope
  run --> merge
  run --> sync
  perform --> git
  perform --> ghcreate
  restore --> git
  capture --> git
  sync --> capture
  sync --> git
```

循環依存は無い（`checkout-state.ts` は `root-cleanup.ts` に依存しない一方向）。`performCleanupBranch` はマージ判断（`scope`/`merge`）を一切呼ばず、`run()` のみがマージ判断とチェックアウト復元の両方を調停する。`syncBaseBranchAfterAdminMerge` は `merge` 成功後にのみ `run()` から呼ばれ、`captureCheckoutState` を読み取り専用で再利用する（`checkout-state.ts` への新規依存追加は無く、既存の一方向性を維持する）。

### 図示要否の判断

- 判断: `要`
- 根拠: 責務境界（コンポーネント）が `captureCheckoutState`・`restoreCheckoutState`・`performCleanupBranch`・`syncBaseBranchAfterAdminMerge`・`run()` オーケストレーション・`checkRootCleanupPrScope`・admin merge呼び出しの7つで3つ以上に該当し、かつチェックアウト状態の遷移（実行前状態 → 一時ブランチ → 復元成功/復元失敗 → base同期成功/失敗）が2つ以上あるため、上記グラフに加えて状態遷移図を記載する。

```mermaid
stateDiagram-v2
  [*] --> Original: captureCheckoutState（実行前状態を記録。branch名 or detached HEADのSHA）
  Original --> TempBranch: performCleanupBranch内 git checkout -b（!pr経路のみ）
  TempBranch --> Original: restoreCheckoutState 成功
  TempBranch --> RestoreFailed: restoreCheckoutState 失敗
  Original --> ScopeCheckAndMerge: 復元成功後（performCleanupBranchが成功した場合のみ継続）
  ScopeCheckAndMerge --> BaseBranchSynced: admin merge成功 かつ 現在のチェックアウトがbaseと一致（syncBaseBranchAfterAdminMerge）
  ScopeCheckAndMerge --> [*]: スコープ検査失敗（human_required）またはadmin merge失敗（syncは呼ばれない）
  BaseBranchSynced --> [*]: fetch + merge --ff-only 成功で正常終了
  BaseBranchSynced --> SyncFailed: fetch/merge --ff-only 失敗
  SyncFailed --> [*]: エラー終了（admin merge自体は取り消さない。標準エラー出力へ手動同期を促す）
  RestoreFailed --> [*]: エラー終了（標準エラー出力へ復元失敗と現在のブランチ名を出力。スコープ検査・mergeは実行しない）
```

`Original` 状態は「no-op」（AC-3）と「既存OPENブランチ・PR再利用」（AC-4）では一度も離脱しない（`captureCheckoutState`/`performCleanupBranch` 自体を呼ばないため、上記状態遷移に入らない）。ただし「既存OPENブランチ・PR再利用」（AC-4）でも、admin merge自体は毎回実行されるため、`ScopeCheckAndMerge --> BaseBranchSynced` 以降の遷移（`syncBaseBranchAfterAdminMerge`）はAC-4経路にも共通して適用される——この経路では`captureCheckoutState`を`syncBaseBranchAfterAdminMerge`内部で新たに（読み取り専用で）呼ぶだけであり、`Original`状態からの離脱（チェックアウト切り替え）は発生しない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0007
    relation: references
  - id: ADR-0043
    relation: references
```

（`ADR-0007`: root-cleanup run自体の基本動作を確定した既存決定。`ADR-0043`: root-cleanup runのPR base branch解決に関する既存決定。本Issueの新規ADRはチェックアウト状態の復元順序・fail-closed方針についてのみ新たに決定する。）

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `restoreCheckoutState` 自体が失敗する（例: 復元先ブランチの参照が実行中に消失した、worktreeに競合するuntracked/変更内容が生じた等）場合、`run()` はスコープ検査・admin mergeへ進まず、即座にエラー終了する（fail-closed）。この時点で一時ブランチのcommit・push・PR自体は既に成立している可能性があるため、進行役・人間が手動でチェックアウトを復元し、必要ならPRを手動でマージ・クローズできる状態を維持する（一時ブランチ・PRを自動では破棄しない）。
  - `performCleanupBranch` の途中（`git rm`/`commit`/`push`/`gh pr create`）で失敗した場合、`restoreCheckoutState` は必ず呼ばれ、復元が成功すればworktreeは実行前の状態に戻る。復元も失敗した場合は上記と同様にfail-closedでエラー終了する。
  - `syncBaseBranchAfterAdminMerge` が失敗する（例: `fetch` 失敗、ローカルの`base`ブランチにfast-forward不能な差分が既に存在する等）場合、`run()` はエラー終了する。ただし admin merge自体（GitHub側のPRマージ）は既に成立済みであり、これを取り消さない（`syncMainWorktree`・`restoreCheckoutState`と同一の、既に成立した外部操作は巻き戻さないfail-closed方針を踏襲する）。この場合、ローカルの`base`ブランチには混入ファイルが一時的に残ったままとなるため、進行役・人間が手動で `git fetch origin <base> && git merge --ff-only origin/<base>` を実行するか、既存の非同期root-cleanup workflow（push to main契機）による後追い検出・修復、または`.github/workflows/agent-skill-chain-root-cleanup.yml`の「Sync local checkout to latest main」ステップ相当の手動操作で復旧できる。
- ロールバック手順: 本変更はworktreeのチェックアウト状態を復元する処理・admin merge成功後のローカル追従処理を追加するのみで、既存の削除対象ファイル検出・スコープ検査・admin mergeロジック自体は変更しない。問題が生じた場合は本Issueのcommitをrevertすれば、チェックアウト復元処理（および本是正のローカル追従処理）を含まない既存の `root-cleanup run` の動作（本Issue着手前の状態）に戻せる。
- 影響を受ける既存機能: `.github/workflows/agent-skill-chain-root-cleanup.yml` から呼ばれるCIランナー経路（使い捨てcheckout）。AC-6により、成功時の標準出力・終了コード形式に回帰が無いことを統合テストで確認する。CIランナー経路は通常detached HEAD（`actions/checkout`の既定挙動）であるため`syncBaseBranchAfterAdminMerge`の同期条件（`{ kind: 'branch', name: base }` 一致）に該当せず、同ワークフローの既存の明示的な「Sync local checkout to latest main」ステップは本是正後も引き続き必要であり変更しない。`src/commands/pr.ts`（`pr merge`）の`syncMainWorktree()`・`root-cleanup.run()`連鎖呼び出し自体（ISSUE-590/ADR-0046）にも変更を加えない——`pr merge`から見た`root-cleanup run`呼び出しの入出力契約（引数無し、戻り値は終了コードのみ）は不変であり、`pr merge`側のリグレッションテスト（`test/integration/pr-merge.test.ts`「pr merge (ISSUE-590 AC-3)」）は本是正により`root-cleanup run`側の動作が是正された結果として再度passする想定であり、`pr.ts`自体の変更は不要（SPEC.mdのスコープ外節が定める「`root-cleanup run` 以外のコマンドのチェックアウト状態管理」の対象外に留まる）。
