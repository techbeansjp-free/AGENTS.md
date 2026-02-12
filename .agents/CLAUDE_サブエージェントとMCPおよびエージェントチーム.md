# サブエージェント・MCP・エージェントチーム（推奨設定とスコープ方針）

> **AI 向け**: Claude Code / Cursor 利用時の MCP・サブエージェント・エージェントチームの推奨設定とスコープ方針。基本は**グローバルでの設定を MCP とサブエージェント**とする。エージェントチームは**有効化・利用の方法のみ**記載する。

---

## 1. 方針（1 文）

**基本はグローバルでの設定を MCP とサブエージェントとする。** プロジェクト単位でしか設定できないものはプロジェクト設定とし、それでよい旨を本ルールで明文化する。

### 1.1 優先順位（プロジェクト > グローバル）

**プロジェクト直下に AGENTS 関連のファイル・ディレクトリがある場合は、そちらを優先する。**

- **対象**: 現在のプロジェクト（ワークスペース／リポジトリ）のルートに次のいずれかが存在する場合  
  `AGENTS.md` / `CLAUDE.md` / `.agents/` / `.agents-project/`
- **優先ルール**:
  - ルートの `AGENTS.md`・`CLAUDE.md`・`.agents/`・`.agents-project/` を **グローバル設定（`~/.claude/agents/`・`~/.claude/skills/` 等）より優先**して参照する。
  - `.agents-project/` は `.agents/` より優先（AGENTS.md の規約どおり）。
- **適用先**: スキル（agents-follow）、サブエージェント（agents-explore, agents-docs, agents-review, agents-implement）、および「AGENTS に従って」と指示されたときの参照先の決定。
- プロジェクト直下に上記が無い場合のみ、グローバルに配置したサブエージェント・スキル内の「参照先」や AGENTS-spec のコピー先（例: 別リポジトリの AGENTS-spec パス）に従う。

---

## 2. MCP

- **必須**: MCP は利用を必須とする（Context7・GitHub 等のツール接続のため）。
- **グローバル設定（推奨）**:
  - **Claude Code**: ユーザースコープで追加すると全プロジェクトで利用可能（実質グローバル）。保存先は `~/.claude.json`。
  - **追加例**: `claude mcp add --transport http <name> <url> --scope user`
  - **スコープ**: `local`（デフォルト・現在プロジェクトのみ）、`project`（プロジェクトルートの `.mcp.json`）、`user`（全プロジェクト＝**グローバルにしたい場合に使用**）。
- **推奨 MCP**: Context7、GitHub。全プロジェクトで使う場合は `--scope user` で追加する。
- **Cursor 利用時**: MCP は Cursor の設定（ユーザー/ワークスペース）で行う。Claude Code の `--scope user` に相当する「全ワークスペースで有効」は Cursor のドキュメントで要確認。

**参考**: [MCP を使用して Claude Code をツールに接続する](https://code.claude.com/docs/ja/mcp)

---

## 3. サブエージェント

- **推奨**: トークン影響は低い（結果がメインコンテキストに要約される）。Haiku にルーティングしてコスト制御も可能。
- **グローバル相当の配置**:
  - **ユーザー全体** = `~/.claude/agents/` に配置すると、全プロジェクトで利用可能（グローバル相当）。
  - **プロジェクトのみ** = プロジェクトルートの `.claude/agents/`。
- **組み込み**: Explore（Haiku・読み取り専用）、Plan（継承・読み取り専用）、general-purpose（継承・全ツール）。カスタムは YAML frontmatter + Markdown。`model: haiku` でコスト削減可能。
- **Cursor 利用時**: Claude Code の機能のため、Cursor では「参照情報」として扱う（同様の仕組みは Cursor 側で要確認）。

**参考**: [カスタムサブエージェントの作成](https://code.claude.com/docs/ja/sub-agents)

### 3.1 AGENTS 規約用の推奨サブエージェント（例）

AGENTS のワークフロー（00→01→02→03→**4.5 ドキュメント徹底レビュー**→実装→04_review）と .agents の役割に合わせて、次の 4 種をグローバル（`~/.claude/agents/`）に置くことを推奨する。

| 名前 | 用途 | モデル | ツール制限 |
|------|------|--------|------------|
| **agents-explore** | 調査・探索。コード・仕様の検索・読解のみ。要約を返す。編集・実行なし。 | haiku | Read, Grep, Glob, LS |
| **agents-docs** | ドキュメント。.workflow の 00〜04・memo の作成・更新。ドキュメントルール準拠。 | inherit | Read, Write, StrReplace, Grep, Glob, LS |
| **agents-review** | レビュー。レビュールールに沿った指摘洗い出し。04_review やドキュメント徹底レビュー。 | haiku | Read, Grep, Glob, LS |
| **agents-implement** | 実装。03_実装計画に沿った実装・テストファースト。コーディングルール準拠。 | inherit | Read, Write, StrReplace, Grep, Glob, LS, Shell |

- 調査だけしたい → agents-explore（Haiku でコスト抑え）
- 00〜04 や memo を書く・直す → agents-docs
- 指摘を出したい → agents-review
- タスクを実装したい → agents-implement

**重要**: **サブエージェント定義内では AGENTS-spec のファイル（`AGENTS.md`, `.agents/実行ルール.md`, `.agents/ドキュメントルール.md`, `.agents/レビュールール.md` 等）を参照する形にする**。サブエージェント内に AGENTS-spec の詳細をコピーしない。これにより、AGENTS-spec を更新すれば自動的にサブエージェントにも反映される。

**抜かし防止**: サブエージェントが工程を飛ばさないよう、定義に**提出物・証跡のルール**を 1 行で参照させることを推奨する。例: 「各 Phase 終了時に提出物を列挙し根拠を示す。詳細は .agents/サブエージェント抜かし防止.md を参照。」（[サブエージェント抜かし防止.md](./サブエージェント抜かし防止.md) セクション 4 参照）

---

## 4. エージェントチーム（方法のみ）

- **位置づけ**: 実験的機能。**本ルールでは有効化・利用の方法のみ記載し、推奨/非推奨の結論は読者に委ねる。**
- **有効化**:
  - 環境変数: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  - または settings（Claude Code）で有効化。
- **トークン**: 単一セッションより「大幅に多くのトークン」を使用し、アクティブなチームメンバー数でスケーリングする。トークン増を許容できない場合は利用を見合わせる判断が可能。
- **サブエージェントとの違い（一言）**:
  - **結果だけ欲しい並列作業** → サブエージェント（結果が要約されてメインに返る）。
  - **議論・協調が必要な並列作業** → エージェントチーム（複数インスタンスが並列で動く）。
- **制限**: セッションあたり 1 チーム、ネスト不可、in-process では `/resume` でチームメンバー復元不可など。詳細は公式ドキュメントを参照。

**参考**: [Claude Code セッションのチームを調整する](https://code.claude.com/docs/ja/agent-teams)

---

## 5. スキル（Skills）

- **スキル**: Claude の振る舞いを拡張する指示の塊。`SKILL.md`（YAML frontmatter + Markdown）で定義。`/skill-name` で呼び出しまたは description に合うときに自動ロード。
- **スコープ**: 個人 = `~/.claude/skills/` または `~/.cursor/skills/`（全プロジェクト）、プロジェクト = `.claude/skills/` または `.cursor/skills/`。グローバルに使うなら個人に配置。
- **サブエージェント・MCPとの違い**: スキルは「指示・手順の追加」、サブエージェントは「タスク委譲・コンテキスト分離」、MCP は「ツールの追加」。スキル内で `context: fork`, `agent: Explore` と組み合わせると、スキルをサブエージェントで実行できる。
- **AGENTS での利用**: ワークフロー手順・ドキュメントルール・レビュー観点などをスキルにまとめ、プロジェクトまたは個人スキルとして配置することを推奨。**重要**: **スキル内に AGENTS-spec の詳細をコピーせず、AGENTS-spec のファイル（`AGENTS.md`, `.agents/実行ルール.md`, `.agents/レビュールール.md` 等）を参照する形にする**。これにより、AGENTS-spec を更新すれば自動的にスキルにも反映される。
- **推奨スキル（例）**: AGENTS 規約に従う際の参照用として、`~/.claude/skills/agents-follow/SKILL.md`（Claude Code）に 1 本配置することを推奨。`/agents-follow` で呼び出し可能。Cursor の場合は `~/.cursor/skills/agents-follow/SKILL.md` に同様に配置可能。詳細は [Claude をスキルで拡張する](https://code.claude.com/docs/ja/skills) を参照。

---

## 6. 参考 URL

- [カスタムサブエージェントの作成](https://code.claude.com/docs/ja/sub-agents)
- [Claude Code セッションのチームを調整する](https://code.claude.com/docs/ja/agent-teams)
- [MCP を使用して Claude Code をツールに接続する](https://code.claude.com/docs/ja/mcp)
- [Claude をスキルで拡張する](https://code.claude.com/docs/ja/skills)
