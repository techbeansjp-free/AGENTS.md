# ADR

```yaml
id: ADR-0004
status: proposed   # proposed | accepted | superseded | deprecated
title: 基準ディレクトリ解決を「共通作業ツリー」と「現在の worktree」の2責務へ分離する
tags: [paths, worktree, coordination, git]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`src/lib/paths.ts` の `repoRoot()` は、起点から祖先方向へ辿り `.git` エントリを持つ最初のディレクトリを対象リポジトリのルートとして返す。判定に `.git` の**種別**を区別しない fs 存在チェックを用いていたため、git worktree では各 worktree のルートが `.git` を**ファイル**（`gitdir:` ポインタ）として持つ点を見落とし、worktree 内から呼ぶと worktree 自身のパスを返していた。

ローカルバックエンドの coordination 状態（`issues/<n>/.agent-skill-chain/` 配下の state・lease・reviews・reports）はすべて `repoRoot()` 基点の相対パス（`src/lib/local-state.ts`）で解決される。このためワーカーが自 worktree 内から `report status`／`lease acquire` 等を実行すると状態ファイルが worktree 内へ分裂して書かれ、メインの作業ツリーで動く進行役・`launch_worker` の完了確認から不可視になり、実際には完走したワーカーを `blocked` へ誤フェイルセーフしていた。

一方で `repoRoot()` を無条件にメイン作業ツリーへ向けると、`repoRoot()` を「現在の作業ツリーに対する mutating な git 操作の cwd」として使う箇所（`src/commands/checkpoint.ts` の `git add`/`commit`/`push`）が、ワーカーの自 branch ではなくメイン作業ツリー（別 branch）を誤って commit/push する重大 regression を招く。つまり「基準ディレクトリ」には性質の異なる2責務——(1) リポジトリ同一性・coordination 状態の基点、(2) 現在の作業コピーへの操作対象——が混在していた。これはパス解決の恒久的な設計軸であり、今後の新規コマンド・新規アダプタが一貫して honor する必要がある。

## Decision

基準ディレクトリ解決を2つの関数へ明示的に分離する。

- **`repoRoot()` = 共通（メイン）作業ツリールート**: coordination 状態・アセット解決・リポジトリ同一性の基点。worktree 内から呼んでもメイン作業ツリールートを一貫して返す。`.git` がディレクトリなら従来どおりそのディレクトリを返し（通常経路・regression ゼロ）、`.git` がファイル（linked worktree）のときのみ `git rev-parse --path-format=absolute --git-common-dir` の親（git 失敗時は `.git`＋`commondir` パース）でメイン作業ツリーへ解決する。`.git` 皆無は従来どおり明示エラーで停止する。
- **`worktreeRoot()` = 現在の worktree ルート**: 作業コピーへの mutating な git 操作（commit/push 等）の cwd。`git rev-parse --show-toplevel` で現在いる作業ツリーのルートを返す（修正前 `repoRoot()` の返り値と等価）。`checkpoint.ts` はこれを用いる。

原則: **coordination／リポジトリ同一性は `repoRoot()`（共通作業ツリー）で、作業コピーへの mutating な git 操作は `worktreeRoot()`（現在の worktree）で解決する。** 新規コードはこの区別に従い、どちらの基点を要するかを明示的に選ぶ。coordination 状態の配置規約（`src/lib/local-state.ts`）自体は変更せず、基点の解決だけを本原則に従わせる。

## Consequences

- 利点: worktree 内から書いた coordination 状態がメイン作業ツリー側と同一実体を指すようになり、`launch_worker` が worktree 内ワーカーの完了報告を正しく検知できる（誤 `blocked` の解消）。通常リポジトリでの `repoRoot()` は種別判定のディレクトリ分岐に入り返り値・探索ロジックとも不変で、git バイナリも呼ばない高速パスを保つ（regression の面積が worktree 分岐に限定される）。2責務の分離により、今後の呼び出し箇所が基点選択を誤りにくくなる。
- 欠点・フォローアップ: worktree 分岐で git バイナリ（`--path-format=absolute` は git 2.31+）へ依存する。緩和は `.git`＋`commondir` の純 fs パースへのフォールバックと、解決不能時の明示エラー（silent な誤値を返さない）。新規コマンドは `repoRoot()`／`worktreeRoot()` の選択を意識する必要がある——「commit/push 等、現在の作業コピーを変える操作は `worktreeRoot()`、それ以外の coordination・同一性は `repoRoot()`」を判断基準とする。将来のアダプタ（codex 等）も本原則を踏襲する。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。
