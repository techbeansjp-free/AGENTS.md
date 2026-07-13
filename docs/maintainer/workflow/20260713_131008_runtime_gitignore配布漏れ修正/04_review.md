---
document_id: "f6b17734-b72c-4cf7-af61-5530a427f950"
issue_id: "ae437b9c-8ecb-4591-97bb-ae606f56e105"
---

# レビュー書: runtime/.gitignore 配布漏れバグの恒久修正

**プロジェクト名**: runtime/.gitignore 配布漏れバグの恒久修正
**作成日**: 2026 年 07 月 13 日
**最終更新**: 2026 年 07 月 13 日

> **重要**: 本レビューは verify-and-close command（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）に従って実施した。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
>
> **必須参照**: [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../.agent-skill-chain/source/REVIEW_RULE.md)・[`REVIEW_DUAL_LENS.md`](../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md)。レビュー深度は **standard**（実行コード変更2ファイル＋テスト2ファイル＋ドキュメント1ファイルの中規模変更、うち PreToolUse.sh は enforcement 正本のためセキュリティ観点で厚めに検証）を選択（[RULES.md §実行モード](../../../../.agent-skill-chain/source/RULES.md)）。深さによらず二観点（敵対的＋must-preserve）両リストは §12.3・§12.4 に必須記載。
>
> **結論（先出し・2026-07-13 追記後）**: 実装（setup.sh・SETUP.md・PreToolUse.sh・テスト2件）は 02_設計・03_実装計画のとおりに行われ、既存テスト・新規テストはすべて PASS。本レビューで発見した **重要度「高」の指摘 1 件**（`package.json` の `files` allowlist 未更新により、実際の消費者配布経路[`npx github:...`]では `runtime/.gitignore` が届かない）は、**ADR-4（02_設計.md §2.5・03_実装計画.md §2.4 に追記）に基づき対応完了**した。単純な `files` 配列への追加では npm-packlist の仕様上機能しないことが判明したため、`.agent-skill-chain/source/runtime-gitignore.template`（新規・非 `.gitignore` 名）を追加し、`setup.sh` のコピー元をそちらに変更、コピー時に `.gitignore` へリネームする方式で恒久修正した。実際に `npm pack` で tarball を生成し `tar -tzf` で内容物を直接確認し、テンプレートが実際に含まれること、および packed tarball を展開した「真の npm 配布物のみ」の環境で `setup.sh` を実行し `.gitignore` が正しい内容で生成されることを end-to-end で確認済み（§16 追記参照）。**指摘1は解消。本 issue は close 可能と判断する。**

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証（setup.sh・SETUP.md・PreToolUse.sh・2 テストファイルの変更が 02_設計の ADR-1/2/3 および 03_実装計画のタスク定義に一致し、01_要件定義の受け入れ基準・00_要求定義の成功基準（「以後配布される全消費者プロジェクトで再発しないようにする」）を実際に満たすかの検証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: 03_実装計画のタスク 1（`setup.sh` への未存在時コピーブロック追加）、タスク 2（`SETUP.md` の所有区分表・初回コピー時挙動補足表への行追加）、タスク 3（`PreToolUse.sh` 正本 R1 への厳密パス一致例外追加）。および回帰・新規テスト（`test/e2e-install-uninstall.sh` N1 追記・N2b 新設、`test/test-pretooluse-hook.sh` UC9 新設）。
- **レビュー期間**: 2026-07-13 ～ 2026-07-13
- **レビュー担当者**: verify-and-close 委譲サブエージェント（レビュワー）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス（必須: 完了 または 要修正） |
| --- | --- | --- | --- | --- |
| タスク 1 | `setup.sh` に `runtime/.gitignore` の未存在時コピーブロックを追加 | 2026-07-13 | implement-feature 委譲サブ | 完了（§4.2 指摘 1 は ADR-4 対応により解消済み。§16 追記参照） |
| タスク 2 | `SETUP.md` の所有区分表・初回コピー時挙動補足表に行を追加 | 2026-07-13 | implement-feature 委譲サブ | 完了 |
| タスク 3 | `PreToolUse.sh`（正本）R1 に厳密パス一致例外を追加 | 2026-07-13 | implement-feature 委譲サブ | 完了 |
| （回帰・新規テスト） | `e2e-install-uninstall.sh` N1 追記・N2b 新設／`test-pretooluse-hook.sh` UC9 新設（5 シナリオ×jq/nojq） | 2026-07-13 | implement-feature 委譲サブ | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: `setup.sh` への `runtime/.gitignore` 未存在時コピーブロック追加

- **実装内容**: `runtime/templates` ブロック（既存 L113-125）の直後に、`WF_GITIGNORE`/`WF_GITIGNORE_SOURCE` 変数を用いた「未存在時のみコピー」ブロックを追加。`[[ -f "$WF_GITIGNORE_SOURCE" && ! -f "$WF_GITIGNORE" ]]` の条件で `cp` を実行。
- **変更ファイル**: `.agent-skill-chain/source/scripts/setup.sh`（+10 行）
- **実装方法**: 02_設計 §3.1・ADR-1/2 の具体コードと完全一致（`git diff` で逐語確認済み）。変数命名は既存 `WF_TEMPLATES`/`WF_SOURCE` の慣例を踏襲。
- **確認事項**: 本ブロックは `$PACKAGE_ROOT` にコピー元テンプレートが存在することを前提とする。`PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"`（setup.sh L15）であり、実際の消費者配布経路（`npx github:techbeansjp-free/AGENTS.md init`）ではこの `PACKAGE_ROOT` は npm がインストールした（`files` allowlist で絞り込まれた）パッケージの場所になる。**当初は `$WF_GITIGNORE_SOURCE` が `.agent-skill-chain/runtime/.gitignore`（`files` に列挙しても npm-packlist の仕様上配布されない・§4.2 指摘 1）を指していたため実配布経路では機能しなかったが、ADR-4 対応により `$WF_GITIGNORE_SOURCE` を `.agent-skill-chain/source/runtime-gitignore.template`（既存の `.agent-skill-chain/source/` 配布ルールで確実に配布される）に変更し、実際に packed tarball を使った end-to-end 検証で機能することを確認した（§16 追記）。**

#### タスク 2: `SETUP.md` への配布ルール明記

- **実装内容**: 所有区分表・初回コピー時挙動補足表に、02_設計 §3.2 の追加行案どおりの行を追加。
- **変更ファイル**: `.agent-skill-chain/source/SETUP.md`（+2 行）
- **実装方法**: 既存の表記スタイル・粒度を踏襲し新規セクションは作らず（02_設計 §3.2.4 と一致）。
- **確認事項**: `grep -c "runtime/\.gitignore" SETUP.md` = 2、`grep -c "未存在時のみコピー" SETUP.md` = 1（03 §2.2.4 の確認スクリプトを再実行し一致・§3.1 参照）。

#### タスク 3: `PreToolUse.sh`（正本）R1 への厳密パス一致例外追加

- **実装内容**: R1 の `if` ブロックに、`PATH_TARGET` が `.agent-skill-chain/runtime/.gitignore`（相対）または `*/.agent-skill-chain/runtime/.gitignore`（絶対パス等のプレフィックス許容）に厳密一致する場合のみ allow（no-op `:`）する分岐を、既存の block 条件より前に追加。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`（+6/-1 行）
- **実装方法**: 02_設計 §3.3・ADR-3 の具体コードと完全一致。配備先生成物 `.claude/hooks/PreToolUse.sh` は本 issue のスコープでは直接編集していない（`git diff` に非該当を確認）。**本 worktree には `.claude/` ディレクトリ自体が存在しない（ルート `.gitignore` で `/.claude/` を除外・未配備）ため、再配備後の実ファイル一致確認は本レビューの対象外。テストは `test/test-pretooluse-hook.sh` が `git archive` 相当の隔離クローンで正本 `PreToolUse.sh` を直接検証する方式のため、生成物の実配備有無に依存せず判定ロジックの正しさを担保できている（02 §6.1 の既存前提と整合）。**
- **確認事項**: R1 以外のルール（R2〜R6）・`block`/`allow` 薄関数には変更なし（`git diff` で該当箇所への差分が無いことを確認）。

---

## 3. テスト結果の確認

### 3.1 単体・E2E テスト実行結果（実行日: 2026-07-13、実際に再実行して確認）

#### `test/test-pretooluse-hook.sh`（正本 PreToolUse.sh の隔離クローンでの直接検証）

```
== UC9: runtime/.gitignore 厳密パス一致例外 ==
  [PASS] UC9[jq]: runtime/.gitignore の厳密一致 Edit は exit 0
  [PASS] UC9[jq]: runtime/workflow.db の Write は exit 2（現状維持）
  [PASS] UC9[jq]: 従来どおりの禁止メッセージ
  [PASS] UC9[jq]: サブディレクトリの .gitignore は exit 2（過剰マッチ防止）
  [PASS] UC9[jq]: .gitignore.bak は exit 2（前方一致で誤許可しない）
  [PASS] UC9[jq]: 絶対パス表記の runtime/.gitignore も exit 0
  [PASS] UC9[nojq]: （同上 6 件・すべて PASS）
...
PASS=62 FAIL=0
全テスト PASS
```

既存 UC1〜UC8（jq/nojq 両系統、subagent 昇格・scribe・orchestrator 分岐等）はすべて回帰なく PASS。UC9 は 03 §2.3.4 の想定 3 シナリオに加え、境界値 2 件（`.gitignore.bak` 前方一致誤許可防止・絶対パス表記の allow）を追加実装しており、テスト観点は計画以上に手厚い。

#### `test/e2e-install-uninstall.sh`

```
[e2e] シナリオN1: ... 
  [PASS] N1: runtime/.gitignore が新規配備される
[e2e] シナリオN2b: runtime/.gitignore はローカル変更を尊重し setup 再実行で上書きされない
  [PASS] N2b: runtime/.gitignore は再配備で内容が上書きされない
...
[e2e] 結果: PASS=133 FAIL=0
[e2e] 全シナリオ pass
```

既存 N1〜N7・R1〜R3・N4a〜c・N5・N6 はすべて回帰なく PASS。

**重要な限定事項（§4.2 指摘 1 と直結）**: 本テストは `REPO_ROOT` を直接 `PACKAGE_ROOT` として使い、配備元スナップショットを `git ls-files -z | tar` で作成する（e2e-install-uninstall.sh L48「クリーン clone を一時ディレクトリへ再現する」）。これは **git 追跡ファイル全体**を配布元とみなす方式であり、実際の `npm publish`/`npx github:` 配布経路が適用する `package.json` の `files` allowlist によるフィルタリングを経由しない。したがって本テストの N1 アサーション（`runtime/.gitignore が新規配備される`）は **PASS するが、実際の消費者配布経路の挙動を代表していない**（§4.2 指摘 1 で実証）。

#### `test/run-all.sh`（全体一括）

- **実行日**: 2026-07-13
- **テストファイル数**: 19（`default_tests` の登録数）
- **成功**: 19／**失敗**: 0／**スキップ**: 0（実行結果: `合計=19 PASS=19 FAIL=0 SKIP=0`）
- 実装引き渡し時の報告（合計 19・FAIL=1、`test-write-workflow-log-schema-idempotent` の T-3 が並行 flock 競合によるフレーク）について、本レビューでの再実行では **FAIL=0** となり、単独実行時と同様に全 PASS することを確認した。当該フレークは既知の並行実行タイミング依存であり、本 issue の変更（setup.sh・SETUP.md・PreToolUse.sh・2 テストファイル）とは無関係（対象ファイルはいずれも本 issue の変更対象外）。

### 3.2 統合テスト・E2E テスト（(i)/(ii) 分離記載・CLOSEOUT.md 準拠）

- **(i) 仕様反映**: 反映済み（02/03 の設計・実装計画どおりにコード変更が行われていることを `git diff` で確認、§2 参照）。
- **(ii) 実経路検証**: **実行済み（ただし射程が限定的）**。`test/e2e-install-uninstall.sh`・`test/test-pretooluse-hook.sh` は実際に `bin/agents-md.js init` / `PreToolUse.sh` を子プロセスとして実行する実経路テストであり、モック代用ではない。**ただし e2e-install-uninstall.sh の「配布元」シミュレーションは git 追跡ファイル全体であり、npm パッケージの実配布内容（`files` allowlist フィルタ後）とは異なる（緑≠実経路の射程の見極め、CLOSEOUT.md §verify 報告様式）。この射程の差異を本レビューで追加検証した結果が §4.2 指摘 1 である。**
- 追加検証（本レビューで実施・実経路）: `npm pack --dry-run` および `npm pack` によるタグボール実 inspect（`tar -tzf` で内容一覧を実確認）、および `npm install git+file://<ローカルbareリポジトリ>`（`npx github:owner/repo` と同じ git 依存解決経路を再現）を実行し、インストール後の `node_modules/agent-skill-chain/.agent-skill-chain/runtime/` 配下に `templates/` のみが存在し `.gitignore` が存在しないことを実機で確認した（すべて `/tmp` 配下の scratchpad で実施、本リポジトリの追跡物は変更していない）。

---

## 4. コードレビュー

### 4.1 コード品質

#### 変更差分の範囲（`git diff --stat` の実出力）

```
 .agent-skill-chain/source/SETUP.md                 |  2 +
 .../source/enforcement/claude/PreToolUse.sh        |  7 ++-
 .agent-skill-chain/source/scripts/setup.sh         | 10 ++++
 test/e2e-install-uninstall.sh                      | 20 ++++++++
 test/test-pretooluse-hook.sh                       | 54 ++++++++++++++++++++++
 5 files changed, 92 insertions(+), 1 deletion(-)
```

- 03 の想定（5 ファイル）に完全一致。`.claude/hooks/PreToolUse.sh`（生成物）・`src/agents-md.ts` への変更なし（01 §5 の対象外判断・02 §2.1.2 境界を遵守）。

#### コードレビュー観点

| 観点 | 確認内容（必須: 1 文） | 結果（必須: OK または 要修正） | コメント |
| --- | --- | --- | --- |
| 可読性 | 各追加ブロックが既存コード（`runtime/templates` ブロック・既存 R1）の文体・命名慣例と整合するか | OK | `WF_GITIGNORE`/`WF_GITIGNORE_SOURCE` は `WF_TEMPLATES`/`WF_SOURCE` の慣例を踏襲。PreToolUse.sh の allow 分岐にはコメントで ADR-3 根拠を明記 |
| 保守性 | 判定ロジックの二重実装がないか、`.claude/hooks/` 生成物を直接触っていないか | OK | 正本のみ変更。生成物は `copy_owned_files` 経由の再配備に委ねる方針を遵守 |
| 正確性（実配布経路） | `setup.sh` の新ブロックが実際の消費者配布経路で機能するか | **要修正** | §4.2 指摘 1 参照。`PACKAGE_ROOT` は実配布経路で `package.json` の `files` によりフィルタされた場所になり、`.gitignore` 実体が存在しない |
| セキュリティ（PreToolUse.sh R1 例外） | 例外条件が前方一致・部分一致になっておらず過剰マッチしないか | OK | UC9 の 5 シナリオ（厳密一致 allow・他ファイル block・サブディレクトリ block・`.gitignore.bak` block・絶対パス allow）ですべて期待どおり。正規表現ではなく `==`/`*` glob の末尾セグメント厳密比較であり、`.agent-skill-chain/runtime/.gitignore` 以外にはマッチしないことを実行で確認 |
| テスト観点網羅 | 01 の 6 BDD シナリオがすべてテストコード化されているか | OK（§8 参照） | UC1 シナリオ1/2 → e2e N1/N2b、UC2 シナリオ1〜3 → hook UC9、UC3 シナリオ1 → grep 確認、すべて対応 |

### 4.2 指摘事項

#### 指摘 1: `package.json` の `files` allowlist に `.agent-skill-chain/runtime/.gitignore` が含まれておらず、実配布経路（`npx github:...`）で本修正が機能しない

- **重要度**: 高
- **指摘内容**: 本 issue の目的は「パッケージ配布経路そのものを修正し、以後配布される全消費者プロジェクトで再発しないようにする」（00_要求定義 §必要性1）ことである。しかし `setup.sh` が参照する `$WF_GITIGNORE_SOURCE="$PACKAGE_ROOT/.agent-skill-chain/runtime/.gitignore"` の `$PACKAGE_ROOT`（`setup.sh` L15: `"$(cd "$SCRIPT_DIR/../../.." && pwd)"`）は、README.md が推奨する実際の導入経路 `npx github:techbeansjp-free/AGENTS.md init`（README.md §1「基本は npx を推奨」）では npm がインストールしたパッケージの場所になる。この配布内容は `package.json` の `files` allowlist で確定する（`docs/01_システム概要/04_ディレクトリ構成/README.md` 脚注「配布対象の確定は package.json の files allowlist が単一情報源」）。現状の `files` 配列は次のとおりで、`.agent-skill-chain/runtime/.gitignore` を含まない。

  ```json
  [
    ".agent-skill-chain/source/",
    "AGENTS.md",
    "CLAUDE.md",
    ".agent-skill-chain/runtime/templates/",
    "bin/",
    "README.md"
  ]
  ```

  本レビューで実機検証した結果（evidence_source: test_output）:
  1. `npm pack --dry-run`／実際の tarball（`tar -tzf`）のいずれでも `.agent-skill-chain/runtime/.gitignore` は含まれない（`runtime/templates/*` のみ含まれる）。
  2. ローカル bare リポジトリを用意し `npm install git+file://<bare repo>`（`npx github:owner/repo` と同じ git 依存解決コードパスを再現）を実行した結果、`node_modules/agent-skill-chain/.agent-skill-chain/runtime/` 配下には `templates/` のみが存在し、`.gitignore` は存在しなかった。

  すなわち、実際の消費者（npx 経由の新規導入者）に対しては、`setup.sh` の新ブロックの `[[ -f "$WF_GITIGNORE_SOURCE" ...]]` 条件が常に偽となり、`runtime/.gitignore` は配布されない。**本 issue が解決しようとしていた NEXUS 事例と同じ実害（`workflow.db-wal`/`-shm` の誤 git 追跡）が、実配布経路では引き続き再発しうる。**

  一方、本リポジトリ自身（自己適用・`PACKAGE_ROOT`=`PROJECT_ROOT`）や `test/e2e-install-uninstall.sh`（`git ls-files` によるクリーンクローン方式で `PACKAGE_ROOT` を模擬）では `.gitignore` が git 追跡物として存在するため正しく配布され、テストは PASS する。この PASS は実配布経路の正しさを保証しない（§3.2 (ii) 実経路検証の射程の見極め）。

- **対応状況**: **対応済み（2026-07-13・ADR-4）**。当初提案していた「`package.json` の `files` に `.agent-skill-chain/runtime/.gitignore` を追加する」という対応方法は、追加検証の結果 npm-packlist の仕様上機能しないことが判明した（npm-packlist の `defaults` ルールが `.gitignore` という名前のファイルを `files` 指定に関わらず強制除外し、`files` 側の「明示ファイル強制包含」機構もパッケージルートから 2 階層以上ネストした位置では効かないことを隔離環境の再現実験で確認）。そのため実際の対応は、`.agent-skill-chain/source/runtime-gitignore.template`（新規・非 `.gitignore` 名）を追加し `setup.sh` のコピー元をそちらに変更、コピー時に `.gitignore` へリネームする方式（案A・02_設計.md ADR-4・03_実装計画.md §2.4）を採用した。`package.json` からは実効性の無い `.agent-skill-chain/runtime/.gitignore` 行を削除し（新テンプレートは既存の `.agent-skill-chain/source/` ディレクトリ丸ごとエントリで配布されるため新規エントリ不要）、`verify-npm-pack.sh` の必須物リストに新規テンプレートを追加し回帰検知を強化した。実際に `npm pack` で tarball を生成し `tar -tzf` で `.agent-skill-chain/source/runtime-gitignore.template` が含まれることを直接確認し、さらに packed tarball を展開した「真の npm 配布物のみ」の環境で `setup.sh` を実行し `.agent-skill-chain/runtime/.gitignore`（内容 `workflow.db*`）が正しく生成されることを end-to-end で確認済み（§16 追記参照）。**指摘1は解消。**

#### 指摘 2（軽微・参考）: `docs/01_システム概要/04_ディレクトリ構成/README.md` の配布可否記載の粒度

- **重要度**: 低
- **指摘内容**: 同ファイル L18 は `.agent-skill-chain/runtime/`（`.gitignore` を含む）全体を「非配布」と記載している。指摘 1 が解消され `files` allowlist に `.gitignore` が追加された場合、この行の記載を「`runtime/.gitignore` は例外的に配布」等へ更新する必要が生じる、と当初想定していた。
- **対応状況**: **再判定完了（2026-07-13）。更新不要と判断**。実際の指摘1解消はコーディネーターの判断により案A（`package.json` の `files` に `.gitignore` を直接追加するのではなく、非 `.gitignore` 名のテンプレートを `.agent-skill-chain/source/` 配下に追加し `setup.sh` がコピー時にリネームする方式）で行われたため、当初想定した「`files` allowlist に `.gitignore` が追加される」という更新トリガー自体が発生していない。`package.json` の `files` 配列は現在も `.agent-skill-chain/runtime/.gitignore` を直接列挙しておらず、`.agent-skill-chain/runtime/`（`templates/` 以外）は引き続き npm tarball には含まれない（`.gitignore` は `workflow.db` と同様、`setup.sh` が配備先で**手続き的に生成**する生成物であり、`files` allowlist によるパッケージ内容物としての「配布」ではない）。したがって L18 の「`.agent-skill-chain/runtime/` は非配布（`workflow.db` 等の生成物）」という記載は、ADR-4 適用後も実態と矛盾しない。§6 docs 更新ゲートの再判定も参照。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（uninstall 整合の検討済み論点を含む） | レビュワー | 2026-07-13 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（ストーリー1〜3・BDD6 シナリオ） | レビュワー | 2026-07-13 |
| [`02_設計.md`](./02_設計.md) | 更新済み（ADR-1/2/3） | レビュワー | 2026-07-13 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（タスク1-3・BDD対応表） | レビュワー | 2026-07-13 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: コードは 02/03 の ADR・具体コードと完全一致（整合している）。ただし §4.2 指摘 1 のとおり、**02_設計・03_実装計画のいずれも `package.json` の `files` allowlist（実配布経路の単一情報源）を検討対象に含めておらず、設計段階のスコープ自体に抜け漏れがあった**。02_設計 §2.1.2 境界は「`runtime/templates/` の既存配布ロジックには手を加えない」ことのみを述べ、`setup.sh` が読む `$PACKAGE_ROOT` の実体が実配布経路でどう決まるかの検証（02 の ADR-1 の根拠は `existing_code` として `setup.sh` 内のみを実読しており、`package.json`/`npm pack` の挙動までは検証していない）に至っていない。
- **要件と実装の整合性**: 01 の 6 BDD シナリオはテストコードとしてはすべて対応済みだが、UC1 シナリオ1（「消費者プロジェクトに対して setup.sh を実行すると配布される」）は実配布経路において未達（§8 参照）。
- **コメント**: 00_要求定義の「検討済み・対象外とした論点（uninstall との整合）」は uninstall 側の挙動を精査しており妥当。今回新たに発見した指摘 1 は uninstall とは無関係の、配布（install/新規導入）側の別論点である。

---

## 6. パフォーマンス確認

該当なし（配布ファイル 1 件・判定条件 1 件の追加のみ。01 §3.1 と同様）。

---

## 7. セキュリティ確認

| 項目 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 認証・認可 | `PreToolUse.sh` R1 の例外が厳密パス一致のみで過剰許可していないか | OK | UC9 の 5 シナリオ（jq/nojq 両系統・計 10 サブケース）ですべて期待どおり動作することを実行確認 |
| データ保護 | `runtime/.gitignore` の未存在時のみコピーがローカル変更を破壊しないか | OK | N2b でローカル変更が再配備後も保持されることを実行確認 |
| 入力検証 | 該当なし（外部入力を扱わない） | OK | - |

---

## 8. 受け入れ基準・成功基準のカバレッジ確認（map-coverage）

### 8.1 01_要件定義 §2.2 BDD シナリオの対応表（6 シナリオ全件）

| BDD シナリオ | 対応テスト | 結果 | 備考 |
| --- | --- | --- | --- |
| UC1 シナリオ1: 未存在時に配布される | `e2e-install-uninstall.sh` N1 アサーション + 実 `npm pack` tarball 展開による end-to-end 確認（§16 追記） | **PASS（実配布経路でも達成・ADR-4 対応済み）** | N1 は開発ツリー（git 追跡ファイル全体）を配布元とみなす検証、追加の end-to-end 確認は実際の packed tarball のみを使った検証。両方で PASS を確認 |
| UC1 シナリオ2: 既存時は上書きされない | `e2e-install-uninstall.sh` N2b（新設） | PASS | ローカル変更保持を実行確認 |
| UC2 シナリオ1: runtime/.gitignore への直接 Edit が許可される | `test-pretooluse-hook.sh` UC9（jq/nojq） | PASS | 正本を直接検証する方式のため実配布経路に依存しない |
| UC2 シナリオ2: 他の runtime/ 配下ファイルへの直接 Edit/Write は引き続き block される | `test-pretooluse-hook.sh` UC9（jq/nojq） | PASS | 既存 UC3 と別ファイル名（workflow.db）での回帰確認 |
| UC2 シナリオ3: パスが厳密一致でない場合は例外の対象外 | `test-pretooluse-hook.sh` UC9（jq/nojq） | PASS | サブディレクトリ `.gitignore`・`.gitignore.bak` の両方で過剰マッチ防止を確認（計画より広いテスト） |
| UC3 シナリオ1: 所有区分表に runtime/.gitignore の配布ルールが記載されている | `SETUP.md` grep 確認（03 §2.2.4） | PASS | 2 表に該当行を確認 |

### 8.2 00_要求定義 成功基準との対応

| 成功基準 | 検証方法 | 結果 |
| --- | --- | --- |
| パッケージ配布経路そのものを修正し、以後配布される全消費者プロジェクトで再発しないようにする | `npm pack`/`npm install git+file://` による実配布経路の実機検証 | **○ 達成（ADR-4 対応後・§16 追記）**。実際に `npm pack` した tarball を展開した「真の npm 配布物のみ」の環境で `setup.sh` を実行し、`.agent-skill-chain/runtime/.gitignore`（内容 `workflow.db*`）が正しく生成されることを end-to-end で確認 |
| SETUP.md に配布ルールが明記される | grep 確認 | ○ PASS |
| PreToolUse.sh R1 に正規の自己修復手段が確保される（過剰マッチなし） | UC9 実行確認 | ○ PASS |

### 8.3 必須成果物・未達一覧

- **未達 0 件（2026-07-13 再判定）**: 当初 §4.2 指摘 1（`package.json` `files` allowlist 未更新）により未達としていた成功基準（実配布経路での恒久修正）は、ADR-4 対応（`.agent-skill-chain/source/runtime-gitignore.template` 新設 + `setup.sh` コピー元変更）により達成を確認した（§16 追記の実機検証）。
- 00-03 の document_id はすべて既存のまま変更なし。04 は本レビューで新規 UUID を付与。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務・明確な境界（02 §1.2）は概ね準拠。`setup.sh`＝配布ロジック、`SETUP.md`＝契約文書化、`PreToolUse.sh`＝実行時強制、という責務分担は維持されている。
- **ディレクトリ構成**: 変更対象は既存 5 ファイルのみで新規ファイル・新規ディレクトリを作らず、既存節への追記に留めている（02 §2.3 と一致）。
- **命名規則**: `WF_GITIGNORE`/`WF_GITIGNORE_SOURCE` は既存慣例に準拠。04 の frontmatter に UUID を新規付与。
- **設計スコープの欠落（当初発見・ADR-4 で是正済み）**: 02_設計の当初の「責務一覧」（§2.1.1）は `setup.sh`・`SETUP.md`・`PreToolUse.sh`・`runtime/.gitignore` 実体・`.claude/hooks/PreToolUse.sh`（生成物）・`src/agents-md.ts` の 6 者のみを列挙し、**`package.json`（npm 配布内容の単一情報源）を責務一覧・境界のいずれにも含めていなかった**。この抜け漏れが §4.2 指摘 1 の根本原因であった。ADR-1 の根拠（evidence_source: existing_code）は `setup.sh` 内のコードのみを対象とし、`setup.sh` が読み取る `$PACKAGE_ROOT` が実配布経路でどのような内容になるかという「配布の入力側」の検証を欠いていた。**2026-07-13 に ADR-4 として 02_設計.md §2.1.1・§2.5 に追記し、`package.json`・`verify-npm-pack.sh`・新規テンプレートファイルを責務一覧に追加、この抜け漏れを是正済み。**

### 9.2 境界・依存の確認

- **責務の境界**: `runtime/templates/` の既存配布ロジックには変更なし（回帰テストで確認）。`PreToolUse.sh` の R1 以外のルール（R2〜R6）には影響なし。
- **依存関係**: `setup.sh` の新ブロックは `package.json` の `files` allowlist に**暗黙に依存**している（`$PACKAGE_ROOT` の実体が `files` によって決まるため）にもかかわらず、この依存関係が 02_設計のどこにも明示されていない。これは「明確な境界」原則（02 §1.2）に照らすと、依存先（`package.json`）を境界図に含めるべきであった。
- **指摘・推奨**: §4.2 指摘 1 の対応（`files` への追加）に加え、将来同種の配布ファイルを追加する際のチェックリストとして、02_設計または SETUP.md に「`setup.sh` で `$PACKAGE_ROOT` 配下からコピーする新規ファイルは、必ず `package.json` の `files` allowlist にも追加すること」という一文を明記することを推奨する（提案に留め、起票の要否・実行はメインが判断する）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元・URL 等） |
| --- | --- | --- |
| 実装コードが 02/03 の設計・実装計画に一致 | existing_code | `git diff` 実読・5 ファイルの追記実文確認（§2・§4.1） |
| 新規・既存テストがすべて PASS（e2e 133・hook 62・run-all 19） | test_output | 本レビューで再実行した実出力（§3.1） |
| `package.json` の `files` allowlist に `runtime/.gitignore` が含まれず実配布経路で機能しない | test_output | `npm pack --dry-run`／tarball 実 inspect／`npm install git+file://` によるローカル実機検証（scratchpad で実施・本レビューで新規に実施） |
| `npx github:...` が `npm install git+file://...` と同一の git 依存解決コードパスを通る | inference_only（npm 公式ドキュメント未参照のため推測） | **要人間確認**: 本レビューはローカルの `git+file://` 経路で実証したが、GitHub 直接参照（`github:owner/repo` shorthand）が内部的に同じ pacote/npm-packlist の絞り込みを経由することは、npm の一般的な既知動作としての推測に基づく。ネットワーク環境の制約で実際の `npx github:techbeansjp-free/AGENTS.md init` を外部 GitHub に対して実行して確認するには至っていない |
| `docs/` システム仕様書の当該記載は指摘 1 未解消の現状とは矛盾しない（更新不要の軽量判定） | existing_code | `docs/01_システム概要/04_ディレクトリ構成/README.md` L18 実読（§6 参照） |

---

## 指摘対応の優先度・次アクション（2026-07-13 更新: 対応完了）

1. ~~最優先: `package.json` の `files` に `.agent-skill-chain/runtime/.gitignore` を追加する~~ → **実施済み（ただし当初提案どおりの単純追加ではなく ADR-4・案A で対応。§16 追記参照）**。
2. `docs/01_システム概要/04_ディレクトリ構成/README.md` L18 の記載更新要否 → **再判定完了。更新不要（§6.2）**。
3. close 判断はメイン（orchestrator）がユーザー確認のもと行う。

---

## 6. docs 更新（DOCS_RULES §継続追随ゲート）

### 6.1 初回判定（2026-07-13・指摘1未解消時点。履歴として保持）

- **要否**: 不要（軽量パス・根拠付き。ただし条件付き）
- **理由**: 本 issue のコード変更（setup.sh・PreToolUse.sh）は、`package.json` の `files` allowlist 未更新（§4.2 指摘 1）により**実際の配布内容を変えるに至っていない**（自己適用・e2e テスト環境限定の変更）。指摘 1 が解消され実際の配布経路が是正された時点で再判定が必要。

### 6.2 再判定（2026-07-13・指摘1対応完了後。コーディネーター指示により実施）

- **要否**: **不要**（再判定後も結論は変わらず）。
- **対象**: なし。
- **理由**: 指摘1は解消され実際の配布経路（npm/npx 経由）は是正されたが、その実現方式（ADR-4・案A）は「`.agent-skill-chain/source/` 配下に新規テンプレートファイルを追加し、既存の `.agent-skill-chain/source/` 配布ルールに乗せる」という形であり、`package.json` の `files` allowlist 自体には `.agent-skill-chain/runtime/.gitignore` を直接列挙する行を追加していない（既存の `.agent-skill-chain/source/` エントリが自動的にテンプレートを含むため）。すなわち `docs/01_システム概要/04_ディレクトリ構成/README.md` L18 が記述する「配布可否の粒度」（`.agent-skill-chain/source/` は配布・`.agent-skill-chain/runtime/`（`templates/` 以外）は非配布）という区分自体は ADR-4 適用後も変化していない。`.agent-skill-chain/runtime/.gitignore` は `workflow.db` と同じ「`setup.sh` が配備先で手続き的に生成する生成物」という既存カテゴリに属し、この既存カテゴリ自体は当該 README にも既に一般的に記述済み（「`.agent-skill-chain/runtime/` | 消費者ランタイム生成物 | 無視（.gitignore） | 非配布」の行が `workflow.db` 等の生成物を包含する記述として機能している）。したがって、実装（as-built）と `docs/` システム仕様書の記載は引き続き矛盾せず、継続追随ゲートの更新は不要と再判定する。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1（重要・§4.2 指摘 1 と同一。対応済み）**: `package.json` の `files` allowlist が `setup.sh` の配布ロジックが前提とする配布内容と乖離しており、`runtime/templates/` 追加時（過去 issue）にはこの乖離が無かったが、`runtime/.gitignore` 追加時（本 issue）には乖離が生じた。さらに、単純に `files` へ追加するだけでは npm-packlist の `.gitignore` 除外制約により解決しないことも判明した（2 段階の発見）。
  - **影響範囲**: 実際の消費者（npx 経由の新規導入者）が `runtime/.gitignore` を受け取れず、`workflow.db-wal`/`-shm` の誤 git 追跡という本 issue が解決しようとした実害が再発しうる状態だった。
  - **対応方法（実施済み）**: ADR-4・案A（`.agent-skill-chain/source/runtime-gitignore.template` 新設 + `setup.sh` コピー元変更）で解消（§16 追記）。

### 10.2 改善提案（範囲外・メインへの提案に留める。サブは起票しない）

- **改善 1**: `setup.sh` が `$PACKAGE_ROOT` 配下から新規ファイルをコピーする変更を今後行う際、レビューのチェックリストに「`package.json` の `files` allowlist との整合確認」を追加することを提案する（起票の要否はメインが判断）。

---

## 11. システム仕様書の更新

- §6（docs 更新）のとおり、本 issue 単体では `docs/` システム仕様書の更新は不要（軽量パス）。指摘 1 解消後に再判定が必要。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（02/03 の ADR・具体コードに完全一致。命名慣例・既存パターンの踏襲も適切）。当初の設計スコープの抜け漏れ（§9.1）は ADR-4 追記により是正済み。
- **テスト品質**: 良好（新規・既存テストすべて PASS。UC9 は計画より手厚い境界値テストを追加）。当初指摘した e2e テストの「配布元シミュレーション」の射程限界（§3.2）を補うため、実 `npm pack` tarball を使った end-to-end 検証を追加実施し解消（§16 追記）。
- **ドキュメント品質**: 良好（00-04 すべて document_id 付与・整合。02/03 に ADR-4 追記済み）。
- **総合評価**: **クローズ可（2026-07-13 更新）**。当初発見した要修正 1 件（重要度高・指摘1）は ADR-4（案A）により解消済み。実際の npm 配布物（`npm pack` tarball）を用いた end-to-end 検証で恒久修正が機能することを確認した。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 委譲サブエージェント（レビュワー）
- **承認日**: 2026-07-13（初回レビュー）／2026-07-13（指摘1対応後の再確認・本追記）
- **承認コメント**: **承認（クローズ可）**。setup.sh・SETUP.md・PreToolUse.sh・テスト2件の実装自体は 02/03 の設計どおりで当初から指摘なし。本レビューで新規発見した指摘1（`package.json` `files` allowlist 未更新により実配布経路で機能しない）は、コーディネーターの判断により案A（`.agent-skill-chain/source/runtime-gitignore.template` 新設 + `setup.sh` コピー元変更、ADR-4）で対応され、実際に `npm pack` tarball の内容物確認・packed tarball のみを使った `setup.sh` 実行の end-to-end 検証（§16 追記）により機能することを確認した。`bash test/run-all.sh` は合計19 PASS=19 FAIL=0 SKIP=0（コーディネーターによる再実行でも同結果を確認済み）。**close 判断はメイン（orchestrator）がユーザー確認のもと行う。commit/push は本レビュー・本追記のいずれでも行っていない。**

### 12.3 敵対的観点リスト(反証・破壊を試みた観点と結論。不確実は要修正に倒す)

| # | 攻めた観点(反証仮説) | 検証 | 結論 |
| - | --- | --- | --- |
| A1 | `setup.sh` の新ブロックは実際の消費者配布経路で本当に機能するか(00 の成功基準「以後配布される全消費者プロジェクトで再発しない」を字義通り検証) | `npm pack --dry-run`/tarball inspect/`npm install git+file://` の3系統で実機検証。当初は機能せず(§4.2 指摘1)、ADR-4対応後に実 `npm pack` tarball 展開 + `setup.sh` 実行の end-to-end 検証で再確認(§16 追記) | **対応済み**(ADR-4・機能することを確認) |
| A2 | `PreToolUse.sh` R1 の例外がサブディレクトリ・紛らわしいファイル名(`.gitignore.bak`)に誤って拡大していないか | UC9 で `runtime/x/.gitignore`・`runtime/.gitignore.bak` の両方が block されることを実行確認 | 問題なし |
| A3 | 絶対パス表記で `runtime/.gitignore` を指定した場合に既存 R1 の絶対パス regex 分岐との整合が崩れていないか | UC9 で `/repo/.agent-skill-chain/runtime/.gitignore` が allow されることを実行確認(既存の絶対パス regex 分岐と同型の glob で対応) | 問題なし |
| A4 | `setup.sh` の新ブロック挿入により `runtime/templates` ブロック(既存)や後続処理に副作用が生じていないか | `git diff` で `runtime/templates` ブロックへの差分皆無を確認、e2e N1〜N7・R1〜R3 が全 PASS(回帰なし) | 問題なし |
| A5 | R1 以外のルール(R2〜R6)・scribe/subagent 分岐に回帰が生じていないか | hook テスト UC1〜UC8(jq/nojq 計)が全 PASS | 問題なし |
| A6 | `.claude/hooks/PreToolUse.sh`(生成物)が誤って直接編集されていないか | `git diff` に該当ファイルなし、かつ本 worktree に `.claude/` 自体が存在しないことを確認 | 問題なし |
| A7 | SETUP.md の追記が既存の表記スタイル・粒度と乖離し可読性を損ねていないか | grep 確認 + 目視で `runtime/templates/` 行との対比が保たれていることを確認 | 問題なし |
| A8 | 03 の実装計画が想定したテストケース数より実装が減っていないか(手抜き) | UC9 は計画3ケースに対し実装5ケース(境界値2件追加)、N2b も計画通り実装 | 問題なし(計画超過) |

### 12.4 must-preserve リスト(壊してはならない不変条件と保持確認)

| # | 不変条件(must-preserve) | 保持確認 |
| - | --- | --- |
| P1 | `PreToolUse.sh` の R1 以外の判定ロジック・判定順(既存挙動) | 保持(UC1〜UC8 全 PASS・`git diff` に R2〜R6 該当なし) |
| P2 | `runtime/templates/` の既存「毎回上書き」配布ロジック | 保持(`git diff` に既存ブロックへの変更なし・e2e N1〜N7 回帰なし) |
| P3 | `.gitignore` 未存在時のみコピーというローカル変更尊重の契約(ADR-1) | 保持(N2b でローカル変更が再配備後も保たれることを確認) |
| P4 | `PreToolUse.sh` 正本のみ修正し配備先生成物は直接触らないという契約(01 §5) | 保持(`git diff` に `.claude/hooks/` 該当なし) |
| P5 | 全成果ドキュメント(00-04)の document_id 付与・既存 document_id 不変 | 保持(00-03 の document_id 変更なし・04 は新規 UUID を初回付与) |
| P6 | 「判定の実体は `PreToolUse.sh` のみに集約」という単一正本方針 | 保持(判定ロジックの二重実装なし) |
| P7 | `.agent-skill-chain/runtime/` の他ファイル(`workflow.db*`・issue ドキュメント)への直接 Edit/Write 禁止 | 保持(UC9 で `workflow.db` の Write が引き続き exit 2 になることを確認) |

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義（成功基準・evidence_source の正）
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義（ストーリー1〜3・BDD6シナリオ）
- [`02_設計.md`](./02_設計.md) - 設計（ADR-1/2/3）
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画（タスク1-3・テスト仕様）

### 13.2 その他の参考資料

- `.agent-skill-chain/source/scripts/setup.sh`（変更対象）
- `.agent-skill-chain/source/SETUP.md`（変更対象）
- `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`（変更対象・正本）
- `test/e2e-install-uninstall.sh`・`test/test-pretooluse-hook.sh`（変更対象）
- `package.json`（`files` allowlist・§4.2 指摘1・ADR-4 対応で変更済み）
- `.agent-skill-chain/source/runtime-gitignore.template`（ADR-4・新規追加）
- `.agent-skill-chain/source/scripts/verify-npm-pack.sh`（ADR-4・必須物追加）
- `docs/01_システム概要/04_ディレクトリ構成/README.md`（配布可否の記載・§4.2 指摘2・§6.2 再判定の結果更新不要）
- `.agent-skill-chain/source/REVIEW_DUAL_LENS.md`（二観点の両リスト必須）
- `.agent-skill-chain/source/CLOSEOUT.md`（クローズアウト・verify 報告様式・起票権限）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本レビューは当初**要修正 1 件（重要度高）**を発見したが、ADR-4対応により解消し総合評価は「クローズ可」に更新した（§16 追記）。外部設定を伴わないため 05_最終確認チェックリストは不要。
- **close 判断はメイン（orchestrator）側でユーザー確認のもと実施する（本サブの範囲外）。commit/push は行っていない。**

---

## 16. 追記（2026-07-13・指摘1対応完了の確認）

### 16.1 経緯

本レビュー完了後、コーディネーターの判断により指摘1（§4.2）の対応が実施された。当初提案していた「`package.json` の `files` に `.agent-skill-chain/runtime/.gitignore` を追加する」対応は、実装担当が実際に `npm pack` して検証した結果、npm-packlist の仕様上機能しないことが新たに判明した。根本原因は npm-packlist（`npm-packlist/lib/index.js` の `defaults` 配列）が `.gitignore` という名前のファイルを `files` 配列指定に関わらず常に除外するハードコードされたルールを持ち、`files` 側の「明示ファイル強制包含」機構もパッケージルートから 2 階層以上ネストした位置（`.agent-skill-chain/runtime/.gitignore` はルートから2階層）では効かないことである（隔離環境での再現実験で確認済み）。

コーディネーターは案A（ソース側を非 `.gitignore` 名にし `setup.sh` のコピー時に `.gitignore` へリネームする。npm 自身の `npm init` テンプレート機構が採用する周知の回避策と同型）を採用する判断を下した。

### 16.2 実施内容（ADR-4・02_設計.md/03_実装計画.md に反映済み）

1. 新規ファイル `.agent-skill-chain/source/runtime-gitignore.template`（内容: 従来の `.agent-skill-chain/runtime/.gitignore` と同一の `workflow.db*` 1 行）を追加。
2. `setup.sh` の `WF_GITIGNORE_SOURCE` を `$PACKAGE_ROOT/.agent-skill-chain/runtime/.gitignore` から `$PACKAGE_ROOT/.agent-skill-chain/source/runtime-gitignore.template` に変更（コピー先・「未存在時のみコピー」ロジックは変更なし）。
3. `package.json` の `files` 配列から実効性の無い `.agent-skill-chain/runtime/.gitignore` 行を削除（新テンプレートは既存の `.agent-skill-chain/source/` ディレクトリ丸ごとエントリで配布されるため新規エントリ不要）。
4. `.agent-skill-chain/source/scripts/verify-npm-pack.sh` の必須物リストに新規テンプレートを追加（将来の回帰検知）。
5. `test/e2e-install-uninstall.sh` の N1 にコピー元テンプレートの配備確認・配布内容確認のアサーションを追加。

### 16.3 再検証結果（実機・evidence_source: test_output）

- **実 `npm pack` tarball 検証**: `npm pack`（dry-run ではなく実際にtarballを生成）し `tar -tzf` で内容物を直接確認した結果、`package/.agent-skill-chain/source/runtime-gitignore.template` が含まれることを確認（実装担当・コーディネーターの双方が独立に確認済み）。
- **end-to-end 検証**: packed tarball を `/tmp` 配下に展開し、その「真の npm 配布物のみ」のディレクトリを `PACKAGE_ROOT` として `setup.sh` を新規ディレクトリに対して実行した結果、`.agent-skill-chain/runtime/.gitignore` が生成され、内容が `workflow.db*` を含む正しいものであることを確認した。
- **回帰確認**: `bash test/e2e-install-uninstall.sh`（PASS=135 FAIL=0。N1 の新規アサーション・`test_no_dist_leak` 経由の `verify-npm-pack.sh` 必須物チェック含む）、`bash test/test-pretooluse-hook.sh`（PASS=62 FAIL=0。ADR-4 の影響を受けないことを確認済み）、`bash test/run-all.sh`（合計19 PASS=19 FAIL=0 SKIP=0。コーディネーターによる独立再実行でも同結果）。

### 16.4 指摘2・docs 更新ゲートの再判定

- §4.2 指摘2・§6.2（docs 更新ゲート再判定）のとおり、`docs/01_システム概要/04_ディレクトリ構成/README.md` L18 の記載は ADR-4 適用後も更新不要と判断した（案Aが `package.json` の `files` allowlist に `.gitignore` を直接追加する方式ではなく、既存の `.agent-skill-chain/source/` 配布ルールに乗せる方式であるため、当該 README が記述する配布可否の粒度自体は変化していない）。

### 16.5 結論

上記により §4.2 指摘1は解消したと判断し、総合評価を「要修正」から「クローズ可」に更新する。close 判断そのものはメイン（orchestrator）がユーザー確認のもと行う。
