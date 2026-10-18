# v0.4.xからv0.5への移行・復旧

v0.5は固定Step実行系の置換であり、旧`workflow advance`等とのCLI互換を提供しない。v0.5.7は公開済みの正式配布版である。ソースcheckoutのpackage.jsonにある0.5.0は開発用の基準版であり、配布版の番号はrelease時に設定する。[受入記録](RELEASE_READINESS.json)の未公開状態は記録内のsourceCommit時点の候補を指し、公開済みv0.5.7の状態ではない。検証結果は各記録の対象HEADと適用範囲を確認する。以下は現行CLIの手順であり、実施しただけで本番適合を証明するものではない。

## 引き継ぐものと廃止するもの

利用者所有の要求・仕様・テスト・規約・ドメイン知識・Git履歴・作業成果は保持する。旧Step専用runtime・Hook・Skill・テンプレートは新版へ同梱しない。過去のJournal・Seal・レビュー記録は移行対象・保存必須データ・rollbackの前提にしない。Git履歴を書き換えて消去する必要もない。旧Evidenceを新版の承認へ変換しない。

旧テストの件数・Step形式を継承するのでなく、権限・変更範囲・独立性・Evidence有効性などの保証を維持する。利用者が所有する必須テストや規約は、ASCの都合で削除・skipしない。非互換による変更はownerが明示し、新しい契約で検証する。

## 配布物と作業場所

標準経路では[導入手順](USAGE.md#標準の導入先asc_cliは不要)に従い、承認されたtarballを`.agent-skill-chain/`配下へ導入する。`project-assets`は実行可能な本体一式を`managed-runtime/`へ配置する。Git共有では同梱本体もcommitし、各worktreeが自身の版を使う。共有入口は同配下のCLIを自動解決するため、`ASC_CLI`は不要。共有Skillにホームディレクトリの絶対パスを保存しない。global PATH・既存v0.4インストールを上書きしない。

snapshot ControllerのHostツール管理や任意の外部prefixを選ぶ場合だけ、開発対象外の場所へ導入し、その環境の`ASC_CLI`で実パスを指定する。snapshotの候補外ツール管理を標準配置へ暗黙に切り替えない。

`agent-skill-chain`と`asc-v05`は同じ新版CLI。実行条件は[実行手順](USAGE.md)を参照する。通常開発は専用worktree、移行候補は独立cloneを明示的に使用できる。owner入力・実行ツール・依存物・認証情報は候補の外へ置く。

ソースcheckoutでは`node scripts/pack-candidate.mjs /absolute/existing/output --version=0.5.0`で未公開候補を作成できる。インストール済みtarballには開発スクリプトを含めない。番号指定は公開承認ではなく、候補はprivateのまま。identityは内容hashであり、署名や独立した信頼の証明ではない。

以下のコマンド例は、v0.5を導入済みのworktreeルートから実行する。検査対象は引数で明示する。

## 既存プロジェクトを調べる

```sh
node .agent-skill-chain/bin/asc.mjs migration-inspect /absolute/legacy-project
```

元projectを書き換えず、Git HEAD・index・作業file、policy形式、設定inventoryを確認する。設定・Hook・Skill・CIを実行せず、秘密や設定本文を結果へ出さない。`configurationInventory`にはCLI依存file、Agent入口、CI、policyのpathとhashが含まれる。`.agents/`だけでなく`.agent-skill-chain/skills/`と`hooks/`も棚卸しする。

検査だけでは移行を実行しないため`readyToMigrate: false`と`migration-execution-not-performed`を返す。未知・欠落policy、未解決参照、dirtyな対象、未対応file等は解決してから進める。runtimeディレクトリの存在も現在は停止条件であり、存在だけで稼働中と断定したものではない。この条件は未変更。別worktreeのdirty状態だけで対象を一律拒否しない。

作業中のIssueが別worktreeにある場合は、その作業を止めたりruntimeを削除したりせず、移行したいcommitを持つcleanな専用worktreeを検査対象に選ぶ。必要なら既存のGit worktree運用で新規作成する。選択したworktreeのcommit済み成果だけが移行候補へ入るため、未commitの成果を移したい場合は先に内容を確認してcommitする。別Issueの未保存ファイル・runtime・branchは変更しない。

この経路は`test/test_migration.mjs`の「migration of a clean linked worktree preserves another Issue with dirty files and runtime」で、候補編集後のrollbackまで確認している。旧進行記録を新しい承認へ変換する経路ではない。移行先では現在の要求と変更に対して新しい検証・レビューを行う。


進行中の旧Issueは旧入口で完了するか、ownerが明示的に中断し、新しい要求として開始する。途中の承認を引き継がない。旧設定を新しい権限として自動採用しない。

## 独立した候補を準備する

設定を保持して調べる場合：

```sh
node .agent-skill-chain/bin/asc.mjs migration-prepare /absolute/legacy-project /absolute/new-location
```

保存先は元projectとGit管理領域の外に作る。固定commitのblobから`new-location/project`を生成し、sourceのHook・filterをcheckoutで実行しない。元repoは不変、他branch固有の履歴・参照は元repoに残る。cloneのremoteは削除する。旧設定はGit上に保持しても、通常のfresh Agentへ`.agents`・`.codex`を配置しない。

manifest型policyではprepareを停止する。全設定の保持／置換をownerが判断する次のstageを使う。wrapper内に既知schemaがあっても未知形式を受理しない。

```sh
node .agent-skill-chain/bin/asc.mjs migration-stage /absolute/legacy-project /absolute/new-location /absolute/owner-plan.json
```

owner-planは元repo外の通常fileとする。`schema: "asc-v05-cutover/v1"`、検査時の`sourceHead`、`files`を持ち、inventory全件へ次を指定する。

| 属性 | 意味 |
|---|---|
| `path` | inventoryの設定path |
| `beforeSha256` | 検査時の内容hash |
| `action` | `retain`または`replace` |
| `content` | replaceの場合だけ新しいUTF-8内容 |

未列挙・重複・未知path・古いhash/HEADは拒否する。stageは新規file追加・削除を行わず、既存設定の置換候補を未commit差分として作る。設定を実行・承認・commitしない。規約はownerが新Contractの`policyRefs`へ対応付ける。retainや既知schemaだけで意味的な移行成立とはしない。

## 新入口への切替を検証する

候補branchでownerが認めた設定差分を作る。旧Step用登録を除去し、新Skillは`project-assets --register-skill --apply`で相対参照の共有入口として登録する。Skill本文だけを別directoryへコピーすると相対リンクが壊れるため、入口・版指定・資料を含む配布資産一式を使う。利用者固有AGENTS規約・permissions・無関係なHookは保持する。追加・削除が必要ならstage後の通常のGit変更として扱う。

設定差分をアプリ変更とは別commitにし、元要求・規約・実差分を独立レビューする。明示選択のsnapshot経路では、ownerが作成した候補に`review --snapshot /absolute/owner-request.json`を使える。実装・修復・提出は行わないが、隔離検証と必要なowner承認commandは実行する。`.agents`・`.codex`の対象内容はReviewerへデータとして渡し、実入口として配置しない。通常実装の書込禁止は維持する。

新しいowner requestで許可範囲・規約・検証方法・提出先を指定し、実テスト、独立レビュー、許可されたDraft PR/CIを確認する。旧CI成功や旧承認を新HEADへ流用しない。Git依存テストの`verificationGit`や資源予算の設定は[実行手順](USAGE.md)に従う。必要なHost設定・Skill発見の動作は利用Hostで別途確認する。

<a id="migration-recovery"></a>

## 中断・再試行・切戻し

準備途中の保存先は保全し、上書きしない。原因を確認し、新しい保存先で再試行する。prepareが完了済みの場合の再試行は元HEAD・index・作業file等を再確認し、候補の追加編集を保持する。stageは新しい保存先を必要とする。制御metadataは候補外で16MiB未満に制限し、超過・不正状態で候補を削除しない。

```sh
node .agent-skill-chain/bin/asc.mjs migration-rollback /absolute/new-location
```

このコマンドは選択記録をlegacyへ戻すだけ。旧CLIの再導入や設定復元、sourceのresetは行わない。未完成状態をrollback成功とせず、候補編集と元projectを保持する。旧承認を復活させない。

実際の切戻しでは、正確な旧versionを再インストールするか保持した固定CLIを再選択する。設定変更がなければ設定復元は不要。変更した場合は設定commitだけを`git revert`し、後続のアプリ成果をresetしない。競合時は停止して解決するかabortする。旧版で必要な再検証を行う。旧実行系や旧Journalを新版に同梱する必要はない。

## 現行checkoutで再現できる検証

`npm run package:check`は実際の配布物をoffline導入し、flat/manifest両形式の合成設定往復を検証する。個別に実行する場合：

```sh
node v05/evaluation/configuration-roundtrip.mjs /absolute/installed/agent-skill-chain flat
node v05/evaluation/configuration-roundtrip.mjs /absolute/installed/agent-skill-chain manifest
```

このdriverはソースcheckout用で、配布物には含まれない。配布CLIのprepare/stage/rollback、旧新Skill登録の追加・削除、規約・権限・他Hook保持、後続アプリ変更を残したrevert、競合停止・abort、元projectとdirtyな別worktree保持を確認する。HostのSkill自動発見・実際の旧CLI起動・任意設定の意味的変換・remote CIはこの試験の対象外。

過去の実モデル試行・実旧版導入資産の往復・失敗履歴は[受入記録](RELEASE_READINESS.json)に対象HEADと限界付きで残す。PoC専用driverはこのcheckoutや配布物の実行手順ではない。整理前の詳細履歴はGit commit `fa8e3b85`の同文書で参照でき、現在のコマンドと混同しない。

## 本体CI契約

main側の契約はPR #1580・#1581でv0.5配布構成を受理する検査へ切替済み。必須checkは`linux`と`base validatorで品質自己緩和を拒否`。旧Step・Journal・Sealの監査記録を新製品のために作成する必要はない。

`linux`は新版の実テスト・Lint・隔離・配布物を検査する。base validatorは候補側コードを実行せず、承認された品質設定との一致を確認する。どちらも対象commitの結果を確認し、旧版の検証件数や別commitの成功と混同しない。

`scripts/quality-support/`等はこのrepositoryのbase検査用であり、利用者データ・rollback用・v0.5配布物ではない。CI契約の切替自体は製品のmerge・release承認を意味しない。
