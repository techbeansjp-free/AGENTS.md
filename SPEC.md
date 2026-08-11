# SPEC: writer leaseの現在状態を副作用無しで確認できる読み取り専用コマンドが無く、Issueコメントの古い記録を誤って現在状態と誤認しうる

- Issue: `ISSUE-602`
- 作成者: `spec_worker`
- 対象ブランチ: `process/602-lease-status-command`

## 目的・背景

writer lease の実際の現在状態（holder・segment・acquired_at・expires_at・有効期限までの残り時間）を、副作用を一切伴わずに確認できる手段が存在しない。既存の `agent-skill-chain lease` サブコマンドは `acquire`・`renew`・`release`・`resume`・`reclaim` の5つのみであり、いずれも呼び出しにより writer lease の状態そのものを変更する（新規取得・更新・削除）操作である。

GitHub Coordination Backend では writer lease の正本は Issue 専用の git ref（`refs/agent-skill-chain/leases/<issue_number>-<segment>`、compare-and-set）であり、Issue コメントへの投稿は取得時のみ行われる human 向け可視性目的の best-effort 処理であって、以後の renew のたびに更新される保証は無い。ローカル Coordination Backend では正本は Issue 毎の lease ファイル（Git 管理下）である。

2026-08-11、本リポジトリ自身の開発セッションで、進行役が ISSUE-588 の validation セグメントの lease 状態を確認する目的で GitHub Issue のコメント欄に残っていた最新投稿を読んだところ、そこに記載された `expires_at` は初回 acquire 時点の値のままであり、その後の renew によって git ref 側で更新済みだった実際の `expires_at`（Issue コメントの記載より大幅に新しい時刻）と一致していなかった。この記載の乖離により、進行役は「lease が実際には期限切れで renewal が機能していない」と誤って判断し、reclaim（回収）へ進もうとした。真の現在状態は `worker-launch.sh` 実行時に発生した「既存の writer lease と競合しています」というエラーメッセージから、副作用を伴う操作の結果としてのみ確認できた。

このように、進行役が writer lease の真の現在状態を確認する読み取り専用の手段を持たないことは、(a) Issue コメントという古くなり得る間接情報にのみ依拠した誤判断を誘発し、(b) 状態確認のために `acquire` 等の状態変更を伴う操作を代用せざるを得ず、稀なタイミングでの意図しない lease 横取りのリスクを伴う、という2つの実害を生む。本 Issue は、正本（GitHub モードは git ref、ローカルモードは Git 管理下の lease ファイル）から直接、副作用無しに現在状態を取得・表示する読み取り専用コマンドを新設することで、この誤判断の誘発と回避不能な副作用依存を解消する。

## 用語

- **writer lease**: `.agent-skill-chain/schemas/lease.schema.yaml` が定義する、Issue の1セグメントに対して同時に1つのみ許可される書き込み権限の証跡（`issue_id`・`holder`・`segment`・`acquired_at`・`expires_at`・`token`）。
- **正本**: GitHub Coordination Backend では Issue 専用の git ref（`refs/agent-skill-chain/leases/<issue_number>-<segment>`、compare-and-set）。ローカル Coordination Backend では Issue 毎の Git 管理下 lease ファイル。いずれも Issue コメントや進行役の記憶ではない。
- **副作用**: lease の取得・更新・削除、または Issue へのコメント投稿など、呼び出し前後で調整状態・可視化情報のいずれかを変更する処理。読み取り専用コマンドはこれを一切行わない。

## 前提

- 対象は GitHub Coordination Backend・ローカル Coordination Backend の両方であり、`.agent-skill-chain/config/agent-skill-chain.yaml` の `coordination.backend`（`github` | `local`）に応じて参照する正本が切り替わる。
- 本コマンドの呼び出し主体は進行役に限定されない。writer lease を保持しないセグメントワーカー・レビュア・人間のいずれからも、副作用を発生させずに現在状態を確認できる必要がある。
- 既存の `lease acquire`・`lease renew`・`lease release`・`lease resume`・`lease reclaim` の入出力契約（標準出力・標準終了コード・エラー表示形式）は本 Issue の対象外であり、変更してはならない。

## 要求 → 要件 → 受入条件

### 要求

進行役およびその他の呼び出し主体が、対象 Issue（および任意でセグメント）の writer lease の実際の現在状態を、正本（GitHub モードは git ref、ローカルモードは Git 管理下 lease ファイル）から直接、状態変更や Issue コメント投稿等のいかなる副作用も発生させずに確認できなければならない。確認結果は、lease が存在しない場合と期限切れの場合を、それぞれ他の状態と区別可能な形で示さなければならない。

### 要件

- 読み取り専用の `agent-skill-chain lease status <issue_id> [segment]` コマンドを新設する。`segment` を省略した場合は対象 Issue の有効な writer lease（複数存在し得る場合は全件）を対象とする。
- 出力元は Coordination Backend の正本のみとする。GitHub モードでは Issue コメントの記載内容を出力の根拠に用いてはならない。
- コマンドの実行は、呼び出し前後で lease の取得・更新・削除、および Issue へのコメント投稿を一切発生させてはならない。
- 出力は人間可読な要約表示を既定とし、機械可読な構造化データ（例: `--json`）も選択的に取得できなければならない。
- lease が存在しない場合と、lease は存在するが `expires_at` を現在時刻が超過している（期限切れ）場合を、それぞれ区別可能な形で出力しなければならない。両者とも、コマンド自体の異常終了（未知のエラー）とは区別されなければならない。
- 既存の `lease acquire`・`lease renew`・`lease release`・`lease resume`・`lease reclaim` の動作・入出力契約に回帰があってはならない。

### 受入条件（Acceptance Criteria）

#### AC-1: 有効なwriter leaseの現在状態を副作用無しで正本から取得・表示する

- Given: 対象 Issue の対象セグメントに有効な writer lease（`expires_at` が現在時刻より未来）が、Coordination Backend の正本（GitHub モードは git ref、ローカルモードは Git 管理下 lease ファイル）に存在する状態
- When: `agent-skill-chain lease status <issue_id> <segment>` を実行する
- Then: 終了コード0で、正本から直接取得した現在の `holder`・`segment`・`acquired_at`・`expires_at`・有効期限までの残り時間が標準出力へ表示される。かつ、実行前後で当該 lease の内容（正本の値）・Issue コメント一覧のいずれにも変化が無い
- 検証方法見込み: `automated`

#### AC-2: Issueコメントの記載内容ではなく正本の値を返す

- Given: GitHub モードで、Issue コメント欄に残る最新の lease 記載内容（例: 初回 acquire 時の `expires_at`）と、その後の renew によって git ref 上で更新済みの実際の `expires_at` が異なる状態
- When: `agent-skill-chain lease status <issue_id> <segment>` を実行する
- Then: 出力される `expires_at` は git ref 上の実際の値と一致し、Issue コメント記載の古い値とは一致しない（一致しない状況を再現できるケースで検証する）
- 検証方法見込み: `automated`

#### AC-3: leaseが存在しない場合と期限切れの場合を区別可能な形で出力する

- Given: (a) 対象 Issue・セグメントに writer lease が一度も取得されていない状態、および (b) 対象 Issue・セグメントに writer lease は存在するが `expires_at` を現在時刻が超過している状態、の2ケース
- When: それぞれのケースで `agent-skill-chain lease status <issue_id> <segment>` を実行する
- Then: (a) では「lease が存在しない」ことを示す出力が、(b) では「lease は存在するが期限切れである」ことを示す出力が、互いに区別可能な形で返る。いずれも、コマンド自体が異常終了した場合（例: 対象 Issue が存在しない、Coordination Backend への接続に失敗した）の出力とも区別可能である
- 検証方法見込み: `automated`

#### AC-4: 機械可読な構造化出力を選択的に取得できる

- Given: 対象 Issue に有効な writer lease が存在する状態
- When: `agent-skill-chain lease status <issue_id> <segment>` を構造化出力オプション（例: `--json`）付きで実行する
- Then: `holder`・`segment`・`acquired_at`・`expires_at` を含む構造化データが標準出力へ返り、機械的にパース可能である
- 検証方法見込み: `automated`

#### AC-5: segmentを省略した場合、対象Issueの有効なwriter leaseを取得できる

- Given: 対象 Issue に有効な writer lease が存在する状態
- When: `agent-skill-chain lease status <issue_id>`（segment省略）を実行する
- Then: 対象 Issue に紐づく有効な writer lease の状態が、segment を明示した場合と同等の情報量で表示される。対象 Issue に有効な writer lease が複数存在する場合は、いずれも欠落せず表示される
- 検証方法見込み: `automated`

#### AC-6: 呼び出しにwriter lease credentialや書き込み権限を要求しない

- Given: ローカルに writer lease credential（`lease acquire` 等が保存するもの）を保持していない実行主体、かつ Coordination Backend への書き込み権限を持たない実行主体
- When: 対象 Issue に有効な writer lease が存在する状態で `agent-skill-chain lease status <issue_id> [segment]` を実行する
- Then: credential 不在・書き込み権限不在を理由に失敗せず、読み取り可能な範囲で現在状態を返す
- 検証方法見込み: `manual`

#### AC-7: 既存のlease系サブコマンドの動作・出力に回帰が無い

- Given: 本 Issue の変更を適用した状態
- When: 既存の `lease acquire`・`lease renew`・`lease release`・`lease resume`・`lease reclaim` を、変更前と同一の入力で実行する
- Then: 標準出力・標準エラー出力の内容形式・終了コードが変更前と同一である
- 検証方法見込み: `automated`

## スコープ外

- Issue コメントへの lease 記載内容そのものを renew のたびに更新する設計変更（本 Issue の由来に記載の通り、過度なノイズを避けるための既存の妥当な設計判断であり、変更対象としない）。
- `lease acquire`・`lease renew`・`lease release`・`lease resume`・`lease reclaim` 自体の判定ロジック・writer lease の排他方式の変更。
- writer lease の正本（GitHub モードの git ref・ローカルモードの lease ファイル）の保存形式・スキーマ（`.agent-skill-chain/schemas/lease.schema.yaml`）自体の変更。
- 進行役以外の役割（セグメントワーカー・レビュア）が本コマンドをどの局面で呼び出すべきかの運用手順の規定（AGENTS.md・運用成果物側の変更判断は本 Issue の対象外）。
- WIP 上限判定（有効 writer lease 数のカウント）ロジックの変更。
