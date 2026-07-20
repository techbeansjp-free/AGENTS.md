# DESIGN: agent-skill-chain — launch_worker の権限モード不足解消・ローカルバックエンド issue 本文スキーマ拡張

- Issue: `ISSUE-183`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲・前提・用語

本設計の目的は、`.agent-skill-chain/adapters/claude.sh` の `launch_worker` が本物の `claude` CLI をヘッドレスで起動した際、ワーカーの正規責務範囲（自 branch への `git commit`／`git push`、Draft PR 作成、テスト実行、`report-status`／`lease-*`／`checkpoint` の各スクリプト実行）を人間の追加承認なく完走できるようにし、あわせてローカルバックエンドの状態モデル（`state.yaml`）に Issue の本文（タイトル・要求内容）を保持できるようにすることで、使い捨て issue による `launch_worker` の実機再検証（AC-6/AC-7/AC-8 相当）を成立させることである。

対象は4点。(1) 既定 `WORKER_CMD` の権限付与方式を、無制限な `bypassPermissions` ではなく責務スコープを allowlist で明示する方式へ変更する。(2) `state.schema.yaml` に Issue のタイトル・要求内容フィールドを後方互換で追加する。(3) `issue start`（ローカルバックエンド）がそれらを受け取り `state.yaml` へ永続化し、`segment start` がワーカー起動プロンプトへそれらを供給する。(4) これらの変更を本物の `claude` CLI で実機再検証する具体手順を定める。

前提: 本リポジトリは agent-skill-chain の**正本（配布元）**であると同時に、その規律を自らに適用する**ドッグフーディング消費者**でもある。正本アセットへ消費者固有・一過性の値を混入させない。ワーカーの起動系（`WORKER_CMD`）は環境変数で完全上書き可能であり、この上書き余地は本設計でも維持する（テストのモック境界・CI/sandbox での差し替えに不可欠）。`worker.adapter`/`review.adapter` は先行 Issue #180 で既に `claude` へ切替済み（本 Issue のスコープ外）。

用語（自己完結のため本文で定義する）:
- **launch_worker**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数。lease 取得 → `segment start`（role_contract 取得）→ ワーカー起動 → 完了確認（`report latest` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致）→ lease 解放、の順で1セグメントを機械的に完走させる。起動後の各異常（認証欠如・CLI 不在・起動失敗・timeout・完了偽装）では `report_status blocked`（`human_escalation_requested` 扱い）を書き非0非3で返すフェイルセーフを持つ。
- **WORKER_CMD**: `launch_worker` がワーカーを起動する実行系コマンド文字列。env で完全上書き可。未指定かつ `claude` 検出時の既定が本設計の変更対象。
- **権限モード（permission mode）／`--allowed-tools`**: `claude` CLI がツール実行時の承認をどう扱うかを定める起動時設定。`acceptEdits`（ファイル編集のみ自動承認、Bash 等は都度承認＝ヘッドレスでは事実上停止）／`bypassPermissions`（全ツール無制限自動承認）／`--allowed-tools <list>`（許可するツール名・Bash パターンを明示列挙し、列挙外はヘッドレスで拒否＝安全側 fail）が該当する。受理値は `claude --help` の一次情報（`--permission-mode {acceptEdits,auto,bypassPermissions,manual,dontAsk,plan}`、`--allowed-tools <tools...>`（カンマ／空白区切り、`Bash(git *)` 等のパターン可））。
- **ワーカーの正規責務範囲**: `.agent-skill-chain/config/roles.yaml` の `worker` role の capability。自 worktree 内 read/write、test 実行、writer lease の acquire/renew/release、**自 branch への commit/push**、Integration Record／Draft PR 更新（Draft PR 作成は spec のみ）、固定スキーマによる report。自 branch 以外への書込みは禁止（I5）。
- **allowlist（責務スコープ許可リスト）**: 上記責務範囲の操作だけを列挙した `--allowed-tools` の内容。列挙外はヘッドレスで拒否される。
- **ローカルバックエンド**: `coordination.backend: local` 時の調整状態の正本。Issue 毎に `issues/<number>/.agent-skill-chain/state.yaml`（正本）等を Git 管理下に置く。Issue 本文は GitHub API から取れず状態ファイルにのみ存在しうる。
- **安全分類器衝突**: 権限モード緩和（特に `bypassPermissions`）の検証が、検証を行うエージェント自身のセッションの安全分類器にブロックされ、ネストした `claude` 起動へ到達しない副次的現象（SPEC 根本原因3）。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1（責務限定の権限モード） / `AC-1`,`AC-2` | 設計要素A「既定 WORKER_CMD の権限付与方式」 | 候補A（allowlist）を採用。bypassPermissions 既定化を却下 |
| 要件2（安全分類器衝突への配慮） / （AC 直結なし・要件2） | 設計要素E「再検証の分離実行」 | 既定を bypass にしない＋検証を外側セッションから分離した独立プロセスで実行 |
| 要件3（state スキーマへの本文フィールド追加） / `AC-3` | 設計要素B「state.schema.yaml 拡張」 | `title`・`request` を任意追加、`schema_version` 据え置き、migration 不要 |
| 要件4（issue start の対応） / `AC-4` | 設計要素C「issue start のフィールド受理・永続化」 | `--title`／`--request-file`／`--request` を追加。4 positional は不変（後方互換） |
| 要件5（ワーカーへの本文供給経路） / `AC-5` | 設計要素D「segment start の issue 本文供給」 | local backend で state.yaml の本文を contract 出力へ同梱 |
| 要件6（launch_worker 実機完走） / `AC-6`,`AC-7` | 設計要素E「launch_worker 実機再検証手順」 | 使い捨て issue・分離プロセス起動・証跡採取 |
| 要件7（正常経路で誤発火せず／真の異常時のみ発火） / `AC-8`,`AC-9` | 設計要素E「human_required 対照確認」 | 正常経路（不発火）と認証欠如注入（発火）の対照 |
| 要件8（既存テスト維持） / `AC-10` | 設計要素F「回帰の維持・追加テスト」 | 既定 WORKER_CMD 変更はテストの WORKER_CMD 注入により無影響 |

## 責務・境界

### コンポーネント構成

#### A. 既定 WORKER_CMD の権限付与方式（要件1・AC-1・AC-2）

`launch_worker` の既定 `worker_cmd`（現 `claude -p --output-format text --permission-mode acceptEdits`）を、責務スコープを明示した allowlist 起動へ変更する。実現方式の比較・採用判断は後述「権限付与方式の設計判断」に記す。**採用: 候補A（`--allowed-tools` による責務スコープ allowlist）**。既定 permission mode（bypass でも accept でもない通常モード）のまま `--allowed-tools` に責務範囲のツール・Bash パターンを列挙し、列挙外はヘッドレスで拒否（安全側 fail）とする。allowlist の内容は claude.sh 内に grep 可能な名前付きシェル変数 `WORKER_ALLOWED_TOOLS`（env で上書き可）として定義する。

#### B. state.schema.yaml 拡張（要件3・AC-3）

`.agent-skill-chain/schemas/state.schema.yaml` に、Issue のタイトルと要求内容を保持する2フィールドを追加する。具体的なフィールド定義・後方互換・migration 方針は後述「state スキーマ拡張の具体定義」に記す。

#### C. issue start のフィールド受理・永続化（要件4・AC-4）

`src/commands/issue.ts` の `start`（ローカルバックエンド分岐）と、その薄いラッパー `.agent-skill-chain/scripts/issue-start.sh`（`exec ... issue start "$@"` 透過）で、Issue のタイトル・要求内容を受け取り `state.yaml` の追加フィールドへ永続化できるようにする。既存の4 positional 引数（`issue_id type slug issue_created_at`）は不変とし、タイトル・要求内容は**任意フラグ**で受ける（後方互換）。`issue-start.sh` は `"$@"` 透過のためコード変更不要（フラグはそのまま CLI へ渡る）。GitHub バックエンドでは state.yaml を生成しないため本フィールドは書かない（SPEC スコープ外の GitHub モードは対象外）。

#### D. segment start の issue 本文供給（要件5・AC-5）

`src/commands/segment.ts` の `start` が、ローカルバックエンドで `state.yaml` を読み、`title`／`request` が存在する場合に、現在の出力（`role: <role>\n<contract yaml>`）へ Issue 本文ブロック（例: `issue:` に `id`・`title`・`request` を含む）を同梱する。`launch_worker` は `segment start` の出力全文をワーカーの stdin プロンプトへ渡すため、この同梱だけでワーカーへ本文が供給される（`launch_worker` 自体は無改修）。本文が無い state.yaml（後方互換ケース）では従来どおり本文ブロックを付けない。GitHub モードは Issue 本文を API から取得できるため本経路の対象外（SPEC スコープ外）。

#### E. launch_worker 実機再検証・human_required 対照（要件6・要件7・要件2）

使い捨て issue を local backend で起票（設計要素C で本文を渡す）し、本物 `claude` CLI・認証情報下で `launch_worker <id> spec` を**外側セッションから分離した独立プロセス**で起動して完走を実測し、正常経路で human_required が不発火であること・認証欠如注入で発火することを対照確認する。手順詳細は後述「launch_worker 実機再検証手順」に記す。

#### F. 回帰の維持・追加テスト（要件8・AC-10）

既定 WORKER_CMD 変更は、テストが常に `WORKER_CMD` を stub 注入する（`test/integration/worker-adapters.test.ts`）ため既定文字列に依存せず無影響。既定文字列を直接 assert するテストは存在しない（リポジトリ全体で `acceptEdits`／`bypassPermissions` を assert するテストは無い）。新規追加テストは設計要素B/C/Dの自動化部分（AC-3/AC-4/AC-5 automated）と、既定 WORKER_CMD が `--allowed-tools` を用い `bypassPermissions` を用いないことのコード検査（AC-1/AC-2 の automated 部分）。

### 依存関係

```text
A(既定WORKER_CMD allowlist) ─────────────────────────┐
B(state schema拡張) → C(issue start永続化) → D(segment start供給) → E(launch_worker実機再検証)
A,B,C,D ─────────────────────────────────────────────→ F(回帰: npm test 全pass)
```

循環依存は無い。A（権限方式）と B→C→D（本文経路）は独立に着手でき、E は A・D の両方が揃った後に実施する。F は全変更反映後。

## 権限付与方式の設計判断

SPEC 要件1が提示した3候補を、**安全性（無制限な自動承認にしない）と実効性（launch_worker が実際に完走できる）のトレードオフ**を明示して比較する。

### 採用案 候補A: `--allowed-tools` による責務スコープ allowlist

既定 permission mode のまま、`--allowed-tools` にワーカーの正規責務範囲のツール・Bash パターンを列挙して起動する。列挙外のツール呼び出しはヘッドレスで拒否され、`launch_worker` の完了確認（report=completed かつ target_sha 一致）が満たされなければ blocked へ倒れる（安全側 fail）。

採用理由:
1. **安全性**: 既定が「列挙外は拒否」であり、`bypassPermissions` のような無制限自動承認ではない（AC-2 を直接満たす）。自 branch 以外への書込み禁止（I5）は、worktree 隔離＋自 branch スコープの credential 分離という本システムの一次防御で担保され、allowlist は「責務外操作を自動承認しない」層として機能する（AGENTS.md「権限は credential/権限分離で担保し、ツール名の一律 deny では実装しない」と整合——本 allowlist は一律 deny ではなく責務範囲の scoped allow）。
2. **実効性**: 根本原因1の停止点である `git push` を allowlist（`Bash(git push:*)`）に含めることで、非対話ヘッドレスでも承認待ちにならず完走できる（AC-1）。状態遷移は既に `checkpoint.sh`／`report-status.sh`／`lease-*.sh`／`pr-create.sh` へ結線済みで、ワーカーが発行する top-level コマンドは有限に列挙可能（スクリプト内部の子プロセスは1回の Bash 承認の内側で走り、個別ゲートされない）。
3. **既存機構との対称性・独立性**: `launch_gate_reviewer` は既に `--allowed-tools ''`（空＝read-only）で起動しており、`--allowed-tools` はこのアダプタの確立パターン。`enforce on`（PreToolUse hook 配線）の有無に依存せず単体で機能する。
4. **安全分類器衝突の回避**: 既定を `bypassPermissions` にしないため、根本原因3で観測された「bypassPermissions 検証が外側の安全分類器に阻まれる」衝突を既定経路では引き起こさない。

トレードオフ（明示）: allowlist は責務が拡大すると列挙保守が必要になり、列挙漏れがあるとワーカーが当該操作で拒否され未完了（→ blocked）になりうる。この脆さは (i) 状態遷移を asc スクリプトへ集約して発行コマンドを有限化する、(ii) `WORKER_CMD` 完全上書き余地を残す、(iii) AC-6 の実機検証で列挙漏れを検出し allowlist を調整する、で緩和する。

**採用する既定 allowlist（`WORKER_ALLOWED_TOOLS` の既定値、AC-6 で調整前提）**:

```
Read Grep Glob Edit Write MultiEdit
Bash(git add:*) Bash(git commit:*) Bash(git push:*) Bash(git status:*) Bash(git diff:*)
Bash(git rev-parse:*) Bash(git log:*) Bash(git show:*) Bash(git fetch:*) Bash(git restore:*)
Bash(gh pr create:*) Bash(gh pr view:*) Bash(gh pr edit:*) Bash(gh pr comment:*) Bash(gh issue comment:*)
Bash(.agent-skill-chain/scripts/*) Bash(bash .agent-skill-chain/scripts/*) Bash(node bin/agents-md.js:*)
Bash(npm run:*) Bash(npm test:*) Bash(npm ci:*) Bash(mkdir:*) Bash(ls:*)
```

- `Edit`/`Write`/`MultiEdit` は自 worktree 内の成果物編集（SPEC.md 等）。`acceptEdits` は**採用しない**——編集許可は allowlist に一元化し、暗黙の第2承認チャネルを設けないことで「責務範囲へ限定」を明確化する（AC-2）。
- Draft PR 作成（`gh pr create`）は spec セグメントの責務。全セグメント共通 allowlist に含めても、他セグメントでの実行有無はワーカー側の責務判断に委ねる（責務外実行はワーカーが行わない）。
- `bash -c "$worker_cmd"` 経由で起動するため、`--allowed-tools` の値（空白を含む単一引数）はシェルクォートを保つ必要がある（実装上の注意。値は二重引用符で囲んで1引数として渡す）。

### 却下案 候補B: 専用ラッパー／PreToolUse hook 仲介

許可操作のみを通す専用ラッパー、または `PreToolUse` hook（`.agent-skill-chain/hooks/` 系）でワーカーの Bash を仲介し allowlist 外を拒否する。**却下**。理由: (i) 既存 PreToolUse hook（`claude-pretooluse.sh`）は fail-open の**狭い deny 網**（2 パターンのみ拒否、それ以外は無条件通過）として設計されており（その設計判断は当該 hook の役割）、これを「allow を能動付与する機構」へ転用すると deny 網と allow 付与という別責務を混載する。(ii) hook 経路は `enforce on` の配線状態にワーカー起動が結合し、`launch_gate_reviewer`／`launch_worker` が単体で権限を確定できる現状の独立性を損なう。(iii) 同じ「責務スコープ限定」を候補A がより小さい面積（WORKER_CMD 1 箇所）で達成する。既存 hook は defense-in-depth の deny 網として（`enforce on` 時に）併存させ、権限付与の主機構にはしない。

### 却下案 候補C: `bypassPermissions` ＋外側スコープ限定

`bypassPermissions` で全ツール自動承認とし、credential/worktree 隔離で責務外影響を外部から不能化する。**却下**。理由: (i) 「無制限な `bypassPermissions` を既定として安易に採用しない」という SPEC 要件1・AC-2 の明示条件に真っ向から反する（既定化しない）。(ii) 根本原因3の安全分類器衝突を既定経路で誘発する。(iii) 実効性上は完走しうるが、安全性の代償が大きく、候補A で同じ実効性（`git push` 完走）を安全側既定のまま達成できる。ただし `bypassPermissions` を**完全に禁止**はしない——隔離された CI/sandbox で allowlist の列挙保守を回避したい特殊ケース向けに、`WORKER_CMD` の明示上書きとしてのみ利用可能とする（既定にはしない）。

## 安全分類器衝突への配慮（要件2）

根本原因3（bypassPermissions 検証が外側セッションの安全分類器に阻まれる）への対応は2層で行う。安全分類器自体は変更しない（スコープ外）。

1. **既定を bypass にしない**: 採用案（候補A allowlist）は `bypassPermissions` を既定に用いないため、既定経路の再検証（AC-6）は分類器の主たる発火対象（無制限承認）を含まない。
2. **検証の分離実行**: AC-6 の実機起動は、進行役の対話セッションのツール呼び出し経路（ネストした `claude` 起動）としてではなく、**外側セッションから分離した独立プロセス／環境**で行う。具体的には `setsid`／`nohup`／CI ジョブ等で `launch_worker` を detached に起動し、専用の env と作業ディレクトリを与える。これにより外側セッションの分類器が呼び出し経路上に存在しなくなる。証跡（stdout/stderr ログ・report 記録）はファイルへ採取する（認証実値は非出力）。

## state スキーマ拡張の具体定義

`.agent-skill-chain/schemas/state.schema.yaml`（`schema_version: agent-skill-chain/state/v1`、`additionalProperties: false`）へ以下を追加する。

- `title`: `{type: string}`。Issue のタイトル（短い識別子）。**任意**（`required` に加えない）。
- `request`: `{type: string}`。Issue の要求内容（本文、「何を作るか」）。複数行可。**任意**。

**後方互換・migration 方針**:
- 両フィールドは任意のため、当該フィールドを持たない既存 `state.yaml` は引き続きスキーマ検証を通過する（`required` 不変）。`additionalProperties: false` を維持したまま `properties` に2項目を追加するので、本フィールドを含む新しい state も検証を通過する（追加しないと未知プロパティとして弾かれるため、追加は必須）。
- **`schema_version` は据え置き（v1 のまま）**。追加は純粋に加算的（既存ファイルが無効化されない）であり、`v2` へ上げると `const` 不一致で旧 v1 ファイルが読めなくなる破壊的変更になる。AGENTS.md §設定「schema_version の扱い」は「上げない」判断とその根拠の明記で満たす。
- **migration は不要（no-op）**: 旧 `state.yaml` はそのまま読める。`issue start` 経由で本文を渡さない起票は従来どおり本フィールドを持たない state を生成する。既存データの一括変換は行わない。
- `examples` には本フィールドを含む例を1つ追記してよい（任意、スキーマの自己文書化のため）。

## launch_worker 実機再検証手順（要件6・要件7）

`worker.adapter: claude`・本物 `claude` CLI・認証情報あり・local backend の使い捨て issue（本文の人間作り込みなし）で、以下を分離プロセスで実行する。

1. **使い捨て issue 起票**: `issue start ISSUE-<大きな番号> feature <slug> <ts> --title "<検証用タイトル>" --request-file <本文ファイル>` を実行し、worktree と本文入り `state.yaml` を生成する（本文は `--request-file` で供給し、人間が別途 SPEC を作り込まない）。
2. **セグメント選定**: 上流成果物依存が無く単一 `SPEC.md` 生成で完結する **spec セグメント**を第一候補とする（`launch_worker` の全契約経路を最小副作用で通せる）。
3. **分離起動**: `worker.adapter: claude`・認証 env（`ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN`）下で、`launch_worker <id> spec` を `setsid`/`nohup`/CI ジョブ等で**外側セッションから分離**して起動し、stdout/stderr をログへ採取する（認証実値は非出力）。
4. **完走確認（AC-6・AC-7）**: `launch_worker` が終了コード0で返り、`report latest <id> spec` の直近が `status=completed` かつ `target_sha` = `git rev-parse HEAD`、lease 解放済みであることを実測。ログと report 記録を証跡として保存する。
5. **正常経路の不発火確認（AC-8）**: 上記実行の report 履歴に `blocked`／`human_escalation_requested` が一度も無いことを確認する。
6. **対照（真の異常時のみ発火、AC-9）**: `env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN launch_worker <id> spec` を起動し、`report_status blocked`（`human_escalation_requested=true`・`blocked_reason` に「認証」を含む）が発火し非0非3で返ることを確認、AC-8 と対比する。既存 `worker-adapters.test.ts` が認証欠如・起動失敗・完了偽装・target_sha 不一致の各フェイルセーフを automated で網羅しており、本手順は正常経路との**live 対照**を加える。
7. **後始末**: 使い捨て issue・worktree・lease（ローカル状態ファイルまたは lease ref）を `cleanup.sh`／`git worktree remove`（cleanup 経由）／`git push origin --delete` 等で除去し、`main`・統合ブランチ・WIP 枠へ痕跡を残さない。マージしない。

実機検証（AC-6〜AC-9 の manual/live 部分）の実施・証跡採取・記載は独立検証セグメント（VALIDATION.md）の責務。本 DESIGN は手順を確定する。

## 関連ADR

本 Issue の中核判断「セグメント作業ワーカーの権限付与を、無制限な `bypassPermissions` ではなく責務スコープ allowlist（`--allowed-tools`）を既定とする」は、ワーカーへのツール権限付与という**恒久的・横断的なアーキテクチャ契約**であり、`launch_gate_reviewer` の read-only（`--allowed-tools ''`）と対をなす。将来のアダプタ（codex 等）や権限方式変更が honor すべき durable な原理であるため ADR を新設する。

```yaml
related_adrs:
  - id: ADR-0003
    relation: adopts
```

`docs/adr/ADR-0003-worker-permission-model.md`（`status: proposed`）を作成する。設計ゲート承認時に `accepted` へ遷移する。

## 障害・ロールバック考慮

- 想定される失敗モードとロールバック:
  - **allowlist 列挙漏れでワーカーが特定操作で拒否され未完了になる**: 完了確認が満たされず `launch_worker` は blocked へ安全側に倒れる（実害はワーカー未完了のみ、誤 approve は起きない）。切り戻し・調整は `WORKER_ALLOWED_TOOLS` へ不足パターンを追記、または `WORKER_CMD` で一時上書き。既定文字列変更は1関数内に閉じ、`git revert` で即時復旧可能。
  - **state スキーマ拡張による既存 state 破壊**: 追加は任意フィールドのため既存 state は無効化されない。万一問題があればスキーマから2 properties を除去すれば元に戻る（追加した state.yaml が無い限り無影響）。
  - **issue start/segment start 変更による後方互換退行**: フラグ未指定の従来起票・本文なし state での segment start が従来どおり動くことをテストで担保する。退行時は当該 CLI 変更を revert。
  - **使い捨て検証物の残存**: 使い捨て issue／worktree／lease が残ると WIP 枠・状態を汚す。後始末を手順化（PLAN の後始末タスクで必須化）。
- 影響を受ける既存機能:
  - `launch_worker` の既定起動フラグのみが変わる（`WORKER_CMD` 明示時は無影響）。`launch_gate_reviewer` は無変更。
  - 配布物（`.agent-skill-chain/templates/`）・CI workflow・GitHub 側共有設定（ruleset/branch protection）は**変更しない**（本 Issue は #180 と異なり共有インフラ変更を含まない）。

## 制約・未決事項・対象外

- **制約**: `WORKER_CMD` 完全上書き余地を維持する（テストのモック境界・CI/sandbox 差し替えに必須）。認証実値をログ・PR・Issue・証跡へ出力しない。既定 allowlist は「安全側 fail（列挙外は拒否）」を崩さない範囲でのみ拡張する。
- **未決事項**: 既定 allowlist の最終確定形は AC-6 の実機検証で列挙漏れを検出して調整する（DESIGN は初期値と調整方針を定める）。実機検証を local backend で行うか GitHub backend で行うか（本設計は local 使い捨てを推奨するが最終判断は検証者に委ねる。launch_worker 契約は backend 非依存）。
- **対象外（SPEC スコープ外の再掲）**: 外側セッションの安全分類器自体の変更・無効化、`codex` アダプタへの同等対応、GitHub モードの Issue 本文供給経路の再設計、GitHub 側ライブ設定（ruleset/branch protection）の変更、`worker.adapter`/`review.adapter` の恒久既定値化の意思決定、`human_required` 4異常経路すべての網羅的故障注入テストの新規整備。
