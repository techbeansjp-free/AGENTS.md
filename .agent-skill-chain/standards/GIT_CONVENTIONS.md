# Git 規約

> 正本: `AGENTS.md` §ブランチ・worktree / `memo/システム刷新/システム刷新.md` §A-5
>
> 本ファイルは人間向けの説明文書である。**値（正規表現・タイムスタンプ書式・許可 type 一覧等）の正本は `config/agent-skill-chain.yaml`。** 値を変更したい場合は本ファイルではなく `config/agent-skill-chain.yaml` を更新すること。本ファイルに数値・正規表現をハードコードして二重管理にしない。

## 配置・命名規則の4層構造

ブランチ・worktree の配置・命名規則の管理は、責務ごとに 4 層へ分離する。

| 層 | 役割 | 実体 |
|---|---|---|
| 1. 人間向け説明 | 規約の意図・理由を人間に説明する | 本ファイル（`standards/GIT_CONVENTIONS.md`） |
| 2. 設定値・正規表現 | 命名パターン・許可 type・タイムスタンプ書式などの値の正本 | `config/agent-skill-chain.yaml` |
| 3. 正しい名前の生成 | Issue 起票時に規約に従ったブランチ名・worktree パスを機械的に生成する | `scripts/issue-start.sh` |
| 4. 検査・強制 | 生成された（または人手で作られた）ブランチ名・worktree パスが規約に適合するかを CI 等で検査する | `ci/verify-branch-name.sh` / `ci/verify-worktree-path.sh` |

新しい規則を追加・変更する場合も、この4層の役割分担を崩さないこと（例: 値を本ファイルに直接書き足さない、検査ロジックを `issue-start.sh` に混ぜない）。

## ブランチ命名規則

```text
<type>/<issue-id>-<slug>

type: feature | bugfix | hotfix | refactor | docs | process
例:    feature/123-user-authentication
```

- `type` は `config/agent-skill-chain.yaml` の `issue.allowed_types` に列挙された値のみを許可する。
- `#` は含めない（`feature/#123-...` のような記法は不可）。
- Issue との紐付けはブランチ名自体では行わず、Draft PR 本文の `Closes #<issue-id>` によって行う。

## worktree パス規則

```text
.worktrees/<YYYYMMDD_HHMMSS>-<type>-<issue-id>-<slug>/
例:        .worktrees/20260719_031520-feature-123-user-authentication/
```

- タイムスタンプは **Issue 起票日時**（Asia/Tokyo）であり、worktree を実際に作成した日時ではない。
- worktree を削除して同じ Issue から再作成した場合も、同じ Issue 起票日時を使う限り同じパスが再現される。これにより「このパスはどの Issue のものか」を後から機械的に復元できる。
- worktree 作成後に、当該 Issue の種別（`type`）や slug が変更されても、既存の worktree パス・ブランチ名は変更しない。現在の正しい分類は Issue（または `state.yaml`）側が保持し、パス自体は不変のまま扱う。

## worktree の正本

worktree の正本は `git worktree list --porcelain` の出力であり、`.worktrees/` 配下のディレクトリ走査ではない。ディレクトリの存在有無だけでは、Git 管理外の残骸や手動コピーと正規の worktree を区別できないため、必ず `git worktree list --porcelain` を通じて実体を確認すること。

## worktree の削除

worktree を直接 `rm -rf` で削除してはならない。削除は必ず `scripts/cleanup.sh` 経由で行う。`cleanup.sh` は削除前に以下を検査する。

1. 当該 Issue に有効な writer lease が存在しないこと
2. worktree 内に未 commit の変更が無いこと
3. 未 push の commit が無いこと
4. 対応する PR / Integration Record が完了済み（`merged` または `closed`）であること

すべての条件を満たした場合にのみ、`git worktree remove` を実行し、続けて `git worktree prune` で参照を整理する。いずれかの条件を満たさない場合は削除を中断し、理由を報告する。
