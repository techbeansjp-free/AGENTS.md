# SPEC: docs: 各種モード・設定項目が散在しており体系的に一望できるドキュメントが無い(設定リファレンス整備)

- Issue: `ISSUE-429`
- 作成者: `spec_worker`
- 対象ブランチ: `docs/429-config-reference-consolidation`

## 目的・背景

`.agent-skill-chain/config/agent-skill-chain.yaml`（正本: `.agent-skill-chain/schemas/config.schema.yaml`）には、機能追加のたびに設定軸が積み増され、現時点でトップレベルだけで `schema_version` を含め18項目（`coordination`・`durability`・`autonomy`・`risk`・`review`・`worker`・`worktree`・`branch`・`issue`・`wip`・`lease`・`bdd`・`issue_sync`・`merge`・`human_confirmation`・`templates`・`checks`、うち `issue_sync`・`merge`・`human_confirmation` はスキーマ上後方互換の任意項目）が存在する。

これらの設定項目・モードの説明は、AGENTS.md（不変条件I8等の記述の中に埋め込まれる形）・README.md（「## 設定」節に一部のみ）・各Issue由来のADR（`docs/adr/`配下）・`.agent-skill-chain/config/agent-skill-chain.yaml`自体のコメントに分散しており、「このシステムに何を設定できて、それぞれが何に影響するか」を一望できる単一の資料が存在しない。利用者が新しい設定を発見・理解するには、複数のファイルを横断的に読む必要がある。

2026-08-04、ユーザーから「現在様々なモード・機能・設定できるようになっているが、体系化された全体把握できるドキュメントがない。陳腐化させないための仕組みも併せて考える必要がある」との指摘を受け起票された。起票時点で依存関係にあったIssue #425（quickモード）・Issue #427（`merge.autonomous`・`human_confirmation.before_implementation`）は本Issue着手前に完了・クローズ済みであり、本SPECは両者マージ後の実際のmain（`.agent-skill-chain/config/agent-skill-chain.yaml`・`.agent-skill-chain/schemas/config.schema.yaml`）を根拠に記述する。

一覧化した資料は放置すると陳腐化する。設定スキーマへ新しい項目が追加された将来のIssueで、参照資料の追随漏れが機械的に検出されない限り、本Issueの成果は時間とともに信頼できなくなる。そのため本Issueは、資料の新設だけでなく、その陳腐化を防ぐ機械検査の新設も要求に含める。

## 要求 → 要件 → 受入条件

### 要求

利用者（本リポジトリの開発者・consumerプロジェクトの導入者）が、agent-skill-chainに存在する全ての設定項目・モードとその効果を、単一のドキュメントを読むだけで体系的に把握できるようにする。加えて、当該ドキュメントが設定スキーマの変更に追随せず陳腐化することを、本リポジトリ自身のCIが機械的に検出できるようにする。

### 要件

- `docs/CONFIGURATION.md`を新設し、`.agent-skill-chain/schemas/config.schema.yaml`が定義する全トップレベル設定項目（後方互換の任意項目を含む）を一覧化する。
- 各項目について、設定名・既定値・取りうる値・何に影響するかの要約（1〜2行）・詳細な設計根拠へのリンク（AGENTS.mdの該当不変条件、または該当ADR）を記載する。
- 独立に扱うべき設定軸同士の関係（例: `autonomy`と`human_confirmation.*`は別軸、`risk`と`autonomy`の組み合わせがI8のstrict review発動条件にどう関わるか）を整理して記載する。
- `docs/ARCHITECTURE.md`（動作フローの図解が役割）と`docs/CONFIGURATION.md`（設定項目の一覧が役割）の役割分担を明確にし、両ドキュメント間で内容を重複させない。
- README.mdの「## 設定」節から`docs/CONFIGURATION.md`へのリンクを追加する。
- 記載内容は着手時点の実際の`.agent-skill-chain/config/agent-skill-chain.yaml`・`.agent-skill-chain/schemas/config.schema.yaml`の内容と一致させ、架空の項目・存在しない既定値・古い項目を含めない。
- 設定スキーマ（`.agent-skill-chain/schemas/config.schema.yaml`）のトップレベルプロパティに`docs/CONFIGURATION.md`が追随しているかを機械的に検査する仕組みを、本リポジトリ自身のCI（`verify`必須チェック）に新設する。当該検査は本リポジトリ自身の開発用CIにのみ組み込み、配布先consumerプロジェクトの`.agent-skill-chain/ci/`配布物（`.agent-skill-chain/templates/github/.github/`経由で展開されるもの）には含めない。

### 受入条件（Acceptance Criteria）

#### AC-1: docs/CONFIGURATION.mdが新設され全トップレベル設定項目を一覧化している

- Given: 着手時点の`.agent-skill-chain/schemas/config.schema.yaml`が定義するトップレベルプロパティ集合（`required`＋後方互換の任意項目）
- When: `docs/CONFIGURATION.md`を新設する
- Then: 当該プロパティ集合の全項目（`schema_version`を除く）が`docs/CONFIGURATION.md`内に見出しまたは項目として記載されている
- 検証方法見込み: `automated`

#### AC-2: 各設定項目のエントリが必須情報を備えている

- Given: `docs/CONFIGURATION.md`に記載された各設定項目のエントリ
- When: 当該エントリを読む
- Then: 設定名・既定値・取りうる値・何に影響するかの要約（1〜2行）・詳細な設計根拠へのリンク（AGENTS.mdの該当不変条件、または該当ADRファイルへの参照）の5要素が全て記載されている
- 検証方法見込み: `manual`

#### AC-3: 独立な設定軸同士の関係整理が記載されている

- Given: `docs/CONFIGURATION.md`
- When: `autonomy`と`human_confirmation.*`のような、混同されやすいが独立に扱うべき設定軸の関係を確認する
- Then: どの設定同士が独立軸か、どの組み合わせが特定の挙動（例: I8のstrict review発動条件である`risk != normal` OR `autonomy == full`）を導くかが明文化されている
- 検証方法見込み: `manual`

#### AC-4: ARCHITECTURE.mdとCONFIGURATION.mdの役割分担が明確である

- Given: 既存の`docs/ARCHITECTURE.md`と新設の`docs/CONFIGURATION.md`
- When: 両ドキュメントの冒頭または該当箇所を確認する
- Then: ARCHITECTURE.mdが動作フローの図解、CONFIGURATION.mdが設定項目の一覧という役割分担が明記されており、同一内容の実質的な重複記載が無い
- 検証方法見込み: `manual`

#### AC-5: README.mdの設定節からリンクされている

- Given: README.mdの「## 設定」節
- When: 当該節を確認する
- Then: `docs/CONFIGURATION.md`へのリンクが含まれている
- 検証方法見込み: `automated`

#### AC-6: 記載内容が実際の設定ファイル・スキーマと一致している

- Given: 着手時点の`.agent-skill-chain/config/agent-skill-chain.yaml`・`.agent-skill-chain/schemas/config.schema.yaml`
- When: `docs/CONFIGURATION.md`の記載項目・既定値・取りうる値を突き合わせる
- Then: 架空の設定項目・存在しない既定値・削除済みの古い項目が`docs/CONFIGURATION.md`に含まれていない
- 検証方法見込み: `manual`

#### AC-7: スキーマ変更への追随漏れを検出する機械検査が新設されている

- Given: `.agent-skill-chain/schemas/config.schema.yaml`のトップレベルプロパティ集合と`docs/CONFIGURATION.md`の記載項目集合
- When: 本リポジトリ自身のCI（`verify`必須チェック）が実行される
- Then: スキーマ側にのみ存在し`docs/CONFIGURATION.md`に対応する記載が無いトップレベルプロパティがある場合、当該CIチェックが失敗する
- 検証方法見込み: `automated`

#### AC-8: 追随漏れ検出の機械検査がconsumerプロジェクトへ配布されない

- Given: `.agent-skill-chain/templates/github/.github/`（配布テンプレートの正本）と、AC-7で新設される検査
- When: 配布テンプレートの内容を確認する
- Then: AC-7の検査は本リポジトリ自身の開発用CI定義にのみ存在し、`.agent-skill-chain/templates/github/.github/`経由でconsumerプロジェクトへ配布されるワークフロー・スクリプトには含まれていない
- 検証方法見込み: `automated`

#### AC-9: vocab・references のlintがエラーにならない

- Given: 本Issueによる変更一式（`docs/CONFIGURATION.md`新設、README.md更新、CI検査新設を含む）
- When: `node bin/agents-md.js lint vocab` および `node bin/agents-md.js lint references` を実行する
- Then: いずれもエラー無しで終了する
- 検証方法見込み: `automated`

## スコープ外

- AC-7の機械検査の具体的な実装方式（抽出コマンド・比較アルゴリズム・新設CIワークフローかverify-*.shへの追加か等）の確定。これは設計セグメント（DESIGN.md）で確定する。
- `docs/CONFIGURATION.md`のセクション構成・見出し階層・表組み形式等の具体的な構成案。これは設計セグメントで確定する。
- `docs/system-spec/`の新設・拡張（AGENTS.md「`docs/system-spec/`（システム仕様書）」節が定める、別ADRによる段階導入が前提の別トピックであり本Issueの対象外）。
- `.agent-skill-chain/config/agent-skill-chain.yaml`・`.agent-skill-chain/schemas/config.schema.yaml`自体の設定項目の追加・変更・削除（本Issueは既存項目の文書化のみを扱う）。
- AGENTS.md本文・各ADR本文の書き換え（`docs/CONFIGURATION.md`からのリンク先として参照するのみで、リンク先自体の内容変更は行わない）。
- consumerプロジェクト向けの`.agent-skill-chain/project/`テンプレート・設定例の追加。
- Issue #461・Issue #462（本Issueと無関係な既存の別バグ）の対応。
