# delegate_to_sub（唯一の入口）

サブエージェント呼び出しは**必ずここを経由**する。サブの直接呼び出しは禁止。

---

## 目的

- 入力を正規化する
- 注入順序を固定する
- 制約を強制する
- ログ委譲を統一する

**最小読込保証**: サブに渡すコンテキストは [SUBAGENT](../../boot/SUBAGENT.md) の注入順序で組み立てる。

---

## 親 → delegate の入力形式（絶対固定）

この形式以外は受け付けない。

**intent / Task**: EXECUTION_CONTRACT の Task と同義。達成すべき結果を 1 文で表す**結果述語**（〜が揃った状態を出す／〜を完了する）で書く。

```json
{
  "role": "implementer | reviewer | tester | auditor | scribe",
  "task_id": "YYYYMMDD_HHMMSS_xxx",
  "intent": "1文で目的を書く（結果述語で書く）",
  "inputs": {
    "artifacts": ["対象ファイルパス", "関連資料"],
    "context": ["必要最小限の背景情報"]
  },
  "constraints": [
    "禁止事項",
    "必須事項"
  ],
  "expected_output": {
    "format": "markdown",
    "sections": ["結論", "理由", "提案", "リスク"]
  }
}
```

**role と workers 6 人格の対応**（矛盾を避けるため固定）: 要件BDDリード・総合レビューリード → `reviewer`。実装者 → `implementer`。テスト者 → `tester`。監査者 → `auditor`。書記 → `scribe`。委譲時は [LOAD_POLICY 4. フェーズ→worker](../../boot/LOAD_POLICY.md) の表で worker を選び、上記対応で `role` を設定する。

**テンプレ利用時の注意**: Task（intent）は結果述語で 1 文に書く。

### 既定値（未指定時）

- **expected_output.format**: `markdown`
- **expected_output.sections**: `["結論", "理由", "提案", "リスク"]`
- **constraints**: 既定で次を追加する — 「推測禁止」「書記以外ログ禁止」「許可されていない Write/Edit 禁止」

---

## 注入順序（絶対固定）

1. [SUBAGENT.md](../../boot/SUBAGENT.md) の順序に従う（SUBAGENT 内の「サブが守ること」→ TOOLS → EXECUTION_CONTRACT → rules 最小限 → workers 1 つ → JSON ペイロード）

---

## 処理手順

1. 入力 JSON を検証（必須キー存在確認）
2. [SUBAGENT](../../boot/SUBAGENT.md) の順序で連結
3. 対象ロールの workers/*.md を注入
4. JSON ペイロードを末尾に添付
5. サブエージェントを実行
6. 結果を受け取る
7. **role ≠ scribe の場合**、書記サブへログ委譲（下記形式で渡す）

**委譲の証跡（推奨）**: 委譲のたびに、Task/Constraints/OutputSpec の要約を memo に 1 行で追記することを推奨する（後から委譲内容を検証するため）。

---

## 実行後のログ委譲（固定）

role が scribe 以外のとき、**必ず** 書記サブに [scribe/CONTRACT](../../scribe/CONTRACT.md) **§2 のペイロード形式**で 1 件渡す。形式・必須キーは CONTRACT 以外で変更してはならない。

- **使用する形式**: [CONTRACT §2 メイン→書記に渡すペイロード](../../scribe/CONTRACT.md) の JSON のみ。キー名・必須の有無を変えない。
- **必須キー**: issue_id, timestamp, created_at, agent_id, action_type, target_artifact, summary をすべて含める。action_type は [EXECUTION_CONTRACT §2.1](../../boot/EXECUTION_CONTRACT.md) の表に従う。
- 書記は受け取ったペイロードを **workflow.db にのみ** 1 件 INSERT する。`.workflow/**/logs/` は廃止・使用禁止。

---

## 呼び出し前チェック

- **inputs.artifacts** が空 → 渡さない（対象を 1 つ以上指定させる）
- **expected_output.format** 未指定 → `markdown` に固定
- **constraints** に禁止が無い → 既定の禁止を注入

---

## 禁止事項

- サブの直接呼び出し
- 書記以外のログ作成
- 注入順序の変更

---

## 参照

- 注入順序: [SUBAGENT](../../boot/SUBAGENT.md)
- 書記契約: [scribe/CONTRACT](../../scribe/CONTRACT.md)
- 抜かし防止: [WORKFLOW](../../WORKFLOW.md)
