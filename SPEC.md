# SPEC: security: agent-skill-chain-release.ymlが配布物経由でconsumerプロジェクトのCIへ混入する

- Issue: `#344`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/344-distribution-release-workflow-leak`

## 目的・背景

`agent-skill-chain-release.yml`（配布元正本: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`）は、agent-skill-chain本体（techbeansjp-free/AGENTS.md）自身のnpmパッケージ配布リリース自動化（`package.json`のバージョン自動bump・gitタグ作成・GitHub Release作成。由来: Issue #196、ADR-0005）専用のワークフローである。にもかかわらず`.agent-skill-chain/templates/github/.github/`配下（配布元テンプレート）に置かれているため、`init`/`upgrade`実行時にあらゆるconsumerプロジェクトへそのまま展開される。

2026-08-02、ユーザーが別プロジェクトへ本ツールを`init`/`upgrade`して実機検証した結果、当該ワークフローがconsumerのCIへ混入することを確認した（実害報告）。このワークフローは`src/**`・`.agent-skill-chain/**`・`AGENTS.md`・`package.json`等、consumerプロジェクトでも日常的に変更されるパスをトリガーに持ち、発火するとconsumer自身の`package.json`のversionを自動bumpし、gitタグ・GitHub Releaseをconsumer側リポジトリ上に無人で作成しようとする。`release-resolve-version.sh`/`release-bump.sh`/`release-tag.sh`/`release-publish.sh`はいずれも「解決したバージョンを対象にbump・tag・releaseする」汎用ロジックであり、対象パッケージがagent-skill-chain自身かconsumerかを区別しない。加えて本ワークフローは`permissions: contents: write`かつ`secrets.RELEASE_MAIN_PAT`（techbeansjp-free/AGENTS.md自身のadmin merge権限を持つ専用PAT）を要求する。secret未設定のconsumerでは当該ステップが失敗しCIが恒常的に赤くなり、仮に同名PATを誤って用意した場合はconsumer自身の`package.json`が意図せず自動bumpされ、無関係なgitタグ・GitHub Releaseが乱立する。

これは「agent-skill-chain本体固有の設定」と「consumerへ配布すべき汎用ガバナンス機能」の責務分離が崩れているケースであり、過去の`docs/GLOSSARY.md`直書きリーク（[[project_claude-md-dogfooding-leak-fix]]）・Issue #290（配布CIへの自己テストジョブ混入）と同種の再発だが、対象がCIワークフロー本体である点でより実害が大きい。本Issueはこの誤配布を止め、再発を防ぐ分離基準を確定することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

リポジトリ管理者（ユーザー）は、consumerプロジェクトへの`init`/`upgrade`によって、agent-skill-chain本体専用のリリース自動化ワークフローが誤配布され、consumer側でCI失敗または意図しないバージョンbump・タグ・GitHub Release作成という実害が発生する状態を解消することを求めている。

### 要件

- `agent-skill-chain-release.yml`を配布元テンプレート（`.agent-skill-chain/templates/github/.github/workflows/`）から除外し、本体リポジトリの`.github/workflows/`でのみ直接管理する。
- `verify-template-sync.sh`（および内部実装である`verify template-sync`サブコマンド）の同期検査を、この除外方針のもとでも正しく機能する形に対応させる。
- `agent-skill-chain-root-cleanup.yml`が依存する`secrets.RELEASE_MAIN_PAT`という本体専用シークレット名への依存について、対応方針（改名・ドキュメント化・fail-safe明記のいずれか、または組み合わせ）を決定し反映する。
- 配布テンプレートに含めてよいファイルと本体専用として除外すべきファイルを見分けるための分離基準（「agent-skill-chain本体の開発・配布ライフサイクル運用」 vs 「Issue駆動ガバナンスとしてconsumerも必要とする汎用機能」）を、成果物内に自己完結して文書化する。
- 本体リポジトリ自身の`agent-skill-chain / release`ワークフローの動作（バージョンbump・タグ・GitHub Release作成）に regression が生じないことを確認する。

### 受入条件（Acceptance Criteria）

#### AC-1: consumerプロジェクトへの新規配布物からrelease.ymlが除外される

- Given: `.agent-skill-chain/templates/github/.github/workflows/`から`agent-skill-chain-release.yml`が除外されている状態
- When: 任意のconsumerプロジェクト相当のディレクトリに対し`node bin/agents-md.js setup github <target_dir>`（またはビルド後CLIの`setup github`。配布元テンプレート`.agent-skill-chain/templates/github/.github/`を実際に`<target_dir>/.github/`へ展開する処理。`init`/`upgrade`は`.github/`自体を一切生成・更新しないため対象コマンドにならない）を実行する
- Then: 展開された`<target_dir>/.github/workflows/`に`agent-skill-chain-release.yml`が含まれない
- 検証方法見込み: `automated`

#### AC-2: 既存consumerへの`upgrade`＋`setup github`再実行でもrelease.ymlが新規配布されない

- Given: `.agent-skill-chain/templates/github/.github/workflows/`から`agent-skill-chain-release.yml`が除外されている状態。かつ、`init`後に`setup github`を一度実行済みで`agent-skill-chain-release.yml`を持たない既存consumerプロジェクト相当のディレクトリが存在する
- When: 当該既存consumerディレクトリに対し`upgrade`（正本アセットのバージョン更新。`.github/`自体は更新しない）を実行したのち、`setup github`（`.github/`をテンプレート最新版へ再同期する処理）を実行する
- Then: `upgrade`・`setup github`実行後も`<target_dir>/.github/workflows/agent-skill-chain-release.yml`が作成されない
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

#### AC-5: `agent-skill-chain-root-cleanup.yml`のシークレット依存に対する方針が反映されている

- Given: `agent-skill-chain-root-cleanup.yml`が配布対象（consumerも利用する汎用機能）として残る
- When: consumerプロジェクトが`init`直後、追加のシークレット設定を行わずに当該ワークフローをmainへのpushで発火させる
- Then: 「汎用シークレット名への改名」「用途・設定要否のドキュメント化」「admin merge権限が無い場合のfail-safe（human_requiredへの降格）明記」のいずれか（または組み合わせ）が反映されており、少なくとも「シークレット未設定時に何が起きるか・どう対処すべきか」がconsumer側から自己完結して理解できる
- 検証方法見込み: `manual`

#### AC-6: 配布物と本体専用ファイルの分離基準が文書化されている

- Given: 本Issueによる`agent-skill-chain-release.yml`除外後の状態
- When: AGENTS.md「GitHub配布・マルチAI対応」節、または関連ADRを参照する
- Then: 「agent-skill-chain本体の開発・配布ライフサイクル運用専用ファイル」と「consumerも必要とする汎用ガバナンス機能」を見分ける基準が明記されており、今後の同種ワークフロー追加時に同じ判断を再現できる
- 検証方法見込み: `manual`

#### AC-7: 実機確認で配布物に本体専用ワークフローが含まれないことが目視確認される

- Given: 本Issueの実装が完了した状態のブランチ
- When: `node bin/agents-md.js setup github <tmpdir>`相当を新規一時ディレクトリに対して実機実行する（`init`単独では`.github/`自体が生成されないため確認対象そのものが存在せず、`.github/`を実際に展開する`setup github`の実行が必要）
- Then: 展開された`.github/workflows/`一覧に`agent-skill-chain-release.yml`が含まれないことを目視確認できる。あわせて`agent-skill-chain-root-cleanup.yml`は含まれ、そのシークレット依存に関する情報がAC-5の反映内容に沿って確認できる
- 検証方法見込み: `manual`

## スコープ外

- 既に`init`/`upgrade`を実行済みで`agent-skill-chain-release.yml`を保持しているconsumerプロジェクトから、当該ファイルを能動的に削除する仕組み（`upgrade`コマンドへの「配布元から削除されたファイルを追従削除する」機能追加）は対象外とする。Issueの完了条件は今後の誤配布防止を求めるものであり、既存配布先への遡及的クリーンアップは別Issueで扱う。
- `agent-skill-chain-root-cleanup.yml`自体を配布対象から外すこと（配布継続の是非の見直し）は対象外とする。Issue本文はI4に基づく汎用機能として配布自体は妥当と明記しており、対象はシークレット依存の扱いのみである。
- marketplace/apm配布経路の再設計・復活は対象外とする（ADR-0005で既に廃止済みであり、本Issueとは無関係）。
- AGENTS.md本文の大規模な構成変更・不変条件の追加は対象外とする。分離基準の明記は既存の「GitHub配布・マルチAI対応」節の範囲内、または新規/既存ADRへの記載で完結させる。
- `.agent-skill-chain/templates/github/.github/workflows/`配下の`agent-skill-chain-release.yml`以外のワークフロー（`agent-skill-chain-root-cleanup.yml`を含む）の内容変更（シークレット名以外）は対象外とする。
