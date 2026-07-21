# DESIGN: agent-skill-chain — repoRoot() の worktree 分裂バグ解消・launch_worker 認証チェックの誤検知解消

- Issue: `ISSUE-185`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲・前提・用語

本設計の目的は、SPEC.md が確定した2つの独立バグ——(1) `src/lib/paths.ts` の `repoRoot()` が git worktree 内から呼ばれると worktree 自身のパスを返し coordination 状態が worktree 内へ分裂する、(2) `.agent-skill-chain/adapters/claude.sh` の認証チェックが環境変数の非空のみで判定しキーチェーン等のセッション認証を「認証欠如」と誤判定する——を恒久解消し、Issue #180・#183 で持ち越された「`launch_worker` 自身の1セグメント完走検知」を本物の `claude` CLI（headless）で実機成立させることである。

対象は3点。(A) `repoRoot()` を、worktree 内から呼ばれてもメイン（共通）作業ツリールートを一貫して返すよう修正する。(B) `repoRoot()` の意味変更に伴い「現在の作業ツリー」を必要とする呼び出し箇所（`checkpoint.ts` の `git add`/`commit`/`push`）を新設の worktree スコープ解決関数へ退避させ、regression を防ぐ。(C) `launch_worker`／`launch_gate_reviewer` の認証チェックへ、env が無い場合の実疎通フォールバックを追加する。coordination 状態・成果物の**配置規約自体（`src/lib/local-state.ts`）は変更しない**——基点となる `repoRoot()` の解決だけを直す。

前提: 本リポジトリは agent-skill-chain の**正本（配布元）**であると同時に、その規律を自らに適用する**ドッグフーディング消費者**でもある。正本アセットへ消費者固有・一過性の値を混入させない。本システムは既に git バイナリへ広く依存する（`src/lib/exec.ts` の `git()` ヘルパ経由で `src/lib/worktree.ts`・`checkpoint.ts`・`gate.ts` 等が git を実行する）。ワーカー起動系（`WORKER_CMD`）・レビュア起動系（`GATE_REVIEWER_CMD`）は env で完全上書き可能であり、この上書き余地（テストのモック境界）は本設計でも維持し、認証プローブにも同型の上書き境界を設ける。`worker.adapter`/`review.adapter` は先行 Issue #180 で `claude` へ切替済み（本 Issue のスコープ外）。

用語（成果物の自己完結のため本文で定義する）:
- **メイン（共通）作業ツリールート**: `git worktree add` の起点となった主作業ツリーのルート。ここに実体の `.git` **ディレクトリ**が存在する。linked worktree はこの `.git/worktrees/<name>` を指すポインタを持つ。coordination 状態（`issues/<n>/.agent-skill-chain/...`）は本ルート基点で一意に解決されるべき対象。
- **linked worktree**: `git worktree add` で作られた作業ツリー。ルート直下の `.git` は**ファイル**で、内容は `gitdir: <メインの .git/worktrees/<name> への絶対パス>` の1行。
- **`repoRoot()`**: `src/lib/paths.ts` の関数。起点（既定 `process.cwd()`）から祖先方向へ辿り対象リポジトリの基準ディレクトリを返す。ローカルバックエンドの coordination 状態・アセット解決の基点。**本設計の修正対象**。
- **`git rev-parse --path-format=absolute --git-common-dir`**: メイン作業ツリーからも linked worktree からも、共通 `.git` ディレクトリ（`<メイン>/.git`）の**絶対**パスを返す git ネイティブ判定。その `dirname` がメイン作業ツリールート。`--path-format=absolute`（git 2.31+）は起点がサブディレクトリでも常に絶対パスを返す（無指定だと cwd 相対で返り、深さに依存して不定になる）。
- **`git rev-parse --show-toplevel`**: **現在いる**作業ツリーのルートを返す。linked worktree 内からはその worktree 自身のルート（メインではない）を返す。修正前 `repoRoot()` が返していた値と等価であり、「現在の作業ツリーに対する git 操作」の正しい基点。
- **coordination 状態ファイル**: ローカルバックエンドで Issue 毎の調整状態を保持する Git 管理下ファイル群（`state.yaml` 正本・`lease.yaml`・`integration.yaml`・`reviews/<gate>.yaml`・`reports/<segment>.yaml`）。`src/lib/local-state.ts` が `root` 基点の配置規約を定義する。
- **`launch_worker` / `launch_gate_reviewer`**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数／read-only ゲートレビュア起動関数。前者は起動後の各異常（認証欠如・CLI 不在・起動失敗・timeout・完了偽装）で `report_status blocked`（`human_escalation_requested`）を書き非0非3で返す `_fail_blocked` を、後者は `final=human_required` を書き非0非3で返す `_fail_safe` を持つ（I8 安全側ラチェット）。
- **実疎通確認（authentication probe）**: env 認証情報が無い場合に、`claude` が実際に認証済みかを軽量に確認する手段。本設計では `claude auth status`（非対話・認証状態のみ確認・モデル呼び出しなし・トークン消費なし）を採用する。
- **AGENTS.md I5（進行役の純粋性）／I8（安全側ラチェット）**: I5＝進行役は調整状態のみ読み書きし成果物を著述しない、ワーカーは自 branch 以外へ書き込まない。I8＝autonomy の降格は自動・既定は安全側、疑わしきは安全側へ倒す。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1（repoRoot の worktree 一貫化） / `AC-1`,`AC-2` | 設計要素A「repoRoot() の common-dir 解決」 | `.git` がディレクトリの通常経路は不変（AC-2）、ファイル時のみ common-dir 親へ解決（AC-1） |
| 要件2（coordination 状態の worktree 非分裂） / `AC-3` | 設計要素A＋設計要素C「local-state 無改修」＋設計要素B「worktree 操作の退避」 | repoRoot 修正で local-state のパスが自動的にメイン基点で一致。checkpoint の git 操作は worktreeRoot() へ退避し regression 回避 |
| 要件3（認証の実疎通フォールバック追加） / `AC-4` | 設計要素D「認証チェックの2段化」 | env 高速パス→`claude auth status` フォールバック |
| 要件4（真の認証欠如検知の維持・mock 境界） / `AC-5` | 設計要素D | `CLAUDE_AUTH_PROBE_CMD` 上書き境界、`_fail_blocked`／`_fail_safe` 維持 |
| 要件5（launch_worker 実機完走・自己検知） / `AC-6`,`AC-7` | 設計要素E「launch_worker 実機再検証手順」 | 使い捨て issue・分離プロセス・証跡採取 |
| 要件6（既存テストスイート維持） / `AC-8` | 設計要素F「回帰の維持・追加テスト」 | 追加テスト＋既存の認証欠如テストへ `CLAUDE_AUTH_PROBE_CMD=false` 注入で hermetic 化 |

## 責務・境界

### コンポーネント構成

#### A. repoRoot() の common-dir 解決（要件1・AC-1・AC-2）

`src/lib/paths.ts` の `repoRoot()` を、`.git` エントリの**種別**を区別する方式へ改める。祖先方向の fs 探索は維持し、次の分岐を加える。

- `.git` が**ディレクトリ**（通常リポジトリのルート）: 従来どおりそのディレクトリを返す（AC-2、通常経路は完全に不変・git バイナリを呼ばない高速パス）。
- `.git` が**ファイル**（linked worktree の gitdir ポインタ）: メイン作業ツリールートへ解決して返す。解決の一次手段は `git rev-parse --path-format=absolute --git-common-dir`（cwd=当該 worktree）で得た絶対 common-dir の `dirname`。git 実行不能時のフォールバックは、`.git` ファイルの `gitdir: <p>` を読み `<p>/commondir`（git が worktree ごとに置く相対ポインタ）を解決して common-dir を得て `dirname` する。
- `.git` が全く見つからない: 従来どおり `.git が見つかりません（起点: ${startDir}）` で停止する（AC-2）。

採用方式の比較・却下案は後述「repoRoot() 修正方式の設計判断」に記す（**採用: fs 探索＋種別判定ハイブリッド、worktree 時のみ git common-dir 解決**）。

#### B. worktree 操作の退避（worktreeRoot() 新設・checkpoint.ts 切替）（要件2・regression 防止）

`repoRoot()` が「現在の worktree」ではなく「メイン作業ツリー」を返す意味変更により、`repoRoot()` を**現在の作業ツリーに対する git 操作の cwd**として使っていた箇所が破綻する。該当は `src/commands/checkpoint.ts` の `git add -A`／`git commit`／`git push`（ワーカーが自 worktree 内から自 branch へ commit/push する経路）——ここで cwd がメイン作業ツリーになると、ワーカーが**メイン作業ツリー（別 branch）を誤って commit/push**してしまう重大 regression になる。

対策として `src/lib/paths.ts` に `worktreeRoot(startDir = process.cwd())` を新設する。実装は `git rev-parse --show-toplevel`（cwd=startDir）で、**現在いる作業ツリー**のルートを返す（修正前 `repoRoot()` が返していた値と等価）。`checkpoint.ts` の `const root = repoRoot()` を `const root = worktreeRoot()` へ置換する。これにより commit/push は常に自 worktree・自 branch を対象とし、従来の worktree commit 動作が保たれる。

#### C. coordination 状態の worktree 非分裂（local-state 無改修）（要件2・AC-3）

`src/lib/local-state.ts` の各パス関数（`stateFilePath`・`leaseFilePath`・`integrationFilePath`・`reviewFilePath`・`reportFilePath`・`issueDir`）は `root` を引数に取り相対配置規約を組み立てるだけで、**改修しない**。設計要素A により、worktree 内から `report status`／`lease acquire`／`checkpoint` 相当を実行した際に渡る `repoRoot()` の返り値がメイン作業ツリールートで一貫するため、worktree 側が書いた状態ファイルとメイン側が読む状態ファイルが**同一絶対パス（同一実体）**を指すようになる（AC-3）。ローカルバックエンドの `report latest`／`report status`（`src/commands/report.ts`）はファイルシステム経由で読み書きするため、同一マシン上で同一パスに解決されれば commit の有無に依らずメイン側から可視になる（durability の commit/push は本 Issue の対象外・既存挙動）。

#### D. 認証チェックの2段化（実疎通フォールバック）（要件3・要件4・AC-4・AC-5）

`.agent-skill-chain/adapters/claude.sh` に、`launch_worker`／`launch_gate_reviewer` の両方から呼ぶ共通ヘルパ `_claude_auth_ok` をファイルスコープで新設する。2段構成:

- (a) 高速パス: `ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN` のいずれかが非空なら即 `return 0`（従来挙動・実値は非ログ）。
- (b) フォールバック: いずれの env も無い場合、実疎通確認を行う。既定プローブは `claude auth status`（非対話・認証状態のみ・モデル呼び出しなし・トークン消費なし）。終了コード0を authed とみなす。プローブは `CLAUDE_AUTH_PROBE_CMD`（未指定時のみ既定を組む）で完全上書き可能（テストのモック境界）。`claude` 不在かつ `CLAUDE_AUTH_PROBE_CMD` 未指定なら `return 1`（真の認証欠如）。プローブは `CLAUDE_AUTH_PROBE_TIMEOUT_SEC`（既定20）で timeout し、出力（`auth status --json` はアカウント情報を含みうる）は stdout/stderr とも捨てて非ログとする。

`launch_worker` の既存 env 非空チェックを `if ! _claude_auth_ok; then _fail_blocked "認証情報が未設定かつ実疎通確認にも失敗しました（env 未設定・claude auth status 失敗/不在）"; return; fi` へ置換する。`launch_gate_reviewer` の同チェックを `if ! _claude_auth_ok; then _fail_safe "同上"; return; fi` へ置換する。真の欠如（env 無し＋プローブ失敗）では従来どおり `_fail_blocked`／`_fail_safe` が発火する（要件4・AC-5、regression なし）。具体ロジックは後述「認証チェック修正方式の設計判断」に記す。

#### E. launch_worker 実機再検証手順（要件5・AC-6・AC-7）

設計要素A〜D 反映後、`worker.adapter: claude`・本物 `claude` CLI（headless・認証済み・CLI 利用可）・ローカルバックエンドの使い捨て issue で `launch_worker <id> spec` を**外側セッションから分離した独立プロセス**（`setsid`/`nohup`/CI）で起動し、人間介在なしの完走と `launch_worker` 自身の検知（exit 0・`report latest` が `status=completed` かつ `target_sha`=push 済み HEAD・lease 解放）を実測する。手順詳細は後述「launch_worker 実機再検証手順」。実施・証跡採取・記載は独立検証セグメント（VALIDATION.md）の責務。本 DESIGN は手順を確定する。

#### F. 回帰の維持・追加テスト（要件6・AC-8）

新規追加テスト: (i) `repoRoot()` の3系列（通常リポジトリのルート／サブディレクトリで従来値、linked worktree でメイン作業ツリールート、`.git` 皆無で明示エラー）＝AC-1/AC-2 automated。(ii) worktree 内から `report status`（ローカルバックエンド）を実行した状態ファイルがメイン作業ツリー側の `reportFilePath` と同一実体で読める＝AC-3 automated。(iii) 認証プローブの success（`CLAUDE_AUTH_PROBE_CMD` を exit0 スタブ）で fail-safe が発火しない／failure（exit≠0 スタブ）で発火する＝AC-4/AC-5 automated。既存の認証欠如テスト（`test/integration/worker-adapters.test.ts` の env 除去ケース、および `gate-adapters.test.ts` の同型ケース）は、real `claude auth status` へ到達して非決定化しないよう `CLAUDE_AUTH_PROBE_CMD='false'` を注入して hermetic 化する（テストの意図＝「認証欠如→fail-safe」は不変）。`npm run build`（tsc）と `npm test` 全 pass を確認する。

### 依存関係

```text
A(repoRoot common-dir解決) ──┬─→ C(local-state 無改修で自動一致) ─→ AC-3
                             └─→ B(worktreeRoot新設・checkpoint切替) : Aの意味変更に伴う必須の退避
D(認証2段化) ── 独立 ──────────→ AC-4/AC-5
A,B,C,D ─────────────────────→ F(回帰: build+test 全pass) ─→ E(launch_worker 実機再検証)
```

循環依存は無い。A と D は独立に着手できる。B は A の意味変更に伴い**必須で同時**に入れる（B 無しで A だけ入れると checkpoint が破綻する）。C は local-state 無改修＝コード変更なし（A の帰結を確認するのみ）。E は A・B・D と F が揃った後に独立検証セグメントで実施する。

### 全 repoRoot() 呼び出し箇所への影響範囲

`repoRoot()` の意味変更（現在の worktree → メイン作業ツリー）が既存呼び出し箇所へ与える影響を全数分類した。

- **メイン基点で正しくなる（＝本修正の目的そのもの、無改修で改善）**: `report.ts`（`reportFilePath`）・`lease.ts`（`leaseFilePath`・`issues/` 走査・WIP 計数）・`gate.ts`（`reviewFilePath`）・`reconcile.ts`（`issues/` 走査・lease 回収）・`pr.ts`（ローカルモードの `integrationFilePath`）。これらはワーカー／進行役が worktree・メインどちらから呼んでも同一 issue の同一実体を指すべき coordination 状態であり、一貫化が正の効果。
- **元々メインから実行され、かつ対象 worktree を `findIssueWorktree`／`listWorktrees` で明示解決しているため無影響**: `gate.ts`（`baseDir = worktree.path`、`git rev-parse HEAD` は `entry.path`）・`verify.ts`（`checkOutputExists(entry.path,...)`、`worktree-path` は先頭=メインを除外）・`doctor.ts`（`listWorktrees(root)` の先頭=メイン作業ツリーで clean 判定。`listWorktrees` はどの worktree から呼んでも全 worktree を返すため `root` 変更に不感）。
- **アセット解決（`resolveAsset` 経由 `config.ts`/`roles.ts`/`segments.ts`）**: `.agent-skill-chain/` はメイン・各 worktree の双方にチェックアウトされる。修正後はメイン側の `.agent-skill-chain/` を優先解決する。通常は両者同一内容であり実害はない。worktree 内で未 commit のアセット変更を行っている最中はメイン側の版を読む差が生じうるが、coordination の一貫性の観点ではむしろ望ましい方向であり、稀な編集中エッジのみの差分として許容する（未決事項に記載）。
- **現在の worktree を必要とし退避が必須**: `checkpoint.ts`（`git add`/`commit`/`push`）のみ。設計要素B で `worktreeRoot()` へ退避する。
- **`pr.ts` の `gh pr create`（GitHub モード）**: `gh(['pr','create','--head',branch,...], root)` は `--head <branch>` を明示するため、cwd がメインでも対象 branch を取り違えない（gh はリポジトリを cwd の remote から判定するがメイン・worktree で同一 remote）。無改修で正しく動く。

## repoRoot() 修正方式の設計判断

SPEC 要件1が提示した2候補を、**通常経路の regression ゼロ・worktree での一貫化・依存の最小化**のトレードオフで比較する。

### 採用案: fs 探索＋`.git` 種別判定ハイブリッド（worktree 時のみ git common-dir 解決）

祖先方向の fs 探索を維持し、`.git` が**ディレクトリ**なら従来どおり即返す。`.git` が**ファイル**の場合のみ `git rev-parse --path-format=absolute --git-common-dir` の親でメイン作業ツリールートを求める（git 失敗時は `.git` ファイル＋`commondir` パースへフォールバック）。

採用理由:
1. **通常経路の完全不変（AC-2）**: 大多数の呼び出し（通常リポジトリ・非 worktree、CI テストの一時リポジトリはすべて実 `.git` ディレクトリ）は種別判定でディレクトリ分岐へ入り、返り値も探索ロジックも**従来と1バイトも変わらない**。git バイナリも呼ばない高速パスを保つ。regression の面積が worktree 分岐のみに限定される。
2. **worktree での確実な一貫化（AC-1）**: git ネイティブの `--git-common-dir` は git 内部の worktree 台帳に基づく正準解決であり、`.git/worktrees/<name>` レイアウト・外部配置 worktree・`commondir` の相対指定を git 自身が正しく解決する。手書きのパス演算より堅牢。
3. **依存の妥当性**: git バイナリ依存は本システムに既存（`exec.ts` の `git()`）。worktree 分岐でのみ git を呼ぶため、依存増は最小。git 実行不能時は `.git` ファイル＋`commondir` の純 fs パースへフォールバックし、最終的に解決不能なら明示エラーで停止する（silent に誤値を返さない）。
4. **bare 構成の非該当**: `.git` がファイルであることは linked worktree（＝非 bare の作業ツリー）を含意するため、bare リポジトリ（`--git-common-dir` の親が作業ツリーでない）を worktree 分岐で踏むことはない。coordination 状態は作業ツリー内にのみ存在するため、bare は本関数の対象外。

トレードオフ（明示）: worktree 分岐で git バイナリへ依存する。緩和は上記4のフォールバック（純 fs パース）と、解決不能時の明示エラー。`--path-format=absolute` は git 2.31（2021）以降が必要だが、本システムが要求する git は worktree・porcelain を用いる時点でこれを十分満たす。

### 却下案: 全面 git ネイティブ判定（常に `git rev-parse` で解決）

`.git` の種別に依らず、常に `git rev-parse --path-format=absolute --git-common-dir` の親を返す。**却下**。理由: (i) 通常経路まで毎回 git を fork する——`repoRoot()` はほぼ全コマンドで呼ばれ、fs 探索より高コストかつ git 依存を全経路へ拡大する。(ii) `.git が見つかりません` の既存明示エラー（AC-2 が要求）を git のエラー文言へ置き換えることになり、非リポジトリ起点のメッセージ互換が崩れる。(iii) 得られる一貫化は採用案（worktree 分岐のみ git）と同一で、追加の便益がない。共通ヘルパ（common-dir 解決）自体は採用案の worktree 分岐内で用いる。

### 却下案: `.git` ファイルの `gitdir:` を手書きでパースし固定段数上へ（git を呼ばない）

`.git` ファイルの `gitdir: <p>` を読み `<p>` から固定段数（`.git/worktrees/<name>` 前提で3段）上がってメインルートを得る。**却下**（ただしフォールバックとしては採用）。理由: 固定段数はレイアウト前提に脆く、`commondir` が非標準（外部 `.git`・カスタム配置）を指す場合に誤る。git ネイティブ解決を一次手段とし、本方式は `commondir` を読む堅牢版として git 実行不能時のフォールバックにのみ用いる。

## 認証チェック修正方式の設計判断

SPEC 要件3の「env が無くても実際に認証済みなら通す／真に欠如なら倒す」を満たす実疎通手段を比較する。

### 採用案: `claude auth status`（専用の認証状態確認コマンド）

`claude` CLI は `claude auth status`（`Show authentication status`、既定 `--json`）を持ち、非対話で認証状態のみを確認する（**モデル呼び出しなし・トークン消費なし**）。認証済みで終了コード0、未認証で非0を返す。これを env 無し時のフォールバックプローブに採用する。

`_claude_auth_ok`（`launch_worker`／`launch_gate_reviewer` 共通）の判定ロジック:

```bash
_claude_auth_ok() {
  # (a) 高速パス: env 認証情報のいずれかが非空なら authed（実値は非ログ）
  if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    return 0
  fi
  # (b) 実疎通フォールバック（CLAUDE_AUTH_PROBE_CMD で上書き可＝テストのモック境界）
  local probe="${CLAUDE_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    if command -v claude >/dev/null 2>&1; then
      probe='claude auth status'
    else
      return 1   # env 無し・CLI 不在 = 真の認証欠如
    fi
  fi
  local t="${CLAUDE_AUTH_PROBE_TIMEOUT_SEC:-20}"
  # 出力は非ログ（auth status --json はアカウント情報を含みうる）。終了コード0のみ authed。
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" bash -c "$probe" >/dev/null 2>&1
  else
    bash -c "$probe" >/dev/null 2>&1
  fi
}
```

採用理由:
1. **正確性**: 認証状態を直接問い合わせる専用手段で、認証済み／未認証を終了コードで明確に判別できる（実機確認: 認証済み→exit 0、空 env＋新規 HOME の未認証→exit 非0）。
2. **低コスト**: モデル推論を伴わないため、トークン消費ゼロ・低レイテンシ。しかもプローブは**両 env が無い場合のみ**実行されるため、env を注入する CI・sandbox では一切走らない。実運用（キーチェーン認証・env 無し）でも `launch_worker`／`launch_gate_reviewer` 1回あたり最大1回の軽量呼び出しに留まる。
3. **安全側の維持（I8）**: 終了コード0以外（未認証・timeout・一時的失敗・CLI 不在）はすべて「authed と確認できない」＝ `_fail_blocked`／`_fail_safe` へ倒す。誤って approve/起動継続へ倒さない。ネットワーク一時障害での false negative（誤 blocked）はありうるが安全側であり許容する。
4. **モック境界（要件4・AC-5）**: `CLAUDE_AUTH_PROBE_CMD` で完全上書き可能。テストは success を exit0 スタブ、failure を exit≠0 スタブで注入でき、自動検証できる。既存の `WORKER_CMD`／`GATE_REVIEWER_CMD` と同型の差し替え境界。
5. **既存フェイルセーフとの整合**: 高速パス（env 非空）は従来挙動を完全維持し、既存の env ベーステスト（dummy キー注入）は無改修で通る。フォールバックは env 欠如時に**追加**されるだけで、既存パスを置換しない。

トレードオフ（明示）: `claude auth status` の存在・終了コード契約は `claude` CLI のバージョンに依存する。緩和は `CLAUDE_AUTH_PROBE_CMD` による上書きと、プローブ失敗＝安全側 blocked という設計（未知バージョンで status が使えなくても env 注入か WORKER_CMD 経路で回避可能）。

### 却下案: `claude -p "<軽量プロンプト>"` によるモデル疎通プローブ

`claude -p "1+1" --allowed-tools ''` 等の軽量プロンプトを短い timeout で投げ、終了コードで認証を判定する。**却下**。理由: (i) 認証確認のために毎回**実モデル推論**を走らせ、トークン消費・レイテンシが `auth status` より大きい。(ii) ネストした `claude -p` 起動は外側セッションの安全分類器に阻まれうる（Issue #183 で観測された衝突類型）——認証確認という副次目的でそのリスクを負う必要がない。(iii) `auth status` という認証専用の一次手段があるため、モデル呼び出しで代替する合理性がない。ただし `claude auth status` が使えない環境向けの代替として `CLAUDE_AUTH_PROBE_CMD` に本方式を明示指定する余地は残す（既定にはしない）。

### 却下案: env 非空チェックの単純撤廃（常にプローブ）

env の有無に依らず常に実疎通プローブを走らせる。**却下**。理由: env 認証済みの CI で不要な `claude` 起動を毎回発生させ、SPEC 要件3が明記する「env 認証情報が有る場合の高速判定は維持」に反する。env 非空を高速パスとして残す（フォールバックとしてのみプローブを追加する）。

## launch_worker 実機再検証手順（要件5・AC-6・AC-7）

`worker.adapter: claude`・本物 `claude` CLI・認証情報あり（env またはキーチェーン）・ローカルバックエンドの使い捨て issue で、以下を分離プロセスで実行する。

1. **使い捨て issue 起票**: ローカルバックエンドで大きな番号の使い捨て issue を `issue start`（Issue #183 で追加済みの `--title`/`--request-file` を用い本文を供給、人間が SPEC を作り込まない）で起票し、worktree と `state.yaml` を生成する。
2. **セグメント選定**: 上流成果物依存が無く単一成果物生成で完結する **spec セグメント**を第一候補とする（`launch_worker` の全契約経路を最小副作用で通す）。
3. **分離起動**: 認証（`ANTHROPIC_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN`、またはキーチェーン）下で `launch_worker <id> spec` を `setsid`/`nohup`/CI ジョブ等で**外側セッションから分離**して起動し、stdout/stderr をログへ採取（認証実値は非出力）。キーチェーン認証（env 無し）での起動を少なくとも1経路含め、設計要素D のフォールバックが実機で誤判定しないことを裏付ける（AC-4 の live 側）。
4. **完走・自己検知確認（AC-6・AC-7）**: `launch_worker` が exit 0 で返り、`report latest <id> spec` の直近が `status=completed` かつ `target_sha`=`git rev-parse HEAD`（worktree）、lease 解放済みであることを実測。修正前は `repoRoot()` 分裂で worker report がメイン側から不可視となり `blocked` へ誤フェイルセーフしていたことと対比し、`blocked`／`human_escalation_requested` の誤発火が無いことを report 履歴で確認する。ログと report 記録を VALIDATION.md の証跡として保存する。
5. **後始末**: 使い捨て issue・worktree・lease を `cleanup.sh`／`git worktree remove`（cleanup 経由）／`git push origin --delete` 等で除去し、`main`・統合ブランチ・WIP 枠へ痕跡を残さない。マージしない。

実機検証（AC-6/AC-7 の manual/live 部分）の実施・証跡採取・記載は独立検証セグメント（VALIDATION.md）の責務。

## 関連ADR

本 Issue の中核判断「基準ディレクトリ解決を2責務に分離する——**coordination／リポジトリ同一性は共通（メイン）作業ツリーへ、作業コピーへの mutating な git 操作は現在の worktree へ解決する**」は、worktree を跨ぐパス解決の**恒久的・横断的なアーキテクチャ契約**である。今後の新規コマンド・新規アダプタが「repoRoot()（＝共通）と worktreeRoot()（＝現在の worktree）のどちらで解決すべきか」を honor する必要があるため、ADR を新設する。

```yaml
related_adrs:
  - id: ADR-0004
    relation: adopts
```

`docs/adr/ADR-0004-worktree-path-resolution.md`（`status: proposed`）を作成する。設計ゲート承認時に `accepted` へ遷移する。認証チェックの2段化（設計要素D）は、既存の `WORKER_CMD`／`GATE_REVIEWER_CMD` と同型の「モック可能なコマンド境界」パターンの適用かつフェイルセーフの精緻化であり、新たなアーキテクチャ軸を導入しないため ADR 化せず本 DESIGN で確定する。

## 障害・ロールバック考慮

- 想定される失敗モードとロールバック:
  - **B の退避漏れで checkpoint がメイン作業ツリーを commit する**: A と B を必ず同一変更で入れる（B は A の前提）。テスト（worktree 内 checkpoint が自 branch を commit すること）で担保する。退行時は当該 2 変更を `git revert`。
  - **repoRoot() の worktree 分岐で git 解決に失敗**: フォールバック（`.git`＋`commondir` パース）で解決を試み、最終的に解決不能なら明示エラーで停止（silent に誤値を返さない）。通常経路（`.git` ディレクトリ）は不変のため影響は worktree 分岐に限定。
  - **認証プローブの false negative（一時障害で誤 blocked）**: 安全側（I8）であり許容。env 注入または `WORKER_CMD` 経路で回避可能。`CLAUDE_AUTH_PROBE_CMD` で環境固有の確実なプローブへ差し替え可能。
  - **既存の認証欠如テストが real `claude auth status` へ到達し非決定化**: 該当テストへ `CLAUDE_AUTH_PROBE_CMD='false'` を注入して hermetic 化する（F）。注入漏れは CI が real 認証状態依存で不安定化して顕在化する。
  - **使い捨て検証物の残存**: E の後始末を PLAN のタスクで必須化する。
- 影響を受ける既存機能: `repoRoot()` の worktree 分岐（通常経路は不変）、`checkpoint.ts` の cwd 解決関数、`claude.sh` の認証チェック 2 箇所。配布物（`.agent-skill-chain/templates/`）・CI workflow・GitHub 側共有設定（ruleset/branch protection）は**変更しない**（本 Issue は #180 と異なり共有インフラ変更を含まない）。

## 制約・未決事項・対象外

- **制約**: coordination 状態・成果物の配置規約（`src/lib/local-state.ts`）は変更しない。`WORKER_CMD`／`GATE_REVIEWER_CMD`／`CLAUDE_AUTH_PROBE_CMD` の上書き余地を維持する。認証実値・`auth status` 出力をログ・PR・Issue・証跡へ出力しない。通常リポジトリでの `repoRoot()` 返り値・エラー文言を変えない（AC-2）。
- **未決事項**: アセット解決（config/roles/segments）が worktree 内の未 commit アセット変更を無視しメイン側を読む差の許容範囲（本設計は coordination 一貫性を優先し許容）。`claude auth status` の終了コード契約が将来の CLI バージョンで変わった場合の追随（`CLAUDE_AUTH_PROBE_CMD` 上書きで吸収）。E を local backend／GitHub backend のどちらで行うか（本設計は local 使い捨てを推奨、最終判断は検証者）。
- **対象外（SPEC スコープ外の再掲）**: GitHub 側ライブ設定（ruleset/branch protection）の変更、権限モード（`--allowed-tools`）の allowlist 内容見直し（#183 で実装済み）、coordination 配置規約自体の変更、`codex` アダプタへの認証チェック対応、`worker.adapter`/`review.adapter` の恒久既定値化の意思決定、`human_required` 4 異常経路すべての網羅的故障注入テストの新規整備。
