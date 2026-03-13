# run_command — command 実行の共通 I/F

**委譲定義は本 run_command に一本化する。** 委譲の実行手段（Cursor 上で何を呼ぶか）は本ファイル 1 か所で規定し、他に委譲の呼び方を定義するファイルは設けない。メイン（orchestrator）は capability を直接呼ばず、**常に本 run_command を経由して**サブエージェントへ委譲する。**実行時の参照先は本 run_command と commands/{name}.md のみ**とし、orchestrator が skills/{domain}/{capability} を直接参照して起動する経路は設けない。

**責務**: command を**起動するときの共通インターフェース**のみを定義する。**この I/F はメインがサブに委譲するときに使う。メインはこの手順を自分では実行しない。実行するのは委譲を受けたサブのみ。** どの skill をどの順で実行するかは commands/{name}.md が定義する。各 step の手順は各 skills/{domain}/{capability}/ が定義する。本ファイルには手順の二重記載をしない。

---

## Execution Path Rule

すべての command 実行は **本 run_command.md を経由する**。

メインエージェントが

- 直接実装する
- 直接設計を書く
- 直接レビューを書く
- 直接テストを書く
- 直接ファイルを編集する

ことは禁止される。

command 実行は必ず次の順で行う。

1. メインが PHASES に基づき command を決定する（orchestrator）
2. メインが本 run_command を用いてサブエージェントへ委譲する
3. サブエージェントが commands/{name}.md の skill chain を実行する
4. サブエージェントが成果物と証跡を出力する

---

## 委譲の形（共通）

command 実行を委譲するときに渡すブロック。内容の詳細は各 command の DoD と成果物に委譲する。

### Task

- **目的**: どの command を実行するか（例: requirement-discovery, implement-feature）。1 文で明確に。
- **成果物**: その command の DoD と commands/{name}.md に記載された成果物（ファイル名・形式）。成果物のフォーマットは workflow/TEMPLATES.md に従う。
- **参照**: 該当 commands/{name}.md。chain 内の各 skills/{domain}/{capability}/。必要なら 00/01/02/03 該当 §。

### Constraints

- **守るルール**: CORE / LOAD_POLICY / PHASES / RULES / IO_CONTRACT。該当 command ファイルに記載された**順序**を守ること。飛ばさない。All output must conform to .agents/IO_CONTRACT.md and .agents/RULES.md
- **.agents-project**: プロジェクトルートの **.agents-project/** が存在する場合は、command 実行**前**に読了・参照すること。
- **worker 完了後**: 監査・書記以外の worker command（requirement-discovery, design-feature, implement-feature 等）の完了後、オーケストレータは**必ず** verify-and-close を指示すること。省略して次フェーズへ進めてはならない。
- **書記依頼の強制**: 各サブエージェントは、command の成果を記録するため、**必ず**書記（write-workflow-log）に依頼して記録させること。省略してはならない。強制的に実施する。
- **verify-and-close を委譲する場合**: command の skill chain を**最後まで**実行すること。step 5（write-workflow-log）を**省略しない**こと。workflow.db を採用している場合は write-workflow-log.sh を**必ず**実行すること。
- **各フェーズ完了時の verify-and-close**: 要求・要件・設計・実装計画・実装の**各フェーズ完了時**に verify-and-close を委譲し、skill chain を最後まで（write-workflow-log 含む）実行すること。write-workflow-log を省略しないこと。運用で「レビュー＝実装後だけ」と解釈されないようにする。
- **レビュー成果物**: **レビューフェーズ**（実装完了後に verify-and-close を委譲するとき）で作成するレビュー成果物は、**issue 直下に 04_review を直接作成**すること。**04_review は実装前に作成してはならない。** ドキュメントレビュー等の証跡は memo に記録してよい（推奨）。**04_review に相当する正式なレビュー成果物は memo に書かない**。
- **04_review 作成・更新時**: 実装成果物にテストが含まれる場合は、verify-and-close の実行時に**テストを再実行**し、結果を 04_review に記載すること。テスト未実行のまま監査完了とみなしてはならない。
- **memo 作成時**: **.workflow/{issue}/memo/** に作成すること。ファイル名に **YYYYMMDD_HHMMSS_**（日本標準時）をプレフィックスとして付与すること。プレフィックスは **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agents/scripts/memo-prefix.sh の実行**で得た値に限定する。取得は memo ファイル作成のたびに実行すること（キャッシュ・事前計算に依存しない）。**推測・固定・未来日時の使用は禁止**する（手入力・AI の推測・ハードコード・未来日時を使わない）。**memo ファイルを実際に作成する直前に**、必ず **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S を実行する**か **.agents/scripts/memo-prefix.sh を実行し**、その**標準出力**をプレフィックスとして使用すること。**コマンドを実行せずにファイル名を組み立ててはならない。** ユーザー依頼・コンテキストの日付・現在時刻の推測からプレフィックスを決めてはならない。
- **issue フォルダ作成時**: **.workflow/** に issue 用ディレクトリを作成するとき、ディレクトリ名のプレフィックスは **YYYYMMDD_HHMMSS_**（日本標準時）とする。プレフィックスは **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agents/scripts/memo-prefix.sh の実行**で得た値に限定する。取得は issue フォルダ作成のたびに実行すること（キャッシュ・事前計算に依存しない）。**推測・固定・未来日時の使用は禁止**する（手入力・AI の推測・ハードコード・未来日時を使わない）。**issue フォルダを実際に作成する直前に**、必ず **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S を実行する**か **.agents/scripts/memo-prefix.sh を実行し**、その**標準出力**をプレフィックスに使用すること。**実行せずにフォルダ名を組み立ててはならない。**
- **サブissue作成時**: サブissueを 1 件以上作成した場合は、**親ワークフロー（.workflow/{親issue}/）のルートに 90_issues.md を必ず作成すること**。未作成のまま当該フローを完了とみなさない。
- **禁止**: command ファイルを読まずに skill だけ実行しないこと。chain の順序を変えたり飛ばしたりしないこと。
- **成果物が 00/01/02/03/04 のいずれかである場合**: 成果物が 00_要求定義.md / 01_要件定義.md / 02_設計.md / 03_実装計画.md / 04_review.md のいずれかである command を実行する場合、**該当するテンプレートファイル**（workflow/TEMPLATES.md の表に従う。プロジェクトの .workflow/templates に無い場合は AGENTS-spec/.workflow/templates の同ファイル）を**必ず開き**、その**見出し・セクション構成・必須項目を欠かさず**に成果物を執筆すること。**00_要求定義の場合は、テンプレートの全セクション（「要求定義の全体像」およびその中の Mermaid マインドマップを含む）を欠かさないこと。** テンプレートを省略した形で 00 を作成することは禁止する。

### OutputSpec

- **完了条件**: その command の DoD を満たしていること。
- **証跡**: 実施内容・変更ファイルを記録すること。本則は workflow.db。memo は workflow.db を採用しない場合の過渡的・例外運用のみ（scribe/CONTRACT 参照）。

---

## command の実行のしかた（共通ルールのみ）

1. 指定された **commands/{name}.md** を開き、**Skill chain** の順序を確認する。
2. 記載された **skills/{domain}/{capability}/** を**順に**読み、各 capability の README.md または SKILL.md の手順・制約・成果物に従って実行する。前の capability の OUT を次の IN に渡す。
3. memo ファイルまたは issue フォルダを作成する場合は、上記 Constraints のプレフィックス取得に従い、**必ず先に** memo-prefix.sh または TZ=Asia/Tokyo date +%Y%m%d_%H%M%S を**実行**し、得た出力をプレフィックスに用いること。実行しないでプレフィックスを決めたり、コンテキストの日付で組み立てたりしてはならない。
4. command ファイル末尾の **DoD** を満たしたら完了。証跡を残す（本則 workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス必須）。

※ 各 step の具体的な手順・入出力の受け渡し・実行時の注意は **commands/{name}.md** と **各 capability の README/SKILL** に記載する。本ファイルでは「command を起動するときの共通 I/F」と「順に読んで実行する」ことだけを定める。

---

## 委譲の適用（成果物がドキュメントの場合）

成果物が 01_要件定義.md / 02_設計.md / 03_実装計画.md 等のドキュメントである command（requirement-discovery, design-feature 等）を実行する場合も、**上記と同じ委譲の形**を用いる。メインは Task に目的・成果物・参照（00/01/02/03 のパス等）を指定し、本 run_command に従ってサブ（または人間作業者・外部ツール）を呼び出す。サブは受け取った指示に従い、該当ドキュメントの作成・更新を行う。**呼び出し仕様は「本 run_command の Task/Constraints/OutputSpec を渡して委譲する」の 1 か所に集約し、サブエージェント・ツールの具体名には依存しない。** 抽象レイヤ（サブエージェント群・人間・外部ツール）で記述し、プロジェクトごとに具体化する。

---

## 参照

- LOAD_POLICY（トリガー「command を実行するとき」）
- 各 commands/{name}.md（**skill chain の定義のみ**。手順の詳細は各 skill へ委譲）
- CORE（読了義務・証跡省略禁止）
