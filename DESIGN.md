# DESIGN: release bump が package-lock.json 不在の consumer project で必ず失敗する

- Issue: `ISSUE-243`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `release.ts` の stage 対象選択 | lockfile があれば既存どおり両ファイルを stage する |
| AC-2 | `release.ts` の stage 対象選択 | `fs.existsSync` によって package.json だけを stage する |
| AC-3 | `BUMP_PR_ALLOWED_FILES` と結合テスト | 許可集合とスコープ検査を変更しない |

## 責務・境界

### コンポーネント構成

- `writeBumpedVersionFiles`: package.json と、存在する場合の lockfile の版数を書き換える。
- `bump` / `rebuildBumpBranchToMain`: 書換え後に実在するファイルだけを stage・commit・push する。
- release 結合テスト: 実 Git と gh stub を介し、両構成の CLI 成功と変更集合を検証する。

### 依存関係

```text
lockfile の存在判定 → stage 対象配列 → git add → commit / PR scope check
```

存在判定は既存の書換えロジックと同じく実ファイルシステムだけに依存する。PR のスコープ検査は変更ファイル集合を検査する責務を維持し、stage 対象の分岐はその許可集合を変更しない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0005
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード: lockfile がないのに pathspec へ含めると `git add` が失敗する。
- 対策: `package.json` を常に含め、lockfile は存在時のみ含める配列を使う。
- ロールバック手順: この変更を revert すれば従来の挙動へ戻るが、lockfile なしのリリースは再び失敗する。
- 影響を受ける既存機能: lockfile ありの bump、再構築経路、PR scope safety。
