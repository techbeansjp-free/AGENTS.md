# SPEC: codex CLI: stdinへ渡すpromptが約64KB付近でUTF-8マルチバイト文字の境界破損を起こし起動失敗する

- Issue: `ISSUE-462`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/462-codex-stdin-utf8-boundary-corruption`

## 目的・背景

`.agent-skill-chain/adapters/codex.sh` の `launch_worker()` は、`.agent-skill-chain/adapters/claude.sh` から取り込んだ共通 lifecycle（`launch_worker` の実体）を経由して起動する。この共通 lifecycle は role_contract 全文を一時ファイルへ書き出し、`bash -c "$worker_cmd" <"$prompt_file"` で stdin 経由により worker プロセスへ渡す。`codex.sh` の既定 `WORKER_CMD` は `codex exec ... -`（末尾の `-` は「stdin から prompt を読む」指示）を組み立てるため、role_contract は常に stdin 経由で Codex CLI へ渡る。

role_contract のサイズがおおむね 64KB（65536 バイト）を超えると、Codex CLI（`codex exec`）が次のエラーで即座に起動失敗する。

```
Failed to read prompt from stdin: input is not valid UTF-8 (invalid byte at offset 65534)
```

Issue #449（`review:light`）の implementation segment で、同一内容の role_contract に対して2回連続で同じバイトオフセット（65534）で再現した。role_contract 自体は正しい UTF-8（日本語テキストを多く含む）であり、ファイル自体の破損ではない。65536（64KiB）に極めて近いオフセットであることから、Codex CLI 側の stdin 読み取り実装が固定サイズ（推測: 64KiB）のチャンク単位で UTF-8 妥当性を検証しており、マルチバイト文字（日本語等）がチャンク境界をまたぐ場合に妥当性検証が誤って失敗すると推測される。ファイルリダイレクト（パイプではない）でも発生することを確認済みであり、OS パイプバッファに起因する問題ではなく Codex CLI 自身の stdin 読み取りロジックの問題と考えられる。

この障害は role_contract のサイズが閾値付近か否かという偶発的な条件で発生し、進行役が都度 `CODEX_WORKER_CMD`（本アダプタが正規サポートするテスト用/一時的な起動系上書き機構）を手動で argv 経由起動のラッパーへ差し替えることでしか回避できていない。この手動回避が不要になるよう、この Issue で恒久対応する。

なお、`.agent-skill-chain/adapters/claude.sh` の `launch_gate_reviewer()` も role_contract 相当の prompt を Codex CLI（`codex exec ... -`）へ pipe 経由の stdin で渡しており、原理上は同一の境界破損リスクを持つ。ただし本 Issue が報告した実際の障害は `launch_worker()` 経由（segment worker 起動）でのみ確認されており、`launch_gate_reviewer()` 側での再現報告は無い。両者は起動箇所・prompt の性質（role_contract vs レビュー用 prompt）が異なるため、本 Issue では `launch_worker()` 経由の起動失敗に対応範囲を限定する（詳細は「スコープ外」参照）。

## 要求 → 要件 → 受入条件

### 要求

進行役（adachi-tatsuru）からの要求: Codex CLI の stdin UTF-8 境界破損バグにより、role_contract サイズが約64KB付近の segment worker 起動が偶発的に失敗する問題を、都度の手動 `CODEX_WORKER_CMD` 上書きに頼らず、`.agent-skill-chain/adapters/codex.sh`（および必要なら `.agent-skill-chain/scripts/worker-launch.sh` 起動経路）側で恒久的に回避できるようにしたい。

### 要件

- 要件1: role_contract のサイズが、実測された破損境界（65534バイト付近）に対して十分な安全マージンを取った閾値を超える場合、Codex adapter 経由の worker 起動は stdin 経由ではなく、Codex CLI が受理できる代替経路（`codex exec` の位置引数 `[PROMPT]` 経由等、stdin のチャンク単位 UTF-8 検証を経由しない起動方法）で prompt を渡す。
- 要件2: 閾値以下の role_contract については、既存の stdin 経由起動を維持し、起動シーケンス・引数構成に退行を生じさせない。
- 要件3: 閾値超過時の代替起動方法でも、通常の stdin 経由起動と同一の model・reasoning effort・sandbox 設定（writable roots・network access 等）が適用される。
- 要件4: `CODEX_WORKER_CMD` / `WORKER_CMD`（テスト用完全上書き機構）が明示的に指定されている場合は、閾値判定・代替起動ロジックを経由せず、指定されたコマンドをそのまま使う既存の優先順位を変更しない。
- 要件5: 対応は自動化されたテストで再現・検証可能な形にする（実際に64KB超の Codex CLI 起動を要求せず、adapter 層のコマンド組み立て・起動経路選択をモック可能な形で検証できること）。

### 受入条件（Acceptance Criteria）

#### AC-1: 閾値超過時に自動的に代替起動経路へ切り替わる

- Given: role_contract のサイズが、実測された破損境界より十分小さい安全マージンを持つ閾値を超えており、日本語等マルチバイト文字を含む
- When: `.agent-skill-chain/adapters/codex.sh` 経由で `launch_worker` を実行する（`CODEX_WORKER_CMD` / `WORKER_CMD` は未指定）
- Then: Codex CLI の起動コマンドが stdin 経由（末尾 `-`）ではなく、role_contract 全文を欠落・破損なく受理できる代替経路で組み立てられる
- 検証方法見込み: `automated`

#### AC-2: 閾値以下では既存のstdin経由起動を維持する（退行なし）

- Given: role_contract のサイズが閾値以下
- When: `.agent-skill-chain/adapters/codex.sh` 経由で `launch_worker` を実行する（`CODEX_WORKER_CMD` / `WORKER_CMD` は未指定）
- Then: 従来通り stdin 経由（末尾 `-`）で prompt が渡され、起動コマンドの組み立てに退行が無い
- 検証方法見込み: `automated`

#### AC-3: 代替起動経路でもmodel・reasoning effort・sandbox設定が既存と同一に保たれる

- Given: role_contract が閾値を超え代替起動経路が選択される状況
- When: worker が起動される
- Then: 通常の stdin 経由起動と同一の model（`_codex_worker_model` が返す値）・reasoning effort（`_codex_worker_effort` が返す値）・sandbox opts（`_codex_worker_sandbox_opts` が返す writable_roots・network_access 等）が適用される
- 検証方法見込み: `automated`

#### AC-4: テスト用完全上書き機構(CODEX_WORKER_CMD/WORKER_CMD)は閾値判定より優先される

- Given: `CODEX_WORKER_CMD` または `WORKER_CMD` が明示的に設定されている
- When: `launch_worker` が呼ばれる（role_contract のサイズに関わらない）
- Then: 閾値判定・代替起動経路選択ロジックを経由せず、指定されたコマンドがそのまま使われる（現行の優先順位を変更しない）
- 検証方法見込み: `automated`

#### AC-5: 手動回避策(CODEX_WORKER_CMDの都度上書き)が不要になる

- Given: 64KB超の role_contract を要する segment（例: Issue #449 で実際に発生した implementation segment 相当の規模）を、通常の `worker-launch.sh` 経路で起動する
- When: 進行役が追加の環境変数上書きを一切行わない
- Then: 「Failed to read prompt from stdin: input is not valid UTF-8」エラーを発生させず worker が起動する
- 検証方法見込み: `hybrid`

## スコープ外

- Codex CLI 自身（上流プロジェクト）の stdin UTF-8 チャンク検証ロジックの修正。本 Issue はこのリポジトリの adapter 層での回避策実装のみを扱う。上流への障害報告は本 Issue のスコープ外であり、別途対応する。
- `.agent-skill-chain/adapters/claude.sh` の `launch_gate_reviewer()` が Codex CLI をレビュアとして起動する経路（gate reviewer prompt も pipe 経由の stdin で渡っており、原理上同一の境界破損リスクを持つが、本 Issue が報告した実障害の再現箇所ではない）。同種の破損が gate reviewer 経路で実際に確認された場合は、別 Issue として扱う。
- Claude adapter（`claude` CLI）経由の worker/gate reviewer 起動。本 Issue が報告した障害は Codex CLI 固有の stdin 読み取り実装に起因し、Claude CLI での同種の障害報告は無い。
- 代替起動経路の具体的な閾値の数値、実装箇所（`codex.sh` 内で完結させるか `worker-launch.sh` 側の変更を伴うか）、閾値の設定可否（`.agent-skill-chain/config/agent-skill-chain.yaml` への項目追加要否）。これらは DESIGN.md で確定する設計判断であり本 SPEC の対象外。
