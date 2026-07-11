---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "ad96201a-9028-4ef2-b955-97f44c26a34c"
---

# レビュー書: agentsOS 汎用化・ポリシー統合（system-graph 由来の発展ポリシー取り込み）

**プロジェクト名**: agentsOS 汎用化・ポリシー統合
**作成日**: 2026 年 07 月 11 日
**最終更新**: 2026 年 07 月 11 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agents/CONCEPTS.md §用語規約](../../../../.agents/CONCEPTS.md#用語規約) を参照。
>
> **重要な範囲限定（必読）**: 本レビューは **01_要件定義.md のストーリー1〜7（タスク1〜7）の実装完了分のみ**を対象とする。**ストーリー8（`.agents/` → `.agent-skill-chain/` へのディレクトリ名前空間衝突安全化）は別途実装・別途レビュー予定であり、本レビューの範囲外**である。03_実装計画.md ではタスク8はタスク1〜7完了後に実施する設計であり、本 issue はまだタスク8に着手していない。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

01_要件定義.md ストーリー1〜7に対応する実装成果物（`.agents/` 配下 9 ファイルの新設・追記）が、01 の受け入れ基準・02 の設計判断・03 の実装内容指示と一致しているかを確認する（実装内容の確認・品質保証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: 03_実装計画.md タスク1〜7（ストーリー1〜7）。`.agents/EFFORT_POLICY.md`（新設）・`.agents/PLATFORM_SAFETY_RESPONSE.md`（新設）・`.agents/AGENT_CONDUCT.md`（新設）・`.agents/CLOSEOUT.md`（追記）・`.agents/CONTEXT_EFFICIENCY.md`（追記）・`.agents/HEARTBEAT.md`（追記）・`.agents/enforcement/README.md`（追記・系統A/C/D/E/#30の3タスク分）・`.agents/enforcement/DESIGN.md`（追記）・`.agents/skills/agent/run_command.md`（追記・タスク1/7の2箇所）。
- **レビュー期間**: 2026-07-11（1回目監査で workflow.db 証跡不備2件を検出→是正→本レビューで再検証し収束）。
- **レビュー担当者**: verify-and-close 監査サブエージェント。

---

## 2. 実装内容の確認

**用語**: [.agents/CONCEPTS.md §用語規約](../../../../.agents/CONCEPTS.md#用語規約) を参照。

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| タスク1（ストーリー1） | `.agents/EFFORT_POLICY.md` 新設。reasoning effort の役割別静的割当の抽象原則。`run_command.md` に委譲時 effort 明記義務を追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク2（ストーリー2） | `enforcement/README.md`・`enforcement/DESIGN.md` に系統A（モデルティア切り下げ検知）・系統C（Read/Grep過大読込抑制）・系統D（hooks overlay配備）の抽象仕様を追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク3（ストーリー3） | `CONTEXT_EFFICIENCY.md` に issue-persist境界・fresh サブ構造化ハンドオフ・仕様inventory索引化・適用スケーリングを追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク4（ストーリー4） | `CLOSEOUT.md` に停止耐性チェックポイント・malformed自己検証・課題の責任完遂を追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク5（ストーリー5） | `.agents/PLATFORM_SAFETY_RESPONSE.md` 新設。`HEARTBEAT.md` に参照項目1件追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク6（ストーリー6） | `enforcement/README.md` に系統E（SubagentStop相当リアルタイム強制の抽象仕様）を追記 | 2026-07-10 | implement-feature サブ | 完了 |
| タスク7（ストーリー7） | `.agents/AGENT_CONDUCT.md` 新設。`run_command.md` に凝縮版転記運用を追記。`enforcement/README.md` 失敗条件#30を追記 | 2026-07-10 | implement-feature サブ | 完了 |

### 2.2 実装内容の詳細（要点）

- **EFFORT_POLICY.md**: 01ストーリー1受け入れ基準の4点（適用条件／ティア明記義務との別次元性／品質ゲート非劣化原則／対象外環境のフォールバック）をすべて充足。role×effort具体対応表・モデル名・閾値は記載なし（コアへの具体値混入禁止を遵守）。`MODEL_SELECTION.md`・`REVIEW_DUAL_LENS.md §5` への参照リンクは解決を確認。
- **PLATFORM_SAFETY_RESPONSE.md**: 4原則（回避絶対禁止・即座停止と透明な説明・ユーザー本人の明示的承認・サブエージェント自己報告の独立検証）をすべて充足。enforcement との別レイヤー明記あり。`HEARTBEAT.md` は参照項目1件のみ追加し詳細規範を複製していないことを確認。
- **AGENT_CONDUCT.md**: §0読み替え規則＋8原則本文＋機構的強制の非対象＋第3部凝縮版の構成。§3進捗の実証（未検証明言・捏造進捗禁止・テスト失敗出力ごと報告・スキップ手順明言・完了はヘッジせず言い切る）が01の文言とほぼ一致する形で明記。02§2.5.3の構造的代替3点（REVIEW_DUAL_LENS両リスト／CLOSEOUT malformed自己検証／document_id紐付け）と`enforcement/README.md`#30の記載が完全に整合していることを確認。
- **CLOSEOUT.md**: 3節（停止耐性チェックポイント／malformed自己検証／課題の責任完遂）が既存節（fresh サブ分割・no-drop/dedup）と重複せず補完する形で追記されていることを確認。実値（再開プロンプト書式・繰延理由カテゴリ表）は`.agents-project/`へ委譲する旨を明記。
- **CONTEXT_EFFICIENCY.md**: issue-persist境界4条件（00〜03充足／レビュー指摘収束／書記記録／親登録）・fresh サブ構造化ハンドオフ4要素（対象／親要点抜粋／担当スライス／既出確認結果）・適用スケーリング（単一少数 vs 大規模一括）を確認。具体パス名（`.agents-project/自己拡張ワークフロー.md`等）を埋め込んでいないことを確認（01受け入れ基準）。
- **enforcement/README.md・DESIGN.md**: 系統A・C・D・Eの4系統すべてで「対象・fail-open方針（系統Dは決定的規則につきfail-openの余地なしと明記）・false positive回避方針」の3点が記載され、既存`PreToolUse.sh`のstdin JSON契約・exit code規約と矛盾しない旨が明記されていることを確認。「失敗条件→実装の所在→強制レベル対応表」・「失敗とみなす条件一覧」の両方に系統A/C/E行および#30行が正しいフォーマット（既存列構成を維持）で追加されている。
- **run_command.md**: タスク1（委譲時のeffort明記）・タスク7（凝縮版転記）の2箇所の追記が、既存の「委譲時のティア明記」箇条を破壊せず独立した箇条として追加されていることを確認（同一ファイルへの複数タスク追記の非破壊性を重点確認）。

---

## 3. テスト結果の確認

### 3.1 単体テスト

本タスク1〜7はドキュメント（抽象原則）拡張であり、自動化されたコードテストの対象を持たない（02_設計§6.1「E2Eは該当なし」の通り）。単体テストの方針は「レビュー（監査）によるチェックリスト確認」であり、03_実装計画各タスク§2.x.3のテスト観点・§2.x.4のBDDレビューチェック例に基づき本レビューで確認済み（上記§2.2に反映）。

- **実行日**: 2026-07-11
- **確認方法**: 各ファイルの必須節の存在確認、相互参照リンクの解決確認（機械検証＋手動確認）、02/03の指示内容との突合。
- **失敗**: 0（該当なし。テストコードを持たないドキュメントレビューのため「失敗」概念が適用されない）

### 3.2 統合テスト

該当なし（hook実体・ランタイム機構を持たないドキュメント拡張のため。02_設計§6.1と同一理由）。

### 3.3 E2E テスト

該当なし（同上）。

---

## 4. コードレビュー

### 4.1 コード品質

該当なし（本タスクはコード変更を伴わないドキュメント拡張。タスク8のみコード変更を伴うが本レビュー範囲外）。

### 4.2 指摘事項

**指摘なし（収束）**。

- **1回目監査で検出した workflow.db 証跡の不備2件は是正済みであることを独立検証した**（詳細は下記「敵対的観点リスト」参照）。
  1. タスク7の3件（`entry_id: 31248516-99c8-4fb8-89be-3fe20126cb1b` / `e229c6cb-e3cb-4163-bbb9-cf93f111ce2e` / `1432f355-288d-436d-8933-ab0a098e91e3`）の `ts_utc` が非ISO8601形式（`20260711_052131`等）だった件 → 是正行3件（`ba85b58e-74aa-4806-87b1-4b0a4dc6a5c8` / `425266e5-ddf8-4d1a-980e-c0675ad2674c` / `88cb2444-6cdb-4dbc-91d5-5de83ce4dec9`）が正規経路（`write-workflow-log.sh`）でINSERTされ、いずれもISO8601 UTC形式であることを確認。
  2. タスク2（`entry_id: 9c2f1ac9-d0cf-4b1d-8fc0-2f39003b139d`）の `changed_files_json` が不正なJSON（構文エラー）だった件 → 是正行1件（`entry_id: c7e6e69b-db55-4dbe-ad97-80c689ef9a04`）がINSERTされ、`[".agents/enforcement/README.md",".agents/enforcement/DESIGN.md"]` という有効なJSON配列であることを確認。
  3. 元の4件の誤った行は **UPDATE/DELETEされておらずそのまま残存**しており、是正行が追記される形（append-only）になっていることを確認（`workflow_log` は改ざん検知ハッシュチェーン方式のため、そもそも UPDATE/DELETE を想定しない設計）。

---

## 敵対的観点リスト（REVIEW_DUAL_LENS.md §2.1・§3 証跡要求）

反証・破壊を試みる観点で、判断が不確実な場合は要修正に倒して検証した。

1. **是正行が本当に正規経路（write-workflow-log.sh）でINSERTされたか、直接sqlite3 INSERTで偽装されていないか**: 4件の是正行はいずれも `actor_role=scribe`・`delegated_by_role=orchestrator`・`prev_hash`/`entry_hash` のハッシュチェーンが直前エントリと連結しており（例: `ba85b58e...` の `prev_hash` は直前エントリ `e29b5038...` の `entry_hash` と一致）、`PRAGMA integrity_check` は `ok`、ハッシュチェーンに dangling（親ハッシュ不整合）は 0 件。手書きINSERTでは通常この整合したハッシュチェーンを偽装しにくく、ラッパー経由と判断できる。**結論: 問題なし**。
2. **是正行のdocument_idが元エントリと一致しているか（documentの同一性が壊れていないか）**: `ba85b58e`→`963b48d6-8e79-4a6c-9a0c-fab2f4ef5c13`（元31248516と一致）、`425266e5`→`70e63c03-f2d3-41ef-af84-1568939ab775`（元e229c6cbと一致）、`88cb2444`→`befd034c-5289-46b8-94f5-37b006551861`（元1432f355と一致）、`c7e6e69b`→`70e63c03-...`（元9c2f1ac9と一致）。document_id不変原則（audit #20+）に抵触しない。**結論: 問題なし**。
3. **元の誤った4行が削除・改変されていないか（audit証跡の完全性）**: SELECTで再確認し、元の`ts_utc`（`20260711_052131`等の非ISO8601）・元の壊れた`changed_files_json`がそのまま残存していることを確認。UPDATE/DELETEの痕跡なし。**結論: 問題なし（append-only原則を遵守）**。
4. **是正のtsが実行時刻ベースか、捏造・遡及していないか**: 是正4行の`ts_utc`（`2026-07-10T20:46:13Z`〜`20Z`〜`31Z`〜`40Z`）は連続したハッシュチェーン順序と整合し、実行時取得と判断できる。summaryには「原実施時刻相当」を別途注記する形で、実際のts_utcフィールドと混同していない。**結論: 問題なし**。
5. **今回の是正が新たな規約違反（例: 二重記録・documentへの余計な副作用）を生んでいないか**: 是正行はいずれも`.agents/`ドキュメント本体を変更するものではなく、証跡ログのみの追記。`.agents/`側の内容は1回目監査時点から無変更であることをgit statusで確認済み（本レビュー§2で確認した9ファイルの内容と1回目監査時点の内容は同一）。**結論: 問題なし**。
6. **全体監査（audit.sh フル実行）で他の未検出の問題が無いか**: `audit.sh` をフル実行した結果、(a) 「04_review未更新」FAIL＝本レビュー作成前の一時的な状態であり、本ファイル作成・書記実行により解消される想定内の指摘。(b) 「コメント外部参照禁止違反」（`src/agents-md.ts` 5箇所）FAIL＝**タスク1〜7の変更対象外**。`git status --short src/agents-md.ts` は無変更（既存コミット `9320214` 由来の事前存在違反）であり、タスク8（本レビュー範囲外・未着手）の対象ファイルである。タスク1〜7のいずれもこのファイルを変更していないため、本レビューの指摘としては計上しない（ただし別途、タスク8着手時またはこの issue とは別の是正 issue で対応すべき既知の未解決事項として記録する）。**結論: タスク1〜7範囲では問題なし。範囲外の既知事項1件を「10. 課題と改善点」に記録する**。

---

## must-preserve リスト（不変条件。REVIEW_DUAL_LENS.md §2.2・§3 証跡要求）

変更が保持すべき不変条件を同定し、保持を確認した。

1. **正本一元化・二重持ち禁止**: 新設3ファイル（EFFORT_POLICY/PLATFORM_SAFETY_RESPONSE/AGENT_CONDUCT）はいずれも既存ファイル（MODEL_SELECTION.md・HEARTBEAT.md・REVIEW_DUAL_LENS.md・CLOSEOUT.md・enforcement/README.md）と重複記載せず相互参照でつないでいる。**保持を確認**。
2. **汎用/固有境界（コア=抽象原則のみ、`.agents-project/`=具体値）**: 9ファイルすべてに「汎用/固有境界」節または同等の実値委譲記述があり、role×effort対応表・具体閾値・具体スクリプト実体等の具体値がコアに混入していない。**保持を確認**。
3. **`document_id`不変原則（audit #20+）**: 是正4行を含め、既存文書のdocument_idはいずれも作成時の値から変更されていない（EFFORT_POLICY=165b969b.../PLATFORM_SAFETY_RESPONSE=401f9362.../AGENT_CONDUCT=963b48d6.../run_command.md対応=befd034c.../enforcement/README.md対応=70e63c03...）。**保持を確認**。
4. **既存`PreToolUse.sh`のstdin JSON契約・exit code規約（違反=2/許可=0）**: 系統A・C・D・Eの追記はいずれも既存契約と矛盾しない旨を明記し、実コード変更を伴わない（抽象仕様のみ）。**保持を確認**。
5. **CORE.md「メインは実作業を行わない」絶対制約**: AGENT_CONDUCT.md §0読み替え規則が「即行動」「ターン終了規律」を「委譲パケットの即時発行」に読み替え、CORE.mdの絶対制約を解除しない旨を明記。**保持を確認**。
6. **workflow_log の append-only・ハッシュチェーン完全性**: 今回の是正含め、workflow_log への書き込みはすべて INSERT のみで行われ、`PRAGMA integrity_check = ok`、ハッシュチェーンに dangling 無し。**保持を確認**。
7. **既存の「強制の4層と現状」表・「失敗条件→実装の所在→強制レベル対応表」・「失敗とみなす条件一覧」の列構成**: 系統A/C/D/E・#30の追加行はいずれも既存の列構成（# / 対象 | 実装の所在 | 強制レベル、または # | 失敗条件 | 説明 | 差し戻し先）を変更せず行追加のみで拡張している。**保持を確認**。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（本issue開始時） | 監査サブ | 2026-07-11 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | 監査サブ | 2026-07-11 |
| [`02_設計.md`](./02_設計.md) | 更新済み | 監査サブ | 2026-07-11 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | 監査サブ | 2026-07-11 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（02§2.1.1責務一覧・§2.5・§2.6の結論・§5 API契約と、実装9ファイルの記載内容が1対1で対応することを確認）。
- **要件と実装の整合性**: 整合している（01ストーリー1〜7の受け入れ基準・BDDシナリオと、03タスク1〜7のテスト観点・実装内容指示、および実装ファイルの記載内容が対応することを確認）。
- **コメント**: ストーリー8は01/02/03で計画済みだが未着手であり、本レビュー範囲外として明示的に除外した。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本issue（タスク1〜7）は `.agents/` 配下の実行契約・ワークフロー仕様の拡張であり、`docs/`（システム仕様書）が対象とするプロダクト機能・画面・データ設計への変更を伴わないため。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: 02_設計§1.2の設計原則（単一責務・明確な境界・UNIX哲学・AIフレンドリー設計）に沿っている。新設3ファイルはいずれも単一の関心事のみを担当。
- **ディレクトリ構成**: `.agents/`直下への新設（EFFORT_POLICY/PLATFORM_SAFETY_RESPONSE/AGENT_CONDUCT）は既存の`MODEL_SELECTION.md`・`CLOSEOUT.md`と同型の配置であり、spec/02ディレクトリ構造方針に沿う。
- **命名規則**: `EFFORT_POLICY.md`（MODEL_SELECTION.mdと対の命名）・`PLATFORM_SAFETY_RESPONSE.md`（内容が名前から分かる）・`AGENT_CONDUCT.md`（固有名詞Fable等を排除した汎用命名）はいずれも02§2.3の命名意図と一致。

### 9.2 境界・依存の確認

- **責務の境界**: 02§2.1.1の責務一覧（14行/13ファイル）と実装が1対1で対応。`enforcement/README.md`が系統A/C/D（タスク2）・系統E（タスク6）・#30（タスク7）の3タスクから追記を受けるが、いずれも独立した節・行として追加されており責務混同はない。
- **依存関係**: 02§2.1.3の参照関係（EFFORT_POLICY→MODEL_SELECTION/REVIEW_DUAL_LENS、run_command→EFFORT_POLICY/AGENT_CONDUCT、AGENT_CONDUCT→CORE、等）はすべて実装に反映され、循環参照は無い。
- **指摘・推奨**: なし（タスク1〜7範囲）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元・URL 等） |
| --- | --- | --- |
| workflow.db是正行が正規経路経由であること | observed_runtime | `.workflow/workflow.db` を直接SELECTし、ハッシュチェーン連結（prev_hash/entry_hash）・PRAGMA integrity_check・actor_role/delegated_by_roleを実測確認 |
| 実装9ファイルの受け入れ基準充足 | existing_code | 01_要件定義.md・03_実装計画.md の記載と実装ファイルの本文を1件ずつ突合（本レビュー§2） |
| src/agents-md.ts の #26 違反がタスク1〜7範囲外であること | observed_runtime | `git status --short src/agents-md.ts`（無変更）・`git log`（commit 9320214由来）を実測確認 |
| SubagentStop・系統Eの技術的実現可能性 | external_spec | 01_要件定義.md記載の一次情報（`https://code.claude.com/docs/en/hooks.md`）を実装記載が正しく引用していることを確認（新規調査は行わず01の引用を検証） |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題1（本issue範囲外・既知事項として記録）**: `src/agents-md.ts`（5箇所: 547, 574, 576, 611, 624行目）に `CODE_COMMENT_RULES.md` §2 が禁止する外部参照コメントが既に存在し、`audit.sh` #26 でFAILする。これは本issue（タスク1〜7）が変更したファイルではなく、コミット `9320214`（CLI TypeScript化）由来の既存事項である。ストーリー8（本issue内で未着手・別レビュー予定）が `src/agents-md.ts` を変更対象に含むため、**ストーリー8着手時に併せて是正するか、それより早期に対応が必要か判断を要する**。
  - **影響範囲**: リポジトリ全体の `audit.sh` フル実行がこの1件のみでFAILする状態が継続する（push/CI gateに影響しうる）。タスク1〜7自体の正しさには影響しない。
  - **対応方法**: 責任スレッドが拾う順送り（CLOSEOUT.md §課題の責任完遂に従い判定を確定する）。本issueのストーリー8着手時に是正するのが自然だが、CI gateへの影響が先行して問題になる場合は、本issueとは独立の小さな是正issueとして先出しすることも選択肢。**この判断はorchestrator（進行役）が行うべき事項として明記し、起票のみで放置しない**。

### 10.2 改善提案

- 特になし（タスク1〜7の実装内容自体に改善提案なし）。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

該当なし（`.agents/`実行契約の拡張であり、`docs/`が対象とするプロダクト機能への変更を伴わない）。

### 11.2 システム仕様書の更新状況

該当なし。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（01/02/03の指示内容と1対1で対応し、逸脱・矛盾なし）
- **テスト品質**: 良好（ドキュメント拡張の性質上コードテストは対象外だが、レビューチェックリスト・BDD対応はすべて充足）
- **ドキュメント品質**: 良好（相互参照リンクすべて解決、既存構造の非破壊を確認）
- **総合評価**: **タスク1〜7は指摘0件で収束**。ただしタスク1〜7の範囲外の既知事項1件（課題1・src/agents-md.ts #26違反）を「10. 課題と改善点」に記録し、責任完遂の判定（順送り）まで確定済み。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 監査サブエージェント
- **承認日**: 2026-07-11
- **承認コメント**: 1回目監査で検出したworkflow.db証跡不備2件（ts_utc非ISO8601・changed_files_json不正JSON）は、正規経路（write-workflow-log.sh）による是正行4件のINSERTで解消されたことを独立検証済み（append-only・document_id不変・ハッシュチェーン完全性を確認）。タスク1〜7の実装内容・設計整合性ともに指摘なし。ストーリー8は別途実装・別途レビュー予定であり本レビュー範囲外。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- `.agents/REVIEW_DUAL_LENS.md`（二観点必須化の正本）
- `.agents/CONCEPTS.md §外部根拠の必須化`（evidence_source分類の正本）
- `.agents/enforcement/README.md`（強制・失敗条件の正本）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- タスク1〜7は本レビューで収束（指摘0件）。次はストーリー8（名前空間衝突安全化）の実装・別途レビューへ進む（本issue内の別フェーズとして、または別issueとして進行役が判断する）。
- 課題1（src/agents-md.ts #26違反）の是正タイミングは進行役が確定する（本レビューでは「責任スレッドが拾う順送り」に判定済み）。**（更新: 下記タスク8レビューにて、audit.sh #26 がフル実行で PASS することを実測確認。当該 #26 違反はタスク8の CODE_COMMENT_RULES 是正〈8-B〉で解消済み。課題1はクローズ相当。）**

---

# タスク8（ストーリー8: ディレクトリ名前空間衝突安全化・統合ネスト）レビュー

**レビュー日**: 2026-07-11
**レビュー担当**: verify-and-close 監査サブエージェント（opus / reasoning effort=max。story8 以降の監査・レビューは opus 固定・fable 委譲禁止のユーザー明示指示に従う）
**レビュー対象**: ストーリー8（タスク8）実装。サブタスク 8-A（統合ネスト git mv・マーカー/衝突検知/バックアップ/README 警告）・8-B（フィンガープリント統合移行・runUninstall 安全拡張・CODE_COMMENT_RULES 是正）・8-C（122 件超の参照更新・自己適用 bootstrap 是正・source ノイズ除去）・8-D（e2e 新規 BDD 7 項目・npm test 全体の新レイアウト追従）の 4 段階委譲の統合。
**深度**: full（新規・大規模かつデータ破壊のおそれがある領域。REVIEW_RULE §実行モード）。

> **範囲**: 本節はストーリー8 のみを対象とする。タスク1〜7 は既に上記で収束済み（指摘0件）であり再レビューしない。

## T8-1. 実装内容の確認（§2.8.2 の 9 サブタスクとの対応）

| 実装項目 | 実装の所在 | 確認結果 |
| --- | --- | --- |
| ①統合ネスト（git mv） | `.agents/`→`.agent-skill-chain/source/`・`.agents-project/`→`.agent-skill-chain/project/`・`.workflow/`→`.agent-skill-chain/runtime/`。`.gitignore`・`package.json` files allowlist の追随 | git のステージ済みリネームで確認。`package.json` files=`[".agent-skill-chain/source/","AGENTS.md","CLAUDE.md",".agent-skill-chain/runtime/templates/","bin/","README.md"]` に更新済み。 |
| ②マーカー・衝突検知（fail-closed） | `scripts/lib/package-manifest.sh` `check_package_manifest`（正本）・`src/agents-md.ts` `checkPackageManifest`（ミラー） | 4 分岐（own/new/match/abort）を実装。setup は `check_package_manifest` を最優先で source し、abort 時は以降の破壊的操作を一切行わない（`setup.sh:45-55`）。 |
| ③バックアップ | `package-manifest.sh` `backup_agent_skill_chain`。`source/`・`runtime/templates/` をタイムスタンプ付き退避。失敗時は上書き中止 | 実装確認。退避関数は本体・templates で共用（二重実装なし）。 |
| ④SETUP.md/README 所有区分・名前空間一覧 | `SETUP.md` §所有区分表（3 サブディレクトリ＋配備先の 4 行）・workflow.db 由来検知欠如のサブ issue 参照 | 確認。**ただし移行パス節・fail-closed/fail-open 明示が欠落 → 本レビューで是正（下記 T8-指摘1）。** |
| ⑤移行パス（3 ディレクトリ統合移行） | `package-manifest.sh` `legacy_fingerprint_ok`（4 ファイル AND）・`migrate_legacy_dirs`。setup の upgrade 経路 | 実装確認。3 バックアップのうち 1 つでも失敗で移行全体を中止（`migrate_legacy_dirs:154-169`）。 |
| ⑥参照更新（122 件超） | 全追跡テキストファイル | `git ls-files -z \| xargs -0 grep -lE '\.agents/\|\.agents-project\|\.workflow/'`（issue 履歴記録除く）＝**0 件**を実測確認（下記 T8-4）。 |
| ⑦テスト更新（e2e 新規シナリオ） | `test/e2e-install-uninstall.sh` シナリオ N1〜N6（＋ N3a/b・N4a/b/c サブケース） | 7 BDD シナリオを全て実装。§2.8.4 の Gherkin と 1 対 1 対応（下記 T8-2）。 |
| ⑧安全な uninstall（runUninstall 拡張） | `src/agents-md.ts` `runUninstall`・`finalizeAscRoot`。既定=`source/`・`runtime/templates/` のみ削除、`--purge`=`project/`・`runtime/` も削除 | 実装確認。既定モードは `project/`・`runtime/<issue>/`・`workflow.db*` を保持。既存安全策（dry-run・痕跡なし中止・`.claude`/`.cursor` 選択的削除）を維持。 |
| ⑨README 警告 | `package-manifest.sh` `readme_warning_text`（正本）・配備先 `.agent-skill-chain/README.md`（生成物・非追跡）・`SETUP.md` §7 転記 | README 本体＝`readme_warning_text` の heredoc 本体とバイト一致を実測確認（bash==deployed: true）。TS `readmeWarningText` も同文言。 |

## T8-2. 受け入れ基準の確認（01 ユースケース8 BDD ／ 03 §2.8.4 Gherkin ／ e2e 対応）

| Gherkin シナリオ（§2.8.4・ユースケース8） | 対応 e2e テスト | 結果 |
| --- | --- | --- |
| S1 本パッケージ由来の再配備（バックアップ後上書き） | `test_redeploy_backs_up`（N2） | PASS |
| S2 マーカー無し／name 不一致で rm -rf 中止 | `test_foreign_dir_aborts`（N3a/N3b） | PASS |
| S3 新規配備でマーカー＋README 付与 | `test_new_deploy_marker_and_readme`（N1） | PASS |
| S4 旧 3 ディレクトリからの統合移行（フィンガープリント） | `test_legacy_migration`（N4a/b/c） | PASS |
| S5 再配備時の runtime/templates 置換前バックアップ | N2 内で確認 | PASS |
| S6 既定 uninstall によるユーザー資産保持 | `test_default_uninstall_preserves_runtime_and_project`（N5） | PASS |
| S7 --purge --yes による完全削除 | `test_purge_uninstall_removes_everything`（N6）・`test_uninstall_purge` | PASS |

全 7 シナリオがテストコード化され、テストとの対応が取れている（PHASES §監査観点「全シナリオのテストコード化の網羅」を充足）。テストは `TEST_BDD_FORMAT` の `# シナリオ:`・`# Given/When/Then:` インラインコメントを備える（実測確認）。

## T8-3. 設計整合（02 §2.6.9 の決定事項との一致）

- **命名（§2.6.9.2）**: `source/`（正本・置換可）・`project/`（不可侵）・`runtime/`（実行時生成物）。実装・SETUP.md 所有区分表と一致。
- **fail-closed 方針（§2.6.4/§2.6.9.5/§3.8.4）**: 衝突検知・移行判定は判定不能時に必ず中止。setup.sh・package-manifest.sh に明記。enforcement の fail-open との対比は setup.sh に既存、**SETUP.md には欠落していたため本レビューで是正（T8-指摘1）**。
- **バックアップ方針（§2.6.4）**: `.bak.<ts>` 退避パターン。バックアップ成立を上書きの前提とし失敗時中止。一致。
- **uninstall 安全策（§2.6.9.3）**: 既定＝`source/`・`runtime/templates/` のみ／`--purge --yes`＝完全削除。後片付け判定（ユーザー資産残存時はルート＋マーカー＋README を残す）を `finalizeAscRoot` が実装。既存 3 安全策（dry-run・痕跡なし中止・選択的削除）を維持。一致。
- **README 警告文面（§2.6.9.4）**: §2.6.9.4 の文面と実装（`readme_warning_text`）が一致。SETUP.md §7 に要旨転記あり。
- **自己適用（§2.6.9.5・8-C 是正）**: PACKAGE_ROOT=PROJECT_ROOT の実パス一致時のみマーカー検査をスキップして続行する `own` 分岐を setup.sh・TS 双方に実装。他人の無関係ディレクトリは実パス不一致で本分岐に入らず fail-closed 境界は弱まらない（T8-7 で敵対的に検証）。

## T8-4. 旧パス参照 grep（§2.8.3 バリデーション）

`git ls-files -z | xargs -0 grep -lE '\.agents/|\.agents-project|\.workflow/'` の結果、`docs/maintainer/workflow/` 配下（issue 履歴記録）を除いた**現行運用文書・コードは 0 件**（実測）。マッチする issue 履歴ディレクトリは (a) `20260614_173500_multi-tool対応/`（他の現行 issue 記録・§2.8.7 で除外指定）、(b) 本 issue 自身の `00〜04`・`90_issues.md`（履歴の不変性を優先し当時の記述のまま保持）、(c) `close/`（完了 issue 履歴）のみで、いずれも意図的な除外対象。`package-manifest.sh` の `legacy_*` 変数（`$root/.agents` 等・末尾スラッシュ無し／連結構成）はレガシー移行の対象名として意図的に残す実装であり、`\.agents/`（末尾スラッシュ付き）grep には合致しない（実測確認）。**evidence_source: observed_runtime**。

## T8-5. CODE_COMMENT_RULES（audit #26）／全体監査

`audit.sh .` フル実行＝**PASS（exit 0）**。#26（コメント外部参照禁止）を含む全チェックが PASS。タスク1〜7 レビュー時に「範囲外の既知事項」として記録した `src/agents-md.ts` の #26 違反は、8-B の是正（7 箇所）で解消済みであることを実測確認（課題1 はクローズ相当）。SETUP.md への追記（T8-指摘1 是正）後も audit は PASS を維持。**evidence_source: observed_runtime**。

## T8-6. テスト再実行（npm test 5 回連続）・flakiness 調査

`npm test`（`test/run-all.sh`＝12 テストファイル逐次実行）を **5 回連続実行し、全回 12/12 PASS・FAIL=0・SKIP=0**（`合計=12 PASS=12 FAIL=0 SKIP=0` × 5）。

- Run1〜Run5: いずれも `合計=12 PASS=12 FAIL=0 SKIP=0`、exit 0。

**flakiness 調査（8-D で 1 回のみ観測された `test-write-workflow-log-multidoc` の FAIL）**:

- **根本原因を特定**（evidence_source: existing_code + observed_runtime）。当該テストの本体シナリオ（M1〜M4）はすべて `mktemp -d` で完全隔離され `PROJECT_ROOT` を tmp に向けるため、本リポの `.agent-skill-chain/runtime/workflow.db` を一切読み書きしない。唯一の共有状態依存は末尾の「本番 DB 非破壊の事後検証」で、実リポの `workflow.db` の**行数（`SELECT COUNT(*)`）と mtime（`stat -c %Y`）が実行前後で不変**であることを表明する自己検査である。この 2 表明は、テスト実行中に**外部の別プロセスが共有の実 `workflow.db` へ書き込む**（例: 進行中セッションの書記＝write-workflow-log による INSERT）と、行数増加または mtime 変化により FAIL する。8-D の 1 回の FAIL は、その検証実行と並行して実 DB への書記書き込みが発生したことによる環境的レースであり、ストーリー8 実装のロジック欠陥ではない。
- **再現性の確認**: 実 DB への並行書記が発生しない状態（本 5 回の逐次実行では書記ステップは全テスト完了後に実施）では、5 回連続で決定的に PASS。root cause と整合。
- **評価**: 当該自己検査が共有の実 DB を参照する設計に起因する環境感受性であり、実装の正しさには影響しない。テスト頑健性の観点では（実 DB のスナップショットをアトミックに取得して比較する等の）改善余地があるが、これは既存テストの設計であってストーリー8 の変更対象ではなく、本レビューの指摘としては計上しない（改善提案として T8-課題 に記録）。

## T8-7. 事故起因の安全性の重点監査（項目7・fail-closed 境界の敵対的検証）

`mktemp -d` で完全隔離した環境に対し、常に対象ディレクトリを明示指定して敵対的テストを実施した（実リポジトリへの配備系操作は一切行っていない）。**evidence_source: observed_runtime**。

| 敵対的シナリオ | 期待 | 結果 |
| --- | --- | --- |
| A: 別パッケージ由来マーカー（name=evil）を持つ dir へ init | fail-closed で中止・既存不変 | exit≠0。sentinel ファイル保持・foreign マーカー非上書き・source 未配備（コピー前に中止）を確認 |
| B: マーカー不在の空 `.agent-skill-chain/` へ init | fail-closed で中止・ユーザーデータ保持 | exit≠0。ユーザーデータ保持・source 未配備を確認 |
| C: project/＋runtime/<issue>/＋workflow.db を持つ配備済み dir へ既定 uninstall --yes | source/・templates のみ削除、ユーザー資産全保持・ルート残置 | source/・templates 除去、project/・issue・workflow.db 全保持、ルート `.agent-skill-chain/` 残置を確認 |
| D1: フィンガープリント一致の旧 3 ディレクトリで upgrade | 3 ディレクトリを個別バックアップ後 source/project/runtime へ移行 | source/・project/・runtime(db) へ移行、`.agents.bak.<ts>` 生成、旧 `.agents/` 退避を確認 |
| D2: フィンガープリント不一致（schema.sql 欠落）で upgrade | 中止・レガシー不変 | exit≠0。`.agent-skill-chain/` 非生成、旧 `.agents/` 無変更を確認 |

境界条件の見落とし（他人のディレクトリを誤削除しうる経路／user 資産＝project・runtime issue 履歴を誤削除しうる経路）は発見されなかった。`checkPackageManifest`/`check_package_manifest`（own/new/match/abort の 4 分岐）・`legacyFingerprintOk`/`legacy_fingerprint_ok`（4 ファイル AND）・`runUninstall`/`finalizeAscRoot`（既定はユーザー資産を対象外）のコードを精読し、いずれも安全側（fail-closed・保持）に倒れることを確認した。自己適用 `own` 分岐は実パス一致を要件とするため、他人の無関係ディレクトリには波及しない。

## T8-8. 敵対的観点リスト（REVIEW_DUAL_LENS §2.1・§3）

1. **uninstall に自己適用ガードが無い＝実リポで uninstall --yes すると source が消える経路（事故の再現条件）**: `runUninstall` は `looksInstalled`（`.agent-skill-chain/` または `AGENTS.md` の存在）のみを痕跡判定に用い、PACKAGE_ROOT との実パス一致ガードを持たない。ただしこれは設計 §2.6.9.3 の must-preserve（既存 3 安全策=dry-run 既定・痕跡なし中止・選択的削除）と完全に一致し、設計は uninstall への自己適用ガードを要件化していない（uninstall は本質的に「配備物を消す」操作であり、自リポでは source が配備物そのもの＝git 追跡で復元可能）。8-B の事故は「検証スクリプトの引数バグで実リポを対象に指定した」ことが原因で、実装の fail-closed 欠陥ではない。**結論: 設計整合。実装欠陥ではない（ただし将来の防御的改善余地は T8-課題 に記録）。**
2. **フィンガープリント false-negative で正規の旧ユーザー移行を誤拒否**: 4 ファイル AND は構造的に安定なファイルを選定。将来 `source/` 構成変化時の陳腐化リスクは 03 §2.8.6 リスク節・サブ issue で既知管理済み。**結論: 既知・管理済み。**
3. **バックアップ失敗時に上書きが進む経路**: `backup_agent_skill_chain`・`migrate_legacy_dirs` はいずれも `cp` 失敗時に `exit 1` し、上書き/移動へ進まない（実測 D2 で移行中止を確認）。**結論: 問題なし。**
4. **既定 uninstall が runtime/ を丸ごと消す経路**: `DEPLOYED_ARTIFACTS` は `runtime/templates` のみ（`runtime` 全体ではない）。`finalizeAscRoot` は `runtime` の `.gitignore` 以外の残存物があればルートを保持（実測 C で確認）。**結論: 問題なし。**
5. **README/警告文の三重定義（bash/TS/配備物）ドリフト**: `readme_warning_text`（bash 正本）・`readmeWarningText`（TS ミラー）・配備 README の三者がバイト一致することを実測確認。**結論: 現時点でドリフト無し（ミラー方式の宿命的リスクは T8-課題2 で扱う）。**

## T8-9. must-preserve リスト（REVIEW_DUAL_LENS §2.2・§3）

1. **既存 uninstall 3 安全策（dry-run 既定・痕跡なし中止・`.claude`/`.cursor` 選択的削除）**: 拡張後も維持（e2e シナリオ4・N3・実測 A/B/C）。**保持を確認**。
2. **`.agent-skill-chain/project/` の setup 不可侵性**: setup は `project/` を作成も削除もしない（SETUP.md 所有区分表・実測 C で保持）。**保持を確認**。
3. **`runtime/<issue>/`・`workflow.db*` の保持**: 既定配備・既定 uninstall いずれでも touch しない（実測 C）。**保持を確認**。
4. **workflow.db 非破壊のテスト隔離契約**: 全テストが tmp 隔離。本 5 回実行後も実 DB 不変（run-all は実 DB を読み書きしない設計）。**保持を確認**。
5. **正本一元化（単一定義ミラー方式）**: 判定規則・警告文・バックアップ命名は `package-manifest.sh` を単一正本とし TS がミラー（drift 時は両方更新の注記あり）。**保持を確認（ミラー健全性は T8-課題2）**。
6. **配布物範囲（package.json files allowlist）不変**: `.agents/`→`.agent-skill-chain/source/`・`.workflow/templates/`→`.agent-skill-chain/runtime/templates/` の平行移動のみで配布範囲は不変。**保持を確認**。

## T8-指摘・是正（本レビューで直接是正した軽微指摘）

- **T8-指摘1（是正済み・ドキュメント記述の過不足）**: `.agent-skill-chain/source/SETUP.md` に、02_設計 §2.6.9.5／§3.8.4 が **setup.sh・SETUP.md の双方に明記**を求めた「配備マーカーによる衝突検知（fail-closed）・再配備前バックアップ・旧 3 ディレクトリからの統合移行パス」および「enforcement の fail-open との対比」が欠落していた（setup.sh には存在。SETUP.md は所有区分表と uninstall 契約のみで、移行パス節と fail-closed/fail-open 明示が無かった）。本レビューで SETUP.md に「### 配備マーカーによる衝突検知・バックアップ・統合移行（fail-closed）」節を新設し、状況別挙動表・レガシー移行手順・fail-closed/fail-open 対比を実装（`package-manifest.sh`）に忠実に追記した。追記後 `audit.sh` PASS を再確認。既存の「保持・上書き契約」表（行数・列構成）は改変していない（§2.8.3 の表フォーマット一致要件を維持）。

## T8-課題（非ブロッキング・進行役判断／将来課題として記録）

- **T8-課題1（テスト頑健性・改善提案）**: `test-write-workflow-log-multidoc.sh` の「本番 DB 非破壊」自己検査（実 `workflow.db` の行数・mtime 比較）は、並行する実 DB への書記書き込みに感受性があり flaky の温床となる（T8-6 参照）。実装の正しさには影響しないが、将来的にスナップショットのアトミック取得等で頑健化する余地がある。ストーリー8 の変更対象外のため本 issue では対応しない。
- **T8-課題2（コード品質・ミラー方式の未実行コード）**: `src/agents-md.ts` の衝突検知・移行系ミラー関数（`checkPackageManifest`・`legacyFingerprintOk`・`backupAgentSkillChain`・`writePackageManifest`・`writeReadmeWarning`）は、init/upgrade が `runSetup` 経由で `setup.sh`（＝単一正本 `package-manifest.sh`）に完全委譲する設計のため、**production 実行経路・テストのいずれからも呼ばれていない**（全リポ grep で定義元 `agents-md.ts` 以外に参照なし・実測）。設計 §2.8.2② は「両実装が同一判定規則を持つ」ことを、§2.8.3 は「setup.sh と agents-md.ts が同一判定結果を返す（ドリフト検知）」パリティ試験を求めているが、後者のパリティ試験は存在しない（`ownedSkillNames` ミラーが uninstall で実際に使われ live なのとは対照的に、本マーカー系ミラーは dead）。**ストーリー8 の fail-closed 安全性には影響しない**（正本の setup.sh/package-manifest.sh は実装・e2e・本レビューの敵対的テストで十分に検証済み）が、「同一規則をミラーする」旨の権威的コメントが実際には何にも強制されていない。**是正方針（(a) dead な TS ミラーの削除 vs (b) §2.8.3 パリティ試験の新規追加）は、事故発生領域の safety モジュールに関わる設計判断のため、本レビューでは自己修正せず進行役の判断を仰ぐ**（拙速な自己修正よりも報告を優先。REVIEW_DUAL_LENS の「不確実なら要修正に倒す」に従い記録するが、安全性は非該当のため非ブロッキングと判定）。

## T8-10. 総合評価

- **実装品質**: 良好。§2.8.2 の 9 サブタスクが実装・テストで充足。fail-closed 境界は敵対的検証（隔離環境 5 ケース）で堅牢。
- **テスト品質**: 良好。7 BDD シナリオが e2e にコード化され Gherkin と 1 対 1 対応。npm test 5 回連続 12/12 PASS、flakiness の根本原因を特定。
- **設計整合**: 良好。02 §2.6.9 の決定事項（命名・fail-closed・バックアップ・uninstall 安全策・README 文面）と一致。唯一の記述欠落（SETUP.md 移行パス節・fail-closed/fail-open 明示）は本レビューで是正。
- **総合**: **ストーリー8 はブロッキング指摘 0 件で収束**（T8-指摘1 は本レビューで直接是正済み・audit 再 PASS）。非ブロッキングの課題 2 件（T8-課題1 テスト頑健性・T8-課題2 TS ミラー dead コード＋パリティ試験欠如）を記録し、T8-課題2 は進行役判断を要する事項として明示的にエスカレーションする。

### T8 重要判断の evidence_source

| 判断内容 | evidence_source | 根拠 |
| --- | --- | --- |
| fail-closed 境界が他人ディレクトリ・ユーザー資産を誤削除しない | observed_runtime | 隔離環境 A/B/C/D1/D2 の敵対的テスト実測 |
| 旧パス参照が現行運用文書・コードに 0 件 | observed_runtime | `git ls-files` ベース grep 実測 |
| audit #26 を含む全監査 PASS | observed_runtime | `audit.sh .` フル実行 exit 0 |
| npm test 5 回連続 12/12 PASS・flakiness 根本原因 | observed_runtime + existing_code | 5 回逐次実行ログ＋テスト本体の共有状態依存箇所の精読 |
| README/警告文の bash/TS/配備物ドリフト無し | observed_runtime | バイト一致比較（bash==deployed: true） |
| TS ミラー関数が未使用（dead） | observed_runtime | 全リポ grep で定義元以外に参照 0 件 |
| 設計 §2.6.9 の各決定事項と実装の一致 | existing_code | 02_設計 §2.6.9.1〜5 と実装ファイル本文の突合 |

## T8-課題2是正（進行役方針(b)＝パリティ試験の新規追加）

**是正日**: 2026-07-11 ／ **担当**: opus（fail-closed safety モジュールのため）／ **evidence_source: observed_runtime**

進行役の判断により、T8-課題2 は方針(b)（dead な TS ミラーの削除ではなく、§2.8.3 が要求していたパリティ試験の新規追加）で是正した。二重実装（bash 版 `package-manifest.sh` ／ TS 版 `src/agents-md.ts`）は fail-closed の安全性ロジックに対する意図的な防御的設計（`ownedSkillNames`⇔`list_owned_skill_names` と同型）であり、削除ではなく同期を強制するパリティ試験を設けることでドリフトを検知可能にした。

- **追加テスト**: `test/test-package-manifest-parity.sh`（TEST_BDD_FORMAT 準拠・全シナリオ `mktemp -d` 隔離・`assert_tmp_target` で /tmp 配下を強制）。5 関数のパリティを検証:
  - `checkPackageManifest` ⇔ `check_package_manifest`: new／match／abort(マーカー不在)／abort(name 不一致)／own(自己適用) の 5 入力状態で同一判定を確認。
  - `legacyFingerprintOk` ⇔ `legacy_fingerprint_ok`: 4 ファイル充足＋各 1 ファイル欠落（boot/setup/audit/schema）で同一 true/false を確認。
  - `writePackageManifest` ⇔ `write_package_manifest`: 生成 `.package-manifest` のバイト一致を確認。
  - `backupAgentSkillChain` ⇔ `backup_agent_skill_chain`: 退避先命名規則（`.agent-skill-chain-source.bak.<14桁>`・`.agent-skill-chain-runtime-templates.bak.<14桁>`）と退避内容の一致を確認。
  - `writeReadmeWarning` ⇔ `write_readme_warning`: 生成 `README.md` のバイト一致（文言ドリフト検知）を確認。
- **TS 側の最小変更**: 上記 5 関数を `export`（CLI の public interface・コマンド体系は不変）。テストから import できるよう、エントリポイント `process.exit(main(...))` を es-main 判定（argv[1] と本モジュール実体パスの realpath 一致）でガードし、**直接起動時のみ main を実行・import 時は副作用なし**とした（npm bin の symlink 経由でも直接起動を正しく判定）。5 関数と bash 側対応関数のコメントに「パリティ試験 `test/test-package-manifest-parity.sh` で同期を検証」旨を追記（`ownedSkillNames` のミラーコメントと同型）。
- **検証結果（実測）**: `npm run typecheck` PASS・`npm run build` PASS。新テスト単体 28 アサーション全 PASS。`npm test` 全体 **3 回連続 13/13 PASS**（新テストを `run-all.sh` の TESTS 一覧・bin 前置ビルド case に登録）。

## T8-指摘3是正（build-adapters.sh の旧パス残骸クリーンアップ漏れ）

**是正日**: 2026-07-11 ／ **evidence_source: observed_runtime**

ストーリー8 完了後の `.adapters/` 再生成作業で、`.agent-skill-chain/source/scripts/build-adapters.sh` の `adapter_claude()`・`adapter_cursor()` 内クリーンアップ（生成物再作成前の `rm -rf`）が、統合ネスト以前の旧パス `.agents/`（ドット付き・6/14〜16 頃生成）を対象に含んでいなかったため、`.adapters/claude/.agents/`・`.adapters/cursor/.agents/` が再ビルド後も残骸として残り続ける不具合を発見・是正した（`.adapters/` は `.gitignore` 対象の生成物であり、本不具合はリポジトリの追跡ファイルには影響しない）。

- **是正方針**: 個別パスの列挙にホワイトリスト追加する方式ではなく、`rm -rf "$out"`（出力先ディレクトリ丸ごと再作成）方式へ変更した。理由: `.adapters/claude/`・`.adapters/cursor/` 直下は既存コメントにも明記の通り 100% 生成物であり、実測（`ls -la`）でも直下に手動管理ファイルの混在は無い（全サブディレクトリおよび `GENERATED.md` はスクリプトが再生成する）。個別列挙方式のままでは今回と同種（パス名変更・リネームへの追従漏れ）の不具合が将来も再発しうるため、ディレクトリ丸ごと再作成方式の方が構造的に望ましいと判断した。
- **検証（実測）**:
  - 修正前: `.adapters/claude/.agents/`・`.adapters/cursor/.agents/`（旧パス残骸、18 項目のサブディレクトリ・ファイルを含む）の存在を確認。
  - 修正後、`build-adapters.sh`（引数なし＝claude cursor 両方）を実行 → `.adapters/claude/.agents/`・`.adapters/cursor/.agents/` は生成されない（存在しないことを確認）。
  - 2 回連続実行し、`find .adapters -maxdepth 3` の出力が完全一致（累積・残骸再発が無いことを確認）。
  - `grep -rlE '\.agents/|\.agents-project|\.workflow/' .adapters/` の結果、ヒットは `.adapters/{claude,cursor}/.agent-skill-chain/source/SETUP.md`（レガシー移行手順の説明文言。正当な既知の例外）のみ。
  - `npm test` 全体 **13/13 PASS・FAIL=0・SKIP=0**（リグレッション無し）。
  - `git status --short` は `.agent-skill-chain/source/scripts/build-adapters.sh` の変更のみ（`.adapters/` は `.gitignore` 対象のため差分に出現しない。追跡ファイルへの意図しない変更なし）。
- **変更ファイル**: `.agent-skill-chain/source/scripts/build-adapters.sh`（`adapter_claude()`・`adapter_cursor()` のクリーンアップ処理を個別列挙から `rm -rf "$out"` へ変更）。
- **flakiness の付記**: 3 回連続 green の前の 1 回で `test-cli-audit-doctor`・`test-write-workflow-log-glob` が単発 FAIL したが、両者はミラー系と無関係（前者は T8-課題1 と同根の実 `workflow.db` 書記シード n<3、後者も同系の DB シード）で、**ベースライン（本是正前）でも同条件で FAIL・隔離実行では各 3/3 PASS** を実測。本是正による回帰ではなく、T8-課題1 に記録済みの既存環境感受性である。
