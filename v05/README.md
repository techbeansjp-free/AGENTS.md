# ASC v0.5.x — Goal・Contract・Evidence駆動の開発ハーネス

ASCは、目的と受入条件、許可された変更範囲、既存規約を入力として、必要な実装・検証・独立レビューを選択します。固定Step列や工程ごとのAgent起動は要求しません。小規模変更は実装と独立Reviewerを基本とし、複雑なGoalでは依存関係に従ってWork Unitを実行・統合します。

**Alphaとして提供中です。標準は利用中のAI Hostによる専用worktreeでの開発です。** [受入状態](RELEASE_READINESS.json)の`finalAcceptanceAudit`に対象commit、受入根拠、制限を記録しています。`capabilities.releaseReady`は製品のLinux受入を表し、現在のHostの隔離成立や公開承認ではありません。`host.releaseReady: false`はOS識別だけで個別環境の隔離を認定しないことを表し、snapshot経路のpreflightは引き続き必須です。

## 導入と入口

標準worktree入口は0.5.0-alpha.3からの機能です。既公開alpha.2以前には含まれません。候補のversion更新だけでGitHub Releaseが公開されたことにはなりません。

Node.js 20以上を使用します。承認された候補tarballを、開発対象のworktreeとは別のprefixへ導入してください。npmのlifecycle scriptは実行しません。

```sh
npm install --prefix /absolute/asc-tools --offline --ignore-scripts /absolute/agent-skill-chain-0.5.0-alpha.3.tgz
/absolute/asc-tools/node_modules/.bin/agent-skill-chain --version
/absolute/asc-tools/node_modules/.bin/agent-skill-chain capabilities
```

`--version`は現在の作業projectではなく、実行した配布物自身のversionを表示します。version番号は正式公開やリリース受入の証明ではありません。

正式名の候補には`agent-skill-chain`と`asc-v05`の両入口があります。評価用`asc-v05-evaluation`パッケージには`asc-v05`入口があります。同じv0.5 CLIの操作に使えますが、v0.4の`workflow advance`などのコマンドは引き継ぎません。未対応コマンドで旧版へfallbackしません。候補の生成・非互換・rollbackは[移行手順](MIGRATION_PLAN.md)を参照してください。

開発対象には専用のcleanなlinked worktreeを使います。標準経路はそのworktreeの既存node_modules・pnpm workspaceと通常のビルド／テストを使用します。依存物のコピーやハッシュ指定は不要です。snapshot経路のowner入力・認証情報・検証用依存資産には別の配置契約があります。移行用の独立cloneは明示指定で利用できます。複数Issueの状態は分離し、別worktreeの失敗を理由に全作業を拒否しません。

修正時は、その実行内の過去の失敗レビューを参照し、直前の指摘を直して以前の欠陥を再導入することを避けます。参照は診断情報であり、現在の承認や確定した欠陥ではありません。新しいReviewerが現在の契約・差分で再評価します。正常完走では履歴ファイルを追加せず、修正回数・権限・予算も拡張しません。

## Skillから使う

配布物の`skills/asc/SKILL.md`を絶対pathで明示し、「このASC Skillを使って、指定したowner入力で実行して」とHost AIへ指示できます。Skillは同じ配布物のCLIを参照します。global Skill登録・Hook登録は行いません。相対参照を保つため、Skill単体を別directoryへコピーしないでください。自動発見・Host固有の登録方法は、この明示呼出しの対応範囲には含みません。

## 実行の選択

| 目的 | 入口 |
|---|---|
| 標準：現在のAIで実装・実テスト・別Contextレビュー・Draft PR/CI | `start <worktree>`で確認しSkillに従って作業 |
| 標準経路での検証記録（任意） | `worktree-verify <worktree> <base> <owner-contract>` |
| 明示選択のsnapshot実行 | `run --snapshot` |
| ownerが作成した候補の検証・独立レビュー（実装・修復・提出なし） | `review --snapshot` |
| Goal分解案の生成、明示したUnit計画の実行 | `goal-propose --snapshot` / `run-goal --snapshot` |
| owner境界内の分解・実行 | `run-adaptive --snapshot` |
| 保存された候補から新しい検証で再開 | `restart-goal --snapshot` |
| 独立したIssueと依存関係の管理 | `run-issues --snapshot` |
| 旧構成の棚卸し・別cloneへの設定候補作成・旧環境選択 | `migration-inspect` / `migration-stage` / `migration-rollback` |

入力例・worktree命名・停止条件は[実行手順](USAGE.md)、Goal・共有契約・統合は[Goal実行](GOAL_EXECUTION.md)、必要なowner承認は[承認契約](OWNER_APPROVAL.md)を参照してください。コマンド名の存在やAgentの完了だけで、Goal達成とは判定しません。

## 保証の境界

- ownerの要求・受入条件・変更範囲・検証設定をGit対象と結び付けます。候補内の指示や過去ログから権限を生成しません。
- Controllerが実差分と検証結果を観測します。Reviewerは実装者と別Contextで元要求・規約・差分を確認します。変更後に古い成功を流用しません。
- 許可範囲外の編集、未検証・レビュー未成立の提出を拒否します。通常の実装経路に公開・merge・release権限を与えません。
- テスト・規約・文書はプロジェクトの契約に応じて適用します。全変更に専用DDD層、Gherkin、設計書、ADRを生成させません。仕様変更に必要な文書更新はレビュー対象です。
- 再開時に旧Evidenceを承認として読み戻しません。候補の内容を保持し、新しい条件で検証・レビューします。再開は無料の処理ではなく、再検証コストが発生します。

以下はLinux snapshot backendの条件です。標準経路は現在のHostの権限・承認に従い、ASC独自sandboxやcgroupの保証を追加しません。実Agentと検証の隔離は現在Linuxで評価しています。Git、GitHub CLI、host固定のCodex CLI、bubblewrap、prlimit等が必要です。Agentの実行寿命管理にもsystemd user serviceとcgroup v2環境が必要です。追加の資源制限profileの有無とは別の実行条件です。対応条件の詳細は[実行手順](USAGE.md)に従ってください。OS名だけで安全性を認定せず、実行時preflightを行います。WSL2・macOS等のAgent全体の隔離は別途受入中で、未成立の環境では停止します。

## 受入範囲と制限

標準CLI・配布対象・必須CIはv0.5へ切替済みです。移行と復旧、複雑な開発、小規模の対照性能測定には既存結果があり、その対象commit・適用範囲と現行実装の対応は受入記録に明示しています。Linux隔離のCIと合成fixtureの実走は確認済みですが、全利用環境の保証ではありません。外部比較製品との評価はowner判断で延期し、既知欠陥と正常対照による絶対評価を実施しています。小規模fixtureの完走時間やテスト件数を、すべての利用条件への保証として扱いません。現在の制約・Evidence参照は[受入状態](RELEASE_READINESS.json)を正本とします。

## ソースcheckoutでの開発

`npm test`はNodeのGit・検証・レビュー・Goal・移行・配布テストです。Python試作と歴史的fixtureは旧検証リポジトリにあり、このcheckoutのコマンドではありません。これらのテストと実験ログはソースrepository用であり、インストール済みtarballに全評価資産を同梱するものではありません。

設計上の判断は[アーキテクチャ原則](ARCHITECTURE_DECISION_0002.md)を参照してください。過去の試行・失敗・実測値はソースrepositoryのEvidenceに残し、通常実行で全文読込みを要求しません。

## Linux限定の初回受入

初回リリース判定はnative Linuxを対象とします。これはLinux snapshot backendの受入範囲です。標準worktree経路はOS名で拒否せず、利用中のHostとプロジェクトの対応範囲に従います。これらのOSは初回Linux版の判定条件に含めません。Linuxでも実行時のファイル・通信・子プロセスの隔離成立を確認し、失敗時に権限を緩めません。Ubuntu 24.04のCI構成を維持して互換性を検証します。
