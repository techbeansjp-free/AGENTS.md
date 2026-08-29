---
name: step-11-pr
description: 承認済みexact-headでPRを作成し、modeとtrusted delivery policyに従ってmergeまたは明示停止まで進行する。
---

# ステップ11: PR作成とdelivery進行

入力は承認済みステップ10、合格したテスト・仕様ゲート、正確なリポジトリ・基点・先頭、事前表示、操作authority。PR作成前にstaging journalがStep 10まで有効で、特にStep 4と10が存在し、staging recordが`sync-verified`であることを検証する。quickでもStep 4を省略せず、無条件bypassを持たない。成果物はPR URLと`waiting / merge-queued / merged`の観測証拠であり、本文のIssue参照は[開発ワークフロー](../../docs/01_開発ワークフロー.md)の規約に従う。

`poc`はPoCであることと期限を本文に保持して必ずPRで停止し、release、自動merge、本番cleanupを要求しない。full/quickの`merge.mode=disabled`はPRで停止する。`assisted`は対象PR authorityが無ければ必要authorityと再開条件を返す。これらPRが正式な停止点となる経路は、PR URLと`waiting`の終端EvidenceをStep 11へ記録する。

full/quickの`automatic`は、適用された`pr create`後を`merge_pending`としてStep 11をまだ記録せず、PR URLと再開コマンドを返す。既定branch上のtrusted policyを耐久的authorityとし、required checks、review記録、current HEAD、ruleset、mergeable状態を再観測し、別の`pr merge --staging=<PR作成時と同じstaging>`操作またはGitHub auto-merge / merge queue登録へ継続する。trusted merge要求またはqueue登録の観測後に、PR URLと`merge-queued / merged`をStep 11へ記録する。PR URLの取得だけをautomaticの正常終了にしない。

`pr create`と`pr merge`を同じ外部操作へ連結せず、それぞれの直前に状態とauthorityを検証する。`pr merge`は同じstagingのStep 0〜10と`sync-verified`を再検証し、`poc`では必ず拒否する。ブランチ削除、Issue手動終了、release、公開、完了処理、後片付けはmerge authorityへ含めない。

PRが正式な停止点の経路でStep 11記録に失敗した場合も、作成済みPRのURLを必ず表示し、記録失敗を示す非0終了で停止する。作成済みPRをGitHubで確認し、`pr create`は再実行しない。同じstagingと表示済みURLを使い、`workflow record --staging=<同じstaging> --step=11 --artifact=<PR URL> --evidence=<PR URLとwaitingを再観測した根拠>`で記録だけを再実行する。

`pr merge`適用後のStep 11記録に失敗した場合は、merge要求またはqueue登録状態とPR URLをGitHubで再観測し、`pr merge`を再実行せず同じ`workflow record`で記録だけを復旧する。どちらも続けて`workflow verify --staging=<同じstaging> --up-to=11`で再読取検証する。書き込み後digest失敗など記録有無が曖昧な場合も、先にjournalを検査し、PR作成やmerge要求を重複実行しない。

## role・tier入力契約

PR作成前にcoordinator、analyst、implementer、reviewer、verifier、finalizerの担当記録、implementerとreviewerの異なるidentity・context、reviewerの非変更証拠、verifierの独立検証、必要model tierとmappingを確認する。不明なrole・tier・独立性証拠をmodel能力やPR作成authorityで補わず、fail-closedで停止する。担当finalizerは要件とproductを変更せず、承認済みreview結果を改変しない。

## テンプレート契約

作業開始前に[プルリクエスト事前確認](../../templates/issue/11_プルリクエスト事前確認.md)と[プルリクエスト本文](../../templates/issue/11_プルリクエスト本文.md)を全文読む。前者の全項目を満たして事前表示・操作authorityを確認した後、後者の見出し構造と必須欄を使って本文を作成する。自由形式の本文で代替しない。
