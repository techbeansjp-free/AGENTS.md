# agent-skill-chain v0.5

ASCは、Goal・要求・リスク・プロジェクト契約・検証Evidenceから必要な開発作業を選ぶAI開発ハーネスです。固定Step 0〜11を実行する旧runtimeは、新版の標準CLIと配布物には含めません。

現在は正式リリース前の候補です。Linuxでの受入を進めており、既存Releaseのlatestがv0.5であることを意味しません。merge・公開・releaseはまだ行っていません。

## 利用入口

このソースの`npm pack`で作成したtarballを、検証用の別ディレクトリへインストールできます。通常のコマンド名は`agent-skill-chain`です。`asc-v05`も同じruntimeを呼び出します。旧コマンドへの暗黙の切り替えは行いません。

```sh
agent-skill-chain --version
agent-skill-chain capabilities
agent-skill-chain run /absolute/path/to/owner-request.json
```

実行には専用worktreeと、候補リポジトリ外のowner入力が必要です。Node.js 20以上に加え、実Agent実行にはLinuxの隔離・資源管理環境、固定したCodex CLI等が必要です。単にインストールできることは、隔離成立や開発完了の証明ではありません。

入力・前提条件は[実行手順](v05/USAGE.md)、権限は[承認契約](v05/OWNER_APPROVAL.md)、分解と統合は[Goal実行](v05/GOAL_EXECUTION.md)を参照してください。[ASC Skill](v05/skills/asc/SKILL.md)は同じ配布物内のCLIを利用します。

## 品質と移行

実装者とReviewerのContextを分離し、元要求・実差分・テスト・規約を検分します。Controllerは変更範囲、Evidence、提出commitの一致を検証します。文書やGherkin・DDD等は利用プロジェクトの契約と変更内容に応じて適用し、毎回の生成や専用Agent起動を強制しません。

v0.4の`workflow advance`等とは非互換です。旧設定や利用者の成果を勝手に削除・変換しません。[移行・復旧手順](v05/MIGRATION_PLAN.md)と[現在の受入状態](v05/RELEASE_READINESS.json)を確認してください。通常配布入口の切り替えと、全移行経路・正式release手順の受入完了は別です。

## 開発と検証

`npm test`と`npm run test:v05`は新ハーネスのテストです。`npm run quality`は新実装のLintとテストを実行します。`test:legacy`等に残る旧系テストは移行検討用であり、標準実行やv0.5の受入件数には含めません。`lint`も新版のみを対象にします。旧Step専用の`workflow:check`、`test:unit`、`test:integration`、`test:e2e`等は標準コマンドから削除しています。旧系の調査用入口は`test:legacy`・`build:legacy`だけに分離し、新版の配布や実行から呼びません。旧base品質契約とrelease手順の移行は進行中です。

詳細な構成・保証境界は[v0.5利用案内](v05/README.md)を参照してください。

## 未公開候補の作成

ルートから`node v05/scripts/pack-candidate.mjs /absolute/existing/output --version=0.5.0`で、版番号を揃えた候補tarballを作成できます。元のmanifestは変更せず、変換前後のhashを配布物に残します。候補は`private: true`・未承認のままであり、正式版の番号を指定してもリリース承認にはなりません。

GitHubの候補生成workflowも手動実行のみです。指定commitの一致とLinux品質検証を確認してartifactを保存します。commit一致は独立レビューの合格を証明するものではありません。正式公開経路と旧base品質契約の移行は未完了です。
