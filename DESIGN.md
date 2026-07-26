# DESIGN: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`〜`AC-4` | `gateReport`関数の成果物検証ロジックを`git show`ベースへ差し替え | `src/commands/verify.ts` |

## 責務・境界

### コンポーネント構成

- `GateReport`インターフェース（`verify.ts`内）に`target_sha: string`フィールドを追加する（`gate-report.schema.yaml`の`gate.target_sha`に対応）。
- `gateReport`関数内の成果物検証ループを、`fs.existsSync`+`digestOfFile`（ファイルシステム参照）から、`git(['show', `${report.gate.target_sha}:${artifact.path}`], repoRoot())`+`digestOf`（Git object参照）へ差し替える。参照ルートは`worktreeRoot()`ではなく`repoRoot()`とする（`git show <sha>:<path>`はcommitさえ到達可能ならcheckout先の実際のブランチに依存しないため、`repoRoot()`で十分。`src/commands/gate.ts`の`artifactDigestAtSha`と同一パターン）。
- `git show`の終了コードが非0の場合を「削除されている」、成功したがdigestが不一致の場合を「digest不一致」として区別する（既存のエラーメッセージ文言・分岐構造は維持する）。

### 依存関係

```text
gate-report.yaml（target_sha・approved_artifacts） → gateReport()
  → git show <target_sha>:<path>（repoRoot()基点）
    → 失敗 → 「削除されています」エラー
    → 成功 → digestOf(blob) と approved_artifacts[].digest を比較
      → 不一致 → 「digest不一致」エラー
      → 一致 → 検証成功
```

`git show <sha>:<path>`は、対象commitがローカルのGit object databaseに到達可能でありさえすれば、現在の作業ツリーが別のブランチ・別のSHAをcheckoutしていても正しく動作する。`verify-and-publish`ジョブは既に`git fetch --no-tags origin "pull/${PR_NUMBER}/head:refs/agent-skill-chain/targets/${HEAD_SHA}"`でPR headをGit objectとしてfetch済みのため、このコマンドに変更を加えることなく`target_sha`のcommitへ到達できる。

## 関連ADR

無し（既存の実装ミスマッチの修正であり、新たな恒久判断を要しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: `target_sha`のcommitがローカルのGit object databaseに存在しない（fetchされていない）環境で実行すると、`git show`が失敗し「削除されている」と誤判定する。
- 対策: `verify-and-publish`ジョブは既にPR headをfetch済みであるため実害はない。ローカル開発機で`gate review`ワーカー自身が実行する経路（`worktreeRoot()`が実際に候補ブランチの場合）でも、そのブランチ自体がcommit済みであれば`target_sha`は到達可能である。
- ロールバック手順: 本Issueのcommitをrevertすれば、Issue #185時点のファイルシステム参照の挙動に戻る（ただし現行のtrusted gate recorder運用ではその挙動が誤動作の原因になるため、ロールバックは推奨しない）。
- 影響を受ける既存機能: `verify gate-report`の成果物検証のみ。他のverifyサブコマンド・他コマンドには影響しない。
