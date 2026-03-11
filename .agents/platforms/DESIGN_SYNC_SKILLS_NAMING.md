# DESIGN_SYNC_SKILLS_NAMING.md — sync_skills 配備先の名前衝突対策

**目的**: `.agents/skills/{domain}/{capability}/` をプラットフォームの `skills/` にコピーするとき、**異なる domain で同名 capability** が存在すると配備先で上書きされる問題の対策。**案B（プレフィックス `{domain}__{capability}`）を採用済み。** setup-agents-spec.sh の sync_skills で配備先を `skills/{domain}__{capability}/` にしている。

---

## 1. 問題の整理

### 1.1 現行の挙動

- **正本**: `.agents/skills/{domain}/{capability}/`（例: `skills/requirements/write-bdd/`, `skills/testing/write-bdd/`）
- **配備先**: フラット。例: `.claude/skills/write-bdd/`, `.cursor/skills/write-bdd/`
- **実装**: `setup-agents-spec.sh` の `sync_skills()` が `cap_name=$(basename "$cap_dir")` のみを使い、`domain` を捨てている。

結果として、`skills/requirements/write-bdd/` と `skills/testing/write-bdd/` が両方あると、**後から走った方が前者を上書き**する。

### 1.2 参照の二種類

| 種類 | 参照先 | 例 |
|------|--------|-----|
| **正本参照**（command・run_command・LOAD_POLICY） | `.agents/skills/{domain}/{capability}/` | `skills/requirements/write-bdd/` |
| **配備先**（ツールがスキルをロードするとき） | `.claude/skills/<skill-name>/` 等 | `.claude/skills/write-bdd/` |

**重要**: command や run_command は **正本パス**（domain 込み）を参照する。配備先のディレクトリ名が変わっても、正本参照は変更不要。影響を受けるのは **ツールが配備先のディレクトリ名をスキル名として扱う場合**（スラッシュコマンド名・一覧表示など）のみ。

---

## 2. 対策案の比較

### 案A: 現状維持（命名規約で一意にする）

- **方式**: 配備先は従来どおり `skills/{capability}/`。capability 名を **グローバルに一意** とする規約で衝突を防ぐ（例: `write-bdd` は requirements 専用、testing では `generate-bdd-scenarios` など別名にする）。
- **長所**: 実装変更なし。スラッシュコマンドが短い（`/write-bdd`）。既存の SKILL.md の `name` と一致。
- **短所**: domain が増えるほど命名負荷が上がる。うっかり同名を作ると上書きで気づきにくい。
- **結論**: 現時点ではこれで十分。将来、domain をまたいで「同じ概念名」の capability を複数持ちたくなったときに限界が出る。

---

### 案B: プレフィックス `{domain}__{capability}`（推奨）

- **方式**: 配備先のディレクトリ名を `{domain}__{capability}` にする。例: `.claude/skills/requirements__write-bdd/`, `.claude/skills/testing__write-bdd/`。
- **区切り**: `__`（アンダースコア2つ）を採用する理由  
  - 多くのツールでディレクトリ名・識別子に使える。  
  - 単一 `_` は capability 名内でも使うため（`write-bdd` → `_` は含まないが `design-api-contract` などでハイフンと混在）。  
  - ハイフンだけ（`requirements-write-bdd`）だと domain と capability の境界が分かりにくい。  
  - スラッシュは多くのツールでパス区切りと解釈されるため使わない。
- **長所**:  
  - 正本の構造（domain/capability）を配備先でも一意に反映できる。  
  - 同名 capability を複数 domain で持てる。  
  - 実装変更は `sync_skills()` 内の「配備先ディレクトリ名」の算出だけ（後述）。
- **短所**:  
  - スラッシュコマンドが長くなる（例: `/requirements__write-bdd`）。  
  - SKILL.md の frontmatter `name` をどうするか要検討（下記）。
- **frontmatter `name` の方針**:  
  - **推奨**: コピー先では **触らない**。正本の `name: write-bdd` のまま。ツールがディレクトリ名でスキルを識別するなら、表示名は description や別フィールドで補う。  
  - **代替**: 配備時に `name` を `requirements__write-bdd` に書き換える。ツールが `name` をスラッシュコマンドに使う場合はこちらの方が一貫するが、正本の SKILL.md を書き換えないよう、**コピー先の SKILL.md のみ**変更する必要がある（sync のたびに上書き）。

---

### 案C: 配備先でサブディレクトリ `skills/{domain}/{capability}/`

- **方式**: 例: `.claude/skills/requirements/write-bdd/`。
- **長所**: 正本と同じ階層構造。見た目が分かりやすい。
- **短所**: Claude Code / Cursor 等が **1 階層のみ** `skills/<name>/` をスキルとしてスキャンする仕様だと、`skills/requirements/write-bdd/` が認識されない可能性が高い。各ツールのドキュメントでネスト対応を確認する必要がある。
- **結論**: ツールがネストを公式にサポートするまで採用しない。サポートが分かれば案C の再評価はあり得る。

---

### 案D: 配備しない（正本のみ参照）

- **方式**: プラットフォームの `skills/` にはコピーせず、実行時に常に `.agents/skills/{domain}/{capability}/` を読む。
- **長所**: 衝突が原理的に発生しない。
- **短所**: 各ツールが「プロジェクト内の .agents をスキルルートとしてスキャンする」機能を持っていないと使えない。現状の Claude Code / Cursor の想定は「各ツールの所定の skills ディレクトリに SKILL.md を置く」なので、この方式はツール側の拡張が前提。
- **結論**: ツールが .agents を直接参照する仕様になれば選択肢になる。現時点では前提を満たさない。

---

## 3. 推奨結論（採用済み）

| 方針 | 状態 |
|------|------|
| **案B（プレフィックス `{domain}__{capability}`）** | **採用済み**。scripts/setup-agents-spec.sh の sync_skills で配備先を `{domain}__{capability}` にしている。正本参照（commands, run_command, LOAD_POLICY）は変更不要。 |

案B を採用する場合の **実装の要点**（`setup-agents-spec.sh` の `sync_skills()`）:

- `domain_dir` を走らせるときに `domain=$(basename "$domain_dir")` を取得。
- 配備先ディレクトリ名を `cap_name` ではなく `"${domain}__${cap_name}"` にする。
- 既存の「正本参照」（commands/*.md, run_command, LOAD_POLICY）は **一切変更しない**（正本パスは .agents の domain/capability のまま）。

オプションで、**環境変数やフラグで「フラット／プレフィックス」を切り替え**可能にしておくと、既存プロジェクトはフラットのまま、新規や必要になったプロジェクトだけプレフィックス付きにできる。

---

## 4. プラットフォーム別の注意

- **Claude Code / Cursor**: `<skill-name>` は通常、ディレクトリ名。`requirements__write-bdd` のような名前は多くの場合そのまま使える。スラッシュコマンドが `__` を含むかはツール次第（通常は可）。
- **Gemini CLI / 他**: 同様に、ディレクトリ名がスキル識別子になるなら、`domain__capability` 形式で一意になる。

いずれも **ツールが 1 階層のみスキャンする前提**では、案B が安全。案C はツールの仕様確認後に検討する。

---

## 5. まとめ

- **問題**: 配備先をフラットにしていると、異なる domain の同名 capability が上書きされる。
- **対応**: 案B を採用済み。配備先を `{domain}__{capability}` にしている（setup-agents-spec.sh の sync_skills）。正本参照は変更不要。
- **案C（サブディレクトリ）** はツールのネスト対応状況を見てから検討。
- **案D（配備しない）** はツールが .agents を直接参照する仕様になってから検討。

参照: CONCEPTS.md §既知の将来課題、platforms/SKILLS.md、scripts/setup-agents-spec.sh（sync_skills）。
