<!--
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# SPEC: Issue成果物テンプレート・ADRテンプレート自体がAGENTS.md禁止のセクション番号参照を含み全Issueへ伝播する

- Issue: `ISSUE-592`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/592-template-section-reference-cleanup`

## 目的・背景

AGENTS.md「参照・コメントの陳腐化防止」は、規範文書・ソースコードコメントにおけるセクション番号参照（例：「§3.2を参照」）を、セクション追加・見出し移動のたびに参照が陳腐化しAIが誤って古い位置情報を正しいものと誤解釈するという実害を理由に禁止している。

`.agent-skill-chain/templates/issue/SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`、`.agent-skill-chain/templates/adr/ADR.md` の冒頭1〜2行目には、この禁止パターンに該当する記述が含まれている。具体的には「正本: AGENTS.md 」に続けてAGENTS.md側の見出し名をそのまま埋め込んだ記法であり、SPEC.md・DESIGN.md・PLAN.mdは「§4セグメント・4ゲート」、VALIDATION.mdは「§不変条件I7」、ADR.mdは「§ADR・テンプレート・テスト適用性」をそれぞれ埋め込んでいる。これら5ファイルは他の生きたファイル（スクリプト・スキーマ・CI・標準文書等）とは性質が異なり、1インスタンスがリポジトリ内に留まって保守されるのではなく、Issueが起票されるたびに各segment worker・ADR finalization workerによってIssue branch上の実成果物（各Issueの`SPEC.md`等、および各ADR）へ複製される雛形である。そのため、この不備は放置すると新規Issueが起票されるたびに全成果物へ機械的に複製・伝播し、複製された時点の見出しテキストがその後AGENTS.md側で変更・移動されても、既に複製済みの過去の成果物内の記述は追随せず陳腐化した参照として残り続ける。

`.agent-skill-chain/scripts/lint-references.sh`（`agent-skill-chain lint references`）を対象ファイル単体に対して明示的に実行すると、当該記述は「見出しテキストで解決できないセクション番号参照」として検出される。一方、このリポジトリのCIワークフロー（`.github/workflows/agent-skill-chain-ci.yml`）が実行する既定の引数なし実行（リポジトリ全体を走査対象に含む）では、AGENTS.md自身が同名の見出しを持つため参照が解決可能と判定され、違反として報告されない。この既定走査における非検出の是非（走査対象・解決可否判定ロジックの扱いをどうするか）は本Issueの対象外とし、DESIGN.mdで確定する。本Issueが要求するのは、伝播元となる5ファイルの記述内容自体を、見出しテキストへの直接参照に依存しない形へ修正することである。

2026-08-11、ISSUE-538（PR #585）のCodeRabbitレビューで指摘され、調査の結果ISSUE-538のスコープではなくテンプレート自体の既存不備と判明したため、本Issueとして分離した。

## 要求 → 要件 → 受入条件

### 要求

Issue成果物テンプレート・ADRテンプレートの雛形自体が、AGENTS.mdが禁止するセクション番号参照パターンを含んだ状態で新規Issueへ複製され続けないようにしたい。

### 要件

- `.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md` および `.agent-skill-chain/templates/adr/ADR.md` の冒頭にある「正本: AGENTS.md 」に続けて見出し名を直接埋め込んだ記述（例:「§4セグメント・4ゲート」「§不変条件I7」「§ADR・テンプレート・テスト適用性」）を、AGENTS.mdの見出しテキストへ直接依存しない表現へ修正する。
- 修正後の表現は、由来・追跡・根拠を示す補助情報としてAGENTS.mdへの言及自体は保持してよいが、セクション記号による見出しテキストの直接指定は行わない。
- 修正はテンプレートの意味（どの規約に基づく成果物かという由来情報）を失わせない。
- 対象5ファイル以外の、`.agent-skill-chain/`配下・AGENTS.md自体に既存する同種のセクション記号表記（スクリプト・CI・スキーマ・標準文書等のコメント）は、1インスタンスがリポジトリ内に留まり複製されない別種の対象であり、本Issueの変更対象に含めない。

### 受入条件（Acceptance Criteria）

#### AC-1: 対象5ファイルからセクション番号参照パターンが除去されている

- Given: `.agent-skill-chain/templates/issue/SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`・`.agent-skill-chain/templates/adr/ADR.md` の各冒頭に、AGENTS.mdの見出し名をセクション記号で直接指定する記述（例:「§4セグメント・4ゲート」）が存在する現状がある
- When: 本Issueの修正を適用する
- Then: 上記5ファイルのいずれにもセクション記号を用いたセクション参照が含まれず、各ファイルは引き続きどの規約に基づく雛形かを示す由来情報を保持している
- 検証方法見込み: `automated`

#### AC-2: 対象5ファイルが `lint-references.sh` の検査を単体実行・既定走査のいずれでも通過する

- Given: AC-1の修正を適用したリポジトリの状態がある
- When: `.agent-skill-chain/scripts/lint-references.sh`（`agent-skill-chain lint references`）を、対象5ファイルを明示的なパス指定で実行する場合と、引数なし（既定のリポジトリ全体走査）で実行する場合の両方で実行する
- Then: いずれの実行方法でも、対象5ファイルに起因する禁止参照違反が報告されず、終了コードが0である
- 検証方法見込み: `automated`

#### AC-3: 既存の生きた成果物への回帰が無い

- Given: 対象5ファイル以外の `.agent-skill-chain/` 配下・AGENTS.md自体の記述は本Issueで変更しない
- When: 修正後のリポジトリ全体に対し `.agent-skill-chain/scripts/lint-references.sh`（引数なし、既定のリポジトリ全体走査）を実行する
- Then: 対象5ファイル以外のいずれのファイルについても新規の違反は報告されず、修正前と同様に終了コードが0である
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`・`.agent-skill-chain/templates/adr/ADR.md` の5ファイル以外に存在する同種のセクション記号による見出し参照（`.agent-skill-chain/scripts/`・`.agent-skill-chain/ci/`・`.agent-skill-chain/schemas/`・`.agent-skill-chain/standards/`・`.agent-skill-chain/config/`・`.agent-skill-chain/templates/github/`・`.agent-skill-chain/templates/standard/`・`.agent-skill-chain/templates/lightweight/`・`.agent-skill-chain/templates/project-policy/`・AGENTS.md自体等）の修正。これらはIssueごとに複製される雛形ではなく、1インスタンスがリポジトリ内に留まって保守される別種の対象であり、別Issueとして扱う。
- `.agent-skill-chain/scripts/lint-references.sh`（`agent-skill-chain lint references`）の走査対象範囲・見出し解決可否判定ロジック自体の変更要否の判断。既定走査でAGENTS.mdとの見出し一致により対象5ファイルの違反が非検出となっている現状の扱いは、DESIGN.mdで確定する。
- `docs/adr/` 配下への新規ADR作成。
