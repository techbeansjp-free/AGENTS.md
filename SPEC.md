<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — repoRoot() の worktree 分裂バグ解消・launch_worker 認証チェックの誤検知解消

- Issue: `ISSUE-185`
- 作成者: `claude`
- 対象ブランチ: `feature/185-reporoot-worktree-split`

## 目的・背景

このリポジトリ（`techbeansjp-free/AGENTS.md`）が目指す「完全自走（人間が介在しなくても、真に危険な場合以外は止まらない）」の end-to-end 実証は、先行 Issue #180・#183 の独立検証でいずれも **未達成** で確定した。Issue #183 の実機検証により、`launch_worker` の権限モード修正（責務スコープ allowlist 化・`claude` CLI の `--allowed-tools`）自体は実機で有効であり、本物の `claude` CLI（headless）がワーカーの実質作業——`SPEC.md` 作成・`git commit`・`git push`・`report status completed`——を人間介在なく完走できることが確認された。しかし `launch_worker` オーケストレーション層は依然として完走を正しく検知できず `blocked` へフェイルセーフした。その根本原因は権限モードとは独立した以下 2 つの新規バグであると、Issue #183 の独立検証（VALIDATION.md、`target_sha=7bad757`）で確定した。本 Issue #185 はこの 2 バグを恒久解消し、Issue #180・#183 で持ち越された「`launch_worker` 自身の 1 セグメント完走検知」を改めて実機で成立させることを目的とする。

根本原因（成果物の自己完結性の原則に従い、外部参照に意味を委譲せず本文に明記する）：

1. **`repoRoot()` の worktree 分裂バグ（最重要）**: `src/lib/paths.ts` の `repoRoot()` は、起点ディレクトリから上へ辿り `fs.existsSync(path.join(dir, '.git'))` が真となる最初の祖先ディレクトリを対象リポジトリのルートとして返す。しかし git worktree では各 worktree のルートが `.git` を「ファイル」として持つ（内容は `gitdir: <メインリポジトリの .git/worktrees/<name> への絶対パス>` というポインタ）。`fs.existsSync` はファイルとディレクトリを区別しないため、worktree 内から `repoRoot()` を呼ぶと、メインの作業ツリー（`issue start` 等を実行した場所）ではなく **その worktree 自身のパス** が返る。coordination 状態（`issues/<n>/.agent-skill-chain/{state,lease,integration}.yaml`・`reviews/<gate>.yaml`・`reports/<segment>.yaml`）はすべてこの `repoRoot()` 基準の相対パスへ書き込まれる（`src/lib/local-state.ts` の各パス関数が `root` を基点にする）ため、ワーカーが（正しく）自分の worktree 内から `report status`・`checkpoint`・`lease acquire` 等を実行すると、それらの状態ファイルは **worktree 内へ分裂して書き込まれ**、メインの作業ツリー側で走る `launch_worker` の完了確認（`report latest` の直近レコード照合）からは見えない。実機で実際に再現：ワーカーは `SPEC.md` 作成・`git commit`・`git push`・`report status completed` まですべて正しく実行したにもかかわらず、`launch_worker` は「worker report がありません／完了を確認できません」と誤検知し `blocked`（`report_status blocked`／`human_escalation_requested`・非0非3 return）へ倒れた。これは安全機構が実ブロッカーに対して正しく安全側へ倒れた結果ではなく、パス解決の実装バグによる誤検知（false negative）である。

2. **認証チェックの誤検知**: `.agent-skill-chain/adapters/claude.sh` の `launch_worker`（および `launch_gate_reviewer`）の認証チェックは、`ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` という 2 つの環境変数の非空チェックのみで認証可否を判定する（両方未設定なら即フェイルセーフ）。しかし `claude` CLI 自体は OS キーチェーン等のセッション認証でも動作するため、これらの環境変数が未設定でも実際には `claude -p` が正常に応答する環境が存在する（実機確認済み：`claude -p "1+1"` が env 無しで正しく応答）。この場合 `launch_worker` は実際には動作可能な環境を「認証欠如」と誤判定し、本物の CLI 起動を試みる前に `blocked`／`human_required` へ倒れる。Issue #183 の実機検証時は、このチェックを迂回するためダミー値を設定する必要があった。

## 用語

- **`repoRoot()`**: `src/lib/paths.ts` の関数。起点ディレクトリ（既定は `process.cwd()`）から祖先方向へ辿り、`.git` エントリを持つ最初のディレクトリを「対象リポジトリのルート」として返す。ローカルバックエンドの coordination 状態・成果物パスはすべてこの返り値を基点に解決される。
- **coordination 状態ファイル**: ローカルバックエンドで Issue 毎の調整状態を保持する Git 管理下ファイル群。`issues/<n>/.agent-skill-chain/` 配下の `state.yaml`（正本）・`lease.yaml`・`integration.yaml`・`reviews/<gate>.yaml`・`reports/<segment>.yaml`（`src/lib/local-state.ts` が配置規約を定義）。本 Issue はこの **配置規約自体は変更せず**、基点となる `repoRoot()` の解決だけを修正する。
- **git worktree の `.git` ファイル**: `git worktree add` で作られた作業ツリーのルート直下に置かれる通常ファイル（ディレクトリではない）。内容は `gitdir: <path>` の 1 行で、メインリポジトリの `.git/worktrees/<name>` を指すポインタ。通常リポジトリのルートでは `.git` はディレクトリである。
- **`--git-common-dir`（`git rev-parse --git-common-dir`）**: worktree 内から呼んでもメインの作業ツリー内から呼んでも、共通の `.git` ディレクトリ（メインリポジトリの `.git`）の絶対パスを返す git ネイティブ判定。本 Issue が返すべき「一貫した基準ディレクトリ」を導出するための候補手段（このディレクトリの親がメインの作業ツリールートに相当する。ただし外部 worktree 配置や bare 構成での挙動差は DESIGN.md で確定する）。
- **`launch_worker`**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数。lease 取得 → `segment start`（role_contract 取得）→ 認証チェック → ワーカー起動 → 完了確認（`report latest` 直近レコードの `status`・`target_sha` を push 済み HEAD と突合）→ lease 解放、の順で 1 セグメントを機械的に完走させる。完了確認で不一致なら `_fail_blocked`（`report_status blocked`／`human_escalation_requested`・lease 解放・非0非3 return）へ倒れる。
- **`launch_gate_reviewer`**: `.agent-skill-chain/adapters/claude.sh` の read-only ゲートレビュア起動関数。`launch_worker` と同一形式の認証チェック（env 非空のみ）を持つため、認証チェックの誤検知は本関数にも共通して存在する。
- **認証チェックの誤検知（false negative）**: 実際には `claude` CLI が認証済みで動作可能（キーチェーン等のセッション認証）であるにもかかわらず、`ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` の env 非空のみを見る現行チェックが「認証欠如」と判定し、フェイルセーフへ倒すこと。
- **実疎通確認（authentication probe）**: env 認証情報が無い場合に、`claude` コマンドが実際に認証済みで応答可能かを軽量に確認する手段（例: 短い `claude -p` プローブ、または `claude` 側が提供する認証状態確認手段があればそれ）。既存の env 非空チェックを完全に置き換えるのではなく、env が無い場合のフォールバックとして追加する。
- **人間介在なしの完了**: `launch_worker` が起動したワーカーが、人間の追加入力・手動代行なしに `report_status completed`（`target_sha` = push 済み HEAD 一致）を記録し、`launch_worker` が終了コード 0 で lease を解放した状態。本 Issue ではこれを `launch_worker` 自身が正しく検知することまでを含む。
- **統合ブランチ**: 本 Issue 群の base である `chore/162-agent-skill-chain-bootstrap`。`main` への最終マージ前に各 Issue の PR を集約するブランチ。本 Issue の base branch でもある。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #185 本文（背景・対象範囲 1〜3・成功基準）に基づく要求：

- `repoRoot()` を、git worktree 内から呼ばれた場合でもメインの作業ツリーから呼ばれた場合でも **一貫した同一の基準ディレクトリ** を返すよう修正したい。これにより、ワーカーが worktree 内から書いた coordination 状態ファイルと、メインの作業ツリー側の `launch_worker` が読む coordination 状態ファイルが、同一 Issue に対して同一の実体を指すようにしたい。coordination 状態の配置規約（`issues/<n>/.agent-skill-chain/`）自体は変更せず、基準ディレクトリの解決だけを直したい。
- `launch_worker`（および同一チェックを持つ `launch_gate_reviewer`）の認証チェックを、環境変数の有無だけでなく、実際に `claude` コマンドが認証済みかを確認する方式へ見直したい。env 認証情報が有る場合の高速判定は維持し、env が無い場合のフォールバックとして実疎通確認を追加することで、キーチェーン等のセッション認証で動作する環境を「認証欠如」と誤判定しないようにしたい。ただし、真に認証が欠如している（env も無くプローブも失敗する）場合には、引き続きフェイルセーフが正しく発火する（regression なし）ようにしたい。
- 上記 2 修正後、`worker.adapter: claude` 設定下・本物の `claude` CLI（headless）で `launch_worker` が 1 セグメント以上を人間介在なく、起動から完了検知まで一気通貫で成功すること（`launch_worker` 自身の終了コード 0・`report latest` の status=completed・`target_sha` 一致・lease 解放）を実機で裏付けたい。
- 上記の全変更後も、既存テストスイート（`chore/162-agent-skill-chain-bootstrap` 統合ブランチ上の全件）が引き続き全て pass する状態を維持したい。

### 要件

- **要件1（`repoRoot()` の worktree 一貫化）**: `repoRoot()` を、git worktree 内から呼ばれた場合でもメインの作業ツリーから呼ばれた場合でも、同一リポジトリに対して同一の基準ディレクトリを返すよう修正する。実現方式を要件レベルの候補として提示し、最終確定は DESIGN.md に委ねる：
  - 候補A（`.git` ファイル判定＋ポインタ解決）: `path.join(dir, '.git')` が **ディレクトリ** の場合のみ従来どおりそのディレクトリをルートとし、`.git` が **ファイル**（worktree の gitdir ポインタ）の場合はその内容（`gitdir: <path>`）を解決してメインの作業ツリーを特定する。`fs.existsSync` をファイル/ディレクトリ非区別のまま用いない。
  - 候補B（git ネイティブ判定）: `git rev-parse --git-common-dir`（または `--show-toplevel` と `--git-common-dir` の組み合わせ）で共通 `.git` ディレクトリを求め、そこからメインの作業ツリールートを導出する。git バイナリへの依存が増える点、bare／外部 worktree 配置での挙動差を DESIGN.md で確認することを条件とする。
  いずれの候補でも、(i) 通常リポジトリ（`.git` がディレクトリ）での従来返り値が変わらないこと（regression なし）、(ii) worktree 内から呼んでもメイン作業ツリールートと同一値を返すこと、(iii) `.git` が見つからない場合は従来どおり明示エラーで停止すること、を満たす。coordination 状態・成果物の配置規約（`src/lib/local-state.ts` の相対パス構成）自体は変更しない。
- **要件2（coordination 状態の worktree 非分裂）**: 要件1 の修正により、`src/lib/local-state.ts` の各パス関数（`stateFilePath`・`leaseFilePath`・`integrationFilePath`・`reviewFilePath`・`reportFilePath`）を `repoRoot()` 基点で解決したとき、worktree 内から解決した絶対パスとメインの作業ツリーから解決した絶対パスが、同一 Issue・同一種別について一致するようにする。すなわち worktree 内で `report status` 等を実行して書いた状態ファイルを、メイン作業ツリー側の処理が同一実体として読めるようにする。
- **要件3（認証チェックの実疎通フォールバック追加）**: `.agent-skill-chain/adapters/claude.sh` の `launch_worker` および `launch_gate_reviewer` の認証チェックを、次の 2 段構成へ見直す：(a) `ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` のいずれかが非空なら従来どおり認証ありとみなす（高速パス・実値は非ログ）、(b) いずれの env も無い場合は即フェイルセーフせず、`claude` コマンドが実際に認証済みかを軽量に確認する実疎通確認（フォールバック）を行い、成功時は認証ありとみなす。既存の env 非空チェックを完全に置換せず、フォールバックとして追加する。実疎通確認の具体手段（プローブコマンド・タイムアウト・判定条件）は DESIGN.md で確定してよいが、本 SPEC は「env 認証情報が無くても、実際に認証済みなら認証欠如と判定しない」という振る舞い要件を定める。
- **要件4（真の認証欠如検知の維持・regression なし）**: 要件3 の変更後も、env 認証情報が無く、かつ実疎通確認も失敗する（`claude` が認証されていない・CLI 不在等）場合には、`launch_worker` は `_fail_blocked`（`report_status blocked`／`human_escalation_requested`・lease 解放・非0非3 return）、`launch_gate_reviewer` は `_fail_safe`（`final=human_required`・非0非3 return）へ引き続き正しく倒れる。実疎通確認は自動テストで検証可能なよう、モック／上書き可能な境界（例: 認証プローブを `WORKER_CMD` 同様に env で差し替え可能にする等）を設けることを条件とする。CLI 不在（`WORKER_CMD` 未設定かつ `claude` コマンド不在）のフェイルセーフも維持する。
- **要件5（launch_worker の実機完走・自己検知）**: 要件1〜4 の修正を反映した状態で、`worker.adapter: claude` 設定下・本物の `claude` CLI（headless・認証済み・CLI 利用可）・ローカルバックエンドの使い捨て issue で `launch_worker <issue_id> <segment>` を 1 セグメント以上起動し、人間の追加入力・手動代行なしに (a) ワーカーが実質作業を完走し、かつ (b) `launch_worker` 自身がそれを正しく検知して終了コード 0 で返ることを実測する。判定は、`launch_worker` の終了コード 0・`report latest <issue_id> <segment>` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致・lease 解放、で行う。実行ログ・report-status 記録を証跡として残す。
- **要件6（既存テストスイートの維持）**: 本 Issue の全変更（`repoRoot()` の修正・認証チェックのフォールバック追加・追加テスト）を反映した状態で、リポジトリのテストスイート全体（`npm test` 相当）が全て pass する（regression なし）。ビルド（`npm run build`／tsc）も終了コード 0 であること。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える。

#### AC-1: repoRoot() が worktree 内から呼ばれてもメイン作業ツリーと同一の基準ディレクトリを返す

- Given: 通常リポジトリ（`.git` がディレクトリ）と、そこに `git worktree add` で作成した worktree（ルートに `gitdir:` ポインタの `.git` ファイルを持つ）
- When: `repoRoot()` をメイン作業ツリー内の起点と worktree 内の起点それぞれから呼ぶ
- Then: 両者が同一リポジトリに対して同一の基準ディレクトリ（メイン作業ツリールート）を返すことを実測確認する（本 Issue 修正前は worktree 内からの呼び出しが worktree 自身のパスを返していた）
- 検証方法見込み: `automated`（一時リポジトリ＋worktree を作り `repoRoot()` の返り値を突合するユニット／統合テスト）

#### AC-2: 通常リポジトリでの repoRoot() 返り値が従来どおりで regression がない

- Given: git worktree ではない通常のリポジトリ（`.git` がディレクトリ）
- When: リポジトリルートおよびその配下のサブディレクトリを起点に `repoRoot()` を呼ぶ。あわせて `.git` が全く見つからない起点でも呼ぶ
- Then: 通常リポジトリでは従来どおりリポジトリルートを返し、`.git` が見つからない場合は従来どおり明示エラー（`.git が見つかりません`）で停止することを実測確認する（worktree 対応の追加により通常経路が変化していないこと）
- 検証方法見込み: `automated`

#### AC-3: 同一 issue の coordination 状態ファイルが worktree とメイン作業ツリーで同一実体を指す

- Given: ローカルバックエンドで、あるリポジトリとその worktree
- When: worktree 内から `report status`（および `lease acquire`／`checkpoint` 相当）を実行して当該 Issue の coordination 状態ファイルを書き込み、メインの作業ツリー側から同一 Issue の同一種別の状態ファイルを読む
- Then: worktree 側が書いた状態ファイルとメイン作業ツリー側が参照する状態ファイルが同一の絶対パス（同一実体）を指し、メイン作業ツリー側から worktree 側の書き込み内容が読めることを実測確認する（本 Issue 修正前は worktree 内へ分裂して書かれメイン側から不可視だった）
- 検証方法見込み: `automated`（一時リポジトリ＋worktree で `report status` 実行→メイン側読み取りを突合する統合テスト）

#### AC-4: 認証チェックが env 認証情報なしでも実疎通で認証済み環境を認証欠如と誤判定しない

- Given: `ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` がいずれも未設定だが、実疎通確認は成功する（`claude` が認証済みで応答する）環境ないしそのモック
- When: `launch_worker`（および `launch_gate_reviewer`）の認証チェックを通過させる
- Then: env 非空チェックで false になっても実疎通フォールバックが認証ありと判定し、認証欠如としてのフェイルセーフ（`_fail_blocked`／`_fail_safe`）が発火せず起動処理へ進むことを実測確認する（本 Issue 修正前は env 非空のみ判定でこの環境を誤って認証欠如と判定していた）
- 検証方法見込み: `hybrid`（実疎通確認をモック／上書き可能な境界で自動テスト化できる一方、真のキーチェーン認証環境での不誤判定は本物の `claude` を用いた実機で裏付けるため）

#### AC-5: 真の認証欠如時は引き続きフェイルセーフが発火する（regression なし）

- Given: `ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` がいずれも未設定で、かつ実疎通確認も失敗する（`claude` 未認証・CLI 不在等）を注入した対照条件
- When: 同条件で `launch_worker`（および `launch_gate_reviewer`）の認証チェックを起動する
- Then: 当該条件では認証欠如として `launch_worker` は `_fail_blocked`（`report_status blocked`／`human_escalation_requested`・非0非3 return）、`launch_gate_reviewer` は `_fail_safe`（`final=human_required`・非0非3 return）へ倒れることを実測確認し、AC-4 の正常環境との対比により「実際に認証済みなら通し、真に欠如なら倒す」ことが裏付けられること（フォールバック追加による regression が無いこと）を確認する
- 検証方法見込み: `hybrid`（実疎通失敗はプローブモック／env 操作で自動テスト化でき、AC-4 の正常環境との対照は実機を伴うため）

#### AC-6: launch_worker が本物の claude CLI で 1 セグメントを人間介在なく完走し、自身もそれを検知する

- Given: `worker.adapter: claude`・本物の `claude` CLI（headless・認証済み・CLI 利用可）・ローカルバックエンドの使い捨て issue という正常な前提（要件1〜4 の修正反映済み）
- When: `launch_worker <issue_id> <segment>` を 1 セグメント（spec/design/implementation/validation のいずれか）に対して起動し、人間の追加入力・手動代行を一切与えずに完了まで待つ
- Then: `launch_worker` が終了コード 0 で返り、`report latest <issue_id> <segment>` の直近レコードが `status=completed` かつ `target_sha` が push 済み HEAD と一致し、lease が解放されていることを実測確認する（本 Issue 修正前は `repoRoot()` 分裂により worker report が不可視で `blocked` へ誤フェイルセーフしていた）
- 検証方法見込み: `manual`（本物の `claude` CLI・認証を用いたライブ起動の一回性検証のため。手順・実行者・証跡は VALIDATION.md で確定する）

#### AC-7: launch_worker 完走・自己検知の証跡（ログ・report-status 記録）が残る

- Given: AC-6 の実機起動
- When: `launch_worker` の実行ログと report-status の記録を採取する
- Then: 「人間介在なしに 1 セグメントが正常完了し（`report_status completed`・`target_sha` 一致）、`launch_worker` 自身が終了コード 0 でそれを検知した」ことを示す実行ログ・report-status 記録が VALIDATION.md に実測証跡として記載され、`blocked`／`human_escalation_requested` の誤発火が無かったことも併せて記録されることを確認する
- 検証方法見込み: `manual`（実機実行の証跡採取・記載のため）

#### AC-8: 既存テストスイートが全て pass しビルドが通る（regression なし）

- Given: 本 Issue の全変更（`repoRoot()` の worktree 対応・認証チェックのフォールバック追加・追加テスト）を反映した状態
- When: リポジトリのビルド（`npm run build`／tsc）とテストスイート全体（`npm test` 相当）を実行する
- Then: ビルドが終了コード 0 で成功し、既存テストが全て pass し、新規追加テスト（AC-1/AC-2/AC-3/AC-4/AC-5 の自動化部分）も全て pass する（regression なし）ことを実測確認する
- 検証方法見込み: `automated`

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- **GitHub 側のライブ設定変更（ruleset／branch protection）**: `main`・統合ブランチの required check 機械強制は先行 Issue #180 で実施済み・完了済みであり、本 Issue では変更しない。
- **権限モードの allowlist 内容自体の見直し**: `launch_worker` の権限モード（`--allowed-tools` 責務スコープ allowlist）は Issue #183 で実装済みであり、実機で良好に機能することが確認済みである。本 Issue は権限モードには手を入れず、`repoRoot()` のパス解決と認証チェックのみを対象とする。
- **coordination 状態の配置規約自体の変更**: `issues/<n>/.agent-skill-chain/{state,lease,integration,reviews,reports}` という配置規約（`src/lib/local-state.ts`）は変更しない。本 Issue が直すのはその基点となる `repoRoot()` の解決だけである。
- **`codex` アダプタ（`.agent-skill-chain/adapters/codex.sh`）への同等の認証チェック対応**: 本 Issue は `claude` アダプタ（`launch_worker`／`launch_gate_reviewer`）の認証チェック誤検知の解消を対象とする。他アダプタへの展開は対象外。
- **`claude` CLI 側の認証状態確認手段の有無に関する仕様確定**: 実疎通確認の具体手段（`claude` 側に認証状態確認の公式手段があるか、無ければ軽量プローブで代替するか）の最終選定は DESIGN.md の責務とし、本 SPEC は「env が無くても実際に認証済みなら通す」という振る舞い要件のみを定める。
- **`worker.adapter` / `review.adapter` を本リポジトリの恒久的な既定値として `claude` へ確定する意思決定**: 本 Issue は再実機検証を成立させるための修正と実測までを対象とし、恒久既定値化の判断は別途行う（Issue #180・#183 のスコープ外事項と整合）。
- **`human_required` の 4 種の真の異常経路（認証欠如・CLI 不在・timeout・完了偽装検知）すべての網羅的な故障注入テストの新規整備**: 本 Issue は認証欠如検知の regression 確認（AC-5）と実機正常経路の完走検知（AC-6）までを対象とし、timeout・完了偽装検知の網羅的整備は対象外（既存テストの維持で足りる）。
