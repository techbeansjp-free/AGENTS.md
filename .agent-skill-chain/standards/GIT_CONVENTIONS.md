# Git 規約

> 正本: `AGENTS.md` §ブランチ・worktree
>
> 本ファイルは人間向けの説明文書である。**値（正規表現・タイムスタンプ書式・許可 type 一覧等）の正本は `.agent-skill-chain/config/agent-skill-chain.yaml`。** 値を変更したい場合は本ファイルではなく `.agent-skill-chain/config/agent-skill-chain.yaml` を更新すること。本ファイルに数値・正規表現をハードコードして二重管理にしない。

## 配置・命名規則の4層構造

ブランチ・worktree の配置・命名規則の管理は、責務ごとに 4 層へ分離する。

| 層 | 役割 | 実体 |
|---|---|---|
| 1. 人間向け説明 | 規約の意図・理由を人間に説明する | 本ファイル（`.agent-skill-chain/standards/GIT_CONVENTIONS.md`） |
| 2. 設定値・正規表現 | 命名パターン・許可 type・タイムスタンプ書式などの値の正本 | `.agent-skill-chain/config/agent-skill-chain.yaml` |
| 3. 正しい名前の生成 | Issue 起票時に規約に従ったブランチ名・worktree パスを機械的に生成する | `.agent-skill-chain/scripts/issue-start.sh` |
| 4. 検査・強制 | 生成された（または人手で作られた）ブランチ名・worktree パスが規約に適合するかを CI 等で検査する | `.agent-skill-chain/ci/verify-branch-name.sh` / `.agent-skill-chain/ci/verify-worktree-path.sh` |

新しい規則を追加・変更する場合も、この4層の役割分担を崩さないこと（例: 値を本ファイルに直接書き足さない、検査ロジックを `issue-start.sh` に混ぜない）。

## ブランチ命名規則

```text
<type>/<issue-id>-<slug>

type: feature | bugfix | hotfix | refactor | docs | process | chore
例:    feature/123-user-authentication
```

- `type` は `.agent-skill-chain/config/agent-skill-chain.yaml` の `issue.allowed_types` に列挙された値のみを許可する。
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

worktree を直接 `rm -rf` で削除してはならない。削除は必ず `.agent-skill-chain/scripts/cleanup.sh` 経由で行う。`cleanup.sh` は削除前に以下を検査する。

1. 当該 Issue に有効な writer lease が存在しないこと
2. worktree 内に未 commit の変更が無いこと
3. 未 push の commit が無いこと
4. 対応する PR / Integration Record が完了済み（`merged` または `closed`）であること

すべての条件を満たした場合にのみ、`git worktree remove` を実行し、続けて `git worktree prune` で参照を整理する。いずれかの条件を満たさない場合は削除を中断し、理由を報告する。

## PR マージと main worktree の同期

進行役が PR をマージする際は、`gh pr merge` を直接呼び出すのではなく、`agent-skill-chain pr merge`（`.agent-skill-chain/scripts/pr-merge.sh` はその薄いラッパー）を使うこと。使い方・オプション（`--squash` / `--admin` / `--delete-branch` 等）は `gh pr merge` と同一で、そのまま透過的に渡せる。

理由: `gh pr merge` はマージするだけで、進行役の main worktree（default branch をチェックアウトしている共通作業ツリー）のローカルブランチを更新しない。短時間に複数 PR を連続マージすると、ローカル `main` が古いまま取り残され、以下 2 つの実害が発生する。

1. 後続 PR の CI（例: `git fetch origin "$BASE_REF" --depth=1` を使う検査）が stale な base に対して「no merge base」等で恒久的に失敗する。
2. 進行役自身が古いビルド済み `bin/agents-md.js` のまま `doctor` 等を実行し、誤った（古い）判定結果を得る。

`agent-skill-chain pr merge` は `gh pr merge` 成功後に、main worktree に対して `git fetch origin <default-branch>` と fast-forward マージ（`git pull --ff-only` 相当）を自動実行し、この乖離を都度解消する。main worktree が default branch をチェックアウトしていない・fast-forward 不能なコンフリクトがある等で同期に失敗した場合は、マージ結果自体は巻き戻さず、非 0 終了コードと日本語のエラーメッセージで手動対応を促す。

## PRマージの実行主体（`merge.autonomous`）

`agent-skill-chain pr merge` コマンド自体によるPRマージの既定は、人間の明示的な確認を経ることである。`.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.autonomous` が `true`（明示的な opt-in）でない限り、`pr merge` は実際の `gh pr merge` 実行を一切行わず、日本語のエラーメッセージで停止する。このメッセージは「設定変更が必須」を意味するのではなく、次の2つの経路のいずれかを進行役へ促すものである。

1. その場で人間にこのPRをマージしてよいか確認する。人間が承認すれば、`gh pr merge` を人間が直接実行するか、進行役が代行してよい（`pr merge` コマンド自体は拒否したままでよく、`gh pr merge` を直接呼ぶことは制限しない）。
2. 複数PRにわたる自走的なマージ運用が既に人間から包括的に許可されている場合は、`merge.autonomous: true` を設定することで、以後 `pr merge` コマンド自体でもマージできるようにする。

`autonomy: gated | full`（レビュー厳格度の制御、AGENTS.md §不変条件I8）とは完全に独立した別軸であり、混同しない。`merge.autonomous` はマージ実行主体（誰が `gh pr merge` を呼ぶか）だけを制御する。

## 実装セグメント着手の人間確認（`human_confirmation.before_implementation`）

`merge.autonomous` と同じ精神の独立した opt-in で、`segment start <issue_id> implementation`（`.agent-skill-chain/scripts/worker-launch.sh` 経由の全アダプタが対象）による実装セグメント着手を制御する。`.agent-skill-chain/config/agent-skill-chain.yaml` の `human_confirmation.before_implementation` が明示的に `false` でない限り（既定は未設定＝要求する）、role_contract を返す前に日本語のエラーメッセージで停止し、経路は「PRマージの実行主体」節の1・2と同型（その場で人間へ確認する、または包括的な許可が既にある場合は設定へ明示する）。真偽の極性が `merge.autonomous` と逆であることに注意（本フィールドは「確認要否」、`merge.autonomous` は「自動実行の許可」）。spec/design/validation セグメントはこのゲートの対象外。設定方法の実用リファレンスは README.md の「自走・承認ポリシー」節。
