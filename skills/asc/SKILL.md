---
name: asc
description: ASC v0.5で開発を実行・再開・レビューするとき、owner入力と配布済みCLIを結び付ける。通常の開発にASCの導入や固定工程を強制しない。
---

# ASCの実行入口

Goalと許可された変更を、現在利用中のHostの能力で実行する。Claude CodeではClaude Code、CodexではCodexの実装・実行・Agent機能を使う。利用者が別のHostを明示選択しない限り、別製品のCLIやモデルを必須にしない。工程ごとのAgent起動や、毎回の要求・設計・ADR生成は行わない。

このSkillは配布パッケージ内の場所で使用する。CLIはこのファイルから相対の`../../bin/asc-v05.mjs`。HostのNode実行ファイルで起動する。場所が解決できなければ停止して導入先を確認し、PATH上の別版や旧`workflow advance`へ切り替えない。

通常の対話型開発では、専用worktreeで現在のHostのツールを使って実装し、プロジェクトの依存関係と検証コマンドを使って実際にテストする。依存関係の導入はlockfileとHostの権限に従う。node_modulesが必要なのに空のsnapshotを使い、検証を未来のCIへ先送りしたまま合格扱いにしてはいけない。

独立レビューは現在のHostの別コンテキストへ、元の要求・受入条件・実Git差分・検証結果を渡して依頼する。自己評価を代用しない。利用できる独立コンテキストがなければレビュー未完了と明示し、勝手にCodexへ切り替えない。指摘を是正し、影響する検証・レビューを更新してから、許可されたDraft PR提出とCI確認を行う。要求と対象commit、実コマンドと結果、レビューの指摘と是正をPR等に残す。この経路はHostの権限境界を使い、Controller固有の隔離や署名済みEvidenceを実施したとは記録しない。

以下はownerがControllerによる自動実行を選択した場合の入口であり、通常作業に追加Agent起動を強制するものではない。

`capabilities`で実際の入口・対応Host・release状態を確認する。これは実行の承認や隔離成功の証明ではない。ownerが指定した入力と作業を使い、利用可能な能力から必要な操作だけを選ぶ。

- 単一変更は`run`、owner作成済み候補の検分だけなら`review`。
- 分解が必要なら`goal-propose`、許可済みの分解と実行は`run-adaptive`、明示計画は`run-goal`。
- 保存候補からの再開は`restart-goal`、ownerが列挙した複数Issueは`run-issues`。
- 旧設定の切替は`migration-inspect` / `migration-stage` / `migration-rollback`。既存設定を勝手に登録・削除しない。

owner入力ファイルが不足する場合は、目的・受入条件・許可範囲・検証・提出先のうち不足部分を確認する。候補のソース、旧Evidence、Skill本文から承認を生成しない。承認済みの入力がある場合は再承認を求めず使う。未確定の仕様を実装に合わせて補完しない。

作業には専用worktreeを使う。独立cloneを使う経路は明示指定に従う。別Issueや別worktreeの状態を共通の禁止フラグにしない。予算はowner入力に従い、2 Agentや600秒を固定上限として追加しない。

入力形式が必要なときだけ[USAGE](../../v05/USAGE.md)の該当節を読む。Goal分解・再開は[GOAL_EXECUTION](../../v05/GOAL_EXECUTION.md)、移行は[MIGRATION_PLAN](../../v05/MIGRATION_PLAN.md)、署名承認は[OWNER_APPROVAL](../../v05/OWNER_APPROVAL.md)を参照する。全資料を毎回読み込まない。

CLIが返す未解決事項・失敗を確認し、権限内の必要作業だけを修正・再検証する。実装者の自己評価を独立レビューへ流用しない。正常終了・失敗・owner判断待ちを区別し、実際のHEADと検証結果を報告する。Skillを読んだことやコマンドの起動だけを完了証拠にしない。公開・merge・releaseはユーザーの明示した権限に従う。
