# SPEC: Codex ゲートレビュアの起動失敗を安全に診断可能にする

- Issue: `ISSUE-744`
- 作成者: `run-4317ac39`
- 対象ブランチ: `bugfix/744-codex-reviewer-stderr-diagnostics`
- risk: `high`

## 目的・背景

Codex アダプタのゲートレビュアが非ゼロで終了した際、終了コード以外の情報が失われ、モデル不一致、
認証不成立、実行系異常などを運用者が判別できない。2026-08-19 の実測では、non-core review はモデル未指定で
5回 `rc=1` となり、`CODEX_REVIEWER_MODEL=gpt-5.6-sol` の明示後に起動して evidence を返した。一方、過去の
失敗時 stderr は破棄済みであるため、モデル指定が直接原因だったとは確定していない。

本 Issue は、失敗原因を秘密情報非漏えいのまま分類できるようにし、non-core Codex reviewer が利用不能な
暗黙の既定モデルへ黙って倒れる経路をなくす。原因がこの範囲外と判明した場合は、要求を拡張せず、事実と
再現可能な実測証跡を報告する。

## 対象・前提・用語

- 対象は Codex アダプタから起動されるゲートレビュアと、その共通の隔離実行・失敗報告契約である。
- `non-core` は project policy による core review 能力証明が要求されないレビューを指す。
- `安全な診断` は、安定した失敗分類、終了コード、試行回数、秘密値を含まない原因要約を指す。分類は少なくとも
  model unavailable、authentication failure、timeout、その他の execution failure を判別できる。
- `raw stderr` はレビュアプロセスが出力した未加工の標準エラー出力を指す。
- `秘密値` は provider token、認証ファイル内容、環境変数に渡された資格情報、および診断へ出してはならないと
  launcher が識別できる credential 由来の値を指す。
- 検証は代替レビュアと注入した認証・stderr を用いて自動化し、実サービスや実資格情報への疎通を前提にしない。
- core review の Codex model・reasoning・read-only 能力証明は project policy の一致を引き続き必須とする。

## 入力と出力

### 入力

- ゲートレビュア起動要求、core/non-core 区分、review profile、対象 SHA、既存の再試行・時間上限設定。
- 明示された `CODEX_REVIEWER_MODEL` と、core review に必要な project policy の model・reasoning・attestation。
- 隔離環境へ許可済みの認証素材、およびレビュアプロセスの終了コードと stderr。

### 出力

- 成功時は従来どおりの verdict。
- 失敗時は `human_required`、非ゼロ終了、never-approved を維持した安全な診断。
- non-core の暗黙モデルが利用不能な場合は `NONCORE_DEFAULT_MODEL_UNAVAILABLE` と判別できる診断。

## 要求 → 要件 → 受入条件

### 要求

運用者は、Codex ゲートレビュアの起動失敗を再発時に安全かつ再現可能な証跡から切り分けたい。同時に、
診断の追加によって provider 資格情報、read-only 隔離、core review の能力証明、既存のフェイルセーフを
弱めてはならない。

### 要件

- `REVIEWER_STDERR_DISCARDED`: レビュアが非ゼロ終了した場合だけ、stderr を隔離領域内で最大 64 KiB まで
  捕捉する。超過は打ち切りとして示し、隔離領域外へ raw stderr を複製しない。
- 外部へ出す診断本文は最大 4 KiB とし、安定した分類、終了コード、試行回数、切り詰め有無を含める。
  stderr は事前定義された原因分類の導出にだけ使い、raw stderr の全文・抜粋・未検査断片を出力しない。
- 安全な診断は秘密値検査を通過した情報だけを出力・保存する。秘密値を安全に除去できない場合は内容を
  省略し、分類と終了コードだけを残す。
- raw stderr、prompt、出力、複製した認証ファイルは永続化しない。隔離領域は成功・失敗・時間上限超過の
  いずれでも削除する。永続化できるのは安全な診断だけである。
- `NONCORE_DEFAULT_MODEL_UNAVAILABLE`: non-core で明示 model が無い場合、利用可能性を保証できない
  `gpt-5.6` を暗黙の既定値として選ばない。選択した既定 model が利用不能なら、一般的な `rc=1` だけで
  終わらせず、この分類を含む安全な診断へ倒す。
- non-core の明示 model override は値と優先度を維持する。core review では project policy の model、
  reasoning effort、完全 command override の attestation を維持し、non-core の既定解決で代替しない。
- 認証 probe、read-only 隔離、固定環境、watchdog と時間上限、再試行、非ゼロ終了、never-approved、
  `human_required` の既存契約を維持する。
- 成功経路では診断追加前と同じ verdict を返し、一時的な stderr や認証素材を残さない。

### 受入条件（Acceptance Criteria）

#### AC-1: 非ゼロ終了の原因を安全な診断で判別できる

- Given: 代替 Codex reviewer に model unavailable、authentication failure、timeout、その他の execution failure を個別に注入する
- When: non-core のゲートレビュア起動が既定の再試行を終える
- Then: 各原因は相互に判別できる安定した分類となり、終了コード、試行回数、秘密値を含まない原因要約を示す
- 検証方法見込み: `automated`

#### AC-2: stderr 捕捉と外部診断が有界である

- Given: 代替 reviewer が 64 KiB を超える stderr を出して非ゼロ終了する
- When: 起動失敗の診断を生成する
- Then: 捕捉は 64 KiB で打ち切られ、外部診断は 4 KiB 以下で切り詰め有無を示す
- 検証方法見込み: `automated`

#### AC-3: 秘密値と raw stderr を永続化しない

- Given: 認証ファイル、環境変数、stderr に識別可能な秘密値と通常の診断文字列が含まれる
- When: reviewer が成功、非ゼロ終了、時間上限超過の各経路を終える
- Then: launcher の診断出力、安全な診断、追跡対象ファイル、一時領域の残存物のいずれにも秘密値と raw stderr の全文・抜粋がなく、隔離領域も残らない
- 検証方法見込み: `automated`

#### AC-4: 秘密値を除去できない場合も安全側へ倒れる

- Given: stderr の内容を安全な診断へ変換できない失敗が注入される
- When: 非ゼロ終了を報告する
- Then: stderr 内容は省略され、分類と終了コードだけが出力され、`human_required` と非ゼロ終了になる
- 検証方法見込み: `automated`

#### AC-5: non-core の利用不能な暗黙既定を識別する

- Given: non-core で `CODEX_REVIEWER_MODEL` が未指定かつ選択された既定 model が利用不能である
- When: 代替 reviewer が model unavailable を返す
- Then: reviewer 起動に `gpt-5.6` を暗黙選択せず、利用不能時は `NONCORE_DEFAULT_MODEL_UNAVAILABLE` と判別できる安全な診断になる
- 検証方法見込み: `automated`

#### AC-6: 明示 model override を保持する

- Given: non-core で `CODEX_REVIEWER_MODEL` に任意の model identifier が明示されている
- When: reviewer 起動コマンドが組み立てられる
- Then: 明示値が変更されず最優先で reviewer へ渡り、暗黙既定へ置換されない
- 検証方法見込み: `automated`

#### AC-7: core review の能力証明を緩めない

- Given: core review で model、reasoning effort、または完全 command override の attestation が project policy と不一致である
- When: Codex reviewer の起動を要求する
- Then: reviewer を承認可能な状態で起動せず、`human_required` と非ゼロ終了になり、non-core の既定解決で代替されない
- 検証方法見込み: `automated`

#### AC-8: 既存の停止・隔離・再試行契約を維持する

- Given: 代替 reviewer に認証不成立、通常の非ゼロ終了、時間上限超過、成功をそれぞれ注入する
- When: Codex ゲートレビュアを実行する
- Then: 認証 probe、read-only 隔離、watchdog、再試行、非ゼロ、never-approved、`human_required`、成功時 verdict の既存挙動が回帰せず、全経路で隔離領域が削除される
- 検証方法見込み: `automated`

## 制約・完了条件・未決事項

- 仕様・実装・検証で使用する資格情報は偽値に限り、実サービス成功や実認証疎通を完了条件にしない。
- 全 AC を自動テストで検証し、build、既存テスト、secret 検査を成功させる。
- 本 Issue の各ゲートは round 2 を最終とする。最終後も blocking とするのは、既出未是正、Issue 目的の直接阻害、
  テスト・build 失敗または回帰、データ喪失またはセキュリティ低下に限る。`risk:high` のためデータ喪失・
  セキュリティ低下は例外なく blocking とし、それ以外の新規指摘は warning として別 Issue へ分離する。
- 未決事項はない。真因が範囲外と判明した場合は、本仕様を拡張せず実測証跡とともに進行役へ報告する。

## スコープ外

- Issue #751 が扱う prompt 入力閉包。
- Issue #715 が扱う verdict stdout の secret 検査および実行パスの信頼境界。
- Claude 固有の認証成立条件、資格情報ストア取得 stderr、model 選択。
- core review 対象判定、review profile、証跡投稿・集約方式の変更。
- provider CLI 全般の将来互換層、実サービスの可用性保証、実資格情報による疎通確認。
