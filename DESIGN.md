# DESIGN: npm 配布物から runtime 履歴・自己拡張固有文書・インストール状態を除外する

- Issue: `ISSUE-244`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `package.json` の `files` 許可リスト | runtime、project、状態マーカーを列挙対象から外す |
| `AC-2` | `package.json` の namespace 指定と package-files テスト | 8つの導入資産 namespace を代表ファイルで検査する |
| `AC-3` | package-files テストの除外検査 | 保守者向けソース、テスト、設定、文書を検査する |

## 責務・境界

### コンポーネント構成

- `package.json`: npm に公開するファイル集合を、導入対象 namespace とルート資産へ限定する。
- `test/integration/package-files.test.ts`: `npm pack --dry-run --json` の実測結果が配布契約に一致することを検証する。
- `docs/adr/ADR-0008-npm-package-asset-allowlist.md`: `.agent-skill-chain/` の配布境界を許可リストとして選ぶ判断を記録する。

### 依存関係

```text
package.json files → npm pack --dry-run --json → package-files integration test
```

テストは生成されたファイル一覧だけを判定し、init/upgrade 実装のコピー規則を重複して実装しない。必須資産の代表ファイルは `NAMESPACED_ENTRIES` と同じ8 namespaceを網羅する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0008
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード: 新しい配布資産を namespace 許可リストへ加え忘れ、consumer の init/upgrade が資産を見つけられない。
- ロールバック手順: `package.json` の `files` と package-files テストの必須リストを直前の配布契約へ戻し、再度 `npm pack --dry-run --json` を検証する。
- 影響を受ける既存機能: npm から導入する consumer project の init、upgrade、enforce、および保守者の npm publish 手順。
