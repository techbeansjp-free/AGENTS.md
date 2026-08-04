# PLAN: GitHubモードで成果物全文をIssue/PR本文へ転記するissue_syncのMVP実装

- Issue: `ISSUE-354`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素を、実際に本Issueのcommit（`df75ddb1`）内で行った順序どおりに記述する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | ADR-0021の起票とAGENTS.md改定 | `docs/adr/ADR-0021-github-issue-sync-full-text-content-canonical.md`を`status: proposed`で新規作成し、I1・I3・Coordination Backend表を条件分岐形式へ改定する（`AGENTS.md`） | `D-1` | なし |
| 2 | config/schemaへ`issue_sync`を追加 | `.agent-skill-chain/config/agent-skill-chain.yaml`へ`issue_sync`セクション（`enabled: false`既定）を追加し、`.agent-skill-chain/schemas/config.schema.yaml`へ対応するスキーマ定義（top-level requiredには含めない任意項目）を追加する。`src/lib/config.ts`の`AgentSkillChainConfig`型へ`issue_sync?`を追加する | `D-2, D-5` | `#1` |
| 3 | `issue-sync.ts`本体の実装 | `src/lib/issue-sync.ts`を新規作成し、マーカー定数・`renderSyncBlock`/`extractSyncBlock`/`replaceSyncBlock`・`selectUniqueOpenPr`・`collectGateStates`/`collectArtifacts`・`readBody`/`writeBody`・`writeWithConflictDetection`・エントリポイント`syncGateArtifacts`を実装する | `D-3, D-4-1, D-4-3, D-4-4` | `#2` |
| 4 | `gate.ts`への統合 | `src/commands/gate.ts`の`publish()`内、Check Run発行成功直後に`syncGateArtifacts()`を`try/catch`で囲んで呼び出し、返却された警告文字列を`process.stderr`へ出力する。例外時もpublish自体の戻り値には影響させない | `D-3` | `#3` |
| 5 | テスト用stub拡張 | `test/helpers/gh-stub.ts`へIssue/PR本文の読み書き・open PR一覧・同時書込みシミュレーション（`simulateConcurrentBodyWrites`）を追加し、`test/helpers/tmp-repo.ts`へ`issue_sync`設定を注入する`setIssueSync`ヘルパーを追加する。実GitHub APIへは一切アクセスしない | `D-3, D-4-1, D-4-3, D-4-4` | `#3` |
| 6 | 統合テストの追加 | `test/integration/issue-sync.test.ts`を新規作成し、(a) 既定`enabled: false`では本文が一切変更されないこと、(b) 有効時にマーカー区間へ全文が書かれ人間記述部分が保持されること・再転記で本文が増殖しないこと、(c) 対象PRが0件/複数件でのスキップ、(d) 対象PRが一意な場合の転記、(e) 競合検知時のスキップ、(f) 本文上限超過時の縮退、をそれぞれ検証する | `D-2, D-3, D-4-1, D-4-3, D-4-4` | `#4, #5` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

なお本Issueでは、design-gate通過後にverify-artifacts CI（PR差分に`docs/adr/*`が含まれることで`design`セグメントが検出され、`DESIGN.md`・`PLAN.md`の存在が必須成果物として要求される検査）の失敗を受け、本ファイルおよび`DESIGN.md`をコード実装（`#1`〜`#6`）の完了後に追加commitとして作成した。これは実装順序自体の変更ではなく、実施済みの設計・実装内容をDESIGN.md/PLAN.mdへ事後的に記述したものである。
