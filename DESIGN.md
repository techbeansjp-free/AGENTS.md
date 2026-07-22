<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: release tagのgit committer identity未設定バグ修正

- Issue: `ISSUE-204`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `tag()` 内、`git tag -a` 実行直前への `ensureGitIdentity(root)` 呼び出し追加 | fallback identityの書き込みは `ensureGitIdentity()` 側の既存ロジックがそのまま担う |
| AC-2 | 既存の `ensureGitIdentity()` / `isIdentityConfigured()`（Issue #198 導入、`bump()` と共有）をそのまま再利用 | `tag()` 内に同等ロジックを新規実装しない。関数自体は変更しない |
| AC-3 | `ensureGitIdentity()` 内部の非破壊ロジック（`isIdentityConfigured()` が真を返す既存identityには書き込まない）を `tag()` からも再利用することで保証 | ロジック自体は変更しないため、既存の非破壊性がそのまま `tag()` にも及ぶ |
| AC-4 | 変更を `tag()` 内の1呼び出し追加のみに限定し、`bump()`・`publish()`・`resolveVersion()` のコードパスを変更しない | 既存テストへの影響範囲を最小化する設計判断 |
| AC-5 | 実装セグメントで `test/integration/release.test.ts` に `tag()` 向けの新規テストを追加（本設計は追加箇所の指定のみ行う） | 実際のテストコード執筆は実装セグメントの責務 |

## 責務・境界

### コンポーネント構成

- `tag()`（`src/commands/release.ts`）: `release tag` サブコマンドの入口。target/refのバリデーション、既存タグの冪等スキップ判定、注釈付きタグの作成・pushを行う。本Issueでは「`git tag -a` 実行前にcommitter identityが解決可能であることを保証する」責務を追加で引き受けるが、その保証の実現手段（identity解決判定・fallback書き込み）は自身では持たず `ensureGitIdentity()` に委譲する。
- `ensureGitIdentity()` / `isIdentityConfigured()`（`src/commands/release.ts`、Issue #198 導入・変更なし）: identity解決判定とfallback書き込みの責務を独占する。`bump()` と `tag()` の双方から呼ばれる共有コンポーネントとなる（本Issueにより利用箇所が1→2に増える）。

責務の分離は明確である。「identityを保証する」という決定ロジックを持つのは `ensureGitIdentity()` のみであり、`tag()` は「保証を要求する」呼び出し元として振る舞うだけで、identity解決の詳細（ローカル/グローバル/システムの解決順、fallback値）を知らない。これにより反証観点「1つのコンポーネントに責務が集中していないか」を満たす。

### 依存関係

```text
tag() → ensureGitIdentity() → isIdentityConfigured() → git config <key>（読み取り、副作用なし）
tag() → ensureGitIdentity() → git config <key> <fallback値>（isIdentityConfigured() が偽の場合のみ、書き込み）
tag() → git tag -a（committer identity解決を要求する）
tag() → git push origin <tag>
```

循環依存なし。`ensureGitIdentity()` は `tag()`・`bump()` のどちらの呼び出し文脈にも依存しない純粋な共有関数であり、呼び出し順の変更（`tag()` 内での呼び出し追加）が既存の `bump()` からの呼び出しに影響しないことは、関数のシグネチャ・内部状態（引数 `root` 以外の状態を持たない）から保証される。

### 呼び出し位置の設計判断

`tag()` 内での呼び出し位置は、「既存タグ検出時の冪等スキップ判定（`git ls-remote --tags`）」より後、「`git tag -a` 実行」の直前とする。理由:

- 冪等スキップ経路（既にタグが存在する場合）ではcommitter identityの解決は不要であり、この経路で `ensureGitIdentity()` を呼ぶと不要なfallback identity書き込み（副作用）を発生させうる。
- `bump()` も同様のパターンを取っており（実際にcommitする分岐 `if (!branchExists)` の内側でのみ `ensureGitIdentity()` を呼ぶ）、「実際にgit操作でcommitter identityを要求する直前でのみ呼ぶ」という既存の設計判断と整合する。

## 関連ADR

本Issueは小さなバグ修正であり、新規ADRは不要（既存 ADR-0005 リリース自動化の枠内での、Issue #198 修正の適用漏れ補完）。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード: `ensureGitIdentity()` が内部で `git config` 書き込みに失敗した場合（例: `.git/config` への書き込み権限がない等の環境異常）、`tag()` は `fail()` 経由で終了コード非0・エラー内容を標準エラー出力へ返す。これは `bump()` の既存の失敗ハンドリングと同一パターンであり、新規の失敗モードを導入しない。
- ロールバック手順: 変更は `tag()` 内の1行相当の呼び出し追加のみであり、当該呼び出しを削除すれば Issue #198 適用前の挙動（`bump()` のみ保護）へ即座に戻せる。`git config` への書き込みはCIランナーのworktreeローカルスコープに限定され、ランナーは実行毎に使い捨てられるため永続的な副作用は残らない。
- 影響を受ける既存機能: `bump()`・`publish()`・`resolveVersion()` は本変更で参照・変更されないため影響なし。`tag()` の冪等スキップ経路（既存タグ検出時）は `ensureGitIdentity()` 呼び出しより前で早期returnするため、この経路の既存挙動（AC-4対象の既存テスト）にも影響しない。
