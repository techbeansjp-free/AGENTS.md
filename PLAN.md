# PLAN: gate reviewer prompt digest がclone間のgit abbrev桁数差で再現不能

- Issue: `ISSUE-369`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `buildReviewerPrompt()` の diff 引数修正 | `src/commands/gate.ts`内、判定対象の差分を生成する`git(['diff', '--no-ext-diff', '--no-color', ...])`呼び出しに`--full-index`を追加する。他のセクション生成コードは変更しない | `AC-1` | なし |
| 2 | 差分区間のfull hash検証・既存プロンプト内容の非破壊検証 | `test/integration/gate-judgment.test.ts`（既存の`gate reviewer-prompt`テスト群）に、「判定対象の差分」セクション内の全`index`行が省略hash（40桁未満の16進表記）を含まないことをテキストパターン照合で検証するテストを追加する。あわせて、diff区間を除く他セクション（ルーブリック・AC-ID一覧・出力JSON契約・成果物本文）の文字列が`--full-index`追加前後で同一であることを確認する | `AC-1, AC-4` | `#1` |
| 3 | 複数clone間の出力完全一致テスト | 新規テストファイル（例: `test/integration/gate-reviewer-prompt-determinism.test.ts`）を追加し、DESIGN.md「AC-2テスト構築方針」節のとおり (a)（主検証）一意な内容のblobオブジェクトを機械的に大量投入し、`git rev-parse --short`等の既定abbrev桁数がベースラインcloneを上回ること（＝一意性伸長の実発生）を事前条件アサーションで確認したcloneと、追加投入していないベースラインcloneの両方で`gate reviewer-prompt`を実行し出力バイト列が完全一致することを検証、(b)（補助検証）`core.abbrev`を明示的に異なる値（`7`・`12`・auto相当の未設定）に設定した複数cloneでも同様に出力が一致することを検証。いずれも`evidencePromptDigest()`によるdigestが一致することを含めて検証する | `AC-2` | `#1` |
| 4 | 生成clone・検証clone分離での submit-evidence → verify-evidence 往復テスト | `test/integration/gate-evidence.test.ts`に、reviewer-promptの生成に用いるcloneと`gate verify-evidence`の実行に用いるcloneを別ディレクトリ（総オブジェクト数が異なる状態）に分離したうえで、`gate submit-evidence`で記録した`prompt_digest`が検証clone側での再計算と一致し往復が成功することを検証するテストを追加する | `AC-3` | `#1, #2` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
