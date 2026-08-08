# AGENTS.md — agent-skill-chain 憲法

> 本ファイルが正本。CLAUDE.md 等の他ランタイム設定ファイルは `@AGENTS.md` インポートのみを行う。

本システムはソフトウェア開発の管理そのものをドメインとする。状態は選択した Coordination Backend（GitHub の Issue・ブランチ・PR・Check Run、またはローカルの Git 管理下状態ファイル）だけに存在し、Issue を集約ルート、GitHub Flow 標準語彙をユビキタス言語とし、すべての強制は commit・Check Run・マージというイベントへの反応として実装する（DDD）。仕様の受け入れ基準は一意な ID で検証証跡と機械的に結線され、承認後の仕様変更はゲート再通過を自動要求する——文書は書いて終わる散文ではなく、検証され続ける契約である（BDD）。作業は 1 Issue = 1 ブランチ = 1 worktree = 1 PR の小さなバッチで 4 セグメントを通じ並行に流れ、セグメントごとの push により失敗は常に安価に巻き戻せる。可逆だから安全であり、安全だから速い。改善はふりかえり専用の儀式ではなく通常の Issue として自システムの規律の下で処理される（アジャイル）。各スクリプトはちょうど 1 つの状態遷移だけを行い、検査は grep できる形で書き、疑わしい機能は追加しない（UNIX）。既定は常に安全側であり、速度は人間の明示的なオプトイン、危険信号による降格は自動である。

## 不変条件 I1〜I8

「(a) 違反がユーザーの実痛に直結し、(b) 機械的に検査可能」の両方を満たすものだけが不変条件。片方だけならテンプレート内のガイドラインに降格する。

| # | 不変条件 | 検査手段 |
|---|---|---|
| I1 追跡可能性 | 全変更は Issue に紐づき、要求→設計(ADR)→実装→レビューの証跡が追跡可能な形で残り、現在有効な決定を指し続ける。証跡の所在は、GitHub モードかつ `issue_sync` 有効時は Issue/PR 本文（成果物内容の正本）＋Check Run、それ以外（ローカルモード・`issue_sync` 無効）は Git 履歴（ADR-0021） | PR に Issue 参照必須、成果物存在チェック、`.agent-skill-chain/scripts/adr-lint.sh check`（CI） |
| I2 セグメントゲート | 4 セグメント（①要求・要件 ②設計・実装計画 ③実装 ④独立検証）それぞれの完了時に、立証(conformance)+反証(falsification) の2観点レビューでゲートを通過する。**ローカルモードかつ `profile: lightweight` でない場合は不変条件。GitHub モード、または `profile: lightweight` の場合はガイドライン**（実施要否は進行役が判断）。GitHubモードがガイドラインになる根拠は自動CI強制の不在。`profile: lightweight` がガイドラインになる根拠は、強制層に加えセグメントゲートの機械的検査・記録機構（`reviews/<gate>.yaml` 等）も導入しない設計方針であること自体（モード軸とは独立）。`profile` の値は `.agent-skill-chain/config/agent-skill-chain.yaml` の `profile` フィールドでのみ機械的に判定する | ローカルモード：`reviews/<gate>.yaml` + `.agent-skill-chain/schemas/gate-report.schema.yaml`（機械的に検査可能）。GitHub モード：機械的な自動強制なし。`.agent-skill-chain/scripts/gate-*.sh`（`gate review`・`gate publish`等）で進行役が任意実行できる手動レビューは引き続き利用可能 |
| I3 耐久性 | 作業状態は常に完全復元可能で、頭の中にしか無い状態を作らない。復元元は、GitHub モードかつ `issue_sync` 有効時は Issue/PR 本文＋Check Run（GitHub 側の永続化）を含み、それ以外（ローカルモード・`issue_sync` 無効）は Git（remote push 済み）（ADR-0021） | セグメント完了ごとの commit+push、`.agent-skill-chain/scripts/issue-resume.sh`、`durability.backend` 未設定環境では完全自走を拒否 |
| I4 分離 | 1 Issue = 1 ブランチ = 1 worktree = 1 PR。main への変更は PR 経由のみ | branch protection、`.agent-skill-chain/ci/verify-branch-name.sh`・`.agent-skill-chain/ci/verify-worktree-path.sh` |
| I5 進行役の純粋性 | 進行役が読み書きするのは調整状態（Issue・ラベル・PR review証跡・マージ・worktree ライフサイクル）のみ。成果物の著述・内容の取り込みは行わない | role capability・credential分離、protected-base実行attestation、main worktree clean チェック、ワーカー報告固定スキーマ（`.agent-skill-chain/schemas/worker-report.schema.yaml`） |
| I6 正準モデル | 調整状態は選択された Coordination Backend のプリミティブにのみ存在し、GitHub Flow 標準語彙で記述する。複数の Coordination Backend 間で同一 Issue の状態を同期しない | GitHub モード：`.agent-skill-chain/scripts/lint-vocab.sh` + Check Run 正本。ローカルモード：`state.yaml` が正本 |
| I7 仕様⇔検証の追跡 | 全 AC-ID は最低1つの検証方法(`automated\|manual\|hybrid`)と証跡に対応する。承認後の AC 変更はゲート再通過を強制する | `.agent-skill-chain/ci/verify-ac-coverage.sh`、SPEC 差分検知によるゲート無効化（A-6 相当） |
| I8 安全側ラチェット | autonomy の降格は自動、昇格は人間の明示行為のみ。既定は `autonomy:gated`。`risk != normal`（`unclassified` 含む）OR `autonomy == full` → `review_profile: strict` | Actions の状態遷移規則（昇格 workflow が存在しないことを含め検査）。実装着手前・PRマージ前の人間確認は `autonomy` と独立の別軸設定（`human_confirmation.before_implementation`・`merge.autonomous`、既定は確認要求）で別途検査 |

## Coordination Backend

正本は必ずどちらか一方であり、二重化しない。

| モード | 調整状態の正本 | ゲートの正本 | 成果物内容の正本 |
|---|---|---|---|
| GitHub モード | Issue・PR・branch・Check Run | ガイドライン（自動強制なし、I2）。`.agent-skill-chain/scripts/gate-*.sh` で進行役が手動発行した場合はCheck Run（`agent-skill-chain/{spec,design,implementation,validation}-gate`）が結果を保持 | `issue_sync` 有効時は Issue/PR 本文（Git は同期元・版管理基盤）。既定（無効）では Git 管理下ファイル |
| ローカルモード | `state.yaml`（Issue 毎、Git 管理下） | `reviews/<gate>.yaml`（Git 管理下） | Git 管理下ファイル（`SPEC.md` 等） |

共通の状態モデル（フィールド・enum）は `.agent-skill-chain/schemas/state.schema.yaml` が定義する。`issue_sync`（既定 `enabled: false`、ADR-0021）を有効化した GitHub モードでは、ゲート通過ごとに成果物全文とゲート状態を Issue/PR 本文の固定マーカー区間へ一方向転記し、マーカー外の人間記述部分は変更しない。転記結果をゲート判定の入力として読み戻すことはしない。

## 4 セグメント・4 ゲート

固定4セグメント（`.agent-skill-chain/config/segments.yaml`）。追加・変更は破壊的変更とし ADR + 本ファイル改定 + `schema_version` 更新 + migration を要する。

| セグメント | 主成果物 | ゲート |
|---|---|---|
| ①要求・要件 | `SPEC.md` | spec-gate |
| ②設計・実装計画 | `DESIGN.md` / ADR / `PLAN.md` | design-gate |
| ③実装 | コード・単体テスト結果 | implementation-gate |
| ④独立検証 | 受入/統合/回帰テスト・PR | validation-gate |

quick（GitHub モードは Issue ラベル `size:quick`、ローカルモードは `state.yaml` の `size: quick`。既定は standard、進行役の明示的オプトインのみで成立し自動昇格しない）の Issue は `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の作成義務を免除する。シグナルは免除対象の成果物に一切依存しない場所にのみ置く。ただし risk が `normal` 以外、または変更差分に `docs/adr/`・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` を含む場合は免除せず通常フローを強制する（`.agent-skill-chain/ci/verify-artifacts.sh`、ADR-0022）。

レビュープロファイル：Standard（既定、レビュア1体が conformance→falsification を順に実行）／Light（人間の`review:light`明示時のみ、危険信号があれば自動でStrictへ固定）／Strict（`risk != normal` OR `autonomy == full`、専任2体）。ゲートは次のワーカーを直接起動しない——進行役がゲート状態のみを読み、次セグメント起動・`finding.origin`（`specification|design|implementation|validation`）に基づく差し戻し先決定・人間判断への昇格・マージ条件確認を行う。

## 役割・権限・writer lease

> 1 Issue には同時に1つの writer lease のみを許可する。read-only レビュアは複数並列実行できる。

| 役割 | 権限 | 種別 |
|---|---|---|
| 進行役 | Issue作成・状態遷移・worktree管理・review証跡記録・マージ | writer lease対象外（成果物branchへのcommit禁止） |
| セグメント作業ワーカー | 自branchへのcommit/push、Draft PR作成（SPECワーカーのみ）、Issueコメント | writer（同時1つ） |
| ゲートレビュア | read-only + verdictをtrusted recorderへ返却 | read-only（複数並列可） |

権限はrole capabilityとcredential/GitHub権限を分離して担保する。GitHub actorがwriterとrecorderで同一でも、repository default branchのprotected-base隔離launcher、GitHub credentialを持たないread-only reviewer、one-time attempt token、固有run ID/slot、SHA・prompt・artifact・launcher digest、latest attemptの集約digestを検証できる場合は同一roleと見なさない。ツール名の一律 deny はしない。lease スキーマは `.agent-skill-chain/schemas/lease.schema.yaml`、既定 `ttl_seconds: 3600` / `renewal_interval_seconds: 900`。WIP 上限は worktree 残存数ではなく有効 writer lease 数で判定（既定 `wip_limit: 3`）。

## ブランチ・worktree

```
branch:   <type>/<issue-id>-<slug>   例: feature/123-user-authentication
worktree: .worktrees/<YYYYMMDD_HHMMSS>-<type>-<issue-id>-<slug>/   (timestamp = Issue起票日時, Asia/Tokyo)
```

正本は `git worktree list --porcelain`。削除は `.agent-skill-chain/scripts/cleanup.sh` 経由のみ（writer lease不在・未commit/未push無し・PR完了済みを検査後 `git worktree remove` → `prune`）。詳細は `.agent-skill-chain/standards/GIT_CONVENTIONS.md` + `.agent-skill-chain/config/agent-skill-chain.yaml` + `.agent-skill-chain/scripts/issue-start.sh` + `.agent-skill-chain/ci/verify-branch-name.sh`/`.agent-skill-chain/ci/verify-worktree-path.sh` の4層。

## ゲートの継承・無効化

ローカルモードでは `.agent-skill-chain/scripts/gate-reconcile.sh` が承認済み成果物 digest を照合し、変化なしなら最新 SHA へ成功を再発行、変化ありなら当該ゲートと全下流ゲートを `reviews/<gate>.yaml` 上で無効化する（対応表は `.agent-skill-chain/schemas/gate-report.schema.yaml` 添付コメント参照）。GitHub モードでは I2 がガイドラインであり自動強制が無いため、push ごとの自動照合は行わない——進行役が任意のタイミングで同スクリプトを実行し、Check Run（`agent-skill-chain/<gate>-gate`）へ結果を手動発行・再照合できる。

## ADR・テンプレート・テスト適用性

ADR は `proposed → accepted`（設計ゲート承認時、finalization ワーカーが writer lease 取得の上 status のみ更新）→ `superseded/deprecated` のライフサイクルを取り、`docs/adr/` に保存する。テンプレート正本は `.agent-skill-chain/templates/`（`.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`、`.agent-skill-chain/templates/adr/ADR.md`、`.agent-skill-chain/templates/github/.github/...`）。AC ごとの検証方法・適用すべきテスト種別（常時必須／変更種別ごと／リリース単位）は `.agent-skill-chain/standards/TEST_POLICY.md` を正本とする。文書量は AGENTS.md 150 行・各テンプレート 100 行を上限とし、`.agent-skill-chain/ci/verify-doc-length.sh` がCIで検査する。

## 成果物の自己完結性

各成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`・ADR・`docs/system-spec/` 等）は、自身の責務範囲について目的・対象範囲・前提・用語・入力・出力・要求または判断内容・制約・完了条件・検証方法・未決事項・対象外を**内部に**記載する。外部参照は由来・追跡・根拠を示す補助情報としてのみ用い、成果物の意味を外部へ委譲してはならない。

```text
禁止: 詳細はIssue #123を参照。仕様はADR-0012を参照。動作は実装コードを参照。
許可: 本成果物内に必要な要求・動作・制約を完全に記載する。
      Issue #123・ADR-0012は由来・根拠を示す補助情報としてのみ記載する。
```

自己完結の単位は成果物パッケージであり、ディレクトリ全体で1つの成果物となる場合を含む（例：`docs/system-spec/`）。パッケージ内部のモジュール間参照は許容する。`related_adrs:` のような構造化フィールド経由の参照は、判断の帰結自体を自己完結して記載したうえでの由来提示であり本原則には抵触しない（`.agent-skill-chain/templates/adr/ADR.md` §related_adrs参照ルール）。ADRは「なぜその判断をしたか」を記録する成果物であり、参照元（例：`DESIGN.md`）は設計要素・責務・境界を自己完結して記載したうえで、根拠として当該ADRを併記する。

## 参照・コメントの陳腐化防止

規範文書・ソースコードコメントでは、セクション番号参照（例：「§3.2を参照」）・ファイルパス＋行番号参照（例：`src/foo.ts:123`）を禁止する。セクション追加・ファイル分割・見出し移動のたびに参照が陳腐化し、AI がその陳腐化に気付かず古い位置情報を正しいものとして誤解釈するため。機械処理用manifest・テスト証跡・エラー出力での使用は許可する。`docs/system-spec/` 内部では安定ID（例：`ASC-GATE-FR-0014`）を用いる。参照元にはその文脈で必要な契約の要旨を本文へ記載し、参照だけで意味を委譲しない（前節「成果物の自己完結性」）。禁止参照の機械検査は `.agent-skill-chain/scripts/lint-references.sh` が行う（対象：生きたファイル。`related_adrs:` 等の構造化フィールド経由の参照は前節により対象外）。当該スクリプトの走査対象集合を拡張するIssueは、対象拡張後の状態でリポジトリ全体に対する dry-run 結果をAC（受入条件）へ含めること。走査対象拡張は既存の潜伏違反を一括で顕在化させ、main の `verify` を即座に恒久失敗させ得るため。

ソースコードコメントは、コードから読み取れない「なぜ」を説明し、処理内容の逐語的な説明は書かない。非自明な制約・互換処理・回避策・例外処理には、追跡識別子として **Issue ID のみ**を記載してよい（例：`// Issue #123: ...`）。文書の章番号・見出し位置・行番号への参照は禁止する（本節冒頭と同じ理由）。要求ID・ADR ID・テストIDの対応はソースコメントではなく機械管理されるtraceability情報（`docs/system-spec/90-traceability/`、実体構築は別途ADRによる段階導入）で管理する。

## `docs/system-spec/`（システム仕様書）

Issue をまたいで永続する、システムの外部から観測できる振る舞い・機能・状態・制約・権限・異常時の振る舞い・非機能要求を集約する唯一の正本。Issue 単位の `SPEC.md`（今回の Issue で仕様をどう変更するか、Issue 毎に破棄）・ADR（なぜその判断をしたか）とは役割を分離する。参照可能な情報源は (a) system-spec内部の別モジュール（安定IDを介した参照）、(b) 外部の公式一次情報のみとし、Issue・PR・commit・ソースコード・テストコード・AGENTS.md・ADR・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`・会話履歴・非公式サイトを規範的参照先にしてはならない。依存方向は「外部公式一次情報 → システム仕様書 → Issue SPEC → DESIGN/PLAN → ADR → 実装 → テスト・VALIDATION」の一方向であり、システム仕様書は下流に依存してはならない。

**現状**：新設する方針とディレクトリ・スキーマ設計は `docs/adr/ADR-0001-docs-system-spec-construction.md`（`status: proposed`）で確定済み。実体（ディレクトリ・`.agent-skill-chain/schemas/system-spec.schema.yaml`・`.agent-skill-chain/config/system-spec-sources.yaml`・`.agent-skill-chain/config/roles.yaml` の読み取りscope追加等）はこの ADR が accepted になった後、別 Issue で構築する（`.agent-skill-chain/config/segments.yaml` のoutputsの意味的変更を伴うため、本ファイル §4セグメント・4ゲート が定める「セグメント自体の追加・変更は破壊的変更、ADR作成必須」の規約に従う）。構築完了までは `system_spec_impact` フィールドの必須化を含む下流の統合は行わない。

## GitHub配布・マルチAI対応

`.agent-skill-chain/templates/github/.github/` を配布元の正本とし、対象リポジトリの `.github/` はその展開結果（`.agent-skill-chain/scripts/verify-template-sync.sh` で同期検査）。ラベル・ruleset は GitHub API 経由のみで適用（`.agent-skill-chain/templates/github/provisioning/labels.yaml` → `.agent-skill-chain/scripts/setup-labels.sh`、`.agent-skill-chain/templates/github/provisioning/rulesets/main.json` → `.agent-skill-chain/scripts/setup-ruleset.sh`）。作業エージェントの実体はベンダー中立の role contract（`.agent-skill-chain/config/roles.yaml`）を正本とし、`.agent-skill-chain/adapters/{claude,codex,human}.sh` が実行系へ変換する。導入後の更新は `npx github:techbeansjp-free/AGENTS.md upgrade [target_dir] [--dry-run]`（版固定時は `#<tag-or-branch>` を付与）で行う。

## 設定

初期値は `.agent-skill-chain/config/agent-skill-chain.yaml`（`schema_version: agent-skill-chain/config/v1`）が確定させる。項目追加はハードコード不可の理由・プロジェクト単位で変わる必要性の正当化を経て、スキーマ更新・既定値定義・migration定義（必要ならADR）を要する。スキーマ名前空間は `agent-skill-chain/{config,segments,state,gate-report,validation-report,worker-report,lease,integration,project-policy}/v1` に階層化する。

## プロジェクト固有ポリシー

consumer project は `.agent-skill-chain/project/`（`manifest.yaml` + `RULES.md`、role固有の追加規約が必要な場合のみ `roles/<role>.md`）で、プロジェクト固有の追加プロセス規約を自然文で記述できる。`manifest.yaml`（`.agent-skill-chain/schemas/project-policy.schema.yaml` で検証）に登録された文書のみを規範として扱い、未登録文書はCIが無視する。優先順位は「agent-skill-chain の不変条件 ＞ プロジェクトポリシー ＞ 標準規約・既定値 ＞ adapter既定動作」。I3・I4・I5、4セグメント・4ゲート、writer lease、Check Run承認、禁止語・secretスキャンは上書き不可で、上書きを試みる記述はCIが `human_required` ではなく**設定エラーとして実行停止**する。進行役は `manifest.yaml` 全体を読み、各ワーカーには `documents.common` と自role分のみを渡す（前節「参照・コメントの陳腐化防止」の局所契約原則と同一）。プロジェクトポリシーと `docs/system-spec/` が矛盾する場合はどちらも自動優先せず `human_required`。

## ディレクトリ構成

```
AGENTS.md  CLAUDE.md  README.md
docs/{GLOSSARY.md, adr/, system-spec/}
.github/            # .agent-skill-chain/templates/github/.github/ の展開結果
.worktrees/
.claude/            # .agent-skill-chain/templates/claude/ の展開結果
.agent-skill-chain/
  project/          # consumer project 固有ポリシー（manifest.yaml, RULES.md, roles/）
  standards/{GIT_CONVENTIONS,TEST_POLICY,SECURITY_POLICY,CODEX_BACKGROUND_TASK_POLICY}.md
  templates/{issue/, adr/, github/}
  schemas/{config,state,gate-report,validation-report,worker-report,integration,lease,segments,project-policy}.schema.yaml
  config/{agent-skill-chain.yaml, segments.yaml, roles.yaml}
  adapters/{claude,codex,human}.sh
  hooks/{claude-pretooluse.sh}   # `enforce on` が配線するPreToolUse hook本体
  scripts/  (init, upgrade, uninstall, enforce, setup*, issue-start/resume, lease-*,
             segment-start, gate-*, pr-create, adr-finalize, cleanup, doctor, reconcile,
             lint-vocab, lint-references, adr-lint)
  ci/  (verify-branch-name, verify-worktree-path, verify-template-sync, verify-doc-length,
        verify-ac-coverage, verify-gate-report, verify-artifacts, verify-adr)
```

root直下は AGENTS.md・CLAUDE.md・README.md・`docs/`・`.github/`・`.worktrees/`・`.claude/` のみ（人間・他ツールとの衝突を避けるため）。それ以外の正本アセット一式は `.agent-skill-chain/` 配下に名前空間化する。`docs/` を対象外とするのは、`.agent-skill-chain/` 配下に置くと GLOSSARY.md・ADR が対象リポジトリ既存の `docs/` 資産と混ざらず安全な一方、`setup` が対象リポジトリ側の `docs/` と衝突しうるため——衝突時は非破壊のため上書きせず、日本語の理由付きエラーで停止する（`.agent-skill-chain/scripts/setup.sh` 実装）。

## 用語

「Issue」= GitHub Issue（またはローカルモードの Issue 状態ファイル）のみ。SPEC/DESIGN/PLAN/検証結果は「Issue に紐づく成果物」であり `issue`（小文字）とは呼ばない。Task はセッション内の揮発的作業単位（永続化禁止）。用語集の正本は `docs/GLOSSARY.md`（用語・定義・禁止同義語の3列、20行以内）。禁止語混入は `.agent-skill-chain/scripts/lint-vocab.sh` が検査する。
