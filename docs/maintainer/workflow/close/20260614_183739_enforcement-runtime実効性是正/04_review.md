---
document_id: "5f0c2a18-7b4e-4d3a-9c2f-3a1e6b8d0c44"
---

# レビュー書: enforcement runtime 実効性の是正（PreToolUse/PostToolUse の stdin JSON 対応・exit 2 ブロック）

**プロジェクト名**: enforcement runtime 実効性の是正
**作成日**: 2026 年 06 月 14 日
**最終更新**: 2026 年 06 月 14 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../.agents/CONCEPTS.md#用語規約) を参照。
>
> **必須**: レビュー実施時は [`.agents/REVIEW_RULE.md`](../../../../.agents/REVIEW_RULE.md) を参照。本レビューの深度は **full**（新規 hook 単体テスト追加・enforcement runtime のセキュリティ境界変更のため）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 — enforcement runtime hook（PreToolUse/PostToolUse）の stdin JSON 対応・exit 2 ブロック・AGENT_ROLE 別 reject・env 後方互換・両経路発火が、01 のユースケース 1〜7 と成功基準 SC-1〜SC-6 を満たすことを、tmp 隔離（本リポ非破壊・非有効化）で検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**:
  - `.agents/enforcement/claude/PreToolUse.sh`（stdin JSON 取得＋`block`/`allow`＝exit2/exit0＋role 別 reject R1-R6＋env 後方互換フォールバック）
  - `.agents/enforcement/claude/PostToolUse.sh`（stdin 読み捨て fail-safe・案内のみ exit0）
  - `.agents/scripts/build-adapters.sh`（plugin `hooks.json` PreToolUse 結線に `AGENT_ROLE="${AGENT_ROLE:-orchestrator}"` 付与）
  - `.agents/scripts/test/test-pretooluse-hook.sh`（新規・hook 単体 BDD・tmp 隔離）
- **レビュー期間**: 2026-06-14 ～ 2026-06-14
- **レビュー担当者**: auditor/scribe（verify-and-close 委譲サブエージェント）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1 入力一本化 | `parse_input`/`json_get` で stdin JSON（tool_name/command/file_path 限定抽出）→ env 後方互換の単一入力層 | 2026-06-14 | implementer | 完了 |
| T2 exit2 化 | `block`(exit2)/`allow`(exit0) 薄関数に集約。`exit 1` 全廃 | 2026-06-14 | implementer | 完了 |
| T3 role 別 reject | R1-R6 を確定変数 TOOL/PATH_TARGET/CMD/ROLE で判定（stdin/env 非依存） | 2026-06-14 | implementer | 完了 |
| T4 PostToolUse 整合 | `set +e`＋stdin 読み捨て・案内のみ exit0 | 2026-06-14 | implementer | 完了 |
| T5 両経路発火・配線 | build-adapters.sh の plugin hooks.json に `AGENT_ROLE="${AGENT_ROLE:-orchestrator}"` 付与 | 2026-06-14 | implementer | 完了 |
| T6 hook 単体テスト | test-pretooluse-hook.sh（tmp 隔離・jq 有/無・role 別・両経路・PostToolUse） | 2026-06-14 | implementer | 完了 |

### 2.2 実装内容の詳細

#### 入力層（parse_input / json_get）

- **実装内容**: `parse_input` が `[[ ! -t 0 ]]` のとき stdin を全量読込（`RAW="$(cat)"`）。`RAW` が `{` 始まりで `tool_name` を含む軽量判定で「JSON 様」と判断したときのみ `json_get` で抽出、それ以外は env（`CLAUDE_TOOL_NAME:-TOOL_NAME` 等）を読む。
- **json_get**: jq があれば `jq -r '.tool_name // empty'` ほか 3 フィルタのみ。無ければ `grep -oE` + `sed` で `"key":"値"`（`\"`/`\\`/`\/` エスケープ許容）を 1 件抽出。抽出失敗は空文字（誤検知抑制・BR-4）。
- **確認事項**: 抽出対象を `tool_name`/`tool_input.command`/`tool_input.file_path` の 3 キーに限定（01 §4.2・02 §4.1）。過剰な汎用パースをしない方針が遵守されている。

#### exit2 化（block/allow）

- 全 reject 分岐が `block "理由"`（stderr 出力＋`exit 2`）を呼ぶ。通過後に末尾 `allow`（`exit 0`）。`exit 1` の残存ゼロを静的確認済み（§3.1）。

#### role 別 reject（R1-R6）

- R1（`.workflow/` 直接 Write/Edit・全 ROLE）/ R2・R2'（orchestrator allowlist）/ R3（非 scribe の Bash 禁止）/ R4（複合シェル禁止）/ R5（write-workflow-log.sh 単独実行のみ）/ R6（sqlite3 直接禁止・全 ROLE）。R6 は scribe の R5 判定より前に先行判定し、role 共通の明確な理由を優先表示する設計（02 §3.3 と整合）。

#### build-adapters.sh（plugin hooks.json）

- 生成される `hooks.json` の PreToolUse 結線に `AGENT_ROLE="${AGENT_ROLE:-orchestrator}"` を追加（既定 orchestrator）。コメント L139 に後方互換（未指定でも R1/R3/R6 は効く・指定で R2 発火）を明記。setup 経路（settings.enforce.json の `AGENT_ROLE="${AGENT_ROLE:-orchestrator}"`）と挙動をそろえる意図的差分。

---

## 3. テスト結果の確認

> すべて tmp 隔離（`mktemp -d` ＋ `git archive HEAD | tar -x` のクリーン clone 再現）で実施。本リポの `.agents/.claude/.cursor/.workflow/workflow.db` を一切読み書き・変更していない（.agents-project §テストの tmp 隔離）。

### 3.1 静的検査

- **`bash -n` 構文チェック**: PreToolUse.sh / PostToolUse.sh / test-pretooluse-hook.sh いずれも OK。【evidence_source: test_output】
- **`exit 1` 残存**: `grep -n "exit 1" PreToolUse.sh PostToolUse.sh` → 該当なし（grep rc=1）。**exit 1 全廃を確認**。【evidence_source: test_output】

### 3.2 単体テスト（hook 単体・test-pretooluse-hook.sh）

#### テスト実行結果

- **実行日**: 2026-06-14
- **テストファイル数**: 1（test-pretooluse-hook.sh）
- **テストケース数**: 32（assert 単位）
- **成功**: 32
- **失敗**: 0
- **スキップ**: 0

実行コマンド: `bash .agents/scripts/test/test-pretooluse-hook.sh` → `PASS=32 FAIL=0 全テスト PASS`（exit 0）。【evidence_source: test_output】

#### 自分による代表ケースの再現（`echo JSON | AGENT_ROLE=<role> bash hook`）

tmp 隔離環境（git archive HEAD ＋ 作業ツリー hook オーバーレイ）で、契約指定の代表ケースの**実測 exit code**を独立再現した。

| ケース | role | JSON 要点 | 期待 | 実測 | 結果 |
| ------ | ---- | --------- | ---- | ---- | ---- |
| orchestrator の Write | orchestrator | Write / file_path | exit 2 | 2 | OK |
| orchestrator の Grep | orchestrator | Grep / pattern | exit 0 | 0 | OK |
| 非 scribe（worker）の Bash | worker | Bash / `ls` | exit 2 | 2 | OK |
| scribe の write-workflow-log.sh 単独 | scribe | Bash / `write-workflow-log.sh …` | exit 0 | 0 | OK |
| sqlite3 直接 | scribe | Bash / `sqlite3 …` | exit 2 | 2 | OK |
| `.workflow` 編集 | worker | Edit / `.workflow/x/00_…` | exit 2 | 2 | OK |

【evidence_source: test_output】

#### jq 有/無 両系統

- **jq 不在（システム実環境）**: システムに jq が存在しないため、上記代表ケースは sed/grep フォールバック経路で実測（全件期待一致）。
- **jq 存在（jq シム経由）**: 3 フィルタ（`.tool_name`/`.tool_input.command`/`.tool_input.file_path`）を python3 で忠実実装した jq シムを PATH 前段に置き、orchestrator Write→2 / orchestrator Grep→0 / scribe sqlite3→2 / scribe write-log→0 / worker `.workflow` Edit→2 を再現（全件期待一致）。
- 加えて test-pretooluse-hook.sh 内の `make_nojq_path`（jq 除外 PATH）と `make_jq_path`（jq シム）により、UC1/UC2 系で jq 有/無の同一合否を機械検証済み（32 件に内包）。
- **判定**: jq 有/無の両系統で違反→2・正当→0 が一致。【evidence_source: test_output】

#### 後方互換（env / 入力なし）

| ケース | 入力 | 期待 | 実測 | 結果 |
| ------ | ---- | ---- | ---- | ---- |
| stdin 空＋env 違反 | stdin="" / `CLAUDE_TOOL_NAME=Write` / role=orchestrator | exit 2（env フォールバック発火） | 2 | OK |
| env も stdin も無し | stdin="" / tool env 無し / role=unknown | exit 0（過剰ブロックしない・保守的） | 0 | OK |
| 非 JSON stdin | `not json at all` / role=orchestrator | exit 0（誤検知なし・env へ倒れる） | 0 | OK |

env フォールバックが従来どおり reject し、入力取得不能時は fail-safe（exit 0）に倒れることを確認。BR-2/BR-4 と整合。【evidence_source: test_output】

### 3.3 結合・両経路（plugin / setup）

- **setup 経路**: 隔離環境に `.claude/hooks/PreToolUse.sh`（正本コピー）を配備し違反 JSON→exit2 を確認（UC6 シナリオ6-1）。
- **plugin 経路**: 同梱 `.agents/enforcement/claude/PreToolUse.sh`（plugin 結線先相当）に違反 JSON→exit2 を確認（UC6 シナリオ6-2）。
- **build-adapters.sh の hooks.json 生成**: `build-adapters.sh claude` 生成の `.adapters/claude/hooks/hooks.json` は **valid JSON**（python3 `json.load` 成功）。PreToolUse 結線は `AGENTS_ROOT="${CLAUDE_PLUGIN_ROOT}/.agents" AGENT_ROLE="${AGENT_ROLE:-orchestrator}" bash "…/PreToolUse.sh"`、PostToolUse は `AGENTS_ROOT=… bash "…/PostToolUse.sh"`。`AGENT_ROLE` 付与は意図的差分（02 §3.5・T5）。`build-adapters.sh cursor` は hooks.json を生成しない（cursor は別機構。GENERATED.md のみ。意図どおり）。【evidence_source: test_output】

### 3.4 E2E 回帰（e2e-install-uninstall.sh）

- `bash .agents/scripts/test/e2e-install-uninstall.sh` → **PASS=88 FAIL=0 全シナリオ pass**（exit 0）。
- S1-S7（install）・R1-R5（再インストール/uninstall の所有/自作分離）・**R6（enforcement opt-in 既定 off・on/off・status）**・**R7（enforce on/off が settings.json を破壊しない）** を含む。R6 で「hooks が PreToolUse.sh を指し AGENT_ROLE=orchestrator が設定される」が PASS。既存配線・着脱機構を壊していない（01 §4.2・SC-3 後段）。【evidence_source: test_output】

### 3.5 本リポ非有効化の確認（最重要・絶対安全制約）

- **`enforce on` 未実行**。`.claude/settings.json` を**作成・変更していない**（`.claude/settings.json` は存在しない＝enforce off）。`agents-md.js enforce on` 等の有効化操作を一切行っていない。
- **`git status` に `.claude/` 変更なし**。working tree の変更は実装対象 4 ファイル（PreToolUse.sh・PostToolUse.sh・build-adapters.sh＝modified、test-pretooluse-hook.sh＝untracked）と issue ドキュメント（02/03＋本 04）のみ。`.claude/`（gitignore 対象・既存 setup 生成物）に変更差分は出ていない。
- 全検証は `mktemp -d` 隔離環境で実施し、live セッションのツール経路に hook を結線していない。【evidence_source: observed_runtime】

---

## 4. コードレビュー

### 4.1 コード品質

- **リント結果**: `bash -n` 0 エラー（3 ファイル）。
- **フォーマット**: 問題なし（責務コメント・BDD インラインコメント付き）。
- **型チェック**: 該当なし（shell）。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 入力層/判定層/終了コード層を関数分離。各 reject に責務コメント | OK | 02 §1.2 単一責務・可読性優先と整合 |
| 保守性 | 抽出キー 3 種に限定、block/allow に exit 集約。マジックナンバー非散在 | OK | exit 2/0 は block/allow の 1 か所のみ |
| パフォーマンス | jq 1 回または sed/grep 数回で完結。重い依存なし | OK | 01 §3.1 と整合 |
| セキュリティ | 保護パス/sqlite3/複合シェル/orchestrator write を exit2 で fail-closed、入力不能は fail-safe | OK | §4.2 指摘 1 参照 |

### 4.2 指摘事項

#### 指摘 1: R6 重複判定（軽微・推奨対応＝現状維持可）

- **重要度**: 低
- **指摘内容**: sqlite3 禁止（R6）が Bash ブロック内 L158 と末尾 L189 の 2 か所に存在する。L158 は scribe の R5 より前に role 共通理由を優先表示するための先行判定で、末尾 L189 は非 Bash 経路（env で CMD が渡る等）の網羅。**意図的な二重防御**であり機能上の問題はないが、コメントで「先行（優先表示）」と明記済みのため可読性も担保されている。
- **対応状況**: 対応不要（設計意図どおり）。
- **対応方法**: 将来 R6 を関数化すれば重複記述を 1 か所に集約できる（任意の改善・本 issue スコープ外）。

#### 指摘 2: TEST_BDD_FORMAT 準拠（OK・指摘なし）

- test-pretooluse-hook.sh はファイル冒頭に `ユースケース:`、各テスト関数直前に `# シナリオ:`、本体に `# Given:`/`# When:`/`# Then:` を 1 つずつ付与。各シナリオに 01 の SC/UC 参照（例「01 SC-1 / UC1 シナリオ1-1」）を付している。TEST_BDD_FORMAT §0-§3 を満たす。
- **対応状況**: 指摘なし（完了）。

#### 指摘 3: 証跡規約（OK）

- hook 自体は workflow.db に書き込まない（PostToolUse は案内のみ）。証跡は scribe の write-workflow-log.sh に委譲する設計で CORE「ログは書記のみ」と整合。違反なし。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（スコープ 00/01 として確定。実装は後続フェーズで充足） | auditor | 2026-06-14 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（UC1-7・SC-1〜6 確定） | auditor | 2026-06-14 |
| [`02_設計.md`](./02_設計.md) | 更新済み（責務分離・R1-R6・両経路） | auditor | 2026-06-14 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（T1-T6・BDD 仕様） | auditor | 2026-06-14 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（parse_input/json_get/block/allow・R1-R6・PostToolUse fail-safe・hooks.json AGENT_ROLE 付与が 02/03 のとおり）。
- **要件と実装の整合性**: 整合している（UC1-7 が test と 1:1 対応。§9.1 map-coverage 参照）。

---

## 6. パフォーマンス確認

- hook はツール実行ごとに同期実行されるが、jq 1 回または sed/grep 数回で完結し無視できる遅延。ボトルネックなし。

---

## 7. セキュリティ確認

| 項目 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 認証・認可 | ROLE 別ツール認可（orchestrator allowlist・scribe の Bash 限定） | OK | UC1/UC5 で実測 |
| データ保護 | `.workflow/` 直接 Write/Edit・sqlite3 直接を exit2 で拒否 | OK | UC3/UC2/UC5 で実測。証跡 DB 直接改変経路を封鎖 |
| 入力検証 | stdin JSON 抽出キーを 3 種に限定。非 JSON は env へ倒し誤検知抑制 | OK | UC4 で実測 |

---

## 8. デプロイ準備

- [x] すべてのテストが通過している（hook 単体 32/0・e2e 88/0）
- [x] コードレビューが完了している
- [x] ドキュメントが更新されている（00/01/02/03＋本 04）
- [ ] マイグレーションスクリプト（該当なし）
- [x] 環境変数の設定が確認されている（AGENT_ROLE/AGENTS_ROOT 配線）
- [ ] バックアップ計画（該当なし）

- **デプロイ計画**: commit/push/PR は orchestrator が後続で実施（本レビューでは行わない）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本変更は enforcement runtime の内部挙動是正であり、システム仕様書（docs/）の機能仕様には影響しない。なお SETUP/README の「実効範囲注記（過信防止）」更新（00 §1.3 効果 3）は本 issue 実装スコープ外の後続改善であり、本 issue の DoD ではない。

---

## 9. 設計・境界の確認

### 9.1 受け入れ基準・UC とテストの対応（map-coverage）

01 のユースケース 1〜7 と hook 単体テストの 1:1 対応。すべて test_output を検証方法とする。

| UC | シナリオ | 対応テスト関数 | 検証方法 | 結果 |
| -- | -------- | -------------- | -------- | ---- |
| UC1 | 1-1 orchestrator Write を stdin で exit2 | `uc1_orchestrator_write_blocked` | exit code＝2＋stderr メッセージ | 通過 |
| UC1 | 1-2 正当 Read/Grep は exit0 | `uc1_orchestrator_grep_allowed` | exit code＝0 | 通過 |
| UC2 | 2-1 jq 不在 sqlite3 を exit2 | `uc2_nojq_sqlite_blocked` | NOJQ_PATH で exit2＋メッセージ | 通過 |
| UC2 | 2-2 jq 不在で file_path 抽出 | `uc2_nojq_extracts_file_path` | NOJQ_PATH で exit2 | 通過 |
| UC3 | 3-1 `.workflow` Edit を exit2 | `uc3_workflow_edit_exit2` | exit2＋メッセージ | 通過 |
| UC3 | （補）worker 通常 Write は exit0 | `uc3_worker_normal_write_allowed` | exit0 | 通過 |
| UC4 | 4-1 stdin 空＋env 違反で reject | `uc4_env_backcompat_blocked` | exit2 | 通過 |
| UC4 | （補）入力なしは exit0 / 非 JSON は exit0 | `uc4_empty_stdin_no_env_allowed` / `uc4_non_json_stdin_allowed` | exit0 | 通過 |
| UC5 | 5-1 orchestrator Grep は exit0 | `uc1_orchestrator_grep_allowed`（兼） | exit0 | 通過 |
| UC5 | 5-2 非 scribe の Bash は exit2 | `uc5_worker_bash_blocked` / `uc5_orchestrator_bash_blocked` | exit2＋メッセージ | 通過 |
| UC5 | 5-3 scribe write-workflow-log.sh 単独は exit0 | `uc5_scribe_writelog_allowed` | exit0 | 通過 |
| UC5 | （補）R4 複合シェル / R6 sqlite3 / unknown の R1 | `uc5_scribe_compound_blocked` / `uc5_scribe_sqlite_blocked` / `uc5_unknown_role_workflow_blocked` | exit2 | 通過 |
| UC6 | 6-1 setup 経路で exit2 | `uc6_setup_path_blocks` | exit2 | 通過 |
| UC6 | 6-2 plugin 経路で exit2 | `uc6_plugin_path_blocks` | exit2 | 通過 |
| UC7 | 7-1 PostToolUse は案内のみ exit0 | `uc7_posttooluse_exit0` / `uc7_posttooluse_empty_exit0` | exit0＋案内 | 通過 |
| jq 系 | jq present 系統が no-jq と同一合否 | `jq_orchestrator_write_blocked` / `jq_scribe_sqlite_blocked` / `jq_orchestrator_grep_allowed` | exit2/2/0 | 通過 |

成功基準対応: SC-1（違反→exit2）＝UC1/UC3/UC5、SC-2（正当→exit0）＝UC1/UC3/UC5、SC-3（env 後方互換）＝UC4＋e2e R6、SC-4（jq 非依存）＝UC2＋jq 系、SC-5（role 別分岐）＝UC5、SC-6（両経路発火）＝UC6＋build-adapters hooks.json 検証。**全 SC をテストでカバー。未達なし。**

### 9.2 設計の確認

- **設計原則の準拠**: spec/01 設計原則・UNIX 哲学（小さく 1 つのことをうまく）に準拠。入力取得・判定・終了コードを関数分離（単一責務）。02 §1.2 と一致。
- **ディレクトリ構成**: 正本は `.agents/enforcement/claude/` の 1 か所（二重定義なし・BR-6）。テストは `.agents/scripts/test/` 配下で既存 e2e と同階層。spec/02 準拠。
- **命名規則**: `test-pretooluse-hook.sh` は既存 `e2e-install-uninstall.sh`・`test-write-workflow-log-prevhash.sh` と整合。

### 9.3 境界・依存の確認

- **責務の境界**: 入力層（parse_input/json_get）のみが stdin/env を読み、判定層は確定変数のみ参照。配線（hooks.json/settings.enforce.json）は hook を呼ぶ一方向で判定ロジックを持たない。02 §2.1.3 のとおり。
- **依存関係**: 循環なし。jq は任意依存（フォールバックあり）。
- **指摘・推奨**: §4.2 指摘 1（R6 二重防御）のみ。機能影響なし・対応不要。

### 9.4 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 違反→exit2・正当→exit0 が role 別/jq 有無/両経路で成立 | test_output | hook 単体 32/0・代表ケース独立再現 |
| env 後方互換が維持され既存配線を壊さない | test_output | UC4＋e2e 88/0（R6/R7 含む） |
| 公式 hooks 契約（stdin JSON・exit2 block） | external_spec | 01/02 の【external_spec】（親 issue 04 §H-6 で独立確認済み） |
| 本リポ非有効化（enforce 未実行・.claude 変更なし） | observed_runtime | git status・.claude/settings.json 不在 |
| stdin 取得の保守的フォールバック（誤検知抑制） | existing_code | PreToolUse.sh parse_input/json_get の実装確認 |

inference_only 単独依存の重要判断はない（承認可）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: 実 `enforce on` 状態での実機ドッグフーディングは未検証（絶対安全制約により本レビューでは禁止）。
  - **影響範囲**: 実機 Claude Code が hook に渡す stdin JSON の実スキーマ・実 env（`CLAUDE_TOOL_NAME` 不在）との完全一致は external_spec ベースの確証であり、実機ログ（observed_runtime）での最終確認は別途必要。
  - **対応方法**: ユーザー判断で別環境/別ブランチにて enforce on の実機検証を行う（ライブセッションをブロックし得るため本リポでは実施しない）。

### 10.2 改善提案

- **改善 1**: R6（sqlite3）判定の関数化で二重記述を 1 か所に集約。
  - **効果**: 可読性向上（機能不変）。本 issue スコープ外の任意改善。

---

## 11. システム仕様書の更新

### 11.1 確認結果

- 本変更は runtime hook の内部挙動是正であり、システム仕様書（docs/）の機能仕様に影響しない。更新不要。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（責務分離・fail-safe/fail-closed 境界明確・exit 1 全廃）。
- **テスト品質**: 良好（hook 単体 32/0・UC1-7 と 1:1 対応・jq 有無/両経路/後方互換を網羅・tmp 隔離）。
- **ドキュメント品質**: 良好（00/01/02/03 と実装が整合）。
- **総合評価**: **承認可（ブロッカーなし）**。指摘は §4.2 指摘 1（低・対応不要）のみ。

### 12.2 承認状況

- **レビュー承認者**: auditor（verify-and-close）
- **承認日**: 2026-06-14
- **承認コメント**: SC-1〜SC-6 を tmp 隔離で充足。本リポ非有効化を確認。残課題は実 enforce on の実機ドッグフーディング（ユーザー確認事項・別環境推奨）のみ。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- 実コード: `.agents/enforcement/claude/PreToolUse.sh`・`PostToolUse.sh`、`.agents/scripts/build-adapters.sh`、`.agents/scripts/test/test-pretooluse-hook.sh`
- Claude Code hooks 公式仕様（stdin JSON `tool_name`/`tool_input`・ブロック exit 2）【external_spec】

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本 issue の実装フェーズ完了。orchestrator による commit/push/PR、および（ユーザー判断で）実 enforce on の実機ドッグフーディング検証。
