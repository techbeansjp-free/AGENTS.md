# プロジェクト固有ルール（.agent-skill-chain/project/）

このディレクトリには、**プロジェクトごとの固有ルール**を配置する。

## 本パッケージを「配布テンプレート」として編集している場合

**汎用版の仕様本文**（全採用先に共通する規約）は **`../.agent-skill-chain/source/`** に置く。例: カバレッジ例外の**方針・台帳の列定義・言語別マーカ**の正本は [`../.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md`](../source/COVERAGE_AND_EXCEPTIONS.md)。採用先では、そのファイルの **第3章の台帳テンプレート** をここ（または `docs/`）に**コピー**して、プロジェクト固有の例外行を追記する。

## 目的

- **テンプレートはそのまま使う**: `.agent-skill-chain/source/` 配下の規約ファイル（[`RULES.md`](../source/RULES.md) 等）は汎用テンプレートとして変更せず、コピーしたまま利用する。
- **固有ルールはここに追加**: プロジェクト固有の規約（開発環境の起動方法、テスト実行方法、フレームワークのベストプラクティス、命名規則など）は、この `.agent-skill-chain/project/` 配下にファイルとして作成する。
- **運用を楽にする**: テンプレートの更新を取り込んでも、プロジェクト固有の記述がテンプレートに混ざらないようにする。`.agent-skill-chain/source/` と分離することで扱いやすくする。

## 優先順位

**`.agent-skill-chain/project/` 配下のルールが `.agent-skill-chain/source/` のルールより優先される。**

- 同名または同目的のルールがある場合: **`.agent-skill-chain/project/` のファイルを採用**する。
- `.agent-skill-chain/project/` に該当ファイルがない場合: `.agent-skill-chain/source/` の標準ルールに従う。

参照順序の例:

1. まず `.agent-skill-chain/project/` に該当するファイルがあるか確認する。
2. あればその内容に従う。
3. なければ `.agent-skill-chain/source/` の標準ルール（[`RULES.md`](../source/RULES.md) 等）に従う。

## 配置例

採用先プロジェクトで次のようなファイルを用意する場合、このディレクトリに置く（下記 2 つは**あくまで一例のファイル名**であり、実在必須のファイルではない。本リポジトリでの実在ファイルは下記 project 配下ファイル索引 を参照）。

- `プロジェクト固有.md` - プロジェクト固有の規約（開発環境の起動方法、テスト実行方法、ディレクトリ構成など）
- `フレームワークベストプラクティス.md` - 使用フレームワークのベストプラクティス（Laravel / Next.js / Astro 等）

ファイル名は `.agent-skill-chain/source/` の規約ファイル名と揃えてもよいし、プロジェクト独自の名前でもよい。エージェントは「同目的のルール」がある場合に .agent-skill-chain/project を優先する。

## project 配下ファイル索引

本リポジトリ（自己拡張ワークフローの開発元）の `.agent-skill-chain/project/` 配下に実在するファイルとその責務は次のとおり。名指しで参照したい場合はこの索引から辿る。

| ファイル | 責務（1 行） |
| -------- | ------------ |
| [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) | AI 駆動開発の基本運用原則の強化（リソース意識・責務境界意識・進行役表示最小化・fresh サブ分割の継承物受け渡し機構）を集約する。 |
| [MODEL_TIER_TABLE.md](MODEL_TIER_TABLE.md) | サブ委譲時の役割→ティア／role×effort 対応表と選定手順（opus 要否判定チェックリスト・降格凍結・未収束エスカレーション）の正本。 |
| [COVERAGE_EXCEPTIONS.md](COVERAGE_EXCEPTIONS.md) | 本リポジトリのカバレッジ例外台帳（実データ）。分母外の参考事項と例外行（COV-00N）を管理する。 |
| [worktree-naming-grandfather.txt](worktree-naming-grandfather.txt) | #40（非準拠ブランチ名の事後検知）の既存ブランチ救済リスト。初期凍結スナップショットと追記 allowlist を分離管理する。 |
| [自己拡張ワークフロー.md](自己拡張ワークフロー.md) | 本リポジトリ自身の開発（自己拡張）に適用する標準フローの上書き正本（issue 作成場所・memo 作成場所・Issue 追跡モードの本リポ運用等）。 |
| `orchestrator-allowlist.txt`（配置は任意・存在すれば適用） | orchestrator（メインエージェント）向け PreToolUse allowlist の opt-in 拡張。詳細は本ファイル §orchestrator allowlist 拡張 を参照。 |

## orchestrator allowlist 拡張

orchestrator（メインエージェント）が使えるツールは PreToolUse フックの allowlist（fail-closed）で限定されている。消費先固有のツール（社内 MCP ツール等）を追加したい場合、コア正本を編集せずにこのディレクトリの **`orchestrator-allowlist.txt`** で opt-in で許可を追加できる。

- 置き方: `.agent-skill-chain/source/enforcement/claude/orchestrator-allowlist.example.txt`（雛形）を `.agent-skill-chain/project/orchestrator-allowlist.txt` へコピーし、追加したいツール名を 1 行 1 名で記述する。
- 何も置かなければ従来どおり厳格（fail-closed）で、コア default の allowlist のみが有効。
- 形式・**能力ベースのリスク警告**（`mcp__*` 系書込ツールの opt-in は書込権限付与に等しい）・更新経路ガバナンス（worker 委譲＋ PR レビュー＋人間 main マージ／orchestrator は自分では直接書けない）は [SETUP.md §orchestrator allowlist の project 拡張（opt-in）](../source/SETUP.md) を参照。
- enforcement でロックアウトされた場合の復旧は [SETUP.md §ロックアウトからの復旧](../source/SETUP.md) を参照。

## 注意

- 採用先でプロジェクト固有ルールを使う場合のみ、このディレクトリにファイルを追加する。
- 空の `.agent-skill-chain/project/` のままでも問題ない（その場合は常に `.agent-skill-chain/source/` の標準ルールが使われる）。
