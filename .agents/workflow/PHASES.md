# PHASES.md — フェーズ順・成果物・DoD

フェーズは**状態 gate**。どの phase でどの **command**（skill chain）を起動するかは commands/ と本表、および [PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) で対応させる。監査観点は簡潔に。**モード別の適用は [RULES.md](../RULES.md) の実行モードを参照。**

---

## フェーズ一覧

| フェーズ | 起動する command（必須） | 必須成果物 | DoD（完了定義） |
|----------|--------------------------|------------|------------------|
| 要求 | requirement-discovery | 00_要求定義.md | 目的・受け入れ基準・参照元が記載されている |
| 要件 | requirement-discovery（続き） | 01_要件定義.md | ユーザーストーリー・受け入れ基準・BDD シナリオが記載されている |
| 設計 | design-feature | 02_設計.md | 責務・参照関係・テスト観点が記載されている |
| 実装計画 | design-feature または implement-feature の入口 | 03_実装計画.md | タスク分解・テスト仕様（BDD）が記載されている |
| 実装 | implement-feature | 成果物・コード等 | 実装計画に従い実装され、単体テスト観点を満たす |
| レビュー | verify-and-close | 04_review.md | 実装内容・受け入れ基準の確認が記載されている |

---

## レビュー成果物の配置ルール

- **04_review（04_review.md）は、実装フェーズ完了後のレビューフェーズ（verify-and-close を実行するとき）でのみ作成・更新する。要求・要件・設計・実装計画のいずれかのフェーズで 04_review を作成してはならない。**
- **レビューフェーズで verify-and-close が実施するレビュー**（00/01/02/03 および実装成果物の確認を含む）の成果物は、**issue フォルダ直下に 04_review（04_review.md）を直接作成**する。
- **memo にレビューを書かない**。memo はレビュー以外のメモ・証跡用とする。「memo にレビューを書く」という指示・振る舞いは禁止する。

---

## 監査観点

- 各フェーズの成果物が**テンプレート**の必須セクションを満たしていること。
- **各工程で監査・書記に依頼する**。worker（監査・書記以外）の command 完了後は、要求・要件・設計・実装計画・実装のいずれの工程でも必ず verify-and-close（監査・書記）を経ること。レビュー・クローズ前に必ず verify-and-close を経ること。
- **ユースケースに基づく全シナリオ**について、**テストコード化できるものは全て**テストコード化されていること（できない場合は理由が明記されていること）。01 の BDD シナリオとテスト仕様（単体テスト仕様・チェックリスト等）の対応が取れていることを確認する。
- **フォーマットは正しいか**。成果物がフォーマット規約に適合していること（テンプレート必須セクション・用語・参照リンク・BDD 形式等）。ディレクトリ構成・ファイルの作成場所・命名規則（spec/03）・**プレフィックス**（memo および issue フォルダ名の YYYYMMDD_HHMMSS_ は実行環境現在時刻 JST 取得。推測・固定・未来禁止）・spec 準拠（設計原則・UNIX 哲学等）を含む。
- 証跡（memo・ログ）のプレフィックスは **YYYYMMDD_HHMMSS_** とし、**実行環境の現在時刻（JST）を取得して付与すること**。**memo プレフィックスは専用経路のみで取得すること**: **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S** の実行、または **.agents/scripts/memo-prefix.sh** の実行で得た値を使用する。**issue フォルダ名のプレフィックス**も同様に**実行環境の現在時刻（JST）を取得**して付与すること。**TZ=Asia/Tokyo date +%Y%m%d_%H%M%S** の実行、または **.agents/scripts/memo-prefix.sh** の実行で得た値を使用する。**推測・固定・未来日時の使用は禁止**（手入力・固定値・推測・未来日時を使わない）。ログは一定のルールで必ず記録すること。
- command 実行は commands/{name}.md の skill chain に従っていること。
- **サブissueを 1 件以上作成した場合**: 親ワークフローのルートに **90_issues.md が存在すること**。未作成のまま当該フローを完了とみなさない。run_command の Constraints および該当 command の DoD と整合して検証する。
- **監査で検証する項目**（上記のほか）: テストコードは Given / When / Then をインラインコメントで記載していること（.agents/TEST_BDD_FORMAT.md）。詳細は .agents/REVIEW_RULE.md を参照する。
- **実装成果物にテストが含まれる場合、レビュー（04_review 作成・更新）時点でテストを再実行し、その結果を 04_review に記載すること。** テスト未実行のまま監査完了とみなさない。

---

フェーズ→command の対応は commands/ 配下のファイル名と上表に加え、[PHASE_COMMAND_MAP.md](PHASE_COMMAND_MAP.md) を**単一の正本**として把握する。オーケストレーションは agents/README.md を参照する。

**Phase 別の skill 必須条件**（どの phase でどの capability が mandatory か・省略時どうするか）は [SKILL_MANDATORY.md](SKILL_MANDATORY.md) を参照する。
