---
document_id: "685fcaa0-6263-4398-90d0-970291569a70"
issue_id: "cee953ef-5316-4151-86fe-a1d21fe95527"
---

# レビュー書: orchestrator 許可ツール allowlist に Skill を追加する

**プロジェクト名**: orchestrator 許可ツール allowlist に Skill が無く委譲経路と矛盾（自己ロックアウトリスク）
**作成日**: 2026年07月14日
**最終更新**: 2026年07月14日

> **重要**: 本レビューは verify-and-close command（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log 相当）に従い、issue 難易度（小・1 行の allowlist 追加）に見合った quick レビューとして実施した。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証（`PreToolUse.sh` R2 allowlist への `Skill` 追加が 02_設計・03_実装計画の内容に一致し、01 の受け入れ基準・00 の成功基準を満たすかの検証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: 03_実装計画のタスク1（`.agent-skill-chain/source/enforcement/claude/PreToolUse.sh` R2 allowlist への `Skill` 追加）、タスク2（`test/test-pretooluse-hook.sh` への回帰テスト追加）、タスク3（00 frontmatter の branch 記録）。
- **レビュー期間**: 2026-07-14 ～ 2026-07-14
- **レビュー担当者**: verify-and-close 委譲サブエージェント（実装・レビュー兼務）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| ------------ | ----------------- | -------- | ---------- | -------------------------------------- |
| タスク1 | R2 allowlist の `case` 文へ `Skill` を追加し理由コメントを付記 | 2026-07-14 | 実装担当サブ | 完了 |
| タスク2 | `uc1_orchestrator_skill_allowed` テストケースを追加 | 2026-07-14 | 実装担当サブ | 完了 |
| タスク3 | 00 frontmatter の `branch` を実ブランチ名に更新 | 2026-07-14 | 実装担当サブ | 完了 |

### 2.2 実装内容の詳細

#### タスク1: PreToolUse.sh R2 allowlist への Skill 追加

- **実装内容**: `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh` の R2 allowlist（`Read|Grep|Glob|LS|list_dir|Task|Agent|mcp_task|ReadLints|fetch_mcp_resource|list_mcp_resources|AskUserQuestion)`）に `Skill` を追加し、`Skill` が本フレームワークの command 実行の正規入口であり、allowlist 欠如で自己ロックアウトが起きうる旨をコメントで追記。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`
- **実装方法**: 既存の `case` パターンへの 1 語追加＋既存コメント（Agent 追加時の注記）に倣った追記のみ。新規分岐・新規関数は作らない（02_設計どおり）。
- **確認事項**: 02_設計 §2.2 の diff（`Skill` を `Agent` と `mcp_task` の間に挿入）に一致。既存の `Bash` 明示拒否・`Edit|Write|...` 明示拒否・`*)` fail-closed 分岐は無変更。

#### タスク2: 回帰テスト追加

- **実装内容**: `test/test-pretooluse-hook.sh` の UC1 に `uc1_orchestrator_skill_allowed`（`AGENT_ROLE=orchestrator`・`tool_name=Skill` の stdin JSON で exit 0 になることを検証）を追加。
- **変更ファイル**: `test/test-pretooluse-hook.sh`
- **実装方法**: 既存の `uc1_orchestrator_askuserquestion_allowed` と同一パターンで新規関数を追加し、実行リストにも追加。

#### タスク3: 00 frontmatter の branch 記録

- **実装内容**: `00_要求定義.md` frontmatter の `branch` を `worktree-agent-a8b6509e077823ec2`（文書作成セッションの名残）から実際の作業ブランチ `worktree-agent-a116555e3fde39e34` へ更新。
- **変更ファイル**: `00_要求定義.md`

---

## 3. テスト結果の確認

### 3.1 単体テスト

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-14
- **テストファイル数**: 1（`test/test-pretooluse-hook.sh`。新規ケース1件を含む）
- **テストケース数**: 99（全体。新規追加分含む）
- **成功**: 99
- **失敗**: 0
- **スキップ**: 0

#### 実行コマンドと実際の出力（抜粋）

```
$ bash test/test-pretooluse-hook.sh
...
  [PASS] UC1: orchestrator Skill は exit 0
...
==================== 結果 ====================
PASS=99 FAIL=0
全テスト PASS
```

#### 回帰確認（他テストへの影響）

`PreToolUse.sh` に依存しないテスト（`test-audit.sh` PASS=113、`test-c4-bypass-resistance.sh` PASS=13、`test-write-workflow-log-*` 各 PASS 等）を含む `test/*.sh` 全 22 ファイルを実行し、リポジトリ環境要因（`npm run build` 未実施による `bin/agents-md.js` 不在、`kcov` 未導入）による既存 SKIP/エラー以外に新規の失敗は無いことを確認した（本変更前から存在する環境依存の既知事象であり、本 issue の変更とは無関係）。

### 3.2 統合テスト

該当なし（enforcement hook 単体の allowlist 追加であり、他コンポーネントとの統合を伴わない）。

### 3.3 E2E テスト

`test/test-pretooluse-hook.sh` は `git archive HEAD | tar -x` による隔離クリーン環境上に作業ツリーの `PreToolUse.sh` をオーバーレイして実行する構成であり、実際の hook 実行経路（stdin JSON 契約・jq 有無両系統）を検証している。これにより実経路相当の検証を実施済みと判断する。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| -------------- | ---------------------- | ------------------------------ | -------------------------------- |
| 可読性 | 追加コメントが既存の Agent 追加時コメントと文体・粒度が揃っているか | OK | 同一パラグラフ内に追記し、既存注記（「同種ツール追加時は本 allowlist の追従を検討すること」）との重複を避けた |
| 保守性 | allowlist 定義が単一箇所（PreToolUse.sh R2）に留まり二重管理が無いか | OK | 変更は該当 `case` 文 1 箇所のみ |
| セキュリティ | 01 §2.2・00 §3.2 のリスク（Skill 無条件許可）が検討され過剰設計なしで妥当な結論に至っているか | OK | ツール名レベル判定という hook の構造的制約を踏まえ、Task/Agent と同水準の許可に留めた（02_設計 §3 参照） |
| 回帰なし | 既存 allowlist 対象・Bash 拒否・Edit/Write 拒否・fail-closed 分岐に影響が無いか | OK | 既存 98 ケース全 PASS を維持し新規 1 ケースを追加 |

### 4.2 指摘事項

- 指摘なし（要修正 0 件）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------------------------------ | ----------------- | -------- | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（branch frontmatter） | レビュワー | 2026-07-14 |
| [`01_要件定義.md`](./01_要件定義.md) | 新規作成 | レビュワー | 2026-07-14 |
| [`02_設計.md`](./02_設計.md) | 新規作成 | レビュワー | 2026-07-14 |
| [`03_実装計画.md`](./03_実装計画.md) | 新規作成 | レビュワー | 2026-07-14 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02_設計 §2.2 の diff どおりに実装）。
- **要件と実装の整合性**: 整合している（01 §2.1 の受け入れ基準を §3.1 のテスト結果で充足）。
- **コメント**: なし。

---

## 6. パフォーマンス確認

該当なし（shell の `case` 文への 1 語追加であり、性能特性への影響は無い）。

---

## 7. セキュリティ確認

### 7.1 セキュリティチェック

| 項目 | 確認内容 | 結果 | コメント |
| ---------- | ---------- | ----------- | ---------- |
| 許可範囲の妥当性 | `Skill` 追加が既存の fail-closed 設計（未知ツール拒否・Bash/Edit/Write 明示拒否）を弱めていないか | OK | `*)` 分岐・明示拒否分岐は無変更。追加は許可リストへの 1 ツール追加のみ |
| 過剰設計の回避 | skill 種別の絞り込み機構を新設せず、00 §5 の除外要件どおりに留めたか | OK | 02_設計 §3 のとおり Task/Agent と同水準に留めた |

---

## 8. 受け入れ基準・成功基準のカバレッジ確認（map-coverage）

| 基準 | 出典 | 検証方法 | 結果 |
| ---- | ---- | -------- | ---- |
| orchestrator の Skill 呼び出しが exit 0 になる | 01 §2.1 受け入れ基準1／00 §6 成功基準 | `uc1_orchestrator_skill_allowed`（新規テスト） | 充足（PASS） |
| 既存 allowlist 対象ツールの許可は維持 | 01 §2.1 受け入れ基準2 | 既存 UC1〜UC11 全ケース再実行 | 充足（全 PASS） |
| Bash/Edit/Write 等の明示拒否は維持 | 01 §2.1 受け入れ基準2 | 既存 `uc1_orchestrator_write_blocked`・`uc5_orchestrator_bash_blocked` 等 | 充足（全 PASS） |

未達項目: なし。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務・明確な境界（02_設計 §1.2）を維持し、allowlist 定義を PreToolUse.sh R2 の 1 箇所に集約したまま追加した。
- **命名規則**: 既存の `case` パターン記法に合わせた（新規命名なし）。

### 9.2 境界・依存の確認

- **責務の境界**: R1（runtime/ 直接編集禁止）・R3〜R6（Bash 判定）・subagent worker 判定（IS_SUBAGENT=1）には影響しない（02_設計 §2.3 のとおり）。
- **依存関係**: 新規依存なし。
- **指摘・推奨**: なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------------------- | ------------------------------------- | ------------------------ |
| Skill を Task/Agent と同水準で許可する（絞り込み機構を新設しない） | existing_code | `PreToolUse.sh` の既存 `case` 文がツール名レベルでしか判定できない構造であることをコードで確認済み |
| allowlist 欠如が自己ロックアウトを招くリスクの実在性 | observed_runtime | 00 §1.2 が参照する過去の Agent ツール未対応ロックアウト事故（メモリ `feedback_enforce-on-lockout-incident`）と同型の構造的リスク |
| テスト全件 PASS | test_output | `bash test/test-pretooluse-hook.sh` 実行結果（PASS=99 FAIL=0） |

---

## docs 更新（DOCS_RULES §継続追随ゲート）

- 要否: 不要
- 対象: なし
- 理由: `docs/04_機能設計/enforcement/README.md` はサブ委譲の絶対強制という抽象概念のみを記載し、R2 allowlist の個別ツール名は列挙していない（grep で該当箇所なしを確認）。本変更は allowlist へ 1 ツール名を追加するのみで、システム仕様書が記述する抽象レベルの内容には影響しない。

---

## 10. 課題と改善点

### 10.1 発見された課題

- なし。

### 10.2 改善提案

- 00 §3.4「保守性」で言及された「新規ツール追加時の allowlist 追従漏れ防止のチェックリスト化」は、本 issue のスコープ外（00 §5 除外要件）として別途検討候補とする。

---

## 11. システム仕様書の更新

該当なし（§docs 更新 のとおり不要と判定済み）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（既存構造への最小差分で01の受け入れ基準を充足）。
- **テスト品質**: 良好（新規回帰テスト1件追加、既存99ケース含め全PASS）。
- **ドキュメント品質**: 良好（00〜04が一貫）。
- **総合評価**: 完了（要修正なし）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 委譲サブエージェント
- **承認日**: 2026-07-14
- **承認コメント**: 受け入れ基準・成功基準を全て充足し、回帰なし。要修正事項なし。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`
- `test/test-pretooluse-hook.sh`

---

## 14. 前のステップ

このレビュー書は、以下のドキュメントを基に作成されています：

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 外部設定は不要のため、issue 完了。PR 作成に進む。
