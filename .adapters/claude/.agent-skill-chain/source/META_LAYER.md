# META_LAYER

本ドキュメントは **AGENTS 基盤そのものの設計原則**を定義する。

AGENTS は AI を用いた開発プロセスを安定させるための **実行基盤**であり、プロジェクト開発の主目的ではない。

したがって、本基盤は次の原則に従って運用される。

---

## 原則

### Feature First

AGENTS 基盤の目的は **feature delivery の成功率を上げること**である。

以下は禁止する。

- 基盤の美しさのための設計拡張
- 実案件と無関係な抽象化
- 実行されないルールの追加

基盤変更は、次のいずれかを満たす場合のみ許可する。

- 実装事故を防ぐ
- AI の誤操作を防ぐ
- 証跡の再現性を上げる
- CI 監査を強化する

---

## 基盤膨張防止ルール

AGENTS 基盤は、放置すると自然に膨張する。

これを防ぐため、以下のルールを採用する。

### Rule 1: 文書追加前の統合検討

新しい文書を追加する場合、必ず次を確認する。

1. 既存文書へ統合できないか
2. 既存 README に吸収できないか
3. maintainer 文書として一時化できないか

統合できない場合のみ、新規 `.md` を作成する。

その際、必ず次を記載する。

- なぜ既存文書に統合できないか
- どの責務を持つ文書か

### Rule 2: 一時文書の寿命

試験運用や設計レビューのための文書は **永続文書にしない**。

一時文書は次の条件を必ず持つ。

- 対象: maintainer / enforcement / review
- 終了条件
- 統合先

例:

```
終了条件:
* enforcement 安定後 README に統合
* CI enforcement 完成後削除
```

### Rule 3: 基盤変更の最小化

基盤変更は **最小変更**を原則とする。

禁止:

- ルール追加のみの変更
- 文書追加のみの変更
- enforcement を伴わないルール

許可:

- CI enforcement を伴う変更
- audit 強化
- command 実装強化

---

## 責務境界

AGENTS 基盤は以下の 4 層で構成される。

| 層 | 役割 |
|---|------|
| RULES | 破ってはいけない原則 |
| COMMANDS | 作業単位 |
| SKILLS | 実行方法 |
| TEMPLATES | 出力形式 |

この責務境界を越えて内容を書いてはいけない。

禁止例:

- command に policy を書く
- skill に rule を書く
- template に workflow を書く

---

## メタ層の監視指標

AGENTS 基盤の肥大化を防ぐため、次の指標を監視する。

### 指標

1 issue あたり

- 必須 command 数
- 必須証跡数
- 参照必須文書数
- 基盤修正ファイル数

### 基準

| 指標 | 目安 |
|------|------|
| command | ≤ 4 |
| 証跡 | ≤ 3 |
| 参照文書 | ≤ 8 |
| 基盤修正 | ≤ 2 |

これを超えた場合、基盤の簡素化を検討する。

---

## 基盤変更レビュー

AGENTS 基盤に対する変更は、通常の feature と同じフローを通す。

```
requirement-discovery
↓
design-feature
↓
implement-feature
↓
verify-and-close
```

ただし、次を追加する。

- META_LAYER 違反チェック
- 文書増加チェック
- enforcement 整合チェック

---

## 最終原則

AGENTS は **開発のための基盤**であり、基盤のための開発を行ってはならない。

以下を常に優先する。

```
feature delivery > framework purity
```

基盤が feature delivery を遅くする場合、基盤を簡素化する。

---

## 仕様の対象と編集者の分離（二つのレイヤー）

本パッケージで定義している **orchestrator / worker / auditor / scribe** は、**このリポジトリ（.agents）を読んでプロジェクト内で動く「実行レイヤー」** の振る舞い仕様である。これらを編集する作業は **メタレイヤー** である。

| レイヤー | 誰か | 何をするか |
|----------|------|-------------|
| **実行レイヤー** | プロジェクトに導入された .agents を読む AI（メイン＝orchestrator、サブ＝worker 等） | ユーザー依頼に応じ、phase 判定 → command 選択 → run_command で委譲 → 証跡確認。実作業は worker が command 経由で行う。 |
| **メタレイヤー（仕様編集）** | Cursor / Claude Code 等のエディタ上で本パッケージ（仕様リポジトリ）そのものを編集するアシスタント | 仕様ファイル（CORE.md、commands/、enforcement/ 等）の追加・変更・リファクタ。プロジェクトの「運用されるエージェント」ではない。 |

この分離を明示することで、「仕様を直すために誰かがファイルを編集する」ことと、「運用で orchestrator が実作業をしてはいけない」ことを混同しない。

### 参照

- [boot/CORE.md](boot/CORE.md) — 実行レイヤーでの絶対制約
- [agents/README.md](agents/README.md) — 役割定義（orchestrator / worker / auditor / scribe）
