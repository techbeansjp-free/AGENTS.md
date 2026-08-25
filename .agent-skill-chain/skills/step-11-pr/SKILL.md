---
name: step-11-pr
description: 承認済みexact-headを事前確認し、規定本文でPRを作成して人間レビュー待ちで停止する。
---

# ステップ11: PR作成と停止

入力は承認済みステップ10、合格したテスト・仕様ゲート、正確なリポジトリ・基点・先頭、事前表示、承認。PR作成前にstaging journalがStep 10まで有効で、特にStep 4と10が存在し、staging recordが`sync-verified`であることを検証する。quickでもStep 4を省略せず、無条件bypassを持たない。成果物はPR URLと`pr_opened / waiting_for_human_review`であり、作成後にPR URLと停止状態をStep 11としてjournalへ追記する。明示ポリシーがない限り本文はトラッカーを自動終了せず関連付ける。`poc`はPoCであることと期限を本文に保持して必ずここで停止し、release、自動merge、本番cleanupを要求しない。全モードでマージ、ブランチ削除、Issue終了、リリース、完了処理、後片付けを連鎖しない。マージは別の信頼済みポリシーコマンドとするが、`poc`のまま認可しない。

## role・tier入力契約

PR作成前にcoordinator、analyst、implementer、reviewer、verifier、finalizerの担当記録、implementerとreviewerの異なるidentity・context、reviewerの非変更証拠、verifierの独立検証、必要model tierとmappingを確認する。不明なrole・tier・独立性証拠をmodel能力やPR作成authorityで補わず、fail-closedで停止する。担当finalizerは要件とproductを変更せず、承認済みreview結果を改変しない。

## テンプレート契約

作業開始前に[プルリクエスト事前確認](../../templates/issue/11_プルリクエスト事前確認.md)と[プルリクエスト本文](../../templates/issue/11_プルリクエスト本文.md)を全文読む。前者の全項目を満たして事前表示・承認を得た後、後者の見出し構造と必須欄を使って本文を作成する。自由形式の本文で代替しない。
