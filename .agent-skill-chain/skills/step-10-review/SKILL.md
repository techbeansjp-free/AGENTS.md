---
name: step-10-review
description: exact-headの実装・テスト・仕様証拠を有限にレビューし、PR作成可否を判定する。
---

# ステップ10: 実装レビュー

入力は正確な先頭SHA・差分、受け入れ条件・シナリオ・Verification Evidence・実装中発見記録・仕様の証拠。成果物は肯定・敵対の評価、有限な指摘、検証結果、発見ごとの対処、`updated`の仕様追跡または範囲を限定した`no-spec-impact`を含む`04_レビュー.md`。影響不明または未解決Critical/Highは停止する。修正後は修正差分と隣接依存だけを再検証し、目的または受け入れ契約が変わらない限り上流工程を再起動しない。承認証拠が確定した後に`workflow record --step=10`でレビュー成果物をartifact、exact-head・test・仕様整合をevidenceとしてjournalへ追記する。

## routing入力契約

role欄の担当roleが`reviewer`であること、必要能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄、肯定・敵対review、finding分類、対象差分を変更していない証拠を実装時のrouting evidenceと突合する。providerとmodel設定はproject choiceの入力契約として扱い、固有のmodel slugからreview authorityを推測しない。reviewerがimplementerと異なるidentity・contextであることを独立性証拠欄で確認できない場合は停止条件を適用し、承認しない。reviewerはfindingを隠す修正を行わない。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、成果物間の責務越境、上流の暗黙変更、対象版とシステム仕様書の不一致をfindingにする。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)と要求・要件の用語差分、耐久用語台帳を作業開始前に全文読む。未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止、成果物間の表記揺れをfindingにする。

作業開始前に[04_レビュー.md](../../templates/issue/04_レビュー.md)を全文読み、その見出し構造・変更ファイル個別監査・評価欄を使ってレビュー成果物を作る。独自の要約だけで代替しない。

**`pr create`より後に届いた外部reviewerの指摘は、条件を満たす場合に同じPRへ取り込む。** 守る性質は「独立reviewerが確認した内容とmergeされる内容が一致すること」であり、HEADが動いても同sessionの次roundで再reviewすれば保たれる。**条件と手順の正本は`../../docs/01_開発ワークフロー.md`である。ここへ複写しない。** 記録は`workflow record --step=10 --post-terminal-intake`で行い、Step 11より後に置く。**取り直し1ラウンドは収束後にだけ開く。** 未解決blockerを抱えたまま予算を使い切った`budget-exhausted`からは開かない。開くと任意の1 pushで新品の予算をもらえる。**予算を超える指摘、受け入れ条件を満たさない指摘、安全境界・authority・不可逆操作へ及ぶ指摘は取り込まず、follow-up Issueとする。** いずれの場合も元のPRのreviewスレッドへ判定を返信して解決する。**指摘を無記録で通過させない。**

**差分が実装言語以外の成果物を含む場合、その種別に対応する静的解析を当てる。** 実装言語にはprojectのlintと型検査が当たるが、shell script、Makefile、CI workflowのようなrepository運用の足回りは、どの工程でも解析されないまま既定branchへ到達しうる。**これらは検査する側の仕組みであり、壊れると他のすべての検査が黙って素通りする。** 字面の照合は実行可能性を見ないため、種別に対応する解析の代替にならない。当てられるツールが環境に無い場合は、その事実と理由をレビュー成果物へ記録し、当てたものとして扱わない。

**Makefileは`make -n <target>`で展開した実コマンドへ当てる。** レシピ本文をそのまま解析器へ渡すと`$$`と`@`が未展開のままparseが途中で止まり、**本物の欠陥が報告されない。**「当てたが指摘は無かった」という誤結論の原因になる。**ただし`make -n`は安全な静的展開器ではない。** 読み込み時に評価される`$(shell ...)`は`-n`でも実行されるため、候補が制御するMakefileへそのまま実行すると任意のコマンド実行になる。**書き込み不可のfilesystem、network分離、資源制限を持つsandbox内で実行し、対象targetを差分が触れた範囲に限る。** **sandboxは認証情報も分離する。** 環境変数は許可listだけを渡し（`env -i`相当）、credential mountとagent socketを到達不能にする。取得した出力に認証情報が混入していないことを確認し、レビュー成果物とCI logへ残さない。 変数展開後の定数比較に対する指摘は、**その比較が設計上つねに定数になる場合にかぎり**誤検知である。未定義変数や変数名の誤記で意図せず定数化した場合は真の欠陥であり、比較ごとに判断する。

**成果物は版管理下へ置く。** 一時ステージングは版管理外であり、そこに置いたままでは`review evidence`も履歴監査も成立しない。収束後に`docs/reviews/`または`.agent-skill-chain/reviews/`配下へ複写し、実装commitの後にその1 fileだけをcommitして`H_final`にする。

project choicesと対象成果物のDC行を読む。**DC判定が`applicable`の領域と、対象差分が実際に触れた領域だけ**、作業開始前に対応するtemplateの全文を読む。[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)はDC-PRIVACYが`applicable`のとき、[利用性・互換性・保守性](../../templates/specs/11_非機能/02_利用性・互換性・保守性.md)と[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)はDC-OBSERVABILITYが`applicable`のとき、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)と[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)は差分がsourceまたはtestを含むときに読む。**`not-applicable`と判定した領域のtemplateの全文を読む固定費を課さない。** 判定自体の妥当性は§2.2のDC欄でreviewする。UIまたはtoken capabilityが`not-applicable`でない場合は[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)も全文読み、判定・理由・実測証拠の欠落をfindingにする。
