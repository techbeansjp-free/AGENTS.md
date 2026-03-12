# run_command — command 実行の共通 I/F

**委譲の実行手段（Cursor 上で何を呼ぶか）は本ファイル 1 か所で規定する。** メインは本 run_command に従ってサブエージェントへ委譲する。他に委譲の呼び方を定義するファイルは設けない。

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

- **守るルール**: CORE / LOAD_POLICY / PHASES。該当 command ファイルに記載された**順序**を守ること。飛ばさない。
- **memo 作成時**: **.workflow/{issue}/memo/** に作成すること。ファイル名に **YYYYMMDD_HHMMSS_**（日本標準時、実行環境の現在時刻を取得）をプレフィックスとして付与すること。
- **禁止**: command ファイルを読まずに skill だけ実行しないこと。chain の順序を変えたり飛ばしたりしないこと。

### OutputSpec

- **完了条件**: その command の DoD を満たしていること。
- **証跡**: 実施内容・変更ファイルを記録すること。本則は workflow.db。memo は workflow.db を採用しない場合の過渡的・例外運用のみ（scribe/CONTRACT 参照）。

---

## command の実行のしかた（共通ルールのみ）

1. 指定された **commands/{name}.md** を開き、**Skill chain** の順序を確認する。
2. 記載された **skills/{domain}/{capability}/** を**順に**読み、各 capability の README.md または SKILL.md の手順・制約・成果物に従って実行する。前の capability の OUT を次の IN に渡す。
3. command ファイル末尾の **DoD** を満たしたら完了。証跡を残す（本則 workflow.db。memo 運用時は YYYYMMDD_HHMMSS_ プレフィックス必須）。

※ 各 step の具体的な手順・入出力の受け渡し・実行時の注意は **commands/{name}.md** と **各 capability の README/SKILL** に記載する。本ファイルでは「command を起動するときの共通 I/F」と「順に読んで実行する」ことだけを定める。

---

## 参照

- LOAD_POLICY（トリガー「command を実行するとき」）
- 各 commands/{name}.md（**skill chain の定義のみ**。手順の詳細は各 skill へ委譲）
- CORE（読了義務・証跡省略禁止）
