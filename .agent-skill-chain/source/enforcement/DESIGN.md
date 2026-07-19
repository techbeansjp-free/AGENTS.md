# enforcement DESIGN — 強制の4層と逸脱不能

強制の目的は **「AI に正しいことを理解させる」** ではなく **「AI が勝手に逸脱できないようにする」** こと。中心は、良い説明や長いプロンプトではなく、**経路の限定・違反操作の停止・正しい I/O のみを通す・完了条件を証跡で縛る**。

---

## 強制の4層

| 層 | 担い手 | 役割 | 例 |
|----|--------|------|-----|
| **1. 物理強制** | hooks / setup / CI | **操作を止める**。AI の意思に関係なくブロックする。 | ROLE: 付き Task の形式違反拒否、許可外へのログ書き込み拒否、CI で CONTRACT 違反で落とす |
| **2. 契約強制** | CORE / LOAD_POLICY / command / skill I/O | **従うべき形を固定する**。構造による強制。 | command は skill chain のみ、skill は Input/Process/Output、orchestrator は command 選択のみ、auditor は証跡確認のみ、scribe は記録のみ |
| **3. 配備強制** | setup | **導入時点で強制を埋め込む**。プロジェクトを開いた瞬間に強制が効く状態にする。 | .agent-skill-chain/source/ 配置、.claude/hooks/ 配置、.cursor/rules/ 配置、CI 監査配置 |
| **4. 完了強制** | DoD / 証跡 / review / audit | **完了条件で縛る**。 | 完了は「やった」ではなく証跡で判定、04_review を経ないと close しない。証跡は本則 workflow.db、memo は過渡的・例外運用のみ（scribe/CONTRACT 参照）。 |

**表記の正直化（C-4）**: 「フェーズ飛ばしの Write 拒否」「scribe 未実行の次 Task 拒否」は、上表の物理強制（hooks）の例からは除外する。前者は R1 が memo/workflow.db\* 保護に絞られ 00〜04 を phase 非依存で allow する意図的設計と衝突するため hook 未実装であり、後者は cross-Task の実行状態を PreToolUse が信頼できる形で追跡できずフック層では脆いため hook 未実装である。両者の実効は **CI/audit（enforcement/README.md #5/#9/#18/#19）のみが担い、CI は workflow.db 不在環境（クリーンな checkout 等）では構造的に SKIP されうる**（hook による物理強制ではない旨は下記「現状」・既存の「完全物理強制ではない」注記と一貫）。

**現状**: PreToolUse は **プラットフォームがツール名・対象パス・コマンド・ロールをフックに渡す場合**、exit 2（block）で物理的拒否する（.workflow 直接編集・許可外 Shell・sqlite3 直接・orchestrator の Write/Edit）。渡されない場合は案内のみ exit 0 とし、事後検知は audit.sh が担う。**完全物理強制ではない。** runtime で止められる範囲と CI で補完する範囲を分けて理解すること。**runtime の reject は、取得可能なメタデータ範囲で行い、それ以外は CI 監査で補完する。** **物理強制の到達範囲は、Claude Hook（PreToolUse）の提供情報（ツール名・対象パス・コマンド・ロール）に依存する。** **改善の方向**: 禁止リストより許可リスト（orchestrator は command 選択・委譲・結果集約のみ許可し、ファイル更新は許さない）。物理強制の最小単位を ROLE 付き委譲・workflow.db 記録・04_review 存在・verify-and-close 痕跡に寄せる。

---

## 強制の本体・実行・内容

- **強制の正本**: `.agent-skill-chain/source/enforcement/` に置く。本 README と DESIGN.md、各 claude/ cursor/ ci/ のファイル。
- **強制の実行**: setup が `.claude/`、`.cursor/`、CI に展開する。配備後はプロジェクトを開いた時点で強制が有効になる。
- **強制の内容**:  
  - hooks がツール実行時に block（経路違反・形式違反など。書記未実行の次実行は hook 未実装であり CI/audit のみで検知する・C-4）。  
  - CI がマージ前に reject（CONTRACT 違反・証跡欠落）。  
  - command / skill / agent の責務分離で逸脱余地を減らす。  
  - DoD と証跡で「完了したつもり」を認めない。

規約で教育するのではなく、**構造で逸脱不能にする**。

---

## Orchestrator 逸脱の検知（仕様）

orchestrator が「実作業をしない」「run_command 経由のみ」から逸脱した場合に、検知・拒否する観点を以下に定義する。実装は hooks / CI / guard スクリプトで行い、本節は「何を検知するか」の仕様とする。

| 検知対象 | 期待する I/O・経路 | 拒否条件（reject する場合） |
|----------|-------------------|-----------------------------|
| **メインが直接生成した成果物** | 00/01/02/03/04 や .agent-skill-chain/runtime/**/memo/*.md は、run_command で起動したサブ（worker）が出力する。 | サブ起動の証跡なしに 00/01/02/03/04 や .agent-skill-chain/runtime/**/logs/*.md がメインセッションから生成されたと判断できる場合。 |
| **書記未委譲** | ログ・証跡は書記（write-workflow-log）のみが記録する。証跡は本則 workflow.db、memo は過渡的・例外のみ。orchestrator は verify-and-close 等で書記を委譲する。 | 書記 capability を経ずに workflow.db や CONTRACT 準拠ログへ書き込んだ場合。書記未実行のまま次 Task に進もうとした場合。 |
| **verify-and-close 未実行** | 実装・変更後は必ず verify-and-close を経てから close する。 | 実装 phase の成果物があるのに 04_review 未作成・未更新のまま close 相当の遷移をしようとした場合。 |
| **timestamp 付き memo の自由生成** | `.agent-skill-chain/runtime/{issue}/memo/` 以下の `YYYYMMDD_HHMMSS_*.md` は、write-workflow-log または `.agent-skill-chain/source/scripts/new-workflow-memo.sh` 等、**システム時計からプレフィックスを生成する経路のみ**で作成される。 | メインまたは worker が、自由入力のファイル名で `.agent-skill-chain/runtime/{issue}/memo/` 以下に `YYYYMMDD_HHMMSS_*.md` を直接 Write/Edit しようとした場合、または CI でプレフィックスとファイル mtime が大きく乖離している（推測・固定値と思われる）場合。 |

上記を物理強制（hooks）や CI で実装する際は、enforcement/README.md および既存の subagent-guard（実体: `.agent-skill-chain/runtime/templates/github/scripts/subagent-guard.sh`）等と整合をとること。subagent-guard が検査するのは内部参照禁止（#6 相当）・ログ frontmatter 禁止・`logs/` 廃止の 3 点のみで、#22–#24 は実装しない。timestamp 付き memo については、hooks で `.agent-skill-chain/runtime/{issue}/memo/` への自由な Write/Edit を抑止し、CI（audit.sh）でプレフィックス形式および実時間との乖離を検査する。

### worker と main の識別（`agent_id` による委譲先判定）

`enforce on` 時、`settings.enforce.json` は `env.AGENT_ROLE=orchestrator` を全実行に静的配線するため、env だけでは進行役 main と委譲先 subagent worker を区別できない。両者の識別は、**ハーネスがサブエージェント実行時のみ PreToolUse の stdin JSON トップレベルへ注入する `agent_id`**（`IS_SUBAGENT = (agent_id 非空)`）で行う。`agent_id` が非空なら worker として実作業（Bash/Edit/Write）を許可し、空なら main 相当として orchestrator の直接実作業を `exit 2` で block する。**判定ロジックの実体は `PreToolUse.sh` のみに集約**し、本 DESIGN・README・`settings.enforce.json`・`src/agents-md.ts` へロール分岐を二重実装しない（本節は参照）。

**偽装耐性と限界（ADR-2）**: `agent_id` は**ハーネス注入（エージェント非制御領域）であり自己申告できない**。エージェントは hook stdin のトップレベルを構築できず（制御できるのは `tool_input` の中身のみ）、`export` 可能な env 昇格 twin（`CLAUDE_AGENT_ID` 等）は意図的に設けない。ゆえに素朴な `export AGENT_ROLE=worker` では orchestrator 制限を外せない。ただし C-4b（scribe nonce）と同種の限界があり、hook 入力構築を完全に掌握できる相手への完全防御ではない。最終保証は CI audit（#25）＋外部証跡が担う。scribe（nonce 検証済み）は `agent_id` を伴っても最優先で判定され、worker allow へ落ちず R5（write-workflow-log 単独のみ）を維持する。

**R1（path 軸）との非対称は意図的（誤診断防止のための明記）**: 上記の `IS_SUBAGENT` によるロール軸の判定（R2・R3(b)）とは別に、PreToolUse.sh の R1 は `.agent-skill-chain/runtime/` 配下への直接 Write/Edit を **IS_SUBAGENT の値に関わらず全 ROLE 一律で block** する（path 軸のガード）。これは、runtime/ 配下に timestamp をシステム時計へ固定すべき memo（§Orchestrator 逸脱の検知「timestamp 付き memo の自由生成」行）と書記のみが書く workflow.db が含まれるためであり、R1 が subagent を除外すると当該保護が worker 経路で破れることを防ぐための意図的設計である。R1（path 軸・全 ROLE）と R2/R3(b)（role 軸・subagent 除外）は**目的の異なる独立ガード**であり、非対称そのものはバグではない。subagent が runtime/ 配下へ内容を書く正規ルートは、R3(b) が許可する Bash 経由（heredoc/cp/new-workflow-memo.sh 等）である。

**R1 の保護範囲は「memo・workflow.db\*」のみに絞られている（issue 起票時点の追加の洗練・上記の意図を否定しない）**: R1 が実際に保護すべき対象は上記のとおり memo のタイムスタンプ整合性と workflow.db\* の書込整合性の2点であり、`00_要求定義.md` 等の issue ドキュメント自体はこの保護を必要としない（内容の真正性は Bash 経由でも Edit/Write 経由でも同じ）。そのため R1 は、basename が固定 allowlist（`00_要求定義.md`・`00_システム理解.md`・`01_要件定義.md`・`02_設計.md`・`03_実装計画.md`・`04_review.md`・`05_最終確認チェックリスト.md`・`90_issues.md`・`99_PR.md`・`99_PR_review.md`）に厳密一致し、かつパスが `/memo/` を含まない場合は Edit/Write を allow する（既存の `.gitignore` 厳密一致例外と同型の carve-out）。この carve-out は上記の「R1 は全 ROLE 一律」という設計判断そのものを覆すものではなく、**保護「範囲」を実際に保護が必要な対象へ絞り込む追加の洗練**である（保護「目的」の有無を扱った既存の結論とは別軸）。
- **実装制約**: この carve-out は既存の `.gitignore` 例外と同じ **no-op（フォールスルー）** 方式で実装する。`allow()`（`exit 0` の早期終了）を用いると、R2（`ROLE=orchestrator` かつ `IS_SUBAGENT!="1"` の Edit/Write 拒否）の評価に到達する前にスクリプトが終了してしまい、orchestrator（main）自身の直接編集が R2 を経由せず素通りする退行を招くため、フォールスルーであることが必須の実装制約である。
- **symlink/hardlink 実体すり替え耐性（CodeRabbit PR#92 指摘対応・必須）**: basename の文字列一致だけでは、doc 名（例 `00_要求定義.md`）の **symlink** が実体として `memo/` 配下や `workflow.db*` を指していた場合、通常の（善意の）Edit/Write が気づかず保護対象を破壊しうる（権限昇格ではなく事故防止の問題であり、R1 の保護目的＝memo タイムスタンプ整合性・workflow.db 書込整合性は、事前に仕込まれた symlink 経由の書換からも守られるべき）。そのため carve-out は basename allowlist 一致後に、対象パスを `realpath`（無ければ `readlink -f`。いずれも欠損許容の `-m`／`-f` を優先し新規作成予定ファイルも扱う）で **実体パスへ解決**し、解決先が `/memo/` を含む、または basename が `workflow.db*` に一致する場合は block する。symlink が実在するのに解決できない場合も安全側で block する。hardlink は実体をたどれないため、`stat` によるリンク数（`nlink>1`）検査で best-effort に検知して block する。限界（正直化）: 相手側リンク名までは列挙できず、`stat` 不在環境では hardlink 検査を省略する（通常の doc は `nlink==1`・symlink でないため実運用の誤 block はほぼ起きない）。真の防御は symlink 実体解決・R2/R3 の role 軸・CI audit が多層で担う（R5 の `norm_path()` と同型の defense-in-depth）。
- **残存リスク（受容済み）**: `AGENT_ROLE` が `orchestrator` でも `scribe` でもない `unknown`（役割検知の失敗、または非標準ハーネス経由）の場合、carve-out 導入後は issue ドキュメントへの Edit/Write が新たに allow される（従来は R1 の役割非依存な防衛線により block されていた）。memo・workflow.db\* の保護は ROLE に関わらず維持されるため保護目的の中核は損なわれず、正規配備環境（`enforce on` 時 `AGENT_ROLE=orchestrator` が静的配線される）では本ケースは主に手動実行・テスト環境でのみ生じる限定的なリスクとして受容する。
- **templates carve-out（配布物テンプレートの編集手段統一・issue #103 対応）**: `.agent-skill-chain/runtime/templates/` は npm 配布物（追跡対象）でありながら runtime/ 名前空間の配下に置かれるため、R1 の一律 block と重なり「配布物テンプレートをどう編集するのか」が名前空間規約の**例外**として直感に反していた。templates/ 配下の各ファイル（`AGENTS_MERMAID_RULES.md`・`agents/scribe_claude.md`・`docs/**/README.md`・`github/scripts/*.sh` 等）のうち、basename が上記 doc allowlist に一致する最上位の一部のみが編集可で、残りは Bash 経由編集を強いられていた。**templates/ は memo（タイムスタンプ整合性）・workflow.db\*（書込整合性）のような保護目的を持たない**（配布物の真正性は Bash 経由でも Edit/Write 経由でも同じ）ため、R1 は `.agent-skill-chain/runtime/templates/` 配下（かつ `/memo/` を含まない）を **path-prefix ベースの carve-out** として一律に Edit/Write allow する。判定を basename allowlist ではなく path-prefix にする理由は、templates/ 配下に `README.md`・`00_README.md` 等の汎用 basename が多数あり、basename 方式だと消費者の他 issue フォルダの同名ファイルへ allow が過剰に波及するため（末尾スラッシュ `templates/` で `templates-evil/`・`mytemplates/` 等の別名ディレクトリを誤マッチさせない）。この carve-out も他 carve-out と同じ **no-op（フォールスルー）** 方式で R2 独立性を保ち、`/memo/` 除外で保護範囲を広げず、symlink/hardlink 実体すり替え耐性は doc 分岐と共通の `r1_carveout_guard()` ヘルパが担う。これにより「テンプレートは basename によらず Edit/Write できる」という単一規約に収れんし、名前空間表の例外説明に依存せず編集手段が自明になる。templates/ の**物理配置は変更しない**（runtime/ 名前空間外への再配置は参照経路 100 ファイル超・配布/検証/CI 経路への波及が大きく、規約側の carve-out で編集手段を統一する方向を採る）。
- **`..` パストラバーサル除外（C-7・構造欠陥の是正）**: 上記 templates carve-out（path-prefix 一致）・doc carve-out（basename 一致）はいずれも、realpath 解決前の**文字列一致**のみで carve-out 候補と判定する。対象パスに `..` が含まれる場合、`r1_carveout_guard()` の realpath 検査は memo/・workflow.db\* の実体すり替えのみを見るため、`..` で他 issue の任意ファイル（memo/workflow.db\* に該当しない一般ファイル）へ迂回すると、templates carve-out はそもそも basename 制限を持たないため意図しない allow を生みうる構造欠陥があった。是正として、対象パスが `..` を含み、かつ `.agent-skill-chain/runtime/` を参照する場合は、carve-out（.gitignore 厳密一致・templates・doc のいずれも）の判定に一切進ませず、既存の R1 通常 block へ落とす。carve-out（3 種いずれも）は正当な用途で `..` を含むパスを要求しないため、誤 block は発生しない（除外されたパスは carve-out 前の通常 block に落ちるだけで、従来の保護方針を変更しない）。

---

## enforcement 正本ファイルの保護（R1B・C-1・ドッグフーディング両立）

`.agent-skill-chain/source/enforcement/**`・`.agent-skill-chain/project/orchestrator-allowlist.txt`・`.agent-skill-chain/project/settings.enforce.json`・`.scribe-nonce` は、強制そのものの正本（PreToolUse.sh 自体・allowlist・scribe nonce 検証の基盤）である。これらを worker が自由に書き換えられると、上記の R1〜R9 のあらゆる保護が丸ごと無効化されうる（消費者環境における high 経路）。一方、本パッケージ自身の開発（ドッグフーディング）では worker が正規に enforcement を編集する必要があり、両立が要る。

- **設計**: R1（`.agent-skill-chain/runtime/` 配下・memo/workflow.db\* 保護）とは別の、独立した path 軸ガード（R1B）として実装する。ROLE に関わらず全 ROLE（worker 含む）で Edit/Write を block する点は R1 と同型だが、保護対象パス集合が異なるため独立させる（R2 の role 軸とも独立）。
- **識別方式（要ユーザー確認済み・採用）**: 消費者環境（`ASC_ENFORCEMENT_SELF_DEV` 未設定）では常時 hard block。本リポジトリの開発時のみ、env `ASC_ENFORCEMENT_SELF_DEV`（非空・`"0"` 以外）で解除する。解除時は既存 `ASC_WORKTREE_CLOSE_BYPASS`（`lib/worktree_record_guard.sh` の `_wt_record_bypass_warn`）と同型の `[enforcement:warn]` を stderr へ出し、監査痕跡を残す。
- **CI 補完（audit.sh #42）**: 対象差分が上記パスに触れる場合、workflow_log に対応する委譲・レビュー command の記録を要求する（詳細・残余リスクの受容根拠は [enforcement/README.md §enforcement 正本ファイル保護（C-1・R1B・ドッグフーディング両立）](README.md) を正本とし、本節では重複記載しない）。

---

## 系統D: hooks overlay 配備の設計思想（`.agent-skill-chain/project/` 優先）

**なぜファイル単位で固有が汎用を上書きするのか**: 本パッケージの正本 `.agent-skill-chain/source/enforcement/claude/` は全採用先に共通する汎用 hook を提供するが、採用先固有の事情（追加の禁止コマンド・固有のロール判定等）は `.agent-skill-chain/project/` 側でしか表現できない。ファイル単位のオーバーライド（同名ファイルが存在する場合のみ `.agent-skill-chain/project/enforcement/claude/` 側を優先して配備する）とすることで、採用先は汎用 hook 全体を複製・改変することなく、必要なファイルだけを差し替えられる。これは既存の「汎用/固有境界」パターン（コア＝抽象原則の必須最小集合、`.agent-skill-chain/project/`＝具体値）の**配備層への適用**であり、`MODEL_SELECTION.md`・`CONTEXT_EFFICIENCY.md` 等が採る「コアに具体値を持ち込まず `.agent-skill-chain/project/` に委ねる」思想と同型である。

**既存 overlay 配備思想との整合**: 本パッケージの setup は既に `.claude/skills/`・`.cursor/` 配下で「パッケージ所有分のみ更新・ユーザー独自分は保持」という衝突安全な配備（`sync_skills_selective`・`copy_owned_files`）を行っている。系統Dはこれと同じ「所有権の細分化による安全な重ね合わせ」という設計原則を hooks 配備（`enforcement/claude/` → `.claude/hooks/`）に適用したものであり、新規の配備パターンを導入するものではない。

**決定的規則（fail-open の余地なし）**: 系統A・C（[enforcement/README.md §強制の4層と現状](README.md#強制の-4-層と現状)）が fail-open（誤検知時はブロックしない）を既定とするのに対し、系統Dは「ファイル単位で `.agent-skill-chain/project/` が `.agent-skill-chain/source/` を上書きする」という決定的な配備規則であり、fail-open の余地はない。ただし両ディレクトリのいずれにも当該ファイルが無い場合は、[enforcement/README.md §配置するファイル一覧](README.md#配置するファイル一覧) の既定動作（展開先ディレクトリのみ作成）を踏襲する。

**本節の範囲**: 本節は抽象仕様（配備規則の設計思想）の確定までを扱う。overlay 配備処理の実装コード自体は本 issue の対象外であり、実コードの実装・配備は将来の別 issue に委ねる。

---

## 参照

- enforcement/README.md（配置一覧・矯正するもの・失敗条件→実装→強制レベル 対応表）
- boot/CORE.md（禁止事項・ログは書記のみ）
- agents/orchestrator.md（やらないこと・委譲強制）
- `.agent-skill-chain/runtime/templates/github/scripts/subagent-guard.sh`（CI guard 実体: 内部参照禁止・ログ frontmatter 禁止・`logs/` 廃止の 3 点を検査）
