---
document_id: "47942099-baf1-42c5-b6f0-0011e42384cb"
---

# レビュー書: orchestrator AskUserQuestion 許可

**プロジェクト名**: orchestrator AskUserQuestion 許可
**作成日**: 2026 年 07 月 14 日
**最終更新**: 2026 年 07 月 14 日

> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
> **レビュー深度**: standard（enforcement のセキュリティ境界に触れるため、敵対的観点は full 相当で実施）。二観点必須化は [REVIEW_DUAL_LENS.md](../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md) に従い、敵対的観点リストと must-preserve リストの両方を §4.3/§4.4 に記載する。

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認・品質保証・close 前最終チェック。ユーザー明示指示により、実装前レビュー観点も含め肯定的・敵対的の二観点で検証する。

### 1.2 レビュー対象

- **実装範囲**: FR-1（AskUserQuestion を R2 allowlist 追加）/ FR-2（メタデータ自動分類 feasibility 調査＝実装なし・ADR-2 見送り）/ FR-3（ロックアウト復旧手順の文書化）/ FR-4（project 固有 allowlist opt-in 拡張機構）/ FR-5（review-docs への REVIEW_DUAL_LENS 接続）/ FR-6（バナー/block 出力分離）/ FR-7（日英併記）。タスク T1〜T8。
- **レビュー期間**: 2026-07-14 ～ 2026-07-14
- **レビュー担当者**: verify-and-close 実行サブエージェント（fresh reviewer）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク | 実装内容 | 変更ファイル | ステータス |
| --- | --- | --- | --- |
| T1 FR-1 | R2 allowlist に `AskUserQuestion` を追加＋非破壊理由コメント | PreToolUse.sh | 完了 |
| T2 FR-4 | `is_in_project_allowlist()` 追加・`*)` default で opt-in 判定＋雛形ファイル | PreToolUse.sh, orchestrator-allowlist.example.txt | 完了 |
| T3 テスト | UC1/UC10/UC11 等のケースを既存テストへ追加（tmp 隔離・jq 有無両系統） | test/test-pretooluse-hook.sh | 完了 |
| T4 FR-3 | ロックアウト復旧手順（`!`enforce off・機構説明）を SETUP.md 正本＋CORE/README/project から参照 | SETUP.md, CORE.md, README.md, project/README.md | 完了 |
| T5 FR-4 文書 | project 拡張の存在・使い方・更新経路・fail-closed・能力リスク警告 | SETUP.md, project/README.md, README.md, enforcement/README.md | 完了 |
| T6 FR-5 | review-docs へ REVIEW_DUAL_LENS 参照＋両リスト DoD／正本へ適用先 1 行追記 | commands/review-docs.md, REVIEW_DUAL_LENS.md | 完了 |
| T7 FR-6 | `[enforcement:block]`／`[PreToolUse:info]` prefix 分離（挙動不変） | PreToolUse.sh | 完了 |
| T8 FR-7 | block 理由・バナーを日英併記（英語先頭保持でテスト非破壊） | PreToolUse.sh, PostToolUse.sh | 完了 |
| FR-2 | メタデータ自動分類は feasibility 不可 → 見送り（実装なし） | 02_設計 ADR-2 のみ | 完了（設計判断） |

### 2.2 実装内容の詳細（要点）

- **FR-1**: R2 `case` の allow 列に `AskUserQuestion` を追加。`Agent` 追加時の先例に倣い「読み取り専用・非破壊のユーザー対話ツール。CORE.md §やってはいけないこと に非該当」のコメントを併記。`ROLE==orchestrator && IS_SUBAGENT!=1` の分岐内に限定されており、worker（agent_id あり）経路には非影響。
- **FR-4**: `is_in_project_allowlist()` は `.agent-skill-chain/project/orchestrator-allowlist.txt` を **`source` せずデータ read**。`#` コメント除去→先頭末尾 trim のみ（内部空白は collapse しない）→`^[A-Za-z][A-Za-z0-9_]*$` 衛生フィルタ→`[[ "$line" == "$want" ]]` 厳密一致。ファイル不在・非正規ファイル・空・全行不正・読取不可は偽→`*)` default block（fail-closed 保全）。`*)` より手前の `Bash`/`Edit|Write|...` 明示 block は拡張で覆せない。
- **FR-6/FR-7**: `block()` を `[enforcement:block] 違反(BLOCK): <英語>/<日本語>` に、常時バナー・`.agents not found` を `[PreToolUse:info]` に変更。exit code・判定・ストリームは不変。英語部分文字列は先頭保持。
- **配布物側の雛形**: `orchestrator-allowlist.example.txt` は enforcement から**読まれない**（実効ファイル名 `orchestrator-allowlist.txt` と別名）。本リポの `.agent-skill-chain/project/` には実効ファイルを**置かない**（自己 allowlist 拡張の防止）ことを実測確認（`.agent-skill-chain/project/orchestrator-allowlist.txt` は ABSENT）。

---

## 3. テスト結果の確認

### 3.1 単体テスト（再実行・フォアグラウンド）

#### `bash test/test-pretooluse-hook.sh`（実行日 2026-07-14）

- **結果**: `PASS=96 FAIL=0`（全テスト PASS・exit 0）
- **カバー UC**: UC1（stdin/jq・AskUserQuestion exit 0 含む）/ UC2（jq 非依存 fallback）/ UC3（.workflow block）/ UC4（env 後方互換）/ UC5（AGENT_ROLE 分岐）/ UC6（両経路発火）/ UC7（PostToolUse 整合）/ UC8（subagent worker 昇格）/ UC9（runtime/.gitignore 厳密例外）/ UC10（project allowlist 拡張・注入/CRLF/内部空白/mcp opt-in 各系）/ UC11（出力分離・日英併記）。jq 有無 両系統で対称。
- 実行は tmp 隔離（`/tmp/tmp.XXXX` 配下）で行われ、本リポ資産を破壊しないことを確認。

#### `npm test`（= `bash test/run-all.sh`・実行日 2026-07-14）

- **スイート集計**: `合計=19 PASS=14 FAIL=0 SKIP=5`（**失敗 0**）。SKIP=5 は環境依存の e2e/パッケージング系（e2e-install-uninstall・package-manifest-parity・cli-audit-doctor・export-ndjson・e2e-claude-hook 等の依存欠如による skip であり失敗ではない）。
- 主要スイート個別: test-audit **113 PASS/0 FAIL**、test-check-comment-refs **13 PASS/0 FAIL**、test-pretooluse-hook **96 PASS/0 FAIL**、test-c4-bypass-resistance 13 PASS、test-workflow-db-guard 14 PASS、test-write-workflow-log-* 各 PASS。
- **重要な非破壊確認**: `audit.sh`・`check-comment-refs.sh` は**未変更**（後述 §9.2）だが、それぞれの回帰スイート（test-audit 113 / test-check-comment-refs 13）が全 PASS。日英併記（T8）による既存 `assert_grep`（英語部分文字列）非破壊が test-pretooluse-hook 96 PASS で実証された。

| 指標 | 値 |
| --- | --- |
| テストスイート数 | 19（実行 14・skip 5） |
| 失敗 | 0 |
| pretooluse ケース | 96 PASS / 0 FAIL |

#### 失敗したテスト

なし。

---

## 4. コードレビュー

### 4.1 コード品質

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | 各判定に ADR 参照コメント・fail-closed 意図が明記 | OK | is_in_project_allowlist の設計原則コメントが充実 |
| 保守性 | 最小差分（allow 列 +1・default に opt-in 分岐追加・出力 prefix 変更）。判定構造・拒否分岐は不変 | OK | 既存 R1〜R6 構造を維持 |
| セキュリティ | fail-closed（allowlist）維持・opt-in 拡張は明示拒否名を覆せない・注入/難読化を衛生フィルタで無効化 | OK | §4.3 敵対的検証で個別確認 |
| 挙動不変性（FR-6/7） | exit code・許可/拒否判定・ストリーム不変。prefix/文言のみ変更 | OK | test-pretooluse-hook 96 PASS で実証 |

### 4.2 指摘事項

- **指摘 0 件**（要修正なし）。§4.3 の敵対的観点で反証を試みたが、fail-closed を破る経路・スコープ逸脱・退行はいずれも検出されなかった。

### 4.3 敵対的観点リスト（反証・破壊の試みと結論／REVIEW_DUAL_LENS §2.1）

| # | 攻めた観点 | 検証方法 | 結論 |
| --- | --- | --- | --- |
| A1 | AskUserQuestion 追加で変更系ツール禁止が緩むか | orchestrator×Bash/Edit/Write を UC1/UC5/UC11 で確認 | 緩まない（各 exit 2 維持）。allow 列追加は `case` の他分岐に非干渉 |
| A2 | project 拡張で明示拒否名（Bash/Edit）を覆せるか | UC10 で allowlist に Bash/Edit を記載しても呼び出しは exit 2 | 覆せない。明示拒否は `*)` より手前の case で block、拡張到達前に確定 |
| A3 | 拡張ファイルへのコマンド注入（`Foo; rm -rf /`・`Foo\r`・`Foo bar`） | UC10 各ケース | 注入行は衛生フィルタ `^[A-Za-z][A-Za-z0-9_]*$` で無視。CRLF は末尾 trim で正名一致、内部空白は化けず無視 |
| A4 | ファイル不在・空・全行コメント・非正規ファイルで許可漏れするか | UC10 fail-closed 系 | いずれも偽→default block。fail-closed 保全 |
| A5 | example.txt を誤って実効ファイルとして読むか | PreToolUse.sh を grep（"example" 参照なし）。実効名は `orchestrator-allowlist.txt` のみ | 誤読なし |
| A6 | 本リポで自己 allowlist 拡張が発生していないか | `.agent-skill-chain/project/orchestrator-allowlist.txt` の存在確認 | ABSENT。自己拡張なし・コア default 厳格維持 |
| A7 | 日英併記で既存 assert_grep（英語部分文字列）が壊れるか | test-pretooluse-hook 96 PASS・英語先頭保持を diff で確認 | 壊れない |
| A8 | FR-6/7 が挙動（exit code・判定）を変えていないか | exit code アサーション全 PASS・変更は echo 文言のみ（diff 確認） | 挙動不変 |
| A9 | worker（subagent）経路が本変更の影響を受けるか | UC8/UC2（IS_SUBAGENT 分岐は R2 対象外） | 非影響。R2 allowlist は main 限定 |
| A10 | denylist 全面転換が混入していないか | 00/01/02 grep・実装 diff | 混入なし。allowlist 方式維持。ADR-2/ADR-7 で「採用」記載なし |
| A11 | scribe 最優先・R5 write-workflow-log 単独実行制約が退行していないか | UC5/UC8 の scribe 系全 PASS | 退行なし（不変条件 M6 保持） |
| A12 | スコープ外ファイル（audit.sh/check-comment-refs.sh）が変更されたか | `git diff main --name-only` | 未変更（§9.2）。ADR-6/ADR-8 の後続送り決定と一致 |

**不確実性の扱い**: 能力ベース残余リスク（`mcp__*` 系書込ツールを opt-in すると Edit/Write を介さず等価権限を得る）は、コード実装で機構的には塞げない性質のもの。実装はこれを隠さず、`is_in_project_allowlist` コメント・`orchestrator-allowlist.example.txt` 警告・SETUP.md・ADR-3/ADR-4 で正直化し、安全性を「clean な素名記述＋人間 PR レビュー」に依存すると明記している。安全側（要人間確認）に倒す設計であり、承認可。

### 4.4 must-preserve リスト（不変条件と保持確認／REVIEW_DUAL_LENS §2.2）

| # | 壊してはならない不変条件 | 保持確認 |
| --- | --- | --- |
| M1 | allowlist 方式（未知ツールは default 拒否＝fail-closed） | 保持（`*)` block 継続・opt-in は狭い加算のみ・A4/A6 実証） |
| M2 | orchestrator の変更系ツール（Bash/Edit/Write/Delete/StrReplace/Shell/TodoWrite/EditNotebook/call_mcp_tool/GenerateImage）拒否 | 保持（A1・UC5/UC11） |
| M3 | worker（agent_id あり）の R2 対象外・実作業許可 | 保持（A9・UC8） |
| M4 | R1 `.workflow` 直接編集禁止＋runtime/.gitignore 厳密例外 | 保持（UC3・UC9・diff 未改変） |
| M5 | exit code 規約（違反=2／許可=0）・判定ロジック | 保持（M2 と同経路・FR-6/7 は文言のみ・A8） |
| M6 | scribe 最優先・sqlite3 全ロール禁止・write-workflow-log.sh 単独実行 | 保持（A11・UC5/UC8） |
| M7 | 既存テストの英語部分文字列 assert_grep | 保持（A7・96 PASS） |
| M8 | REVIEW_DUAL_LENS 正本単一（二重定義しない） | 保持（review-docs は参照のみ・正本 §1〜§6 本体は不変・§5 に適用先 1 行追記のみ） |
| M9 | コア `.agent-skill-chain/source/` の fail-closed default を project 層が変更しない | 保持（未設定時 default 維持・M6/A6） |

**ラウンド継承**: 本レビューは fresh reviewer 構成（実装セッションと文脈分離）。上記 M1〜M9 を継承不変条件として全項目の退行有無を確認済み。指摘 0 のため追加ラウンド不要。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 備考 |
| --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み | frontmatter に issue_id・branch・github_issue(#35) 記録済み |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | ストーリー1〜10・UC1〜8 |
| [`02_設計.md`](./02_設計.md) | 更新済み | ADR-1〜8 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | T1〜T8・BDD↔タスク対応 |

### 5.2 ドキュメントの整合性

- **設計と実装の整合性**: 整合。ADR-1（allowlist 追加）・ADR-3（read-as-data 拡張）・ADR-7（prefix 分離）・ADR-8（日英併記・PreToolUse+PostToolUse 限定）は実装 diff と一致。
- **要件と実装の整合性**: 整合。01 の全ストーリー/UC が §6 カバレッジで実装・テストに対応。

---

## docs 更新（継続追随ゲート／DOCS_RULES §継続追随ゲート）

- **要否**: 不要（軽量パス・根拠付き更新不要判定 1 件）
- **対象**: なし
- **理由**: 本リポは `docs/` 採用済みでゲート発動対象。実装変更は enforcement の Layer2（PreToolUse allowlist・出力文言）およびドキュメント正本 `.agent-skill-chain/source/enforcement/README.md` に限定される。システム仕様書側 [`docs/04_機能設計/enforcement/README.md`](../../../04_機能設計/enforcement/README.md) は「本ドキュメントは俯瞰に留める」方針で、allowlist の具体的ツール列挙・block メッセージ文言・project 拡張の詳細を**保持しておらず、それらは source 正本へ委譲**している（evidence_source: existing_code, 当該 spec を実読）。今回の変更（AskUserQuestion 追加・opt-in 拡張・prefix 分離・日英併記）は spec の as-built 記述（「Layer2 PreToolUse がツール実行前に違反を block」「サブ委譲の絶対強制」「allowlist 機構」）のいずれも偽にしない。よって仕様書更新は不要と判定。反復不要（指摘 0 の軽量パス）。この判定の記録は本 §および `docs/00_review/20260714_080312_review.md` に残す。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 「仕様との整合性 > 変更容易性 > 保守性」（02 §根拠）に沿い、既存 R1〜R6 判定構造を壊さず最小差分（allow 列 +1・default に opt-in 分岐・出力文言）で要求を充足。REVIEW_DUAL_LENS の「正本 1 か所・直交追加」原則（§7）も遵守（review-docs は参照接続のみ）。
- **境界（コア/project）**: FR-4 は「コア default を変更しない opt-in 加算」として成立。project 層はコアの fail-closed を上書きせず拡張のみ（CLAUDE.md の project 最優先方針と非矛盾）。
- **ADR 整合**: ADR-1〜8 の決定が実装・文書に一対一で反映。特に ADR-2（メタデータ自動分類 feasibility 不可＝external_spec: Claude Code hooks docs の PreToolUse 入力に readOnlyHint 非含有を WebFetch 確認）に基づき FR-2 は実装せず、denylist 全面転換を不採用として成果物に「採用」記載がないことを確認。

### 9.2 境界・依存の確認（スコープ実効性・重点確認事項）

- **`git diff main --name-only` による実変更ファイル**（実装分は working tree・docs 分は commit `0ad08d8`。main は本ブランチ分岐後に別 issue の doc を追加しているため merge-base 基準で評価）:
  - 実装/文書 11 ファイル: PreToolUse.sh, PostToolUse.sh, orchestrator-allowlist.example.txt（新規）, test/test-pretooluse-hook.sh, SETUP.md, boot/CORE.md, README.md, project/README.md, enforcement/README.md, commands/review-docs.md, REVIEW_DUAL_LENS.md。
  - **03 で宣言された許可ファイル一覧と完全一致**。過不足なし。
- **`audit.sh`・`check-comment-refs.sh` は 1 件も変更なし**（実測 `git diff main --name-only | grep` → NOT CHANGED）。これは ADR-6 本文（機械強制の新規 audit チェック実装は本 issue で必須としない）および ADR-8（CI メッセージ日本語化は後続 issue へ分離）の設計決定と**一致**しており、スコープ逸脱ではない。両ツールの回帰スイート（test-audit 113 / test-check-comment-refs 13）も全 PASS。
- **循環・意図しない依存**: なし。hook は project ファイルをデータ read するのみで実行しない。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| fail-closed 非劣化・allowlist 維持 | test_output | test-pretooluse-hook 96 PASS（UC10 fail-closed 系含む） |
| スコープ境界（11 ファイル一致・audit.sh 未変更） | existing_code | `git diff main --name-only`／merge-base 差分を実測 |
| 挙動不変（FR-6/7） | test_output | exit code アサーション全 PASS＋文言のみ diff |
| FR-2 見送りの妥当性 | external_spec | Claude Code hooks docs（PreToolUse に readOnlyHint 非含有）を 02 ADR-2 が WebFetch 確認 |
| 仕様書更新不要 | existing_code | docs/04 enforcement spec が詳細を source 正本へ委譲（実読） |
| denylist 非採用 | existing_code | 00/01/02・実装 diff に「採用」記載なし（grep 確認） |

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（最小差分・fail-closed 非劣化・残余リスクの正直化）。
- **テスト品質**: 良好（UC1〜11 網羅・jq 有無両系統・tmp 隔離・96 PASS／全スイート FAIL=0）。
- **ドキュメント品質**: 良好（ADR で設計判断と根拠 evidence_source を明示・スコープ線引き記録）。
- **総合評価**: **合格（指摘 0 件）**。close 可。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 実行サブエージェント
- **承認日**: 2026-07-14
- **承認コメント**: 敵対的観点（§4.3・A1〜A12）で fail-closed 破り・スコープ逸脱・退行を反証したが検出されず。must-preserve（§4.4・M1〜M9）全項目の保持を確認。重点確認事項（スコープ境界・fail-closed 非劣化・テスト全 PASS・BDD 対応・denylist 非転換・日英併記非破壊）を全て充足。

---

## 6. 受け入れ基準・BDD カバレッジの確認（map-coverage）

| 01 の BDD | 対応タスク | 実装 | テスト | 結果 |
| --- | --- | --- | --- | --- |
| ストーリー1／UC1-S1 | T1 | R2 allow に AskUserQuestion | UC1「orchestrator AskUserQuestion は exit 0」 | OK |
| ストーリー2／UC1-S2,S3 | T1 | 変更系・未知 default block 不変 | UC1/UC5/UC11 | OK |
| ストーリー3／UC3 | 実装なし | ADR-2 feasibility 不可 | 該当なし（設計判断） | OK |
| ストーリー4／UC4 | T4 | SETUP.md 復旧節＋CORE/README/project 参照 | 文書確認（`!`enforce off・機構説明あり） | OK |
| ストーリー5／UC5-S1,S2 | T2 | is_in_project_allowlist opt-in | UC10 未設定 fail-closed／opt-in 許可 | OK |
| ストーリー6／UC5-S3 | T2,T5 | orchestrator 書込禁止（機構）＋PR（プロセス）ADR-4 | 文書確認・UC10（Edit/Bash 覆せない） | OK |
| ストーリー7 | 横断 | denylist 非採用 | grep 確認（採用記載なし） | OK |
| ストーリー8／UC6-S1,S2,S3 | T6 | review-docs 二観点接続＋DoD | 文書確認（Process/Outputs/Done/Constraints に両リスト義務） | OK |
| ストーリー9／UC7-S1,S2 | T7 | [PreToolUse:info]／[enforcement:block] 分離 | UC11（info バナー・block prefix・exit code 不変） | OK |
| ストーリー10／UC8-S1,S2 | T8 | 日英併記（英語先頭保持） | UC11（英語部分文字列保持・日本語併記・exit 2 不変） | OK |
| UC2-S1（worker 非影響） | T3 | R2 は main 限定 | UC8（subagent worker Edit/Write exit 0） | OK |

**未達**: なし。全ストーリー/UC が実装またはテスト（もしくは設計判断）に対応。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- [`.agent-skill-chain/source/REVIEW_DUAL_LENS.md`](../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md) — 二観点必須化の正本
- [`.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`](../../../../.agent-skill-chain/source/enforcement/claude/PreToolUse.sh) — 主対象実装

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

## 15. 次のステップ

- コード実装のみで完了する変更のため、05_最終確認チェックリストはスキップ。close へ遷移可（指摘 0）。
