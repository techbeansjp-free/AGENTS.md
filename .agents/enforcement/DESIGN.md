# enforcement DESIGN — 強制の4層と逸脱不能

強制の目的は **「AI に正しいことを理解させる」** ではなく **「AI が勝手に逸脱できないようにする」** こと。中心は、良い説明や長いプロンプトではなく、**経路の限定・違反操作の停止・正しい I/O のみを通す・完了条件を証跡で縛る**。

---

## 強制の4層

| 層 | 担い手 | 役割 | 例 |
|----|--------|------|-----|
| **1. 物理強制** | hooks / setup / CI | **操作を止める**。AI の意思に関係なくブロックする。 | フェーズ飛ばしの Write 拒否、ROLE: 付き Task の形式違反拒否、scribe 未実行の次 Task 拒否、許可外へのログ書き込み拒否、CI で CONTRACT 違反で落とす |
| **2. 契約強制** | CORE / LOAD_POLICY / command / skill I/O | **従うべき形を固定する**。構造による強制。 | command は skill chain のみ、skill は Input/Process/Output、orchestrator は command 選択のみ、auditor は証跡確認のみ、scribe は記録のみ |
| **3. 配備強制** | setup | **導入時点で強制を埋め込む**。プロジェクトを開いた瞬間に強制が効く状態にする。 | .agents/ 配置、.claude/hooks/ 配置、.cursor/rules/ 配置、CI 監査配置 |
| **4. 完了強制** | DoD / 証跡 / review / audit | **完了条件で縛る**。 | 完了は「やった」ではなく証跡で判定、04_review を経ないと close しない。証跡は本則 workflow.db、memo は過渡的・例外運用のみ（scribe/CONTRACT 参照）。 |

**現状**: PreToolUse は **プラットフォームがツール名・対象パス・コマンド・ロールをフックに渡す場合**、exit 2（block）で物理的拒否する（.workflow 直接編集・許可外 Shell・sqlite3 直接・orchestrator の Write/Edit）。渡されない場合は案内のみ exit 0 とし、事後検知は audit.sh が担う。**完全物理強制ではない。** runtime で止められる範囲と CI で補完する範囲を分けて理解すること。**runtime の reject は、取得可能なメタデータ範囲で行い、それ以外は CI 監査で補完する。** **物理強制の到達範囲は、Claude Hook（PreToolUse）の提供情報（ツール名・対象パス・コマンド・ロール）に依存する。** **改善の方向**: 禁止リストより許可リスト（orchestrator は command 選択・委譲・結果集約のみ許可し、ファイル更新は許さない）。物理強制の最小単位を ROLE 付き委譲・workflow.db 記録・04_review 存在・verify-and-close 痕跡に寄せる。

---

## 強制の本体・実行・内容

- **強制の正本**: `.agents/enforcement/` に置く。本 README と DESIGN.md、各 claude/ cursor/ ci/ のファイル。
- **強制の実行**: setup が `.claude/`、`.cursor/`、CI に展開する。配備後はプロジェクトを開いた時点で強制が有効になる。
- **強制の内容**:  
  - hooks がツール実行時に block（経路違反・形式違反・書記未実行の次実行など）。  
  - CI がマージ前に reject（CONTRACT 違反・証跡欠落）。  
  - command / skill / agent の責務分離で逸脱余地を減らす。  
  - DoD と証跡で「完了したつもり」を認めない。

規約で教育するのではなく、**構造で逸脱不能にする**。

---

## Orchestrator 逸脱の検知（仕様）

orchestrator が「実作業をしない」「run_command 経由のみ」から逸脱した場合に、検知・拒否する観点を以下に定義する。実装は hooks / CI / guard スクリプトで行い、本節は「何を検知するか」の仕様とする。

| 検知対象 | 期待する I/O・経路 | 拒否条件（reject する場合） |
|----------|-------------------|-----------------------------|
| **メインが直接生成した成果物** | 00/01/02/03/04 や .workflow/**/memo/*.md は、run_command で起動したサブ（worker）が出力する。 | サブ起動の証跡なしに 00/01/02/03/04 や .workflow/**/logs/*.md がメインセッションから生成されたと判断できる場合。 |
| **書記未委譲** | ログ・証跡は書記（write-workflow-log）のみが記録する。証跡は本則 workflow.db、memo は過渡的・例外のみ。orchestrator は verify-and-close 等で書記を委譲する。 | 書記 capability を経ずに workflow.db や CONTRACT 準拠ログへ書き込んだ場合。書記未実行のまま次 Task に進もうとした場合。 |
| **verify-and-close 未実行** | 実装・変更後は必ず verify-and-close を経てから close する。 | 実装 phase の成果物があるのに 04_review 未作成・未更新のまま close 相当の遷移をしようとした場合。 |
| **timestamp 付き memo の自由生成** | `.workflow/{issue}/memo/` 以下の `YYYYMMDD_HHMMSS_*.md` は、write-workflow-log または `.agents/scripts/new-workflow-memo.sh` 等、**システム時計からプレフィックスを生成する経路のみ**で作成される。 | メインまたは worker が、自由入力のファイル名で `.workflow/{issue}/memo/` 以下に `YYYYMMDD_HHMMSS_*.md` を直接 Write/Edit しようとした場合、または CI でプレフィックスとファイル mtime が大きく乖離している（推測・固定値と思われる）場合。 |

上記を物理強制（hooks）や CI で実装する際は、enforcement/README.md および既存の subagent-guard（実体: `.workflow/templates/github/scripts/subagent-guard.sh`）等と整合をとること。subagent-guard が検査するのは内部参照禁止（#6 相当）・ログ frontmatter 禁止・`logs/` 廃止の 3 点のみで、#22–#24 は実装しない。timestamp 付き memo については、hooks で `.workflow/{issue}/memo/` への自由な Write/Edit を抑止し、CI（audit.sh）でプレフィックス形式および実時間との乖離を検査する。

---

## 参照

- enforcement/README.md（配置一覧・矯正するもの・失敗条件→実装→強制レベル 対応表）
- boot/CORE.md（禁止事項・ログは書記のみ）
- agents/orchestrator.md（やらないこと・委譲強制）
- `.workflow/templates/github/scripts/subagent-guard.sh`（CI guard 実体: 内部参照禁止・ログ frontmatter 禁止・`logs/` 廃止の 3 点を検査）
