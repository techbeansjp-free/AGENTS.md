---
name: step-09-implement
description: 検証済みトラッカーとモード別実装計画に従い、専用worktreeでBDDとEvidence-driven Verificationを用いて実装し、仕様を正本化する。
---

# ステップ9: 専用worktreeでの実装

入力は検証済みトラッカーと明示した基点。成果物は専用ブランチ・worktree、BDD例とACを立証するrisk比例Evidence、最小コード、合格したプロジェクト検証一式、merge前に成立状態を反映した`docs/specs/`。作業元の変更状態を検査して同一に保持し、暗黙のstash・reset・checkout・clean・deleteをしない。テストは一時リポジトリ・模擬処理だけを使い、実リモート・他のworktreeを変更しない。

## routing入力契約

role欄の担当roleが`implementer`であること、許可path・操作、必要証拠、要求能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄を実装開始前に検証する。providerとmodel設定はproject choiceの解決結果を入力とし、汎用skillは固有のmodel slugを要求しない。要求能力を満たす解決、ACに対応するVerification Set、または別identity・contextのreviewer割当が欠ける場合は実装を開始せず、停止点と再開条件を報告する。implementerは自分の差分を最終承認せず、mergeを裁定しない。

[ASC本体の是正を作業scopeへ入れない](../../docs/01_開発ワークフロー.md#asc本体の是正を作業scopeへ入れない)を作業開始前に全文読む。**この作業の目的にASC本体の保守を含まないなら、発見したASC本体の欠陥を当該scopeへ追加して是正しない。** **記録し、別Issueとして起票してから前進する。起票を省くとASC本体の修正要求が耐久記録へ残らない。** 軽微かどうかは正本の3条件で決め、1つでも偽または不明なら軽微としない。軽微でない場合は停止・記録・別Issueへの分離・owner決裁の順に扱う。作業の成果物をASCの契約へ合わせることは従来どおり必須だが、**検査を通すための変更が検査の無い状態で弁護できないなら成果物を歪めず同じ経路へ入る。**

実装中に発見した問題は、fullでは03、quickとpocでは集約00の「実装中発見の前向き記録」へ発見ID・事実・影響・判断・対処・検証・仕様更新を追記する。発見ごとに一度だけ`DISC-*`形式の安定した`discoveryId`を割り当て、再評価・昇格・reviewで変更または別の発見へ再利用しない。`discoveryId`、現在モード、目的・scope・ACの変更有無、security境界拡大、不可逆操作、`changedContractKinds`、発見したモード失格条件の`{ id, evidence }`配列をJSON化し、`workflow assess-discovery --input=<JSON>`の出力で影響成果物を確定する。失格条件と契約種別はcanonical IDだけを使い、空値、重複、未知ID・未知fieldを拒否する。

`continue`は記録して実装を継続する。`rebaseline-affected-contracts`は出力された影響成果物だけを再確定する。`promote-to-full`でquickをfullへ昇格する場合は、まず`workflow promote-full --staging=<同じstaging> --input=<同じ発見JSON>`をflagなしで実行する。既定は副作用のないpreviewであり、対象と診断を確認後、同じstaging・発見JSONへ`--apply`を付けた明示実行だけが00〜03を補完する。`stop-or-promote-full`は判定時点ではfileを変更せず、停止を記録するか、同じpreviewと明示`--apply`でPoCからfullへの昇格を選ぶ。昇格は元のモード判定と00をbackupし、排他lock・永続transaction・digest検証で途中停止から再実行可能にする。既同期stagingは`promotion-active`となり、同じIssueのStep 8再同期までPRへ進めない。昇格後は旧modeのStep 0・1だけを継承し、fullのStep 2〜10を補完する。Issueや変更のない成果物を作り直さない。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、システム仕様書には実装後に成立する現在状態だけを反映する。未実装の計画を仕様済みにしない。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を作業開始前に全文読み、実装済みの用語差分だけを`docs/specs/01_システム概要/02_用語・略語.md`と仕様変更履歴へ反映する。API・CLI、データ、UI、ログ・診断、testの表記を同じ標準語へ揃える。

コード自体に直接使用するテンプレートはない。仕様影響がある場合は、作業開始前に[仕様書索引](../../templates/specs/00_仕様書構成/00_仕様書索引.md)と[記入・分割ルール](../../templates/specs/00_仕様書構成/01_記入・分割ルール.md)を全文読み、対象カテゴリの正確なテンプレートを選んでからそのファイルも全文読み、構造を維持して`docs/specs/`を更新する。仕様影響がない場合は、ステップ10で範囲を限定した`no-spec-impact`根拠を記録する。
