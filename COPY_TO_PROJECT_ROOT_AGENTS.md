# COPY_TO_PROJECT_ROOT_AGENTS

このドキュメントは、AGENTS-spec を任意のプロジェクトへ導入するための「コピー手順の唯一の正解」です。目的は、**サブエージェント運用が人為ミスでも破綻しない（壊れない）**状態を最短で作ることです。

---

## 目的

- サブエージェント呼び出しを **入口一本化（delegate_to_sub 経由）** で強制する
- 書記のみログを書き、**logs/ 以外への書き込みを禁止**する
- Claude Code は **PreToolUse により物理的に拒否**
- Cursor は **役割別サブ定義 + CI 監査**で実質的に拒否
- ログ形式は **契約（CONTRACT）で固定**し、監査可能にする

---

## コピー対象一覧（プロジェクトルートに配置）

以下を **プロジェクトルート直下**へコピーします。

```
.agents/
.workflow/
```

既存の `.agents/` や `.workflow/` がある場合は、衝突しないように **上書きではなくマージ**してください。ただし、本文に記載の「強制構造ファイル」は最新版を優先します。

---

## 必須ファイル（壊れないための最小セット）

以下が揃っていれば「強制構造」として成立します。

```
.agents/
  boot/
    SUBAGENT_MINIMUM.md
    SUBAGENT_PACK.md
    TOOLS.md
    EXECUTION_CONTRACT.md
  skills/
    agent/
      delegate_to_sub.md
  rules/
    サブエージェント抜かし防止.md
  scribe/
    CONTRACT.md
  enforcement/
    claude/
      pretooluse_write_guard.json
      README.md
    cursor/
      README.md
      agents/
        workflow-implementer.md
        workflow-reviewer.md
        workflow-tester.md
        workflow-auditor.md
        workflow-scribe.md

.workflow/
  templates/
    github/
      scripts/
        subagent-guard.sh
      workflows/
        subagent-guard.yml
```

---

## 実運用ルール（絶対）

### サブエージェント呼び出し

- サブエージェントは **必ず** `.agents/skills/agent/delegate_to_sub.md` を経由する
- サブを直接呼び出す運用は禁止（レビューで即修正）

### ログ

- ログを書けるのは **書記（scribe）だけ**
- ログ保存先は **`.workflow/**/logs/` のみ**
- ログ形式は `.agents/scribe/CONTRACT.md` に必ず従う

---

## Claude Code の有効化（物理強制）

Claude Code は **PreToolUse** により、logs/ 以外の Write/Edit を物理的に拒否します。

### 手順

1. プロジェクト内の以下ファイルを確認
   - `.agents/enforcement/claude/pretooluse_write_guard.json`
   - `.agents/enforcement/claude/README.md`
2. Claude Code 側の設定で、PreToolUse フックとして `pretooluse_write_guard.json` を登録する

重要: この登録が完了すると、logs/ 以外への書き込みは「人が間違えて指示しても」拒否されます。

---

## Cursor の有効化（役割別サブ + CI強制）

Cursor は物理フックが弱い環境があるため、以下で強制します。

- 書記以外のサブは **Read-only（可能な範囲で）**
- 書記のみ logs/ に Write 可能
- CI が「不正ログ」「ログ形式違反」を検出したら落とす

### 手順

1. `.agents/enforcement/cursor/README.md` を確認
2. Cursor のサブエージェント定義として、以下を参照・コピー（環境に合わせて配置）
   - `.agents/enforcement/cursor/agents/workflow-implementer.md`
   - `.agents/enforcement/cursor/agents/workflow-reviewer.md`
   - `.agents/enforcement/cursor/agents/workflow-tester.md`
   - `.agents/enforcement/cursor/agents/workflow-auditor.md`
   - `.agents/enforcement/cursor/agents/workflow-scribe.md`

重要: 書記以外は「絶対に書かない」を定義内に明記し、運用上も徹底します。

---

## CI 強制（最終防衛ライン）

CI で以下を監査し、違反があれば PR/Push を失敗させます。

- logs/ 以外に「ログっぽい frontmatter（issue_id 等）」が存在する
- logs/ 配下のログが CONTRACT 必須キーを満たさない

### 手順

1. `.workflow/templates/github/scripts/subagent-guard.sh` が存在することを確認
2. `.workflow/templates/github/workflows/subagent-guard.yml` を GitHub Actions として有効化（既存 CI に統合する場合は、同等の step を追加する）

---

## スモークテスト（導入後に必ず1回実施）

### テストA（実装者）

- implementer を呼ぶ
- **ファイルは書かない**
- 結果は親へ返すのみ

### テストB（書記）

- scribe を呼ぶ
- `.workflow/**/logs/` に **1ファイルだけ**書く
- CONTRACT の必須キーが揃っている

### テストC（意地悪）

- scribe に「logs 以外へ書け」と指示する
- Claude：**物理的に拒否**
- Cursor：定義とルールにより拒否（万一書けても CI で落ちる）

---

## 変更してよいもの／変更してはいけないもの

### 変更してよい

- workers の役割追加
- rules の追加（既存の強制を弱めない範囲）
- templates の追加

### 変更してはいけない（壊れない条件）

- `SUBAGENT_PACK` の注入順序
- `delegate_to_sub` の入口一本化
- logs/ 以外への書き込み許可
- `SCRIBE CONTRACT` の必須キー削除
- CI 監査の撤去（最低限の監査は維持）

---

## 導入完了条件

以下が満たされれば導入完了です。

- サブ呼び出しが delegate 経由で統一されている
- 書記以外がログを書けない（Claudeは物理拒否 / CursorはCI拒否）
- CI 監査が有効で、違反が落ちる
- スモークテスト A/B/C が通る

---

## 規約本文への参照

- 規約本体: [AGENTS.md](./AGENTS.md)
- メインの入口: [.agents/boot/CORE.md](./.agents/boot/CORE.md)、[.agents/boot/LOAD_POLICY.md](./.agents/boot/LOAD_POLICY.md)
