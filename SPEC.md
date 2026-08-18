# SPEC: env トークン非設定の資格情報ストア限定環境でゲートレビュアが認証できない

- Issue: `ISSUE-758`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/758-keychain-auth-config-dir`

## 目的・背景

claude アダプタのゲートレビュアは、呼び出し元の資格情報を持ち込まない隔離サブプロセスとして起動する。
このとき Claude Code CLI が認証を成立させられる「認証情報の所在」は次の3分類に限られる。

- 分類A: 環境変数（`ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`）
- 分類B: 設定ディレクトリ配下の通常ファイル（`.credentials.json`）
- 分類C: 外部資格情報ストア限定（macOS Keychain 等。呼び出し元の `HOME` と `USER` に紐づき、ファイルとして複製できない）

分類Cの利用者（macOS で対話ログインし、環境変数トークンを一切設定していない構成）は、全ゲートのゲートレビューが常に
`human_required` へ倒れ、ゲートレビュー自動化が機能しない。

### 過去修正が担保した範囲と、担保しなかった範囲

| 修正 | 担保した分類 | 担保しなかった分類 |
|---|---|---|
| Issue #562（トークン引き継ぎ） | A | B・C |
| Issue #691（認証ファイルのみ複製・隔離環境での事前確認・watchdog） | A・B | C（原因を推測どまりで確定していない） |
| 本 Issue | A・B・C | 分類の追加（対象外を参照） |

同じ不具合を3度目に繰り返した原因は、修正のたびに「CI で表現できた構成」だけを回帰テストにし、分類Cを回帰テストの
対象集合へ入れなかったことである。本 SPEC は分類Cの成立自体に加え、3分類すべてを回帰テストの対象とすることを要求する。

### 実地確認した現行実装の事実（`.agent-skill-chain/adapters/claude.sh`）

隔離サブプロセスへ渡す環境の基底集合。`USER` も `LOGNAME` も含まれない（ファイル全体を検索して該当なし）。

```bash
  local -a clean_env=(
    /usr/bin/env -i
    "PATH=$sanitized_path"
    "HOME=$isolated_root/home"
    "XDG_CONFIG_HOME=$isolated_root/xdg"
    "GH_CONFIG_DIR=$isolated_root/xdg/gh"
    "GIT_CONFIG_GLOBAL=/dev/null"
    "GIT_CONFIG_SYSTEM=/dev/null"
    "GIT_TERMINAL_PROMPT=0"
    "TMPDIR=/tmp"
    "LANG=${LANG:-C.UTF-8}"
    "LC_ALL=${LC_ALL:-}"
  )
```

claude 経路では `CLAUDE_CONFIG_DIR` を**無条件に**隔離領域へ向ける。認証ファイルを複製できたかどうかを問わない。

```bash
    clean_env+=("CLAUDE_CONFIG_DIR=$staged_claude_config")
    # ISSUE-562: 呼び出し元のprovider tokenが設定されている場合は隔離サブプロセスへ引き継ぐ。
    # Issue #691: tokenの存在だけでは認証済みとせず、下流のprobeで実際の成立を検証する。
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] && clean_env+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
    [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] && clean_env+=("CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN")
```

一方、複製は通常ファイルが実在する場合にのみ行われる。分類Cでは複製が起きず、上記の `CLAUDE_CONFIG_DIR` は空の
ディレクトリを指したまま渡る。

```bash
  if [[ "$review_adapter" == "claude" && -n "$claude_config" && -f "$claude_config/.credentials.json" && ! -L "$claude_config/.credentials.json" ]]; then
```

Issue #758 の実測（環境変数を1つずつ変えた切り分け）は、`CLAUDE_CONFIG_DIR` の設定そのものが Keychain 参照を妨げ、
認証成立には呼び出し元の `HOME` と `USER` の両方が必要で、`LOGNAME` は `USER` の代替にならないことを示している。

現行の回帰テスト（`test/integration/gate-adapters.test.ts`）は、この無条件設定を期待値として固定している。

```javascript
  assert.match(reviewerEnv, /^CLAUDE_CONFIG_DIR=\/tmp\/agent-skill-chain-reviewer\.[^/]+\/auth\/claude$/m);
```

Issue が指摘した「事前確認と本体の環境差」は、ゲートレビュア経路については解消済みである。

```bash
# Issue #691: レビュアの認証プローブも実際のレビュアと同じ隔離環境で実行する。
# caller HOMEに紐づくKeychain認証を利用可能と誤判定せず、決定的な認証不成立は再試行前に検出する。
_claude_reviewer_auth_ok() {
```

残る診断上の問題は内容である。現行の失敗メッセージは分類Cを「利用できない」と断定し、環境変数の設定を促す。

```bash
    printf '%s\n' "隔離環境へ持ち込める認証情報がありません。macOS Keychainなどcaller HOMEに紐づく資格情報ストアは利用できません。"
```

## 要求 → 要件 → 受入条件

### 要求

環境変数トークンを持たず外部資格情報ストアのみで認証している利用者が、`GATE_REVIEWER_CMD` による上書きなしに
ゲートレビュアを起動して verdict を得られること。認証が成立しない場合は、原因が診断から特定できること。

### 要件

- 要件1: ゲートレビュア子プロセスへ渡す `CLAUDE_CONFIG_DIR` は、隔離領域へ認証ファイルを実際に複製できた場合にのみ、その複製先を値として設定する。複製できなかった場合は設定しない。
- 要件2: 外部資格情報ストアによる認証成立に必要な呼び出し元の識別情報（実測では `USER` と呼び出し元 `HOME`）をゲートレビュア環境へ渡す。
- 要件3: 要件2の緩和後も、GitHub 資格情報の隔離とゲートレビュアの read-only 性を維持する。
- 要件4: 認証が成立しない場合、分類ごとの検出結果と `CLAUDE_CONFIG_DIR` の扱いを含む診断を標準エラーへ出力する。認証情報の実値は出力しない。
- 要件5: 認証情報の所在3分類それぞれを対象とする自動回帰テストを持つ。

### 受入条件（Acceptance Criteria）

#### AC-1: `CLAUDE_CONFIG_DIR` は複製できた場合にのみ設定される

- Given: 呼び出し元の設定ディレクトリ配下に、複製可能な `.credentials.json`（symlink でない通常ファイル）が存在しない
- When: claude アダプタのゲートレビュアを起動する
- Then: ゲートレビュア子プロセスの環境に `CLAUDE_CONFIG_DIR` が存在しない。対照として、複製可能な通常ファイルが存在する構成では複製先を指す `CLAUDE_CONFIG_DIR` が設定される
- 検証方法見込み: `automated`

#### AC-2: 資格情報ストア限定構成でゲートレビュアが確定判定を返す

- Given: 環境変数トークン未設定・設定ディレクトリ配下に認証ファイル無し、かつ「`CLAUDE_CONFIG_DIR` が未設定」「`USER` が呼び出し元と同値」「`HOME` が呼び出し元と同値」の3条件がすべて満たされたときにだけ成功する代替 claude 実行系（Issue #758 の実測表が示す Keychain 挙動の模倣）を用いる
- When: spec ゲートのゲートレビュアを起動する
- Then: ゲートレビュアが verdict を返し、gate report の final が `human_required` 以外の確定値になる
- 検証方法見込み: `automated`

#### AC-3: macOS の対話ログイン実機で上書きなしに成立する

- Given: macOS で `claude` の対話ログイン済み、環境変数トークン未設定、`GATE_REVIEWER_CMD` 未設定
- When: ゲートレビュア起動スクリプトを spec ゲートに対して実行する
- Then: ゲートレビュアが verdict を返し、gate report の final が `human_required` 以外の確定値になる
- 検証方法見込み: `manual`

#### AC-4: GitHub 資格情報の隔離と read-only 性が維持される

- Given: AC-2 と同じ構成
- When: ゲートレビュアを起動する
- Then: ゲートレビュア子プロセスの環境に `GH_TOKEN`・`GITHUB_TOKEN` が存在せず、`GH_CONFIG_DIR` は隔離領域配下、`GIT_CONFIG_GLOBAL` と `GIT_CONFIG_SYSTEM` は `/dev/null` であり、実行時のカレントディレクトリは Issue の worktree ではなく隔離領域配下であり、既定の起動列はツールを一切許可しない
- 検証方法見込み: `automated`

#### AC-5: 認証不成立時に原因分類が診断として出力される

- Given: 3分類のいずれによっても認証が成立しない構成
- When: ゲートレビュアを起動する
- Then: 標準エラーへ、分類ごとの検出結果と `CLAUDE_CONFIG_DIR` を設定したか否かを含む診断が出力され、gate report の final は `human_required` になる。診断に認証情報の実値は含まれない
- 検証方法見込み: `automated`

#### AC-6: 3分類すべてに自動回帰テストが存在する

- Given: 認証情報の所在3分類（環境変数・設定ディレクトリ配下の通常ファイル・外部資格情報ストア限定）
- When: リポジトリの自動テストを実行する
- Then: claude アダプタのゲートレビュア起動経路を対象とする自動テストが各分類につき最低1件存在し、すべて成功する
- 検証方法見込み: `automated`

## スコープ外

- codex アダプタのゲートレビュアが起動できず stderr 破棄で原因を特定できない件（Issue #744）。本 Issue は claude アダプタの認証経路のみを対象とし、ゲートレビュア起動診断の保全一般は扱わない。
- ゲートレビュアの evidence 投稿が無言で失敗する件（Issue #762）。本 Issue は verdict を得るまでの認証成立を対象とし、verdict 取得後の証跡投稿経路は扱わない。
- セグメント作業ワーカー起動経路の認証判定。本 Issue はゲートレビュア起動経路に限る。
- macOS Keychain 以外の外部資格情報ストア（Linux Secret Service 等）への個別対応。
- 認証情報の取得・更新・失効の管理、および codex アダプタの環境構成の変更。
- 隔離方針そのものの再設計。要件2は呼び出し元の識別情報の受け渡しに限り、隔離領域の構成方式は変更しない。
