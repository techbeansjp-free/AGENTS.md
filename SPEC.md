<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — doctor網羅性拡張・branch-name自己違反・segments.yaml矛盾・PRテンプレート未使用の解消

- Issue: `ISSUE-174`
- 作成者: `claude`
- 対象ブランチ: `feature/174-gap-batch2`

## 目的・背景

実装チェックリスト（35章）とagent-skill-chain CLI実装とのギャップ分析（`memo/システム刷新/20260719_173313_実装チェックリスト_ギャップ一覧.md`）で識別された、比較的小〜中規模の残課題4件を一括で解消する。個別にIssue化するには小粒だが、放置するとdoctorの検査網羅性・自己整合性（このプロジェクト自身がAGENTS.md/CI規約に違反していないこと）・PR運用品質のいずれかを損ない続けるため、まとめて対応する。

4件はそれぞれ独立した不整合であり、相互依存はない（同一PRでまとめて扱うのは変更規模が小さいためのバッチ化であり、機能的な結合はない）。

1. **doctorの検査範囲不足**: 現状`src/commands/doctor.ts`の`doctor`コマンドはgit有無・gitリポジトリ判定・`.agent-skill-chain/config/agent-skill-chain.yaml`読込・（GitHubモード時のみ）gh CLI有無・gh認証状態の5項目（うち必須3・情報2）のみを検査する。worktree命名規約・main worktreeのclean状態・GitHub配布テンプレート同期・schemas構文という、CI（`.agent-skill-chain/ci/`配下の各verify-*.sh）では検査されているがローカル`doctor`実行では検査されない項目が存在し、開発者がpush前にローカルで問題を検知できない。
2. **branch-name自己矛盾**: `.agent-skill-chain/config/agent-skill-chain.yaml`の`issue.allowed_types`（Issue本文は`branch.allowed_types`と表記するが、実装上の該当キーは`issue.allowed_types`であり、`branch.pattern`の`{type}`部分の許容値としてこの`issue.allowed_types`が参照される）に`chore`が含まれていないため、このリポジトリ自身に実在する`chore/162-agent-skill-chain-bootstrap`等`chore/`プレフィックスのブランチが`agent-skill-chain verify branch-name`で不適合（NG）と判定される。自プロジェクトが自身の規約検査に違反するという自己矛盾を解消する。
3. **segments.yamlの自己矛盾**: `.agent-skill-chain/config/segments.yaml`の`validation`セグメント`outputs`に`pr`が含まれているが、`src/commands/verify.ts`の`checkOutputExists()`の`case 'pr':`は常に`true`を返す実質no-opであり、`outputs`一覧に含める意味がない。これはAGENTS.md「④独立検証」の主成果物定義（受入/統合/回帰テスト・PR）とチェックリストが定める「VALIDATION出力にPR自体を検証項目として含めない」原則との不整合であり、`outputs`定義とその実装の乖離を解消する。
4. **PRテンプレート未使用**: `src/commands/pr.ts`の`pr create`（GitHubモード）は`gh pr create`実行時に本文を`Closes #<id>`のみで生成し、`.agent-skill-chain/templates/github/.github/pull_request_template.md`（変更概要・自己完結性チェック等を含む正式テンプレート）の内容を一切反映しない。作成されるPRが自己完結性チェック・セグメント進捗チェックボックス等、レビュアが必要とする情報を欠いたまま作成され続ける。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #174本文（対象範囲1〜4・成功基準）に基づく要求：

- doctorの検査範囲を拡張し、CIでのみ検査されている項目の一部をローカルでも事前検知できるようにしたい。
- このリポジトリ自身が自身のbranch-name検査に違反しない状態にしたい。
- segments.yamlのvalidation出力定義と実装（checkOutputExists）の不整合を解消したい。
- `pr create`が生成するPR本文に、正式PRテンプレートの内容（変更概要・理由・影響範囲・ロールバック方針・成果物リンク）が反映されるようにしたい。
- 上記変更後も既存テストスイート（357件超）が統合ブランチ`chore/162-agent-skill-chain-bootstrap`上で全てpassする状態を維持したい。

### 要件

- **要件1（doctor拡張）**: `doctor`コマンドに以下4項目の検査を追加する。
  - worktree一覧が`.agent-skill-chain/config/agent-skill-chain.yaml`の`worktree.path_pattern`に適合するか（`git worktree list --porcelain`の各エントリに対し、既存の`worktreePathRegex()`相当のロジックで判定）。
  - main worktree（`repoRoot()`が指すworktree）が未commit差分なし（clean）であるか。
  - `.agent-skill-chain/ci/verify-template-sync.sh`相当の検査（`.github/`とテンプレート配布元`.agent-skill-chain/templates/github/.github/`の同期状態）。
  - `.agent-skill-chain/schemas/*.yaml`自体がYAMLとして構文妥当であるか。
  - 追加した各項目は、意図的に条件を崩した状態（例：worktreeを規約外の名前で作る、main worktreeに未commit差分を作る、`.github/`とテンプレートを乖離させる、schemasに構文エラーを混入する）で正しくNG表示されることを自動テストで確認する。
  - docs/system-spec関連・requirement ID traceability・Durability Backend検査は、ADR-0001（`docs/adr/ADR-0001-docs-system-spec-construction.md`）が`status: proposed`のまま先送り決定済みのため、本Issueでは追加しない（対象外のまま据え置く）。
- **要件2（branch-name自己矛盾解消）**: `.agent-skill-chain/config/agent-skill-chain.yaml`の`issue.allowed_types`に`chore`を追加する。追加後、`.agent-skill-chain/schemas/config.schema.yaml`の`allowed_types`列挙定義・関連ドキュメント（AGENTS.mdやコメントで許容type一覧を列挙している箇所があれば）との整合も確認する。
- **要件3（segments.yaml矛盾解消）**: `.agent-skill-chain/config/segments.yaml`の`validation`セグメント`outputs`から`pr`を削除する。`src/commands/verify.ts`の`checkOutputExists()`の`case 'pr':`分岐は、`segments.yaml`から参照されなくなるため削除するか、あるいはコメントで「segments.yamlのoutputsには含めない、no-op分岐として残置する理由」を明記する（設計フェーズで判断）。`.agent-skill-chain/schemas/segments.schema.yaml`のoutputs列挙値やその他`pr`出力を前提とするテスト・ドキュメントとの整合も確認する。
- **要件4（PRテンプレート反映）**: `src/commands/pr.ts`の`create()`（GitHubモード分岐）が`gh pr create`へ渡す`--body`を、`.agent-skill-chain/templates/github/.github/pull_request_template.md`の内容（Issue参照節・セグメントチェックボックス節・自己完結性チェック節）をベースに、少なくとも変更概要・理由・影響範囲・ロールバック方針・成果物リンクの各節を含む本文へ拡張する。テンプレートファイルが存在しない環境（配布同期前等）でのフォールバック挙動（最低限`Closes #<id>`を含む本文を生成する等）も設計フェーズで定める。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: doctorがworktree一覧のpath_pattern適合を検査する

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml`の`worktree.path_pattern`に適合しない名前のworktreeが`git worktree list`に存在する
- When: `agent-skill-chain doctor`を実行する
- Then: 当該worktreeについてNG表示され、終了コードが1以上になる
- 検証方法見込み: `automated`

#### AC-2: doctorがmain worktreeのclean状態を検査する

- Given: main worktree（repoRootが指すworktree）に未commitの差分（staged/unstaged問わず）が存在する
- When: `agent-skill-chain doctor`を実行する
- Then: main worktree cleanチェックがNG表示され、終了コードが1以上になる
- 検証方法見込み: `automated`

#### AC-3: doctorがverify-template-sync相当を検査する

- Given: `.github/`が`.agent-skill-chain/templates/github/.github/`の配布内容と乖離している（ファイル欠落または内容不一致）
- When: `agent-skill-chain doctor`を実行する
- Then: template-sync検査がNG表示され、終了コードが1以上になる
- 検証方法見込み: `automated`

#### AC-4: doctorがschemas構文妥当性を検査する

- Given: `.agent-skill-chain/schemas/*.yaml`のいずれかにYAML構文エラーが混入している
- When: `agent-skill-chain doctor`を実行する
- Then: 当該schemaファイルについてNG表示され、終了コードが1以上になる
- 検証方法見込み: `automated`

#### AC-5: doctor追加4項目がいずれも正常系でOK表示される

- Given: worktree命名規約・main worktreeのclean状態・`.github/`とテンプレートの同期・schemas構文がいずれも正常な状態
- When: `agent-skill-chain doctor`を実行する
- Then: 追加した4項目全てがOK表示され、既存項目と合わせて終了コード0になる
- 検証方法見込み: `automated`

#### AC-6: verify branch-nameがchore/162-agent-skill-chain-bootstrapで成功する

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml`の`issue.allowed_types`に`chore`を追加済みである
- When: `agent-skill-chain verify branch-name chore/162-agent-skill-chain-bootstrap`を実行する
- Then: 終了コード0になる（現状はNG終了する自己矛盾状態からの解消）
- 検証方法見込み: `automated`

#### AC-7: 既存allowed_typesのブランチ名検査が引き続き正しく動作する

- Given: `chore`追加後の`issue.allowed_types`設定
- When: `feature/`、`bugfix/`等の既存許容typeのブランチ名および許容外type（例：`invalidtype/`）のブランチ名それぞれについて`verify branch-name`を実行する
- Then: 既存許容typeは終了コード0、許容外typeは終了コード1以上のまま変化しない（regressionなし）
- 検証方法見込み: `automated`

#### AC-8: segments.yamlのvalidation.outputsからprが除去される

- Given: `.agent-skill-chain/config/segments.yaml`の`validation`セグメント`outputs`から`pr`を削除済みである
- When: `.agent-skill-chain/schemas/segments.schema.yaml`に対して`segments.yaml`を検証する、または`agent-skill-chain`のsegments読込処理を実行する
- Then: スキーマ適合エラーが発生せず、`validation.outputs`は`[acceptance_test_results, regression_test_results]`のみになる
- 検証方法見込み: `automated`

#### AC-9: verify artifactsがpr除去後も正しく動作する

- Given: 対象IssueのworktreeにVALIDATION.md・受入/回帰テスト結果に相当する記録が存在し、`segments.yaml`の`validation.outputs`から`pr`が除去済みである
- When: `agent-skill-chain verify artifacts <issue_id> validation`を実行する
- Then: `pr`出力の欠落を理由にした誤検知（false negative／false positive）が発生せず、他の必須成果物（acceptance_test_results・regression_test_results）の欠落判定は従来通り正しく機能する
- 検証方法見込み: `automated`

#### AC-10: pr createが生成するPR本文にテンプレート由来の必須節が含まれる

- Given: `.agent-skill-chain/templates/github/.github/pull_request_template.md`が配布済みの環境で`pr create <issue_id> <branch>`（GitHubモード）を実行する
- When: `gh pr create`が呼び出される
- Then: 渡される`--body`に、Issue参照（`Closes #<id>`）に加えて、変更概要・理由・影響範囲・ロールバック方針・成果物リンクの各節が含まれる
- 検証方法見込み: `automated`（`gh`呼び出し部分はテスト内でモック/スタブ化し、生成される本文文字列を検証する）

#### AC-11: 既存357件超のテストが全てpassする

- Given: 本Issueの全変更（doctor拡張・issue.allowed_types更新・segments.yaml更新・pr.ts更新）を`chore/162-agent-skill-chain-bootstrap`統合ブランチ上へ反映した状態
- When: リポジトリのテストスイート全体（`npm test`相当）を実行する
- Then: 既存テスト（357件超）が全てpassし、新規追加テストも全てpassする（regressionなし）
- 検証方法見込み: `automated`

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- doctor全項目中、docs/system-spec関連・requirement ID traceability・Durability Backend検査（`ADR-0001-docs-system-spec-construction.md`が`status: proposed`のまま先送り決定済みのため、本Issueの対象外として据え置く）。
- writer leaseの真の原子性強化（TOCTOU解消）。別Issueで扱う。
- lint-vocabスキャナの識別子・YAML/CLIサブコマンド名認識の本格実装（Issue #171で一時除外されたfollow-up事項）。別Issueで扱う。
- `docs/system-spec/`の新設・構築自体（ADR-0001がacceptedになった後に別Issueで着手する既定方針であり、本Issueはこれに影響しない）。
- `.agent-skill-chain/project/`配下のプロジェクト固有ポリシー文書の変更（本Issueの4項目はいずれもpackage本体（`.agent-skill-chain/config/`・`src/`・`.agent-skill-chain/templates/`）の変更であり、project固有ポリシーの変更を伴わない）。
