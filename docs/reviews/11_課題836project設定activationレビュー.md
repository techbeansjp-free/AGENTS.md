# 課題836 project設定activationレビュー

> 状態: `ready-for-pr`。基盤PR #838がmainへmergeされ、default branchのtrusted validatorが新入力文法を所有したため、比較基点をmerge済みdefault branch headへ更新して本artifactを再固定した。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `7e5a7de9bc271db165fb7a65bedba4663910dc06` |
| H_impl | `ba6de95b7b19df977a2056848b053864dc404067` |
| H_impl tree | `02d89d43ed808bc0a99290f6146fdc640bfd1f4a` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| PR作成 | 許可。#838と#841がmain `7e5a7de9bc271db165fb7a65bedba4663910dc06`へmerge済みで前提を満たす |

基盤で追加した前方互換schema、validator、runtimeを使い、本repositoryのprovider mappingと構造化`modelMapping`を有効化する。mappingは具体的model slugや手動rankを持たず、Codex公式`model/list`のrecommended defaultを選択元とする。

## 開発考慮事項

| ID | 考慮事項 | 判定 | 理由 | 要求・確認証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | providerとevidence保存先をproject設定する | 秘密fieldなし、repository相対store root |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | mapping versionとrole設定をrouting evidenceへ使う | versioned mapping、保持上限、停止条件 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | applicable | 未有効・解決不能をCLI利用者へ明示する | structured diagnostic、pending状態 |
| DC-TOKENS | Design System・Design/Layout Token契約 | not-applicable | JSON project設定だけの変更で視覚componentを持たない | UI source変更なし |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/project-policy.json` | M | repository maintainer | project manifest | provider mapping fragmentを完全inventoryへ登録 | manifestからprovider fragmentへの片方向参照 | FR-836-03、AC-836-12 | base validator対応後だけ有効化し、登録行だけrevert可能 | pass |
| `.agent-skill-chain/project/choices/development.json` | M | repository maintainer | project choice | role、論理tier、high、標準速度、implementer不在時fallback、保持方針を構造化 | choiceからrouting domainへの入力だけを供給 | FR-836-01・05・15・19、AC-836-01・05・11・24 | legacy文字列へ戻せばrouting未有効状態へ復帰 | pass |
| `.agent-skill-chain/project/conformance/bindings.json` | M | repository maintainer | project conformance | mappingをownership境界I2のsourceへ追加 | project mappingから既存enforcementへの片方向参照 | AC-836-02・12、SCN-INT-ROUTING-005 | binding行だけを戻して基盤契約を保持可能 | pass |
| `.agent-skill-chain/project/providers/capability-mapping.json` | A | mapping owner | project mapping | Codex coding能力と公式推奨選択元を版付き宣言 | model slug・rankなしでprovider観測へ入力 | FR-836-03・04、AC-836-02〜04・13 | candidate自己適用せず、fragment単独削除でrollback可能 | pass |

Gitの`7e5a7de9bc271db165fb7a65bedba4663910dc06..ba6de95b7b19df977a2056848b053864dc404067`に含まれる4 pathと表の4行は重複なし・欠落なしで一致する。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ・整合性 | pass | manifest、choice、binding、mappingの4資産が基盤schema・runtimeと一致 |
| 保守性 | pass | model slugと手動rankを保存せず公式recommended defaultへ追従 |
| authority・安全性 | pass | activation candidate自身ではなく基盤H_finalをevaluatorRefに指定してdogfood |
| rollback | pass | legacy文字列とproviderFiles未登録状態へ4ファイルだけで復帰可能 |

## テスト結果

| 層・検査 | コマンド | 成功 | 失敗 | 判定 |
|---|---|---:|---:|---|
| project設定 | `npm run project:quality` | 1 | 0 | pass |
| 型・形式 | `npm run typecheck`、`npm run format:check` | 2 | 0 | pass |
| 実Codex dogfood | `routing resolve` | `preferred` routeで`codex` / `gpt-5.6-sol` / high / `default`へresolved | 0 | pass |
| 全BDD | `npm test` | 299 | 0 | pass |
| 配布・追跡・監査 | `npm run build`、`docs:format`、`test:format`、`trace:check`、`architecture:check`、`conformance:check`、`audit:check`、`package:check` | 8 | 0 | pass |

final gateは本artifactだけを追加したH_finalで再実行し、結果を上表へ反映済みである。

再固定時に1件のblocking findingを是正した。merge済み基盤の`validateModelMapping`は`modelMapping.fallback`を必須とするが、再固定前のactivation設定は同fieldを持たず`source:check`が`canonical project policy setが不正です`で停止した。Issue #836本文のINV-06とPR #838の明示fallback契約に従い、`when: implementer_unavailable` / `role: coordinator` / `modelSelection: project_default`を追加して解消した。silent fallbackではなく、Codex不在時にcoordinatorのproject defaultへ切り替える明示設定である。

## 停止点

- project設定activationのH_impl: `ba6de95b7b19df977a2056848b053864dc404067`。
- 基盤PR #838とproject choice差分分類PR #841: main `7e5a7de9bc271db165fb7a65bedba4663910dc06`へmerge済み。CIはいずれもgreenであった。
- activation PR: 前提を満たしたため作成する。mergeはCIとreviewの外部証拠が揃った時点で別操作として行う。
- release、branch削除、worktree cleanup: 本Issueの終了処理では実施しない。

H_finalはこのreview artifactだけを追加するcommitとし、以後このtracked artifactを変更しない。
