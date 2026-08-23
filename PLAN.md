# PLAN: Orphaned active writer lease recovery

- Issue: `ISSUE-820`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力・制約

目的は、DESIGNで定義した lease lifecycle、共有claim、trusted terminal attestation、Backend-native auditを、既存のGitHub ref CASとlocal stateへ段階的に実装することである。入力は承認済みSPEC、proposed ADR、既存lease/report/launcher実装。出力は実装・自動テスト・検証証跡である。各単位は常にfail-closedに保ち、途中段階でactive recoveryを公開しない。実装順序だけの変更は本ファイル、責務や原子性境界の変更はDESIGNと設計ゲートを更新する。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | schemaと純粋domain | lease v1/v2互換、lifecycle/report/audit fields、canonical digest・terminal predicateを追加 | AC-1, AC-2, AC-7 | なし |
| 2 | Backend lease storeとclaim | GitHub claim ref CAS、local O_EXCL claim/atomic CAS、public recovery readerを実装 | AC-4, AC-7 | #1 |
| 3 | credential-auth v2移行 | acquireをv2化し、legacyはcredential+branch+worktree確認時だけCAS移行。renew/release/statusをclaim-aware化 | AC-2, AC-4, AC-6, AC-7 | #1, #2 |
| 4 | claim-bound report | runtime metadata自動注入、GitHub/local publication read-back、report-set digestを実装 | AC-1, AC-2, AC-4, AC-5, AC-7 | #1, #2, #3 |
| 5 | trusted runtime lifecycle | begin/started/terminal CLI、start barrier、継続wait、terminal attestationを同期/dispatch起動へ統合 | AC-1, AC-2, AC-4, AC-7 | #1〜#4 |
| 6 | Backend audit ledger | 予約/最終payload、GitHub Issue/local state append+read-backを実装 | AC-5, AC-7 | #1, #2 |
| 7 | recovery transaction | `lease reclaim`を明示holder+digest、二回再観測、audit、final CAS、partial successへ置換 | AC-1〜AC-7 | #1〜#6 |
| 8 | concurrency/fault/security tests | race、stale proof、dirty/unpushed、Backend audit、canary、post-delete failureを網羅 | AC-1〜AC-7 | #1〜#7 |
| 9 | full regressionと配布検査 | build、test、lint、verify、package assets、exact diffを確認 | AC-1〜AC-7 | #8 |

## 変更対象の詳細

### #1 schemaと純粋domain

- `.agent-skill-chain/schemas/lease.schema.yaml`: legacy v1とpublic v2、generation/runtime/attestationを定義する。
- `.agent-skill-chain/schemas/worker-report.schema.yaml`: lease digest/generation/runtime/created_atを後方互換optionalとして追加する。
- `.agent-skill-chain/schemas/state.schema.yaml`: append-only `lease_recovery_audit` をoptional追加する。
- `src/lib/lease-lifecycle.ts`（新規）: canonical serializer、3 digest、state transition、terminal proof検証。
- `src/lib/schema.ts`、`test/unit/schema.test.ts`: examplesとvalidator回帰。
- `test/unit/lease-lifecycle.test.ts`（新規）: key順/時刻/path正規化、token/verifier非関与、stale generation/runtime/report、starting/running/unknown拒否。

### #2 Backend lease storeとclaim

- `src/lib/lease-store.ts`（新規）: store interface、claim types、shared transaction helper。
- `src/lib/github-lease.ts`: v2 public record read/CAS、claim ref create/read/delete、expected revision conflict分類。legacy recoveryはpublic commit messageだけを読む。
- `src/lib/local-lease.ts`（新規）、`src/lib/local-state.ts`: public lease path、claim path、O_EXCL、owner nonce検査、atomic rename。
- `test/unit/github-lease.test.ts`、`test/unit/local-lease.test.ts`（新規）: claim競合、stale expected SHA/revision、claim release ownership、private v1 payload非読取り。
- `test/integration/lease-concurrency.test.ts`: GitHub/localでrecovery claim対start/renew/release/reportを実process競合させ、片方だけ成功することを反復する。

### #3 credential-auth v2移行

- `src/lib/lease-credential.ts`: `createCredentialVerifier` と `verifyLeaseCredential` を追加し、bearerはmode `0600` fileに限定する。
- `src/commands/lease.ts`: `buildLease`、acquire/renew/release/resume/statusをstore経由へ移し、全mutationでoperation claimを使う。
- `src/commands/segment.ts`: v2 current generation/runtimeとclaimを確認し、単なる期限内だけでstart契約を返さない。
- `test/integration/{lease-renew,lease-resume,lease-status,lease-reclaim}.test.ts`: v1 normal release、positive credential migration、credential無しlegacy recovery拒否、terminal後renew拒否。

### #4 claim-bound report

- `src/commands/report.ts`: report claim、runtime binding、Backend write/read-back、partial failureを実装する。`latest`の既存出力は維持する。
- `.agent-skill-chain/scripts/report-status.sh`: thin wrapperのまま新contractを伝播する。
- `test/integration/report.test.ts`: acquired_at前、別lease、別generation/runtime、遅延report、投稿中recovery、GitHub/local read-back失敗を検査する。
- `test/integration/worker-adapters.test.ts`:既存dispatch token検査と新runtime metadataが同時に成立することを検査する。

### #5 trusted runtime lifecycle

- `src/commands/worker.ts`、`src/lib/cli-routes.ts`: `worker lifecycle-begin|started|terminal` internal routesを追加する。
- `.agent-skill-chain/scripts/worker-runtime-launch.sh`（新規）: 0600 descriptor、start barrier、child PIDの直接wait、exit後terminalizeを実装する。
- `.agent-skill-chain/scripts/{worker-launch,worker-launch-verify}.sh`: 全AI runtimeをwrapperへ通し、verifyの終了順をattestation後にする。
- `.agent-skill-chain/adapters/{claude,codex}.sh`: provider command組立だけを担当し、同期/Agent-tool dispatch双方をwrapperに渡す。human adapterは変更しない。
- `test/integration/worker-adapters.test.ts`: begin前実行不能、starting/running回復拒否、child exit後のみattestation、launcher kill/monitor loss/再startで旧attestation無効、runtime identity/PID再利用を検査する。

### #6 Backend audit ledger

- `src/lib/lease-recovery-audit.ts`（新規）: 共通payload、GitHub append/read-back、local state expected-digest CASと短期audit lock。
- `test/unit/lease-recovery-audit.test.ts`（新規）: canonical payload、attempt/phase順、digest照合。
- `test/integration/lease-reclaim.test.ts`: GitHub Issueだけ、local stateだけへ記録し、逆Backendに副作用がないこと、予約失敗はlease保持を検査する。

### #7 recovery transaction

- `src/commands/lease.ts`: `reclaim` usageを`--confirm-holder`+`--confirm-digest`へ変更し、観測→claim→再観測→予約→final再観測/CAS→最終監査→claim releaseを固定する。
- `.agent-skill-chain/scripts/lease-reclaim.sh`: thin wrapperを維持する。
- `src/lib/cli-routes.ts`: route名は互換維持し、期限のみの旧実装へ到達する別routeを作らない。
- `test/integration/lease-reclaim.test.ts`: positive proof有/無report、確認不一致、各再観測差分、clean/pushed、削除前/後failpointを検査する。

## AC別の自動検証マトリクス

| AC | 自動テスト | 主な反証ケース |
|---|---|---|
| AC-1 | `lease-lifecycle`, `lease-reclaim`, `worker-adapters` | report無しterminalは通る、completed reportだけは通らない |
| AC-2 | `lease-lifecycle`, `report`, `worker-adapters` | PID不在、grace/heartbeat、starting/running、launcher生存、monitor不明、stale/別runtime report |
| AC-3 | `lease-reclaim` | untracked/modified/staged、local-only commit、remote不明、HEAD不一致を全て保存 |
| AC-4 | `lease-concurrency`, `github-lease`, `local-lease` | recovery対start/resume/renew/release/report、claim前後、stale SHA/revision、final CAS conflict |
| AC-5 | `lease-reclaim`, `lease-recovery-audit` | holder/digest不一致、reservation/final read-back失敗、attestation/report/worktree/HEAD/remote変更、claim release失敗 |
| AC-6 | `lease-reclaim`, `lease-concurrency` | 完全成功直後のN並行acquireで成功1、partial successは成功表示無し |
| AC-7 | `lease-reclaim`, `lease-lifecycle`, secret lint | canary tokenをCLI全stream、Git object、Issue/PR、state、audit、attestation、report、確認値、全digest inputから検索 |

post-delete fault injectionは final audit write失敗、final audit read-back不一致、claim delete失敗、claim absence確認失敗を個別に作り、leaseが無いまま理由付き非0かつsuccess文言無しであることを固定する。delete前failpointではlease、worktree、report、attestation、予約auditが保存されることを確認する。

## migration・後方互換・ロールバック

- v1 leaseはschema/read/status/credential-auth releaseを維持する。credential、holder、branch、worktreeを正に確認できたstart/resumeだけがCASでv2化する。
- v1、lifecycle欠落、generation不明、public projection欠落はactive recovery対象外。期限切れやcleanだけで補完しない。
- worker-report追加fieldはoptionalにし既存report読取を維持するが、recovery proofには新field全件一致を必須にする。
- `lease reclaim`の旧「期限切れ+confirm」成功契約は安全上廃止し、追加の明示確認とterminal proof無しでは非0にする。低レベル削除fallbackは作らない。
- rollback時はactive reclaimと新runtime startを停止し、v2 read/releaseを残す。v2→v1変換、audit/report/attestation削除、lease再作成は行わない。

## 実装完了時の検査

1. `npm run build`
2. `npm run typecheck`
3. 対象unit/integration test後に`npm test`
4. `.agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-820`
5. `.agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md`
6. `.agent-skill-chain/scripts/adr-lint.sh check`
7. `.agent-skill-chain/scripts/lint-vocab.sh` と `.agent-skill-chain/scripts/lint-references.sh`
8. `.agent-skill-chain/ci/verify-doc-length.sh`、`.agent-skill-chain/ci/verify-template-sync.sh`
9. credential canary scan、`git diff --check`、`git diff --stat origin/main...HEAD`、`git diff origin/main...HEAD -- <明示path>`

全検査成功、AC証跡、exact diff、push済みHEADが揃うことを完了条件とする。未決事項はない。#808、#818、TTL、複数writer、claim孤児の自動修復、human deferredのterminal proofは対象外である。

## 実装順序の見直しについて

実装中に変更単位の並びだけを変える場合は本ファイルのみ更新する。state model、責務境界、原子性、failure semanticsを変える場合はDESIGNと設計ゲートを更新する。
