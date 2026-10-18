# agent-skill-chain v0.5

ASCは、Goal・要求・リスク・プロジェクト契約・検証Evidenceから必要な開発作業を選ぶAI開発ハーネスです。固定Step 0〜11を実行する旧runtimeは、新版の標準CLIと配布物には含めません。

v0.5系を正式版として提供します。[GitHub Release](https://github.com/techbeansjp-free/AGENTS.md/releases)の固定tarballを明示指定して導入してください。v0.4とは非互換のため、既存プロジェクトへの適用前に移行手順を確認してください。

公開済みv0.5.7と、ソースcheckoutの開発用基準版0.5.0は区別してください。release時にタグと配布パッケージの版を一致させます。実際に使用する版は配布物の`package.json`と`--version`で確認できます。`v05/RELEASE_READINESS.json`の未公開状態は記録内の`sourceCommit`時点の候補についての履歴であり、現在の公開状態ではありません。

## 利用入口

Release添付のtarballから、[導入手順](v05/USAGE.md)の`project-assets`で実行本体を`.agent-skill-chain/managed-runtime/`へ配置します。Git共有時は本体もcommitし、clone・worktreeごとに同じ版を使います。ASC本体のビルドは不要です。通常のコマンド名は`agent-skill-chain`です。`asc-v05`も同じruntimeを呼び出します。旧コマンドへの暗黙の切り替えは行いません。

```sh
node .agent-skill-chain/bin/asc.mjs --version
node .agent-skill-chain/bin/asc.mjs capabilities
node .agent-skill-chain/bin/asc.mjs start /absolute/path/to/project
```

Git管理済みrepoでは専用worktreeを使い、現在のClaude Code／Codexが既存の開発環境・依存関係を使って実装・検証し、別Contextの独立レビューを経てDraft PR/CIへ進む経路です。ASC本体は直接実行できる配布物で、利用者にASCのビルドや依存資産のコピー・ハッシュ登録を要求しません。`start`は作業場所と責務の案内で、開発完了やレビューの証明ではありません。

Git未管理のフォルダーや、複数repoをまとめるGit未管理の親ディレクトリにも導入できます。Git初期化やPR提出は強制しません。Git管理する対象ではrepoごとに専用worktreeを使います。

snapshot Controllerは明示選択の別経路です。利用する場合だけ `run --snapshot <external-owner-request.json>` 等を指定します。そこで必要となる隔離・依存コピーの制約は、標準経路の前提ではありません。

入力・前提条件は[実行手順](v05/USAGE.md)、権限は[承認契約](v05/OWNER_APPROVAL.md)、分解と統合は[Goal実行](v05/GOAL_EXECUTION.md)を参照してください。[ASC Skill](skills/asc/SKILL.md)は同じ配布物内のCLIを利用します。

## 利用者プロジェクトの配置と更新

利用者側の入口は従来と同じ`.agent-skill-chain/`です。このリポジトリの`v05/`は開発・配布元の配置であり、利用者プロジェクトに`v05/`を作る必要はありません。

```text
利用者プロジェクト/
├── .agent-skill-chain/
│   ├── 00_利用案内.md
│   ├── bin/asc.mjs          同梱本体の起動入口
│   ├── runtime.json         使用版
│   ├── managed-runtime/     実行可能なASC本体（Git共有可能）
│   ├── v05/                 利用・移行などの資料
│   ├── project/             利用者固有ルール（保持）
│   ├── skills/asc/          v0.5の実行案内
│   ├── templates/specs/     仕様書の雛形
│   └── distribution.json   配布資産の更新判定用
├── .agents/skills/asc/      Host向け入口（明示登録時のみ）
├── docs/specs/              作成済み仕様書（既存配置を優先）
├── src/                     利用者のアプリ
└── .worktrees/              Issue別作業先
```

ASCのプログラムも案内・Skill・雛形と一緒に更新します。更新先の固定tarballを導入し、その版のCLIの`project-assets <project-directory>`で差分を確認して、`--apply`で適用します。Git管理済みなら専用worktreeで行います。既存の同梱CLIは自動で新版をダウンロードしません。Host向け入口も配置する場合だけ`--register-skill`を指定します。

未編集の配布資産だけを更新し、利用者が編集・削除した資産は競合として停止します。`project/`、作成済み仕様書、独自の雛形、アプリは上書きしません。旧Step専用の設定・Hook・Skillの撤去はこの更新操作に含めません。具体的な操作と制約は[配布資産の導入・更新](v05/USAGE.md#プロジェクト内の配布資産を導入更新する)を参照してください。

## 品質と移行

実装者とReviewerのContextを分離し、元要求・実差分・テスト・規約を検分します。標準経路では現在のHostが実テストとレビューを行い、Git提出時に対象commitとCIの一致を確認します。任意の`worktree-verify`は変更範囲と実検証結果をcommitへ対応付けます。明示選択のsnapshot経路ではControllerがこれらを制御します。文書やGherkin・DDD等は利用プロジェクトの契約と変更内容に応じて適用し、毎回の生成や専用Agent起動を強制しません。

v0.4の`workflow advance`等とは非互換です。旧設定や利用者の成果を勝手に削除・変換しません。[移行・復旧手順](v05/MIGRATION_PLAN.md)と[対象commit付きの受入記録](v05/RELEASE_READINESS.json)を確認してください。通常配布入口の切り替えと、全移行経路・正式release手順の受入完了は別です。

## 開発と検証

`src/`と`bin/`はv0.5 runtime、`test/`はv0.5のテストです。`npm test`（別名`npm run test:v05`）と`npm run quality`で検証します。旧Step専用runtime・テスト・Hook・Skill・ビルドスクリプトは現行treeから削除し、旧版の参照はGit履歴で行います。

`scripts/check_project_quality.ts`・`check_source_quality.ts`と`quality-support/`はbase側CIの契約移行に必要な互換検査です。製品runtimeや配布物には含めません。必須CIはv0.5のLinux検証とbase validatorへ切替済みです。

詳細な構成・保証境界は[v0.5利用案内](v05/README.md)を参照してください。

## 自動リリース

v0.4系と同様、mainへのマージでRelease CIが起動し、既存の正式タグから`v0.5.1`、`v0.5.2`…とpatchを採番します。同じcommitの再実行は同じタグを使い、既存の公開物は上書きしません。続けてmainが更新された場合、追い越された実行は停止し、最新mainの実行が未公開変更をまとめて配布します。

ソースのpackage.jsonは開発用の基点バージョンです。配布生成時に確定バージョンを埋め込み、**タグ・配布package.json・導入後の両CLIの`--version`を一致**させます。バージョン更新commitをbotが追加しないため、リリースの無限起動も発生しません。

公開前に、同じrepositoryからmainへマージされたPRのHEADと公開対象のtree一致、指定された全品質workflowの成功を確認します。品質CIはPR HEADを明示取得し、Release側では同一内容の総合テストを繰り返さず、実際に配布するtgzのオフライン導入と版表示を確認します。既存タグの別commit、添付物の不一致、Latestの巻き戻しは拒否します。アップロード後のbyte列を再取得して照合してからDraftを公開します。

手動の`workflow_dispatch`では`version`と`dry_run`（既定true）を指定できます。Alpha・Beta・RCはプレリリース扱いでLatestを変更しません。公開失敗時は同じ実行を再実行でき、途中のDraftと一致する添付物を再利用します。公開先はGitHub Releasesで、npm registryへは公開しません。

候補だけをローカル生成する場合は`node scripts/pack-candidate.mjs /absolute/existing/output --version=0.5.N`を使います。生成自体は公開許可ではありません。配布物の出自記録とruntimeの権限表示は、GitHub上の公開状態とは別です。
