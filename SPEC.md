<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: AGENTS.mdの`verify-template-sync.sh`パス言及を実在パスへ修正する

- Issue: `ISSUE-553`
- 作成者: `spec_worker`
- 対象ブランチ: `docs/553-verify-template-sync-path`

## 目的・背景

`AGENTS.md`（「GitHub配布・マルチAI対応」節）は次のように記載している。

> `.github/` はその展開結果（`.agent-skill-chain/scripts/verify-template-sync.sh` で同期検査）。

しかし実際のファイルは `.agent-skill-chain/ci/verify-template-sync.sh` に存在し、`.agent-skill-chain/scripts/verify-template-sync.sh` は存在しない（`ls .agent-skill-chain/scripts/verify-template-sync.sh` は失敗し、`ls .agent-skill-chain/ci/verify-template-sync.sh` は成功する）。実在するCIワークフロー（`.github/workflows/agent-skill-chain-ci.yml`・配布元テンプレート `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`）も `./.agent-skill-chain/ci/verify-template-sync.sh` を呼び出しており、実在パスは `ci/` 配下である。

さらに `AGENTS.md`「ディレクトリ構成」節のツリー表記は `ci/` 配下の一覧に `verify-template-sync` を正しく列挙しており、`AGENTS.md` 本文内で自己矛盾している。この誤記は、`AGENTS.md` を一次情報として読む人間・AIエージェントが `.agent-skill-chain/scripts/verify-template-sync.sh` を実在パスと誤認し、存在しないパスの参照・誤ったスクリプト起動を試みる原因になる。2026-08-10、別プロジェクトでのCodeRabbitレビューにより指摘を受け、ユーザーから報告された。

## 要求 → 要件 → 受入条件

### 要求

`AGENTS.md` を読む人間・AIエージェントが、`verify-template-sync.sh` の所在について、実在するパス（`.agent-skill-chain/ci/verify-template-sync.sh`）とのみ一致する記載を参照できることを求める。同一ファイル内で矛盾する記載が併存しない状態を求める。

### 要件

- `AGENTS.md`「GitHub配布・マルチAI対応」節の該当箇所（`.agent-skill-chain/scripts/verify-template-sync.sh`という記載）を、実在パス `.agent-skill-chain/ci/verify-template-sync.sh` に修正すること。
- 同一文中に併記されている `setup-labels.sh`・`setup-ruleset.sh` への参照（`.agent-skill-chain/scripts/setup-labels.sh`・`.agent-skill-chain/scripts/setup-ruleset.sh`）は、実在パス（`.agent-skill-chain/scripts/` 配下に両ファイルとも存在することを確認済み）と既に一致しており、変更対象に含めないこと。
- 修正後、`AGENTS.md` 本文中の `verify-template-sync.sh` へのパス言及が全箇所で実在パスと一致し、`AGENTS.md`「ディレクトリ構成」節のツリー表記（`ci/` 配下への列挙）とも矛盾しないこと。
- 本Issueの変更差分は `AGENTS.md` 自体を含むため、AGENTS.mdが定めるquickモード免除条件（変更差分に`AGENTS.md`を含む場合は免除しない）に従い、`size:quick` は適用せず通常フロー（4セグメント・4ゲート）を維持すること。

### 受入条件（Acceptance Criteria）

各ACの検証方法見込みは `automated | manual | hybrid` の1語のみで記す。詳細な理由・手順・実行者は `VALIDATION.md` で確定する。

#### AC-1: AGENTS.md本文中のverify-template-sync.shパス言及が実在パスと一致する

- Given: `AGENTS.md` に `verify-template-sync.sh` への言及が複数箇所存在する
- When: `AGENTS.md` 本文全体から `verify-template-sync.sh` を含む行を抽出し、記載されたパスとリポジトリ上の実在ファイルパスを突き合わせる
- Then: 全ての言及が `.agent-skill-chain/ci/verify-template-sync.sh`（実在パス）と一致し、存在しない `.agent-skill-chain/scripts/verify-template-sync.sh` への言及が1件も残っていない
- 検証方法見込み: `automated`

#### AC-2: 修正後もAGENTS.md本文内で自己矛盾しない

- Given: AC-1の修正が適用された `AGENTS.md`
- When: 「GitHub配布・マルチAI対応」節の `verify-template-sync.sh` パス言及と、「ディレクトリ構成」節のツリー表記（`ci/` 配下の一覧）を突き合わせる
- Then: 両箇所が同一のパス（`.agent-skill-chain/ci/verify-template-sync.sh` が属する `ci/` ディレクトリ）を指し、矛盾が無い
- 検証方法見込み: `manual`

#### AC-3: 併記されているsetup-labels.sh・setup-ruleset.shへの参照は変更されない

- Given: 修正対象の文中に `.agent-skill-chain/scripts/setup-labels.sh`・`.agent-skill-chain/scripts/setup-ruleset.sh` への言及が併記されている
- When: 修正後の `AGENTS.md` から両パスへの言及を確認する
- Then: 両パスとも修正前と同一の記載のまま維持されており、実在パス（`.agent-skill-chain/scripts/` 配下に両ファイルが実在する）と一致し続けている
- 検証方法見込み: `manual`

## スコープ外

- `AGENTS.md`の「GitHub配布・マルチAI対応」節・「ディレクトリ構成」節以外の節にある他のファイルパス言及全般の網羅的な正当性検証。本Issueは由来Issueで指摘された `verify-template-sync.sh` のパス言及に限定する。
- `.agent-skill-chain/scripts/verify-template-sync.sh` という実行ファイル自体の新規作成、または `.agent-skill-chain/ci/verify-template-sync.sh` の `scripts/` への移動によるコード側の対応。本Issueは文書側の記載を実在コード配置へ合わせる修正に限定し、コード側の配置（`ci/` 配下）自体は変更しない。
- `AGENTS.md` 以外の成果物（README.md・`.agent-skill-chain/standards/` 配下等）における同種のパス誤記の点検。由来Issueは `AGENTS.md` 本文の自己矛盾のみを対象とする。
