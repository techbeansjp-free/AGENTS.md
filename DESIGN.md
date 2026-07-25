# DESIGN: 自己拡張ポリシーの必須資産・追跡規則と実リポジトリを整合させる

- Issue: `ISSUE-245`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `project/manifest.yaml` と `project/RULES.md` | manifest が登録文書を限定する |
| AC-2 | project 文書と `docs/maintainer/workflow/README.md` の再記述 | 実在する現行アセットだけを説明する |
| AC-3 | `.gitignore` と自己拡張運用文書 | root の4成果物を追跡対象として明示する |
| AC-4 | `test/integration/self-extension-policy.test.ts` | bare remote を持つ隔離 repo で lifecycle を実行する |

## 責務・境界

### コンポーネント構成

- `project/manifest.yaml`: このリポジトリで規範として読み込む project 文書の機械可読な一覧。
- `project/RULES.md`: manifest の対象文書に共通する、自己拡張時の追加規約。
- `project/自己拡張ワークフロー.md`: GitHub Issue、専用 branch/worktree、4 セグメント成果物、PR、merge/close の具体的な運用。
- `.gitignore`: transient なローカル設定だけを無視し、4 セグメント成果物を無視しない宣言。
- lifecycle test: policy 文書の主張を、隔離 Git repository の commit/push/merge で検証する。

### 依存関係

```text
AGENTS.md + config/schemas → manifest/RULES → self-extension workflow
                                       ↓
                            .gitignore + lifecycle test
```

## 関連ADR

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード: manifest に未登録の文書を規範として扱い、再び運用が分裂する。
- ロールバック手順: 本 Issue の commit を revert すれば、文書・ignore 規則・テストを一貫して元へ戻せる。
- 影響を受ける既存機能: 自己拡張の保守手順と package repository 上の開発者向け文書のみ。consumer project の配布アセットは変えない。
