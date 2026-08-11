# DESIGN: docs/adr/でADR番号が重複しており(ADR-0016×3・ADR-0008×2・ADR-0039×2)、adr-lintがID一意性を検査していないためCIで検出されない

- Issue: `ISSUE-539`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 同一 `id:` を持つ複数ファイルの存在を `lint adr check`（CI含む）がエラー検出する（AC-1） | `src/lib/adr-consistency.ts` の `collectAdrFileRecords()`（新規）・`checkAdrIdUniqueness()`（新規） | `collectAdrRecords()`（既存、id 索引の `Map`）は id 重複時に後勝ちで上書きし重複自体を握りつぶすため、重複検出には使えない。全ファイルを保持する非重複配列を先に作る |
| エラー出力に重複IDと該当ファイル名を含む（AC-1） | `checkAdrIdUniqueness()` の違反メッセージ整形 | `重複ADR ID '<id>': <file1>, <file2>, ...` 形式 |
| 一意な場合は `lint adr check` が成功を維持する（AC-2） | `src/commands/lint.ts` の `adr()` への `checkAdrIdUniqueness()` 組み込み | 既存の `checkAdrSymmetry()` と結果を合算し、違反0件のときのみ終了コード0 |
| 現存7件を一意な番号へ再採番し `lint adr check` がエラー無く通過する（AC-3） | 「既存重複7ファイルの再採番マッピング」節の対応表 | 実装（③実装セグメント）が本対応表どおりに `id:` フィールドとファイル名を変更する |
| 再採番後も既存の構造化参照・ソースコード直接参照が同じ論理的参照先を指し続ける（AC-4） | 「参照影響調査」節 | 対象7ファイル間・他ADRからの `related_adrs:`/`supersedes`/`superseded-by` 構造化参照は0件（新規に壊れる参照は無い）。バレテキスト直接参照4件の更新要否を特定済み |

## 責務・境界

### コンポーネント構成

- `src/lib/adr-consistency.ts`: ADRのfrontmatter読み込みと整合性検査ロジックを持つ純粋関数群。本Issueで以下を追加する。
  - `collectAdrFileRecords(root)`: `docs/adr/` 配下の全 `.md` ファイルを走査し、`{ file: string; frontmatter: AdrFrontmatter }[]` を返す（id での重複排除をしない生の列挙）。既存の `collectAdrRecords()` はこの関数の結果から id 索引の `Map` を構築するよう内部実装を変更する（後勝ち上書きの既存挙動・戻り値の型・呼び出し側インターフェースは不変。`checkAdrSymmetry()` の入力契約を壊さない）。
  - `checkAdrIdUniqueness(records)`: `collectAdrFileRecords()` の戻り値を受け取り、同一 `id` を持つレコードが2件以上あるグループごとに違反メッセージ1件を生成する。
- `src/commands/lint.ts` の `adr()`: `collectAdrFileRecords()` → `checkAdrIdUniqueness()` を `checkAdrSymmetry()` より先に実行し、両者の違反を1つの配列へ結合してから出力・終了コード判定を行う（既存の「`violations.length > 0` なら標準エラー出力し終了コード1」という制御構造は変更しない）。

### 依存関係

```text
lint.ts adr() → adr-consistency.ts collectAdrFileRecords() → docs/adr/*.md
lint.ts adr() → adr-consistency.ts checkAdrIdUniqueness(records)
lint.ts adr() → adr-consistency.ts collectAdrRecords(records) → checkAdrSymmetry(byId)
```

`collectAdrRecords()` は `collectAdrFileRecords()` の結果を後勝ちで畳み込むだけの薄い派生関数になり、`checkAdrSymmetry()` 側のインターフェース・違反メッセージ文言は一切変更しない（既存テスト `test/integration/lint.test.ts` の非対称検出テストとの後方互換を維持する）。

### 図示要否の判断

- 判断: `不要`
- 根拠: 新規コンポーネントは `adr-consistency.ts` 内の2関数追加と `lint.ts` 内の呼び出し1箇所追加のみで、責務境界は2（frontmatter収集・検査ロジック層／CLIコマンド層）に留まり基準の3未満。依存関係も上記の一段の線形フロー（ファイル読み込み→検査→出力）のみで3未満。状態遷移も無い（読み取り専用の検査コマンドであり、実行のたびに独立して完結する）。

## 既存重複7ファイルの再採番マッピング

`docs/adr/` の現存する最大番号は `ADR-0047`（`ADR-0047-dependabot-yml-removal-from-distribution-template.md`）。重複7ファイルを、未使用の `ADR-0049`〜`ADR-0055` へ、以下の対応で再採番する（採番順序はファイル名のアルファベット順、恣意的な優劣判断を避けるため重複グループ内の全ファイルを対象とする）。

| 現ファイル名 | 現 `id:` | 現 `status:` | 新ファイル名 | 新 `id:` |
|---|---|---|---|---|
| `ADR-0008-npm-package-asset-allowlist.md` | `ADR-0008` | `proposed` | `ADR-0049-npm-package-asset-allowlist.md` | `ADR-0049` |
| `ADR-0008-test-execution-log-preservation.md` | `ADR-0008` | `proposed` | `ADR-0050-test-execution-log-preservation.md` | `ADR-0050` |
| `ADR-0016-codex-exec-unsupported-flag-as-config-override.md` | `ADR-0016` | `accepted` | `ADR-0051-codex-exec-unsupported-flag-as-config-override.md` | `ADR-0051` |
| `ADR-0016-reconcile-workflow-run-trust-boundary.md` | `ADR-0016` | `accepted` | `ADR-0052-reconcile-workflow-run-trust-boundary.md` | `ADR-0052` |
| `ADR-0016-worktree-cleanup-detection-over-merge-chaining.md` | `ADR-0016` | `proposed` | `ADR-0053-worktree-cleanup-detection-over-merge-chaining.md` | `ADR-0053` |
| `ADR-0039-pr-merge-freshness-check-mergestatestatus-optin-update.md` | `ADR-0039` | `proposed` | `ADR-0054-pr-merge-freshness-check-mergestatestatus-optin-update.md` | `ADR-0054` |
| `ADR-0039-upgrade-stale-file-ownership-record.md` | `ADR-0039` | `proposed` | `ADR-0055-upgrade-stale-file-ownership-record.md` | `ADR-0055` |

各ファイルの再採番は、frontmatter内の `id:` フィールドと、ファイル名中のADR番号の両方を新番号へ揃える（ファイル本文中の見出し・自然文言及に旧番号があれば同時に更新するが、対象7ファイルの本文中に自己参照的な番号表記が無いことを実装時に確認する）。`accepted` の2件（新 `ADR-0051`・`ADR-0052`）についても、`id` は「accepted 後不変」の対象だが、本再採番は通常の内容変更ではなく既存の重複という不整合状態そのものを是正する一度限りの機械的補正であり、ADR自体（本Issueで新規作成する `ADR-0056`）がこの補正の決定・根拠を記録する。

## 参照影響調査

再採番対象7ファイル間、および他ADRの `related_adrs:`（構造化フィールド）から対象7ファイルの `id` への参照は、リポジトリ全体を走査した結果0件だった（対象7ファイル自身の `supersedes`/`superseded-by` もすべて空/`null`）。したがって構造化参照の断線は発生しない。

一方、`docs/adr/` 内の自然文および `docs/` 配下のバレテキストで、ADR番号を直接記載している箇所が4件見つかった。いずれも `ADR-0016-reconcile-workflow-run-trust-boundary.md`（新 `ADR-0052`）のDecision節が言及する `dedicated_app`/`required_workflow` enforcement backend の説明を指しており（他の2つの `ADR-0016` ファイルにはこの語が出現しない）、再採番後は `ADR-0052` へ更新する。

| ファイル | 現在の記載 | 更新後 |
|---|---|---|
| `docs/adr/ADR-0044-ruleset-template-drift-and-dedicated-app-binding-condition.md`（Consequences節、2箇所） | `ADR-0016のDecision節が言及するdedicated_app backend` | `ADR-0052のDecision節が言及するdedicated_app backend` |
| `docs/adr/ADR-0044-ruleset-template-drift-and-dedicated-app-binding-condition.md`（対象外節、1箇所） | `ADR-0016が言及するdedicated_app/required_workflowbackend` | `ADR-0052が言及するdedicated_app/required_workflowbackend` |
| `docs/ASC_GATE_APP_ID_RUNBOOK.md` | `ADR-0016が言及する dedicated_app/required_workflow backend` | `ADR-0052が言及する dedicated_app/required_workflow backend` |

`src/`・`.agent-skill-chain/`（`// Issue #123` 形式のコメントを除く）配下には `ADR-0016`・`ADR-0008`・`ADR-0039` へのハードコード参照は存在しない（実装時に同一のgrep条件で再確認し、AC-4の検証手順に含める）。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0056
    relation: adopts
```

`ADR-0056`（本Issueで新規作成、`status: proposed`）は本設計が採用する決定（ID一意性検査の追加方式・既存重複7件の再採番方針）そのものを記録する。他の既存 `accepted` ADR で本設計の判断に直接影響するものは無い（`docs/adr/ADR-0007-stray-root-artifact-post-merge-cleanup.md` は本Issueの重複発生経路とは無関係な別のroot直下成果物クリーンアップの決定であり、参照の対象としない）。`ADR-0056` は `status: proposed` のため、`adr-lint.sh check` の stale参照検査（`accepted` の ADR のみ許可）が本フィールドを走査対象にした場合は `accepted` 遷移後に整合する（現時点の `collectAdrRecords()`/`checkAdrSymmetry()` は `docs/adr/*.md` のみを走査対象とし `DESIGN.md` の `related_adrs:` は走査対象外であるため、本記載は現状のCIを妨げない）。

## 検出アルゴリズムの設計判断

`lint adr check` はPRごとのCI（`pull_request` トリガ、`strict_required_status_checks_policy: true` によりマージ前にPRブランチがbaseへ追従済みであることを要求）でのみ実行され、main への push 契機のCIジョブは存在しない（既存踏襲、変更しない）。したがって本検査は「同一PR内で2件以上の重複ADRを追加した場合」と「先行PRがmainへマージ済みの状態にPRブランチが追従した後で後続PRのCIが走る場合」の両方を検出できるが、2つのPRが互いの変更を知らないまま並行してmainへマージされる極めて狭い window（strict policyがbaseへの追従を要求するため、通常はこのwindowは各PRのマージ直前に解消される）は本検査単体では防げない。この残余リスクへの対処（mainへのpush契機の追加検査ジョブ新設、ADR番号の予約制など）は本Issueのスコープ外とし、`ADR-0056`のConsequences節にフォローアップとして記録する。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `checkAdrIdUniqueness()` の実装不備により誤検出（false positive）が発生し、重複していない正常な `docs/adr/` に対して `lint adr check` が失敗する。
  - 再採番作業（③実装セグメント）でファイル名変更と `id:` フィールド変更の一方のみを行い、ファイル名とfrontmatterの `id` が不一致になる。
  - `docs/adr/ADR-0044-...md`・`docs/ASC_GATE_APP_ID_RUNBOOK.md` のバレテキスト参照更新を漏らし、`ADR-0052` へ改名した後も旧番号 `ADR-0016` を指したままになる。
- ロールバック手順: 本Issueの全変更は単一PR・単一commit群としてsquash mergeされる。問題が判明した場合は当該PRのmergeコミットを `git revert` すれば、`adr-consistency.ts`/`lint.ts` の変更とファイル名・frontmatter変更の両方が一括で巻き戻る（他Issueのファイルには触れないため副作用は無い）。
- 影響を受ける既存機能: `lint adr check`（CI `adr-lint` ステップ）の挙動のみ。`verify adr <adr_path>`（単一ファイル構造検査）・`adr finalize`（status遷移）・`gate-reconcile.sh`（`approved_artifacts` digest照合）はいずれも `docs/adr/` のファイル一覧やIDの重複検査に依存しておらず、本変更の影響を受けない。
