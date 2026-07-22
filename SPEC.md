<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — setupバックエンド分岐是正・doctor網羅性拡張・PRテンプレート実運用徹底・ADR手順逸脱ガード

- Issue: `ISSUE-188`
- 作成者: `claude`
- 対象ブランチ: `feature/188-ops-quality-fixes`

## 目的・背景

過去のチェックリスト照合と再監査（読み取り専用サブエージェントによる実測）で、相互に独立した4件の運用品質ギャップが確認された。いずれも既存機能の穴・実運用と実装の乖離であり、放置すると誤ったバックエンドへの適用・監視の見落とし・規約逸脱の常態化を招く。本 Issue はこの4件をまとめて解消する。

1. **setup（引数無し）のバックエンド分岐欠如**: `setup()` は非推奨警告を出したのち、設定の coordination backend の値に関わらず GitHub 固有処理（テンプレート同期・`gh` API 経由の label 作成・ruleset 適用）を無条件に実行する。backend を参照する分岐が存在しないため、local バックエンド運用のリポジトリで setup を実行すると不要な GitHub 操作が走る。

2. **doctor の検査網羅性不足**: `doctor` は現在9カテゴリ（git 有無・git リポジトリ・設定ファイル・worktree 命名規約・template-sync・gh CLI・gh auth・main worktree clean・schemas 構文）のみを検査する。運用上重要な複数の健全性観点（例: branch 名規約・Check Run 状態・label projection・writer lease 状態・ADR 状態滞留・system-spec manifest 整合性・requirement ID 採番一貫性・Durability Backend 疎通）が未実装で、異常が沈黙する。

3. **PR 本文テンプレートが実運用で使われない**: `pr create` はテンプレート各節を読み込み Issue 成果物から自動充填する実装を持つが、直近の実 PR はいずれもこの経路を通らず生の `gh pr create` で作成されている。ワーカーの実行許可（claude adapter の allowed-tools）に `gh pr create` が並列で含まれ、実装済みラッパーを迂回できてしまうためである。結果としてテンプレート形式が徹底されない。

4. **ADR finalize 手順逸脱の再発余地**: ADR の status を `proposed → accepted` へ遷移させる正規手順は、設計ゲート承認後に専任ワーカーが `adr finalize` CLI で writer lease を取得して status のみ更新することである。過去に、この経路を通らず設計フェーズの同一 commit で設計文書と共に status が直接編集された逸脱が発見された。現状 ADR 検査は accepted 後の不変項目の変更のみを見ており、status 変更が finalize 経路を通ったかを検査するガードが無い。

## 用語

- **coordination backend**: 調整状態の正本をどこに置くかの設定値。GitHub モード（Issue・PR・branch・Check Run が正本）と local モード（Git 管理下の状態ファイルが正本）がある。
- **GitHub 固有処理**: `.github/` テンプレート同期、`gh` API 経由の label 作成、ruleset 適用など、GitHub モードでのみ意味を持つ副作用を伴う処理。
- **allowed-tools**: ワーカー起動時に実行系（claude CLI）へ渡す実行許可リスト。ここに含まれるコマンドだけがワーカーの自動実行を許される。
- **finalize 経路**: ADR の status を `adr finalize` CLI 経由で更新する正規手順。writer lease 取得・設計ゲート承認済み digest 照合・status 行のみの書換え・専用メッセージ形式の commit を伴う。
- **手順逸脱**: 内容の正否とは別に、finalize 経路を通さず ADR の status を変更する行為。本 Issue のガード対象。

## 要求 → 要件 → 受入条件

### 要求

- local バックエンド設定時に setup（引数無し）を実行しても GitHub 固有処理が無条件に走らない状態にしたい。
- doctor が現行9カテゴリに加え、実装可能な追加観点で運用上の異常を検知できる状態にしたい。追加できない観点は理由を独立検証成果物に記録したい。
- ワーカーが実 PR を作成する際、テンプレート形式の本文が実効的に徹底され、迂回による生 `gh pr create` が抑止される状態にしたい。
- finalize 経路を通らない ADR status 変更を機械的に検知し、手順逸脱の再発を防ぎたい。
- 上記変更後も統合ブランチ上の既存テストスイート全件が引き続き通る状態を維持したい。

### 要件

- **要件1（setup バックエンド分岐）**: setup（引数無し）に coordination backend を参照する分岐を追加し、local バックエンド設定時は GitHub 固有処理をスキップするか明示的な確認を要求する。GitHub モード時の挙動は現状を維持する。
- **要件2（doctor 網羅性拡張）**: 追加可能な健全性検査観点を doctor へ実装し、各追加検査が不整合状態を検知するようにする。技術的に実装不能な観点は独立検証成果物に理由を記録し対象外とする。
- **要件3（PR テンプレート徹底）**: claude adapter の allowed-tools 設計を見直し、`pr create` ラッパーの使用を実効化する。手段は生 `gh pr create` を許可リストから外す、または使い分けルールを規範文書へ明記し lint で検査する、のいずれか。
- **要件4（ADR 逸脱ガード）**: ADR status の変更が finalize 経路の commit かを検査するガードを、ADR lint またはゲート判定へ軽量に追加する。既存の逸脱事例の遡及是正は行わない。
- **要件5（回帰なし）**: 上記4件の変更後、統合ブランチ上の既存テストスイート全件が引き続き通る。

### 受入条件（Acceptance Criteria）

各 AC には散文形式の Given/When/Then を添える。AC-ID は `^AC-[0-9]+$` の形式に従う。

#### AC-1: local バックエンド時に setup が GitHub 固有処理を無条件実行しない（要件1）

- Given: coordination backend が local に設定されたリポジトリ
- When: setup（引数無し）を実行する
- Then: GitHub 固有処理（label/ruleset 適用等）が無条件には実行されず、スキップされるか明示的確認を要求する。この差が実機またはテストで実測される
- 検証方法見込み: `hybrid`

#### AC-2: GitHub バックエンド時の setup 挙動が後退しない（要件1）

- Given: coordination backend が GitHub に設定されたリポジトリ
- When: setup（引数無し）を実行する
- Then: 従来どおり GitHub 固有処理が実行される。分岐追加による GitHub モードの機能後退が無いことを確認する
- 検証方法見込み: `automated`

#### AC-3: 追加した doctor 検査が不整合状態を検知する（要件2）

- Given: doctor へ追加した各検査観点について、意図的に不整合な状態を再現したケース
- When: doctor を実行する
- Then: 追加した各検査が当該不整合を異常として報告する（正常時は報告しない）ことを実測する
- 検証方法見込み: `automated`

#### AC-4: 追加しなかった doctor 観点の理由が記録される（要件2）

- Given: 技術的に実装不能・非対象と判断した doctor 観点が存在する場合
- When: 独立検証成果物を確認する
- Then: 各未実装観点について対象外とした理由が記録されている
- 検証方法見込み: `manual`

#### AC-5: claude adapter の allowed-tools が pr create ラッパー使用を実効化する（要件3）

- Given: 本 Issue の allowed-tools 見直し後の adapter 設定
- When: adapter 設定と、必要なら規範文書・lint を確認する
- Then: 生 `gh pr create` が無条件許可されておらず、`pr create` ラッパー経由が実効的に徹底される構成になっている
- 検証方法見込み: `automated`

#### AC-6: 使い捨て PR でテンプレート形式の本文が生成される（要件3）

- Given: 徹底策を適用した状態と、テスト用の使い捨て PR
- When: 規定手順で PR を作成する
- Then: PR 本文がテンプレート各節を含む形式で生成されることを実測する
- 検証方法見込み: `hybrid`

#### AC-7: finalize 経路を通らない ADR status 変更を検知する（要件4）

- Given: `adr finalize` CLI を経ずに ADR の status を変更した commit を再現したケース
- When: ADR lint またはゲート判定を実行する
- Then: 当該 status 変更が手順逸脱として検知される（終了コード1以上または該当 finding を報告）ことを実測する
- 検証方法見込み: `automated`

#### AC-8: 正規 finalize 経由の status 変更は誤検知しない（要件4）

- Given: `adr finalize` CLI 経由で status を更新した正規 commit
- When: 同じガードを実行する
- Then: 手順逸脱として誤検知されない（過剰検出が無い）ことを確認する
- 検証方法見込み: `automated`

#### AC-9: 既存テストスイートが全件通る（要件5）

- Given: 本 Issue の全変更を反映した状態
- When: 統合ブランチ上のテストスイート全体を実行する
- Then: 既存テストと新規追加テストがすべて通り、回帰が無いことを実測する
- 検証方法見込み: `automated`

## スコープ外

- lint vocab/references の対象拡大・CLI サブコマンド文脈判定の抜け穴修正（別 Issue で対応済み）。
- secret scan の required check 個別化（現状は verify 内包で機能的に強制されており実害小のため対象外）。
- system-spec（システム仕様書）の実体構築。
- 過去に発生した ADR finalize 手順逸脱事例の遡及是正（本 Issue はガード追加のみ）。
- doctor へ追加不能と判断した観点そのものの実装（理由記録のみで対象外）。
