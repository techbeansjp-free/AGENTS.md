# IO_CONTRACT — command / skill の共通入出力契約

**目的**: すべての command と skill を **契約付きフィルタ** にする。手順書ではなく **同一インターフェース** で定義し、pipe 可能・機械的検証可能にする。UNIX の stdin → program → stdout に対応する。

---

## 原則

- **command = filter**。INPUT → PROCESS（skill chain）→ OUTPUT。DONE で完了条件、ERROR/Forbidden で異常・禁止を定義する。
- **skill = filter**。Inputs → Process → Outputs。Done（完了条件）・Forbidden（禁止）を定義する。
- 契約が揃うと、orchestrator は「phase → command 選択 → pipe」の scheduler になり、enforcement は「output が契約を満たすか」で検証できる。

---

## Command の契約セクション（必須）

各 `commands/*.md` は次の見出しを持つ。既存の「Skill chain」「成果物」「DoD」をこの対応に揃える。

| 見出し | 内容 |
|--------|------|
| **INPUT** | この command が受け取るもの。issue パス・context・spec 参照・前段 command の OUTPUT など。 |
| **PROCESS** | 実行する skill chain（どの skill をどの順で）。従来の「Skill chain」に相当。 |
| **OUTPUT** | この command が生成する成果物（ファイル名・形式）。従来の「成果物」に相当。 |
| **DONE** | 完了条件（DoD に相当）。満たしたら完了。 |
| **ERROR / Forbidden** | 異常時・禁止事項。省略可だが書くと enforcement で参照しやすい。 |

---

## Skill の契約セクション（必須）

各 `skills/{domain}/{capability}/SKILL.md` は次の見出しを持つ。既存の「目的」「手順」「成果物の形式」「制約・禁止」をこの対応に揃える。

| 見出し | 内容 |
|--------|------|
| **Purpose** | この capability の目的。1 文。 |
| **Inputs** | この skill が受け取るもの（前段の OUT・参照ファイル・Constraints）。 |
| **Process** | 手順（ステップ列）。 |
| **Outputs** | この skill が生成するもの（ファイル・OUT の形式）。 |
| **Done** | 完了条件。満たしたら次の skill へ渡せる。 |
| **Forbidden** | 禁止事項。制約・禁止に相当。 |

---

## 運用

- **新規 command / skill は猶予なし**: 新規に追加する `commands/*.md`・`skills/*/SKILL.md` は、作成時点で必ず本契約の見出し（command は INPUT/PROCESS/OUTPUT/DONE、skill は Purpose/Inputs/Process/Outputs/Done/Forbidden）に従う。後方互換の併記（「Skill chain」「成果物」「DoD」等）を新規ファイルの言い訳にしてはならない。
- **既存 skill の変換 TODO（意味判定を排した機械チェック）**: 下記「既存 skill 契約見出し変換 TODO」表は、**猶予の根拠ではなく、6 見出しへの変換が未完了な skill を追跡する変換 TODO リスト**である。「実質的な内容変更を伴う改修か typo か」という機械チェック不能な意味判定は監査基準として採用しない。
  - **監査基準（機械チェックのみ・意味判定なし）**:
    1. 下表に**無い** skill の SKILL.md に Purpose/Inputs/Process/Outputs/Done/Forbidden の 6 見出しが揃っていない → **FAIL**。
    2. 下表に「未対応（変換 TODO）」として列挙されている skill は、6 見出しに揃うまで**機械 FAIL 対象**とする（コミット内容の意味判定は行わない。変更の有無にかかわらず対象）。
    3. 下表の行は、当該 skill の SKILL.md を 6 見出しへ揃えた時点で「対応済」に更新すること。以後は通常の必須ルール（変換 TODO から除外）に戻る。
  - 見出しの表記は `## Purpose` のような Markdown 見出しを既定とするが、`review-architecture`/`review-code` のように Purpose のみ `**Purpose**:` 太字表記でも、Inputs/Process/Outputs/Done/Forbidden が見出しとして揃っていれば「対応済」とみなす（既存の合理的な表記ゆれを許容する）。
  - **本リストに列挙された skill の 6 見出し変換自体（実 SKILL.md の書き換え）は、本パッケージ（領域A/B 所有ファイル）の外側の作業であり、対象 skill 個別の改修 issue で実施する（一覧化と機械チェック定義のみが本ファイルの責務）。**

### 既存 skill 契約見出し変換 TODO（棚卸し・2026-07-14 時点）

| skill | 対応状況 | 備考 |
|---|---|---|
| `skills/agent/SKILL.md` | 対応済 | command 実行の入口（run_command）。本節の変換 TODO 明文化と合わせて 6 見出しを追加（委譲の形・実行要領等の既存内容は不変） |
| `skills/requirements/write-bdd/SKILL.md` | 対応済 | 6 見出しあり |
| `skills/review/review-architecture/SKILL.md` | 対応済 | Purpose は太字表記、Inputs/Process/Outputs/Done/Forbidden は見出しあり |
| `skills/review/review-code/SKILL.md` | 対応済 | 同上 |
| `skills/architecture/define-boundaries/SKILL.md` | 未対応（変換 TODO） | 旧形式（手順/制約・禁止/成果物の形式） |
| `skills/architecture/design-api-contract/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/architecture/review-dependencies/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/implementation/implement-change/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/implementation/refactor-safely/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/logging/write-workflow-log/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/requirements/define-constraints/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/requirements/extract-goals/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/requirements/identify-assumptions/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/testing/generate-scenarios/SKILL.md` | 未対応（変換 TODO） | 同上 |
| `skills/testing/map-coverage/SKILL.md` | 未対応（変換 TODO） | 同上 |

- 監査（review-code, verify-and-close）では、成果物が各 command の OUTPUT / DONE を満たしているかを確認する。
- 参照: CONCEPTS.md（契約付きフィルタ）、workflow/TEMPLATES.md、RULES.md。
