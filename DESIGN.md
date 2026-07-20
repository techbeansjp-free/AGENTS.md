# DESIGN: agent-skill-chain — writer leaseの真の原子性強化・.worktrees未gitignore・gate-report digest不一致検知漏れ

- Issue: `ISSUE-176`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（GitHubモードの二重取得防止） | `src/lib/github-lease.ts`: `refs/agent-skill-chain/leases/<issue>-<segment>` ref への `git push`（force無し）による compare-and-set | `ADR-0002`。既存の投稿→再確認ロジックは廃止 |
| `AC-2`（ローカルモードの二重取得防止） | `src/lib/yaml-io.ts`: `writeYamlFileExclusive`（`O_CREAT\|O_EXCL`）、`src/commands/lease.ts`の`acquire()`local分岐 | ADR不要（既存メカニズムの堅牢化） |
| `AC-3`（.worktrees/のgitignore） | `.gitignore`に`.worktrees/`追加 | ADR不要 |
| `AC-4`, `AC-5`（gate-report digest） | `src/commands/verify.ts`: `gateReport()`の存在チェック条件式修正 | ADR不要（バグ修正） |
| `AC-6`（renew非対称性） | `src/commands/lease.ts`: `renew()`local分岐へ期限切れチェック追加 | ADR不要（バグ修正） |
| `AC-7`（regressionなし） | 全変更単位で既存テストへの影響を個別確認（下記「障害・ロールバック考慮」） | - |

## 責務・境界

- `src/lib/github-lease.ts`（再設計）: GitHubモードのwriter lease正本をIssueコメントからgit ref（`refs/agent-skill-chain/leases/<issue>-<segment>`）へ置換する。Issueコメント投稿は human可視性のためのbest-effort処理として残すが、以後のロジック（競合判定・token検証）には使用しない。
- `src/lib/exec.ts`: 既存の`git(args, cwd)`をそのまま再利用する（新規ヘルパー追加なし）。ref操作はすべて`git`引数配列として組み立てる。
- `src/commands/lease.ts`: `acquire`/`release`/`renew`のGitHubモード分岐を`github-lease.ts`の新API呼び出しへ置換する。CLI引数（`<issue_id> <segment>`／`<issue_id> <token>`）・標準出力（`toYamlString(lease)`）は不変。
- `src/lib/yaml-io.ts`: `writeYamlFileExclusive`を新設し、ローカルモードのacquire専用に使う。`writeYamlFileAtomic`（release/renewが使う既存の上書き用）は無変更。
- `src/commands/verify.ts`: `gateReport()`内の存在チェック条件式のみ修正。
- `.gitignore`: `.worktrees/`を追加。
- `docs/adr/ADR-0002-github-lease-git-ref-cas.md`（新設、`status: proposed`）: GitHubモードのlease正本変更の決定記録。

### 依存関係

```text
lease.ts(acquire/release/renew, githubモード)
  → github-lease.ts(acquireLeaseRef/renewLeaseRef/releaseLeaseRef/activeLeaseFor/activeLeasesFor)
    → exec.ts(git)  ※既存、無変更
    → exec.ts(gh)   ※best-effortコメント投稿のみに縮小

lease.ts(acquire, localモード)
  → yaml-io.ts(writeYamlFileExclusive)  ※新設
  → yaml-io.ts(tryReadYamlFile / writeYamlFileAtomic)  ※既存、release/renewはそのまま使用

segment.ts(activeLeaseFor呼び出し箇所)
  → github-lease.ts(activeLeaseFor)  ※シグネチャ不変、内部実装のみref化
```

循環依存は無い。`lease.ts`・`segment.ts`から見た`github-lease.ts`の公開シグネチャ（`activeLeaseFor`/`activeLeasesFor`の引数・戻り値型）は変更しない。

## GitHubモードのlease原子性（AC-1、ADR-0002）

### ref命名規則

`refs/agent-skill-chain/leases/<issue_number>-<segment>`（例: `refs/agent-skill-chain/leases/176-design`）。SPEC.mdの技術検証がこの命名で実機検証済み。segment単位のrefとすることで、既存の「同一segment内競合」「同issue内の他segment競合（1 Issue同時1つの制約）」という2段階チェック構造をそのまま維持できる（cross-segment検査は`refs/agent-skill-chain/leases/<issue>-*`のmatching refs列挙で行う）。

### push/deleteの実装方法

- **acquire**: `git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "<lease YAML>"`（gitの空tree固定ハッシュを使い、リポジトリ内容に依存しないparentless commitを作る）でlease内容を埋め込んだcommitを作成し、`git push origin <sha>:<ref>`（**force無し**）を実行する。ref不在なら新規作成として成功する。既存refがあれば非fast-forwardとして`[rejected]`で拒否される（SPEC.md技術検証で確認済みの挙動）。
- **renew**: 現在のref先頭commit（`git ls-remote origin <ref>`で取得）を親とする新commit（更新後のexpires_atを埋め込む）を作成し、同じrefへforce無しでpushする。fast-forward条件（現在のref値が新commitの祖先であること）がそのままcompare-and-set条件になる——renew実行者が最後に読んだref値のままであれば成功し、その間に他プロセスがrenewまたは回収していれば非fast-forwardで失敗する。
- **release**: `git push origin --delete <ref>`。
- **lease内容の読み出し**: `git fetch origin <ref>`後、`git log -1 --format=%B <sha>`でcommitメッセージを取得しYAMLとしてparseする（`activeLeaseFor`/`activeLeasesFor`はこの読み出しを内部で行う。外部シグネチャは既存のまま）。

### `exec.ts`との統合

新規ヘルパーは追加しない。既存の`git(args: string[], cwd?: string): ExecResult`をそのまま用い、`github-lease.ts`側でコマンド配列を組み立てる。push失敗の分類（下記）は`ExecResult.stderr`の文字列判定で行う。

### 権限不足時のfallback

pushの失敗理由を2種に分類する。

1. **`[rejected]`を含む失敗**（非fast-forward・既存ref衝突）→ 既存leaseとの競合として扱う（想定内の動作、既存の「conflict」エラーメッセージへ委譲）。
2. **それ以外の失敗**（認証エラー・`contents`権限不足・接続エラー等）→ **既存の楽観的排他制御へは一切フォールバックしない**。「writer lease ref への push に失敗しました（権限または接続の問題の可能性があります）」という別種のエラーメッセージで即座に失敗させる。

fallback先を安全側でなく機能側（旧・楽観的排他制御）に倒すと、権限不足がある環境でTOCTOUウィンドウ付きの弱い保護へ無自覚に後退し、AC-1が保証しようとした性質が運用者に気づかれないまま失われる（安全側ラチェット、I8）。既存の`markActiveWriterLeaseLabel`と同じ「best-effort処理の失敗は握りつぶす」対象は、あくまでIssueコメント投稿・ラベル操作のようなhuman可視性用途に限定し、lease取得の可否そのものを左右する分類には適用しない。

### Issueコメントとの役割分担

`postLeaseComment`は引き続きacquire成功後にbest-effortで呼び出し、Issueタイムライン上の可視性を保つ。ただしコメント本文はもはや読み返さない（`listLeaseComments`/`activeLeaseFor`旧実装は廃止）——正本はgit refのみであり、二重の正本を持たない（AGENTS.md I6「複数のCoordination Backend間で同一Issueの状態を同期しない」の趣旨をGitHubモード内の複数プリミティブ間にも適用する判断）。

## ローカルモードの原子性強化（AC-2）

`src/lib/yaml-io.ts`に`writeYamlFileExclusive(filePath, data): boolean`を新設する。`fs.openSync(filePath, 'wx')`（`O_CREAT|O_EXCL|O_WRONLY`相当、既存ファイルがあれば`EEXIST`で例外）で書き込み、成功時`true`、`EEXIST`時`false`を返す（その他の例外は再送出）。

`lease.ts`の`acquire()`local分岐を次の順序に変更する。

1. 生成したleaseで`writeYamlFileExclusive`を試みる。成功すれば取得完了（既存ファイル無しからの排他生成が真のcompare-and-setになる）。
2. 失敗（`EEXIST`）した場合、既存ファイルを読み込む。有効期限内なら競合として`fail`（rollback不要、何も書いていない）。
3. 期限切れ（stale）なら`fs.unlinkSync`で削除し、`writeYamlFileExclusive`を1回だけ再試行する。再試行も失敗すれば「回収中に別プロセスが再取得した」として`fail`する（無限リトライしない）。
4. 取得成功後にWIP上限チェック（`countLocalActiveWriterLeases`、自分自身を含めた値と`wip.limit`を比較する形に補正——旧実装は書込み前に他issueのみを数えて`>=`判定していたため、書込み後に自分を含めて数える場合は`> limit`が同値の判定になる）を行う。超過していれば直前に書いたlease.yamlを`unlinkSync`で削除してから`fail`する（advisoryなWIP上限のためのロールバックであり、1 Issue内の排他性という主目的の原子性には影響しない）。

release/renewは既存のtoken一致検査＋`writeYamlFileAtomic`（上書き）のままでよいと判断する。理由：token不一致では書き換えができないため、正しいtokenを提示できる主体（＝現在の保持者）以外がrelease/renewを乗っ取ることはできず、存在確認とその後の書込みの間のTOCTOUが問題になるのは「まだ誰も保持していない状態からの新規取得」（acquire）のみである。

## lease renewの期限切れチェック欠落の修正（AC-6）

`src/commands/lease.ts`の`renew()`local分岐（`existing.writer_lease.token !== token`判定の直後、`expires_at`書き換えの直前）に、GitHubモード分岐と同じ判定を追加する。

```ts
if (existing.writer_lease.expires_at <= now.toISOString()) {
  return fail(`lease は既に期限切れです（expires_at=${existing.writer_lease.expires_at}）`);
}
```

`now`は同関数内で既に`const now = new Date();`として宣言済みのものをそのまま使う。GitHubモード分岐の`held.lease.writer_lease.expires_at <= now.toISOString()`と完全に同一の比較式・同一のエラーメッセージ文言にすることで、バックエンド間の非対称性を解消する。

## `verify gate-report`のdigest不一致検知（AC-4, AC-5）

`src/commands/verify.ts`の`gateReport()`内、`approved_artifacts`をループする箇所（現状 `if (fs.existsSync(abs) && digestOfFile(abs) !== artifact.digest) {...}`）を、ファイル削除も不一致として検知する形に修正する。

```ts
for (const artifact of report.gate.approved_artifacts) {
  const abs = path.join(root, artifact.path);
  if (!fs.existsSync(abs)) {
    errors.push(`approved_artifacts のファイルが削除されています（digest不一致として扱います）: ${artifact.path}`);
  } else if (digestOfFile(abs) !== artifact.digest) {
    errors.push(`approved_artifacts の digest が現在のファイル内容と一致しません: ${artifact.path}`);
  }
}
```

既存の「存在するがdigestが異なる」検知（AC-5、regression対象）はそのまま`else if`枝に維持される。

## `.gitignore`への`.worktrees/`追加（AC-3）

`.gitignore`末尾に以下を追加する。

```gitignore
# worktree自体（各worktree配下は独立したリポジトリとして扱われるためgit管理外。
# 空の親ディレクトリのuntracked表示のみを防ぐ）
.worktrees/
```

`hasUncommittedChanges`（`src/lib/worktree.ts`、`git status --porcelain`使用）はgitignore済みパスを自動的に除外するため、コード変更は不要。

## 関連ADR

**新規ADR（ADR-0002）を作成する**（`docs/adr/ADR-0002-github-lease-git-ref-cas.md`、`status: proposed`）。判断根拠は次の通り。

- **要件1（GitHubモードのlease原子性）はADRが必要**: これはwriter leaseという中核不変条件（I2セグメントゲート・I5進行役純粋性の前提）を支える排他制御メカニズム自体の置換であり、AGENTS.md「Coordination Backend」表がGitHubモードの調整状態の正本として列挙する「Issue・PR・branch・Check Run」に、新しいgit ref namespace（`refs/agent-skill-chain/leases/*`）という新しいプリミティブを追加する決定である。加えて、新しい権限要件（fine-grained PAT／GitHub Appの`contents`権限がこのnamespaceへの実pushを許可する必要がある、SPEC.mdが未検証と明記した事項）を運用者に課すため、「なぜこの方式を選んだか」「代替案（楽観的排他制御の維持・強化）を採らなかった理由」を将来の保守者が参照できる形で残す価値がある。ADR-0001の前例（system-spec正本構築という別の中核決定）と同種の重みを持つ判断と判断する。
- **要件2（ローカルモードのO_EXCL化）はADR不要**: スキーマ（`lease.schema.yaml`）・Coordination Backendの正本構造・CLI契約のいずれも変えない、既存メカニズム（ファイルベースのYAML状態）内部の実装堅牢化（read-check-then-writeを真の排他生成へ置換）にとどまる。
- **要件4（gate-report digest）・要件5（renew非対称性）はADR不要**: いずれも既存ロジックの条件式バグ修正であり、新しい状態遷移・新しい正本・新しい権限要件を一切導入しない。Issue #174（doctor拡張等）で確立した「既存機構の入出力契約を変えない追加的拡張・バグ修正にはADRを要しない」という先例と同種の判断。
- **要件3（.gitignore）はADR不要**: リポジトリの`git`管理対象定義の追加のみで、AGENTS.mdが定めるいかなる不変条件・スキーマ・正本構造にも触れない。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - fine-grained PAT／GitHub App installation permissionの`contents`権限がカスタムref namespaceへのpushを許可しない環境が実在する → 上記「権限不足時のfallback」の分類により、acquireは明確なエラーで失敗する（サイレントな機能低下にはならない）。実装Issueで実機検証し、必要ならADR-0002をsupersedeする。
  - ローカルモードの stale reclaim（`EEXIST`→期限切れ確認→unlink→再試行）が同時に2プロセスで発生した場合、再試行後の`writeYamlFileExclusive`のうち1つのみが成功する（原子性はこの最終呼び出しが担保する）。もう一方は`fail`となり、呼び出し元は`lease acquire`をリトライすればよい（既存の呼び出し契約のまま）。
  - `git push`のstderr文言がGitHubのAPIバージョン変更で変わり、`[rejected]`判定が誤分類する可能性 → 実装Issueで判定ロジックの単体テスト（stderrサンプル文字列に対するアサーション）を追加し検知する。
- ロールバック手順: 本Issueの変更単位は (1) `github-lease.ts`のref-based実装への置換、(2) `yaml-io.ts`への`writeYamlFileExclusive`追加＋`lease.ts` local acquireの書換え、(3) `lease.ts` local renewへの期限切れチェック追加、(4) `verify.ts`の`gateReport()`条件式修正、(5) `.gitignore`追加、(6) `ADR-0002`新設、のいずれも既存機能の削除的置換は(1)のみである。(1)を切り戻す場合は`ADR-0002`の`status`を`deprecated`にし、旧・Issueコメントベース実装へ`git revert`する。(2)〜(5)は追加的でありコミット単位でrevert可能。
- 影響を受ける既存機能: `test/unit/github-lease.test.ts`（gh-stub前提のコメントベースAPIテスト、ref前提へ全面書換えが必要）、`test/integration/lease-renew.test.ts`（ローカルバックエンドの非対称性を固定していた既存テストのうち「期限切れ後もrenew成功する」ケースは、AC-6の修正により期待値が反転する——実装Issueで当該テストを更新する）、`launch_worker`（`.agent-skill-chain/adapters/{claude,human,codex}.sh`）・`launch_gate_reviewer`は、CLI引数・標準出力契約が不変のため無変更（`launch_gate_reviewer`はそもそもwriter leaseを取得しないread-only役割のため無関係）。
