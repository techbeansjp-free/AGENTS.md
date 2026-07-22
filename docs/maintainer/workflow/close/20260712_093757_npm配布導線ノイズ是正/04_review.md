---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "0a9dcc5a-8b98-458e-a192-4e514c88c0c4"
---

# レビュー書: npm配布導線ノイズ是正

**プロジェクト名**: npm配布導線ノイズ是正
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。ドキュメントは「生きているドキュメント」として扱い、実装内容と常に同期させます。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容（package.json prepare 追加・README/SETUP.md/claude-hook-e2e.md の npx 記法書き換え・.github/workflows 2 ファイルのコメント/バナー是正）が 00〜03 の受け入れ基準（SC-1〜SC-6）を満たし、かつスコープ外（release-npm/release-marketplace/apm-release ジョブ本体・RELEASE_ENABLED ゲート・NPM_TOKEN ゲート）に踏み込んでいないことを、`git diff` の直接確認と scratchpad での模擬インストール実行により検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**: `package.json`（prepare スクリプト追加）、`README.md`（§導入「1.」節の GitHub 直接参照方式への書き換え）、`.agent-skill-chain/source/SETUP.md`（uninstall 例の書き換え）、`docs/maintainer/claude-hook-e2e.md`（init/enforce 例の書き換え）、`.github/workflows/self-enforce.yml`（issue パス参照 3 箇所の close/ 挿入）、`.github/workflows/release.yml`（バナー文言・issue パス参照の是正）。03_実装計画.md の T1〜T6 に対応。
- **レビュー期間**: 2026-07-12（同日内）
- **レビュー担当者**: verify-and-close サブエージェント（sonnet, reasoning effort high）

---

## 2. 実装内容の確認

**用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス（必須: 完了 または 要修正） |
| --- | --- | --- | --- | --- |
| T1: package.json prepare 追加 | `scripts.prepare` に `"npm run build"` を追加。他フィールド不変 | 2026-07-12 | implement-feature | 完了 |
| T2: README.md 書き換え | §導入「1.」見出し・導入文・全サブコマンド例・バージョンピン留め例を GitHub 直接参照記法へ書き換え | 2026-07-12 | implement-feature | 完了 |
| T3: SETUP.md 書き換え | uninstall 3 例を書き換え＋README §導入へのリンク追加 | 2026-07-12 | implement-feature | 完了 |
| T4: claude-hook-e2e.md 書き換え | init/enforce on/enforce status 3 例を書き換え＋README §導入へのリンク追加 | 2026-07-12 | implement-feature | 完了 |
| T5: self-enforce.yml パス是正 | 16, 57, 100 行目コメント中の issue パスに `close/` を挿入 | 2026-07-12 | implement-feature | 完了 |
| T6: release.yml パス是正+バナー是正 | バナー冒頭文言「保留中」→「取りやめ」、issue 参照末尾に `close/` 移動済み付記 | 2026-07-12 | implement-feature | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: package.json への prepare スクリプト追加

- **実装内容**: `scripts` オブジェクトの末尾に `"prepare": "npm run build"` を追加。`build`/`build:claude`/`typecheck`/`test`/`name`/`bin`/`publishConfig`/`files` は無変更（`git diff` で確認: 差分は 1 行のみ）。
- **変更ファイル**: `package.json`
- **実装方法**: 既存 `build` スクリプト（`tsc && chmod +x bin/agents-md.js`）をそのまま `prepare` フックから呼ぶのみ。新規ロジックなし。
- **確認事項**: `npm ci`/`npm run build` の二重実行時の冪等性 → §3.3 のテスト再実行で検証済み（OK）。

#### タスク 2: README.md §導入「1.」の書き換え

- **実装内容**: 見出しを `### 1. npm 経由（...npm 公開は取りやめ済み）` → `### 1. GitHub 直接参照（...npm レジストリは経由しない）` に変更。導入文に `prepare` フックによる自動ビルドの仕組みを明記。`npx agent-skill-chain <cmd>` を全箇所 `npx github:techbeansjp-free/AGENTS.md <cmd>` に置換（init/upgrade/doctor/uninstall×3/enforce×3 の 9 サブコマンド例＋導線ラベル 1 箇所 = 計 10 箇所以上）。バージョンピン留め例は ADR-2 のプレースホルダ記法 `#<tag-or-branch>` へ書き換え。
- **変更ファイル**: `README.md`（30 行変更: +15/-15 相当のワード単位置換）
- **実装方法**: 文字列置換のみ。新規セクション追加なし。
- **確認事項**: `grep -c 'npx agent-skill-chain' README.md` = 0、`grep -c 'npx github:techbeansjp-free/AGENTS.md' README.md` = 11（03 の想定「9 件以上」を超過達成）。

#### タスク 3: SETUP.md の uninstall コマンド例書き換え

- **実装内容**: 193〜195 行目相当の uninstall 3 コマンドを GitHub 直接参照へ書き換え、直前に `README.md §導入` への相対リンク行を追加（ADR-3 の DRY 方針どおり、仕組みの説明文は追加していない）。
- **変更ファイル**: `.agent-skill-chain/source/SETUP.md`
- **実装方法**: 文字列置換＋リンク行 1 行追加。
- **確認事項**: `grep -c 'npx agent-skill-chain' SETUP.md` = 0、`grep -c 'npx github:techbeansjp-free/AGENTS.md uninstall' SETUP.md` = 3。

#### タスク 4: claude-hook-e2e.md の npx コマンド例書き換え

- **実装内容**: init／enforce on／enforce status の 3 箇所を書き換え、手順 1 の直前に README §導入へのリンクを追加。
- **変更ファイル**: `docs/maintainer/claude-hook-e2e.md`
- **実装方法**: 文字列置換＋リンク行 1 行追加。
- **確認事項**: `grep -c 'npx agent-skill-chain' claude-hook-e2e.md` = 0、`grep -c 'npx github:techbeansjp-free/AGENTS.md' claude-hook-e2e.md` = 3。

#### タスク 5: self-enforce.yml のパス是正

- **実装内容**: 16, 57, 100 行目のコメント中 issue パス 3 件それぞれに `close/` を挿入。
- **変更ファイル**: `.github/workflows/self-enforce.yml`
- **実装方法**: コメント行の文字列挿入のみ。
- **確認事項**: `git diff` の非コメント行（`#` 以外で始まる `+`/`-` 行）が 0 件であることを直接確認済み（§3.3）。3 パスとも `test -e` で実在確認済み。

#### タスク 6: release.yml のパス是正・バナー文言是正

- **実装内容**: 4 行目「npm 公開は今後の課題として保留中であり、」→「npm 公開は取りやめており、」（以降の dormant 説明・再開手順は不変）。11〜12 行目相当の issue 参照末尾に「（docs/maintainer/workflow/close/ 配下へ移動済み）」を付記。
- **変更ファイル**: `.github/workflows/release.yml`
- **実装方法**: コメント行（バナー内の `#` 始まり）の文字列置換・付記のみ。
- **確認事項**: `git diff` の非コメント行が 0 件（§3.3 で直接確認）。`grep -c '保留中'` = 0、`grep -c '取りやめ'` = 1、`grep -c 'close/'` = 1。

---

## 3. テスト結果の確認

本 issue はランタイムコードを持たずドキュメント・設定ファイルの記述修正であるため、単体テスト（Jest 等）は該当なし。03_実装計画.md §6.2 に定義された (a)〜(c) の検証方法を、implement-feature の報告を鵜呑みにせず**本レビューで独自に再実行**した。

### 3.1 単体テスト

該当なし（自動テストコードは無い issue。03_実装計画 §テスト観点はすべて `grep`/`test -e`/`git diff`/`sha256sum` によるシェルベース検証で構成されており、以下 3.2〜3.3 がそれに相当する）。

### 3.2 静的検証（grep/test -e）— 全件再実行

| 検証項目 | コマンド | 結果 |
| --- | --- | --- |
| README.md の registry 前提記法ゼロ | `grep -c 'npx agent-skill-chain' README.md` | 0（該当なし。`grep` 終了コード 1） |
| README.md の GitHub 直接参照記法数 | `grep -c 'npx github:techbeansjp-free/AGENTS.md' README.md` | 11 件（要求は 9 件以上 → 達成） |
| README.md 見出し文言 | `grep -n '^### 1\.' README.md` | `### 1. GitHub 直接参照（開発者・自己拡張向けの補助導線。npm レジストリは経由しない）` |
| SETUP.md の registry 前提記法ゼロ | `grep -c 'npx agent-skill-chain' .agent-skill-chain/source/SETUP.md` | 0 |
| SETUP.md の GitHub 直接参照記法数 | `grep -c 'npx github:techbeansjp-free/AGENTS.md' .agent-skill-chain/source/SETUP.md` | 3 |
| claude-hook-e2e.md の registry 前提記法ゼロ | `grep -c 'npx agent-skill-chain' docs/maintainer/claude-hook-e2e.md` | 0 |
| claude-hook-e2e.md の GitHub 直接参照記法数 | `grep -c 'npx github:techbeansjp-free/AGENTS.md' docs/maintainer/claude-hook-e2e.md` | 3 |
| release.yml バナー文言 | `grep -c '保留中'` / `grep -c '取りやめ'` / `grep -c 'close/'` | 0 / 1 / 1 |
| self-enforce.yml・release.yml のロジック行無差分 | `git diff -- <file> \| grep -E '^[+-]' \| grep -vE '^\+\+\+|^---' \| grep -vE '^[+-]\s*#'` | 両ファイルとも空（差分はすべてコメント行） |
| .github/workflows issue パス 4 件の実在確認 | `test -e` × 4 | 4 件すべて `OK`（`close/` 配下に実在） |
| package.json prepare 追加 | `node -e "JSON.parse(...).scripts.prepare"` | `"npm run build"`、他 scripts/name/bin 等は不変（`git diff package.json` は 1 行のみ） |

### 3.3 E2E/受け入れ検証（scratchpad 隔離環境で本レビューが直接再実行）

**実施環境**: `/tmp/claude-1000/-home-adachi-projects-AGENTS-md/30db091a-9e78-4c90-9c77-e491721ffe18/scratchpad/verify-npm/`（本番リポジトリには一切書き込んでいない。検証後に scratchpad 配下は削除済み。本番リポジトリの `git status` が検証前後で変化していないことを確認済み）。

- **(a) `npm ci` 冪等性検証（03_実装計画 §2.1.3 に対応）**:
  1. `git archive HEAD` でクリーンコピーを作成し、working tree の `package.json` 差分（prepare 追加）をパッチ適用。
  2. `npm ci` 実行 → `prepare` フックが自動発火し `npm run build` が実行され `bin/agents-md.js` が生成されることを確認（ログに `> agent-skill-chain@0.1.0 prepare` → `> agent-skill-chain@0.1.0 build` の実行が出力された）。
  3. 生成物のハッシュ（`sha256sum`）を記録: `4930750e31ec2e12d8d60b739f2cf138be3425ddbf32f2323b2507a2c321214c`。
  4. 明示的に `npm run build` を再実行（CI の二重呼び出しを再現）→ 再度ハッシュを取得 → **完全一致**。
  - **結果**: OK（冪等。二重ビルドで生成物差分ゼロ）。CI での `prepare` 経由の暗黙ビルドと明示 `npm run build` の二重実行は実害を生まないことを実測で確認した。
- **(b) GitHub 直接参照インストールの模擬動作検証（03_実装計画 §2.2.3 に対応）**:
  1. 上記クリーンコピー（`prepare` 追加パッチ適用済み）をローカル git リポジトリ化（`git init && git add -A && git commit`）。
  2. 別ディレクトリ（採用先プロジェクトを模擬）で `npx --yes "git+file://<src_tmp>" init` を実行。
  3. 実行ログで「.agent-skill-chain/ は未配備です（新規配備）」「AGENTS.md をプロジェクトルートにコピーしました」等、正常な `init` フローの出力を確認。
  4. 配備先に `AGENTS.md`・`.agent-skill-chain/source/` が実際に生成されていることを `test -f`/`test -d` で確認（両方 OK）。
  5. npx キャッシュ内（`~/.npm/_npx/.../node_modules/agent-skill-chain/bin/agents-md.js`）にビルド済み bin が生成されていることを確認し、`prepare` フックが git 経由インストール時に自動発火したことを実測で裏付けた。
  - **結果**: OK。`npx github:owner/repo <cmd>` と同一の git インストール機構（`prepare` の自動実行を含む）が機構レベルで正常動作することを、ネットワーク非依存の模擬環境で確認した。実 GitHub 上の `techbeansjp-free/AGENTS.md`（現ブランチ `feature/package-adapter` は未 push）に対する真の E2E は本レビュー時点でも未実施であり、03_実装計画 §5.1 のリスク対策どおり「main マージ後の別途確認」が必要である旨を申し送る（後述 §10）。
- **(c) `.github/workflows` パス修正の機械的確認**: §3.2 の表に記載のとおり、4 件のパス実在確認・2 ファイルのロジック行無差分検証をいずれも本レビューで直接再実行し OK を確認した。

**再実行結論**: implement-feature の完了報告内容（03_実装計画の検証方法どおり実施した旨）は、本レビューの独立した再実行結果と完全に一致した。不一致・矛盾は検出されなかったため、opus へのエスカレーションは不要と判断する。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードスタイル

- **リント結果**: 該当なし（本 issue はコード実装を含まない。Markdown・YAML・JSON の文字列置換のみ）。
- **フォーマット**: 問題なし（既存のインデント・箇条書き構造を維持した最小差分）。
- **型チェック**: 該当なし（TypeScript ソース変更なし。`bin/agents-md.js` はビルド生成物であり本 issue では変更していない）。

#### コードレビュー観点

| 観点 | 確認内容（必須: 1 文） | 結果（必須: OK または 要修正） | コメント（要修正時は理由を記載） |
| --- | --- | --- | --- |
| 可読性 | 見出し・導入文・コマンド例が実態（GitHub 直接参照）と一致し、旧 registry 前提記法が完全に除去されているか | OK | grep 検証で全 3 ファイルとも旧記法ゼロ件を確認 |
| 保守性 | 説明の重複がなく、SETUP.md/claude-hook-e2e.md は README への 1 行リンクのみで済んでいるか（ADR-3 DRY） | OK | 両ファイルとも新規の仕組み説明文を追加せずリンク行のみ |
| パフォーマンス | `prepare` 追加による CI 二重ビルドが実害（生成物差分）を生まないか | OK | §3.3(a) の冪等性実測で確認 |
| セキュリティ | `prepare` が既存 `npm run build` を呼ぶのみで新規の外部通信・シークレット参照を追加していないか | OK | `package.json` の差分は 1 行のみで新規スクリプト内容の追加なし |

### 4.2 指摘事項

指摘なし（重大な設計判断の見直しを要する指摘、軽微な誤字・パス誤りのいずれも検出されなかった）。実装は 02_設計.md の ADR-1〜4、03_実装計画.md の T1〜T6 と 1 対 1 で対応しており、`git diff` による直接確認で以下を検証済み:

- 変更ファイルは 00〜03 が列挙した 6 ファイルのみ（`git status --short` で確認。他ファイルへの意図しない変更は無い）。
- `.github/workflows/self-enforce.yml`・`release.yml` のいずれも、`release-npm`／`release-marketplace`／`apm-release` ジョブ本体・`RELEASE_ENABLED` ゲート・`NPM_TOKEN` ゲート・`on:`／`if:`／`run:`／`jobs:` 等の実行可能行には一切触れていない（非コメント行差分ゼロを機械的に確認済み）。
- `package.json` の `name`／`bin`／`publishConfig`／`files` は無変更（`prepare` キー追加のみ）。

---

## 4.3 二観点レビュー（REVIEW_DUAL_LENS §3 証跡）

### 敵対的観点リスト（反証・破壊を試みた観点と結論）

| # | 攻めた観点 | 結論 |
| --- | --- | --- |
| 1 | ブランチ名にスラッシュ・特殊文字を含む場合、`npx github:owner/repo#<tag-or-branch>` 記法は期待どおり解決するか | 00_要求定義.md §7.1・02_設計 ADR-2 のとおり `main` ブランチ相当の基本形のみ実地検証済みで、全 ref パターンの網羅検証はスコープ外と明記されている。プレースホルダ記法（具体タグ名を固定しない）を採用することでこのリスクを利用者側の裁量に委ねる設計であり、要修正には倒さない（設計判断として妥当・00 に既知リスクとして明記済み）。 |
| 2 | 採用先が `npm install --ignore-scripts` 相当のオプションで `prepare` を無効化した場合、`bin/agents-md.js` が生成されず `npx` が失敗するのではないか | 確認した。この限界は npm の `prepare` ライフサイクル機構そのものに内在するものであり、本 issue（00〜03）のスコープには対策が含まれていない。README には `--ignore-scripts` 非使用が前提と明記されていないため、残存リスクとして本レビューで指摘する（軽微・利用者が明示的にスクリプトを無効化する操作をしない限り発生しないため、致命的ではないと判断し「要修正」には倒さないが §10 に残存課題として記録する）。 |
| 3 | `.github/workflows` の `close/` 挿入・付記が、コメント行の体裁を装いつつ実際には隣接する実行可能行（`run:` の中の複数行文字列等）に混入していないか | `git diff -- .github/workflows/self-enforce.yml .github/workflows/release.yml \| grep -E '^[+-]' \| grep -vE '^\+\+\+\|^---' \| grep -vE '^[+-]\s*#'` を本レビューで直接実行し両ファイルとも出力ゼロを確認した（§3.2）。行単位の機械検証であり、`#` で始まらない差分行が 1 件でもあれば検出される。混入なしと確認。 |
| 4 | `npm ci` の `prepare` 経由の暗黙ビルドと CI が明示的に呼ぶ `npm run build` の二重実行で、非決定的な生成物（タイムスタンプ埋め込み等）が生じ CI の差分検証を壊さないか | §3.3(a) で `sha256sum` により二重実行前後のハッシュ完全一致を実測済み。`tsc` の出力は非決定的要素（ビルド日時等）を含まず冪等であることを確認した。 |
| 5 | release.yml バナーの ASCII ボックス罫線が、文字幅の異なる「保留中」→「取りやめ」置換で崩れ、コメントとして機能しても可読性を著しく損なっていないか | 目視確認した。既存罫線も 02_設計 ADR-4 の evidence_source どおり厳密な等幅を保っていない前提であり、置換後も罫線右端の `│` が保持されていることを確認した。可読性上の重大な劣化は無い。 |
| 6 | SETUP.md・claude-hook-e2e.md に追加したリンク（`../../README.md#導入プロジェクトへ配備するとき`）が、レンダラによって見出しアンカーへ正確にスクロールしない場合、利用者が迷わないか | 03_実装計画.md §5.1 に既知リスクとして明記済み（CJK 見出しアンカーのスラッグ化規則の不安定性）。実害は「ファイルは開けるが見出し位置に飛ばない」程度の軽微なものであり、フォールバック方針（フラグメント無しリンクへの切替）も明記されている。要修正には倒さない。 |

### must-preserve リスト（不変条件と保持の確認）

| # | 不変条件 | 保持確認方法 | 結果 |
| --- | --- | --- | --- |
| 1 | `.github/workflows/release.yml` の `release-npm`／`release-marketplace`／`apm-release` ジョブ本体・`RELEASE_ENABLED` ゲート・`NPM_TOKEN` ゲートのロジックが変更されていないこと | `git diff -- .github/workflows/release.yml` の非コメント行差分ゼロ検証（§3.2） | 保持確認 |
| 2 | `.github/workflows/self-enforce.yml` の `on:`／`if:`／`run:`／`jobs:` 等の実行可能行が変更されていないこと | 同上（self-enforce.yml 側） | 保持確認 |
| 3 | `package.json` の `name`／`bin`／`publishConfig`／`files`／既存 `scripts`（`build`／`build:claude`／`typecheck`／`test`）が変更されていないこと | `git diff -- package.json`（差分は `prepare` キー追加の 1 行のみ） | 保持確認 |
| 4 | README.md §0（`apm install` 一次配布導線）・§2（Claude marketplace 経由）・§3（ローカル配備）のコマンド例・説明文が変更されていないこと | `git diff -- README.md` の hunk 範囲（46, 68-, 99-, 115-, 138- 行目）を確認し、変更が §導入の共通ラベル文および §1（旧 npm 経由）節に限定されていること、`apm install techbeansjp-free/AGENTS.md#release/apm --target claude` 等の§0コマンド例が hunk 外（コンテキスト行）で不変であることを確認 | 保持確認 |
| 5 | uninstall の既定動作（dry-run既定・`.claude`/`.cursor` を丸ごと消さず配備分のみ除去・`--purge`で証跡も削除）というセマンティクスの説明文が変更されていないこと | README.md・SETUP.md の diff でコマンド文字列（`npx agent-skill-chain` → `npx github:...`）のみが置換され、セマンティクス説明の文（表・箇条書き）は非対象行として維持されていることを確認 | 保持確認 |
| 6 | `.github/workflows` の issue パス参照是正が、参照先ドキュメントの内容そのものを変更しないこと（コメントのポインタ修正のみ） | 参照先 4 件（`docs/maintainer/workflow/close/...`）はいずれも本 issue で編集しておらず、`git status --short` にも含まれていないことを確認 | 保持確認 |

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（review-docs でレビュー済み・指摘 0 件） | verify-and-close サブエージェント | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（review-docs でレビュー済み・指摘 0 件） | verify-and-close サブエージェント | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み（review-docs でレビュー済み・指摘 0 件） | verify-and-close サブエージェント | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（review-docs でレビュー済み・指摘 0 件） | verify-and-close サブエージェント | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している。02_設計.md §2.1.1 の責務一覧・§2.5 の ADR-1〜4 が、実装差分（`git diff` で確認した 6 ファイルの変更内容）と 1 対 1 で対応している。
- **要件と実装の整合性**: 整合している。01_要件定義.md のストーリー 1〜4・受け入れ基準がすべて満たされていることを §3.2 の grep/test 検証で確認した（詳細は §6 のカバレッジ表）。
- **コメント**: review-docs（実装前ドキュメントレビュー、memo: `memo/20260712_100112_review-docs.md`）が指摘 0 件で完了済みであり、00〜03 の内容修正は本レビューでも不要と判断した。

---

## 6. 受け入れ基準カバレッジ（generate-scenarios / map-coverage）

01_要件定義.md のユーザーストーリー 1〜4・受け入れ基準、および 00_要求定義.md §6 成功基準（SC-1〜SC-6）と、実装・検証結果の対応表。

| 受け入れ基準・SC | 対応する実装 | 検証方法 | 結果 |
| --- | --- | --- | --- |
| SC-1（README 見出し・導入文の実態整合） | T2 | `grep -n '^### 1\.' README.md` で見出し確認 | 合格 |
| SC-2（README/SETUP.md/claude-hook-e2e.md の registry 前提記法ゼロ） | T2/T3/T4 | 3 ファイルとも `grep -c 'npx agent-skill-chain'` = 0 | 合格 |
| SC-3（バージョンピン留め例の git ref 化） | T2 | README.md 103〜109 行目相当を目視・grep 確認、`#<tag-or-branch>` 記法を確認 | 合格 |
| SC-4（package.json prepare 追加） | T1 | `node -e` で `scripts.prepare === "npm run build"` を確認、他フィールド不変を `git diff` で確認 | 合格 |
| SC-5（.github/workflows issue パス参照 4 件の実在化） | T5/T6 | `test -e` × 4（全件 OK）。release.yml は付記方式（ADR-4）で対応 | 合格 |
| SC-6（release.yml バナー文言整合＋ロジック無差分） | T6 | `grep -c '保留中'`=0・`grep -c '取りやめ'`=1、`git diff` 非コメント行ゼロ | 合格 |
| ストーリー1 BDD シナリオ1（GitHub 直接参照 npx init が成功） | T1+T2 | §3.3(b) の scratchpad 模擬インストールで実測（ローカル git 経由。実 GitHub 経由は未 push のため未実施） | 合格（模擬検証で代替。実 GitHub 経由は §10 に申し送り） |
| ストーリー1 BDD シナリオ2（見出しが実態と一致） | T2 | §3.2 の grep 検証 | 合格 |
| ストーリー2（SETUP.md/claude-hook-e2e.md の一貫性・prepare 追加） | T1/T3/T4 | §3.2 の grep 検証 | 合格 |
| ストーリー3 BDD シナリオ1（self-enforce.yml のパスが実在） | T5 | §3.2 の test -e 検証 | 合格 |
| ストーリー3 BDD シナリオ2（release.yml ロジック行に差分なし） | T6 | §3.2 の git diff 非コメント行ゼロ検証 | 合格 |
| ストーリー4（release.yml バナーが最新方針を反映） | T6 | §3.2 の grep 検証 | 合格 |

**未達一覧**: なし。全受け入れ基準・BDD シナリオがテストコード化可能な範囲（grep/test -e/git diff/sha256sum によるシェル検証）で網羅され、合格した。実 GitHub 経由の真の E2E（現ブランチ未 push のため）のみが未実施であり、03_実装計画.md §5.1 に記載済みの既知のリスクとして申し送る（§10 参照）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本変更は README.md §導入・SETUP.md・claude-hook-e2e.md のコマンド例書き換えおよび `.github/workflows` 2 ファイルのコメント・バナー文言修正、`package.json` の `prepare` スクリプト追加に限定される。本リポジトリの `docs/` は `AI_CI_CD_VISION.md` と `docs/maintainer/`（保守者向け issue ワークフロー記録）のみで構成され、`01_システム概要`/`02_画面設計`/`03_データ設計`/`04_機能設計` 等の番号立てシステム仕様書構造は採用していない。本変更はいずれも配布導線の説明文言・CI コメントの是正であり、システム仕様（機能・データ・API 設計）自体には影響しないため、DOCS_RULES.md §継続追随ゲートの更新対象に該当しない。

---

## 9. 設計・境界の確認

**注意**: review-architecture の結果をここに記載する。責務・境界・依存関係が設計と一致しているか確認すること。

### 9.1 設計の確認

- **設計原則の準拠**: 02_設計.md §1.2 が適用を宣言した「単一責務」「明確な境界」「AI フレンドリー設計」の 3 原則が実装に反映されていることを確認した。README.md §導入「1.」が GitHub 直接参照の仕組みを説明する唯一の正本となり（SETUP.md・claude-hook-e2e.md は説明文を追加せずリンクのみ）、02_設計 ADR-3 の DRY 方針どおりに実装されている。
- **ディレクトリ構成**: 変更なし（新規ファイル作成を伴わない修正のため、ディレクトリ構造への影響なし）。
- **命名規則**: 変更なし。既存のコマンド文字列契約（02_設計 §5.1）どおり `npx github:techbeansjp-free/AGENTS.md <subcommand>` / `npx github:techbeansjp-free/AGENTS.md#<tag-or-branch> <subcommand>` の 2 形式に統一されていることを確認した。

### 9.2 境界・依存の確認

- **責務の境界**: 02_設計 §2.1.2 が定めた「ドキュメント（利用者向け説明）」と「CI 設定（ジョブロジック）」の境界が保たれている。CI 設定側（self-enforce.yml・release.yml）はコメント・バナー文言のみが変更され、実行可能行（`on:`/`if:`/`run:`/`jobs:`）には一切触れていないことを `git diff` の非コメント行ゼロ検証で確認した（§3.2・§4.2）。
- **依存関係**: 02_設計 §2.1.3 の参照関係（SETUP.md/claude-hook-e2e.md → README.md、self-enforce.yml/release.yml → docs/maintainer/workflow/close/ 配下の issue 記録）どおりに実装されており、循環参照は無い。SETUP.md の追加リンク（`../../README.md#導入プロジェクトへ配備するとき`）・claude-hook-e2e.md の追加リンク（`../../README.md#導入プロジェクトへ配備するとき`）はいずれも `test -f` で解決先ファイルの実在を確認済み。
- **指摘・推奨**: なし。ただし implement-feature の完了報告に記載されていた「スコープ外の気づき」（`src/agents-md.ts` の CLI ヘルプ文言、`.agent-skill-chain/source/scripts/lib/package-manifest.sh:207` 付近）に同型の registry 前提 `npx agent-skill-chain` 記法が残存していることを、grep で独立に再確認した（`src/agents-md.ts` 111, 137-140, 703, 917 行目、`package-manifest.sh` の書き込み警告文内）。00〜03 のスコープには含まれないファイルであるため本 issue の対象外として扱い、§10 に次 issue 候補として記録する（本レビューでは新規 issue を起票しない）。

### 9.3 重要判断の根拠（evidence_source）

重要な設計判断・レビュー結論ごとに、根拠の種別を 1 つ選ぶ: `human_decision` / `observed_runtime` / `existing_code` / `external_spec` / `test_output` / `inference_only`。**inference_only のみの重要判断は承認不可または要人間確認とする。**

| 判断内容 | evidence_source | 備考（参照元・URL 等） |
| --- | --- | --- |
| `prepare` フックが git 経由インストール時に自動実行され `bin/agents-md.js` を生成する | observed_runtime | 本レビュー §3.3(a)(b) で scratchpad 隔離環境における実行ログ・生成物確認により再実測（implement-feature 以前の 00 要求定義 §1.2 の先行検証結果とも一致） |
| `npm ci`/`npm run build` 二重実行時の冪等性（生成物差分ゼロ） | test_output | 本レビュー §3.3(a) の `sha256sum` 比較（二重実行前後で完全一致） |
| `.github/workflows` 2 ファイルのロジック行に差分が無いこと | test_output | 本レビュー §3.2 の `git diff` 非コメント行ゼロ検証（両ファイルとも空） |
| 4 件の issue パス参照が `docs/maintainer/workflow/close/` 配下に実在すること | observed_runtime | 本レビュー §3.2 の `test -e` × 4（全件 OK。review-docs での先行確認とも一致） |
| CI 設定側の境界（コメント・バナーのみ変更、ジョブロジック不変）が設計どおり保たれていること | test_output | §4.2・§9.2 の `git diff` 直接確認 |
| `src/agents-md.ts`／`package-manifest.sh` に同型の registry 前提記法が残存すること（スコープ外・次issue候補） | existing_code | 本レビューで `grep` により独立に再確認（implement-feature の申し送りと一致） |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: 現ブランチ（`feature/package-adapter`）は未 push のため、実 GitHub 上の `techbeansjp-free/AGENTS.md` への `npx github:...` 直接参照による真の E2E 検証が本レビュー時点でも実施できていない（03_実装計画 §5.1 に記載済みの既知リスク）。
  - **影響範囲**: README.md §導入「1.」に記載した手順が、実際に GitHub 上で外部採用先から実行されたときに完全に動作することの最終確認が未了。ただし §3.3(b) でネットワーク非依存の機構等価な模擬検証（ローカル git 経由インストール）は合格しており、機構レベルでのリスクは低いと判断する。
  - **対応方法**: 本ブランチが `main` へマージされ push された後、別途（本 issue のクローズ後でよい）実 GitHub 経由の `npx github:techbeansjp-free/AGENTS.md init` を一度手動確認することを推奨する。新規 issue は不要（軽量な事後確認で足りる）。
- **課題 2**: `src/agents-md.ts`（CLI ヘルプ文言、111, 137-140, 703, 917 行目）と `.agent-skill-chain/source/scripts/lib/package-manifest.sh`（207 行目付近の書き込み警告文）に、同型の registry 前提 `npx agent-skill-chain <cmd>` 記法が残存している。
  - **影響範囲**: `agents-md --help` や `uninstall` 実行時に表示される警告文言が、README 等の書き換え後の実態（GitHub 直接参照）と不一致になる。実害は軽微（CLI 出力上のノイズ）だが、本 issue が是正した課題1・2 と同種の再発である。
  - **対応方法**: 00〜03 のスコープに含まれない対象外ファイルであるため、本 issue では対応しない。次 issue の候補として記録するに留める（本レビューでは新規 issue を起票しない。起票可否の判断は進行役に委ねる）。
- **課題 3（参考・00 §5 除外要件で既に対象外と確定済み）**: README.md「リリース手順（メンテナ向け）」節（163 行目）および `docs/maintainer/RELEASE.md`（123 行目）にも同種の「npm 公開は今後の課題として保留中」という古い文言が残存していることを grep で確認した。00_要求定義.md §5 で明示的にスコープ外とされているため本 issue の指摘とはしないが、課題 2 と合わせて次 issue 候補として記録する。
- **課題 4（敵対的観点 #2 で検出・残存リスク）**: 採用先が `npm install`/`npx` 実行時に `--ignore-scripts` を指定した場合、`prepare` フックが発火せず `bin/agents-md.js` が生成されないため `npx github:techbeansjp-free/AGENTS.md <cmd>` が失敗する。この限界は npm の `prepare` ライフサイクル機構に内在するものであり、00〜03 のスコープには対策が含まれていない。実害は「利用者が明示的に `--ignore-scripts` を指定する」という限定的な操作でのみ発生するため致命的ではないが、README にこの前提（`--ignore-scripts` 非使用が必要）を明記していない点は軽微な情報不足である。要修正には倒さないが、課題 2・3 と合わせて次 issue 候補として記録する。

### 10.2 改善提案

- **改善 1**: 課題 2・3 をまとめて「npm 配布導線ノイズ是正・第2弾」のような後続 issue で扱うことを推奨する（本レビューでは起票しない。起票の要否・タイミングの判断は進行役が行うこと）。
  - **効果**: CLI ヘルプ文言・RELEASE.md・README 補足節まで含めて registry 前提記法・古い方針文言を一掃でき、本 issue が達成した「ノイズ排除」の効果を全体に波及できる。

---

## 11. システム仕様書の更新

本セクションは §「docs 更新」に要約済み（要否: 不要）。本リポジトリはシステム仕様書（`01_システム概要`等の番号立て構造）を採用しておらず、本ゲートは実質的に該当なしと判定した。

### 11.1〜11.4

該当なし（§「docs 更新」を参照）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好。02/03 の設計・計画どおりに 6 ファイルへの最小差分修正が行われ、スコープ外（release-npm/release-marketplace/apm-release ジョブ本体・ゲート等）への逸脱は検出されなかった。
- **テスト品質**: 良好。03_実装計画 §6.2 の (a)〜(c) すべてを本レビューで独立に再実行し、implement-feature の報告と完全に一致する結果を得た。
- **ドキュメント品質**: 良好。00〜03 は review-docs で指摘 0 件のレビュー済みであり、実装との整合性も本レビューで再確認した。
- **総合評価**: 合格。指摘事項なし（軽微な誤字・パス誤りも検出されなかったため修正は発生していない）。課題 1〜3（§10）はいずれも本 issue のスコープ外または事後確認事項であり、close を妨げるものではない。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close サブエージェント（sonnet, reasoning effort high）
- **承認日**: 2026-07-12
- **承認コメント**: 受け入れ基準 SC-1〜SC-6・ユーザーストーリー 1〜4・BDD シナリオすべてが合格。実装はスコープ内に収まっており、大規模な設計見直しを要する指摘は無し。close 可。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

このプロジェクトの全体ドキュメント：

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- [`memo/20260712_100112_review-docs.md`](./memo/20260712_100112_review-docs.md) - 実装前ドキュメントレビュー証跡（指摘 0 件）

---

## 14. 前のステップ

このレビュー書は、以下のドキュメントを基に作成されています：

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

このレビュー書の承認後、以下のいずれかのステップに進みます：

- **外部設定が不要な場合**: issue/タスク完了（本 issue は外部設定を伴わないため、05_最終確認チェックリスト.md は作成せず、本 04_review.md をもって完了とする）。
