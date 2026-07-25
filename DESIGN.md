# DESIGN: release bump のbase更新競合を再同期・再試行して自動統合を継続する

- Issue: `ISSUE-266`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `src/commands/release.ts` のbump merge器 | `Base branch was modified` を限定判定し、再同期後に一度だけ再mergeする。 |
| `AC-2` | bump PRスコープ検査と再同期エラー変換 | 再同期の前後で検査し、fetch・rebuild・push・再merge失敗は `human_required` にする。 |
| `AC-3` | release workflowの既存bump成功契約と結合テスト | bumpが成功終了し、workflowが `origin/main` を解決してtag/publishへ渡せることを検証する。 |
| `AC-4` | 既存のmerge失敗分岐と結合テスト | 非対象エラーは従来の即時失敗、スコープ違反はmerge前停止を維持する。 |

## 責務・境界

### コンポーネント構成

- `release.bump`: branch作成・既存branchの乖離修復・PR解決・スコープ検査・admin mergeを担う。base更新競合のみを識別し、最大一度の再同期を制御する。
- `rebuildBumpBranchToMain`: `origin/main` を親に版数台帳だけを再生成して `--force-with-lease` pushする。競合解決や任意ファイルの変更は担わない。
- `checkBumpPrScope`: 再試行前後を含む各admin mergeの直前に、head名と許可ファイル集合を検査する。
- `gh-stub` とrelease統合テスト: PR作成直後にmainが前進する実競合を再現し、再同期・同一PR再試行・tag/publish継続を検証する。

### 依存関係

```text
release.bump → GitHub PR merge
    └─ base更新競合 → git fetch origin → checkBumpPrScope → rebuildBumpBranchToMain
        → checkBumpPrScope → GitHub PR merge（最大1回）
release workflow → bump成功 → origin/main SHA解決 → tag → publish
```

最初のmergeが対象外エラーなら上の再同期経路へ入らない。対象エラーでも、再同期の一工程でも失敗すればそこで停止し、merge回数の上限は初回と再試行の2回である。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0005
    relation: references
```

## 障害・ロールバック考慮

- 想定される失敗モード: GitHubのbase更新競合、fetch失敗、PRのスコープ逸脱、force-with-lease競合、再試行merge失敗、認証失敗。
- 安全側の動作: base更新競合だけを対象にし、再同期中の失敗は `human_required` で停止する。通常の `--admin` 以外のmerge方式や無条件の強制mergeは使わない。
- ロールバック手順: この変更を戻せば、release bumpは従来どおり初回merge失敗で停止する。途中に残ったOPEN PRは許可ファイル集合を確認した上で人間が再実行またはマージする。
- 影響を受ける既存機能: main pushで動くrelease workflow、短命の `release/bump-v<version>` PR、tagおよびGitHub Release作成。
