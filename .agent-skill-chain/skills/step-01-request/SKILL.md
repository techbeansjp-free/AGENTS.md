---
name: step-01-request
description: 判定済みモードに対応する要求定義テンプレートを使い、利用者の意図を追跡可能な00成果物へ変換する。
---

# ステップ1: 要求定義

入力はステップ0のステージングと利用者の意図。成果物は`00_要求定義.md`。`full`は目的、範囲、ドメイン影響、制約、受け入れ条件と成功基準、P-01〜P-07計画を記録し、FR/NFR/ACはステップ2へ分離する。`quick`は要件工程を物理的に集約するため、境界づけられたコンテキスト・不変条件、完全な受け入れ条件、最小Gherkin、確認方法、全Q根拠、再開地点も記録する。`poc`はquick相当の集約に加え、PoC目的、隔離fixture、runner ID・path、固定argv、use case、BDD scenario、機械observable、成功・中止条件、非対象、データ・security制約、責任者、full昇格または廃止の判断条件とhigh risk確認を記録する。観測期間や未実装fixtureのdigestを要求しない。ステップ4前に構造を検証する。

調査・baseline確認は[読取と書込の量](../../docs/01_開発ワークフロー.md#読取と書込の量)に従い、要求を確定するための必要範囲から始める。

## 実行順と調査の停止点

1. dispatchの`read.staging`にあるモード判定と生成済み00（dispatchがない場合も同stagingの`00_モード判定.json`と`00_要求定義.md`）を読み、要求で指定された対象と既存test・仕様の該当箇所を確認する。生成済みQ根拠を再調査するのは、矛盾・欠測・境界変更を見つけた場合だけとする。
2. 以下のtemplate契約に従って未記入欄と変更箇所を埋める。必要なAC・不変条件・確認方法・DC証拠が揃えば調査を終え、無関係なstackやASC実装の探索へ広げない。影響が不明なら範囲を広げ、解消できなければfullへ昇格する。fullでも解消できない不明点はblockerとして返す。
3. quick/pocは`issue validate --path=<staging>`で集約成果物を検証する。fullは00の必須欄と受け入れ条件を確認して返し、後工程の01〜03を要求する`issue validate`を先行実行しない。Step記録時の既存readinessは維持する。引数・入力形式が不明なら実行する末端commandの`--help`を一度全文読む。rootや`issue --help`から段階的に探索せず、helpの先頭だけを切り出して不足分をソースで探さない。拒否時はdiagnosticが指す項目だけを是正する。
4. 成果物と検証結果をcoordinatorへ返す。quick/pocの次工程はStep 4、fullはStep 2。workerはjournalを手で読んで次工程を再判定したり、次工程の検証を先行実行したりしない。

## execution context境界

標準の`short-lived`方式では、[開発ワークフローのexecution context境界](../../docs/01_開発ワークフロー.md#execution-context境界)に従い、この担当work unitへfresh contextを割り当てる。repository/stagingから復元し、完了後に別工程・別review round・finding是正を同じcontextへ追加しない。workerの成果物・検証・必要なcommit・返却・終了の後でcoordinatorがStep/roundを記録する。`compatible`の既存動作と品質gateは維持する。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、要求、制約、前提、対象外を定義どおり分離する。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を作業開始前に読む。既存projectの`docs/specs/01_システム概要/02_用語・略語.md`は全文を読まず、変更に関わる語・既存IDを検索して該当行だけ読む。要求会話と一次資料から候補語、business rule、出典、コンテキスト、曖昧性を抽出し、変更差分だけを00へ記録する。既存語を再定義しない。

作業開始前に、ステップ0で確定したモードに対応する次の1ファイルを全文読み、その見出し構造と必須欄を使う。

- `full`: [00_要求定義_full.md](../../templates/issue/00_要求定義_full.md)
- `quick`: [00_要求定義_quick.md](../../templates/issue/00_要求定義_quick.md)
- `poc`: [00_要求定義_poc.md](../../templates/issue/00_要求定義_poc.md)

複数のテンプレートを混在させたり独自構成へ置き換えたりしない。モードが不明なら`full`を選び、選択したテンプレートの構造に沿って、`issue create`が生成したステージング内の`00_要求定義.md`の未記入欄を埋める。生成済みのQ回答・根拠・基本情報と既存本文は保持し、変更のある欄だけ編集する。template全文を読み直したことを理由に文書全文を再出力しない。判断を変える新事実があれば、既存のmode再判定・昇格手順に従う。`poc`でhigh riskまたは宣言不足を発見した場合は`full`へ単調昇格するか停止する。

開発考慮事項は全DC行を理由・証拠付きで確定する。まずproject choicesと生成済みDC行を読み、projectの適用判断を保持したまま、今回の変更に関連する要求・確認証拠を補う。変更しない領域は対象code・既存仕様・Q根拠から影響なしを確認して記録する。projectにUI等のcapabilityが存在するだけで、今回変更しない領域のtemplateまで読む必要はない。

今回その領域の要求・設計を変更する場合、または適用・影響を既存証拠から判断できない場合は、作業開始前に該当入口を全文読む。Privacy/Securityは[セキュリティ方針・資産](../../templates/specs/10_セキュリティ/00_セキュリティ方針・資産.md)、観測・運用は[非機能要件一覧](../../templates/specs/11_非機能/00_非機能要件一覧.md)と[運用設計](../../templates/specs/12_運用保守/00_運用設計.md)、UI/tokenは[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)を使う。security・data・権限境界が不明な状態を「影響なし」にせず、追加調査またはfull昇格へ進む。
