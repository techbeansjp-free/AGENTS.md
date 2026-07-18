# run_command — command 実行の共通 I/F

**委譲定義は本 run_command に一本化する。** 委譲の実行手段（Cursor 上で何を呼ぶか）は本ファイル 1 か所で規定し、他に委譲の呼び方を定義するファイルは設けない。メイン（orchestrator）は capability を直接呼ばず、**常に本 run_command を経由してサブエージェントへ委譲する（絶対強制。規範強度・例外の正本は [boot/CORE.md](../../boot/CORE.md) §Orchestrator Strict Rules・§フォールバック方針）。** **実行時の参照先は本 run_command と commands/{name}.md のみ**とし、orchestrator が skills/{domain}/{capability} を直接参照して起動する経路は設けない。

**責務**: command を**起動するときの共通インターフェース**のみを定義する。**この I/F はメインがサブに委譲するときに使う。メインはこの手順を自分では実行しない。実行するのは委譲を受けたサブのみ。** どの skill をどの順で実行するかは commands/{name}.md が定義する。各 step の手順は各 skills/{domain}/{capability}/ が定義する。本ファイルには手順の二重記載をしない。

---

## Execution Path Rule

すべての command 実行は **本 run_command.md を経由する**。

メインエージェントが

- 直接実装する
- 直接設計を書く
- 直接レビューを書く
- 直接テストを書く
- 直接ファイルを編集・作成する（00〜04、memo、任意の成果物を含む）

ことは**絶対禁止**される（絶対強制。規範強度・例外の正本は [boot/CORE.md](../../boot/CORE.md) §Orchestrator Strict Rules・§フォールバック方針であり、本項では再掲しない）。上記はすべてサブに委譲し、メインは phase 判定・command 選択・委譲・結果確認のみ行う。

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

- **守るルール**: CORE / LOAD_POLICY / PHASES / RULES / IO_CONTRACT。該当 command ファイルに記載された**順序**を守ること。**SKILL_MANDATORY.md で Optional と定義された capability を除き**、順序変更・飛ばしを禁止する。All output must conform to .agent-skill-chain/source/IO_CONTRACT.md and .agent-skill-chain/source/RULES.md
- **.agent-skill-chain/project**: プロジェクトルートの **.agent-skill-chain/project/** が存在する場合は、command 実行**前**に読了・参照すること。
- **規模比例原則（全フェーズへの一般化）**: 成果物の章・セクションのうち、当該変更に**該当しない**ものは、削除ではなく「**非該当（理由 1 行）**」の記載で満たしたものとみなしてよい（該当する場合は通常どおり記入必須）。この原則は 04_review.md テンプレートの §6 パフォーマンス・§7 セキュリティ・§8 デプロイに限らず、他の成果物（00〜04）の非該当セクション全般へ一般化して適用してよい。**#35 branch 紐づけゲートのような安全ゲートは規模比例の対象外**（常に必須）とする。詳細は [runtime/templates/04_review.md](../../../runtime/templates/04_review.md) の規模比例化注記を参照。
- **worker 完了後の品質確認は完了した command により異なる**: **implement-feature 完了後**は、オーケストレータは**必ず** verify-and-close を指示すること（省略して次フェーズへ進めてはならない）。**requirement-discovery・design-feature 完了後**（実装着手前）は、verify-and-close ではなく review-docs（実装前ドキュメントレビュー）を指示すること（**full/standard は必須。quick は免除**。詳細は「実装着手前の review-docs 必須ゲート」を参照）。省略して implement-feature へ進めてはならない。
- **実効環境に関する注記（以下 3 ゲート共通）**: 以下の review-docs 必須ゲート（enforcement #32）・GitHub Issue 起票ゲート（enforcement #34）・branch 紐づけゲート（enforcement #35）の機械検証は、**ローカルで pre-push hook を導入した環境でのみ実効する**。workflow.db は Git 非追跡のため、CI（GitHub Actions 等）単独運用では DB 系チェック（#3、#8〜#25、#29、#31〜#35 を含む）は**常時 SKIP** される。以下の各ゲートで「未通過なら FAIL する」とする記述は、**hook が有効な環境でのみ適用される**ものであり、CI のみの標準構成では機械強制されていない（口頭ルールに近い状態になる）ことを認識すること。
- **実装着手前の review-docs 必須ゲート（絶対強制）**: design-feature（設計・実装計画）完了後・implement-feature 委譲前に、当該 issue について [review-docs](../../commands/review-docs.md) を**必ず委譲**すること（**full/standard は一律必須。quick モード（00_要求定義.md frontmatter `mode: quick`）は本ゲートを免除する**＝軽量化。免除時も RULES.md §実行モードの quick 最小セット（設計メモ＋変更理由）と workflow.db 証跡で追跡し、記録は省略しない。mode 欠落・不明値は standard 扱いで免除しない＝fail-safe）。**quick モードの mode 信号は、00_要求定義.md の本文セクションを省略した「frontmatter のみの最小 00」（`mode`/`branch`/`issue_id` の 3 項目）で成立させてよい**（RULES.md §実行モード quick 行を正本とする。「00 を作らない」ことと「frontmatter だけの最小 00 を作る」ことは異なり、後者で mode 信号の機械可読正本を維持する）。完了の定義は [PHASES.md §レビュー成果物の配置ルール](../../workflow/PHASES.md#レビュー成果物の配置ルール)（memo 作成＋指摘がなくなるまでの修正反復＋書記委譲）に従う。未実行のまま implement-feature を実行すると enforcement #32（[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し）で FAIL する（**quick モードは #32 の対象外＝SKIP**）。
- **実装着手前の GitHub Issue 起票ゲート（デフォルト起票・意図的スキップは理由記録）**: review-docs 完了後・implement-feature 委譲前に、当該 issue（**トップレベルのみ。`90_issues/` 配下のサブ issue は対象外**＝親 Issue に集約する）について GitHub Issue 起票ゲートを実行すること。**デフォルトは起票**であり、ユーザーへ起票するかを確認する。起票する場合、**既存の GitHub Issue があればリンクし新規起票しない。無ければ新規起票する**。決定した番号は 00_要求定義.md frontmatter の `github_issue` へ記録する。**issue 化する必要がないとユーザーが判断した場合は起票せず、その決定と理由を `github_issue` へ `"declined: <理由>"` 形式で記録する**（免除ではなく代替記録＝記録なし・理由なしのスキップは不可。理由なしの declined は enforcement #34 で弾かれる）。**quick モード（`mode: quick`）は本 GitHub Issue 起票ゲート自体を免除する**（GitHub Issue を起票せず、変更理由・workflow.db 証跡で追跡する。full/standard は現行どおり起票 or declined 記録が必須。mode 欠落・不明値は standard 扱いで免除しない＝fail-safe）。**GitHub 非採用・到達不能な対象外環境ではゲートは発火しない**（フォールバック。ロックアウトしない）。**GitHub は使うが Issue 運用自体を採用しないプロジェクトでは、env `GITHUB_ISSUE_GATE_ENABLED=false` によりゲート自体をプロジェクト全体で無効化できる**（既定 `true`。既存の enforcement 全体の opt-in である `enforce on/off` とは独立した、本ゲート単体のトグル）。具体手順（起票確認の分岐・`gh` コマンド・title/body・frontmatter 形式・declined 記録形式・PR トレーラ・対象外環境の判定・無効化トグルの運用）は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../project/自己拡張ワークフロー.md) を参照。ゲート未通過（実 Issue 記録も理由付き declined も無い状態）のまま implement-feature を実行すると enforcement #34（[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し）で FAIL する（**quick モードは #34 の対象外＝SKIP**）。
- **実装着手前のブランチ紐づけゲート（規模・モードに関係なく維持）**: implement-feature 委譲前に、当該 issue の実装作業に用いる **feature ブランチ名を 00_要求定義.md frontmatter の `branch` へ記録**すること（空/null/未記載は不可・**全 issue 一律。quick モードでも免除されず必須**）。ブランチは GitHub 非採用環境でも成立するため本ゲートは git ツリーであれば発火する（GitHub remote は不要）。**プロジェクト全体で無効化する場合は env `BRANCH_LINK_GATE_ENABLED=false`**（既定 `true`）。具体手順（いつ・どの値を書くか）は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../project/自己拡張ワークフロー.md) を参照。未記録のまま implement-feature を実行すると enforcement #35（[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し）で FAIL する（**#35 は mode を参照しない＝quick モードでも発火**）。
- **PR 化時の PR 紐づけゲート**: 実装を PR にする際は、**PR 本文へ対応 GitHub Issue の `Closes #<番号>` または `Refs #<番号>` を含める**こと（`github_issue` が `declined:` の issue は対象外）。この検証は PR 本文がローカルに存在しないため **CI（PR イベント）でのみ実行され、ローカル・push では非発火**する（挙動差は仕様）。**プロジェクト全体で無効化する場合は env `PR_LINK_GATE_ENABLED=false`**（既定 `true`）。具体手順（PR 本文の記載例・1PR=1issue 原則・本リポ CI への `PR_BODY` 配線の申し送り）は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../project/自己拡張ワークフロー.md) を参照。紐づけが無い PR は enforcement #36（[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し）で FAIL する。
- **上記 3 ゲート（GitHub Issue 起票ゲート・ブランチ紐づけゲート・PR 紐づけゲート）の project 未整備時フォールバック**: 上記の具体手順が参照する `.agent-skill-chain/project/自己拡張ワークフロー.md` は本リポ（自己拡張元）向けの具体化ファイルであり、消費者環境の `.agent-skill-chain/project/` に同名の具体化ファイルが存在するとは限らない。**該当ファイルが存在しない場合、その参照は適用せず**、各ゲート本文（上記 3 項目）に記載された抽象要件（記録先の frontmatter・記録する値・declined 等の代替記録・無効化トグル）のみに従う。project 側の具体化が無いことは、ゲート自体（記録の必須化）の免除理由にはならない。
- **Issue 追跡モード（`ISSUE_TRACKING_MODE`・二重モード抽象原則）**: issue 運用は env `ISSUE_TRACKING_MODE` により `github_native`（GitHub Issue を正とする）／`local_tracked`（ローカル issue ドキュメントを正とし、完了時に close へ移動する。**既定値**）の二値モードを持つ。`ISSUE_TRACKING_MODE=github_native` を明示設定し、かつ `git remote` が `github.com` を含む場合にのみ実効モードが `github_native` になる。**非 GitHub 環境・未設定・不明値はすべて `local_tracked` へフォールバック**し、ロックアウトしない。**close 移動（`close/` への移動）は整理整頓目的（アクティブ／完了の分離）であり両モードで行う**。モード差は移動を確定させる手段（人間関与点）にあり、`local_tracked` は PR マージ、`github_native` は GitHub Issue 自体の close をトリガー兼確定点とする（詳細は [CORE.md](../../boot/CORE.md) §完了 issue の close 分離、[PHASES.md](../../workflow/PHASES.md) §完了 issue の close 移動）。`ISSUE_TRACKING_MODE` は他の enforcement ゲート無効化 env と同様に**AI エージェントによる自律的な設定・変更を禁止**する（[AGENT_CONDUCT.md](../../AGENT_CONDUCT.md) §enforcement ゲートの自己無効化禁止 参照）。本リポ固有の実効モード固定・具体的な起票本文テンプレート等の**具体手順**は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../project/自己拡張ワークフロー.md) へ委譲する（本項は抽象原則のみを記載し、二重記載しない）。
- **外部書き込み操作の実行主体（進行役限定）**: 外部サービス・公開リモートの状態を変える**外部書き込み操作**は、その操作を承認したユーザーの直接発言を**自身の会話に持つエージェント（＝進行役）が実行する**。伝聞承認（他エージェント経由で「ユーザーが承認した」と伝えられただけの承認）のみを持つエージェントは実行してはならない（＝承認の直接性を実行主体に持たせる原則）。**本 carve-out は enforcement 側の限定 allowlist（`gh pr create`／`gh issue create`／`git push` の厳密パターンのみを PreToolUse で許可する実装）を前提とする（正本は [boot/CORE.md](../../boot/CORE.md) §外部書き込みコマンド実行の限定例外）。allowlist 未整備でロックアウトした場合、進行役は `enforce off` 等の緩和を自ら採らずユーザーへエスカレーションする。**
  - **「進行役」の定義**: 役割名ではなく「その操作を承認したユーザー発言を自身の会話に持つエージェント」。並行セッション環境では会話ごとに別個の進行役が成立する（どのエージェントが実行主体たりうるかを会話ベースで一意に判定する）。
  - **二段構え（ローカル / 外部公開）**: ローカル `git commit`（push しない限り外部状態を変えない）は**サブが実行してよい**。`git push`（公開リモート）/ `gh pr create` / `gh issue create` 以降の**外部公開を伴う操作から進行役が実行する**（本ルールが緩和するのは「伝聞承認による無自覚な外部公開」であり、外部公開を伴わないローカル commit はこのリスクを持たないため対象外とする）。
  - **対象（進行役が実行）**: `gh issue create` / `gh pr create` / `git push`（公開リモート・`--force` 含む＝履歴改変を伴い §高リスク操作にも該当）、およびリポジトリ可視性変更（`gh repo edit --visibility`。とくに private→public 化は「無自覚な外部公開」の最たる例）・リポジトリ作成（`gh repo create`）・リリース公開（`gh release create`）・`gh gist create` 等、外部公開・外部状態変更の影響が大きい操作。**列挙は網羅ではなく代表例であり、抽象定義「外部状態を変え外部公開を伴う操作か」を第一基準とする**（列挙に無い新規コマンドも抽象定義に合致すれば対象）。
  - **対象外（サブが実行してよい）**: 読み取り専用の参照系（`gh api` の GET 参照 / `gh issue view` / `gh pr view` / `git fetch`）、ローカル `git commit`（push しない限り）。
  - **既承認済み操作の但し書き**: `gh pr merge --admin`・マージ済み PR のリモートブランチ削除（`git push origin --delete`）はリポジトリ単位のスタンディング承認により**都度の直接承認を要さず原則サブが実行してよい**。ただしスタンディング承認はメモリ上の事実でありランタイム分類器はそれを参照しないため、サブの実行が分類器にブロックされる場合がある。そのときサブは緩和（分類器バイパス・権限緩和）を採らず**進行役へエスカレーションし進行役が実行する**（＝既承認済み＝原則サブ可、分類器ブロック時は進行役実行）。RULES §高リスク操作の事前確認はこれらにも独立に適用される。
  - **例外の限定と準備分担**: 本例外は**副作用アクション（外部書き込みコマンドの Bash 実行）のみ**に限る。body・コマンド文面・対象確定などの content authorship（成果物の作成・編集）は**従来どおりサブが準備**し、進行役は**最終確認＋実行のみ**を担う。進行役の「最終確認」は実行可否判断（対象・承認・副作用・対象検証）であって body 本文の推敲・編集ではない（後者はサブの責務のまま）。分離を明確にするため、issue/PR body 等はサブがファイル化し進行役は `--body-file` 等で参照実行することを推奨し、進行役が body 文面を書き換える運用は採らない（「commit のついでに直接ファイルを編集する」滑り坂を正本上で否定する）。
  - **実行前の対象検証（必須）**: 外部書き込みを実行する前に、対象リポジトリ・ブランチ・worktree・issue 番号を検証すること（進行役は複数 issue を並行統括するため取り違え被害が集中しうる）。worktree 分離下では、サブの成果物（commit）はサブの worktree・ブランチに存在するため、進行役は push 実行時に当該 worktree・ブランチを対象として検証・実行する。
  - **原則ベース記述（分類器非依存）**: 本ルールは Auto Mode Bypass 分類器の内部仕様（非公開・変更されうる）への適合としてではなく「承認の直接性を実行主体に持たせる」原則として記述する。分類器バイパス・Bash 権限緩和など緩和策は一切採用しない[^ext-write-classifier]。
  - **実行専用フェーズは新設しない**: 外部書き込み実行は成果物を生む「フェーズ」ではなく、既存の特定ゲート点（GitHub Issue 起票ゲート・PR 作成・close 移動 PR 等）で発生する punctual な副作用である。したがって新規 command / phase / テンプレートは設けず、本項（既存フロー）に組み込む。
  - **既存規定との関係**: 本項は §Execution Path Rule（メイン直接編集の絶対禁止）・§Forbidden「高リスク操作の事前確認省略」（外部サービスへの書き込みの事前確認必須）と**矛盾ではなく限定された例外・整合関係**である（例外は Bash 実行アクションのみで content authorship の委譲原則を弱めない）。§Forbidden「サブによる独断起票」とは**補完・直交関係**（本項は gh 等コマンドの実行主体、独断起票は起票の意思決定であり別軸）である。具体手順（起票・PR・close 移動での実行主体注記）は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../../project/自己拡張ワークフロー.md) を参照。

  [^ext-write-classifier]: 根拠事例（Why）: 2026-07-15、伝聞承認のみを持つサブエージェントが `gh issue create` を実行しようとした際、Claude Code の Auto Mode Bypass 分類器（ランタイムの既存機械強制層）にブロックされた。ユーザーの直接承認発言は進行役自身の会話にのみ存在したため、進行役自身が実行すると成功した。本ルールはこの既存ランタイム制御と運用・ドキュメントを整合させる位置づけであり、欠落した機械強制を紙で代替するものではない。機械強制の要否（audit.sh / hook）は会話状態を静的監査から参照できないため本 issue のスコープ外とし、将来判断へ申し送る。
- **書記（write-workflow-log）の実行主体（chain 実行者自身）**: 書記（write-workflow-log）は、command の chain 内の 1 step であり、**その chain を実行している当のサブエージェント自身が実行する**（別エージェントへの再委譲ではない）。各サブエージェントは、command の成果を記録するため、**必ず**書記（write-workflow-log）を**自ら実行**すること。省略してはならない。他 command・skill 文書中の「書記に依頼」という表現は、すべて本項の「chain 実行者自身が write-workflow-log を実行する」の意味であり、独立した書記エージェントへの委譲を意味しない。
- **verify-and-close を委譲する場合**: command の skill chain を**最後まで**実行すること。step 5（write-workflow-log）を**省略しない**こと。workflow.db を採用している場合は write-workflow-log.sh を**必ず**実行すること。
- **create-pr-review-issue を委譲する場合（アクター境界を跨ぐ carve-out）**: 本 command はアクター境界を跨ぐ（ステップ1: サブ／ステップ2: 進行役／ステップ3〜5: 承認後に再委譲したサブ）ため、「chain を最後まで実行する」という一般原則の適用は**担当ステップまで**に限る。**サブはステップ1（トリアージ表生成）を実行してトリアージ表を進行役へ返却した時点で一旦終了**し、ステップ2（進行役の一括承認）を自己完結して先へ進めない。**進行役が承認した後、改めてステップ3〜5（対応実施・監査・書記 write-workflow-log を含む）をサブへ再委譲**し、再委譲されたサブがそこから最後まで（監査を経て指摘がなくなるまで修正反復し、書記を省略しない）実行する。
- **実装前フェーズ完了時の品質確認は review-docs に一本化（verify-and-close ではない）**: 要求・要件・設計・実装計画の**各フェーズ完了時**の品質確認は、verify-and-close ではなく [review-docs](../../commands/review-docs.md) に一本化する（memo 証跡＋指摘収束＋write-workflow-log。04_review.md は作らない）。**verify-and-close は実装完了後にのみ委譲する**（次項「レビュー成果物」参照）。「各フェーズ完了時に verify-and-close を委譲する」という運用は行わない（04_review を実装前に作ると audit #29 で FAIL するため）。write-workflow-log の実行を省略しないことは review-docs・verify-and-close のいずれでも共通の要件である。
- **レビュー成果物（絶対強制）**: **レビューフェーズ**（実装完了後に verify-and-close を委譲するとき）で作成するレビュー成果物は、**必ず issue 直下に 04_review.md を直接作成**すること。**verify-and-close を実行したら 04_review.md を作成しないで完了とみなしてはならない。** 04 を省略することは禁止。memo にレビューを書いて 04 を作成しないことは**禁止**（enforcement 失敗条件 #3）。**04_review は実装前に作成してはならない。** ドキュメントレビュー等の証跡は memo に記録してよい（推奨）。**04_review に相当する正式なレビュー成果物は memo に書かない**。
  - **レビュー作成依頼は verify-and-close を委譲すること**: ユーザーが「レビューを作成して」「04_review を書いて」「この issue のレビューをして」等と依頼した場合、**必ず command として verify-and-close を委譲**し、commands/verify-and-close.md に定義された skill chain を**最後まで**（step 5 write-workflow-log を含む）実行させること。04_review.md の作成だけを Task の成果物として委譲し、書記（write-workflow-log）の実行を含めない運用は**禁止**とする。verify-and-close 委譲の完了条件には、「issue 直下に 04_review.md が存在すること」に加え、「workflow.db への verify-and-close 証跡の記録（write-workflow-log の実行）」を**必須**とする。
- **実装前のドキュメントレビュー**: ユーザーから「ドキュメントレビュー」「00/01/02/03 のレビュー」を依頼された場合、**実装（implement-feature の成果物）がまだ完了していなければ**、verify-and-close を委譲して 04_review を作成してはならない。**ドキュメントレビューはレビューと修正を一組とし、指摘がなくなるまで繰り返すこと。** 各回のレビュー証跡（指摘一覧・実施した修正）は **.agent-skill-chain/runtime/{issue}/memo/** に YYYYMMDD_HHMMSS_ プレフィックスの memo として記録させること（PHASES §レビュー成果物の配置ルール）。**完了後は必ず書記（write-workflow-log）に依頼**して証跡を記録させること。実装完了後にのみ verify-and-close を委譲し 04_review を成果物に含める。
  - **完了判定（必須・相互参照）**: ドキュメントレビューを「完了」とみなす条件の定義は [PHASES.md §レビュー成果物の配置ルール](../../workflow/PHASES.md#レビュー成果物の配置ルール) を**正本**とする。本ファイルには再記述せず、当該リンク先に従うこと（書記委譲を省略した報告終了は禁止＝enforcement §失敗条件 #23）。
  - **実装前は memo・04 は実装完了後の verify-and-close のみ（相互参照）**: 実装前は memo に証跡を残し、04_review.md は**実装完了後の verify-and-close のみ**で作成する。誤って実装前に 04 を作ると audit #29（実装前 04 検知）で FAIL する（本体定義は PHASES §レビュー成果物の配置ルール・[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し #29 を参照。本項は相互参照であり再定義しない）。
- **04_review 作成・更新時**: 実装成果物にテストが含まれる場合は、verify-and-close の実行時に**テストを再実行**し、結果を 04_review に記載すること。テスト未実行のまま監査完了とみなしてはならない。
- **memo 作成時**: **.agent-skill-chain/runtime/{issue}/memo/** に作成すること。ファイル名に **YYYYMMDD_HHMMSS_**（日本標準時）をプレフィックスとして付与すること。プレフィックスは **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agent-skill-chain/source/scripts/memo-prefix.sh の実行**で得た値に限定する。取得は memo ファイル作成のたびに実行すること（キャッシュ・事前計算に依存しない）。**推測・固定・未来日時の使用は禁止**する（手入力・AI の推測・ハードコード・未来日時を使わない）。**memo ファイルを実際に作成する直前に**、必ず **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S を実行する**か **.agent-skill-chain/source/scripts/memo-prefix.sh を実行し**、その**標準出力**をプレフィックスとして使用すること。**コマンドを実行せずにファイル名を組み立ててはならない。** ユーザー依頼・コンテキストの日付・現在時刻の推測からプレフィックスを決めてはならない。
- **issue フォルダ作成時**: **.agent-skill-chain/runtime/** に issue 用ディレクトリを作成するとき、ディレクトリ名のプレフィックスは **YYYYMMDD_HHMMSS_**（日本標準時）とする。プレフィックスは **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S の実行、または .agent-skill-chain/source/scripts/memo-prefix.sh の実行**で得た値に限定する。取得は issue フォルダ作成のたびに実行すること（キャッシュ・事前計算に依存しない）。**推測・固定・未来日時の使用は禁止**する（手入力・AI の推測・ハードコード・未来日時を使わない）。**issue フォルダを実際に作成する直前に**、必ず **TZ=Asia/Tokyo date +%Y%m%d_%H%M%S を実行する**か **.agent-skill-chain/source/scripts/memo-prefix.sh を実行し**、その**標準出力**をプレフィックスに使用すること。**実行せずにフォルダ名を組み立ててはならない。**
- **サブissue作成時（作成主体・作成手段）**: 各 command（design-feature・implement-feature・verify-and-close 等）の DoD が「サブissueを 1 件以上作成した場合は 90_issues.md 必須」と定める場合、その作成は次の手順で行う。**サブは派生課題を発見しても独断で起票しない**（§Forbidden「サブによる独断起票」）。発見事項は完了報告で進行役へ提案し、**進行役が起票を承認した後**、進行役は issue 作成 command（一般には requirement-discovery。詳細は PHASE_COMMAND_MAP.md §横断的必須ゲート・issue_creation 行を参照）へ**再委譲**する。再委譲されたサブが当該サブ issue のディレクトリ・00_要求定義.md を作成し、**当該サブ自身が親ワークフロー（.agent-skill-chain/runtime/{親issue}/）のルートに 90_issues.md を更新すること**。未作成のまま当該フローを完了とみなさない。
- **.agent-skill-chain/runtime/ 配下への書き込み手段（保護対象と issue ドキュメントで区別する）**: `.agent-skill-chain/runtime/` 配下は、対象によって使用できるツールが異なる。
  - **memo（`.agent-skill-chain/runtime/{issue}/memo/*.md`）・`workflow.db`（`workflow.db-wal`/`workflow.db-shm` 含む）**: タイムスタンプ整合性・DB 書込整合性の保護対象であり、Bash ツール（heredoc・new-workflow-memo.sh・write-workflow-log.sh 等）で作成すること。Edit/Write ツールはこれらの対象では使用できない（enforcement PreToolUse R1 が全ロール一律で拒否する）。
  - **issue ドキュメント（`00_要求定義.md`・`00_システム理解.md`・`01_要件定義.md`・`02_設計.md`・`03_実装計画.md`・`04_review.md`・`05_最終確認チェックリスト.md`・`90_issues.md`・`99_PR.md`・`99_PR_review.md`）**: これらは R1 の保護対象外であり、**Edit/Write ツールを通常どおり使用してよい**（Bash heredoc は不要）。R1 は basename 厳密一致で allowlist 判定するため、`.gitignore` 厳密一致例外（唯一の従来例外）と同様に、正規のファイル名であれば Edit/Write が許可される。
  - 詳細（allowlist の正本・判定順序・実装制約）は [enforcement/README.md](../../enforcement/README.md)・[enforcement/DESIGN.md](../../enforcement/DESIGN.md) を参照。
- **禁止**: command ファイルを読まずに skill だけ実行しないこと。**SKILL_MANDATORY.md で Optional と定義された capability を除き**、chain の順序を変えたり飛ばしたりしないこと。
- **成果物が 00/01/02/03/04 のいずれかである場合**: 成果物が 00_要求定義.md / 01_要件定義.md / 02_設計.md / 03_実装計画.md / 04_review.md のいずれかである command を実行する場合、**該当するテンプレートファイル**（workflow/TEMPLATES.md の表に従う。プロジェクトの .agent-skill-chain/runtime/templates に無い場合はパッケージの `.agent-skill-chain/runtime/templates/` の同ファイル）を**必ず開き**、その**見出し・セクション構成・必須項目を欠かさず**に成果物を執筆すること。**00_要求定義の場合は、テンプレートの全セクション（「要求定義の全体像」およびその中の Mermaid マインドマップを含む）を欠かさないこと。** テンプレートを省略した形で 00 を作成することは禁止する。
- **委譲時のティア明記**: サブ委譲時は [MODEL_SELECTION.md](../../MODEL_SELECTION.md) に従い、選定したモデルティアを委譲パケットに明示する（Claude ランタイム等のティア選択可能環境でのみ。対象外環境はデフォルトに従い本項は適用しない）。**書記（write-workflow-log）への配線**: 委譲完了後に書記へ記録を依頼する際は、委譲パケットに明記した選定ティア・根拠 1 行（＋ fable を使った場合は例外申告）を、`write-workflow-log.sh` の env **`MODEL_TIER`**（選定ティア）・**`TIER_RATIONALE`**（[MODEL_TIER_TABLE.md](../../../project/MODEL_TIER_TABLE.md) 該当行の引用 1 行）・**`TIER_EXCEPTION`**（fable 時のみ・ユーザー最重要指定の記録）として引き継ぐこと。省略すると `audit.sh` の記録有無検査（[enforcement/README.md](../../enforcement/README.md) §失敗条件と差し戻し）で FAIL する。
- **委譲時の effort 明記**: サブ委譲時は [EFFORT_POLICY.md](../../EFFORT_POLICY.md) に従い、選定した reasoning effort を委譲パケットに明示する（effort 解決可能なランタイムでのみ。対象外環境はデフォルトに従い本項は適用しない）。品質ゲート相当役割（監査・verify-and-close 等）は effort を非劣化（切り下げ禁止）とする。
- **委譲タスク内の長時間コマンドはフォアグラウンド実行（`run_in_background` 抑止）**: 委譲を受けたサブエージェントは、委譲タスク内で**`run_in_background: true` を使って長時間コマンドを起動し、完了を待たずに応答を終了することを禁止する**。委譲タスク内で完了までに時間のかかるコマンド（テスト全件実行・ビルド等）を実行する場合は、原則フォアグラウンドで実行して完了を待つこと。**対象範囲**: フォアグラウンドで待つのは**完了が見込める非対話型コマンド**（有限時間で終了し入力を要さないもの）に限る。`watch` 系・サーバー起動・対話入力待ちなど**無期限に走り続けるコマンドや対話を要するコマンドは対象外**であり、その場合は明示的なタイムアウトを設けて到達時にキャンセルするか、バックグラウンド実行等の代替手段を検討する。判断の分かれ目は実行時間の長短ではなく「`run_in_background` を使う可能性があるか」に置く。**フォールバック**: 入れ子委譲でバックグラウンドタスクの完了通知を応答終了後のサブエージェントが受け取れないという前提が成立しないランタイムでは、本項は自然に無害化される（ロックアウトしない）。**理由・観測事例の詳細**は [BACKGROUND_EXEC_RATIONALE.md](BACKGROUND_EXEC_RATIONALE.md) を参照。本項は既存の各ゲート・書記依頼の強制とは非交差の独立項目であり、既存項目を置換・弱化しない。
- **委譲時の行動規範参照**: サブ委譲時は、委譲パケットの Constraints 末尾へ [AGENT_CONDUCT.md 第 3 部 サブエージェント向け凝縮版](../../AGENT_CONDUCT.md#第-3-部-サブエージェント向け凝縮版委譲時に-constraints-末尾へ転記または参照する)への参照リンクのみ記載すれば足り、**全文の逐語転記は不要**とする（リンク先を読めないランタイムのみ従来どおり全文転記）。矛盾時は規約側が優先される（AGENT_CONDUCT.md §0 読み替え規則）。
- **自立進行ルール**: 通常の作業依頼（issue 作成・要件定義・設計・実装計画・実装・レビュー等）では、メインエージェントはユーザーからの個別許可確認を前提とせず、AGENTS.md §自立進行ルールに従って自律的に本 run_command を呼び出し command を起動してよい。

### Forbidden / 注意事項

- **通常の作業依頼に対する過度な許可確認の強制**: 高リスク操作に該当しない限り、issue 作成・要件定義・設計・実装計画・実装・レビュー等の通常の作業依頼に対して、本 run_command を呼ぶ前に毎回「サブを起動してよいか」「この command を実行してよいか」「この方針で進めてよいか」等をユーザーに確認する運用は行わない（パッケージルートの `AGENTS.md` §自立進行ルール と整合させる）。
- **実作業 command を実行しない指示文案のみの返却**: ユーザーから「プロンプト案だけ教えて」「手順だけ教えて」など説明モードへの切り替えが明示されていない通常の作業依頼に対して、本 skill を「サブへの指示文案だけを返して実作業 command を実行しない」用途で使ってはならない（自立進行ルール違反）。
- **高リスク操作の事前確認省略**: RULES / CORE / enforcement で定義された高リスク操作（大量削除・外部サービスへの書き込み等）に該当する command・capability を本 run_command から起動する場合は例外とし、そのときのみ事前にユーザーの明示的な確認を必須とする。
- **サブによる独断起票**: サブエージェント（本 run_command で委譲されたワーカー）は、作業中に発見した派生課題・フォローアップについて issue/サブ issue を自ら起票（ディレクトリ・`00_要求定義.md` 等の新規作成）してはならない。発見事項は完了報告でメインへ提案するに留め、起票の可否判断・実行はメインの承認を経てから行う。詳細は [CLOSEOUT.md §取りこぼし0と既出確認（no-drop / dedup）](../../CLOSEOUT.md#取りこぼし0と既出確認no-drop--dedup) を参照（本項は参照のみ・再定義しない）。

### OutputSpec

- **完了条件**: その command の DoD を満たしていること。
- **証跡**: 実施内容・変更ファイルを記録すること。本則は workflow.db。memo は workflow.db を採用しない場合の過渡的・例外運用のみ（scribe/CONTRACT 参照）。

---

## command の実行のしかた（共通ルールのみ）

1. 指定された **commands/{name}.md** を開き、**Skill chain** の順序を確認する。
2. 記載された **skills/{domain}/{capability}/** を**順に**読み、各 capability の **SKILL.md（手順・制約・成果物の正本）** に従って実行する（README.md は索引でありSKILL.md への参照に留まる）。前の capability の OUT を次の IN に渡す。
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
