<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: ADR-0023を実装し、常時規律モデルとは別にスキル経由のオンデマンド軽量プロファイルを提供する

- Issue: `ISSUE-503`
- 作成者: `spec_worker`
- 対象ブランチ: `feature/503-skill-mode-adr0023`

## 目的・背景

`agent-skill-chain`（本npmパッケージ・CLI）は現在、`init` により `CLAUDE.md` から `AGENTS.md` を常時import する構成のみを提供する。これは複数人・複数Issue並行で監査証跡・ゲート再通過・writer leaseの実利を得る「常時開発型」利用者には適する一方、開発頻度が低く調査・小修正・文書更新が中心の「間欠開発型」利用者にとっては、Issue起票からゲート4通過までの手続きが作業本体より重くなり、導入見送りまたは未文書化の手動改変（`CLAUDE.md` のimportを手で削る等）という逃げ道へ流れる原因になっている。

Issue #428（調査専用）の成果である `docs/adr/ADR-0023-agent-skill-chain-as-skill-feasibility.md`（`status: proposed`）は、Claude Codeスキル機構（`SKILL.md`、Discovery→Activation→Executionの段階的ロード）を用いれば、確定的強制（PreToolUse hook・GitHub branch ruleset）と機械検査不能な規範知識（不変条件・4セグメント運用手順等）とを分離でき、後者のうち「手続き」に該当する部分はオンデマンドのスキルへ移せることを、Claude Code公式一次情報に基づき整理した。ADR-0023は実装を承認するものではなく、「対象範囲・受け入れ基準・移行手順を持つIssueを別途起票する必要がある」と明記していたため、本Issueがそれにあたる。

本SPECは、ADR-0023のDecision（(b)現行モデル維持＋スキル版並行提供、(c)規範層の一部スキル化によるハイブリッド化、の合成）を実装可能な受入条件へ落とし込む。ADR-0023が「本ADRでは確定させない」とした未決事項のうち、規範層の線引きと軽量プロファイルでのI2・I3の扱いは本SPECで実装可能な範囲まで決定し、既存導入済みプロジェクトへの移行手順は対象外へ切り出す（詳細は「スコープ外」参照）。

## 要求 → 要件 → 受入条件

### 要求

- ADR-0023 Decisionの1〜5を実装し、開発をあまりしない利用者が、強制層（`setup github`・`enforce on`）と常時規範（`CLAUDE.md` からの `AGENTS.md` 常時import）を伴わずに、本パッケージの手続きを必要時にスキルとして呼び出せるようにする。
- 既存の常時規律モデル（`init` の既定動作）は変更・回帰させない。

### 要件

- `AGENTS.md` 本体に残す内容を、不変条件I1〜I8・4セグメントと4ゲートの対応・Coordination Backendの選択・writer leaseの基本規則・用語の正本という「事実と常時規則」に限定し、150行の文書量上限（`.agent-skill-chain/ci/verify-doc-length.sh`）内へ収める。
- ゲート審査の進め方・worktree操作手順・ADRライフサイクルの操作手順・成果物テンプレートの記入手順等の「手続き」を、配布元の正本アセット配下（`.agent-skill-chain/templates/claude/skills/` 等）に置く複数の `SKILL.md`（セグメント・役割対応、単一の巨大スキルにしない）へ切り出す。各 `SKILL.md` は自己完結性の原則（AGENTS.md §成果物の自己完結性）に従い、参照だけで意味を委譲しない。
- `init` に軽量プロファイルを選択できるオプションを追加する。選択時は次を満たす: (i) `CLAUDE.md` へ `@AGENTS.md` の常時importを行わない、(ii) `.claude/skills/` 配下へ上記スキル群を配置する、(iii) `coordination.backend: local` を既定にする、(iv) `setup github`・`enforce on` に相当する強制層の適用を実行しない。
- 軽量プロファイルを選択した場合、逸脱の機械的阻止が無いことを利用者へ明示するメッセージを `init` の標準出力へ表示する。
- プロファイル未指定時の `init` の既定動作（ファイル配置内容・`CLAUDE.md` の常時import・既存の衝突時非破壊エラー方針）は変更しない。
- 軽量プロファイルにおける不変条件I2（セグメントゲート）・I3（耐久性）の扱いを、機械的に判定可能な形で文書化する（詳細は AC-6）。

### 受入条件（Acceptance Criteria）

#### AC-1: AGENTS.md本体が事実と常時規則のみへ縮小され文書量上限を満たす

- Given: 本Issueの変更を適用したリポジトリの `AGENTS.md`
- When: `.agent-skill-chain/ci/verify-doc-length.sh` を実行する
- Then: `AGENTS.md` が150行以内であり、かつ本文が不変条件I1〜I8の表・4セグメントと4ゲートの対応表・Coordination Backendの選択・writer leaseの基本規則（lease種別・WIP上限等の恒久値）・用語の正本参照のみで構成され、ゲート審査の進め方・worktree操作手順・ADRライフサイクル操作手順・成果物テンプレート記入手順といった手続き的記述を含まない
- 検証方法見込み: `automated`

#### AC-2: 手続きが複数のSKILL.mdへセグメント・役割粒度で切り出される

- Given: 配布元の正本アセット配下（`.agent-skill-chain/templates/claude/skills/` 等）
- When: リポジトリを走査する
- Then: Issue起票とworktree開始・セグメント作業・ゲート審査・PR作成とマージ・後片付けのそれぞれに対応する `SKILL.md`（YAMLフロントマター＋本文）が存在し、各ファイルが単独で目的・対象範囲・前提・入力・出力・手順・完了条件を記載する自己完結した内容になっており、`AGENTS.md` 側の該当手続き記述と重複しない（`AGENTS.md` 側は削除済みであること）
- 検証方法見込み: `automated`

#### AC-3: initに軽量プロファイルの選択肢が追加される

- Given: 未導入のリポジトリ
- When: `init` を軽量プロファイル指定で実行する
- Then: 生成される `CLAUDE.md` に `@AGENTS.md` の常時import記述が含まれず、`.claude/skills/` 配下にAC-2のスキル群が複製され、生成される `.agent-skill-chain/config/agent-skill-chain.yaml` の `coordination.backend` が `local` になり、`setup github` に相当するGitHub API呼び出し（ruleset・label適用）と `enforce on` に相当するhook配線が実行されない
- 検証方法見込み: `automated`

#### AC-4: 軽量プロファイル選択時に機械的阻止が無いことが明示される

- Given: 軽量プロファイル指定での `init` 実行
- When: コマンドが正常終了する
- Then: 標準出力に、強制層（hook・branch ruleset）が導入されておらず規律からの逸脱を機械的に阻止する手段が無い旨を明示する日本語メッセージが含まれる
- 検証方法見込み: `automated`

#### AC-5: 既定のinit動作が回帰しない

- Given: プロファイル未指定（既定）での `init` 実行
- When: 実行結果を、本Issue適用前の既定動作と比較する
- Then: 配置されるファイル一覧・`CLAUDE.md` の `@AGENTS.md` 常時import・既存ファイルとの内容衝突時に非破壊のまま日本語理由付きエラーで停止する挙動のいずれも変更されておらず、既存の `init` に関する自動テストが全て回帰なく成功する
- 検証方法見込み: `automated`

#### AC-6: 軽量プロファイルにおけるI2・I3の扱いが機械的に判定可能な形で文書化される

- Given: 軽量プロファイルで導入されたリポジトリ（`coordination.backend: local`、強制層未導入）
- When: 当該リポジトリの `AGENTS.md`（またはlint対象文書）を確認する
- Then: 不変条件I2・I3が軽量プロファイルではガイドライン（自動強制なし、進行役／利用者の任意判断）として扱われることが、既存の不変条件表の該当セルへの最小限の追記として明記されており、`.agent-skill-chain/ci/verify-doc-length.sh` の行数上限を超えない
- 検証方法見込み: `manual`

#### AC-7: スキル一覧の説明文の文脈予算占有率を実測する手順が用意される

- Given: AC-2で作成したスキル群
- When: 各 `SKILL.md` の `description` と `when_to_use`（存在する場合）の合算文字数を集計する手順を実行する
- Then: 集計結果（スキルごとの文字数・合計・想定モデル文脈長1%に対する比率）が記録され、比率超過時にどのスキルの説明を削るべきかを機械的に特定できる
- 検証方法見込み: `manual`

#### AC-8: 軽量プロファイル追加後もinitの衝突時非破壊方針が維持される

- Given: 対象ディレクトリに軽量プロファイル導入対象ファイル（`.claude/skills/` 配下等）と内容が衝突する既存ファイルがある状態
- When: 軽量プロファイル指定で `init` を実行する
- Then: 既存ファイルを上書きせず、衝突ファイルパスと理由を含む日本語エラーメッセージとともに終了コード1以上で停止する
- 検証方法見込み: `automated`

## スコープ外

- プラグイン化・marketplace公開（ADR-0023 Decision 5が後続判断としている事項）。
- 既存導入済みプロジェクトを軽量プロファイルへ移行する手順、および `upgrade` コマンドでのプロファイル変更対応。本Issueは新規導入時の軽量プロファイル選択のみを対象とする。
- 不変条件I2・I3の恒久的なガイドライン降格の是非そのものの一般的な議論、および `AGENTS.md` 本体の不変条件表の大幅な改定。本Issueで行うのはAC-6が定める軽量プロファイル文脈での最小限の追記のみとする。
- スキルフロントマターへのhook同梱によるプラグイン経由の強制層再統合（ADR-0023調査1(g)が示す将来オプション、後続判断）。
- Cursor等、現時点でCLI検証（capability probe）が未実装のadapterへのスキル配布対応拡張。
- GitHubモードのI2に対する自動CI強制の新規導入（AGENTS.md I2は現状ガイドラインのままであり、本Issueはこれを変更しない）。
