# DESIGN: verify gate-reportがprotected base checkoutではなくtarget_shaのGit objectを見るべき

- Issue: `ISSUE-316`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`〜`AC-3` | `gateReport`関数の成果物検証ロジックを`git show`ベースへ差し替え | `src/commands/verify.ts` |
| `AC-4` | 既存の`verify gate-report`統合テストをcommit前提へ改訂 | `test/integration/verify.test.ts`。ISSUE-176 AC-4テストは意味論変更のため退役（後述） |
| `AC-5`, `AC-6` | `sentinelExempt`分岐（`report.gate.id === 'implementation'`かつ`digest === ABSENT_ARTIFACT_DIGEST`の場合のみ検証成功） | `src/commands/verify.ts`。`ABSENT_ARTIFACT_DIGEST`は`gate.ts`からexportし`verify.ts`がimportする |
| `AC-7` | 追加の設計要素なし（`AC-1`〜`AC-3`と同一の`git show`ベース検証ロジックが、backendの種類に関わらずそのまま適用される） | `src/commands/verify.ts`。`gateReport`関数はGitHub/ローカルのbackend種別を検証ロジック上区別しないため、ローカルモード専用の分岐は設けない |

## 責務・境界

### コンポーネント構成

- `GateReport`インターフェース（`verify.ts`内）に`id: string`・`target_sha: string`フィールドを追加する（`gate-report.schema.yaml`の`gate.id`・`gate.target_sha`に対応）。
- `gateReport`関数内の成果物検証ループを、`fs.existsSync`+`digestOfFile`（ファイルシステム参照）から、`git(['show', `${report.gate.target_sha}:${artifact.path}`], repoRoot())`+`digestOf`（Git object参照）へ差し替える。参照ルートは`worktreeRoot()`ではなく`repoRoot()`とする（`git show <sha>:<path>`はcommitさえ到達可能ならcheckout先の実際のブランチに依存しないため、`repoRoot()`で十分。`src/commands/gate.ts`の`artifactDigestAtSha`と同一パターン）。
- `git show`の終了コードが非0の場合、`sentinelExempt = report.gate.id === 'implementation' && artifact.digest === ABSENT_ARTIFACT_DIGEST`を評価する。`sentinelExempt`が真なら検証成功（implementation gateがsentinelで正当に記録した欠落）、偽なら「削除されている」エラーとする。`git show`が成功したがdigestが不一致の場合は無条件に「digest不一致」として扱う（既存のエラーメッセージ文言・大枠の分岐構造は維持しつつ、sentinel分岐のみ新設する）。
- `ABSENT_ARTIFACT_DIGEST`（元は`gate.ts`内の非export定数）を`gate.ts`から`export`し、`verify.ts`が`import { ABSENT_ARTIFACT_DIGEST } from './gate.js';`で参照する。`verify.ts`→`gate.ts`の新規モジュール依存が発生するが、`gate.ts`→`verify.ts`方向の既存importは無いため循環importは生じない。sentinel値の定義元は`gate.ts`のまま単一に保つ（`verify.ts`側で値を再定義・複製しない）。

### 依存関係

```text
gate-report.yaml（gate.id・target_sha・approved_artifacts） → gateReport()
  → git show <target_sha>:<path>（repoRoot()基点）
    → 失敗
      → gate.id === 'implementation' かつ digest === ABSENT_ARTIFACT_DIGEST（gate.tsからimport）
        → true  → 検証成功（sentinelによる正当な欠落記録）
        → false → 「削除されています」エラー
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
- 意味論変更（ISSUE-176 AC-4の退役）: ISSUE-176 AC-4が保証していた「承認後にworktreeのファイルシステム上で成果物が削除・改変されたことを検知する」という性質は、target_sha（不変のcommit SHA）基準の検証へ移行したことで意味を持たなくなる（同一target_shaのGit blobは常に同一内容であり、working directory側の変更を検知する対象がそもそも存在しない）。この保証はSPEC.mdのAC-3補足が明記する通り「digestフィールド自体の記録時不整合の検出」へ性質が変わる。ISSUE-176 AC-4を直接検証していた統合テストは、この意味論変更に伴い退役し、代わりに本IssueのAC-1・AC-2（`test/integration/verify.test.ts`内の対応テスト）が新しい意味論での正当性を検証する。承認後の作業ツリー改ざんそのものを継続監視する責務は、本Issueの対象外であり、`gate reconcile`（push毎の成果物digest再照合、既存機構）が引き続き担う。
- 意図された挙動（AC-7・ローカルモード）: `gate review`が捕捉する`target_sha`はworktree HEADであるため、`approved_artifacts`対象ファイルが未commitまたはcommit後に編集されている場合、後続の`verify gate-report`はGitHubモードと同一の`git show`ベース検証ロジックにより「削除されています」または「digest不一致」として拒否する。これはbackend種別による分岐を持たない設計（上記対応表のAC-7行）の直接の帰結であり、AGENTS.md I3（セグメント完了ごとのcommitによる耐久性）が要求するworkflowをfail-closedに強制する副次効果として意図的に許容する。ローカルモード専用の緩和・回避分岐は設けない。
