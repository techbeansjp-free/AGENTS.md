# SPEC: npm 配布物から runtime 履歴・自己拡張固有文書・インストール状態を除外する

- Issue: `ISSUE-244`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/244-exclude-runtime-from-npm-package`

## 目的・背景

現在の npm 配布設定は `.agent-skill-chain/` を一括で含めるため、consumer project に導入されない runtime 履歴アーカイブ、自己拡張用の `project/` 文書、および実行時に生成される `.installed_version` まで公開パッケージへ混入する。不要な運用データの公開とパッケージ肥大化を防ぎ、導入対象だけを配布する契約を明確にする。

## 要求 → 要件 → 受入条件

### 要求

npm package から導入対象外の内部運用データを除外しつつ、init/upgrade が必要とする資産を欠落させず、配布内容の回帰を自動テストで検出できるようにする。

### 要件

- npm の `files` は `.agent-skill-chain/` 配下を許可リストで指定し、導入対象の namespace だけを含める。
- runtime 実行時データ、project 固有ポリシー、`.installed_version` は配布しない。
- package-files テストは非配布の保守者資産と必須配布資産を明示的に検証する。

### 受入条件（Acceptance Criteria）

#### AC-1: 導入対象外の runtime 状態を npm 配布物から除外する

- Given: リポジトリに runtime 履歴・project 固有文書・`.installed_version` が存在する
- When: `npm pack --dry-run --json` を実行する
- Then: `.agent-skill-chain/runtime/`、`.agent-skill-chain/project/`、`.agent-skill-chain/.installed_version` のいずれも出力ファイル一覧に含まれない
- 検証方法見込み: `automated`

#### AC-2: init/upgrade 用の全 namespace を配布し続ける

- Given: npm package のファイル一覧
- When: package-files テストを実行する
- Then: `standards`、`templates`、`schemas`、`config`、`adapters`、`scripts`、`ci`、`hooks` の各 namespace に代表資産が存在する
- 検証方法見込み: `automated`

#### AC-3: 保守者向けソース・テスト・文書を配布しない

- Given: npm package のファイル一覧
- When: package-files テストを実行する
- Then: `src/`、`test/`、TypeScript 設定、保守者文書が含まれない
- 検証方法見込み: `automated`

## スコープ外

- npm package のバージョン更新・公開は行わない。
- consumer project への init/upgrade 実行結果そのものの変更は行わない。
- `.agent-skill-chain/` 配下の導入対象 namespace の内容は変更しない。
