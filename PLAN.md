# PLAN: agent-skill-chain — repoRoot() の worktree 分裂バグ解消・launch_worker 認証チェックの誤検知解消

- Issue: `ISSUE-185`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素 A〜F を、実装セグメントが迷わず実行できる粒度（具体ファイル・手順・完了判定）へ分解する。コード変更（`#1`〜`#6`）は本 Issue のスコープ内で完結し、GitHub 側共有インフラ（ruleset/branch protection）の変更は**含まない**。実機 live 検証（`#7`）は独立検証セグメント（VALIDATION.md）の責務であり、本 PLAN は着手可能な形まで分解する。

| # | 変更単位 | 内容・具体手順 | 完了判定 | 対応 AC-ID | 依存 |
|---|---|---|---|---|---|
| 1 | repoRoot() を common-dir 解決へ改修＋worktreeRoot() 新設＋checkpoint 切替 | `src/lib/paths.ts`: (a) `repoRoot()` の fs 探索で `.git` の種別を判定し、**ディレクトリ**なら従来どおり即返す（通常経路・返り値/ロジック不変）、**ファイル**（linked worktree）のときのみメイン作業ツリールートへ解決する（一次: `git rev-parse --path-format=absolute --git-common-dir` の `dirname`。git 実行不能時: `.git` の `gitdir:` を読み `<gitdir>/commondir` を解決して common-dir を得て `dirname`。解決不能なら明示エラーで停止）。`.git` 皆無時のエラー文言 `.git が見つかりません（起点: ${startDir}）` は不変。(b) `worktreeRoot(startDir = process.cwd())` を新設（`git rev-parse --show-toplevel` で現在の作業ツリールートを返す）。`src/commands/checkpoint.ts` の `const root = repoRoot()` を `const root = worktreeRoot()` へ置換（`git add`/`commit`/`push` が自 worktree・自 branch を対象とし続けることを保証）。git 実行は `src/lib/exec.ts` の `git()` を用いる | 通常リポジトリ（`.git` ディレクトリ）で `repoRoot()` の返り値が従来どおり。linked worktree 内から `repoRoot()` がメイン作業ツリールートを返す。`worktreeRoot()` が現在の worktree ルートを返す。`checkpoint` が worktree 内から自 branch を commit/push する | `AC-1`,`AC-2` | なし |
| 2 | 認証チェックの2段化（_claude_auth_ok） | `.agent-skill-chain/adapters/claude.sh`: ファイルスコープに共通ヘルパ `_claude_auth_ok` を新設（DESIGN「認証チェック修正方式」記載のロジック: (a) `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` いずれか非空なら return 0、(b) 両方無なら `CLAUDE_AUTH_PROBE_CMD`（未指定時は `claude auth status`、`claude` 不在なら return 1）を `CLAUDE_AUTH_PROBE_TIMEOUT_SEC`（既定20）で timeout 実行し終了コード0を authed、出力は非ログ）。`launch_worker` の既存 env 非空チェックを `if ! _claude_auth_ok; then _fail_blocked "認証情報が未設定かつ実疎通確認にも失敗しました（env 未設定・claude auth status 失敗/不在）"; return; fi` へ、`launch_gate_reviewer` の同チェックを `_fail_safe` 版へ置換 | env 非空なら従来どおり通過。env 無＋プローブ成功で通過（fail-safe 不発火）。env 無＋プローブ失敗/CLI 不在で `_fail_blocked`/`_fail_safe` 発火。`claude auth status`/`auth status --json` の出力がログ・stdout に出ない | `AC-4`,`AC-5` | なし |
| 3 | AC-1/AC-2 自動テスト追加 | 一時リポジトリ（実 `.git` ディレクトリ）＋`git worktree add` で作った worktree を用い、(i) 通常リポジトリのルート・サブディレクトリ起点で `repoRoot()` が従来どおりルートを返す、(ii) worktree 内・そのサブディレクトリ起点で `repoRoot()` がメイン作業ツリールートを返す、(iii) `.git` 皆無の起点で明示エラーで停止、(iv) `worktreeRoot()` が worktree 内で当該 worktree ルート・メインでメインルートを返す、を検証する自動テストを追加（`test/` 配下、`test/helpers/tmp-repo.ts` の一時リポジトリ構築を参考にしつつ worktree 追加を行う） | 追加テストが pass | `AC-1`,`AC-2` | `#1` |
| 4 | AC-3 自動テスト追加 | ローカルバックエンドの一時リポジトリ＋worktree で、worktree 内から `report status`（`src/commands/report.ts`、cwd=worktree）を実行して coordination 状態（`reports/<segment>.yaml`）を書き、メイン作業ツリー側で `reportFilePath(repoRoot(from main), ...)` が同一絶対パス（同一実体）を指し、書き込み内容がメイン側から読めることを検証する自動テストを追加。修正前は worktree 内へ分裂して書かれメイン側から不可視だったことに対応 | 追加テストが pass（worktree 書込みがメイン側から同一実体で読める） | `AC-3` | `#1` |
| 5 | AC-4/AC-5 自動テスト追加＋既存認証欠如テストの hermetic 化 | (a) `launch_worker`/`launch_gate_reviewer` で env 無・`CLAUDE_AUTH_PROBE_CMD` を exit0 スタブ（例: `true`）にすると fail-safe が発火せず起動処理へ進む（AC-4）、exit≠0 スタブ（例: `false`）にすると `_fail_blocked`/`_fail_safe` が発火し非0非3で返る（AC-5）を検証する自動テストを追加。(b) 既存の認証欠如テスト（`test/integration/worker-adapters.test.ts` の env 除去ケース、`test/integration/gate-adapters.test.ts` の同型ケース）へ `CLAUDE_AUTH_PROBE_CMD='false'` を注入し、real `claude auth status` へ到達して非決定化しないよう hermetic 化する（テスト意図「認証欠如→fail-safe」は不変） | 追加テストが pass。既存認証欠如テストが real 認証状態に依存せず pass | `AC-4`,`AC-5` | `#2` |
| 6 | 全体回帰確認 | `npm run build`（tsc）と `npm test` を実行し、既存テスト（`worker-adapters.test.ts`/`gate-adapters.test.ts` のフェイルセーフ群、`checkpoint`・lease・report 関連含む）と `#3`〜`#5` の追加テストが全 pass、ビルドが終了コード0であることを確認 | `npm run build` exit 0・`npm test` 全 pass（regression なし） | `AC-8` | `#1`〜`#5` |
| 7 | [live 検証] launch_worker 実機完走・自己検知 | DESIGN「launch_worker 実機再検証手順」に従い、ローカルバックエンドの使い捨て issue を `issue start ... --title --request-file` で起票し、本物 `claude` CLI・認証あり（env またはキーチェーン、少なくとも1経路は env 無のキーチェーン）下で `launch_worker <id> spec` を**外側セッションから分離した独立プロセス**（`setsid`/`nohup`/CI）で起動、stdout/stderr をログ採取。exit 0・`report latest` が `status=completed` かつ `target_sha`=HEAD・lease 解放を確認し、report 履歴に `blocked`/`human_escalation_requested` の誤発火が無いことを確認。使い捨て issue/worktree/lease を後始末（cleanup 経由・マージしない・main/統合ブランチ/WIP 枠へ非混入） | 完走・自己検知・不発火の証跡が VALIDATION.md へ記録可能な形で採取される。検証物が残らない | `AC-6`,`AC-7` | `#1`,`#2`,`#6` |

## AC → タスク対応の自己点検

SPEC.md の全 AC（AC-1〜AC-8）が本 PLAN のいずれかのタスクで実現されることを確認する。

| AC-ID | 実現タスク | 検証方法（SPEC 見込み） |
|---|---|---|
| AC-1（repoRoot が worktree 内でもメインと同一を返す） | `#1`（実装）＋`#3`（automated） | automated |
| AC-2（通常リポジトリで repoRoot 返り値が従来どおり・regression なし） | `#1`（実装：ディレクトリ分岐不変＋worktreeRoot 退避）＋`#3`（automated） | automated |
| AC-3（coordination 状態が worktree とメインで同一実体） | `#1`（実装）＋`#4`（automated） | automated |
| AC-4（env 無しでも実疎通で認証済みを誤判定しない） | `#2`（実装）＋`#5`（automated）＋`#7`（キーチェーン経路の live 裏付け） | hybrid |
| AC-5（真の認証欠如時はフェイルセーフ発火・regression なし） | `#2`（実装）＋`#5`（automated：success/failure 対照＋既存テスト hermetic 化） | hybrid |
| AC-6（launch_worker 実機完走・自己検知） | `#7` | manual |
| AC-7（完走・自己検知の証跡） | `#7` | manual |
| AC-8（既存テスト全 pass・ビルド通過・regression なし） | `#6`（＋`#3`〜`#5` の追加テスト） | automated |

全 AC が対応タスクを持つ（対応漏れなし）。

## 実装順序の見直しについて

`#1`（repoRoot/worktreeRoot/checkpoint）と `#2`（認証2段化）は独立に着手できる。`#1` の (a)repoRoot 改修 と (b)worktreeRoot 新設＋checkpoint 切替は**同一変更単位として不可分**に入れる（(b) 無しで (a) だけ入れると checkpoint がメイン作業ツリーを誤 commit する）。テスト（`#3`〜`#5`）は各対応実装の直後に書いてよい。`#6`（回帰）は全コード変更反映後。`#7`（live 検証）は `#1`・`#2`・`#6` が揃った後に独立検証セグメントで実施する。作業順序のみの見直しは本ファイルの更新のみでよく、DESIGN.md の更新は不要。

## 注意事項

- **本 Issue は共有インフラ変更を含まない**: 先行 Issue #180 と異なり、GitHub 側 ruleset／branch protection の変更は本 Issue に含まれない。したがって「要ユーザー確認」の共有インフラ操作は基本的に無い。
- **進行役の実行環境（settings.json 等）への影響は無い**: 本変更（`repoRoot()`/`worktreeRoot()` の解決・認証チェックの2段化）は、`launch_worker`/`launch_gate_reviewer` がネスト起動する `claude` プロセスへ渡すロジックと CLI 内部のパス解決を変えるのみで、進行役セッションの `.claude/settings.json`・権限設定・PreToolUse hook 配線は一切変更しない。
- **配置規約は変更しない**: `src/lib/local-state.ts` の相対パス構成（`issues/<n>/.agent-skill-chain/{state,lease,integration,reviews,reports}`）は無改修。本 Issue が直すのは基点となる `repoRoot()` の解決のみ。
- **認証実値・auth status 出力の非出力**: プローブの stdout/stderr（`auth status --json` はアカウント情報を含みうる）と env 認証実値をログ・PR・Issue・証跡へ出力しない。
- **live 検証は分離プロセスで実行し、使い捨て物は必ず後始末する**: `#7` の実機起動は外側セッションの安全分類器を呼び出し経路から外すため `setsid`/`nohup`/CI 等で分離実行する。使い捨て issue／worktree／lease は cleanup 経由で除去し、マージせず、`main`・統合ブランチ・WIP 枠へ痕跡を残さない。
