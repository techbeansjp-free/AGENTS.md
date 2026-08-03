# SPEC: bugfix: PRマージ後もworktreeが自動クリーンアップされず放置され続ける

- Issue: `ISSUE-351`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/351-worktree-cleanup-after-merge`

## 前提・用語

- **Coordination Backend**：AGENTS.mdが定義する、調整状態の正本を保持する基盤。GitHubモード（正本はIssue・PR・branch・Check Run）とローカルモード（正本は`state.yaml`）の2種があり、いずれか一方のみを用いる。
- **PR/Integration Record**：対応Issueの統合状態を表す実体を指す本書内の呼称。GitHubモードでは当該Issueに対応するPull Requestを指す。ローカルモードでは`state.yaml`上に記録される当該Issueの統合状態（本書ではこれを「Integration Record」と呼ぶ）を指す。以下、本書で「PR/Integration Record」と書く箇所は、実行モードに応じてどちらか一方を指すものとする。
- **PR/Integration Recordの状態**：以下4種類のいずれかを取る。
  - `open`：未完了。GitHubモードではPRがopen。ローカルモードでは`state.yaml`上の統合状態が未完了。
  - `merged`/`closed`：完了済み。GitHubモードではPRがmerged、またはIssueがclosed。ローカルモードでは`state.yaml`上の統合状態が完了（マージ相当）、またはIssueがclosed。
  - `未作成`：対応Issueは特定できるが、対応するPR/Integration Recordがまだ存在しない（例：SPECワーカーがDraft PR作成前にworktreeを作成し最初のcheckpointをpushした直後）。これは判定不能ではなく決定可能な状態であり、cleanup対象（`merged`/`closed`）にも該当しない。
  - `判定不能`：Coordination Backendへの問い合わせ自体が失敗する（例：API到達不能、認証切れ）等の理由で、上記いずれの状態であるかを機械的に判定できない。

## 目的・背景

`.agent-skill-chain/scripts/cleanup.sh`（agent-skill-chain CLIの`cleanup`サブコマンドへの薄いラッパー）は、対応するPR/Integration Recordが完了済み（merged/closed）であり、writer lease不在・未commit/未push差分が無いことを検査した上でworktreeを削除する機能を持つ。しかし、この検査・削除を自動的に呼び出す仕組みは存在しない。PRがマージ（またはclose）された後、誰かが該当Issue IDを覚えていて手動で`cleanup`を実行しない限り、`.worktrees/`配下のディレクトリは無期限に放置され続ける。

**実害report 1**：別の消費者プロジェクトで、PRマージ後にworktreeディレクトリが放置される事象が2026-08-02に報告された。エージェントが手動でcleanup実行を提案・委譲する形で対応したが、根本的な自動化は存在しなかった。

**実害report 2**：本リポジトリ（`techbeansjp-free/AGENTS.md`）自身の`.worktrees/`配下を2026-08-02に調査したところ、対応PRが全てmerged/closed済みであるIssue 12件（#271・#277・#283・#286・#290・#298・#300・#303・#312・#316・#325・#331）が、マージ・クローズ後に長ければ数日〜1週間以上放置された状態で発見された。手動で`cleanup`を12回実行してようやく解消した。

worktreeはローカルファイルシステム上の実体（`git worktree`）であり、GitHub Actions（クラウドランナー）は各コントリビュータ・エージェントのローカル環境に一切アクセスできない。したがって、GitHub Actions側からの自動削除は原理的に不可能であり、解決はローカル側のツール・運用フローに限定される。

`bin/commands/doctor.js`は既に`listWorktrees`を用いた複数の検査（worktree命名規約、branch名規約、writer lease失効等）を`checks`配列へ追加していくパターンを持っており、同種の検査を追加する既存の構造上の余地がある。また、進行役のcapability定義（`.agent-skill-chain/config/roles.yaml`）には既に`worktree.lifecycle`と`pr.merge`の両方が含まれており、権限上はマージ直後にcleanupを実行することが既に可能である。

なお、`cleanup`はworktree削除・pruneのみを行い、対応するローカル/リモートブランチの削除機能を持たない。これは既存の意図的な設計判断（削除範囲をworktreeに限定し、ブランチ削除は別途の明示的操作とする）であり、それ自体は本Issueが解決する問題ではない。

由来：2026-08-02、別の消費者プロジェクトでの実害reportと、同日に本リポジトリ自身で12件の放置worktreeが実際に発見されたことの両方から起票。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。

### 要求

PRがmerged/closedになった後、対応するworktreeディレクトリが放置され続ける状態を検知・是正できるようにしたい。ブランチ削除の自動化は対象外とする。

### 要件

- `doctor`実行時、各worktreeについて対応するPR/Integration Recordの状態を確認し、merged/closedであるにもかかわらず対応するworktreeが存在する場合、それを検知して警告として出力すること。
- 上記警告には、cleanup対象となるworktreeを一意に特定できる識別子（Issue ID等）を含み、対象が複数件存在する場合は全件を列挙すること。
- 対応するPR/Integration Recordがまだopen（未merge・未close）であるworktreeは、cleanup対象警告に含めないこと。
- 対応するPR/Integration Recordの状態（merged/closed/open）をCoordination Backendから判定できない場合、当該worktreeをcleanup対象として断定的に警告しないこと。かつ、doctorの出力には当該worktreeが「判定不能」である旨を、cleanup対象警告とは区別可能な形で明示すること。Coordination Backendへの問い合わせが系統的に失敗し複数件のworktreeで判定不能となっている場合は、その劣化状態自体も出力上で判別可能であること（判定不能を無警告のまま埋没させない）。
- 進行役（人間またはエージェント）がマージ操作を行った際に、worktree放置を防ぐための標準手順が存在すること。手順は、進行役向け手順への明記、またはマージ操作への自動連鎖のいずれか（もしくは組み合わせ）でよく、具体的な採用方式は設計セグメントで判断する。ただし、いずれの方式を採用する場合も、下記AC-1〜AC-3が定めるdoctorによる機械的検知は常に並行して機能し続けることを必須とし、標準手順の文書化のみをもって機械的検知の代替としてはならない（実害report 2は文書化された手順への期待だけでは放置を防げなかった実例である）。
- 解決策はローカル環境（進行役のツール・運用フロー）のみで完結すること。GitHub Actions側での自動削除には依存しない。
- ブランチ（ローカル/リモート）の削除自動化は本Issueの要件に含まない。

### 受入条件（Acceptance Criteria）

#### AC-1: merged/closed済みPRに対応する残存worktreeをdoctorが検知し警告する

- Given: あるIssueについて、対応するPR/Integration Recordの状態が`merged`/`closed`（GitHubモードでは対応するPRがmerged、またはIssueがcloseされている。ローカルモードでは対応するIntegration Record（`state.yaml`）の統合状態が完了（マージ相当）またはIssueがcloseされている）であり、かつ対応するworktreeディレクトリが`.worktrees/`配下に残存している
- When: `doctor`コマンドを実行する
- Then: 出力に、当該worktreeがcleanup対象である旨の警告と、対象を特定できる識別子（Issue ID等）が含まれる。対象が複数件ある場合は全件が列挙される
- 検証方法見込み: `hybrid`（自動テストに加え、意図的に放置状態を模した実環境で本リポジトリ自身に対し`doctor`を実行し、期待通りの警告が出力されることを実測確認する）

#### AC-2: openなPRに対応するworktreeは誤って警告されない

- Given: あるIssueについて、対応するPR/Integration Recordの状態が`open`（GitHubモードでは対応するPRがまだopen（未merge・未close）。ローカルモードでは対応するIntegration Recordの統合状態が未完了）であり、対応するworktreeが存在する
- When: `doctor`コマンドを実行する
- Then: 当該worktreeはAC-1の警告対象一覧に含まれない
- 検証方法見込み: `automated`

#### AC-3: PR/Integration Recordの状態を判定できない場合は誤って警告せず、判定不能である旨を明示する

- Given: あるworktreeについて、対応するPR/Integration Recordの状態（`merged`/`closed`/`open`）をCoordination Backendへの問い合わせ自体の失敗（例：API到達不能、認証切れ）により機械的に判定できない（「対応するPR/Integration Recordがまだ`未作成`である」という決定可能な状態は本ACの対象外であり、`未作成`と`判定不能`はdoctorの出力上で区別される）
- When: `doctor`コマンドを実行する
- Then: 当該worktreeはcleanup対象として断定的に警告されない。かつ、doctorの出力には、当該worktreeが「判定不能」である旨と、対象を特定できる識別子（Issue ID等）が、AC-1のcleanup対象警告とは区別可能な形で明示される。判定不能が複数件のworktreeにわたって発生している場合（Coordination Backendへの問い合わせが系統的に失敗している状態を示唆する）、その旨も出力上で判別可能である
- 検証方法見込み: `automated`

#### AC-4: マージ操作時にworktree放置を防ぐ標準手順が存在する

- Given: 進行役が、writer lease不在・未commit/未push差分無しの条件を満たすIssueのPR/Integration Recordをマージする（GitHubモードでは当該IssueのPRをマージする。ローカルモードでは対応するIntegration Record（`state.yaml`）を完了状態（マージ相当）に遷移させる操作を行う）
- When: マージ操作が完了する
- Then: 当該Issueのworktreeに対しcleanupが実行されることにより、放置状態が発生しない。実現手段は(a)マージ操作への自動連鎖、または(b)進行役向け手順への明記のいずれか（もしくは組み合わせ）でよいが、(b)を選ぶ場合であっても、AC-1〜AC-3が定めるdoctorによる機械的検知は当該手順の有無にかかわらず常に並行して機能し続けることを必須条件とする。標準手順の文書化のみをもって機械的検知の代替とすることは許容しない——放置は最終的にdoctor実行時に必ず検知されることが、唯一の実効的な安全網である
- 検証方法見込み: `manual`（標準手順の文書内容、または自動連鎖の実装がAGENTS.mdもしくは進行役向け手順の記述と整合していることに加え、AC-1〜AC-3のdoctor機械的検知が無効化・迂回されていないことをレビューで確認する）

## スコープ外

- ローカル/リモートブランチの削除自動化（既存の意図的な設計判断であり、本Issueのスコープ外）。
- GitHub Actions（クラウドランナー）側からのworktree自動削除（ローカルファイルシステムへ到達不能なため原理的に不可能）。
- (2)進行役手順への明記／(3)マージ操作CLIとの自動連鎖のうち、どちらを採用するか、または両方組み合わせるかの具体的決定（設計セグメントで判断する）。
- `cleanup`自体の削除条件判定ロジック（writer lease不在・未commit/未push差分無し等）の変更（既存の`cleanup`の挙動を前提とし、本Issueはそれを「いつ・誰が呼び出すか」の問題を扱う）。
- 消費者プロジェクト側のcleanup運用・ツールの変更（本Issueはagent-skill-chain本体の機能追加を扱う）。

## 未決事項

- 要件で述べた「標準手順」の具体的な実現方式（doctorへの検査追加は必須、それに加えて進行役手順への明記のみとするか、マージCLIとの自動連鎖まで行うかの判断）は設計セグメントで確定する。
- AC-3の「判定不能」を検出するための具体的な仕組み（Coordination Backend側の情報不足の識別方法）は設計セグメントで確定する。
