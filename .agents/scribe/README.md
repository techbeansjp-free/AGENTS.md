# scribe — ログは誰が書くか・どこに書くか

**I/O 契約の正本**: [CONTRACT.md](CONTRACT.md)（何を受け取るか・何を出力するか・必須キー・保存先・誰が呼べるか）。

**書記はログ記録の唯一の記録者とする。** 以下を絶対とする。

- **ログ記録は書記のみ**: **ログは書記に任せる**。command verify-and-close の skill chain に含まれる **write-workflow-log** capability（skills/logging/write-workflow-log/）のみが記録する。単体で呼ぶ場合は LOAD_POLICY の「単体 capability」に従う。**他サブエージェントはログを書かない**。書記以外の workflow.db または CONTRACT 準拠ログへの書き込みは禁止（CORE）。enforcement で矯正する。
- **親は必ず書記へ委譲する**: 検証・クローズや phase 完了時、メイン（orchestrator）は**必ず**書記（write-workflow-log）へ委譲し、1 件以上のログ記録を完了させてから次に進む。書記未実行の次 Task は拒否する（enforcement §矯正するもの）。
- **必須キー不足時は失敗**: 書記が記録するエントリは CONTRACT（ledger/schema.md および本 CONTRACT）で定めた必須キー（**command, summary, dod_met, ts_utc, created_at**。任意: issue_path, changed_files）を満たす。必須キーが欠けている場合は記録を失敗とみなし、親にエラーを返す。完了とみなさない。
- **どこに書くか**: **本則は SQLite（workflow.db）**。ledger/README.md の配置・スキーマに従う。**証跡は workflow.db のみ。memo は証跡の代替経路ではなく、移行期・例外時の思考メモ用である。** **workflow.db に書く場合は .agents/scripts/write-workflow-log.sh を必ず使用すること。** **workflow.db が無ければ作成する**（ledger/schema.md のスキーマで初回に作成）。**workflow.db を採用することが本則**であり、**memo のみの運用は workflow.db を採用しない場合の過渡的・例外**とする（CONTRACT.md「どこに保存するか」を参照）。**memo のみの運用は非推奨（移行モード）であり、将来廃止予定とする。** 新規プロジェクトでは memo のみ運用の採用を禁止し、将来のメジャーバージョンで memo 出力経路を削除する予定である。
- **形式**: memo の場合、ファイル名は **YYYYMMDD_HHMMSS_** プレフィックスを必須とする（日本標準時）。
