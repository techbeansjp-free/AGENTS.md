# DESIGN: bugfix: PRマージ後もworktreeが自動クリーンアップされず放置され続ける

- Issue: `ISSUE-351`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` merged/closed済みPRに対応する残存worktreeをdoctorが検知し警告する | `doctor`の新規検査項目「マージ済みworktree残存」、`resolveIntegrationStatus()`（`src/lib/integration-status.ts`）、`issueIdFromEntry()`（`src/lib/worktree.ts`） | 既存`checks`配列パターンへの追加 |
| `AC-2` openなPRに対応するworktreeは誤って警告されない | `resolveIntegrationStatus()`の`open`判定 | `merged_or_closed`以外は警告対象に含めない |
| `AC-3` 判定不能な場合は誤って警告しない | `resolveIntegrationStatus()`の`undetermined`判定（gh到達不能・PR未特定・Integration Record不在等を含む） | `merged_or_closed`と同一視しない |
| `AC-4` マージ操作時にworktree放置を防ぐ標準手順が存在する | `.agent-skill-chain/standards/GIT_CONVENTIONS.md`§worktreeの削除への手順明記 ＋ `.agent-skill-chain/project/自己拡張ワークフロー.md`（本リポジトリ自身のdogfooding先）への同内容反映 ＋ AC-1の`doctor`検知を手順漏れの安全網として機能させる | 手順明記＋検知の組み合わせを採用（下記「採用しない代替案」参照） |

## 責務・境界

### コンポーネント構成

- `src/lib/integration-status.ts`（新規）: worktree 1件に対応するIssueのPR/Integration Recordの状態を `'merged_or_closed' | 'open' | 'undetermined'` の三値で判定する、唯一の判定ロジック。GitHubモードは `gh pr list --head <branch> --state all --json state` を1回実行し結果を解釈する。ローカルモードは `integrationFilePath()` が指すIntegration Recordの `status` を読む。
  - 現在 `src/commands/cleanup.ts` に直書きされているPR/Integration Record状態判定（`integrationDone: boolean`算出部分）を本モジュールへ抽出し、`cleanup.ts` はこれを呼び出して `state === 'merged_or_closed'` のみを削除許可条件として使う（`open` / `undetermined` はいずれも従来通り削除拒否＝挙動不変）。
  - `doctor` は同じ関数を呼び、`merged_or_closed` を警告対象、`open` / `undetermined` を非対象として扱う。
  - 判定ロジックの正本を1箇所に集約することで、「削除してよい」と「削除すべきだと警告する」の間で判定基準が乖離するリスクを構造的に排除する（cleanup.tsの既存4条件のうちPR/Integration Record条件のみを対象とし、writer lease・未commit・未pushの3条件は対象外のまま各コマンドに残す）。
- `src/lib/worktree.ts`（既存ファイルへ追加）: `issueIdFromEntry(entry, config)` を追加する。`findIssueWorktree()`（Issue ID → worktree の順引き）の逆方向（worktree → Issue ID）を、`branch.pattern` にキャプチャグループを与えた正規表現で解決する。branch名が規約に適合しない場合は `undefined` を返す（doctorの別検査「branch名規約」が既にこのケースを別途検知するため、本関数はここで警告を出さず静かにスキップ対象とする）。
- `src/commands/doctor.ts`（既存ファイルへ追加）: 新規チェック「マージ済みworktree残存」を既存`checks`配列パターンに追加する。`listWorktrees(root).slice(1)`（主worktreeを除く）の各エントリについて `issueIdFromEntry()` → `resolveIntegrationStatus()` を呼び、`merged_or_closed` の全件を1件のNGとして列挙する（`AC-ID重複`検査等、既存の「複数件あれば全件列挙」パターンを踏襲）。
- `.agent-skill-chain/standards/GIT_CONVENTIONS.md`（既存ファイルへ追記）: §worktreeの削除に、進行役向けの標準手順（マージ完了直後に対象Issueへ `cleanup <issue_id>` を実行する）を追記する。
- `.agent-skill-chain/project/自己拡張ワークフロー.md`（既存ファイルへ追記、本リポジトリのdogfooding用project policy）: 同内容を`## close`節に反映する。

### 依存関係

```text
src/commands/cleanup.ts ─┐
                          ├─→ src/lib/integration-status.ts ─→ gh CLI（github） / Integration Record（local）
src/commands/doctor.ts ──┘        ↑
                                   │
src/commands/doctor.ts ─→ src/lib/worktree.ts（issueIdFromEntry） ─→ git worktree list --porcelain
```

`integration-status.ts` は `cleanup.ts` と `doctor.ts` の双方から依存されるが、両者から依存されるのみで循環は生じない（`integration-status.ts` 自身は `worktree.ts` の型（`WorktreeEntry`）のみを参照し、`cleanup.ts`/`doctor.ts` には依存しない）。

## 関連ADR

```yaml
related_adrs: []
```

`accepted`のADRの中に本設計と直接関連するものは無い。本Issueで新設する`docs/adr/ADR-0016-worktree-cleanup-detection-over-merge-chaining.md`（status: proposed）はこの設計（doctor検知＋手順明記を採用しCLI自動連鎖を採用しない判断）を確定させるADRであり、同一設計セグメントの主成果物であるため`related_adrs:`には計上しない（設計ゲート承認時のfinalizationで`accepted`へ遷移した後、他Issueから参照する場合にのみ`related_adrs:`の対象となる）。

## 判定基準の詳細（`resolveIntegrationStatus`）

| coordination.backend | 判定 | 結果 |
|---|---|---|
| github | `gh pr list --head <branch> --state all --json state` が非0終了、またはJSON parse失敗 | `undetermined` |
| github | 結果が0件（対象branchのPRが1件も見つからない） | `undetermined` |
| github | 結果に `state: MERGED` または `state: CLOSED` のPRが1件以上含まれる | `merged_or_closed` |
| github | 上記以外（`OPEN`のみ） | `open` |
| local | Integration Recordファイルが存在しない、または読込・parse失敗 | `undetermined` |
| local | `status` が `merged` または `closed` | `merged_or_closed` |
| local | `status` が `draft` または `ready_for_review` | `open` |

この表は `cleanup.ts` が現在持つ判定（`integrationDone: boolean`）を全く変更せず三値へ拡張したものである。`cleanup.ts` 側は `state === 'merged_or_closed'` のみを許可条件として扱うため、既存の削除許可・拒否の挙動（`open`/`undetermined`はいずれも拒否）は一致する。

同一branchに複数PRが存在し状態が混在する場合（例: 過去にcloseされたPRと、branchを再利用した新規openなPR）に `merged_or_closed` 側へ倒す挙動は、`cleanup.ts` の既存ロジックをそのまま継承したものであり、本Issueが変更する対象（`cleanup`自体の削除条件判定ロジック）には含まれない。

## 採用しない代替案（AC-4）

要件は「進行役向け手順への明記」「マージ操作への自動連鎖」のいずれか、または組み合わせを許容する。以下の理由でマージ操作への自動連鎖（例: `agent-skill-chain pr merge <issue_id>` のような新規CLIサブコマンドを新設し、`gh pr merge` 実行後に自動で `cleanup` を連鎖実行する）は採用しない。

- 現状のCLIには `pr create` はあるが `pr merge` に相当するコマンドが存在せず、新設は本Issueのスコープ（SPEC.mdの「`cleanup`自体の削除条件判定ロジックの変更」除外、および「いつ・誰が呼び出すか」に限定する方針）を超える新規権限境界（進行役のマージ操作そのものをラップする）を導入する。
- `cleanup`自体は既に「writer lease不在・未commit/未push差分無し・PR完了済み」の4条件を安全側に検査してから削除するため、仮に連鎖呼び出しのタイミングを誤っても実害（意図しない削除）は`cleanup`自身の既存ガードで防がれる。したがって自動連鎖が得る限界的な安全性向上は小さい。
- 一方、AC-1の`doctor`検知は「手順が実行されなかった場合」を機械的に検知する安全網として独立に機能する。実害report 2（本リポジトリ自身で12件の放置が発生した事例）は、そもそも`doctor`にこの検知が存在しなかったために気づけなかったものであり、`doctor`検知の追加自体が実害の再発を防ぐ主要な対策になる。標準手順の明記は「最初から放置を発生させない」ための一次防御、`doctor`検知は「発生してしまった放置を早期に気づける」ための二次防御であり、両者の組み合わせで要件を満たす。
- 自動連鎖はマージ操作の実行系（`gh pr merge`の呼び出し経路）を進行役の裁量から本CLIの制御下へ移すため、将来的にマージ前後の追加処理（例: ADR-0007のroot-cleanup連鎖）が増えるたびに本コマンドへ機能が集中し、責務が肥大化するリスクがある。現時点でその具体的必要性は無い。

将来、進行役の運用実態として手順明記だけでは不十分であることが新たな実害reportとして再発した場合、その時点で自動連鎖案を別Issueとして再検討する（本ADRのConsequencesに記載）。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `gh` コマンドがネットワーク不調・認証切れ等で失敗する → `resolveIntegrationStatus()` が `undetermined` を返し、doctorは当該worktreeを警告対象に含めない（AC-3が保証する安全側動作。誤検知よりも見逃しを許容する）。
  - `issueIdFromEntry()` がbranch名から抽出できない（branch名規約違反） → 当該worktreeはこの新検査の対象から静かに除外される（別検査「branch名規約」が既に検知するため、二重報告を避ける）。
  - `cleanup.ts` のリファクタ（判定ロジック抽出）により既存の削除許可・拒否挙動が変化する → PLAN.mdの回帰テスト（既存`cleanup`結合テストの全件再実行）で検知する。
- ロールバック手順: 本Issueの変更は既存コマンドの新規追加検査1件・既存ファイル1件の内部リファクタ・ドキュメント2件への追記のみであり、いずれも当該コミットのrevertで完全に戻せる。スキーマ変更・設定項目追加を伴わないため、migrationは不要。
- 影響を受ける既存機能: `agent-skill-chain doctor`（新規NG項目が増える可能性がある。既存の全チェックがOKだった環境で、放置worktreeが実在する場合のみ新たにNGとなる＝既存の正常系には影響しない）。`agent-skill-chain cleanup`（内部実装のみ変更、外部インターフェース・挙動は不変）。
