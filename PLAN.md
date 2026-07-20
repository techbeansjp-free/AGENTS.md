# PLAN: agent-skill-chain — writer leaseの真の原子性強化・.worktrees未gitignore・gate-report digest不一致検知漏れ

- Issue: `ISSUE-176`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `.gitignore`へ`.worktrees/`追加 | DESIGN.mdの記載どおり1行追加するのみ | `AC-3` | なし |
| 2 | `verify.ts`のgate-report digest不一致検知修正 | `gateReport()`内の存在チェック条件式を`if/else if`へ分離し、削除済みファイルも不一致として検知する | `AC-4`, `AC-5` | なし |
| 3 | `lease.ts` renewの非対称性是正 | local分岐へGitHubモードと同一の期限切れチェックを追加する | `AC-6` | なし |
| 4 | `yaml-io.ts`: `writeYamlFileExclusive`新設 | `O_CREAT\|O_EXCL`ベースの排他生成関数を追加する（既存`writeYamlFileAtomic`は無変更） | `AC-2`の前提 | なし |
| 5 | `lease.ts` local acquireの原子化 | DESIGN.mdの手順（排他生成→競合/stale判定→1回だけ再試行→WIP超過時ロールバック）へ書き換える | `AC-2` | `#4` |
| 6 | `github-lease.ts`のref-based実装への置換 | `leaseRefName`・`acquireLeaseRef`・`renewLeaseRef`・`releaseLeaseRef`・ref読み出しヘルパーを新設し、`activeLeaseFor`/`activeLeasesFor`の外部シグネチャは維持したまま内部実装をref読み出しへ差し替える。`postLeaseComment`はbest-effort呼び出しとして残し、`listLeaseComments`等の旧・競合判定ロジックは削除する | `AC-1` | なし |
| 7 | `lease.ts` GitHubモード分岐の書き換え | `acquire`/`release`/`renew`のgithub分岐を`#6`の新API呼び出しへ置換する。CLI引数・標準出力形式は変更しない | `AC-1` | `#6` |
| 8 | `docs/adr/ADR-0002-...`確定 | 本フェーズで作成済みの`status: proposed`のまま実装フェーズへ引き継ぐ（design-gate通過後、accepted遷移は別途adr-finalizeワーカーが行う） | `AC-1`の前提 | なし |
| 9 | 既存テストの更新（regression対応） | (a) `test/integration/lease-renew.test.ts`の「ローカルバックエンドは期限切れ後もrenew成功する（非対称性の記録）」テストを、`#3`の修正により期待値を反転させて更新する（期限切れ後は失敗するのが正になる）。(b) `test/unit/github-lease.test.ts`をref前提の内容へ全面書き換える（gh-stub依存のコメントベースAPIテストを廃止し、`test/helpers/tmp-repo.ts`が既に提供するbare remote（`repo.remoteDir`）を使うテストへ置換する） | `AC-1`, `AC-6`, `AC-7` | `#6`, `#7`, `#3` |
| 10 | 並行acquireの実競合テスト新規追加（GitHubモード） | `createTmpRepo()`（backend既定=github、`origin`→`repo.remoteDir`のbare remoteが既に構成済み）に対し、`child_process.spawn`で複数（目安8プロセス）の`lease acquire ISSUE-1 spec`を同時起動し、成功が常に1件のみであることを検証する。git側のref-transaction lockが実際の排他性を担保するため、モック無しで真の並行性を検証できる | `AC-1` | `#6`, `#7` |
| 11 | 並行acquireの実競合テスト新規追加（ローカルモード） | `createTmpRepo({backend:'local'})`に対し、同様に複数プロセスの`lease acquire ISSUE-1 spec`を同時起動し、成功が常に1件のみであることを検証する（OSの`O_EXCL`が排他性を担保） | `AC-2` | `#5` |
| 12 | `verify gate-report`のregressionテスト追加 | `test/integration/verify.test.ts`へ、`approved_artifacts`記載ファイルを削除したケース（新規、AC-4）と内容変更のケース（既存、AC-5）の両方を確認するテストを追加する | `AC-4`, `AC-5` | `#2` |
| 13 | 全体回帰確認 | `npm test`を実行し、既存371件＋新規テストが全てpassすることを確認する。`node bin/agents-md.js doctor`を実行し、main worktree cleanチェックが`.worktrees/`未追跡ファイルの影響を受けずOKになることを確認する | `AC-7` | `#1`〜`#12` |

## 実装順序の見直しについて

`#1`・`#2`・`#3`は完全に独立しており並行実装可能。`#4`→`#5`、`#6`→`#7`の順序のみ依存があるため崩さないこと。`#10`・`#11`（並行実競合テスト）は実装（`#5`〜`#7`）完了後でなければ意味を持たないため最後に回す。作業順序のみを見直す場合は本ファイルのみを更新すればよく、`DESIGN.md`の更新は不要である。

## 実装フェーズへの申し送り事項

- `ADR-0002`は本フェーズで`status: proposed`として作成済み（`docs/adr/ADR-0002-github-lease-git-ref-cas.md`）。設計ゲート承認後、`accepted`への遷移はAGENTS.mdの既定ライフサイクル（専任のADR finalizationワーカーがwriter leaseを取得しstatusのみ更新）に従う。実装フェーズはADR本文（Context/Decision/Consequences）を書き換えない。
- fine-grained PAT／GitHub App installation permissionの`contents`権限がカスタムref namespace（`refs/agent-skill-chain/leases/*`）への実pushを許可するかどうかの実機検証は、実装フェーズの最初のタスクとして行う（SPEC.mdのスコープ外事項として明記済み、DESIGN.mdの「障害・ロールバック考慮」参照）。許可されない場合はADR-0002をsupersedeする別ADRの起票が必要になる可能性がある。
