<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: verify-artifactsのunit_test_results判定がVALIDATION.mdの存在に不適切に結合している

- Issue: `ISSUE-202`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/202-unit-test-results-validation-coupling`

## 目的・背景

`src/commands/verify.ts` の `checkOutputExists()` において、implementationセグメントの必須成果物 `unit_test_results` の充足判定が、本来validationセグメント専用の成果物である `VALIDATION.md` の存在（または履歴上の実績）で代替されている設計上の欠陥を修正する。

`.agent-skill-chain/config/segments.yaml` では、成果物の所属セグメントは以下のように定義されている。

- implementationセグメントの `outputs`: `code`, `unit_test_results`
- validationセグメントの `outputs`: `acceptance_test_results`, `regression_test_results`

しかし現行の `checkOutputExists()` は、`unit_test_results` / `acceptance_test_results` / `regression_test_results` の3つすべてを同一の条件（`VALIDATION.md` が worktree 内に存在する、または base ブランチからの分岐後にadd/modifyされた履歴がある）で判定している。`VALIDATION.md` はvalidationセグメントでのみ作成されるファイルであるため、**implementationセグメントの完了時点（validationセグメント着手前）では、`unit_test_results` の判定は必ず失敗する**。これは、implementationセグメントの成果物充足を、まだ着手していないはずの後続segmentの成果物の存在で判定するという、セグメント間の依存方向が逆転した状態であり、`.agent-skill-chain/config/segments.yaml` が定めるセグメントの入出力契約と矛盾する。

本欠陥は Issue #200（mainルート直下に混入した SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md の削除、および削除に伴う `verify-artifacts` の自己言及的誤判定の修正）の実装レビュー中に発見された。Issue #200 が導入した `wasEverAddedOrModified()`（現在ファイルが存在しない場合でも、base ブランチからの分岐後にadd/modifyされた履歴があれば「実績あり」とみなすフォールバック）は `unit_test_results` の判定にも適用されているが、これは「存在」の確認手段を1つ追加しただけであり、判定対象が `VALIDATION.md` であるという結合構造自体は変えていない。したがって本欠陥は Issue #200 の変更が導入したものではなく、Issue #200 以前から存在し、Issue #200 の変更後も解消されていない。

これまで、mainのルート直下に前Issue由来の `VALIDATION.md` が恒久的に混入し続けていた（Issue #200 が修正する別のバグ）ため、新規Issueのworktreeにも常に無関係な `VALIDATION.md` が最初から存在しており、この既存の欠陥が偶然マスクされ続けていた。Issue #200 がその混入を修正した結果、この隠れていた欠陥が露呈した。

## 要求 → 要件 → 受入条件

### 要求

`agent-skill-chain verify artifacts <issue_id> implementation` が、validationセグメントの成果物（`VALIDATION.md`）の有無に左右されず、implementationセグメント自身の作業実績のみに基づいて `unit_test_results` の充足を正しく判定すること。同時に、validationセグメントの既存判定（`acceptance_test_results`/`regression_test_results` の `VALIDATION.md` ベースの判定）は現状のまま維持されること。

### 要件

- 要件1: `checkOutputExists()` における `unit_test_results` の判定条件から、`VALIDATION.md` の存在・履歴への依存を除去する。
- 要件2: 要件1の判定条件は、implementationセグメント自身の作業（例: 実装セグメントでのテスト実行・追加を示す何らかの証跡）に基づくものへ置き換える。この証跡として具体的に何を採用するか（例: テスト実行ログの記録方式、専用の証跡ファイルの形式・命名等）はDESIGN段階で確定する。
- 要件3: `acceptance_test_results`/`regression_test_results` の判定条件（`VALIDATION.md` の存在または履歴上の実績）は変更しない。
- 要件4: 通常のIssue開発フロー（spec→design→implementation→validationの順で進む）において、`agent-skill-chain verify artifacts` が各セグメントで意図したタイミング（そのセグメントの成果物が揃った時点）で正しく合格・不合格になることを、既存の自動テスト群の回帰確認および新規テストで担保する。既存テストのうち、implementationセグメントの合格条件として `VALIDATION.md` の作成を前提としているものは、要件1〜3の変更後は前提が変わるため、DESIGN段階で更新方針を確定する。

### 受入条件（Acceptance Criteria）

#### AC-1: implementationセグメントの `unit_test_results` 判定が `VALIDATION.md` の存在に依存しない

- Given: worktree内で `code`（implementationセグメントの成果物）は充足済みである状態。worktreeルート直下に前Issue由来の無関係な `VALIDATION.md` が混入している場合（別途起票される構造的な穴が未解決の間は起こりうる）は、検証前にそれを除去した状態、または当該Issue自身のvalidationセグメントで新規作成されたものではないことを確認した状態を前提とする
- When: implementationセグメント自身の作業実績（`unit_test_results` の新しい判定条件が要求する証跡）を作成したうえで `agent-skill-chain verify artifacts <issue_id> implementation` を実行する
- Then: `unit_test_results` は欠落として報告されず、implementationセグメントの成果物チェック全体が合格する（このとき当該Issueのvalidationセグメントによる `VALIDATION.md` の作成・参照は行われていない）
- 検証方法見込み: `automated`（`test/integration/verify.test.ts` に新規テストケースを追加し、`VALIDATION.md` を作成しない前提で `unit_test_results` が充足されることを検証する）

#### AC-2: validationセグメントの既存判定に影響を与えない

- Given: worktree内に `VALIDATION.md` が存在する、または base ブランチからの分岐後に add/modify された履歴がある状態
- When: `agent-skill-chain verify artifacts <issue_id> validation` を実行する
- Then: `acceptance_test_results`/`regression_test_results` は本Issueの変更前と同じ条件（`VALIDATION.md` の存在または履歴上の実績）で充足済みと判定され、本Issueによる回帰が無い
- 検証方法見込み: `automated`（既存の `test/integration/verify.test.ts` 内のvalidationセグメント関連テストが本Issue適用後も無修正で通過することを確認する）

#### AC-3: 通常のIssue開発フローで各セグメントのverify artifactsが意図したタイミングで合否判定される

- Given: spec→design→implementation→validationの順で進む通常のIssue開発フロー（各セグメントの成果物を1つずつ揃えていく状態遷移）
- When: 各セグメント完了直前・直後のそれぞれの時点で `agent-skill-chain verify artifacts <issue_id> <segment>` を実行する
- Then: 各セグメントの判定は、そのセグメント自身の成果物（`.agent-skill-chain/config/segments.yaml` が定義する `outputs`）のみに基づいて行われ、未着手の後続セグメントの成果物（例: implementation完了時点で存在しない `VALIDATION.md`）の有無によって不当に不合格にならない。逆に、後続セグメントの成果物が先行セグメントの判定を代替してすり抜けさせることもない
- 検証方法見込み: `hybrid`（`test/integration/verify.test.ts` の自動テストで4セグメント通しの合否遷移を検証しつつ、AC-1/AC-2との整合をコードレビューで確認する）

## スコープ外

- `unit_test_results` の充足証跡として何を採用するか（例: テスト実行ログの記録方法、専用の証跡ファイルの形式・生成タイミング等）の具体的な設計は、本SPEC.mdの範囲外でありDESIGN段階で確定する。
- `code`・`ADR` など、`unit_test_results` 以外の既存 `checkOutputExists()` 判定ロジックの変更は対象外とする。
- `.agent-skill-chain/config/segments.yaml` のセグメント構成・`outputs` 一覧自体の変更（セグメントの追加・変更はAGENTS.mdが定める破壊的変更であり、別途ADRを要する）は対象外とする。
- PRマージのたびにSPEC.md/DESIGN.md/PLAN.md/VALIDATION.mdがmainルート直下へ恒久的に混入するという構造的な穴自体（Issue #200のSPEC.mdが「恒久的解決策は別Issueで検討する」と明記した事項であり、本SPEC.md作成時点でその別Issueはまだ起票されていない）の解決は対象外とする。本Issue（#202）は、この構造的な穴の有無に関わらず `checkOutputExists()` の判定ロジック自体の欠陥を修正するものであり、両者は独立した問題として扱う。
