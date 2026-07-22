<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: リリースworkflowのbumpステップがgit author identity未設定で失敗するバグの修正

- Issue: `ISSUE-198`
- 対応する SPEC: `SPEC.md`

`release bump` サブコマンド（`src/commands/release.ts`）がバージョンbumpコミットを作成する際、実行環境にgit author identity（`user.name`/`user.email`）が未設定だと `git commit` が「Author identity unknown」で失敗する（Issue #196実装後の初回run 29902200805で実際に発生）。本Issueはこの1点のみを修正する。リリース自動化の設計自体（Issue #196・ADR-0005）は変更しない。

## 決定した設計判断

**修正箇所は `release bump` サブコマンドのcommit作成処理そのもの（CLI側）とし、GitHub Actions workflow YAMLへの `git config` ステップ追加は行わない。**

理由は次の3点。

1. **SPEC要件1の文言が「サブコマンド」を名指ししている**: 「`release bump` サブコマンドが実行するbumpコミット作成処理は、実行環境（ローカル・GitHub Actionsランナーいずれも）にgit author identityが未設定であっても `git commit` に成功すること」。workflow YAML側にのみ `git config` ステップを足す修正は、CIランナー経由の実行は救えるが、`release bump` をローカルから直接実行する経路（開発時の動作確認・将来的な手動実行）は依然として未修正のまま残り、要件1の「ローカル・GitHub Actionsランナーいずれも」を満たさない。
2. **既存の統合テストが今回の不具合を再現できていない根本原因を特定した**: `test/helpers/tmp-repo.ts` の `createTmpRepo()` は fixture 構築時に無条件で `git config user.email`/`user.name` を設定している（`test/integration/release.test.ts` はこれを共通土台に使う）。そのため既存テストはCLIの外側（fixtureのテスト土台）でidentityを与えてしまい、「identity未設定」というAC-1の Given を一度も再現できていない。CLI側で対処すれば、AC-1検証用の新しい自動テストはfixtureのidentity設定を意図的に外した上でCLIの成功を直接検証でき、要件1の検証方法見込み（`automated`）を実質的に満たせる。workflow YAML側の修正では、この単体・結合テストレベルの自動検証を構成できない（実際のGitHub Actionsランナー環境を模倣する必要が生じ、`automated` として現実的に検証できない）。
3. **UNIX的な単一責任・重複排除**: 同一のidentity保証ロジックをworkflow YAMLとCLIの両方に置くと、修正箇所が2つに分散し、どちらか一方だけ更新されて再度乖離する回帰リスクを生む。commit作成という単一の状態遷移の中で完結させるのが、AGENTS.md の「各スクリプトはちょうど1つの状態遷移だけを行う」という方針に合致する。

なお、`.github/workflows/agent-skill-chain-release.yml`・`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml` 自体は変更しない（変更が不要なため）。

### fallback identityの具体値と非破壊性（要件2）

`git log --all -p -- '**/release.yml'` で確認したところ、本リポジトリの旧 `release.yml`（削除済み）は一貫して `git config user.name "github-actions[bot]"` / `git config user.email "github-actions[bot]@users.noreply.github.com"` という値を使っていた。この慣例をfallback identityの値としてそのまま踏襲する。

非破壊性（要件2: 既存のidentity設定を上書き・破壊しない）は、次の2点で担保する。

- **設定前に既存値の有無を確認し、既に解決可能な場合は何もしない**: `git config user.name`（`--global` を付けない実効値取得。ローカル→グローバル→システムの順に解決される既定挙動）が非空を返せば「設定済み」とみなし、fallback値を書き込まない。`user.name`/`user.email` は独立に判定する。
- **書き込む場合も `--global` を使わず、実行対象リポジトリのローカル設定のみに書き込む**: 開発者のグローバル `~/.gitconfig` には一切触れない。CIランナーはジョブごとに使い捨てのcheckoutであるためローカル設定で完結し、ローカル開発環境でも対象リポジトリ限定の一時的な補完に留まる。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1 / AC-1 | `ensureGitIdentity()`（新設、`src/commands/release.ts`） | `bump()` 内でcheckout成功後・commit前に呼び出し、未設定時のみfallback identityをローカル設定へ書き込む |
| 要件2 / AC-1 | `ensureGitIdentity()` の設定前チェック（`isIdentityConfigured()`） | 既存値が解決可能なら書き込みをskipし、非破壊を保証する |
| 要件3 / AC-2 | 既存の `bump()` 制御フロー・戻り値・呼び出しシグネチャは変更しない | `ensureGitIdentity()` はcheckoutとcommitの間に副作用（設定確認・必要時のみ書き込み）を追加するのみで、既存の分岐・戻り値・エラーメッセージ文言は変更しない |

## 責務・境界

### コンポーネント構成

- `ensureGitIdentity(root)`（新設関数、`src/commands/release.ts` 内、非公開）: 対象リポジトリの `user.name`/`user.email` が実効的に解決可能かを確認し、いずれか未解決ならfallback値（`github-actions[bot]` / `github-actions[bot]@users.noreply.github.com`）をローカル設定へ書き込む。責務は「commit実行に必要な最小限のidentity保証」のみで、既存identityの上書き判断・commit自体の実行・PR作成・マージ判断は持たない。
- `isIdentityConfigured(root, key)`（新設ヘルパー、同ファイル内）: 指定キー（`user.name`|`user.email`）が `git config <key>` で非空に解決できるかを真偽値で返す。副作用を持たない読み取り専用の判定のみ。
- `bump()`（既存、変更対象は呼び出し順序のみ）: `git(['checkout', '-b', branch], root)` 成功直後、`writeBumpedVersionFiles()`／`git add`／`git commit` より前に `ensureGitIdentity(root)` を呼び出す。それ以外の分岐・エラーハンドリング・戻り値は変更しない。

### 依存関係

```text
bump() → ensureGitIdentity(root) → isIdentityConfigured(root, 'user.name' | 'user.email')
                                  → （未解決時のみ）git config user.name / user.email（ローカル設定への書き込み）
bump() → writeBumpedVersionFiles() → git add → git commit
```

`ensureGitIdentity`／`isIdentityConfigured` は既存の `git()` 実行ラッパー（`src/lib/exec.ts`）のみに依存し、`bump()` の他の分岐（ブランチ既存チェック・PR作成・スコープ検査・admin merge）には影響しない一方向の追加である。循環依存はない。

## 関連ADR

本Issueは実装の抜け漏れ（Issue #196で実装したリリース自動化が、GitHub Actionsランナー上でgit author identity未設定という実行環境条件を考慮していなかったこと）の修正であり、恒久的なアーキテクチャ判断を新たに行うものではない。Issue #196の既存設計判断（ADR-0005）を変更しないため、本Issueで新規ADRは作成しない。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `ensureGitIdentity()` 自体が失敗する可能性は、`git config` の書き込みが対象worktreeが書き込み不可（権限問題等）の場合に限られる。この場合 `git commit` も同様の権限問題で失敗するため、修正前後で失敗モードの性質は変わらない（新規の失敗経路を追加しない）。
  - 既にidentityが設定済みの環境（開発者のローカル環境、または将来 workflow 側で別途identityを設定するケース）では `isIdentityConfigured()` が真を返し `ensureGitIdentity()` は何も書き込まないため、既存の挙動・commit authorは変化しない。
- ロールバック手順: `bump()` 内の `ensureGitIdentity(root)` 呼び出し1行と、新設した2関数を削除するのみで、Issue #196時点の挙動に戻せる。他コンポーネント（タガー・リリーサ・トリガ層）への波及は無い。
- 影響を受ける既存機能・整合性上の留意点:
  - `test/integration/release.test.ts` が使う `createTmpRepo()`（`test/helpers/tmp-repo.ts`）は fixture 構築時に既に `git config user.email`/`user.name` を設定済みのため、`isIdentityConfigured()` は常に真を返し、既存の `release bump` 系テストの挙動・アサーションは変更されない（要件3・AC-2）。
  - AC-1の自動検証には、`createTmpRepo()` とは別に「identity未設定のリポジトリ」を用意する新規テスト経路が実装セグメントで必要になる（例: 別途 identity を unset した一時repoで `release bump` を実行し、成功することを確認する）。この新規テストの追加自体は本設計の範囲内（テストコードの追加）であり、`createTmpRepo()` 自体の既定挙動（既存テスト群が依存する「identity設定済み」の前提）は変更しない。
