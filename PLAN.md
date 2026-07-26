# PLAN: 期限切れ writer lease の再開と秘密情報の隔離

- Issue: `ISSUE-286`
- 対象ブランチ: `bugfix/286-expired-writer-lease-resume-and-redaction`

## 実装計画

1. lease ref の token 非含有公開表現と非表示 payload を定義し、read、acquire、renew、release の
   token 照合を新旧形式に対応させる。
2. `lease resume` を追加し、holder と worktree identity を検査して期限切れ ref を CAS 更新する。
3. reconcile が dirty expired lease を `human_required` として表示し、同一作業者向け resume 手順を
   token 非露出で案内するようにする。
4. Issue comment、CLI success/error、Git log を対象に token が含まれないことを確認する。
5. normal resume、mismatch、CAS conflict、legacy migration/reclaim を unit/integration test に追加する。

## 変更対象

- `src/lib/github-lease.ts`: ref 表現、CAS、公開 DTO、legacy reader。
- `src/lib/lease-credential.ts`: Git管理外のowner-only credential保存。
- `src/commands/lease.ts`: resume コマンドと token 非露出 CLI 契約。
- `src/commands/reconcile.ts`: dirty lease の安全な再開案内と legacy 回収。
- `src/lib/cli-routes.ts`: resume の routing。
- `test/unit/` と `test/integration/`: 状態遷移・表示経路・競合の回帰テスト。
- `docs/adr/`: resume proof と token 分離の判断記録。

## ロールバック

新形式の reader は旧形式を read-only で理解するため、実装を戻しても既存 legacy lease の回収を
妨げない。新形式 lease の token を旧形式へ再露出するロールバックは行わず、必要時は ref を失効させて
human_required へ戻す。

## 検証計画

TypeScript typecheck、対象 unit/integration tests、全 test suite、secret scan、template/ADR/AC
verification を実行する。GitHub backend の実ref操作が必要な検証は test fixture repository と
一時 ref に限定し、token 値は出力・記録しない。
