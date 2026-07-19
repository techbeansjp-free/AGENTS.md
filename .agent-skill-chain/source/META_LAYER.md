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

**advisory ルールの判定基準（enforcement 相当とみなす条件）**: AGENT_CONDUCT.md・PLATFORM_SAFETY_RESPONSE.md 等、機構（hooks/CI）による直接強制を伴わない advisory ルールを新設する場合、次の (a)(b) の**両方**を満たせば「enforcement を伴わないルール」の禁止には抵触しない（Rule 3 を満たす）とみなす。

- (a) 当該ルールの失敗シナリオが [enforcement/README.md](enforcement/README.md) §失敗条件表へ登載されている（未実装・人手監査の分類でもよい）。
- (b) 当該ルールに対する人手監査観点（何を・誰が・いつ確認するか）が指定されている。

(a)(b) のいずれも満たさない advisory ルールの新設は Rule 3 違反として扱う。失敗条件表本体（登載作業）は enforcement 所有であり、本判定基準は本ファイル側の基準文言のみを正本とする（登載運用は領域C 連携）。

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

**carve-out（`skills/agent/` の位置づけ）**: `skills/agent/`（run_command.md・SKILL.md）は、他ドメイン skill（requirements/architecture/review 等の **domain capability skill**）とは異なり、**委譲そのものを実行する orchestration I/F 層**である。委譲形式（Task/Constraints/OutputSpec）に加え、各ゲート（review-docs 必須ゲート・GitHub Issue 起票ゲート・branch 紐づけゲート等）の policy を指定する場所として run_command.md を用いてよい。「skill に rule を書く」の禁止は **domain capability skill**（requirements/architecture/review/testing/logging/experience 等）を対象とし、`skills/agent/` の orchestration I/F 層には適用しない。

**注記（4 層モデルと物理構造の関係）**: 上表（RULES/COMMANDS/SKILLS/TEMPLATES）の 4 層は**概念分類**であり、実際のディレクトリ構造（`boot/`・`workflow/`・`spec/`・`enforcement/`・ルート直下の policy ファイル群等）と物理的に 1 対 1 対応するものではない。判定に迷う場合は本節の carve-out・各ファイル冒頭の責務宣言を優先する。

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

**「参照必須文書」の計測定義**: 上記「参照文書 ≤ 8」の計測対象は、**起動時に一括必読の文書（CORE / LOAD_POLICY / PHASES の 3 ファイル）のみ**を指す（正本は [boot/LOAD_POLICY.md](boot/LOAD_POLICY.md) 冒頭）。LOAD_POLICY のトリガー表に従いオンデマンドで読む各行の対象ファイルは、この指標の加算対象に**含めない**。これにより「読了義務を果たすほど基準超過で警告される」自己矛盾を避ける。**越境申し送り**: enforcement 系統C（orchestrator の Read/Grep 過大読込を警告する hook）は未実装であり、実装時は本定義（起動必読のみを計測）と整合させること（領域C）。深い簡素化（読了義務そのものの凝縮版＋オンデマンド再設計）は本 issue のスコープ外とし、別途フォローアップ issue で検討する。

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
