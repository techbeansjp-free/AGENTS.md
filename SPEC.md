# SPEC: lint-references.sh が .github/workflows/ を検査対象外にしており、実デプロイ済みワークフローの § 参照違反を検出できていない

- Issue: `ISSUE-221`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/221-lint-references-github-workflows`

## 目的・背景

AGENTS.md「参照・コメントの陳腐化防止」原則は、規範文書・ソースコードコメントにおけるセクション番号参照（例:「§3.2 を参照」）やファイルパス＋行番号参照を禁止し、その機械検査を `.agent-skill-chain/scripts/lint-references.sh`（CLI としては `agent-skill-chain lint references`）が担う。

この lint のデフォルト走査対象（`src/lib/scan.ts` の `defaultLiveFileRoots()`）は次に限定されている:

```
AGENTS.md, docs/GLOSSARY.md,
.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}, src
```

ここに `.github/` が含まれていない。一方 `lint-references.sh` 自身の冒頭コメントは検査対象を「生きたファイル」と明記しており、GitHub Actions として実際に実行される `.github/workflows/*.yml`（AGENTS.md の用語では「`.agent-skill-chain/templates/github/.github/` の展開結果」）はまさに生きたファイルである。にもかかわらず走査対象から漏れている。

この漏れにより、実デプロイ済みワークフローに現に存在する禁止参照違反が本体側で検出されない。具体的には `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml` の 1 行目:

```
# 正本: AGENTS.md §不変条件I4・§ディレクトリ構成 / ADR-0007
```

が `lint-references.sh` 実行で以下の違反として検出される（テンプレート正本側は走査対象に含まれるため）:

```
禁止参照 '§不変条件I4・§ディレクトリ構成'（見出しテキストで解決できないセクション番号参照）
```

原因は表記側にある。`src/commands/lint.ts` の `SECTION_REF_RE` は `§` の後を空白・一部の括弧類まで貪欲にマッチするが、区切り文字 `・` を除外文字集合に含めない。そのため `§不変条件I4・§ディレクトリ構成` の `・` で区切られた 2 つの独立参照（本来は「不変条件I4」「ディレクトリ構成」）が 1 つの解決不能トークンとして連結キャプチャされ、`headingCore()` による末尾コード除去ヒューリスティック（例:「不変条件I1〜I8」見出しに対する「I4」等の安定 ID 参照を許可する仕組み）が効かず違反となる。

このファイルは `.agent-skill-chain/ci/verify-template-sync.sh` により本体 `.github/workflows/agent-skill-chain-root-cleanup.yml` と 1 バイト差異なく同期されている（`diff` で完全一致・実測確認済み）ため、本体側にも同一違反が実在するが、`.github/` が走査対象外のため `lint-references.sh` はこれを報告しない。

他 5 本のワークフロー YAML（`agent-skill-chain-{ci,reconcile,gate,release,risk}.yml`）冒頭の `§` 参照は、`・` ではなく空白区切り（例:「§不変条件I1・I4・I6・I7 / §参照・コメントの陳腐化防止」）であり、`headingCore()` の末尾コード除去で正しく解決されるため現時点では違反ではない。したがって違反は 6 本全てではなく `agent-skill-chain-root-cleanup.yml` 1 本の `・` 区切り表記に起因する。

本 Issue はこの検出漏れと現存違反を是正する。なお本件は Issue #219（Dependabot 許可判定バグ修正）の作業中に進行役が独立に確認して発見した、#219 とは無関係な既存問題として切り出したものである（由来の補助情報）。

## 要求 → 要件 → 受入条件

### 要求

`lint-references.sh`（`agent-skill-chain lint references`）が、実際に GitHub Actions として実行される `.github/workflows/` 配下の生きたワークフロー YAML を検査対象に含み、現に違反しているファイルを本体側でも検出できるようにしたい。あわせて、現存する違反（`agent-skill-chain-root-cleanup.yml` の `§不変条件I4・§ディレクトリ構成`）を解決可能な記法へ是正し、lint を成功させたい。

### 要件

- `lint-references.sh`（`agent-skill-chain lint references`）のデフォルト走査対象に、本体 `.github/workflows/` を含める。これにより実デプロイされるワークフローファイルの禁止参照が本体側でも検出される。
- `agent-skill-chain-root-cleanup.yml`（本体・テンプレート正本の両方）冒頭の `§不変条件I4・§ディレクトリ構成` を、`lint-references.sh` が解決可能な記法（例: 空白区切りで 2 参照に分離する、または安定 ID での参照に置き換える）へ是正する。
- 是正後、`lint-references.sh` は本体・テンプレート正本の両方に対して違反ゼロで成功する。
- `verify-template-sync.sh` は引き続き成功する（本体・テンプレート正本の 1 バイト差異なき完全一致を維持する）。
- 走査対象拡張後も、既存の他ワークフロー YAML（`ci.yml`/`reconcile.yml`/`gate.yml`/`release.yml`/`risk.yml`）で新規の違反が発生しない（既に解決可能な表記のため回帰しない想定を機械確認する）。

### 受入条件（Acceptance Criteria）

各 AC には散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: 是正前に本体ワークフローの違反が再現できる（回帰テスト）

- Given: `.github/workflows/` が `lint-references.sh` のデフォルト走査対象に含まれ、かつ `agent-skill-chain-root-cleanup.yml` が是正前の `§不変条件I4・§ディレクトリ構成` 表記である状態
- When: `lint-references.sh`（`agent-skill-chain lint references`）を実行する
- Then: 本体 `.github/workflows/agent-skill-chain-root-cleanup.yml` に対する禁止参照違反が少なくとも一度検出される（検出漏れが解消されていることの回帰的確認）
- 検証方法見込み: `automated`（`npm test` の CLI テスト、または `lint-references.sh` 実行結果の直接確認）

#### AC-2: 是正後に本体・テンプレート正本の両方で lint が成功する

- Given: 走査対象に `.github/workflows/` が含まれ、かつ `agent-skill-chain-root-cleanup.yml`（本体・テンプレート正本の両方）が解決可能な記法へ是正された状態
- When: `lint-references.sh`（`agent-skill-chain lint references`）を実行する
- Then: 本体・テンプレート正本の両方に対して禁止参照違反ゼロで成功する（終了コード成功）
- 検証方法見込み: `automated`（`npm test` の CLI テスト、または `lint-references.sh` 実行結果の直接確認）

#### AC-3: verify-template-sync が引き続き成功する

- Given: `agent-skill-chain-root-cleanup.yml` の是正が本体・テンプレート正本の両方へ同一に適用された状態
- When: `verify-template-sync.sh` を実行する
- Then: 本体・テンプレート正本の完全一致（1 バイト差異なし）が維持され、成功する
- 検証方法見込み: `automated`（`verify-template-sync.sh` 実行結果の直接確認、または `npm test` の CLI テスト）

#### AC-4: 走査対象拡張により他ワークフロー YAML で新規違反が発生しない

- Given: 走査対象に `.github/workflows/` が追加され、`ci.yml`/`reconcile.yml`/`gate.yml`/`release.yml`/`risk.yml` が既存の空白区切り表記のままである状態
- When: `lint-references.sh`（`agent-skill-chain lint references`）を実行する
- Then: これら 5 本のワークフロー YAML に対して新規の禁止参照違反が発生しない（無回帰を機械確認する）
- 検証方法見込み: `automated`（`lint-references.sh` 実行結果の直接確認、または `npm test` の CLI テスト）

## スコープ外

- `lint-references.sh` の `SECTION_REF_RE` が `・` 区切りの複数 `§` 参照を正しく分離キャプチャできるようにする一般的な正規表現改善。今回は `agent-skill-chain-root-cleanup.yml` 側の表記是正で個別に解消し、パーサ自体の一般化は本 Issue のスコープ外とする（将来同種の表記が増える場合は別途検討する）。
