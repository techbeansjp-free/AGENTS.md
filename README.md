# agent-skill-chain v0.5

ASCは、Goal・要求・リスク・プロジェクト契約・検証Evidenceから必要な開発作業を選ぶAI開発ハーネスです。固定Step 0〜11を実行する旧runtimeは、新版の標準CLIと配布物には含めません。

現在は正式リリース前の候補です。Linux限定の受入範囲を記録しており、既存Releaseのlatestがv0.5であることを意味しません。merge・公開・releaseはまだ行っていません。

## 利用入口

このソースの`npm pack`で作成したtarballを、検証用の別ディレクトリへインストールできます。通常のコマンド名は`agent-skill-chain`です。`asc-v05`も同じruntimeを呼び出します。旧コマンドへの暗黙の切り替えは行いません。

```sh
agent-skill-chain --version
agent-skill-chain capabilities
agent-skill-chain run /absolute/path/to/owner-request.json
```

実行には専用worktreeと、候補リポジトリ外のowner入力が必要です。Node.js 20以上に加え、実Agent実行にはLinuxの隔離・資源管理環境、固定したCodex CLI等が必要です。単にインストールできることは、隔離成立や開発完了の証明ではありません。

入力・前提条件は[実行手順](v05/USAGE.md)、権限は[承認契約](v05/OWNER_APPROVAL.md)、分解と統合は[Goal実行](v05/GOAL_EXECUTION.md)を参照してください。[ASC Skill](skills/asc/SKILL.md)は同じ配布物内のCLIを利用します。

## 利用者プロジェクトの配置と更新

利用者側の入口は従来と同じ`.agent-skill-chain/`です。このリポジトリの`v05/`は開発・配布元の配置であり、利用者プロジェクトに`v05/`を作る必要はありません。

```text
利用者プロジェクト/
├── .agent-skill-chain/
│   ├── 00_利用案内.md
│   ├── project/             利用者固有ルール（保持）
│   ├── skills/asc/          v0.5の実行案内
│   ├── templates/specs/     仕様書の雛形
│   └── distribution.json   配布資産の更新判定用
├── .agents/skills/asc/      Host向け入口（明示登録時のみ）
├── docs/specs/              作成済み仕様書（既存配置を優先）
├── src/                     利用者のアプリ
└── .worktrees/              Issue別作業先
```

ASCのプログラムはプロジェクト外の固定npmインストール先に置きます。パッケージ更新と、プロジェクトへ配った案内・Skill・雛形の更新は分かれています。専用worktreeで、インストール済みCLIの`project-assets <worktree>`で差分を確認し、`--apply`で適用します。Host向け入口も配置する場合だけ`--register-skill`を指定します。

未編集の配布資産だけを更新し、利用者が編集・削除した資産は競合として停止します。`project/`、作成済み仕様書、独自の雛形、アプリは上書きしません。旧Step専用の設定・Hook・Skillの撤去はこの更新操作に含めません。具体的な操作と制約は[配布資産の導入・更新](v05/USAGE.md#プロジェクト内の配布資産を導入更新する)を参照してください。

## 品質と移行

実装者とReviewerのContextを分離し、元要求・実差分・テスト・規約を検分します。Controllerは変更範囲、Evidence、提出commitの一致を検証します。文書やGherkin・DDD等は利用プロジェクトの契約と変更内容に応じて適用し、毎回の生成や専用Agent起動を強制しません。

v0.4の`workflow advance`等とは非互換です。旧設定や利用者の成果を勝手に削除・変換しません。[移行・復旧手順](v05/MIGRATION_PLAN.md)と[現在の受入状態](v05/RELEASE_READINESS.json)を確認してください。通常配布入口の切り替えと、全移行経路・正式release手順の受入完了は別です。

## 開発と検証

`src/`と`bin/`はv0.5 runtime、`test/`はv0.5のテストです。`npm test`（別名`npm run test:v05`）と`npm run quality`で検証します。旧Step専用runtime・テスト・Hook・Skill・ビルドスクリプトは現行treeから削除し、旧版の参照はGit履歴で行います。

`scripts/check_project_quality.ts`・`check_source_quality.ts`と`quality-support/`はbase側CIの契約移行に必要な互換検査です。製品runtimeや配布物には含めません。必須CIはv0.5のLinux検証とbase validatorへ切替済みです。

詳細な構成・保証境界は[v0.5利用案内](v05/README.md)を参照してください。

## 未公開候補の作成

ルートから`node scripts/pack-candidate.mjs /absolute/existing/output --version=0.5.0`で、版番号を揃えた候補tarballを作成できます。元のmanifestは変更せず、変換前後のhashを配布物に残します。候補は`private: true`・未承認のままであり、正式版の番号を指定してもリリース承認にはなりません。

GitHubの候補生成workflowも手動実行のみです。指定commitの一致とLinux品質検証を確認してartifactを保存します。commit一致は独立レビューの合格を証明するものではありません。旧base品質契約の切替は完了しています。正式公開には別途ownerの承認が必要です。
