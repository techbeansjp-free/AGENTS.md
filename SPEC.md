# SPEC: 自己拡張ポリシーの必須資産・追跡規則と実リポジトリを整合させる

- Issue: `ISSUE-245`
- 作成者: `Codex segment worker`
- 対象ブランチ: `process/245-align-self-extension-policy`

## 目的・背景

このリポジトリには project policy の manifest と RULES がなく、project 文書には現ツリーに存在しない `source/` と `runtime/templates/` が参照されている。また、GitHub-native 運用で使うローカル成果物の追跡方針が `.gitignore` と一致していない。このため、規範文書の適用範囲と永続化すべき記録が判断できない。

本 Issue は、このリポジトリ自身を開発する際の有効な project policy、Issue 成果物、記録・close の境界を現行 CLI と GitHub Flow に揃える。

## 要求 → 要件 → 受入条件

### 要求

自己拡張ポリシーの有効な文書・資産・Issue 記録方式を、実在するリポジトリ構成と一意に整合させる。

### 要件

- `.agent-skill-chain/project/manifest.yaml` と `RULES.md` に、このリポジトリで規範として読む project policy を明示する。
- 規範文書から、存在しない `source/`・`runtime/templates/` 資産への参照を除去し、現行の AGENTS.md と `.agent-skill-chain/` 配下アセットへ整合させる。
- GitHub-native の自己拡張 Issue は、GitHub Issue/PR を調整状態の正本とし、branch の root に置く `SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md` を追跡して checkpoint で push する方針にする。
- `.gitignore`、保守者向け文書、隔離した lifecycle テストで、作成・起票後の記録・close の各段階を同じ方針として検証する。

### 受入条件（Acceptance Criteria）

#### AC-1: 有効な project policy が manifest で決まる

- Given: `.agent-skill-chain/project/` に複数の文書がある
- When: 自己拡張作業者が project policy を読む
- Then: `manifest.yaml` がスキーマに適合し、`RULES.md` を含む登録済み文書だけを規範として扱える
- 検証方法見込み: `automated`

#### AC-2: 規範文書は実在する正本のみを参照する

- Given: 現行の package assets に `source/` と `runtime/templates/` がない
- When: 登録済み project policy と保守者ワークフロー文書を検査する
- Then: 存在しない資産を規範として参照せず、現行 CLI・AGENTS.md・`.agent-skill-chain/` の責務と矛盾しない
- 検証方法見込み: `automated`

#### AC-3: GitHub-native の Issue 成果物の追跡方針が一意である

- Given: GitHub Issue に対応する専用 worktree がある
- When: 4 セグメント成果物を作成して checkpoint する
- Then: 成果物は ignore されず branch に commit/push され、GitHub Issue と Draft PR の `Closes #<id>` が恒久的な調整証跡になる
- 検証方法見込み: `automated`

#### AC-4: lifecycle の作成・記録・close が隔離環境で再現できる

- Given: bare remote を持つ隔離 Git リポジトリ
- When: Issue 用 branch/worktree を作成し、成果物を checkpoint し、close 相当の branch 統合を行う
- Then: 作成した成果物と記録は追跡され、close 後も main の Git 履歴から復元できる
- 検証方法見込み: `automated`

## スコープ外

- 過去の `docs/maintainer/workflow/close/` 配下の履歴を新しい形式へ移行すること。
- consumer project の project policy を配布・強制すること。
- GitHub Issue、PR、Check Run の Coordination Backend 自体を変更すること。
