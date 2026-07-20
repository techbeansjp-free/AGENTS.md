# DESIGN: agent-skill-chain — doctor網羅性拡張・branch-name自己違反・segments.yaml矛盾・PRテンプレート未使用の解消

- Issue: `ISSUE-174`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `doctor.ts`: worktree命名規約チェック（`listWorktrees`+`worktreePathRegex`再利用） | 新規lib関数不要、既存`verify worktree-path`と同一ロジックを直接呼び出す |
| `AC-2` | `doctor.ts`: main worktree cleanチェック（`hasUncommittedChanges`再利用） | 対象は`listWorktrees()[0].path`（主worktree）。cwdが非主worktreeでも正しく主worktreeを判定する |
| `AC-3` | `doctor.ts`: template-syncチェック（`lib/template-sync.ts`新設・共有化） | `verify.ts`の`templateSync()`と実装を共有し、重複を避ける |
| `AC-4` | `doctor.ts`: schemas構文チェック（`resolveAsset('schemas', root)`配下`*.yaml`を`readYamlFile`で構文検査） | JSON Schema自体としての妥当性ではなく、YAML構文としてのparse可否のみを見る |
| `AC-5` | 上記4項目とも、正常系では`Check{ok:true}`を返し既存5項目と合流する | 既存`checks`配列への追加のみ、出力形式（`OK`/`NG`行）は既存踏襲 |
| `AC-6`, `AC-7` | `.agent-skill-chain/config/agent-skill-chain.yaml`の`issue.allowed_types`へ`chore`追加、`.agent-skill-chain/schemas/config.schema.yaml`の対応enum更新 | `branchNameRegex`/`worktreePathRegex`は`config.issue.allowed_types`を動的参照するためコード変更不要 |
| `AC-8` | `.agent-skill-chain/config/segments.yaml`の`validation.outputs`から`pr`削除、`src/commands/verify.ts`の`checkOutputExists()`から`case 'pr':`削除 | `segments.schema.yaml`の`outputs`はenum制約が無いため schema変更不要 |
| `AC-9` | `checkOutputExists()`の`default: return false`へ委譲（安全側） | `acceptance_test_results`/`regression_test_results`の既存判定ロジックは無変更 |
| `AC-10` | `src/commands/pr.ts`の`create()`GitHubモード分岐: PRテンプレート読込→5節挿入→`findIssueWorktree`経由でSPEC.md/DESIGN.mdから可能な範囲を自動充填→`gh pr create --body` | 詳細は「PR本文組み込み方式」節 |
| `AC-11` | 4項目とも既存関数・既存フィールドの追加的拡張のみ（削除・置換を伴うのは`case 'pr':`の1箇所のみで、これは`segments.yaml`側除去と対）であり、影響範囲は限定的 | 影響を受けるテスト一覧は「障害・ロールバック考慮」節 |

## 責務・境界

### コンポーネント構成

- `src/commands/doctor.ts`（既存拡張）: 既存5項目（git／git repository／config／［githubモード時のみ］gh CLI／gh auth）に加え、worktree命名規約・main worktree clean・template-sync・schemas構文の4項目を`checks`配列へ追加する。既存の「1項目=1 Check{label,ok,reason}」構造を踏襲し、新規のCheck表現形式は導入しない。
- `src/lib/template-sync.ts`（新設）: `verify.ts`の`templateSync()`内にあった`listFilesRecursive()`と差分計算ロジックを`computeTemplateSyncDiffs(targetRoot: string): string[]`として抽出する。`verify.ts`の`templateSync()`はこれを呼び出す薄いラッパーに変わり、`doctor.ts`も同じ関数を呼ぶ。ロジックの二重実装を避ける（DRY）。
- `.agent-skill-chain/config/agent-skill-chain.yaml` / `.agent-skill-chain/schemas/config.schema.yaml`: `issue.allowed_types`に`chore`を追加（設定値＋対応enum）。
- `.agent-skill-chain/config/segments.yaml`: `validation`セグメントの`outputs`から`pr`を除去。
- `src/commands/verify.ts`: `checkOutputExists()`の`case 'pr': return true;`を削除する（`default: return false`に委譲）。
- `.agent-skill-chain/templates/github/.github/pull_request_template.md`: 既存の「Issue」「このPRに含まれるセグメント」「自己完結性チェック」の3節はそのまま維持し、「Issue」節の直後に「変更概要」「理由」「影響範囲」「ロールバック方針」「成果物リンク」の5節をプレースホルダ付きで追加する。
- `src/commands/pr.ts`: `create()`のGitHubモード分岐を拡張し、上記テンプレートを読み込んで本文を組み立てる。ローカルモード分岐（Integration Record）は無変更。
- `.agent-skill-chain/standards/GIT_CONVENTIONS.md`: `type: feature | bugfix | hotfix | refactor | docs | process`の列挙に`chore`を追記し、`issue.allowed_types`との整合を保つ（ドキュメント側の陳腐化防止）。

### 依存関係

```text
doctor.ts
  → lib/worktree.ts（listWorktrees, worktreePathRegex, hasUncommittedChanges）  ※既存、無変更
  → lib/template-sync.ts（computeTemplateSyncDiffs）  ※新設、verify.tsと共有
  → lib/paths.ts（resolveAsset）  ※既存、schemas ディレクトリ列挙に利用
  → lib/yaml-io.ts（readYamlFile）  ※既存、schemas構文検査に利用

verify.ts（templateSync）
  → lib/template-sync.ts（computeTemplateSyncDiffs）  ※doctor.tsと共有元を一本化

pr.ts（create, GitHubモード）
  → lib/worktree.ts（findIssueWorktree）  ※既存、issue_idからworktree実体を解決（cwdに依存しない）
  → lib/paths.ts（resolveAsset）  ※pull_request_template.md読込
  → gh pr create --body <組立本文>
```

循環依存は無い。4項目は互いに独立（SPEC.mdの「相互依存はない」記載のとおり）であり、`doctor.ts`・`verify.ts`・`pr.ts`・`config`/`segments`は既存の依存方向（commands → lib → 外部コマンド）を維持する。

## doctor拡張4項目の実装方式（AC-1〜AC-5）

既存`doctor.ts`は「1チェック=1カテゴリ（該当インスタンスが複数あっても集約して1つのCheckとして報告し、`reason`に詳細を列挙する）」という粒度を採用している（例: 既存の「.agent-skill-chain/config/agent-skill-chain.yaml」チェックはファイル1つだが、仮に複数の設定エラーがあってもreason文字列内に列挙する設計）。新規4項目もこの粒度に合わせ、個別インスタンス（worktree複数件・schemaファイル複数件）ごとのCheckを増殖させない。

1. **worktree命名規約**（AC-1）: `root`解決済みかつ`config`読込済みの後、`listWorktrees(root)`を呼び、`verify.ts`の`worktreePath()`と同じ除外規則（先頭の主worktree自身を対象外にする）で残りのworktreeを`worktreePathRegex(config)`に照合する。全滴合ならCheck `{label: 'worktree命名規約', ok: true}`。不適合が1件以上あれば `{ok: false, reason: '<path1>, <path2> は worktree.path_pattern に適合しません'}`。追加worktreーが0件の場合は自明にOK（対象なしでも「OK」表示、AC-5の「4項目全てがOK表示される」を満たす）。
2. **main worktreeのclean状態**（AC-2）: `listWorktrees(root)[0].path`を主worktreeのパスとする（`git worktree list --porcelain`の先頭は常に主worktree、既存コメントで確立済みの前提）。`hasUncommittedChanges(mainPath)`が`false`ならOK。doctorはどのworktree（main／issue用）から実行されても、常に主worktree自体の状態を見る（cwd依存にしない）。
3. **template-sync相当**（AC-3）: `lib/template-sync.ts`の`computeTemplateSyncDiffs(root)`を呼び、空配列ならOK、非空なら`{ok:false, reason: diffs.join('; ')}`。既存`verify template-sync`と全く同じ判定基準（欠落・内容不一致）を用いる。
4. **schemas構文妥当性**（AC-4）: `resolveAsset('schemas', root)`でディレクトリを解決し、`fs.readdirSync`で`*.yaml`を列挙、各ファイルを`readYamlFile()`でtry/catchしながらparseする。1件でも例外が出れば`{ok:false, reason: '<file>: <エラーメッセージ>'}`（複数ある場合は`; `区切りで連結）。JSON Schemaとしての意味的検証（`$schema`準拠等）は行わない（AC-4の要求はYAML構文の妥当性のみ）。

いずれも「root解決失敗時（`repoRoot()`が例外）」の既存分岐の外側（`if (root) {...}`ブロック内）に置き、config読込に失敗した場合はconfigに依存する1・3の2項目をスキップする（既存のgh CLIチェックと同じ「configが無ければ後続をスキップ」方針を踏襲）。4（schemas構文）はconfigに依存しないため、config読込失敗時も独立して実行する。

## `issue.allowed_types`への`chore`追加の影響範囲（AC-6, AC-7）

- **設定値**: `.agent-skill-chain/config/agent-skill-chain.yaml`の`issue.allowed_types`を`[feature, bugfix, hotfix, refactor, docs, process, chore]`に変更する（末尾追加、既存順序は保持）。
- **schema側**: `.agent-skill-chain/schemas/config.schema.yaml`の`properties.issue.allowed_types.items.enum`に`chore`を追加する。ここを更新しないと、実際のconfigは受理可能になっても`agent-skill-chain/config/v1`スキーマとしては不正値扱いになり、schema検証を行う経路（`validateAgainstSchema('config', ...)`を将来的に呼ぶ箇所や、consumer projectが自身のconfigをこのschemaで検証するケース）で矛盾が生じる。examplesブロックは既存のまま（enum網羅の例示ではなく有効値の1サンプルであるため`chore`追加は必須ではない）。
- **既存テストへの影響**: `test/unit/config.test.ts`の`deepEqual(config.issue.allowed_types, [...])`が現状6要素を期待しており、`chore`追加後は7要素の配列に更新が必要（実装フェーズのタスク）。`test/integration/claude-pretooluse.test.ts`は独自の`allowed_types: [feature]`をテスト内で個別に書き込んで検証しており、ベース設定の変更による影響を受けない。
- **ドキュメント側の整合**: `.agent-skill-chain/standards/GIT_CONVENTIONS.md`の`type: feature | bugfix | hotfix | refactor | docs | process`という列挙表記に`chore`を追記する（「参照・コメントの陳腐化防止」原則には抵触しない。これは他ファイルへの位置参照ではなく許容type一覧の直接列挙であり、値そのものの記載）。
- **対象外とする関連物**: `.agent-skill-chain/templates/github/.github/ISSUE_TEMPLATE/`配下は`{bugfix,docs,feature,hotfix,process,refactor}.yml`の6種＋GitHub予約ファイル`config.yml`（Issue Formピッカー設定、typeとは無関係）で構成されるが、`chore.yml`の新設は本Issueのスコープに含めない。理由: SPEC.mdの要件2は「`issue.allowed_types`とschema・関連ドキュメントの整合」のみを求めており、GitHub Issue Form（起票UI）の追加は别関心事（配布物拡張）である。既存の自己矛盾（`chore/162-...`ブランチはIssue Formを経由せず作成されたブートストラップ作業）はIssue Form不在でも解消される（`verify branch-name`はブランチ名文字列のみを見る）。

## `segments.yaml`矛盾解消の影響範囲（AC-8, AC-9）

- **`segments.yaml`側**: `validation`セグメントの`outputs`を`[acceptance_test_results, regression_test_results, pr]`から`[acceptance_test_results, regression_test_results]`へ変更する。
- **`segments.schema.yaml`側**: `properties.segments.items.properties.outputs`は`{type: array, items: {type: string}, minItems: 1}`のみでenum制約が無いため、**schema変更は不要**（`pr`という文字列値自体に対する列挙制約が元々存在しない）。schema_versionの更新も不要（4セグメントのid/next連鎖という構造自体は無変更のため、AGENTS.mdが定める「セグメント自体の追加・変更」には該当しないと判断する。詳細は「関連ADR」節）。
- **`verify.ts`側**: `checkOutputExists()`の`case 'pr': return true;`を削除する。`pr`という文字列はもう`outputs`に出現しないため到達不能コードになるが、削除しない場合「常にtrueを返す出力名」という誤誘導的な分岐が残置され、将来別の出力名として`pr`相当の文字列が誤って復活しても無条件成功してしまう危険がある（安全側ではない）。削除後は`default: return false`に委譲され、未知の出力名は常にNG（欠落）として扱われる——安全側ラチェット（I8）に合致する。
- **既存テストへの影響**: `test/unit/segments.test.ts`の`EXPECTED`配列内、`validation`セグメントの`outputs`から`'pr'`を削除する（実装フェーズのタスク）。`test/integration/verify.test.ts`には`'pr'`出力を直接検証するテストが無いため、`verify artifacts <issue> validation`関連の既存テスト（VALIDATION.mdの有無で成否が切り替わる旨のテスト）は無変更で通過する。

## PR本文組み込み方式（AC-10）

### 前提となる制約: PR作成タイミングでは大半の節が埋まらない

AGENTS.md §4セグメント・4ゲートのフローは「SPECワーカーが最初のcheckpointをpush → SPECワーカーがDraft PRを作成」であり、`pr create`はspecセグメント完了直後、すなわち**DESIGN.md／PLAN.md／VALIDATION.mdがまだ存在しない時点**で呼ばれる。したがって「変更概要・理由・影響範囲・ロールバック方針・成果物リンク」の全節を作成時点で意味のある内容で埋めることは原理的に不可能であり、設計は「どの節が作成時点で自動充填可能か」を切り分ける。

### テンプレート側の変更

`.agent-skill-chain/templates/github/.github/pull_request_template.md`の「## Issue」節の直後に、以下5節をプレースホルダ付きで追加する（既存の「このPRに含まれるセグメント」「自己完結性チェック」の2節はそのまま後続に残す）。

```markdown
## 変更概要

<変更概要をここに記述>

## 理由

<理由をここに記述>

## 影響範囲

<影響範囲をここに記述>

## ロールバック方針

<ロールバック方針をここに記述>

## 成果物リンク

<成果物リンクをここに記述>
```

### `pr.ts`側の充填ロジック（呼び出し元からは受け取らない設計）

`create()`のシグネチャ（`<issue_id> <branch>`）は変更しない。呼び出し元（spec worker）に新規CLI引数で本文各節を渡させる設計は採らない——理由は次の2点。(1) 影響範囲・ロールバック方針はDESIGN.mdの内容そのものであり、spec worker自身がpr create実行時点でこれを正しく記述できる立場にない。(2) 複数行テキストをCLI引数・環境変数経由で安全に受け渡す実装（shellクォーティング・改行エスケープ）は`worker-launch.sh`系の既存adapterとの整合を新たに設計し直す必要が生じ、本Issueのスコープ（既存機構の拡張）を超える。

代わりに、`findIssueWorktree(root, config, number)`（`lib/worktree.js`、既存関数）で解決した対象issueのworktreeパスから、既に存在する成果物ファイルの**雛形で固定された見出し・箇条書きラベル**（自由記述ではなく`.agent-skill-chain/templates/issue/{SPEC,DESIGN}.md`が定める安定した見出し文字列）にのみ依存した抽出を行う。雛形の見出し変更はテンプレート変更（配布物の変更）であり日常的に起こらないため、抽出ロジックが恒常的にずれるリスクは低いと判断する。

| 節 | 充填方法 | 作成時点で埋まる想定 |
|---|---|---|
| 変更概要 | `SPEC.md`のH1行（`# SPEC: <タイトル>`の`<タイトル>`部分） | 埋まる（SPEC.mdは必ず存在） |
| 理由 | `SPEC.md`の`## 目的・背景`節の本文全体 | 埋まる |
| 影響範囲 | `DESIGN.md`が存在すれば、その`## 障害・ロールバック考慮`節内の`- 影響を受ける既存機能: ...`行 | 通常は埋まらない（DESIGN.md未作成のため）。プレースホルダのまま残す |
| ロールバック方針 | 同節内の`- ロールバック手順: ...`行 | 通常は埋まらない。プレースホルダのまま残す |
| 成果物リンク | worktree直下に存在する`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`を、存在するものだけ`` `ファイル名` ``形式で箇条書き | SPEC.mdのみが埋まる（他は後続segmentで追加された時点でPR本文上は反映されないが、diff自体で確認可能なため許容） |

`SPEC.md`/`DESIGN.md`のいずれかが読めない場合（`findIssueWorktree`が`undefined`を返す、または該当ファイルが無い、または該当見出し・箇条書きが見つからない）は、該当節のプレースホルダをそのまま残す（例外を投げてpr create自体を失敗させない——「呼び出し時点で埋まらない節はプレースホルダのまま残す」という設計方針の直接的な実装）。「## Issue」節内の`Closes #<issue-id>`は既存どおり`#${number}`へ機械的に置換する。

### テンプレートファイル不在時のフォールバック

`resolveAsset(path.join('templates','github','.github','pull_request_template.md'), root)`が例外を投げる場合（配布同期前・パッケージ側にも同ファイルが無い状態）は、本文組み立て自体を行わず、**Issue #174着手前の既存挙動と完全に同一の`Closes #${number}`のみの本文**にフォールバックする。これにより既存の`pr create`呼び出し（`test/integration/issue-lifecycle.test.ts`・`github-backend.test.ts`）に対する後方互換を保つ。

### ローカルモードへの影響

`coordination.backend: local`の分岐（Integration Record生成）はPRテンプレートを一切参照しないため無変更。

## 関連ADR

新規の`docs/adr/`配下ADRは作成しない。判断根拠は4項目それぞれについて以下のとおり:

1. **doctor拡張**: 既存`doctor`コマンドへの検査項目追加であり、`doctor`自体の入出力契約（引数なし、終了コード0/1、Check形式の標準出力）や役割・権限モデルを変更しない。既存の「1コマンド=1チェック配列」構造の範囲内の拡張。
2. **`issue.allowed_types`への`chore`追加**: AGENTS.md §設定が定める設定項目「追加」手順の対象は新規キーの追加であり、既存キー（`issue.allowed_types`）の値集合への1要素追加はこの手続きの主眼ではない。またこの変更はconfigの`schema_version`（`agent-skill-chain/config/v1`）が定める構造（キー集合・型）を変えず、許容される値集合を広げるのみであるため、schema_version更新もmigrationも不要と判断する。
3. **`segments.yaml`のoutputs変更**: AGENTS.md §4セグメント・4ゲートが定める「セグメント自体の追加・変更」は4セグメントの`id`集合・`next`連鎖（DAG構造）を指す。`outputs`は各セグメントの成果物チェックリストであり、DAG構造にも`schema_version`が固定するトップレベル構造（`segments`配列の要素数4、`id`enum、`next`enum）にも変更を加えない。既に実装が"no-op"として扱っている出力名を除去する整合修正であり、破壊的変更に該当しないと判断する。
4. **PRテンプレート反映**: `pr create`の入出力契約（`<issue_id> <branch>`という引数、成功時の標準出力仕様）は無変更。GitHubモード分岐内部で`--body`に渡す文字列の組み立てロジックを拡張するのみであり、新たな状態遷移・新たな設定項目（`worker.adapter`のような）を導入しない。

先行するIssue #166（`launch_worker`）も同種の判断（既存起動骨格の横展開・既存設定への対称的追加）でADR作成を見送っており、本Issueもこの先例に従う。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - doctor拡張4項目のいずれかが誤ってOKと判定し続ける（false negative）→ 各項目とも既存の`verify`サブコマンド（`worktree-path`/`template-sync`）または既存lib関数（`hasUncommittedChanges`）と同一ロジックを再利用するため、`verify`側で検出できる不整合はdoctorでも同様に検出できる。schemas構文チェックのみ新規ロジックだが、`readYamlFile`の例外送出に素直に依存するため誤判定の余地は小さい。
  - `chore`追加後、`config.schema.yaml`のenum更新を忘れる→ 実際の設定ファイルはCLIの`loadConfig()`内部でschema検証を必須で通していない場合、動作上は影響が出ないが、consumer projectが自身のconfigをschemaで検証するケースで不整合が露見する。実装フェーズで`agent-skill-chain.yaml`と`config.schema.yaml`を同一コミットで変更することで防ぐ。
  - `segments.yaml`から`pr`除去後、`.github/pull_request_template.md`（配布先コピー）を更新し忘れる→ `.agent-skill-chain/templates/github/.github/pull_request_template.md`（正本）のみ変更して`sync templates`を実行しなければ、本リポジトリ自身の新設doctor template-syncチェックがNGになる（自己矛盾の再発）。実装フェーズの最終ステップで`sync templates .`相当を実行し、doctor自体で無矛盾を確認する。
  - PR本文自動充填ロジックが`SPEC.md`/`DESIGN.md`の見出し表記ゆれ（雛形から逸脱した自由記述）に遭遇し抽出に失敗する→ 例外を投げず該当節のプレースホルダを残す設計のため、pr create自体は失敗しない（劣化のみ）。
- ロールバック手順: 本Issueの変更は (1) `doctor.ts`への4チェック追加、(2) `lib/template-sync.ts`新設＋`verify.ts`のリファクタ、(3) `agent-skill-chain.yaml`/`config.schema.yaml`への`chore`追加、(4) `segments.yaml`からの`pr`除去＋`verify.ts`の`case 'pr':`削除、(5) `pull_request_template.md`拡張＋`pr.ts`の本文組み立てロジック追加、のいずれも既存機能の一部削除（`case 'pr':`のみ）を除き追加的である。当該コミットを`git revert`すれば個別に切り戻せる。`case 'pr':`削除は`segments.yaml`側の`pr`除去とセットでのみ意味を持つため、切り戻す場合は両方を同時にrevertする。
- 影響を受ける既存機能: `verify.ts`の`templateSync()`（ロジックを`lib/template-sync.ts`へ移すリファクタだが、コマンドとしての入出力契約は無変更）。`pr create`のローカルモード分岐（無変更）。`loadConfig()`/`worktreePathRegex()`/`branchNameRegex()`（`issue.allowed_types`を動的参照する既存実装のため、値集合が増えても壊れない）。
