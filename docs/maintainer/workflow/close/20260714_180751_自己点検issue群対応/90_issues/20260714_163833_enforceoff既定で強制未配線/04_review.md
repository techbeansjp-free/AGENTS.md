---
document_id: "07f2efd0-289d-4e29-8be8-95113c3ca7e6"
---

# レビュー書: enforce を新規セットアップ既定 on 化し「絶対強制」の実態を記述と一致させる

**プロジェクト名**: enforce off が既定状態であり「絶対強制」の実態が宣言のみ
**作成日**: 2026年07月14日
**最終更新**: 2026年07月14日

> レビュー深度: standard（新規配備の既定挙動変更＝全新規消費者環境に影響するため、既存テストのフル回帰と隔離環境での挙動実測を実施）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

柱 A（新規配備 `ASC_MODE=new` 時のみ enforcement を既定 on で自動配線）と柱 B（各層・各ツールの強制力区分の記述整合）が、00 の成功基準・01 の受け入れ基準（AC-1〜AC-7）・02 の設計（ADR-1〜5）どおりに実装され、既存挙動・後方互換に回帰が無いことを確認する。

### 1.2 レビュー対象（必須）

- **実装範囲**:
  - 柱 A: `.agent-skill-chain/source/scripts/setup.sh`（`enforce_default_on_if_possible` 新規・`ASC_MODE=new` 分岐）、`src/agents-md.ts`（init 経路の setup.sh 完全委譲・ヘルプ/コメント整合）。
  - 柱 B: `.agent-skill-chain/source/SETUP.md`、`.agent-skill-chain/source/enforcement/README.md`、`README.md`、`docs/04_機能設計/CLI/README.md`。
  - テスト: `test/test-enforce-default-on.sh`（新規）、`test/e2e-install-uninstall.sh`（R6 更新）、`test/run-all.sh`（登録）。
- **レビュー期間**: 2026年07月14日 〜 2026年07月14日
- **レビュー担当者**: verify-and-close 担当エージェント（opus・最終レビュー）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| タスク 1・2: 既定 on 配線（柱 A） | `setup.sh` に `enforce_default_on_if_possible` を追加し `ASC_MODE=new` のときのみ既存 CLI `enforce on`（`enforceOn()`）を起動。TS init は `runSetup()` で setup.sh へ完全委譲し二重実装しない。 | 2026-07-14 | 実装担当エージェント | 完了 |
| タスク 3: SETUP.md（柱 B） | §見出しを「enforcement（新規セットアップ既定 on・opt-out 可）」へ。`ASC_MODE` 別配線表・保持契約表・復旧手順相互参照を追加。 | 2026-07-14 | 実装担当エージェント | 完了 |
| タスク 4: enforcement/README.md（柱 B） | 4 層表 Layer2・ツール別マトリクス Claude Code 行・Runtime 節・§現状の実装について に強制力区分と有効条件を明記。 | 2026-07-14 | 実装担当エージェント | 完了 |
| タスク 4補: README.md・docs/04_機能設計/CLI/README.md（柱 B） | ルート README の 3 行導線・CLI 表・拡張ポイント表、CLI システム仕様書の `init`/`upgrade`/`enforce` 行を新挙動へ整合。 | 2026-07-14 | 実装担当エージェント | 完了 |
| タスク 5: 回帰テスト（柱 A） | `test-enforce-default-on.sh`（S1〜S5）新規・`e2e-install-uninstall.sh` R6 更新・`run-all.sh` 登録。 | 2026-07-14 | 実装担当エージェント | 完了 |

### 2.2 実装内容の詳細

#### 柱 A: 既定 on 配線

- **実装内容**: `setup.sh` 末尾に `enforce_default_on_if_possible <project_root> <package_root>` を追加。`if [[ "$ASC_MODE" == "new" ]]` のときのみ呼ぶ。関数は `node "$cli" enforce on "$project_root"` を起動するだけで、配線ロジック（無効 JSON 中止・`.bak` 退避・冪等マージ・nonce ローテート）は既存 `enforceOn()` をそのまま再利用する（新規実装なし・ADR-2）。
- **安全側フォールバック**: node 不在・CLI（`bin/agents-md.js`）未生成でビルド不可・配線失敗のいずれでも `return 0` で警告のみに倒し、`init`/`setup` 全体を中断しない。
- **bash↔TS パリティ**: TS 側 `runSetup()` は setup.sh へ完全委譲する薄いラッパであり、init 経路の実体は setup.sh 1 箇所のみ。既定 on の判定・配線も setup.sh に集約され、bash/TS で挙動がドリフトしない（構造的パリティ・重複実装禁止）。
- **変更ファイル**: `.agent-skill-chain/source/scripts/setup.sh`・`src/agents-md.ts`

#### 柱 B: 記述整合

- **実装内容**: SETUP.md・enforcement/README.md・README.md・docs/04_機能設計/CLI/README.md の該当箇所を、「新規配備（`ASC_MODE=new`）は既定 on・opt-out 可／既存再配備（`match`）・自己適用（`own`）は touch しない」および各層/各ツールの強制力区分（新規既定 on runtime／opt-in／advisory／CI のみ）と有効条件へ整合。「絶対強制」表現は維持し、実効を区分表へ集約して条件付き記述と矛盾させない（ADR-5）。
- **変更ファイル**: `.agent-skill-chain/source/SETUP.md`・`.agent-skill-chain/source/enforcement/README.md`・`README.md`・`docs/04_機能設計/CLI/README.md`

---

## 3. テスト結果の確認

### 3.1 単体・回帰テスト（再実測）

#### テスト実行結果（数値）

- **実行日**: 2026-07-14（verify-and-close で再実行・再現確認）
- **コマンド**: `bash test/run-all.sh`
- **テストファイル数**: 20
- **成功（PASS）**: 20
- **失敗（FAIL）**: 0
- **スキップ（SKIP）**: 0

```
合計=20 PASS=20 FAIL=0 SKIP=0
```

新規 `test-enforce-default-on.sh` は `bash git tar node sqlite3` を要求し、本環境では依存が揃うため SKIP されず実行され PASS。実装フェーズ報告（PASS=20 FAIL=0 SKIP=0）を再現確認した。

#### シナリオ別（`test/test-enforce-default-on.sh`）

| # | シナリオ | 受け入れ基準 | 期待 | 実測 |
| --- | --- | --- | --- | --- |
| S1 | 新規配備（`ASC_MODE=new`）で既定 on 配線・`__agentsMdEnforce` マーカー付き | AC-1 | on | PASS |
| S2 | 既存再配備（`match`）で `enforce off` を保持 | AC-2 | off のまま | PASS |
| S3 | 自己適用（`own`）で settings.json を自動配線しない | AC-3 | 未生成 | PASS |
| S4 | 無効 JSON 新規環境で配線を安全に見送り破壊しない | AC-4 | 完走・不変・hooks 生成 | PASS |
| S5 | 既定 on 後の再 `enforce on` で managed エントリ重複なし（冪等） | — | 1 件のまま | PASS |

### 3.2 E2E テスト

`test/e2e-install-uninstall.sh` シナリオ R6 を「新規配備は既定 on／`enforce off` で opt-out・再 on・ユーザー値保持」へ更新。uninstall 検証も「`.claude/hooks`（配備分）は除去、`.claude/settings.json`（既定 on のユーザー設定）は保持」へ整合。`run-all.sh` フル実行に含まれ PASS。

### 3.3 監査（audit.sh）

`bash .agent-skill-chain/source/enforcement/ci/audit.sh .` を実行。**本変更（柱 A のコード・柱 B の記述・テスト）に起因する新規 FAIL は無い**。詳細は §9.4 監査結果の解釈を参照。

---

## 4. 受け入れ基準の確認

| # | 受け入れ基準 | 検証方法 | 結果 |
| --- | --- | --- | --- |
| AC-1 | `ASC_MODE=new` で既定 on 配線・`__agentsMdEnforce` マーカー | test S1（実測） | 充足 |
| AC-2 | `ASC_MODE=match` で touch しない（off 保持） | test S2（実測） | 充足 |
| AC-3 | `ASC_MODE=own` で自動配線しない | test S3（実測）・setup.sh `if [[ "$ASC_MODE" == "new" ]]` 分岐 | 充足 |
| AC-4 | 無効 JSON 中止・`.bak`・ユーザー値保持（既存安全策踏襲） | test S4（実測）・`enforceOn()` 再利用（ADR-2） | 充足 |
| AC-5 | SETUP.md が新規既定 on・opt-out・復旧手順を正確記述 | SETUP.md 差分レビュー | 充足 |
| AC-6 | enforcement/README.md の各層・各ツール表と絶対強制節に区分・有効条件明記 | enforcement/README.md 差分レビュー | 充足 |
| AC-7 | 本リポ settings.json への実適用はスコープ外・手動と 02/03 に明記 | 02 ADR-3・§5・03 §1.1 の記載 | 充足 |

---

## 5. コードレビュー

### 5.1 コード品質

- **構文チェック**: `setup.sh` は `bash -n` 相当で問題なし（`run-all.sh` 内の bash テスト群が実行系として担保）。TS は `npm run build`（tsc）が成功し `bin/agents-md.js` が生成される（テストの前置ビルドで確認）。
- **型チェック**: TS は既存 `enforceOn()` を呼ぶのみで新規型導入なし。

### 5.2 コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 単一責務・DRY | 配線ロジックを再実装せず既存 `enforceOn()` を再利用しているか | OK | setup.sh は `node cli enforce on` を起動するのみ（ADR-2） |
| 後方互換 | `match`/`own` で settings.json を touch しないか | OK | `if [[ "$ASC_MODE" == "new" ]]` ガード・test S2/S3 |
| 安全側フォールバック | 依存欠如・無効 JSON・配線失敗で init 全体を壊さないか | OK | 各分岐で警告のみ `return 0`・test S4 |
| パリティ | bash/TS で挙動がドリフトしないか | OK | TS は setup.sh へ完全委譲（構造的単一経路） |
| 記述の誠実性 | 「絶対強制」を実効の重畳（Layer2 新規既定 on＋CI＋人手）へ集約し誇張しないか | OK | ADR-5・区分表相互参照 |

### 5.3 指摘事項

#### 指摘 1: 既定 on による新規環境の自己ロックアウトリスク（既知・対策済み）

- **重要度**: 中
- **指摘内容**: 新規環境で PreToolUse がライブになるため、orchestrator allowlist がハーネス組込ツール（`Agent`・`AskUserQuestion` 等）を網羅しないと自己ロックアウトが起こりうる（過去に `Agent` で発生）。
- **対応状況**: 対応済み（前提＋案内）。allowlist 網羅は別バッチ（163531 等）で対応済みを前提とし（ADR-4）、SETUP.md の §enforcement 冒頭からロックアウト復旧（`!enforce off`）への相互参照で発見性を高めた。
- **対応方法**: 追加対応不要（申し送り: 新規環境向けの復旧手順の可視性は維持する）。

#### 指摘 2: 本リポ自身への enforce on 実適用はスコープ外（設計どおり）

- **重要度**: 低
- **指摘内容**: 本リポ `.claude/settings.json`（gitignore・ローカル固有）への実 enforce on 適用は本 PR では行わない。
- **対応状況**: 設計どおり（ADR-1 の `own` 除外＋ ADR-3 の手動方針で二重に防止）。実適用は別途ユーザー許可を得て orchestrator が手動実行する。

---

## docs 更新

- 要否: 要
- 対象: `docs/04_機能設計/CLI/README.md`（CLI コマンド一覧の `init`/`upgrade`/`enforce` 行）
- 理由: 本 issue は CLI（`init`/`upgrade`）の既定挙動を変える（新規配備で enforcement を既定 on 化）ため、CLI システム仕様書の as-built 記述を実装挙動に一致させる必要があった。継続追随ゲート（DOCS_RULES §継続追随ゲート）を実施し、CLI 仕様セクションを実装（`setup.sh:enforce_default_on_if_possible`・`ASC_MODE=new` 分岐）と照合して is-built 同期済み・指摘 0 とした結果を [`docs/00_review/20260714_221215_review.md`](../../../../../../00_review/20260714_221215_review.md) に記録し、[`docs/00_review/README.md`](../../../../../../00_review/README.md) の索引に 1 行追記した。enforcement 俯瞰仕様（`docs/04_機能設計/enforcement/README.md`）は詳細を source 正本へ委譲しており as-built を偽にしないため追加更新は不要。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務・重複実装禁止（02 §1.2）に沿い、判定は既存 `ASC_MODE` を再利用、配線は既存 `enforceOn()` を再利用。新規の fresh 判定・配線ロジックを増やしていない。
- **後方互換・安全側**: 判定不能・無効 JSON・依存欠如・配線失敗はすべて「配線しない（従来の off 相当）」へ倒す。
- **記述は現在の事実のみ**: 「かつて off だった」等の経緯を正本に残さず、現在の強制力区分のみを明記（feedback_no-historical-narrative と整合）。

### 9.2 境界・依存の確認

- **責務の境界**: 「新規/既存/自己適用の判定」は `check_package_manifest`（既存）、「配線の実行」は `enforceOn()`（既存）、「新規時のみ配線を起動する」オーケストレーションのみが本 issue の新規責務。CI ブロッキング化・workflow.db CI 追跡は別 issue（163129・163203）の責務で非交差。allowlist 網羅は別バッチ（163531 等）の責務・前提。
- **配置境界**: 消費者共通の既定 on 挙動・強制力区分はコア（`.agent-skill-chain/source/`）へ。本リポ固有の settings.json ローカル固有性・CI 非ブロッキングは `.agent-skill-chain/project/` を参照し重複させない。
- **依存関係**: 新規外部依存なし。既定 on 配線は node + 既存 CLI に依存し、欠如時は安全に見送る。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| 新規/既存判定に既存 `ASC_MODE` を再利用（ADR-1） | existing_code | `setup.sh:58` の `check_package_manifest` 出力を分岐に使用 |
| 配線は既存 `enforceOn()` を流用（ADR-2） | existing_code | setup.sh は `node cli enforce on` を起動するのみ |
| 本リポ自己適用はスコープ外・手動（ADR-3） | issue_document | 01 §4・02 ADR-3。`own` 除外＋手動で二重防止 |
| S1〜S5 の許可/配線の実測 | test_output | `test/test-enforce-default-on.sh` 実行（§3.1） |
| 全 20 ファイル非劣化 | test_output | `test/run-all.sh`（合計=20 PASS=20 FAIL=0 SKIP=0） |

### 9.4 監査結果の解釈（申し送り事項の確認）

`audit.sh .` の結果について、**本変更のコード・記述・テストに起因する新規 FAIL が無い**ことと、証跡記録に伴う DB 系チェックの発火が本ブランチ隔離環境の構造的制約であることを、次のとおり整理した。

- **DB 系チェック（#3, #8-#25, #29, #31-#35）は CI では常に SKIP**: `workflow.db` は Git 非追跡であり、CI のクリーンな checkout では常に不在のため DB 系チェックは全 SKIP される（audit.sh の設計・意図。実効的な検知経路はローカル pre-push フック）。加えて本リポジトリの CI（`self-enforce.yml`）は現状非ブロッキング運用である（別 issue の担当）。したがって本 PR の CI ゲートは DB 状態に依存しない。
- **コード変更のみの監査（空 DB 状態）で新規 FAIL 0**: 証跡記録前（`workflow_log` テーブル不在で DB 系全 SKIP）の監査では、非 DB チェックにおいて本変更起因の FAIL は無かった。DB 非依存の残 FAIL（別サブ issue の `03` テスト観点・`04` docs 更新、`docs/00_review/` 既存記録の #37）は、いずれも本ブランチのマージベース時点で同内容が存在する既存事象であり、本変更が新たに導入したものではない。
- **テスト観点セクション（#4）**: 本 issue の `03_実装計画.md` に監査要求の固定見出し `## テスト観点` を追加し、当該 FAIL を解消した（本 issue 分は解消済み。別サブ issue 分は各 issue の担当）。
- **継続追随ゲート #31 の充足**: 本 issue は CLI システム仕様書 `docs/04_機能設計/CLI/README.md` を編集したため、継続追随ゲートを実施し `docs/00_review/20260714_221215_review.md` を作成・索引追記した。本 04_review の `## docs 更新` は要否=要・`docs/00_review/` の実タイムスタンプ参照を持つため #31 を満たす。
- **証跡記録（本則証跡）と DB 系チェック発火の整理**: verify-and-close で `write-workflow-log.sh` を用い、本 issue の実 provenance を持つ証跡のみを workflow.db に記録した——(a) implement-feature（実コミット `9199505` の committer 時刻・実変更ファイル一覧）、(b) verify-and-close ×3（本レビューで作成/更新した 04_review・03・docs/00_review。実時刻）。**design-feature・review-docs は、本ブランチ隔離 DB に前フェーズのログが persist されておらず、検証可能な実時刻を持たないため、台帳の provenance を毀損しないよう再構成（バックデート）しなかった。** この結果、DB を持つローカル監査では次が発火するが、いずれも**隔離ワークフロー DB の生態系不完全性に起因する構造的アーティファクトであり、本変更のコード欠陥ではない**:
  - **#32（本 issue・review-docs ログ 0 件）**: review-docs はフェーズ引き継ぎ上は実施済みだが、その証跡が本 DB に検証可能な形で存在しない（上記の非バックデート方針の帰結）。**申し送り**: 永続環境での正規の review-docs 記録が必要。
  - **#29（別サブ issue 21 件）**: 兄弟 issue の証跡は各々の隔離ワークフロー DB（クリーンアップ済み）にあり本 DB に無いため発火。本変更の対象外。
  - **#34（親ワークフローの GitHub Issue ゲート）・#20（親 00 の document_id 未記録）**: 親ワークフロー起票・親 00 の記録が本 DB に無いため、本 issue の implement ログが親パスに前方一致して発火。親ワークフローの記録は進行役の担当。
  - **申し送り**: 上記 #32/#34/#20/#29 は、canonical（永続）環境での完全な台帳記録が満たされれば解消する。CI では DB 不在のため全 SKIP されゲートに影響しない。

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1**: 既定 on は新規環境の自己ロックアウト確率を上げる。
  - **影響範囲**: allowlist 未網羅の新規環境。
  - **対応方法**: allowlist 網羅（別バッチ前提）＋復旧手順の発見性向上で緩和済み（§5.3 指摘1）。

### 10.2 改善提案

- **改善 1**: 本リポ CI のブロッキング化・workflow.db の CI 追跡化（別 issue 163129・163203）が完了すれば、DB 系チェックが CI でも有効化され、既定 on の実効がさらに担保される。

---

## 11. システム仕様書の更新

### 11.1 確認結果

- **実装した機能**: 新規配備時の enforcement 既定 on 化（CLI `init`/`upgrade` の既定挙動変更）。
- 影響したシステム仕様書: `docs/04_機能設計/CLI/README.md`（更新済み・§docs 更新参照）。

### 11.2 更新状況

- 更新済み: `docs/04_機能設計/CLI/README.md`（CLI コマンド一覧）。
- 更新不要: `docs/04_機能設計/enforcement/README.md`（俯瞰・詳細は source 正本へ委譲・as-built 不変）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（既存 `ASC_MODE`・`enforceOn()` を再利用する最小差分・安全側フォールバック完備）。
- **テスト品質**: standard として十分（S1〜S5 の隔離実測＋全 20 ファイル非劣化）。
- **ドキュメント品質**: 良好（区分表への集約で「絶対強制」表現と実態を一致）。
- **総合評価**: 完了。

### 12.2 承認状況

- **承認者**: verify-and-close 担当エージェント
- **承認日**: 2026-07-14
- **承認コメント**: 受け入れ基準 AC-1〜AC-7 充足・全テスト PASS・本変更起因の新規監査 FAIL なしを確認。マージ可。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本リポ自身の `.claude/settings.json` への enforce on 実適用は本 PR のスコープ外（別途ユーザー許可を得て orchestrator が手動実行）。本 issue はレビュー完了とし close へ遷移する。

---

## 敵対的観点（アドバーサリアルレビュー）

- **反論 1**: 「既定 on は既存利用者の設定を勝手に変えるのでは」→ 変えない。発火は `ASC_MODE=new`（配備マーカー不在＝真の初回）に限定され、`match`（既存再配備）・`own`（自己適用）は touch しない（test S2/S3・ADR-1）。意図的に `enforce off` した設定が upgrade で再有効化されることはない。
- **反論 2**: 「node 不在環境で init が壊れるのでは」→ 壊れない。node 不在・CLI 未生成・配線失敗はいずれも警告のみ `return 0` で、`init`/`setup` 全体は完走する（安全側フォールバック・test S4 は無効 JSON でも完走を確認）。
- **反論 3**: 「bash と TS で挙動がずれるのでは」→ ずれない。TS init は `runSetup()` で setup.sh へ完全委譲し、既定 on 配線は setup.sh 1 箇所に集約されるため、判定・配線の二重実装が存在しない（構造的パリティ）。
- **反論 4**: 「『絶対強制』表現を残すのは誇張では」→ 既定 on 化により Layer2 が「opt-in で条件付き」から「新規既定で条件付き」へ強化されており、裏付けはむしろ従来より強い。誇張回避は断定語の削除ではなく「有効条件の明記」（区分表への集約）で達成した（ADR-5）。

## must-preserve（不変条件）

- `enforce on`/`off`/`status` CLI サブコマンドの契約・挙動は不変であること（既定 on は「新規配備時に enforce on 相当を自動起動する」ものであり、コマンド自体の意味を変えない）。
- `ASC_MODE=match`・`ASC_MODE=own` では `.claude/settings.json` を touch しないこと。
- 無効 JSON・依存欠如・配線失敗時に `init`/`setup` 全体を中断しないこと（安全側フォールバック）。
- 既存 `enforceOn()` の安全策（無効 JSON 中止・`.bak` 退避・冪等マージ・nonce ローテート）を再利用し再実装しないこと。
