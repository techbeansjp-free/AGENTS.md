# プロジェクト固有ルール（.agent-skill-chain/project/）

このディレクトリには、**プロジェクトごとの固有ルール**を配置する。

## 本パッケージを「配布テンプレート」として編集している場合

**汎用版の仕様本文**（全採用先に共通する規約）は **`../.agent-skill-chain/source/`** に置く。例: カバレッジ例外の**方針・台帳の列定義・言語別マーカ**の正本は [`../.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md`](../.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md)。採用先では、そのファイルの **第3章の台帳テンプレート** をここ（または `docs/`）に**コピー**して、プロジェクト固有の例外行を追記する。

## 目的

- **テンプレートはそのまま使う**: `.agent-skill-chain/source/` 配下の規約ファイル（実行ルール.md、コーディングルール.md 等）は汎用テンプレートとして変更せず、コピーしたまま利用する。
- **固有ルールはここに追加**: プロジェクト固有の規約（開発環境の起動方法、テスト実行方法、フレームワークのベストプラクティス、命名規則など）は、この `.agent-skill-chain/project/` 配下にファイルとして作成する。
- **運用を楽にする**: テンプレートの更新を取り込んでも、プロジェクト固有の記述がテンプレートに混ざらないようにする。`.agent-skill-chain/source/` と分離することで扱いやすくする。

## 優先順位

**`.agent-skill-chain/project/` 配下のルールが `.agent-skill-chain/source/` のルールより優先される。**

- 同名または同目的のルールがある場合: **`.agent-skill-chain/project/` のファイルを採用**する。
- `.agent-skill-chain/project/` に該当ファイルがない場合: `.agent-skill-chain/source/` の標準ルールに従う。

参照順序の例:

1. まず `.agent-skill-chain/project/` に該当するファイルがあるか確認する。
2. あればその内容に従う。
3. なければ `.agent-skill-chain/source/` の標準ルール（実行ルール.md 等）に従う。

### 明確化注記: source 内部のサブ層と特化ドメインの順序

上記の一般規約「**project > source の 2 層**」は維持する。そのうえで次を明確化する（一般規約は変更しない）。

- **source 内部には PF 限定名前空間（`platforms/<pf>/`）のサブ層があり得る。** `platforms/<pf>/` も MODEL_SELECTION 等のコア本体も、いずれも `source/` 配下である。したがって `.agent-skill-chain/project/` は、`platforms/<pf>/` を含む**全 source に優先する**（2 層規約と矛盾しない、その内部詳細化にすぎない）。
- **特化ドメインの具体的な解決順序は、当該ドメインのドキュメント側を正本とする。** 例: モデルティア解決順（`project/MODEL_TIER_TABLE.md` > `source/platforms/claude/MODEL_TIER_RECOMMENDED.md` > `source/MODEL_SELECTION.md` 抽象原則）の正本は当該 tier ドキュメント側にあり、本 README には重複記載しない（単一責務）。

## 配置例

採用先プロジェクトで次のようなファイルを用意する場合、このディレクトリに置く。

- `プロジェクト固有.md` - プロジェクト固有の規約（開発環境の起動方法、テスト実行方法、ディレクトリ構成など）
- `フレームワークベストプラクティス.md` - 使用フレームワークのベストプラクティス（Laravel / Next.js / Astro 等）

ファイル名は `.agent-skill-chain/source/` の規約ファイル名と揃えてもよいし、プロジェクト独自の名前でもよい。エージェントは「同目的のルール」がある場合に .agent-skill-chain/project を優先する。

## 注意

- 採用先でプロジェクト固有ルールを使う場合のみ、このディレクトリにファイルを追加する。
- 空の `.agent-skill-chain/project/` のままでも問題ない（その場合は常に `.agent-skill-chain/source/` の標準ルールが使われる）。
