<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: verify-artifactsのunit_test_results判定をVALIDATION.md結合から分離する

- Issue: `ISSUE-202`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `src/commands/verify.ts` の `checkOutputExists()` 内 `unit_test_results` ケースを、`VALIDATION.md` 判定から独立した新ロジック（`test/` ディレクトリのbaseブランチ差分検査）へ差し替える | `acceptance_test_results`/`regression_test_results` とは別条件分岐に切り出す |
| AC-2 | `unit_test_results` ケースの切り出しにより、`acceptance_test_results`/`regression_test_results` の既存条件式（`VALIDATION.md` の存在または `wasEverAddedOrModified()` による履歴実績）はコード上そのまま残す（削除・変更しない） | switch文の当該2ケースへは一切手を入れない |
| AC-3 | `test/integration/verify.test.ts` の既存テスト（implementationセグメントテストがVALIDATION.md作成を前提としている箇所）を、VALIDATION.mdを作成せず `test/` 配下ファイルの変更で `unit_test_results` が充足する形へ更新し、4セグメント通しの合否遷移を回帰確認する | 実装・検証は実装／独立検証セグメントの責務。本設計は更新方針の確定のみ行う |

## 責務・境界

### コンポーネント構成

- `checkOutputExists()`（`src/commands/verify.ts`）: `output` 種別ごとに1つの判定ロジックを持つswitch文。本Issueでは `unit_test_results` の1ケースのみを差し替え、他ケース（`SPEC.md`/`DESIGN.md`/`PLAN.md`/`ADR`/`code`/`acceptance_test_results`/`regression_test_results`）には触れない。
- `unit_test_results` ケース（新設ロジック）: `code` ケースと同一の技法（`git(['diff', '--stat', 'BASE...HEAD', '--', <pathspec>], worktreePath)`、baseブランチとの三点差分）を、pathspecのみ `test`（このリポジトリの実際のテスト配置規約 `test/unit`・`test/integration`・`test/helpers` を包含する最上位ディレクトリ）に変更して再利用する。新規ヘルパー関数・新規ログファイル形式は導入しない。
- `wasEverAddedOrModified()`・`defaultBranch()`・`git()`（既存共有ユーティリティ）: シグネチャ・実装とも変更しない。`unit_test_results` ケースは `defaultBranch()`/`git()` をそのまま呼ぶのみで、`wasEverAddedOrModified()` 自体は本ケースから呼ばない（後述「証跡方式の設計判断」参照）。
- `acceptance_test_results`/`regression_test_results` ケース（既存、変更なし）: `VALIDATION.md` の存在または履歴実績による判定を維持する。validationセグメントの成果物判定は本Issueのスコープ外である。

### 依存関係

```text
verify artifacts <issue> implementation
  → checkOutputExists(worktreePath, 'unit_test_results')
    → defaultBranch(worktreePath)                                            （既存、変更なし）
    → git(['diff', '--stat', 'BASE...HEAD', '--', 'test'], worktreePath)     （既存gitラッパーの再利用。'code'ケースと同一技法・同一関数）

verify artifacts <issue> validation
  → checkOutputExists(worktreePath, 'acceptance_test_results' | 'regression_test_results')
    → fs.existsSync(VALIDATION.md) または wasEverAddedOrModified(worktreePath, 'VALIDATION.md')   （既存、無変更）
```

循環依存なし。`unit_test_results` の判定経路は `acceptance_test_results`/`regression_test_results` の判定経路と完全に独立し、`VALIDATION.md` を一切参照しない。これによりSPEC.md AC-1（実装セグメントの判定がVALIDATION.mdの有無に左右されない）を構造的に満たす。

## 証跡方式の設計判断

`unit_test_results`（実装セグメントで単体テストが書かれた実績）の充足証跡として、**「`test/` ディレクトリ配下ファイルの、baseブランチから分岐後の三点差分（`git diff --stat base...HEAD -- test`）に変更が存在すること」**を採用する。判定式は `code` ケースの `git diff --stat` 呼び出しと同一の関数・同一のフラグ構成で、pathspec のみを差し替えたものであり、新しい判定メカニズムを導入しない。

この方式は「実装セグメントでテストが実際に *パスした* こと」までは検証しない。この点は既存の `code` ケースが「コードが実際に動作すること」までを検証していないのと同じ位置付けであり、判定の厳密さの水準に一貫性を持たせる。テストが実際に実行され合格することの保証は `.agent-skill-chain/standards/TEST_POLICY.md` の「常時必須」区分（単体テスト・lint/format・型検査等）が別途CIの必須チェックとして担い、`unit_test_results` の本判定はそれとは独立した「テスト作業がこのブランチで行われたことの機械的痕跡」の確認に責務を限定する。

採用理由・却下した代替案（専用テスト実行ログファイル方式・設定可能なテストディレクトリパターン方式）の詳細な比較は、本判断の由来として `ADR-0006` に記録する。

```yaml
related_adrs:
  - id: ADR-0006
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード: `defaultBranch(worktreePath)` が解決不能な環境（shallow clone等でbaseブランチ未フェッチ）では `git diff --stat` がエラー終了し `diff.status !== 0` となるため、`unit_test_results` は「欠落」判定（安全側）になる。これは既存の `code` ケースと全く同じ失敗モードであり、新規の失敗系統を導入しない。
- ロールバック手順: 変更は `checkOutputExists()` 内の `unit_test_results` 1ケースの条件式差し替えのみに閉じる。当該ケースを変更前の内容（`VALIDATION.md` 存在または履歴実績での代替判定）に戻せば即座に旧挙動へ復帰できる。他のケース・他ファイルへの変更を伴わないため、切り戻しに副作用は無い。
- 影響を受ける既存機能: `acceptance_test_results`/`regression_test_results`・`code`・`SPEC.md`/`DESIGN.md`/`PLAN.md`/`ADR` の各判定ケースは条件式・呼び出し関係とも変更されないため無影響（AC-2）。`test/integration/verify.test.ts` のうち、implementationセグメントの成功条件としてVALIDATION.md作成を前提としていた既存テスト（PLAN.md変更単位2で特定）は、本ロジック変更により前提が変わるため更新が必須であり、更新しない場合はその既存テストが本Issue適用後に失敗する（regressionとして検出される）。
