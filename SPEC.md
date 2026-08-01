# SPEC: bugfix: mainの恒久的にresolve不能な§参照により全PRのverify CIが常に失敗する

- Issue: `ISSUE-329`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/329-lint-references-permanent-violation`

## 目的・背景

本リポジトリは AGENTS.md の規約により、規範文書・ソースコードコメント内でのセクション見出し参照（例：「§3.2を参照」）を禁止し、`lint references` コマンド（`node bin/agents-md.js lint references`、実装は `src/commands/lint.ts` の `references()`、CI では `.agent-skill-chain/ci/lint-references.sh` 経由で `verify` ジョブが実行）が、検査対象の生きたMarkdownファイル群（AGENTS.md・`.agent-skill-chain/standards`・`templates`・`config`・`schemas`・`scripts`・`ci` 等）の実見出しテキストと参照句を機械的に突き合わせることでこれを強制している。

現在、`main` ブランチ自体に、この禁止に抵触し、かつ恒久的に解消不能な参照句が2箇所存在する。

1. `src/lib/worker-selection.ts` 冒頭のコメント中の `DESIGN.md §選択解決の設計` という参照句。
2. `.agent-skill-chain/scripts/worker-launch.sh` 内のコメント中の同一の参照句。

`DESIGN.md` は Issue ごとに worktree 内へ作成され、当該 Issue のマージ後は成果物として保持されない（AGENTS.md「4セグメント・4ゲート」）。そのため「`DESIGN.md` §選択解決の設計」という見出しは、どの時点の `main` にも実体として存在せず、`lint references` の見出し解決ロジック（`extractHeadings`/`isResolvable`）は常にこれを未解決と判定する。結果として、この2箇所が `main` に存在し続ける限り、`main` を base とする全ての Pull Request の `verify` ジョブは、当該PRでの差分内容に関わらず必ず失敗する。

実際に、以下のオープン中PRすべてで同一の失敗が確認されている：#328（ISSUE-325）・#327（ISSUE-326）・#317（ISSUE-316）・#311（ISSUE-300）・#282（ISSUE-278）・#281（ISSUE-279）。

この状態は、AGENTS.md が定める I2（セグメントゲート、Check Run 成功状態を正本とする）を全PRについて機能不全にしており、CIによる検証という不変条件の土台自体を損なっている。恒久的にresolve不能な参照句を、リポジトリ自身の禁止規約（AGENTS.md「成果物の自己完結性」「参照・コメントの陳腐化防止」）に従って是正し、`main` 上の `lint references` を恒常的に成功する状態へ戻す必要がある。

## 要求 → 要件 → 受入条件

### 要求

`main` ブランチにある、Issue毎に破棄される成果物（`DESIGN.md`）の見出しへ依存した恒久的にresolve不能な参照句2箇所を是正し、`main` を base とする全PRの `verify` ジョブが `lint references` ステップで恒常的に成功するようにしたい。ただし、当該コメントが元々説明していた「なぜこの処理が必要か」という情報自体は失いたくない。

### 要件

- `src/lib/worker-selection.ts` 冒頭コメント中の `DESIGN.md §選択解決の設計` という参照句を、resolve不能な参照に依存しない表現へ置き換える。参照句が説明していた「なぜ」の内容（正本・追跡根拠の趣旨）は保持する。
- `.agent-skill-chain/scripts/worker-launch.sh` 内の同一パターンの参照句についても同様に是正する。
- 是正は上記2箇所のコメント文言のみを対象とし、`worker-selection.ts`・`worker-launch.sh` が実装する実行時ロジック（ワーカー選択解決処理・モデルティア解決処理・アダプタ起動フロー）には一切変更を加えない。
- `node bin/agents-md.js lint references` を、検査対象範囲を変更せずリポジトリ全体（デフォルト対象範囲）に対して実行したとき、違反ゼロ（exit code 0）となること。
- 既存の自動テスト一式（`npm test`）が、本修正の前後でロジック面の破壊がないことを示す形で成功すること。

### 受入条件（Acceptance Criteria）

#### AC-1: `worker-selection.ts` のresolve不能な参照句の除去

- Given: `main` の `src/lib/worker-selection.ts` 冒頭コメントに `DESIGN.md §選択解決の設計` という、現存するどの見出しにも一致しない参照句が含まれている状態
- When: 当該コメントを、resolve不能な参照句を含まない表現へ修正する
- Then: `node bin/agents-md.js lint references` の実行結果において、`src/lib/worker-selection.ts` の当該行が違反として検出されない
- 検証方法見込み: `automated`（`lint references` の exit code および出力内容で機械検証可能）

#### AC-2: `worker-launch.sh` のresolve不能な参照句の除去

- Given: `main` の `.agent-skill-chain/scripts/worker-launch.sh` 内のコメントに、AC-1と同一パターンの `DESIGN.md §選択解決の設計` という参照句が含まれている状態
- When: 当該コメントを、resolve不能な参照句を含まない表現へ修正する
- Then: `node bin/agents-md.js lint references` の実行結果において、`.agent-skill-chain/scripts/worker-launch.sh` の当該行が違反として検出されない
- 検証方法見込み: `automated`（`lint references` の exit code および出力内容で機械検証可能）

#### AC-3: リポジトリ全体での `lint references` 成功

- Given: AC-1・AC-2の是正が適用されたブランチの状態
- When: `node bin/agents-md.js lint references` をリポジトリ全体（デフォルト対象範囲、`test/` 配下は現行仕様どおり対象外）に対して実行する
- Then: exit code 0（違反ゼロ）で終了する
- 検証方法見込み: `automated`（CIの `verify` ジョブ・ローカル実行の両方で exit code を機械検証可能）

#### AC-4: 実行時ロジックの無変更確認

- Given: AC-1・AC-2の是正（コメント文言変更のみ）が適用されたブランチの状態
- When: `npm test` を実行する
- Then: `worker-selection.ts` のワーカー選択解決処理・モデルティア解決処理、および `worker-launch.sh` のアダプタ起動フローに関する既存の自動テストがすべて成功し、本修正前と同一のテスト結果（ロジック上の回帰がないこと）を示す
- 検証方法見込み: `automated`（`npm test` の実行結果で機械検証可能）

## スコープ外

- `lint references` コマンド自体の実装（検査対象範囲の定義・見出し解決ロジック `extractHeadings`/`isResolvable`）の変更は本Issueのスコープ外とする。
- `test/integration/worker-adapters.test.ts`・`test/unit/github-lease.test.ts`・`test/integration/lease-concurrency.test.ts` に存在する同種の `DESIGN.md §…` 参照句の是正は本Issueのスコープ外とする（現行の `lint references` 検査対象範囲に `test/` は含まれないため現時点では無害だが、対象範囲が将来拡張された際の再発可能性については別Issueで扱う）。
- `.github/workflows/` などCIワークフロー定義自体の変更は本Issueのスコープ外とする。
- 「検査対象範囲拡張時の再発防止」および「`(SPEC|DESIGN|PLAN|VALIDATION)\.md §` パターンを見出し照合以前に即座に検出する早期検出機構の追加」は、本Issueの対象外とし、別Issueで扱う。
