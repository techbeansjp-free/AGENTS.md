# DESIGN: quickモード(size:quick)で4成果物ファイルの作成義務を免除する

- Issue: `ISSUE-425`
- 対応する SPEC: `SPEC.md`（本Issueは要求自体がquickの適用条件に該当しないメタな変更のため、
  Issue本文をそのまま要求とし、下表はIssue本文の「求める設計」節を要件相当として対応させる）

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| シグナルは免除対象の成果物に一切依存しない場所に置く（循環定義の回避） | `src/lib/quick-mode.ts` の `readSignalFromGitHub`（Issueラベル）・`readSignalFromLocalState`（state.yaml） | 過去の旧システムの失敗（frontmatter方式）を構造的に回避する設計判断はADR-0022に記録 |
| GitHubモード: `size:quick` ラベル | `.agent-skill-chain/templates/github/provisioning/labels.yaml` に `size:quick` を追加 | 既存の `type:*`・`risk:*`・`autonomy:*` と同列 |
| ローカルモード: `state.yaml` の `size` フィールド、`issue start --size quick` | `.agent-skill-chain/schemas/state.schema.yaml` の `size` 追加、`src/commands/issue.ts` の `--size` オプション | worktree作成時点（成果物作成前）に確定 |
| 免除される成果物: SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md相当 | `src/lib/quick-mode.ts` の `QUICK_EXEMPT_OUTPUTS`、`src/commands/verify.ts` の `artifacts()` 内での outputs フィルタ | `ADR`（リポジトリ水準検査）・`code`/`unit_test_results`（差分検査）は免除対象外 |
| ガードレール: risk≠normal / ADR差分 / segments.yaml・AGENTS.md・schemas差分 | `src/lib/quick-mode.ts` の `GUARDRAIL_PATHS`・`riskFromLabels`・`resolveQuickMode` | 抵触時は `quickBlockedNotice()` で理由を標準エラー出力へ明示 |
| commit前の作業ツリー変更もガードレール対象にする（抜け道防止） | `src/lib/quick-mode.ts` の `changedPaths()`（`git diff` の三点差分 + `git status --porcelain`の合算） | 差分解決不能時は `resolvable: false` とし安全側（免除しない）へ倒す |
| 既定（ラベル未付与・size未設定）では現行挙動を一切変えない | `resolveQuickMode()` の早期return（`signal.size !== 'quick'` なら `exempt: false` 固定） | 後方互換。既存の `state.yaml` は `size` を持たなくてもスキーマに適合 |

## 責務・境界

### コンポーネント構成

- `resolveQuickMode()`（`src/lib/quick-mode.ts`）: シグナル読み取り・ガードレール判定を束ねるエントリポイント。「免除してよいか」の最終判定のみを返す。
- `readSignalFromGitHub()` / `readSignalFromLocalState()`: Coordination Backend別のシグナル読み取り。`gh issue view --json labels` または `state.yaml` を読み、`size`・`risk` を解決する。読み取り失敗時は `standard`/`unclassified`（安全側）を返す。
- `riskFromLabels()`: ラベル名の集合から `risk:high`/`risk:normal`/未分類を解決する。
- `changedPaths()` / `pathsFromPorcelainLine()`: base ブランチとの三点差分と未commitの作業ツリー変更を合算したパス集合を作る。ガードレール判定の入力になる。
- `quickBlockedNotice()`: ガードレール抵触理由を固定書式のメッセージへ整形する。
- `src/commands/verify.ts` の `artifacts()`: `resolveQuickMode()` の結果に応じて `def.outputs` から `QUICK_EXEMPT_OUTPUTS` を除外してから存在検査する。免除対象外時（`requested && !exempt`）は理由を標準エラーへ出力する。
- `src/commands/issue.ts` の `start()`: `--size` オプションを解析し、`state.yaml` へ書き込む（ローカルモードのみ有効な入力）。

### 依存関係

```text
verify artifacts (src/commands/verify.ts)
  → resolveQuickMode()（quick-mode.ts）
      → readSignalFromGitHub()   → gh CLI（Issueラベル）
      → readSignalFromLocalState() → local-state.ts（stateFilePath） → state.yaml
      → changedPaths()           → git CLI（diff / status）、worktree.ts（defaultBranch）
  → QUICK_EXEMPT_OUTPUTS でoutputsをフィルタ → checkOutputExists()（既存ロジック、変更なし）

issue start (src/commands/issue.ts)
  → --size を解析 → state.yaml へ size フィールドを書込み（issue start時点、成果物作成前）
```

呼び出し方向は一方通行（`verify.ts`/`issue.ts` → `quick-mode.ts` → `git`/`gh` CLI・`local-state.ts`）であり循環は無い。`quick-mode.ts` は成果物ファイル（SPEC.md等）を一切読まない——これが本設計の中核制約であり、旧システムの循環定義を構造的に回避する部分である。

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は上記のとおり2系統（verify artifacts経由、issue start経由）で、責務境界も5コンポーネント程度の単純な一段呼び出しに留まり、状態遷移も無い。テキスト矢印表記で全体像を追うのに支障がないため図示を必須としない。

## 関連ADR

```yaml
related_adrs: []
```

`docs/adr/ADR-0022-quick-mode-artifact-exemption.md`は本Issueで新設する成果物であり（`status: proposed`、design-gate承認時にfinalizationで`accepted`へ遷移）、同一設計セグメントの主成果物であるため`related_adrs:`には計上しない（他Issueから参照する場合にのみ対象となる、`.agent-skill-chain/templates/adr/ADR.md`の参照ルールと同一取り扱い、Issue #354のDESIGN.mdと同じ扱い）。`accepted`のADRの中に本設計と直接関連するものは無い。

## 障害・ロールバック考慮

- 想定される失敗モード: `gh issue view`の失敗（認証切れ・Issue不在・ネットワーク断）、`state.yaml`の読み取り不能、`git diff`/`git status`の失敗（worktree破損等）。いずれも`resolveQuickMode()`内で捕捉され、`standard`/`resolvable: false`（免除しない）へフォールバックする。quickは明示的なオプトインでのみ成立し、シグナルを読めない状況で誤って免除してはならないため、失敗はすべて安全側（通常フロー強制）に倒す設計である。
- ロールバック手順: `size:quick`ラベルを外す、または`state.yaml`の`size`を削除/`standard`へ戻すだけで即座に通常フローへ復帰する。コード自体を戻す場合も本Issueのcommit（`8b8fcda5`）のrevertのみで完結する（既定の判定ロジックに変更が無いため他機能への副作用なし）。
- 影響を受ける既存機能: `verify artifacts`を経由する全Issueの成果物存在検査。ただし`size:quick`ラベル未付与・`state.yaml`の`size`未設定の間は`resolveQuickMode()`が常に`{requested: false, exempt: false}`を返すため、既存プロジェクトの`verify artifacts`挙動には変化が無い（後方互換）。
