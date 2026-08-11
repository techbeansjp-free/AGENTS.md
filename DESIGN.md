<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: root-cleanup runが生成するPRのbase branchが'main'にハードコードされておりdefault branchが異なるリポジトリで必ず失敗する

- Issue: `ISSUE-588`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（default branchがmain以外でもPR作成に成功する） | `root-cleanup.ts` の `run()` 内、PR base決定箇所を `defaultBranch()`（`src/lib/worktree.ts`）呼び出しへ置き換える | 固定文字列 `'main'` を廃止し、`gh pr create --base` に実際のdefault branch名を渡す |
| `AC-2`（default branchがmainのリポジトリでの既存動作が変わらない） | `defaultBranch()` は `origin/HEAD` の symbolic-ref → ローカル `main`/`master` の存在 → `GITHUB_BASE_REF` の順で解決する既存実装であり、default branchが `main` のリポジトリでは従来と同じ `'main'` を返す | 新規ロジックを追加せず、他コマンド（`issue start`・`pr merge`・`verify`）と同一の解決ヘルパーを再利用するため、既存の成功パスへの副作用が無い |
| `AC-3`（default branchを特定できない場合は原因を特定できる形で失敗する） | `defaultBranch()` が解決不能時に投げる `Error`（メッセージ: `デフォルトブランチを特定できません（origin/HEAD 未設定・main/master 不在）`）を `run()` 内でキャッチせず、`guard()`（`src/lib/cli-io.ts`）にそのまま伝播させる | `guard()` は未捕捉の `Error` を `予期しないエラー: <message>` として標準エラー出力へ整形し終了コード1以上を返す既存の共通挙動。base解決を他のgit操作（checkout/rm/commit/push）より前に行うため、原因不明のPR作成失敗ではなく、副作用ゼロの時点で原因が明示された失敗になる |

## 責務・境界

### コンポーネント構成

<主要なコンポーネント・モジュールとその責務を列挙する。1つのコンポーネントに責務が集中していないか（反証観点）を意識する。>

- `src/commands/root-cleanup.ts` の `run()`: repoRoot直下の恒久混入ファイル検出、短命ブランチ作成、commit・push、PR作成、スコープ検査、admin mergeの一連のオーケストレーション。本Issueでの変更は「PR baseとして渡す文字列の決定方法」のみであり、他の責務（検出・スコープ検査・admin merge実行）には触れない。
- `src/lib/worktree.ts` の `defaultBranch()`: リポジトリのdefault branch名解決という単一責務を既に持つ既存ヘルパー。`issue start`（worktree追加先base）・`pr merge`（マージ後ローカル同期先base）・`verify`（成果物差分検査のbase）が既に同一関数へ委譲しており、本Issueは4つ目の呼び出し元を追加するのみで、関数自体のロジックは変更しない。

### 依存関係

<コンポーネント間・外部システムとの依存関係を記述する。循環依存が無いことを確認する。次項の判断が「不要」の場合は下記のテキスト矢印表記のままでよい。>

```text
root-cleanup.ts run() → defaultBranch()（worktree.ts） → git symbolic-ref/rev-parse（外部プロセス）
```

`root-cleanup.ts` は既に `git`/`gh` ラッパー（`src/lib/exec.ts`）に依存しており、`defaultBranch()` もこれらと同じ `git()` ラッパーのみに依存する。`worktree.ts` は `root-cleanup.ts` へ依存しないため循環は生じない（`root-cleanup.ts` が `worktree.ts` の既存exportを1つ追加importするだけの単方向依存）。

### 図示要否の判断

以下のいずれかに該当する場合、図示（Mermaid）を必須とする。該当しない単純な一段の変更では図を強制しない。

- 依存関係（コンポーネント間・外部システム含む）が3つ以上ある
- 状態遷移が2つ以上ある
- 責務境界（コンポーネント）が3つ以上ある

該当する場合は、本ファイル中に ```mermaid フェンス（`graph`・`stateDiagram-v2` 等の軽量記法）で依存関係・状態遷移を記載する。該当しない場合も、判断根拠（該当なしの理由）を必ず記載する。

- 判断: `不要`
- 根拠: 依存関係は「`root-cleanup.ts` → `defaultBranch()`」の1本のみ（`defaultBranch()` 内部の `git` 呼び出しは既存実装のブラックボックスとして扱う）、新規の状態遷移は無し（既存の `run()` の逐次処理の中で1変数の決定方法を差し替えるのみ）、責務境界も上記2コンポーネントのみであり、いずれの基準（3つ以上）にも該当しない単純な一段の変更である。

## 関連ADR

この設計に関連する ADR を構造化リストで記載する（`related_adrs:` フィールド）。ID は `.agent-skill-chain/templates/adr/ADR.md` の `id` と対応させる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。

```yaml
related_adrs:
  - id: ADR-0007
    relation: references
```

`ADR-0007`（root直下混入解消をmain post-merge cleanup自動化で行うという既存の accepted 決定）が定めたPR作成→スコープ検査→admin mergeという一連のフロー自体は本Issueで変更しない。本Issueが追加する `ADR-0043`（本PRで新規作成、`status: proposed`）は、そのフロー内の「PR baseとして渡す文字列の決定方法」のみを対象とする、ADR-0007に対する補足的な決定である。

## 障害・ロールバック考慮

<この設計変更が失敗した場合の影響範囲、切り戻し手段を記述する。反証観点（障害/ロールバック未考慮）に対応する。>

- 想定される失敗モード:
  1. `defaultBranch()` がdefault branchを解決できない（`origin/HEAD` 未設定かつ `main`/`master` ブランチが共に不在かつ `GITHUB_BASE_REF` 未設定）: `run()` は例外を捕捉せず `guard()` に伝播させる。このタイミングは検出処理の直後・git操作（checkout/rm/commit/push・PR作成）より前であるため、リポジトリの状態変更は一切発生しない（副作用ゼロで失敗する）。
  2. `defaultBranch()` が誤ったブランチ名を返す（理論上、対象リポジトリ内に `main`/`master` という名前のブランチが実際のdefault branchとは無関係に存在する等）: これは `defaultBranch()` 自体の既存の解決ロジックの限界であり、本Issueのスコープ外（SPEC.md スコープ外節）。この限界は `issue start`・`pr merge`・`verify` の各既存呼び出し箇所と共通であり、本Issueによって新規に生じる問題ではない。
- ロールバック手順: 本変更は `root-cleanup.ts` 内の1変数の決定方法の差し替え（`const base = 'main'` → `const base = defaultBranch(root)`、および先頭でのimport追加）のみであり、他ファイルへの波及が無いため、当該commitをrevertするだけで完全に旧挙動へ戻せる。設定ファイル・スキーマ・DBスキーマ相当の状態変更は一切伴わない。
- 影響を受ける既存機能: `agent-skill-chain root-cleanup run` のみ。`defaultBranch()` 自体は変更しないため、既存の呼び出し元（`issue start`・`pr merge`・`verify`）の挙動には一切影響しない。
