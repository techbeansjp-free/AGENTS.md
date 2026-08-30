---
name: step-11-pr
description: 承認済みexact-headでPRを作成し、modeとtrusted delivery policyに従ってmergeまたは明示停止まで進行する。
---

# ステップ11: PR作成とdelivery進行

入力は承認済みステップ10、合格したテスト・仕様ゲート、正確なリポジトリ・基点・先頭、事前表示、操作authority。PR作成前にstaging journalがStep 10まで有効で、特にStep 4と10が存在し、staging recordが`sync-verified`であることを検証する。quickでもStep 4を省略せず、無条件bypassを持たない。成果物はPR URLと`pull-request / merge-requested / merged`の観測証拠であり、本文のIssue参照は[開発ワークフロー](../../docs/01_開発ワークフロー.md)の規約に従う。指定stagingは現在project内の検証済みIssue stagingでなければならず、project外、別Issue、symlink経由をprovider呼出し前に拒否する。

`poc`はPoCであることと期限を本文に保持して必ずPRで停止し、release、自動merge、本番cleanupを要求しない。full/quickの`merge.mode=disabled`もPRで停止する。この2経路だけは固定PR bindingのdigestを`outcome=pull-request`の終端EvidenceとしてStep 11へ一度記録する。`assisted`で対象PR authorityが無い場合は必要authorityと再開条件を返し、`pr-bound`のままStep 11を記録しない。

full/quickの`automatic`は、適用された`pr create`後を`merge_pending`としてStep 11をまだ記録せず、PR URLと再開コマンドを返す。既定branch上のtrusted policyを耐久的authorityとし、required checks、review記録、current HEAD、classic protectionまたはactive ruleset、mergeable状態を再観測し、別の`pr merge --staging=<PR作成時と同じstaging>`操作またはGitHub auto-merge / merge queue登録へ継続する。auto-mergeはmethodとenabledAt、queueはentry ID・state・時刻・head/base OIDを`merge-observed`へ保存するが、Step 11成功として記録しない。同じPRのprovider read-backで`merged`、provider mergedAt、merge commit SHAを観測し、固定identityを再確認した後だけ`outcome=merged`のStep 11を記録する。PR URLの取得だけをautomaticの正常終了にしない。

`pr create`と`pr merge`を同じ外部操作へ連結せず、それぞれの直前に状態とauthorityを検証する。create intentより前にproviderのwrite authority、default branch/tip、remote head SHAを指定repository・base、trusted policy commit、exact HEADへ一致させる。その後repository、canonical IssueとURL、head ref/SHA、base refと作成時base SHA、canonical title/body digest、closing契約digestを`journal/delivery-state.json`の`create-prepared`へ耐久化する。作成後read-backでrepository、PR番号・URL、Issue、same-repository HEAD、canonical title/body、base ref、closing Issue 1件を一致確認して`pr-bound`へ固定する。`pr merge`は同じstagingのStep 0〜10と`sync-verified`を再検証し、`poc`では必ず拒否する。ブランチ削除、Issue手動終了、release、公開、完了処理、後片付けはmerge authorityへ含めない。

merge直前に固定HEADでpolicy、checks、独立review、methodを再認可し、外部merge要求より前に認可HEAD、method、intent IDを`merge-prepared`へ耐久化する。base refは固定し、provider default branch tip、PR base SHA、trusted policy commitが一致する場合だけ進める。timeout、通信切断、応答不明では外部create/mergeを再送せずprovider read-backで照合する。一度もdispatchしていないprepared intentで該当PR、auto-merge、queue entryが存在しないことを決定的に確認できた場合だけ、同じimmutable intentを一度再試行してよい。`reconciliation-required`または曖昧状態では再送しない。

PR停止またはmerged終端ではjournalを先にfsyncし、そのdigestと`outcome`・`evidenceId`をdelivery stateへ保存する。journal保存後・state保存前に停止した場合は同じ`pr create`または`pr merge`コマンドを同じ入力で再実行し、既存Step 11 entryを検証してstateだけを前向きに復旧する。PR create、merge要求、Step 11追記を再送しない。

`pr merge`適用後にauto-mergeまたはqueue entryだけが観測できる場合は`merge-observed`と再開条件を返し、Step 11へ進めない。再実行はprovider read-backだけを行い、merged終端Evidenceへ単調更新する。GitHubがHEAD以外のPR metadata CASを提供しない最終窓は、二重read、HEAD CAS、保護規則、事後read-backで検出する残余競合として明示し、完全予防と報告しない。

## role・tier入力契約

PR作成前にcoordinator、analyst、implementer、reviewer、verifier、finalizerの担当記録、implementerとreviewerの異なるidentity・context、reviewerの非変更証拠、verifierの独立検証、必要model tierとmappingを確認する。不明なrole・tier・独立性証拠をmodel能力やPR作成authorityで補わず、fail-closedで停止する。担当finalizerは要件とproductを変更せず、承認済みreview結果を改変しない。

## テンプレート契約

作業開始前に[プルリクエスト事前確認](../../templates/issue/11_プルリクエスト事前確認.md)と[プルリクエスト本文](../../templates/issue/11_プルリクエスト本文.md)を全文読む。前者の全項目を満たして事前表示・操作authorityを確認した後、後者の見出し構造と必須欄を使って本文を作成する。自由形式の本文で代替しない。
