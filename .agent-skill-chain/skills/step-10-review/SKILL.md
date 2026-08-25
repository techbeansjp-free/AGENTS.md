---
name: step-10-review
description: exact-headの実装・テスト・仕様証拠を有限にレビューし、PR作成可否を判定する。
---

# ステップ10: 実装レビュー

入力は正確な先頭SHA・差分、受け入れ条件・シナリオ・テスト・仕様の証拠。成果物は肯定・敵対の評価、有限な指摘、テスト結果、`updated`の仕様追跡または範囲を限定した`no-spec-impact`を含む`04_レビュー.md`。影響不明または未解決Critical/Highは停止する。ラウンド3で分類し、任意範囲を安全側へ縮小する。承認証拠が確定した後に`workflow record --step=10`でレビュー成果物をartifact、exact-head・test・仕様整合をevidenceとしてjournalへ追記する。

## routing入力契約

role欄の担当roleが`reviewer`であること、必要能力tier、provider欄の上限、model設定欄、fallback欄、独立性証拠欄、肯定・敵対review、finding分類、対象差分を変更していない証拠を実装時のrouting evidenceと突合する。providerとmodel設定はproject choiceの入力契約として扱い、固有のmodel slugからreview authorityを推測しない。reviewerがimplementerと異なるidentity・contextであることを独立性証拠欄で確認できない場合は停止条件を適用し、承認しない。reviewerはfindingを隠す修正を行わない。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、成果物間の責務越境、上流の暗黙変更、対象版とシステム仕様書の不一致をfindingにする。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)と要求・要件の用語差分、耐久用語台帳を作業開始前に全文読む。未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止、成果物間の表記揺れをfindingにする。

作業開始前に[04_レビュー.md](../../templates/issue/04_レビュー.md)を全文読み、その見出し構造・変更ファイル個別監査・評価欄を使ってレビュー成果物を作る。独自の要約だけで代替しない。

project choicesと対象成果物のDC行を読み、作業開始前に[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)、[利用性・互換性・保守性](../../templates/specs/11_非機能/02_利用性・互換性・保守性.md)、[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)、[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)を全文読む。UIまたはtoken capabilityが`not-applicable`でない場合は[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)も全文読み、判定・理由・実測証拠の欠落をfindingにする。
