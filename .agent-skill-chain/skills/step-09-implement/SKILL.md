---
name: step-09-implement
description: 検証済みトラッカーとモード別実装計画に従い、専用worktreeでBDDとEvidence-driven Verificationを用いて実装し、仕様を正本化する。
---

# ステップ9: 専用worktreeでの実装

**stagingは実装するworktreeの中に置く。** Step 0からPR作成・mergeまでproject policyで解決した同じ`staging.root`を使う。`staging.tracked=true`ではworktreeを先に作り、その中のpolicy解決済みrootへ`issue create`する。root patternに`*`があれば`--staging-root=<実際の親directory> --name=<directory名>`を指定するため、`mv`は要らない。`staging.tracked=false`でroot（既定branch）側にStep 0 stagingを作成済みなら、worktree作成の直後に同じpolicy解決済み相対pathへ`mv`し、root側へ複製を残さない（既定rootは`.agent-skill-chain/tmp/issues`）。Issue番号が既知なら`worktree create`を先に実行し、`issue create --root=<worktree>`で最初からworktree内へ作る。`review round`・`workflow record`・`pr create`・`pr merge`はいずれも、stagingが対象worktreeのpolicy解決済みroot直下にあることを要求し、そのpathからrepository rootを導出してcurrent HEADと突合する。root側へstagingを残したまま専用worktreeでHEADを進めると、root側HEADが基点から実装commitを含まないため`workflow record --step=9`が記録を拒否する（それ以外でもStep 10以降の全commandが「candidate HEADがcurrent HEADと一致しません」で止まる）。stagingは自動では移らない。journalはworktree側だけが正本になる。

入力は検証済みトラッカーと明示した基点。成果物は専用ブランチ・worktree、BDD例とACを立証するrisk比例Evidence、最小コード、合格したプロジェクト検証一式、merge前に成立状態を反映した`docs/specs/`。作業元の変更状態を検査して同一に保持し、暗黙のstash・reset・checkout・clean・deleteをしない。テストは一時リポジトリ・模擬処理だけを使い、実リモート・他のworktreeを変更しない。

## routing入力契約

role欄の担当roleが`implementer`であること、許可path・操作、必要証拠、要求能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄を実装開始前に検証する。providerとmodel設定はproject choiceの解決結果を入力とし、汎用skillは固有のmodel slugを要求しない。要求能力を満たす解決、ACに対応するVerification Set、または別identity・contextのreviewer割当が欠ける場合は実装を開始せず、停止点と再開条件を報告する。implementerは自分の差分を最終承認せず、mergeを裁定しない。

Step 10の是正では[品質基準のレビュー収束契約](../../docs/02_品質基準.md#レビュー収束契約)のadmissionを優先し、record-onlyを派生欠陥一般則だけで自主修正へ戻さない。実装中・検証中に見つけた欠陥は、まず[派生した欠陥の是正原則](../../docs/01_開発ワークフロー.md#派生した欠陥の是正原則)に従い、分離6条件のいずれかに該当しない限り同じIssue・同じPRで直す。ASC本体の欠陥に当たったときは[ASC本体の是正を作業scopeへ入れない](../../docs/01_開発ワークフロー.md#asc本体の是正を作業scopeへ入れない)を読む。**この節はASC本体が依存packageである利用projectでの作業に適用し、ASC本体repository自身での作業には適用しない。** 利用projectで、この作業の目的にASC本体の保守を含まないなら、発見したASC本体の欠陥を当該scopeへ追加して是正しない。** **記録し、別Issueとして起票してから前進する。起票を省くとASC本体の修正要求が耐久記録へ残らない。** 軽微かどうかは正本の3条件で決め、1つでも偽または不明なら軽微としない。軽微でない場合は停止・記録・別Issueへの分離・owner決裁の順に扱う。作業の成果物をASCの契約へ合わせることは従来どおり必須だが、**検査を通すための変更が検査の無い状態で弁護できないなら成果物を歪めず同じ経路へ入る。**

実装・テスト・仕様の各fileは[読取と書込の量](../../docs/01_開発ワークフロー.md#読取と書込の量)に従って差分で編集し、検証は判定結果だけを出力する。`05_計画変更.md`への追記も該当entryだけを加える。

**承認済み計画（fullは00〜03、quick/pocは00）は編集しない。** 照合はCLIが裏側で行うので、封印を意識した操作は要らない。

**実装中の発見は、既定では分類も記録もせず実装を続ける。** 予定と違う関数名、class分割、helper追加、library選択、test構成、file配置、SQLの調整などはGitに残れば足りる。次のどれかが変わると分かった場合だけ手を止める。

- 目的、受け入れ条件、不変条件、scope → `05_計画変更.md`へ`AMD-NNN`を1件追記する（対象・変更・理由の3項目。templateは`templates/issue/05_計画変更.md`）
- 現在のsystem契約（公開interface、外部契約、data互換性） → `docs/specs/`へ反映し、計画の変更でもあればAMDも追記する
- security境界の拡大、不可逆操作の追加、quick・pocの失格条件 → `workflow assess-discovery --input=<JSON> --staging=<staging>`で判定し、`promote-to-full`なら`workflow promote-full`（既定はpreview、`--apply`で適用）で同じIssueのままfullへ昇格する。PoCの`stop-or-promote-full`は停止か昇格を選ぶ
- このIssueのscope外 → follow-up Issue

`workflow assess-discovery`を使うのは上の3番目だけであり、すべての発見をJSON化して判定しない。

Codexを新しく起動するときは必ず`routing launch --help`で入力を確認し、当該taskのfile、root、独立identity/context、risk、modeを渡して実行する。編集taskだけ`--sandbox=workspace-write`を明示する。launch自身が毎回公式config/readとmodel/listを観測し、trusted selector採用tier、具体model、high、標準速度を検証してCodexを起動する。手書きmodel名、以前のresolve結果、旧Evidenceを新しい起動の選択元にしない。launchが起動したimplementer自身は同じtaskを再launchせず、このStepの実装を続ける。取得不能・採用不足は起動前に停止し、旧modelや別providerで暗黙に実行しない。

## 実装時のCoding Engineering

Coding Engineeringの読取routingを定義する場所はこの節だけとする。他の節に名称・資産pathを用いた読取指示や別routingを追加しない。

既知のAC・変更対象・riskを再調査せず、読む量だけを次のように選ぶ。risky・cross-boundary・境界/risk不明の経路を優先し、影響が小さくても省略経路へ入れない。新しいmode・Step・Gateではなく、既存の開始・停止条件は変えない。

| 変更の分類 | 読むもの |
|---|---|
| local・明白・low-riskで、既存patternの内側に収まり境界・副作用の変更がない | 近傍実装と関連testだけ。Coding Engineering本文・索引・Lensは読まず、0 Lensを優先する |
| risky・cross-boundaryに該当せず、影響がboundedで境界とriskが既知 | [Coding Engineering索引](../coding-engineering/index.md)から必要ならLens 0〜1件。本文は読まない |
| risky・cross-boundary、または境界・riskが不明 | [Coding Engineering Skill](../coding-engineering/SKILL.md)を読み、該当Lens 1〜3件を目安に選ぶ |

Search Before Createの探索既定値は、symbol/既存patternを検索 → 有力候補は最大3件程度へ絞る → 直接読むのは通常1〜2件とする。判断が変わらない、または局所pattern・直接依存を十分把握できたら終了する。これはsoft budgetでありhard limitや停止条件ではない。高riskや未解決の具体的な疑問があれば必要な範囲へ広げる。探索中に境界・riskの前提が崩れたら読取の分類を見直す。

scope内の通常問題は自律修正し、実装中はtargeted feedbackを優先する。最終完了条件は既存Verification Set・project policyに従い、読取の省略を検証やsecurity境界確認の省略に使わない。

## execution context境界

標準の`short-lived`方式では、[開発ワークフローのexecution context境界](../../docs/01_開発ワークフロー.md#execution-context境界)に従い、この担当work unitへfresh contextを割り当てる。repository/stagingから復元し、完了後に別工程・別review round・finding是正を同じcontextへ追加しない。workerの成果物・検証・必要なcommit・返却・終了の後でcoordinatorがStep/roundを記録する。`compatible`の既存動作と品質gateは維持する。

## テンプレート契約

[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)に従い、システム仕様書には実装後に成立する現在状態だけを反映する。未実装の計画を仕様済みにしない。

用語を追加・変更するときだけ[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を読み、実装済みの用語差分だけを`docs/specs/01_システム概要/02_用語・略語.md`と仕様変更履歴へ反映する。API・CLI、データ、UI、ログ・診断、testの表記を同じ標準語へ揃える。

仕様更新の範囲を決めるときは[Semantic Graphの利用](../../docs/01_開発ワークフロー.md#semantic-graphの利用)を読み、`impact --base=<比較基点> --head=<HEAD>`で影響集合を導出して、それが指す要件・シナリオ・仕様節だけを読む。

コード自体に直接使用するテンプレートはない。仕様影響がある場合は、作業開始前に[仕様書索引](../../templates/specs/00_仕様書構成/00_仕様書索引.md)と[記入・分割ルール](../../templates/specs/00_仕様書構成/01_記入・分割ルール.md)を全文読み、対象カテゴリの正確なテンプレートを選んでからそのファイルも全文読み、構造を維持して`docs/specs/`を更新する。仕様影響がない場合は、ステップ10で範囲を限定した`no-spec-impact`根拠を記録する。
