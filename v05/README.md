# ASC v0.5.x — Goal・Contract・Evidence駆動の開発ハーネス

ASCは、目的と受入条件、許可された変更範囲、既存規約を入力として、必要な実装・検証・独立レビューを選択します。固定Step列や工程ごとのAgent起動は要求しません。小規模変更は実装と独立Reviewerを基本とし、複雑なGoalでは依存関係に従ってWork Unitを実行・統合します。

**v0.5系の正式配布版です。標準は利用中のAI Hostでの開発です。Git管理済みrepoでは専用worktreeを使います。** 公開済みv0.5.7とソースcheckoutの開発用基準版0.5.0は異なります。使用版は配布物の`package.json`と`--version`で確認してください。受入記録の未公開状態は記録内の`sourceCommit`時点の候補に関する履歴です。 [受入状態](RELEASE_READINESS.json)の`finalAcceptanceAudit`に対象commit、受入根拠、制限を記録しています。`capabilities.releaseReady`は製品のLinux受入を表し、現在のHostの隔離成立や公開承認ではありません。`host.releaseReady: false`はOS識別だけで個別環境の隔離を認定しないことを表し、snapshot経路のpreflightは引き続き必須です。

## 導入と入口

標準worktree入口は0.5.0-alpha.3からの機能です。既公開alpha.2以前には含まれません。候補のversion更新だけでGitHub Releaseが公開されたことにはなりません。

Node.js 20以上を使用します。標準導入は[利用手順](USAGE.md#標準の導入先asc_cliは不要)に従い、固定tarballから`project-assets`で本体を`managed-runtime/`へ配置します。以下は任意の外部prefixへ導入する例です。npmのlifecycle scriptは実行しません。

```sh
npm install --prefix /absolute/asc-tools --offline --ignore-scripts /absolute/agent-skill-chain-0.5.7.tgz
/absolute/asc-tools/node_modules/.bin/agent-skill-chain --version
/absolute/asc-tools/node_modules/.bin/agent-skill-chain capabilities
```

`--version`は現在の作業projectではなく、実行した配布物自身のversionを表示します。version番号は正式公開やリリース受入の証明ではありません。

配布パッケージには`agent-skill-chain`と`asc-v05`の両入口があります。同じv0.5 CLIの操作に使えますが、v0.4の`workflow advance`などのコマンドは引き継ぎません。未対応コマンドで旧版へfallbackしません。候補の生成・非互換・rollbackは[移行手順](MIGRATION_PLAN.md)を参照してください。

Git管理済みの開発対象には専用のlinked worktreeを使います。Git未管理のフォルダーでも`start`と`project-assets`を利用でき、Git初期化は不要です。commit拘束の検証やGitでの提出を行う場合は、その時点で必要なGit状態を確認します。標準経路は確認した作業場所の既存node_modules・pnpm workspaceと通常のビルド／テストを使用します。依存物のコピーやハッシュ指定は不要です。snapshot経路のowner入力・認証情報・検証用依存資産には別の配置契約があります。移行用の独立cloneは明示指定で利用できます。複数Issueの状態は分離し、別worktreeの失敗を理由に全作業を拒否しません。

snapshot実行の修正時は、その実行内の過去の失敗レビューを参照し、直前の指摘を直して以前の欠陥を再導入することを避けます。参照は診断情報であり、現在の承認や確定した欠陥ではありません。新しいReviewerが現在の契約・差分で再評価します。正常完走では履歴ファイルを追加せず、修正回数・権限・予算も拡張しません。

## Skillから使う

配置後の`.agent-skill-chain/skills/asc/SKILL.md`をHost AIへ示し、目的と許可範囲を伝えます。Skillは相対参照の`bin/asc.mjs`から同梱本体を起動するため、利用者の絶対パスや`ASC_CLI`設定は不要です。`project-assets --register-skill --apply`を明示すると、このprojectの`.agents/skills/asc/SKILL.md`も配置できます。global設定やHookは変更しません。相対参照を保つため、Skill単体だけを別directoryへコピーしないでください。詳細は[Skill登録手順](USAGE.md)を参照してください。

## 実行の選択

| 目的 | 入口 |
|---|---|
| 標準：現在のAIで実装・実テスト・別Contextレビュー・Draft PR/CI | `start <project-directory>`で確認しSkillに従って作業（PRはGit提出時） |
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

標準経路では現在のHostの権限・ツールを使い、実装者と独立Reviewerが元要求・実際の変更・プロジェクト規約・実テストを確認します。`start`だけでこれらを自動実施・証明するわけではありません。任意の`worktree-verify`はGit管理されたcommitと検証結果を対応付けます。非Git作業ではcommitの保証を主張せず、実際の変更と検証結果を確認します。

以下は明示選択のsnapshot Controllerによる制御です。

- ownerの要求・受入条件・変更範囲・検証設定をGit対象と結び付けます。候補内の指示や過去ログから権限を生成しません。
- Controllerが実差分と検証結果を観測します。Reviewerは実装者と別Contextで元要求・規約・差分を確認します。変更後に古い成功を流用しません。
- 許可範囲外の編集、未検証・レビュー未成立の提出を拒否します。通常の実装経路に公開・merge・release権限を与えません。
- テスト・規約・文書はプロジェクトの契約に応じて適用します。全変更に専用DDD層、Gherkin、設計書、ADRを生成させません。仕様変更に必要な文書更新はレビュー対象です。
- 再開時に旧Evidenceを承認として読み戻しません。候補の内容を保持し、新しい条件で検証・レビューします。再開は無料の処理ではなく、再検証コストが発生します。

以下はLinux snapshot backendの条件です。標準経路は現在のHostの権限・承認に従い、ASC独自sandboxやcgroupの保証を追加しません。実Agentと検証の隔離は現在Linuxで評価しています。Git、GitHub CLI、host固定のCodex CLI、bubblewrap、prlimit等が必要です。Agentの実行寿命管理にもsystemd user serviceとcgroup v2環境が必要です。追加の資源制限profileの有無とは別の実行条件です。対応条件の詳細は[実行手順](USAGE.md)に従ってください。OS名だけで安全性を認定せず、実行時preflightを行います。WSL2・macOS等のAgent全体の隔離は別途受入中で、未成立の環境では停止します。

## 受入範囲と制限

標準CLI・配布対象・必須CIはv0.5へ切替済みです。移行と復旧、複雑な開発、小規模の対照性能測定には既存結果があり、その対象commit・適用範囲と現行実装の対応は受入記録に明示しています。Linux隔離のCIと合成fixtureの実走は確認済みですが、全利用環境の保証ではありません。外部比較製品との評価はowner判断で延期し、既知欠陥と正常対照による絶対評価を実施しています。小規模fixtureの完走時間やテスト件数を、すべての利用条件への保証として扱いません。過去のEvidenceは[受入記録](RELEASE_READINESS.json)の各対象commit・範囲を確認し、現在の実行条件は[利用手順](USAGE.md)を参照してください。

## ソースcheckoutでの開発

`npm test`はNodeのGit・検証・レビュー・Goal・移行・配布テストです。Python試作と歴史的fixtureは旧検証リポジトリにあり、このcheckoutのコマンドではありません。これらのテストと実験ログはソースrepository用であり、インストール済みtarballに全評価資産を同梱するものではありません。

設計上の判断は[アーキテクチャ原則](ARCHITECTURE_DECISION_0002.md)を参照してください。過去の試行・失敗・実測値はソースrepositoryのEvidenceに残し、通常実行で全文読込みを要求しません。

## Linux限定だった初回受入の範囲

初回リリース判定はnative Linuxを対象としました。これはLinux snapshot backendの受入範囲です。標準worktree経路はOS名で拒否せず、利用中のHostとプロジェクトの対応範囲に従います。これらのOSは初回Linux版の判定条件に含めません。snapshot経路ではLinuxでも実行時のファイル・通信・子プロセスの隔離成立を確認し、失敗時に権限を緩めません。Ubuntu 24.04のCI構成を維持して互換性を検証します。

## v0.5.0の公開範囲

Ownerの正式公開承認に基づくリリースです。標準worktree経路はLinux・macOS・Windows上の現在のAI Hostと既存の開発環境を使います。各OSの合成CI成功を、すべての実案件やHostの隔離保証と同一視しません。snapshot経路の環境要件と診断は維持します。

Alphaの測定結果は対象commit・適用範囲付きの履歴です。正式版への昇格で過去の欠測や未検証を合格へ変更しません。v0.4に対する同条件の速度・総tokens削減、CodeRabbit同等性、任意規模での品質は未証明です。CLIの`publishAuthorized: false`は実行時の公開権限を付与しない意味であり、GitHub Releaseの存在とは別です。
