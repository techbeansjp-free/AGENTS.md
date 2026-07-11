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

- 新規 command / skill を追加するときは、本契約の見出しに従う。既存の commands/*.md と skills/*/SKILL.md は、追って本契約の見出しに揃える（後方互換のため「Skill chain」「成果物」「DoD」等の併記は可）。
- 監査（review-code, verify-and-close）では、成果物が各 command の OUTPUT / DONE を満たしているかを確認する。
- 参照: CONCEPTS.md（契約付きフィルタ）、workflow/TEMPLATES.md、RULES.md。
