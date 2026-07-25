# SPEC: Codex の役割別モデル選択ルールと実行設定を追加する

- Issue: `ISSUE-240`
- 作成者: `Codex worker`
- 対象ブランチ: `feature/240-codex-model-selection`

## 目的・背景

このプロジェクトは Claude・Codex・human のアダプタを提供するが、既存のモデル選択表は Claude 固有のモデル名だけを使用し、Codex アダプタは常に未構成として停止する。そのため、Codex を選択した場合に役割に適した能力・reasoning effort を選べず、マルチAI対応の契約も実行できない。

本 Issue は、役割から能力ティアを選ぶ共通ルールと Codex 固有のモデル対応を定義し、Codex の worker と gate reviewer を安全に起動可能にする。

## 要求 → 要件 → 受入条件

### 要求

Codex を実行アダプタとして選択したとき、Claude と同じ役割・writer lease・ゲートの安全契約を保ちつつ、作業の難度に適した Codex モデルと reasoning effort を機械的に選択する。

### 要件

- 共通ポリシーは特定ベンダーのモデル名ではなく、役割と能力ティアで記述する。
- Codex の reviewer、仕様・設計・検証 worker、実装 worker、軽量な調査・定型処理の具体的なモデルと reasoning effort を定義する。
- Codex adapter は、reviewer を read-only sandbox で、worker を workspace-write sandbox で起動する。
- 認証・CLI 不在・起動失敗・timeout・不正な完了報告は、既存の I8 に従い human_required または blocked へ倒す。
- 選択値と起動フラグは自動テストで検証し、Claude/human の既存テストを回帰させない。

### 受入条件（Acceptance Criteria）

#### AC-1: ベンダー中立の役割ポリシー

- Given: モデル選択表を読む利用者
- When: 設計、レビュー、実装、調査、定型作業の選択規則を確認する
- Then: 共通規則が Claude 固有のモデル名でなく能力ティアと reasoning effort で表現され、各ベンダーの対応表が分離されている
- 検証方法見込み: `manual`

#### AC-2: Codex の役割別対応

- Given: Codex adapter を選択した worker または reviewer
- When: 各役割を起動する
- Then: reviewer と高難度 worker は高能力・high reasoning、実装 worker はバランス型・medium reasoning、軽量作業は高速型・low reasoning の対応に従う
- 検証方法見込み: `automated`

#### AC-3: Codex reviewer の安全な起動

- Given: 有効な gate report と Codex 認証済み環境
- When: Codex reviewer を起動する
- Then: `codex exec` は read-only sandbox、選択済み model・reasoning effort、レビュー用 prompt で起動し、妥当な verdict のみを gate report に記録する
- 検証方法見込み: `automated`

#### AC-4: Codex worker の安全な起動

- Given: writer lease を取得可能で Codex 認証済みの環境
- When: Codex worker を起動する
- Then: `codex exec` は workspace-write sandbox と役割別 model・reasoning effort で起動し、既存の lease 更新、完了SHA照合、blocked/release 契約を満たす
- 検証方法見込み: `automated`

#### AC-5: 異常時の安全側遷移

- Given: Codex CLI 不在、認証不成立、起動失敗、timeout、または完了報告不正のいずれか
- When: Codex adapter を起動する
- Then: reviewer は human_required、worker は blocked へ遷移し、成功終了にはならない
- 検証方法見込み: `automated`

#### AC-6: 他アダプタの非退行

- Given: Claude または human adapter を選択した既存の実行経路
- When: 全テストを実行する
- Then: 既存の adapter 契約が維持される
- 検証方法見込み: `automated`

## スコープ外

- Claude のモデル名・起動方式の変更。
- human adapter の通知・非同期作業方式の変更。
- Codex Cloud の既定モデル変更（ローカル CLI/プロジェクトの adapter 実行のみを対象とする）。
- ベンダー別の料金・レート制限の動的最適化。
