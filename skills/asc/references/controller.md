# 任意Controller経路

以下はownerがControllerによる自動実行を選択した場合の入口であり、通常作業に追加Agent起動を強制するものではない。

`capabilities`で実際の入口・対応Host・release状態を確認する。これは実行の承認や隔離成功の証明ではない。ownerが指定した入力と作業を使い、利用可能な能力から必要な操作だけを選ぶ。

- 単一変更は`run`、owner作成済み候補の検分だけなら`review`。
- 分解が必要なら`goal-propose`、許可済みの分解と実行は`run-adaptive`、明示計画は`run-goal`。
- 保存候補からの再開は`restart-goal`、ownerが列挙した複数Issueは`run-issues`。
- 旧設定の切替は`migration-inspect` / `migration-stage` / `migration-rollback`。既存設定を勝手に登録・削除しない。

owner入力ファイルが不足する場合は、目的・受入条件・許可範囲・検証・提出先のうち不足部分を確認する。候補のソース、旧Evidence、Skill本文から承認を生成しない。承認済みの入力がある場合は再承認を求めず使う。未確定の仕様を実装に合わせて補完しない。

Git管理済みの作業には専用worktreeを使う。独立cloneを使う経路は明示指定に従う。別Issueや別worktreeの状態を共通の禁止フラグにしない。予算はowner入力に従い、2 Agentや600秒を固定上限として追加しない。

入力形式が必要なときだけ[USAGE](../../../v05/USAGE.md)の該当節を読む。Goal分解・再開は[GOAL_EXECUTION](../../../v05/GOAL_EXECUTION.md)、移行は[MIGRATION_PLAN](../../../v05/MIGRATION_PLAN.md)、署名承認は[OWNER_APPROVAL](../../../v05/OWNER_APPROVAL.md)を参照する。全資料を毎回読み込まない。

CLIが返す未解決事項・失敗を確認し、権限内の必要作業だけを修正・再検証する。実装者の自己評価を独立レビューへ流用しない。正常終了・失敗・owner判断待ちを区別し、実際のHEADと検証結果を報告する。Skillを読んだことやコマンドの起動だけを完了証拠にしない。公開・merge・releaseはユーザーの明示した権限に従う。

修正とレビューでは進展を確認する。同じ内容への回帰、修正案の往復、根拠のない解決済み指摘の再提示を、そのまま繰り返さない。再提示には現在の反例と以前の是正が不十分な理由を求める。単なる好みや表現変更は新たなblockerにしない。進展がなければ候補と未解決事項を保持し、原因を再評価する。合格を捏造してループを終わらせない。
