# LOAD_POLICY.md — いつ何を読むか

**「最初に何を読むか」「トリガー→読むファイル」の正本は本ファイルのみ。** GETTING_STARTED は要約、platforms はスキル形式・配備の差分のみ。重複を避けるため、トリガー追加時は本表のみ更新する。

トリガーごとに読むファイルを表で示す。**command = skill chain**。capability は skills/{domain}/{name}/ の 1 単位。

---

## トリガー → 読むファイル

| トリガー | 読むファイル / 動作 |
|----------|---------------------|
| **ユーザーから作業依頼を受けた**（生成・修正・作成・調査・レビュー・issue 化等。単なる質問でない依頼） | **必ず orchestrator として動く。** agents/orchestrator.md → workflow/PHASES.md → skills/agent/run_command.md → 該当 commands/{name}.md。phase 判定 → command 選択 → 委譲。**.workflow 配下の新規 issue フォルダ作成および 00_要求定義.md の作成・更新**は、phase 要求に対応する **requirement-discovery** を委譲して行う。メインは自ら Write/Edit しない。 |
| 起動・契約確認 | boot/CORE.md → 本ファイル（LOAD_POLICY）→ workflow/PHASES.md |
| 思想・判断の問い | CONCEPTS.md |
| **システム開発の基本・設計原則・設計判断の優先順位** | **spec/**（00_spec概要、01_設計原則、02_ディレクトリ構造方針、06_設計判断の優先順位。要求・設計 command の前に参照する） |
| 実行・ドキュメント・テスト・レビュー要約 | RULES.md |
| **command を実行するとき** | プロジェクトルートの **.agents-project/** を読む（存在する場合）。**skills/agent/run_command.md** → **commands/{command}.md**（例: requirement-discovery, implement-feature） |
| 要求発見 command | **commands/requirement-discovery.md** に加え、**workflow/TEMPLATES.md** および **成果物 00/01 に対応するテンプレートファイル**（.workflow/templates/00_要求定義.md, .workflow/templates/01_要件定義.md。プロジェクトに .workflow/templates が無い場合はパッケージの **`.workflow/templates/`** の同ファイル）を**読む**。続けて記載された skill chain を順に読む。 |
| 設計 command | commands/design-feature.md → 記載された skill chain を順に読む |
| 実装 command | commands/implement-feature.md → 記載された skill chain を順に読む |
| 検証・クローズ command | commands/verify-and-close.md → 記載された skill chain を順に読む |
| 単体 capability を使うとき | 該当 skills/{domain}/{capability}/（例: skills/requirements/write-bdd/） |
| フェーズ→どの command を起動するか | workflow/PHASES.md と commands/ 一覧。オーケストは agents/README.md |
| システム仕様書（docs/）の更新・レビュー時 | RULES.md（システム仕様書）→ DOCS_RULES.md。issue は立てず docs/00_review/ に記載する。 |

---

command 実行時は run_command.md を読んだうえで、該当 commands/{name}.md に記載された skill chain を**順に**読んで実行すること。
単体で capability だけ使う場合は、LOAD_POLICY の「単体 capability」に従い該当 skills/{domain}/{capability}/ を読むこと。
