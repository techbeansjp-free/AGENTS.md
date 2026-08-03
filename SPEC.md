<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: gate reviewer prompt digest がclone間のgit abbrev桁数差で再現不能

- Issue: `ISSUE-369`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/369-gate-reviewer-prompt-abbrev-digest-mismatch`

## 目的・背景

`gate reviewer-prompt`（`buildReviewerPrompt()`）が組み立てるレビュア判定プロンプトには、判定対象成果物の `git diff` 出力が「判定対象の差分」セクションとしてそのまま埋め込まれる。この diff 出力の `index <abbrev-old>..<abbrev-new>` 行が使う省略hashの桁数は、実行時に git が採用する `core.abbrev`（既定 `auto`）の値に依存し、**その値はリポジトリが保持する総オブジェクト数によって変動する**。

この結果、同一の `(issue_number, gate_id, target_sha, base_sha)` を与えて `gate reviewer-prompt` を実行しても、実行するclone（新規clone・履歴を蓄積した使い回しclone・CIのcheckout・進行役のローカルclone等）が保持する総オブジェクト数が異なれば、プロンプト本文のbyte列が変わり、`evidencePromptDigest()` が算出する `prompt_digest` も変わる。

`gate verify-evidence`（CI の `verify-and-publish` job、および進行役が手動実行する `gate-local-review.sh` 経由のローカル検証の両方が内部で用いる）は、`expectedPromptDigest` を検証実行時のcloneで独自に再計算し、review evidence に記録済みの `prompt_digest` と比較する（一致しなければ `review ${review.id} のprompt digestが一致しません` で失敗する）。生成時clone・検証時clone間で総オブジェクト数が完全一致しない限りこの比較は成立し得ないため、strict profile（2レビュア）を要求する全Issueのspec/design/implementation/validation各ゲートで、review evidence投稿後の検証が非決定的に失敗し得る。

Issue #351（PR #357）のspec-gate strictレビューでは、同一の `(number='351', gateId='spec', targetSha=d0005f4e345c9725ff6172a082ac347af19dd004, baseSha=dab4baa8a0821ef281f19e2b4a61d64cf04008c3)` に対し3つの異なるclone環境で `gate reviewer-prompt` を実行し、index行のhash桁数（7桁／8桁）差に起因する3種類の異なる `prompt_digest` を得た。これにより GitHub Actions の `verify-and-publish (spec)` Check Run が直近複数ラウンドにわたり継続的に `human_required` へ倒れ続けている。

本 Issue は #351 固有の不具合ではなく、gate評価システムが `prompt_digest` の一致を再現性の担保に用いている全箇所に影響する、ゲート評価の再現性そのものに関する不具合である。

## 要求 → 要件 → 受入条件

### 要求

`gate reviewer-prompt` が生成するレビュア判定プロンプト（および、それを基に算出される `prompt_digest`）は、実行するcloneが保持する総オブジェクト数などのローカルなgit状態に依存せず、同一の `(issue_number, gate_id, target_sha, base_sha)` の組に対して常に同一のbyte列・同一のdigestを生成しなければならない。これにより、review evidence投稿時のclone（gate-local-review.sh等）と、その後の検証時のclone（CIのverify-and-publish job・進行役の別clone等）が異なっていても `gate verify-evidence` が正しく成功できる状態を回復する。

### 要件

- `gate reviewer-prompt` の出力バイト列は、判定対象の `target_sha`・`base_sha`・成果物内容・AC-ID一覧が同一である限り、実行環境（clone内の総オブジェクト数・履歴の深さ・`core.abbrev` 設定等のローカルなgit状態）に左右されず一意に定まらなければならない。
- 上記の決定性は、プロンプトに埋め込まれる `git diff` 出力（「判定対象の差分」セクション）を含め、プロンプト全体に対して成立しなければならない。
- 既存の `gate submit-evidence` → `gate verify-evidence` の往復フローの入出力契約（`prompt_digest` を比較して一致検証する、という契約自体）は変更しない。プロンプト生成結果を決定的にすることで往復を成立させる。

### 受入条件（Acceptance Criteria）

#### AC-1: reviewer-prompt の差分セクションが省略なしの固定長full hash digestを用いる

- Given: 判定対象の `(issue_number, gate_id, target_sha, base_sha)` が与えられている
- When: `gate reviewer-prompt` を実行する
- Then: 出力される「判定対象の差分」セクション内の全ての `index <old>..<new>` 行が、gitの`--abbrev`が持つ「リポジトリ内での一意性確保のために桁数を自動的に伸長する」機構に一切依存しない、省略しない完全な桁数のfull hex digest（`--full-index`相当。使用するハッシュアルゴリズムがSHA-1なら40桁、SHA-256なら64桁の完全な16進数表現）を用いる。固定7桁・固定8桁のような「一定の桁数」の省略hashを採用する実装は、cloneの総オブジェクト数によっては当該固定桁数でも一意性確保のためgitがさらに桁数を伸長し得るため、本ACを満たさない。
- 検証方法見込み: `automated`

#### AC-2: 総オブジェクト数が異なり、かつ省略hashの一意性伸長が実際に発生し得る条件を含む複数clone環境でのreviewer-prompt出力が完全一致する

- Given: 同一の `(issue_number, gate_id, target_sha, base_sha)` に対応する内容を持つが、総オブジェクト数が大きく異なる（例: 新規cloneと、複数ラウンドのfetchを蓄積したclone、および意図的に大量のオブジェクトを追加投入して省略hashの一意性伸長が実際に発生する状態を再現したclone）2つ以上のclone環境が用意されている
- When: 各clone環境でそれぞれ独立に `gate reviewer-prompt` を実行する
- Then: 得られる出力バイト列が全clone間で完全に一致し、`evidencePromptDigest()` によるdigestも完全に一致する。加えて、出力中の全ての `index <old>..<new>` 行がAC-1の定義する省略しない完全な桁数のfull hex digestであり、それに満たない桁数の省略hash表記が一切出現しないことを、テキストパターン照合により機械的に検証する
- 検証方法見込み: `automated`

#### AC-3: 生成clone・検証cloneが異なる場合でも gate submit-evidence → gate verify-evidence の往復が成功する

- Given: あるcloneで `gate reviewer-prompt` を実行して得たプロンプトに基づき reviewer が判定を行い、`gate submit-evidence` で review evidence（`prompt_digest` を含む）が記録されている
- When: 上記とは総オブジェクト数が異なる別のcloneで `gate verify-evidence` を実行し、`expectedPromptDigest` を再計算して比較する
- Then: `review ${review.id} のprompt digestが一致しません` エラーが発生せず、`gate verify-evidence` が成功する
- 検証方法見込み: `automated`

#### AC-4: 既存のreviewer-prompt出力契約（差分・hash以外の内容）が変化しない

- Given: 修正前後で同一の `(issue_number, gate_id, target_sha, base_sha)` を与える
- Then: 「判定対象の差分」セクション内のhash桁数表記を除き、プロンプトの他の内容（ルーブリック文言・AC-ID一覧・出力JSON契約・判定対象成果物の本文・上流成果物の本文）は修正前と同一である
- 検証方法見込み: `automated`

## スコープ外

- `prompt_digest` の比較アルゴリズム自体（`evidencePromptDigest()` のハッシュ関数選定、`gate verify-evidence` の比較ロジック）の変更。
- diff以外の要因（成果物本文・AC-ID抽出ロジック・ルーブリック文言等）に起因する `prompt_digest` 不一致の解消。
- Issue #351（PR #357）で既に `human_required` へ倒れた既存のspec-gate判定ラウンドの再実行・救済。
- `core.abbrev` 以外のgit設定差異（例: `diff.algorithm`、改行コード正規化設定）に起因するプロンプト非決定性の網羅的な調査・対応。本 Issue の観測範囲は index行の省略hash桁数に限定する。
- strict profile以外のレビュープロファイル（Standard）における同種の問題への対応（Standardでも理論上同一の原因が影響し得るが、本 Issue の受入条件はstrict/Standardを区別せず `gate reviewer-prompt` の決定性そのものを対象とするため、追加のスコープ外事項はない）。
