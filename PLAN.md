# PLAN: agent-skill-chain — lint-vocab識別子認識本格実装・ADR-0002 finalize・secret scan CI導入

- Issue: `ISSUE-178`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `docs/adr/ADR-0002-github-lease-git-ref-cas.md`の`status: accepted`確定 | 本design/planフェーズで実施済み（DESIGN.md「ADR-0002実機検証結果」節に証跡記載）。実装フェーズでの追加作業は無し。regression確認のみ`#13`で行う | `AC-6`, `AC-7` | なし（完了済み） |
| 2 | `src/agents-md.ts`の`routes`定義を`src/lib/cli-routes.ts`へ切り出し | `routes: Record<string, Handler>`定義をそのまま新ファイルへ移動し、`agents-md.ts`は`import { routes } from './lib/cli-routes.js'`で参照する形に書き換える。外部から見た挙動（CLIディスパッチ）は不変 | `AC-1`の前提（CLI verbホワイトリストの正本化） | なし |
| 3 | `src/commands/lint.ts`: `isCodeLikeReference()`へYAML識別子文脈判定を追加 | DESIGN.md「A-2」のキー構文・flow-sequence要素の2形態を実装する | `AC-1` | なし |
| 4 | `src/commands/lint.ts`: `isCodeLikeReference()`へコード識別子文脈判定を追加 | DESIGN.md「A-1」の複合識別子（snake_case/camelCase/SCREAMING_SNAKE_CASE）セグメント一致判定を実装する | `AC-1` | なし |
| 5 | `src/commands/lint.ts`: `isCodeLikeReference()`へCLIサブコマンド文脈判定を追加 | DESIGN.md「A-3」の隣接シェルトークン判定を実装する。verbホワイトリストは`#2`の`cli-routes.ts`から導出する | `AC-1` | `#2` |
| 6 | `src/commands/lint.ts`: `EXTERNAL_VOCAB_ALLOWLIST`追加 | `blank_issues_enabled`を含む完全一致許可リストを実装する | `AC-4`の前提 | なし |
| 7 | `src/lib/scan.ts`: `defaultVocabFileRoots()`改修 | `templates`/`config`/`schemas`/`scripts`の一時除外コメント・除外ロジックを撤廃し、`defaultLiveFileRoots()`と同一集合を返すようにする | `AC-4` | なし |
| 8 | `test/integration/lint.test.ts`へ識別子文脈の新規テストケース追加 | 3種の識別子文脈（YAML/CLI/コード識別子）それぞれについて「除外される例」と「隣接する散文誤用は除外されない例」を対で検証するテストを追加する。AC-1・AC-2のGiven/When/Thenをそのままテストとして再現する（SPEC.md AC-1のGiven例：`issue:`・`issue_id`・`agent-skill-chain issue start`の3種＋散文誤用1行を含むテストファイル） | `AC-1`, `AC-2` | `#3`〜`#6` |
| 9 | 既存テスト（バッククォート・placeholder・パストークン除外、パス形式禁止語特例、GLOSSARY.md恒久除外）の再実行確認 | `test/integration/lint.test.ts`の既存4テストケースが`#3`〜`#7`適用後もpassすることを確認する（新規コードは書かない、確認のみ） | `AC-3`, `AC-5` | `#3`〜`#7` |
| 10 | `.agent-skill-chain/{templates,config,schemas,scripts}/`の残存誤検出を内容修正で是正 | `node bin/agents-md.js lint vocab .agent-skill-chain/templates .agent-skill-chain/config .agent-skill-chain/schemas .agent-skill-chain/scripts`を実行し、DESIGN.md「B. 残存誤検出の内容是正」表の3件（「ドキュメント」プロース、「ブロック」中の「ロック」衝突、ドット区切り`issue.*`のバッククォート付与）を修正する。修正のたびに同コマンドを再実行し、0件になるまで反復する | `AC-4` | `#3`〜`#7` |
| 11 | `agent-skill-chain lint vocab`（引数無し・デフォルト対象）が終了コード0で完走することを確認 | `#7`・`#10`完了後、リポジトリ全体に対して引数無しで実行し終了コード0を確認する | `AC-4` | `#10` |
| 12 | `src/commands/lint.ts`: `secrets()`サブコマンド新規実装 | DESIGN.md「D」の検出パターン7種・2動作モード（`<path...>`/`--diff <base-ref>`）を実装する。`lint vocab`/`lint references`と同じ`guard`/`isHelp`/`printUsage`/`ok`パターンに従う | `AC-8`, `AC-9` | なし |
| 13 | `src/agents-md.ts`（`#2`で切り出した`cli-routes.ts`）へ`'lint secrets': lint.secrets`ルートを追加 | ディスパッチ登録のみ | `AC-8` | `#2`, `#12` |
| 14 | `.agent-skill-chain/scripts/lint-secrets.sh`新規作成 | 既存`lint-vocab.sh`/`lint-references.sh`と同一構造の薄いラッパー（bin/agents-md.js存在チェック→`lint secrets "$@"`へexec） | `AC-8` | `#13` |
| 15 | `test/integration/lint.test.ts`（またはlint-secrets専用の新規テストファイル）へsecret scanのテストケース追加 | (a) ダミーAWSキー形式文字列（`AKIA`+16文字英数字）を含むファイルを`lint secrets <path>`で検査し終了コード1・該当行が報告されることを確認する（AC-8相当のfile-modeでの自動テスト）。(b) 秘密情報パターンを含まない通常のファイル（本リポジトリの既存ソースの一部等）を検査し終了コード0を確認する（AC-9相当）。(c) `--diff <base-ref>`モードは`test/helpers/tmp-repo.ts`が提供するbare remoteに対しコミットを積んで検証する | `AC-8`, `AC-9` | `#12`〜`#14` |
| 16 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`（正本）へ`lint-secrets`ステップ追加 | DESIGN.md記載のYAMLステップ（Fetch base branch for secret scan + lint-secrets）を`lint-references`ステップの後段に追加する | `AC-8`, `AC-9` | `#14` |
| 17 | `.github/workflows/agent-skill-chain-ci.yml`（配布先）を`#16`と同一内容に同期 | `.agent-skill-chain/ci/verify-template-sync.sh`が両ファイルの内容一致を検査する前提のため、`#16`と完全同一の差分を配布先にも反映する | `AC-11` | `#16` |
| 18 | `verify-template-sync`のローカル実行確認 | `./.agent-skill-chain/ci/verify-template-sync.sh`を実行し終了コード0を確認する | `AC-11` | `#16`, `#17` |
| 19 | 全体回帰確認 | `npm run build && npm test`を実行し、既存テスト＋`#8`・`#9`・`#15`の新規テストがすべてpassすることを確認する。あわせて`node bin/agents-md.js lint adr check`（終了コード0期待、`#1`のregression確認）・`node bin/agents-md.js lint vocab`（引数無し、終了コード0期待）を実行する | `AC-3`, `AC-5`, `AC-7`, `AC-12` | `#1`〜`#18` |

## 実装順序の見直しについて

`#2`（`cli-routes.ts`切り出し）は`#5`（CLIサブコマンド文脈判定）の前提だが、`#3`・`#4`・`#6`とは独立しており並行実装可能。`#12`〜`#18`（secret scan一式）は`#3`〜`#11`（lint-vocab識別子認識一式）と完全に独立しており、並行して着手してよい。`#10`（残存誤検出の内容是正）は`#3`〜`#7`のスキャナ改修が完了していないと「何が本当に残る誤検出か」が確定しないため、必ずスキャナ改修後に行うこと。作業順序のみを見直す場合は本ファイルのみを更新すればよく、`DESIGN.md`の更新は不要である。

## AC-6・AC-7（ADR-0002）についての申し送り

design/planフェーズで以下を実施済み。実装フェーズでの追加作業は不要（regression確認のみ`#19`で行う）。

- 本リポジトリに対する実機push検証（`git commit-tree`によるparentlessコミット作成 → カスタムref namespace `refs/agent-skill-chain/leases/adr0002-verification-178` への push → 非fast-forward pushの`[rejected]`確認 → `git push origin --delete`によるクリーンアップ）を実施し、証跡をDESIGN.mdに記載した。
- 検証成功のため、ADR-0002の`status`のみを`proposed`から`accepted`へ更新済み。Context/Decision/Consequences/`supersedes`は無変更。
- Consequences節の「実機検証がまだ完了していない」という記述との不整合は、ADR本文不変の原則に従い本文を書き換えず、「`status: accepted`への遷移自体が検証完了を意味する」運用としてDESIGN.mdで確定した。新規ADR（ADR-0003等）の作成は不要（要件4の「push失敗時」分岐は不採用のため）。

## AC-10（secret scan required check化）についての申し送り

`#16`・`#17`により、secret scanは新規jobではなく既存`verify`job内のステップとして追加される。`.agent-skill-chain/templates/github/provisioning/rulesets/main.json`の`required_status_checks`には既に`{"context": "verify"}`が含まれているため、ruleset側の変更は不要と設計時点で判断した（DESIGN.md「D」参照）。ただし、AC-10自体は「実際のPR画面・APIでの実測確認」（検証方法見込み: `manual`）を要求するため、検証フェーズ（VALIDATION.md）で以下を行う。

- secret scanが失敗する差分（ダミーAWSキー形式文字列等）を含む使い捨てブランチ・PRを作成し、`gh pr view --json statusCheckRollup`等でrequired checkの未達によりmerge不可状態になることを確認する。
- 確認後、このPRはmergeせず閉じる（SPEC.md AC-8の「テスト用差分・ダミーsecretはリポジトリ履歴に残さない」制約を遵守）。
