# GitHub_Copilot対応 - GitHub Copilot 対応

> 汎用版。Copilot リポジトリ指示の構成・フォーマットを定義。AGENTS/実行ルールは各々参照。**採用先では** `.github/` に `copilot-instructions.md` と `instructions/*.instructions.md` を配置し、本フォーマットに従う。

---

## クイックリファレンス（絶対に守ること）

1. **リポジトリ全体の指示**: 採用先リポジトリの `.github/copilot-instructions.md` に記載する（Chat・Issue 作成・coding agent で参照される）
2. **パス別の指示**: 採用先リポジトリの `.github/instructions/*.instructions.md` に記載する（code review・coding agent でのみ参照される）
3. **応答言語（日本語など）**: リポジトリ全体の指示で明記する。Chat・Issue 作成では path-specific が読まれないため、`copilot-instructions.md` での指定が必須
4. **フォーマット**: 本ドキュメントの「指示ファイルのフォーマット」に従う

---

## GitHub Copilot の指示の種類と参照される機能（GitHub.com）

[Support for different types of custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support) より。本規約を採用するプロジェクトでは、以下の区別を理解した上で配置すること。

| Copilot 機能                    | Repository-wide（`.github/copilot-instructions.md`） | Path-specific（`.github/instructions/*`） |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| **Copilot Chat**                | ✅ 参照する                                          | ❌ **参照しない**                         |
| Copilot coding agent            | ✅                                                   | ✅                                        |
| Copilot code review             | ✅                                                   | ✅                                        |
| **Issue 作成**（Chat 経由想定） | ✅ 参照される想定                                    | ❌ 参照されない                           |

- **Issue 作成が英語になる事象**: Chat・Issue 作成では path-specific が読まれないため、言語指定は `.github/copilot-instructions.md` に記載する必要がある。

---

## 言語設定（応答言語の指定）

- **Repository-wide**: `.github/copilot-instructions.md` に「コードレビュー、チャット、Issue 作成・更新、コメントは常に**〇〇語**で」など、プロジェクトで希望する言語を記載する。
- **Path-specific**: `.github/instructions/` 内のファイルに同様の文言を記載する（code review・coding agent 用）。Chat・Issue 作成では読まれないため、言語統一のためには repository-wide が必須。
- **個人設定**: 希望言語にならない場合は GitHub Copilot Chat → プロフィール → Personal instructions で指定（人間が実施）。

---

## 指示ファイルのフォーマット（テンプレート）

### 1. リポジトリ全体（`.github/copilot-instructions.md`）

- 先頭に frontmatter は不要。Markdown の見出しと箇条書きで記述する。
- 公式では 2 ページ以内を目安とする。

```markdown
# リポジトリ共通指示（Copilot）

- **応答言語**: コードレビュー、チャット、Issue 作成・更新、コメントは常に**日本語**で行ってください。タイトル・本文・ラベル提案を含む。
- （プロジェクト固有のコーディング規約・フレームワーク指定などがあれば追加）
```

### 2. パス別指示（`.github/instructions/NAME.instructions.md`）

- **必須**: ファイル先頭に YAML frontmatter で `applyTo` を指定する。複数パターンはカンマ区切り。
- オプション: `excludeAgent: "code-review"` または `"coding-agent"` で参照する機能を制限できる。
- ファイル名は `*.instructions.md` で終わること。

```markdown
---
applyTo: "**"
---

# 言語設定

- コードレビュー、チャットの回答、コメントは常に**日本語**で行ってください。
```

パスを限定する例（TypeScript/Markdown のみ）:

```markdown
---
applyTo: "**/*.ts,**/*.tsx,**/*.md"
---

# このリポジトリの TypeScript / Markdown 向け指示

- （ここに指示を記載）
```

複数言語・スタイルシート（Laravel / FastAPI / Ruby / Go / CSS・SCSS 等）を含める場合: `applyTo` に `**/*.php`, `**/*.py`, `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less` 等をカンマ区切りで追加する。採用先のスタックに合わせて必要な拡張子のみ残す。

### 3. 新規で path-specific を追加するときのチェックリスト（採用先リポジトリ向け）

- [ ] ファイル名が `NAME.instructions.md` になっているか
- [ ] 先頭に `---` で囲んだ frontmatter があるか
- [ ] `applyTo` に glob を指定しているか（複数はカンマ区切り）
- [ ] 指示本文を Markdown で記載しているか
- [ ] 採用先リポジトリで `.github/instructions/` の役割を README 等に記載したか（推奨）

---

## AI 向け参照

`.github/copilot-instructions.md` や `.github/instructions/*` を編集するときは、本ドキュメントのクイックリファレンス・フォーマット・「どの機能がどの指示を読むか」を確認する。実際のファイルは採用先の `.github/` に配置する。

---

## 参考資料（公式）

- [Support for different types of custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support) — 各機能がどの指示を参照するか一覧
- [Adding repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) — `copilot-instructions.md` と path-specific の作成方法
