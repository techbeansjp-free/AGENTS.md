# SPEC: security: agent-skill-chain-release.ymlが配布物経由でconsumerプロジェクトのCIへ混入する

- Issue: `#344`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/344-distribution-release-workflow-leak`

## 目的・背景

`agent-skill-chain-release.yml`（配布元正本: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`）は、agent-skill-chain本体（techbeansjp-free/AGENTS.md）自身のnpmパッケージ配布リリース自動化（`package.json`のバージョン自動bump・gitタグ作成・GitHub Release作成。由来: Issue #196、ADR-0005）専用のワークフローである。にもかかわらず`.agent-skill-chain/templates/github/.github/`配下（配布元テンプレート）に置かれているため、誤配布の実害は次の2段階の因果経路で発生する。第1段階: `init`/`upgrade`実行時、配布元テンプレート一式の一部として当該ファイルがconsumerプロジェクトの`.agent-skill-chain/templates/github/.github/workflows/`配下（consumer側`.agent-skill-chain/`名前空間内。`init`/`upgrade`は`.github/`自体を一切生成・更新しない）へ非活性なテンプレート実体として複製される。この時点ではCIとして発火する場所（`.github/workflows/`）に存在しないため実害は生じない。第2段階: `.agent-skill-chain/templates/github/.github/`を`<target_dir>/.github/`へ実際にミラー展開する処理は`sync templates`サブコマンド（`src/commands/sync.ts`、ラッパー`.agent-skill-chain/scripts/sync-templates.sh`。`copyTreeMirror`でsrc→destへコピーするのみで`gh`認証等の外部前提を持たない）が担う。`setup github`（`src/commands/setup.ts`の`githubBundle`、ラッパー`.agent-skill-chain/scripts/setup-github.sh`）はこの同期処理を内部の`syncStep`として呼び出したうえで、さらにGitHubラベル適用（`gh label create`）・ruleset適用（rulesets APIへのPOST/PUT、`ASC_GATE_APP_ID`必須）を束ねた入口コマンドであり、`init`直後の標準導入手順の一部として実行される場合と、既存consumerに対し`upgrade`後に単独で明示実行される場合がある。`sync templates`単独実行・`setup github`経由の`syncStep`実行のいずれの経路でも、当該ファイルがconsumer自身のアクティブなCIワークフローとして`<target_dir>/.github/workflows/agent-skill-chain-release.yml`に実体化し、以降のpushで発火しうる状態になる。

2026-08-02、ユーザーが別プロジェクトへ本ツールを`init`後`setup github`まで実行する標準導入手順で実機検証した結果、当該ワークフローがconsumerのアクティブなCIへ混入し発火しうる状態になることを確認した（実害報告）。このワークフローは`src/**`・`.agent-skill-chain/**`・`AGENTS.md`・`package.json`等、consumerプロジェクトでも日常的に変更されるパスをトリガーに持ち、発火するとconsumer自身の`package.json`のversionを自動bumpし、gitタグ・GitHub Releaseをconsumer側リポジトリ上に無人で作成しようとする。`release-resolve-version.sh`/`release-bump.sh`/`release-tag.sh`/`release-publish.sh`はいずれも「解決したバージョンを対象にbump・tag・releaseする」汎用ロジックであり、対象パッケージがagent-skill-chain自身かconsumerかを区別しない。加えて本ワークフローは`permissions: contents: write`かつ`secrets.RELEASE_MAIN_PAT`（techbeansjp-free/AGENTS.md自身のadmin merge権限を持つ専用PAT）を要求する。secret未設定のconsumerでは当該ステップが失敗しCIが恒常的に赤くなり、仮に同名PATを誤って用意した場合はconsumer自身の`package.json`が意図せず自動bumpされ、無関係なgitタグ・GitHub Releaseが乱立する。

これは「agent-skill-chain本体固有の設定」と「consumerへ配布すべき汎用ガバナンス機能」の責務分離が崩れているケースであり、過去の`CLAUDE.md`直書きリーク（PR #80・#90で修正: 配布物`CLAUDE.md`に混入した本体メンテナンス限定の具体パス記述を除去）・Issue #290（配布CIへの自己テストジョブ混入）と同種の再発だが、対象がCIワークフロー本体である点でより実害が大きい。本Issueはこの誤配布を止め、再発を防ぐ分離基準を確定することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

リポジトリ管理者（ユーザー）は、consumerプロジェクトへの`init`/`upgrade`、および`.github/`への実展開を担う`sync templates`（単独実行、または`setup github`経由でこれをbundle実行する場合のいずれか。`init`直後の標準導入手順の一部として実行される場合と、`upgrade`後に単独で明示実行される場合がある）によって、agent-skill-chain本体専用のリリース自動化ワークフローが誤配布され、consumer側でCI失敗または意図しないバージョンbump・タグ・GitHub Release作成という実害が発生する状態を解消することを求めている。

### 要件

- `agent-skill-chain-release.yml`を配布元テンプレート（`.agent-skill-chain/templates/github/.github/workflows/`）から除外し、本体リポジトリの`.github/workflows/`でのみ直接管理する。
- `verify-template-sync.sh`（および内部実装である`verify template-sync`サブコマンド）の同期検査が、`agent-skill-chain-release.yml`除外後も無改修で正しく機能することを確認する。`computeTemplateSyncDiffs`（`src/lib/template-sync.ts`）はsource側（配布元テンプレート）のみを走査しdest側にのみ存在するファイルを差分として報告しない一方向検査であり、除外に伴う検査ロジック変更は不要である（この一方向性は、テンプレート側に対応物を持たないdest-only運用実績として本体`.github/workflows/agent-skill-chain-self-test.yml`〔Issue #290で分離済み〕が既にCI green のまま存在することで裏付けられる）。
- `agent-skill-chain-root-cleanup.yml`が依存する`secrets.RELEASE_MAIN_PAT`という本体専用シークレット名への対応方針は、改名を採用せずドキュメント化のみで反映する（理由: 改名すると`verify-template-sync`の同期検査によりconsumer側`.github/workflows/agent-skill-chain-root-cleanup.yml`と本体側の同ファイルの双方が同時改名を強制され、GitHub側でのsecret再登録手順が用意されないまま本体リポジトリ自身の`agent-skill-chain-root-cleanup` runが壊れるregressionリスクがあるため）。
- 配布テンプレートに含めてよいファイルと本体専用として除外すべきファイルを見分けるための分離基準（「agent-skill-chain本体の開発・配布ライフサイクル運用」 vs 「Issue駆動ガバナンスとしてconsumerも必要とする汎用機能」）を、成果物内に自己完結して文書化する。
- 本体リポジトリ自身の`agent-skill-chain / release`ワークフローの動作（バージョンbump・タグ・GitHub Release作成）に regression が生じないことを確認する。

### 受入条件（Acceptance Criteria）

#### AC-1: consumerプロジェクトへの新規配布物からrelease.ymlが除外される

- Given: `.agent-skill-chain/templates/github/.github/workflows/`から`agent-skill-chain-release.yml`が除外されている状態。かつ、対象consumerプロジェクト相当のディレクトリのローカル`<target_dir>/.agent-skill-chain/templates/github/.github/workflows/`配下に`agent-skill-chain-release.yml`が存在しない（本Issue適用後に新規`init`したディレクトリである場合、または当該ファイルをローカルに一切保持していない場合。既に`init`/`upgrade`を実行済みで当該ファイルをローカルにstaleなテンプレートとして保持している既存consumerは、この限定に該当せずAC-1の対象外——スコープ外「既知の限界」参照）
- When: 当該consumerプロジェクト相当のディレクトリに対し`node bin/agents-md.js sync templates <target_dir>`（またはビルド後CLIの`sync templates`、ラッパー`.agent-skill-chain/scripts/sync-templates.sh <target_dir>`。配布元テンプレート`.agent-skill-chain/templates/github/.github/`を`copyTreeMirror`で実際に`<target_dir>/.github/`へ展開する処理。`gh`認証・`ASC_GATE_APP_ID`等の外部前提を要さない。`init`/`upgrade`は`.github/`自体を一切生成・更新しないため対象コマンドにならない。`setup github`はこの展開処理をlabels適用・ruleset適用〔`ASC_GATE_APP_ID`必須〕と束ねた上位コマンドであり、`.github/`展開結果のみを検証する本ACではそれらの前提を要さない`sync templates`を用いる）を実行する
- Then: 展開された`<target_dir>/.github/workflows/`に`agent-skill-chain-release.yml`が含まれない
- 検証方法見込み: `automated`

#### AC-2: staleなrelease.ymlテンプレートを保持していないconsumerへの`upgrade`＋`.github/`再展開ではrelease.ymlが新規配布されない

- Given: `.agent-skill-chain/templates/github/.github/workflows/`から`agent-skill-chain-release.yml`が除外されている状態。かつ、対象consumerプロジェクト相当のディレクトリのローカル`<target_dir>/.agent-skill-chain/templates/github/.github/workflows/`配下に`agent-skill-chain-release.yml`が存在しない（本Issue適用後に新規`init`した場合、または当該ファイルをローカルから既に手動削除済みの場合。`resolveAsset`は`<target_dir>/.agent-skill-chain/`配下のローカルコピーをパッケージ同梱版より優先して解決するため、ローカルにstaleな当該ファイルが残っていないことがこのACの前提条件になる）
- When: 当該consumerディレクトリに対し`upgrade`（正本アセットのバージョン更新。`copyTreeMirror`はsrc側（配布元テンプレート）をwalkし既存ファイルを内容に関わらず無条件に上書きするが、dest側にのみ存在し配布元に存在しないファイルを削除する処理は一切含まないため、配布元から削除されたファイルをconsumer側から追従削除はしない。`.github/`自体は更新しない）を実行したのち、`sync templates`（`resolveAsset('templates/github/.github', targetDir)`で解決したテンプレートを`copyTreeMirror`で`.github/`へ再同期する処理。`gh`認証・`ASC_GATE_APP_ID`等の外部前提を要さない）を実行する
- Then: `upgrade`・`sync templates`実行後も`<target_dir>/.github/workflows/agent-skill-chain-release.yml`が作成されない
- 検証方法見込み: `automated`

#### AC-3: 本体リポジトリ自身のリリース自動化にregressionが無い

- Given: `.github/workflows/agent-skill-chain-release.yml`（本体リポジトリの直接管理ファイル）が変更後も存在し、`agent-skill-chain-release.yml`除外前と同一のバージョンbump・タグ作成・GitHub Release作成ロジックを保持している
- When: 本体リポジトリのmainへ対象パス（`src/**`等）の変更がpushされる
- Then: 従来どおり`agent-skill-chain / release`ワークフローが起動し、バージョンbump・タグ・GitHub Release作成が正常に行われる
- 検証方法見込み: `hybrid`

#### AC-4: `verify-template-sync`が新しい除外方針のもとで正しく合否判定する

- Given: `agent-skill-chain-release.yml`が配布元テンプレートには存在せず、本体リポジトリの`.github/workflows/`には存在する状態
- When: `verify-template-sync.sh`（`verify template-sync`）を本体リポジトリに対して実行する
- Then: `agent-skill-chain-release.yml`の不在・存在の差分が誤検知（未同期エラー）として報告されず、CIの当該検査がgreenになる
- 検証方法見込み: `automated`

#### AC-5: `agent-skill-chain-root-cleanup.yml`のシークレット依存についてドキュメント化のみで方針が反映されている（改名は不採用）

- Given: `agent-skill-chain-root-cleanup.yml`が配布対象（consumerも利用する汎用機能）として残り、`secrets.RELEASE_MAIN_PAT`という名称は変更しない（本Issueの設計セグメントで起票されるADR〔本判断の記録専用に起票される〕で確定する唯一の採用方針。改名は本Issueでは採用しない：改名するとconsumer側の`.github/workflows/agent-skill-chain-root-cleanup.yml`と本体側の同ファイルの双方が`verify-template-sync`の同期検査により同時改名を強制され、GitHub側でのsecret再登録手順が用意されないまま本体リポジトリ自身の`agent-skill-chain-root-cleanup` runが壊れるregressionリスクがあるため）
- When: `.agent-skill-chain/standards/SECURITY_POLICY.md`（配布物、`init`/`upgrade`でconsumerへ展開される）を参照する
- Then: `secrets.RELEASE_MAIN_PAT`の要求内容・未設定時の挙動・対処方法がドキュメント化されて反映されており、少なくとも「シークレット未設定時に何が起きるか・どう対処すべきか」がconsumer側から自己完結して理解できる
- 検証方法見込み: `manual`

#### AC-6: 配布物と本体専用ファイルの分離基準が文書化されている

- Given: 本Issueによる`agent-skill-chain-release.yml`除外後の状態
- When: AGENTS.md「GitHub配布・マルチAI対応」節、または関連ADRを参照する
- Then: 「agent-skill-chain本体の開発・配布ライフサイクル運用専用ファイル」と「consumerも必要とする汎用ガバナンス機能」を見分ける基準が明記されており、今後の同種ワークフロー追加時に同じ判断を再現できる
- 検証方法見込み: `manual`

#### AC-7: 実機確認で配布物に本体専用ワークフローが含まれないことが目視確認される

- Given: 本Issueの実装が完了した状態のブランチ
- When: `node bin/agents-md.js sync templates <tmpdir>`相当を新規一時ディレクトリに対して実機実行する（`init`単独では`.github/`自体が生成されないため確認対象そのものが存在せず、`.github/`を実際に展開する処理の実行が必要。`setup github`は同じ展開結果を得るためにラベル作成・ruleset適用という不可逆な外部書き込み副作用と`ASC_GATE_APP_ID`前提を伴うため、`.github/`展開結果の目視確認のみを目的とする本ACでは副作用を持たない`sync templates`を用いる）
- Then: 展開された`.github/workflows/`一覧に`agent-skill-chain-release.yml`が含まれないことを目視確認できる。あわせて`agent-skill-chain-root-cleanup.yml`は含まれ、そのシークレット依存に関する情報がAC-5の反映内容に沿って確認できる
- 検証方法見込み: `manual`

#### AC-8: `agent-skill-chain-root-cleanup.yml`ヘッダコメントがファイル名に依存しない表現へ書き換えられている

- Given: 本Issueの実装によりAC-1が要求する`agent-skill-chain-release.yml`の配布物からの除外が反映された状態（スコープ外節が対象内と定める例外(2)への対応）。`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml`（配布元テンプレート）と`.github/workflows/agent-skill-chain-root-cleanup.yml`（本体リポジトリの直接管理ファイル。`verify template-sync`の比較対象dest）は同一内容である必要がある
- When: 両ファイルのヘッダコメントを確認する（`grep -n "agent-skill-chain-release.yml" .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml .github/workflows/agent-skill-chain-root-cleanup.yml`で機械的に確認できる）
- Then: 両ファイルのヘッダコメント中に`agent-skill-chain-release.yml`というファイル名への直接言及がいずれも含まれない（grepが0件を返す）。テンプレート側のみを書き換えると`computeTemplateSyncDiffs`が内容不一致を未同期として報告しAC-4のThen（CIの当該検査がgreenになる）を破るため、両ファイルは同一内容へ揃えて書き換える。ジョブ定義・トリガー・ステップ構成・`permissions`・シークレット名は無変更のまま、コメント文言のみがファイル名非依存の表現に置き換わっていることを確認する
- 検証方法見込み: `automated`

## スコープ外

- 既に`init`/`upgrade`を実行済みで`agent-skill-chain-release.yml`を保持しているconsumerプロジェクトから、当該ファイルを能動的に削除する仕組み（`upgrade`コマンドへの「配布元から削除されたファイルを追従削除する」機能追加）は対象外とする。Issueの完了条件は今後の誤配布防止を求めるものであり、既存配布先への遡及的クリーンアップは別Issueで扱う。**既知の限界**: この設計上の帰結として、既に`agent-skill-chain-release.yml`をローカルの`<target_dir>/.agent-skill-chain/templates/github/.github/workflows/`配下に保持している既存consumerが、本Issue適用後に`upgrade`（`copyTreeMirror`はsrc側をwalkしてdestへコピーするのみで、dest側にのみ存在するファイルを削除する処理を一切含まないため当該staleファイルを削除しない）に続けて`setup github`を実行すると、`resolveAsset`がパッケージ同梱版より当該ローカルstaleコピーを優先して解決するため、`copyTreeMirror`により当該ファイルが再び`.github/workflows/agent-skill-chain-release.yml`として展開されてしまう（誤配布の再発）。これは能動的削除の仕組みを対象外とした本節の決定の直接の帰結であり、当該consumerが手動で`<target_dir>/.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`（ローカルテンプレート）を削除するだけでは解消されない。`copyTreeMirror`（`setup github`が用いる展開処理）はsrc側（配布元テンプレート）をwalkしてdestへコピーするのみで、dest側にのみ存在するファイルを削除する処理を一切含まないため、当該consumerが既に`setup github`まで実行済みで`<target_dir>/.github/workflows/agent-skill-chain-release.yml`（実際に発火しうるアクティブなCIワークフロー本体）が実体化済みの場合、ローカルテンプレートを削除しただけではこの実体化済みファイル自体は残存し続け、以降のpushで発火しうる状態が解消されない。したがって当該consumerは、ローカルテンプレートの削除に加え、既に実体化済みの`.github/workflows/agent-skill-chain-release.yml`自体も`.github/workflows/`配下から手動削除する必要がある。AC-2はこの既存stale保持consumerを対象範囲に含まない。
- `agent-skill-chain-root-cleanup.yml`自体を配布対象から外すこと（配布継続の是非の見直し）は対象外とする。Issue本文はI4に基づく汎用機能として配布自体は妥当と明記しており、対象はシークレット依存の扱いのみである。
- marketplace/apm配布経路の再設計・復活は対象外とする（ADR-0005で既に廃止済みであり、本Issueとは無関係）。
- AGENTS.md本文の大規模な構成変更・不変条件の追加は対象外とする。分離基準の明記は既存の「GitHub配布・マルチAI対応」節の範囲内、または新規/既存ADRへの記載で完結させる。
- `.agent-skill-chain/templates/github/.github/workflows/`配下の`agent-skill-chain-release.yml`以外のワークフロー（`agent-skill-chain-root-cleanup.yml`を含む）のジョブ定義・トリガー・ステップ構成・`permissions`の変更は対象外とする。ただし次の2点は対象内とする：(1) AC-5が要求する`secrets.RELEASE_MAIN_PAT`という名称自体への方針反映、(2) AC-1による`agent-skill-chain-release.yml`除外の不可避な帰結として、`agent-skill-chain-root-cleanup.yml`ヘッダコメントが同ファイルをファイル名で名指ししている箇所（除外後は配布物内に存在しないファイルを指す記述になる）を、ファイル名に依存しない表現へ書き換えること（AC-8。配布元テンプレート側・本体側の両ミラーファイルが対象）。この2点以外の内容変更は引き続き対象外とする。
- `.agent-skill-chain/scripts/release-resolve-version.sh`・`release-bump.sh`・`release-tag.sh`・`release-publish.sh`（`src/lib/asset-manifest.ts`の`NAMESPACED_ENTRIES`に`scripts`が含まれるため`init`/`upgrade`で引き続きconsumerへ配布される）を、AC-6が定める分離基準（「agent-skill-chain本体の開発・配布ライフサイクル運用専用」）に従って配布対象から除外することは対象外とする。**既知の限界**: これら4スクリプトのヘッダコメントは「正本: ADR-0005 / .github/workflows/agent-skill-chain-release.yml」を記載しており、AC-6の分離基準を適用すると本体専用に分類されるにもかかわらず、`scripts`は名前空間単位で一括配布/除外する現行の`NAMESPACED_ENTRIES`実装では個別ファイル単位の除外を行えないため、本Issueの範囲では除外を見送る。ただしAC-1による`agent-skill-chain-release.yml`除外後、配布物内でこれら4スクリプトを呼び出すワークフローは存在しなくなる（唯一の呼び出し元である`agent-skill-chain-release.yml`自体が配布対象外となるため）。したがってconsumer側`.agent-skill-chain/scripts/`名前空間内に留まる限り、これら4スクリプトの残置は新たなCI自動発火・実害経路を生まない。ヘッダコメントが指す`.github/workflows/agent-skill-chain-release.yml`は本体リポジトリに実在し続けるファイルであり、AC-8で扱うようなダングリング参照（除外後に存在しないファイルを指す記述）には該当しないため、AC-8と同種の書き換えは不要である。個別ファイル単位の配布除外機構の追加は別Issueで扱う。
