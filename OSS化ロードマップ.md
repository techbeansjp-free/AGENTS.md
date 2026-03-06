# OSS 化ロードマップ（B/C 前提・issue 単位）

> 設計は承認レベルに達している。本ドキュメントは「配布できる製品に仕上げる」ためのタスクを issue 単位で切れる形にまとめたもの。優先順位に従い、必要に応じて .workflow で 00_要求定義 から開始する。

---

## 前提

- **現状**: 共通仕様（boot）・実行基盤差分（platforms）・ワークフロー・レビュー・ログ・workers/skills まで揃い、**OSS 化できる骨格**がある。
- **方向**: 「汎用コア」と「opinionated な流儀」を分離し、**導入レベル別（Core / Standard / Advanced）** と **拡張ポイント** を明文化する。
- **判定**: 設計の作り直しは不要。**パッケージング・導入レベル分離・README/Examples 整備・拡張ポイント明文化** が次の作業。

---

## 優先順位（推奨実施順）

1. README を OSS 向けに再構成
2. minimal / standard / advanced の導入レベル定義
3. examples/ を作る
4. 拡張ポイント一覧を作る
5. SQLite / review / CI を optional 扱いに整理する

---

## Issue 一覧（issue 単位で切る用）

以下はそれぞれ独立した issue/タスクとして扱える。親 issue 名例: `AGENTS-spec OSS 化`。サブは `90_issues/` で管理してもよい。

---

### 1. README を OSS 向けに再構成

| 項目 | 内容 |
|------|------|
| **目的** | 第一印象と「何に使う基盤か」を明確にし、OSS として信頼されやすい説明にする。 |
| **受け入れ基準** | README に次の章が存在する: この基盤は何か／どんな問題を解決するか／対象ユーザー／最小導入手順／推奨導入手順／ディレクトリ構造／コア思想／拡張ポイント／対応プラットフォーム／非対応・制限事項／サンプル適用例（または examples/ への導線）。 |
| **成果物** | `README.md` の再構成。必要なら `docs/` に詳細を分割。 |
| **注意** | 「opinionated な汎用基盤」であることを冒頭で明示する（フェーズ固定・SILENT MODE・書記一元ログ・workflow.db・BDD/TDD 前提など、どんな思想か・どんなチームに向くか・重いケースを書く）。 |

---

### 2. 導入レベル定義（Core / Standard / Advanced）

| 項目 | 内容 |
|------|------|
| **目的** | 利用者が「どこまで入れるか」を選べるようにし、重さを段階的にする。 |
| **受け入れ基準** | 次の 3 段階が README または別ドキュメントに定義されている。**Core**: 最低限これだけで動く（AGENTS.md, .agents/boot/, .agents/platforms/, delegate_to_sub.md, workers/README.md）。**Standard**: 多くのプロジェクトで使う推奨構成（.workflow/templates/, scribe/, ledger/, .review/README.md 相当）。**Advanced**: 大規模運用向け（SQLite ログ、厳格 review、CI テンプレート、subagent guard、GitHub 連携一式）。 |
| **成果物** | `docs/導入レベル.md` または README 内の「導入レベル」セクション。表形式で「含まれるもの」「想定ユーザー」を記載。 |
| **注意** | 今は全部が一つの塊に見えやすいため、導入レベル別に分けると OSS として強くなる。 |

---

### 3. examples/ の作成（minimal / standard / advanced）

| 項目 | 内容 |
|------|------|
| **目的** | 利用者が実物を見て導入判断できるようにする。README より先に実物を見たがる需要に対応。 |
| **受け入れ基準** | `examples/` が存在し、少なくとも `minimal/` と `standard/` がある（`advanced/` は任意）。各ディレクトリに、そのレベルで動く最小構成のサンプル（AGENTS.md または COPY_TO_PROJECT_ROOT 相当、.agents の必要な部分、.workflow の必要な部分）が含まれる。 |
| **成果物** | `examples/minimal/`, `examples/standard/`（および任意で `examples/advanced/`）。各 README で「この例の使い方」を 1 ファイルで説明。 |
| **注意** | 実ファイルのコピーではなく、テンプレートや「このレベルで必要なファイル一覧」から生成できる形でもよい。 |

---

### 4. 拡張ポイント一覧の明文化

| 項目 | 内容 |
|------|------|
| **目的** | 利用者がどこを差し替えられるかを明示し、OSS らしさとカスタマイズ可能性を伝える。 |
| **受け入れ基準** | README または `docs/拡張ポイント.md` に、少なくとも次の差し替え候補が「拡張ポイント」として記載されている: platforms/（実行基盤差分）, workers/（ロール差し替え）, .workflow/templates/（運用フロー差し替え）, capabilities/POLICY.md（有効化ポリシー差し替え）, human/（人間向け規約差し替え）。各項目に「何を差し替えるか」「デフォルトの扱い」を 1〜2 行で記載。 |
| **成果物** | README の「拡張ポイント」セクション、または `docs/拡張ポイント.md`。 |
| **注意** | 差し替え時の注意（優先順位・上書き範囲）を簡潔に書く。 |

---

### 5. SQLite / review / CI を optional 扱いに整理

| 項目 | 内容 |
|------|------|
| **目的** | コアの表現を「ログは一元化・書記のみが書く」にし、SQLite 実装は Standard/Advanced 扱いにする。review の重さを「推奨だが必須ではない」または導入レベルで分ける。 |
| **受け入れ基準** | (1) boot または CORE で「ログは一元化し、書記のみが記録する」と原則だけ書く。workflow.db（SQLite）は「推奨実装」または Standard/Advanced の説明に寄せる。(2) .review/ について「推奨だが必須ではない」または「Standard 以上で推奨」と README または導入レベルで明記。(3) CI テンプレート・GitHub 連携は Advanced または docs の別セクションにまとめ、Core からは参照しない。 |
| **成果物** | CORE または boot の該当箇所の文言調整、README または導入レベルドキュメントの追記、必要なら ledger/README の「必須/推奨」の整理。 |
| **注意** | 既存の workflow.db 必須という記述を「本則は workflow.db、暫定は memo」のままにするか、optional 化するかは設計判断。ここでは「コアの原則」と「推奨実装」を分離することを目的とする。 |

---

### 6. .agents-project の役割の明文化（改善①）

| 項目 | 内容 |
|------|------|
| **目的** | 「project-specific agents」であることを説明し、名前だけでは分かりにくい問題を解消する。 |
| **受け入れ基準** | README または .agents-project/README.md に「.agents-project = プロジェクト固有の拡張。spec 本体を上書きせず、プロジェクト固有ルールのみ置く」旨を一文で明記。必要なら「extensions 相当」と注釈する。 |
| **成果物** | .agents-project/README.md の冒頭に責務一文を追加。AGENTS.md または README の「.agents-project」説明に上記を反映。 |
| **注意** | ディレクトリ名の変更（.agents/extensions 等）は影響が大きいため、まずは説明の明文化のみでも可。 |

---

### 7. CONCEPTS の読む順序の明確化（改善③）

| 項目 | 内容 |
|------|------|
| **目的** | AI が最初に読む順序を「AGENTS → CONCEPTS → boot」にすると理解が安定する、との指摘を反映する。 |
| **受け入れ基準** | 実行前契約の「必須読了リスト」または LOAD_POLICY の「メインが最初に読むもの」で、CONCEPTS を CORE の前（AGENTS の直後）に読む順序を許容するか、または「AGENTS 読了後は CONCEPTS を先に読んでから boot を読む」を推奨として明記する。現行は CORE → LOAD_POLICY → WORKFLOW → CONCEPTS のため、変更する場合は CORE との整合を取る。 |
| **成果物** | LOAD_POLICY または CORE の必須読了リストの文言調整。必要なら「推奨: AGENTS の次に CONCEPTS を読むと理解が安定する」を 1 行追加。 |
| **注意** | 強制順序を変えると影響が大きいため、まずは「推奨」としての注記でも可。 |

---

### 8. root の入口整理（docs / examples / scripts）

| 項目 | 内容 |
|------|------|
| **目的** | B/C 向けに root の第一印象を整え、外向きの入口を明確にする。 |
| **受け入れ基準** | root が次のいずれかに近い形で整理されている: `README.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `docs/`, `examples/`, `scripts/`, `.agents/`。既存の `COPY_TO_PROJECT_ROOT_AGENTS.md` は docs または README から明確に案内されている。 |
| **成果物** | ディレクトリ構成の整理、README の「ディレクトリ構造」の更新。必要なら `docs/` を新設し、詳細説明を移動。 |
| **注意** | 既存の .workflow / .review はそのままでもよい。`.agents/` は維持。 |

---

### 9. install / bootstrap 導線の 3 パターン化

| 項目 | 内容 |
|------|------|
| **目的** | 手動導入・最小導入・フル導入の 3 パターンを README または docs で案内する。 |
| **受け入れ基準** | README または `docs/導入ガイド.md` に、(1) 手動導入（COPY_TO_PROJECT_ROOT + テンプレートの手動コピー）、(2) 最小導入（Core のみ、必要なファイル一覧とコピー手順）、(3) フル導入（Standard または Advanced まで、テンプレート・ledger・review 含む）の 3 パターンが記載されている。各パターンに「何が入るか」「何をコピーするか」を箇条で記載。 |
| **成果物** | README の「はじめ方」セクション拡張、または `docs/導入ガイド.md`。 |
| **注意** | 既存の「プロジェクトにコピペするだけではじめ方」を 3 パターンのいずれかに位置づけ、他 2 パターンへの導線を足す形でも可。 |

---

## 実施時の注意

- 各 issue は `.workflow/{YYYYMMDD_HHMMSS_issue_name}/00_要求定義.md` から開始し、01 → 02 → 03 → 実装 → 04_review を守る。
- 本ロードマップは「設計は承認済み」を前提としており、boot / platforms / workers の構造や CORE の絶対制約を変える必要はない。
- 優先順位 1〜5 を先に実施すると、OSS としての完成度が上がりやすい。6〜9 は仕上げ・改善として必要に応じて実施する。

---

## 参照

- 設計評価: 「設計としては承認できるレベル」。共通仕様（boot）・実行基盤差分（platforms）・ワークフロー・レビュー・ログ・workers/skills が揃い、OSS 化できる骨格がある。
- 次のテーマ: 「汎用コア」と「あなたの流儀」を分離し、導入レベル・拡張ポイント・README/Examples で「配布できる製品」に仕上げる。
