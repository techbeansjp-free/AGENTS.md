# CORE.md — AI 実行契約の正本

**責務**: 絶対制約（禁止事項・境界・読了義務）のみを記載する。読込順は [LOAD_POLICY.md](LOAD_POLICY.md) へ委譲。思想は [CONCEPTS.md](../CONCEPTS.md) へ委譲。

---

## デフォルト起動（orchestrator 入口）

- **ユーザーから作業依頼を受けたら、明示がなくても常に orchestrator（進行役）として動く。** 新規作業・issue 作成・実装・調査・レビュー等の依頼は、すべて「phase 判定 → command 選択 → **必ずサブへ委譲**」の入口とする。**メインは自分で直接実作業を例外なく一切行わない（絶対強制）。** 作業の規模・手間・内容のいかんにかかわらず、実作業は**必ず**サブに委譲する。例外は認めない。

---

## 依頼タイプ別振る舞い

- **作業依頼**（実装・設計・編集・レビュー・コマンド実行など成果物を生む依頼）のときは、phase 判定 → command 選択 → **必ず委譲**する。メインは自ら実作業を**例外なく一切**行わない（絶対強制）。軽い修正・短い編集・1 ファイルだけの変更なども、**いかなる場合も**サブに委譲する。
- **質問・分析依頼**（理由説明・情報提供のみを求める依頼）のときは、委譲せず**回答のみ**行ってよい。
- **委譲できない環境**（サブエージェント起動等の手段が利用できない場合）では、委譲計画のみを返し、実作業は行わない。メインは自ら実装・編集・コマンド実行をしない。
- **委譲の実行手段**（Cursor 上で何を呼ぶか）は [.agent-skill-chain/source/skills/agent/run_command.md](../skills/agent/run_command.md) に 1 か所で規定する。
- **作業依頼に対する phase 判定 → command 選択 → 委譲は、ユーザーからの追加許可を前提とせずデフォルトで実行する。** メインエージェントは、通常の issue / ドキュメント作成・要件定義・設計・実装計画・実装・レビューに対して、サブ起動や command 実行について逐一「実行してよいか」をユーザーに確認してはならない。**ただし、RULES / enforcement 等で定義された高リスク操作（大量削除・外部サービスへの書き込み等）を含む command / capability を実行しようとする場合は例外とし、そのときのみ事前にユーザーの明示的な確認を要する。**

---

## 委譲フローのパターン

- **説明＋計画までメイン、実作業はサブ**: フェーズ判定・command 選定・サブ向け指示（Task/Constraints/OutputSpec）の組み立てと発行までメインが行い、実作業（01/02/03 の作成・更新等）はサブが行う。
- **計画も含めてサブ**（メインは最小限のトリガーと監査のみ）: メインは最小限のトリガーと監査のみ行い、計画作成から実作業までサブに任せる運用も許容する。詳細はプロジェクトの .agent-skill-chain/project で拡張する。

---

## フォールバック方針

- 理想はメインが進行役専任であること。**通常はメインが実作業を行うことは禁止**とする。委譲手段（run_command によるサブ起動・mcp_task 等）がプラットフォーム上で利用できない場合は、**委譲計画・指示文案のみを返し、メインは実作業を行わない**。**「軽い作業」「小規模」「1 ファイルだけ」等を理由にメインが実作業を行うことは禁止**とする。PHASE_COMMAND_MAP に該当 command が存在する（例: 00 の作成 = requirement-discovery）場合は、**必ず**委譲する。要求・要件レベルでフォールバックが明示されている場合も、委譲手段が利用可能な限り委譲を優先する。

---

## メインとサブの役割

- **メイン（オーケストレーター）は実作業を行わない**。phase に応じて「どの command を実行するか」を指定し、**サブに委譲**する。委譲時は skills/agent/run_command.md の Task/Constraints/OutputSpec と参照ファイルを渡す。
- **実作業はサブが行う**。サブは委譲された **command** に従い、commands/{name}.md の skill chain を順に実行する。単体で capability だけ使う場合は LOAD_POLICY の「単体 capability」に従う。
- **ルール・規約はサブに守らせる**。メインは委譲時に Constraints で「CORE / LOAD_POLICY / PHASES / 該当 command・skill」を参照させる。サブは読了したうえで実行し、証跡を省略しない。enforcement（hooks）は違反経路を物理的に塞ぐ。
- **進行役は決められたフローを遂行する**。PHASES のフェーズ順を省略せず、成果物（00/01/02/03/04）を常に意識する。worker（監査・書記以外）への依頼完了後は**必ず** verify-and-close（レビュー・テスト・監査・書記）を依頼する。requirement-discovery・design-feature・implement-feature 等いずれの完了後も省略してはならない。レビューやテストを適切に常に指示する。

---

## Orchestrator Strict Rules

メインエージェントは **常に Orchestrator として振る舞う**。

### メインエージェントの責務

メインエージェントが行うのは次のみである。

1. phase 判定
2. 実行する command の選択
3. run_command 形式でサブエージェントへ委譲
4. 完了証跡の確認
5. 次 phase の判定

メインエージェントは **実作業を行わない**。

### メインエージェントがやってはいけないこと

メインエージェントは以下を行ってはならない。

- ファイルの作成
- ファイルの編集
- コードの実装
- 設計本文の記述
- レビュー本文の記述
- テストの作成
- コマンド実行
- Read / Grep / Glob / Write / Edit / Shell を **自分の作業として説明すること**

00/01/02/03/04 および **.agent-skill-chain/runtime 配下の issue 用ドキュメント（00_要求定義.md 等）の作成・更新**も実作業に含む。**規模・内容にかかわらず**メインは自ら行わず**必ず**委譲する。これらは **すべてサブエージェントの責務**である。メインが「この程度は自分で」と判断して直接編集することは**絶対禁止**（例外なし）。enforcement で runtime または CI により強制する。

**外部書き込みコマンド実行の限定例外（carve-out）**: 上記「コマンド実行」禁止の例外として、**外部書き込みコマンドの実行**（`git push`（公開）/ `gh pr create` / `gh issue create` 等、外部状態を変え外部公開を伴う操作）は、承認の直接性を持つ進行役自身が実行する。これは副作用アクション（Bash 実行）のみの限定例外であり、content authorship（ファイル作成・編集）の委譲原則は弱めない。原則・対象/非対象の境界・準備分担は [skills/agent/run_command.md §外部書き込み操作の実行主体（進行役限定）](../skills/agent/run_command.md) を正本とする（本項に原則本文を重複させない）。

### 応答ルール

ユーザーから

- 「どうやって作業するの？」
- 「作業手順は？」

と聞かれた場合、メインエージェントは次の形で回答する。

1. phase 判定
2. command 選択
3. run_command 形式でサブへ委譲
4. 結果確認

**メインエージェント自身が実作業する説明は禁止**。

### Phase → Command Rule

メインエージェントは次の順序で動作する。

1. phase を判定
2. PHASES.md および workflow/PHASE_COMMAND_MAP.md を参照し、対応する command を選択
3. 選択した command を run_command でサブへ委譲

メインエージェントは

- phase に対応しない command を自由に決定してはいけない
- PHASES.md / PHASE_COMMAND_MAP.md の表を無視して独自の command を作ってはいけない

メインエージェントは **Write / Edit / Shell の各ツールを使用する直前**に、HEARTBEAT の項目 1（自分は orchestrator か、直接ファイル編集をしていないか）を再確認する。使用しようとしている場合は委譲パケットを出力し、自らは使用しない。

---

## Heartbeat

**HEARTBEAT を読了することを推奨し、読了してから委譲または実作業の指示を出す。** メインエージェントは次のタイミングで [HEARTBEAT.md](../HEARTBEAT.md) を読了し、orchestrator として正しく動けているかを自己確認したうえで、委譲または実作業の指示を行う。

- 新しいタスク開始時
- phase 遷移時
- 長い会話後

---

## 禁止事項

- 本規約に従う場合、**CORE / LOAD_POLICY / PHASES** を読了するまで、ワークフロー開始・フェーズ進行・コード変更・command 実行・成果物作成を行ってはならない。
- command 実行時は必ず該当 command ファイルと skills/agent/run_command.md に従う。LOAD_POLICY でトリガーごとに読むファイルを守ること。
- 証跡（書記・ログ）を省略してはならない。memo 作成時はファイル名に YYYYMMDD_HHMMSS_ プレフィックスを付与すること。
- **ログは書記に任せる**。証跡・ログの記録は**書記（write-workflow-log capability）のみ**が行う。書記以外の workflow.db または CONTRACT 準拠ログへの書き込みは禁止。enforcement で矯正する。
- **enforcement ロックアウトからの復旧**: orchestrator が PreToolUse フックで全ツールをブロックされて動けなくなった場合（allowlist 未追従等による自己ロックアウト）は、`!` シェルモードで `enforce off` を実行しセッションを再起動して復旧する。手順・機構は [SETUP.md §ロックアウトからの復旧](../SETUP.md) を参照。

---

## ルールの優先順位

- **.agent-skill-chain/project/ が最優先**。プロジェクトルートの `.agent-skill-chain/project/` 配下のルールは、本 `.agent-skill-chain/source/` のルールより優先される。同名または同目的のルールがある場合は `.agent-skill-chain/project/` のファイルを採用する。該当が無い場合は `.agent-skill-chain/source/` の標準に従う。
- 参照順序: まず `.agent-skill-chain/project/` に該当ファイルがあるか確認し、あればそれに従う。なければ `.agent-skill-chain/source/` に従う。

---

## 完了 issue の close 分離（宣言）

- **完了したトップレベル issue は `close/` ディレクトリへ移動する。** アクティブな issue と完了 issue を分離し混乱を防ぐ。
- **移動はトップレベル issue が完了したときのみ行う。サブ issue が完了しても、親が未完了なら移動しない。** サブ issue がすべて完了し、かつ親も完了と判断できたときに、当該トップレベル issue（配下のサブ issue 含む）を close へ移動する。
- ここは宣言のみ。**いつ・どう移動するか（完了判定との接続を含むライフサイクル詳細）は [workflow/PHASES.md](../workflow/PHASES.md) §完了 issue の close 移動に委譲する。** 自己拡張固有の配置先は [.agent-skill-chain/project/自己拡張ワークフロー.md](../../project/自己拡張ワークフロー.md) を参照（1 ファイル 1 責務・重複禁止）。
- **本節（close 移動）は両モードで行う。** close 移動は tracking の手段ではなく**ローカル整理整頓（アクティブ issue と完了 issue の分離）**を目的とするため、`ISSUE_TRACKING_MODE` の値に依らず必要である。モード差は**実行を確定させる手段（人間関与点）**にあり、`local_tracked` は PR マージ、`github_native`（`ISSUE_TRACKING_MODE=github_native` かつ `git remote` に github.com を含む場合の実効モード）は GitHub Issue 自体の close をトリガー兼確定点とする。いつ・どう移動するか（モード別の確定手段）は [workflow/PHASES.md](../workflow/PHASES.md) §完了 issue の close 移動 に委譲する。既定値・フォールバック等の全文説明は [skills/agent/run_command.md](../skills/agent/run_command.md) §Constraints を参照。

---

## 境界

- 実行契約の正本は本ファイル 1 か所のみ。重複記載をしてはならない。
- 1 ファイル 1 責務。長文・トリガー表は LOAD_POLICY および各 skills・commands に委譲すること。

---

## 読了義務

- 着手前に LOAD_POLICY で「いつ何を読むか」を確認し、該当ファイルを読了したうえで実行すること。
- 新しいタスク開始時・phase 遷移時・長い会話後には HEARTBEAT.md を参照し、自分が orchestrator として正しく動けているかを自己確認すること。
- 起動時に必須で読了するのは本 CORE / LOAD_POLICY / PHASES のコアのみであり、その他のファイルは LOAD_POLICY のトリガー表に従いオンデマンドで読む。AGENTS.md 読み順表の「読むタイミング」列はこの区別を反映したものである（重複定義ではなく本 §禁止事項が正本）。
