<!--
正本: AGENTS.md §不変条件I7 / memo/システム刷新/システム刷新.md §A-9, §3.3
このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
フィールドは schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）と完全一致させること。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# VALIDATION: <Issue タイトル>

```yaml
schema_version: agent-skill-chain/validation-report/v1
issue_id: <ISSUE-123>
target_sha: <検証対象のcommit SHA>
```

## 受入条件ごとの検証記録

SPEC.md に記載された全 AC-ID について、検証方法・結果・証跡を記録する。孤児 AC（記録の無い AC-ID）は不可（I7）。

<!-- 以下のブロックを AC-ID の数だけ複製する -->

### `<AC-1>`

```yaml
ac_id: <AC-1>
verification:
  mode: <automated | manual | hybrid>
  result: <pass | fail>
  # mode が manual または hybrid の場合、reason / procedure / executor は必須
  reason: "<自動化できない理由（mode=manual|hybridの場合必須）>"
  procedure: "<検証手順（mode=manual|hybridの場合必須）>"
  executor: "<実行者または実行エージェント（mode=manual|hybridの場合必須）>"
evidence:
  - "<証跡へのパス・リンク（テストファイル・スクリーンショット・ci-run等）>"
```

### `<AC-2>`

```yaml
ac_id: <AC-2>
verification:
  mode: <automated | manual | hybrid>
  result: <pass | fail>
evidence:
  - "<証跡へのパス・リンク>"
```

## 回帰テスト

```yaml
regression:
  executed: <true | false>
  evidence:
    - "<証跡へのパス・リンク（例: ci-run:12345）>"
```
