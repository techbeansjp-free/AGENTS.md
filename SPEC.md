# SPEC: 配布AGENTS.mdにupgradeコマンドの正確な起動構文が記載されていない

- Issue: `ISSUE-298`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/298-upgrade-command-doc`

## 目的・背景

配布される `AGENTS.md`（`.agent-skill-chain/templates/` 配下が正本、`init`/`upgrade`でconsumerリポジトリのルートへ導入される）は、`upgrade` というスクリプト名をディレクトリ構成の説明中で列挙するのみで、実際の起動コマンド構文（`npx github:techbeansjp-free/AGENTS.md upgrade`）を一切記載していない。

この構文は本リポジトリ自身の `README.md` にのみ存在するが、`README.md` は `init`/`upgrade` いずれでもconsumer側へ配布されない。そのためconsumerは導入直後の一度きりしかこの構文を目にする機会がなく、以後は自分のリポジトリ内のどこにも「どう更新するか」の記録が残らない。AGENTS.md不変条件I3（耐久性：作業状態は常にGitから完全復元可能）の趣旨に反する。

## 要求 → 要件 → 受入条件

### 要求

consumerが導入後いつでも、自分のリポジトリ内の配布済みファイルだけを見て正確なアップグレード起動コマンドを再発見できるようにする。

### 要件

- 配布される `AGENTS.md`（正本）に `upgrade` の正確な起動コマンド構文を追記する。
- `AGENTS.md` 150行上限（`verify-doc-length.sh`）を超過しない。
- 追記内容が実際のCLI usage文言（`agent-skill-chain upgrade -h`）と矛盾しない。
- `verify-template-sync` が本修正後も成功し続ける（配布正本と本リポジトリの展開結果を同期する）。

### 受入条件（Acceptance Criteria）

#### AC-1: 配布正本AGENTS.mdにupgrade起動構文が含まれる

- Given: `.agent-skill-chain/templates/github` 配下ではなくルート直下の配布正本 `AGENTS.md`（`init`/`upgrade`の`ROOT_LEVEL_ENTRIES`対象）
- When: ファイル内容を検査する
- Then: `npx github:techbeansjp-free/AGENTS.md upgrade` を含む文字列が存在する
- 検証方法見込み: `automated`

#### AC-2: doc-length上限を超過しない

- Given: 修正後の配布正本 `AGENTS.md`
- When: `agent-skill-chain verify doc-length` を実行する
- Then: 終了コード0
- 検証方法見込み: `automated`

#### AC-3: 本リポジトリの展開結果と同期する

- Given: 修正後の配布正本 `AGENTS.md` と本リポジトリルートの `AGENTS.md`
- When: `agent-skill-chain verify template-sync` を実行する
- Then: 差分なしで終了コード0
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/` 配下の他ファイル（テンプレート・標準規約等）への同種の追記は行わない。
- `init`/`upgrade` コマンド自体の出力（stdout hint等）の変更は行わない。
