<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: agent-skill-chain — lint vocab/references の src/ 対象拡大・CLIサブコマンド文脈判定の構造的抜け穴修正

- Issue: `ISSUE-187`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

文脈判定の厳格化（#2）を既存違反是正（#3）より先に行う。厳格化で新たに顕在化する違反も #3 の再カウント・是正に含めるため。対象拡大（#1）と文脈判定（#2）は独立だが、是正（#3）は両者の適用後に「本当に残る違反」を確定させる必要があるため後続にする。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `src/lib/scan.ts`: 既定対象根へ `src/` 追加 | `defaultLiveFileRoots` の根集合へ `path.join(repoRoot, 'src')` を追加（`existsSync` フィルタ維持）。`defaultVocabFileRoots` は継承のため無変更。コメントへ `src/` 追加理由と `bin/`（生成物）を含めない理由を記す | `AC-1` | なし |
| 2 | `src/commands/lint.ts`: 文脈判定へファイル種別ディスパッチ導入 | `hasProseViolation`/`isCodeLikeReference`/`isIdentifierContext` へ `ext` 引数を伝播。`YAML_CONTEXT_EXTENSIONS`（`.yaml`/`.yml`）と `isProseFile`（`ext === '.md'`）を追加。YAML 文脈判定は `YAML_CONTEXT_EXTENSIONS.has(ext)` のとき、CLI サブコマンド文脈判定は `!isProseFile(ext)` のときのみ評価。複合コード識別子・外部語彙許可リスト・上流 3 除外は全 ext 共通で不変。`vocab()` で各ファイルの拡張子を判定チェーンへ渡す | `AC-3`, `AC-4` | なし |
| 3 | `src/`（`src/commands/*.ts`・`src/lib/*.ts`）: 既存違反の分類是正 | #1・#2 適用後に `src/` の全違反を再カウントし、DESIGN.md の是正戦略（コメント散文の正規用語化・自己言及 mention のバッククォート化・禁止参照コメントのインライン化・正当コード識別子のバッククォート付き添字化・`references` の節番号記号を Unicode エスケープ定数へ）で解消する。各是正はコメント・コードの契約要旨を変えない。0 件になるまで反復 | `AC-2` | `#1`, `#2` |
| 4 | `test/unit/scan.test.ts`: 既定対象根テストの更新 | 期待配列へ `src` 含有アサート、`bin` 非含有アサートを追加 | `AC-1` | `#1` |
| 5 | `test/integration/lint.test.ts`: 文脈判定・回帰テストの更新／追加 | (a) 既存の識別子認識テストのうち YAML/CLI ケースを `.yaml`/`.sh` フィクスチャへ移設し非検出の期待を維持。(b) `.yaml` の YAML キー・flow-sequence は非検出、`.sh` の実 CLI サブコマンドは非検出、複合コード識別子・外部語彙許可リストは全 ext 非検出を検証。(c) 散文 `.md` 中の YAML 風・CLI 動詞偶然共起が違反検出される回帰テストを追加（親 commit ビルド版では検出漏れだった対比を含む） | `AC-3`, `AC-4` | `#2` |
| 6 | 全体回帰・CI 継承の確認 | `npm run build && npm test` を全件実行し全通過を確認。CI ワークフローが引数なしで lint ラッパーを呼び新既定（`src/` 含む）を無改修で継承すること、CI 相当の引数なしローカル実行が終了コード0で完走することを実チェックアウト相当の環境で確認 | `AC-5`, `AC-6`, `AC-2` | `#1`〜`#5` |

## 実装順序の見直しについて

作業順序（上記の並び）のみを見直す場合は本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合（例: ディスパッチ方式の変更、`bin/` の扱いの変更）は DESIGN.md の更新および設計ゲートの再通過が必要になる。

## AC-2・AC-6 の検証上の申し送り

作業 worktree から CLI を直接実行すると、実行時ルート解決の既知挙動により既定対象が主 worktree 側の `src/` を指すため、AC-2（引数なし lint の終了コード0）・AC-6（CI 相当の実行）は、実チェックアウト相当（実 `.git` ディレクトリを持つ環境に worktree 内容を配置）で CLI を実行して実測確認する。CI は実チェックアウトで走るため対象拡大は本番で正しく効く。継続的な `src/` 清浄性の回帰保証は CI が担う（`test/helpers/tmp-repo.ts` は `src/` を複製しないため、既定 lint の単体テストは `src/` 内容を回帰対象に含めない）。
