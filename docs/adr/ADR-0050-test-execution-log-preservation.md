# ADR

```yaml
id: ADR-0050
status: proposed
title: テスト実行ログを常時保存する
tags: [ci, observability, test]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`npm test` の間欠的失敗が一度発生したが、完全な出力が保存されず失敗テストとエラーを特定できなかった。Actions UI の表示だけでは、失敗出力を後から安定して調査できない。原因未特定のためテスト実行方式を変えて再現を隠すことは避ける必要がある。

## Decision

CI は `npm test` の標準出力・標準エラー出力を単一ログへ保存し、テストの成否に関係なく artifact として upload する。独立検証では `TEST_POLICY.md` が同等のログ保存と `VALIDATION.md` の証跡記録を要求する。失敗時は Issue #236 を更新し、タイミング、順序、リソース競合、非同期 race condition を評価する follow-up Issue を起票する。

## Consequences

失敗時のテスト名、エラー、スタックトレースを調査可能になり、原因特定を次の実行へ持ち越さない。一方で artifact 保存量と CI 定義が増える。テスト終了コードと並列度は変更しないため、既存の失敗検知と実行特性を保つ。
