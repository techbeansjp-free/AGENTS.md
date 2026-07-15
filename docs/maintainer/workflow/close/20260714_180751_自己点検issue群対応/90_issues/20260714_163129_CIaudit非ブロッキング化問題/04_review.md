---
document_id: "b3f6d9a2-4c8e-4a1f-9d5b-6e2a8c4f1d97"
issue_id: "c0373076-361d-430f-b825-a2a14bc3e3d3"
review_id: "e7a4c9d1-2f5b-4e8a-a3c6-9d1f4b8e2a56"
---

# レビュー: CI audit の非ブロッキング化問題（最終保証層の形骸化）

**作成日**: 2026年07月14日

---

## 1. 実装内容の確認

- `.agent-skill-chain/source/enforcement/README.md`: 「ツール別強制力マトリクス」の解説直後（旧 §104 相当）に、本リポジトリ（自己拡張・ドッグフーディング環境）向けの暫定例外への参照文を1件追加。詳細は自己拡張ワークフロー.md へ委譲し重複記載していない。
- `.agent-skill-chain/project/自己拡張ワークフロー.md`: 「### 3. 本リポ CI（self-enforce.yml）への PR_BODY 配線」の直後に「### 3.5 audit step 全体の非ブロッキング運用（意図的な暫定状態・申し送り）」を新設。既存の #36 限定の記載（§3）とは独立に、audit step 全体の非ブロッキング運用の理由（issue 配置場所の差異・workflow.db の CI 非追跡）と解消条件（workflowDB非追跡問題の解消後に再判断）を明記した。
- `.github/workflows/self-enforce.yml`: step 7（Enforcement audit）のコメントに2行追加。`continue-on-error: true` および呼び出しコマンドの機能行は無変更。
- `00_要求定義.md`: frontmatter `branch` を実ブランチ（`worktree-agent-af7ecb3e0293b1902`）に更新、§9 に対応方針確定内容を追記。

## 2. 受け入れ基準の確認（01 対応）

| # | 基準 | 検証方法 | 結果 |
|---|---|---|---|
| 1 | README.md に暫定例外への参照がある | `grep -n "本リポジトリ（自己拡張" enforcement/README.md` | PASS（105行目に追加を確認） |
| 2 | 自己拡張ワークフロー.md に理由・解消条件・申し送りがある | 該当節（3.5）を目視確認 | PASS |
| 3 | self-enforce.yml の機能（continue-on-error・呼び出しコマンド）が不変 | `git diff` で該当 step の実行行（`continue-on-error: true`／`run:` 以下）に変更がないことを確認 | PASS（コメント2行の追加のみ） |
| 4 | audit.sh 本体が無変更 | `git diff --stat -- .agent-skill-chain/source/enforcement/ci/audit.sh` | PASS（差分なし） |
| 5 | YAML 構文が壊れていない | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/self-enforce.yml'))"` | PASS（YAML OK） |
| 6 | コメント外部参照禁止 blocking step を壊さない | `bash .agent-skill-chain/source/enforcement/ci/check-comment-refs.sh .github/workflows` | PASS（exit 0） |

## 3. 設計・境界の確認

- 責務分離（README.md＝一般原則の正本／自己拡張ワークフロー.md＝本リポ固有具体の正本）を維持し、詳細の重複記載をしていない（02_設計 §1 の方針どおり）。
- audit.sh のチェックロジックは変更していない（00 §5 除外要件を満たす）。
- 対象ファイルの範囲（self-enforce.yml・enforcement/README.md・自己拡張ワークフロー.md・00〜04）を超える変更は行っていない。

## 4. レビュー結果（敵対的観点・must-preserve）

### 敵対的観点（この変更で見落としがちな失敗パターン）

1. **「文書を直しただけで本質的な問題は放置ではないか」**: 妥当な指摘。真のブロッキング化は workflow.db の CI 非追跡問題（別課題）の解消に依存するため、今回は文書整合のみを対応範囲とした。これは 00 の要求（§6 成功基準が「ブロッキング化 or 文書明記」のいずれかで満たされる設計）および、ユーザーが事前に示した判断材料（即時ブロッキング化は既存 PR フローを不必要に止めるリスクが高い）に沿った意図的な選択であり、放置ではなく明示的な申し送りとして記録済み。
2. **README.md と自己拡張ワークフロー.md の記載が将来ドリフトしないか**: README.md 側は「詳細は参照」に留め、具体の理由・解消条件は自己拡張ワークフロー.md 1か所に集約したため、二重更新の必要がある箇所は最小化されている。
3. **self-enforce.yml のコメント追記が check-comment-refs.sh の blocking step を壊していないか**: 実行して確認済み（exit 0）。ドキュメント名・章節番号・issue パス・追跡番号は含めていない。
4. **frontmatter の branch 記録が実際のブランチと一致しているか**: `git branch --show-current` で確認した実ブランチ名 `worktree-agent-af7ecb3e0293b1902` と一致させた。

### must-preserve（今回の変更で壊してはならないもの・維持確認済み）

- `audit.sh` のチェックロジック・終了コード契約は無変更。
- `self-enforce.yml` の他 step（1〜6, 6.5, 8）の機能・順序は無変更。
- `check-comment-refs.sh` による blocking 検知（step 8）は引き続き有効（実行して PASS を確認）。
- README.md ・自己拡張ワークフロー.md の既存節（#36/PR_BODY 関連等）の記載内容は変更せず、新設・追記のみで対応した。

## 5. 証跡・テスト実行結果

- `bash .agent-skill-chain/source/enforcement/ci/check-comment-refs.sh .github/workflows` → exit 0（違反なし）
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/self-enforce.yml'))"` → YAML OK
- `git diff --stat -- .agent-skill-chain/source/enforcement/ci/audit.sh` → 差分なし
- 本リポジトリには workflow.db が採用・追跡されていない（`find` で不在確認）ため、write-workflow-log（workflow.db 本則）による追加記録は本 issue では対象外。証跡は本 04_review.md および git 差分そのものとする。

## 6. 完了判定

- 00 §6 成功基準（ブロッキング化 or 文書明記による矛盾解消）を「文書明記」で達成。
- 01 の受け入れ基準 6 件すべて PASS。
- 対象ファイル範囲外（`90_issues.md` 含む）への変更なし。
- **完了**。次工程はコミット・push・PR作成。
