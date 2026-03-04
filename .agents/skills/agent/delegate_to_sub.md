# delegate_to_sub（唯一の入口）

サブエージェント呼び出しは**必ずここを経由**する。サブの直接呼び出しは禁止。

---

## 目的

- 入力を正規化する
- 注入順序を固定する
- 制約を強制する
- ログ委譲を統一する

**最小読込保証**: サブに渡すコンテキストに [SUBAGENT_MINIMUM](../../boot/SUBAGENT_MINIMUM.md) を必ず含め、[SUBAGENT_PACK](../../boot/SUBAGENT_PACK.md) の順序で組み立てる。

---

## 親 → delegate の入力形式（絶対固定）

この形式以外は受け付けない。

```json
{
  "role": "implementer | reviewer | tester | auditor | scribe",
  "task_id": "YYYYMMDD_HHMMSS_xxx",
  "intent": "1文で目的を書く",
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

### 既定値（未指定時）

- **expected_output.format**: `markdown`
- **expected_output.sections**: `["結論", "理由", "提案", "リスク"]`
- **constraints**: 既定で次を追加する — 「推測禁止」「書記以外ログ禁止」「許可されていない Write/Edit 禁止」

---

## 注入順序（SUBAGENT_PACK 準拠・絶対固定）

1. [SUBAGENT_MINIMUM.md](../../boot/SUBAGENT_MINIMUM.md)
2. [TOOLS.md](../../boot/TOOLS.md)
3. [EXECUTION_CONTRACT.md](../../boot/EXECUTION_CONTRACT.md)
4. rules（当該ロール必須分のみ）
5. workers（当該ロール 1 つ）
6. 上記 JSON ペイロード

---

## 処理手順

1. 入力 JSON を検証（必須キー存在確認）
2. [SUBAGENT_PACK](../../boot/SUBAGENT_PACK.md) の順序で連結
3. 対象ロールの workers/*.md を注入
4. JSON ペイロードを末尾に添付
5. サブエージェントを実行
6. 結果を受け取る
7. **role ≠ scribe の場合**、書記サブへログ委譲（下記形式で渡す）

---

## 実行後のログ委譲（固定）

role が scribe 以外のとき、必ず scribe に次を渡す。

```json
{
  "issue_id": "<task_id>",
  "agent_id": "<role>",
  "action_type": "plan | execute | review",
  "target_artifact": "<主要対象>",
  "summary": "<3行以内要約>"
}
```

書記は [scribe/CONTRACT](../../scribe/CONTRACT.md) に従い **workflow.db にのみ** 1 件記録する。`.workflow/**/logs/` は廃止・使用禁止。

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

- 注入順序: [SUBAGENT_PACK](../../boot/SUBAGENT_PACK.md)
- 書記契約: [scribe/CONTRACT](../../scribe/CONTRACT.md)
- 抜かし防止: [rules/サブエージェント抜かし防止](../../rules/サブエージェント抜かし防止.md)
