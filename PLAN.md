# PLAN: agent-skill-chain — doctor網羅性拡張・branch-name自己違反・segments.yaml矛盾・PRテンプレート未使用の解消

- Issue: `ISSUE-174`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `issue.allowed_types`へ`chore`追加 | `.agent-skill-chain/config/agent-skill-chain.yaml`と`.agent-skill-chain/schemas/config.schema.yaml`のenumへ同一コミットで`chore`を追加する。`.agent-skill-chain/standards/GIT_CONVENTIONS.md`の`type: feature \| bugfix \| ...`列挙にも追記する | `AC-6`, `AC-7` | なし |
| 2 | `segments.yaml`の`pr`除去 | `.agent-skill-chain/config/segments.yaml`の`validation.outputs`から`pr`を削除し、`src/commands/verify.ts`の`checkOutputExists()`から`case 'pr': return true;`を削除する（同一コミットで対にする） | `AC-8`, `AC-9` | なし |
| 3 | `lib/template-sync.ts`新設 | `verify.ts`の`templateSync()`内の`listFilesRecursive()`と差分計算を`computeTemplateSyncDiffs(targetRoot): string[]`として切り出し、`verify.ts`はこれを呼ぶ薄いラッパーに書き換える。既存`verify template-sync`の挙動・出力形式は変えない（既存テスト無破壊であることを確認しながら進める） | `AC-3`の前提 | なし |
| 4 | `doctor.ts`: worktree命名規約・main worktree cleanチェック追加 | DESIGN.mdの方式に従い、既存`checks`配列へ2項目追加する。`listWorktrees`/`worktreePathRegex`/`hasUncommittedChanges`はいずれも既存関数を再利用するのみ | `AC-1`, `AC-2` | なし |
| 5 | `doctor.ts`: template-syncチェック追加 | `#3`で切り出した`computeTemplateSyncDiffs(root)`を呼び、非空なら該当Checkを`ok:false`にする | `AC-3` | `#3` |
| 6 | `doctor.ts`: schemas構文チェック追加 | `resolveAsset('schemas', root)`配下`*.yaml`を`readYamlFile()`でtry/catch parseし、例外があればNGにする | `AC-4` | なし |
| 7 | doctor正常系の確認 | `#4`〜`#6`実装後、意図的に条件を崩さない状態（本リポジトリ自身）で`doctor`を実行し、追加4項目が全てOK表示・終了コード0であることを確認する（実装作業中の暫定確認。正式なテストは`#11`） | `AC-5` | `#4`〜`#6` |
| 8 | `pull_request_template.md`拡張 | `.agent-skill-chain/templates/github/.github/pull_request_template.md`の「## Issue」節直後へ「変更概要／理由／影響範囲／ロールバック方針／成果物リンク」の5節（プレースホルダ付き）を追加する。追加後`sync templates .`相当を実行し、`.github/pull_request_template.md`（配布先コピー）を同期させる（`#5`のtemplate-syncチェックが自己矛盾しないようにするため） | `AC-10`の前提 | `#5` |
| 9 | `pr.ts`: 本文組み立てロジック実装 | `create()`のGitHubモード分岐に、DESIGN.mdの「PR本文組み込み方式」節に従い、`findIssueWorktree`でissueのworktreeを解決→`SPEC.md`のH1行・`## 目的・背景`節抽出→（存在すれば）`DESIGN.md`の`## 障害・ロールバック考慮`節の該当箇条書き抽出→存在する成果物ファイル名の列挙、という順で本文を組み立てる関数を追加する。テンプレート読込失敗時は`Closes #${number}`のみのフォールバックを維持する | `AC-10` | `#8` |
| 10 | 既存テストの更新（regression対応） | `test/unit/config.test.ts`の`allowed_types`期待値に`chore`を追加、`test/unit/segments.test.ts`の`EXPECTED`から`'pr'`を除去する | `AC-7`, `AC-9` | `#1`, `#2` |
| 11 | 新規テスト追加 | (a) `test/integration/doctor.test.ts`へ4項目それぞれの正常系・異常系（worktree命名規約違反、main worktree未commit差分、template不一致、schema構文エラー）を追加、(b) `test/integration/verify.test.ts`または新規テストで`chore/`ブランチの`verify branch-name`成功・既存type/許容外typeのregressionなしを確認、(c) `test/integration/github-backend.test.ts`または新規テストで、gh-stubが記録する`--body`の内容を検証し、`Closes #<id>`に加え5節見出しが含まれることを確認する（テンプレート不在時のフォールバックも別ケースで確認） | `AC-1`〜`AC-4`, `AC-6`, `AC-7`, `AC-10`（`automated`分） | `#1`〜`#9` |
| 12 | 全体回帰確認 | `npm test`を実行し、既存357件超＋新規テストが全てpassすることを確認する。`node bin/agents-md.js doctor`を本リポジトリ自身に対して実行し終了コード0を確認する（dogfooding） | `AC-11` | `#1`〜`#11` |

## 実装順序の見直しについて

`#1`と`#2`は独立した変更単位であり並行実装可能（SPEC.mdの「4件は相互依存がない」との記載どおり）。`#4`〜`#6`（doctorの3系統のチェック追加）も内部的には独立しており、実装順序を入れ替えてよい。`#8`→`#9`（PRテンプレート拡張→pr.ts実装）の順序のみ依存があるため崩さないこと。作業順序のみを見直す場合は本ファイルのみを更新すればよく、`DESIGN.md`の更新は不要である。
