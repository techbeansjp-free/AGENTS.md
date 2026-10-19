# 作業場所の選択・作成・再開

標準入口は `start <project-directory>`。Git管理済みなら専用worktreeを使う。Git未管理の新規フォルダーでも開始でき、現在のHostで要求整理・実装・実テストを進められる。これは作業場所を確認して責務を案内するだけで、別Agentを起動しない。Git初期化・commit・外部公開は勝手に行わない。Git未管理の場合は元要求と実際の変更・テスト結果を独立レビューし、Git差分・commit拘束・PR提出が成立したとは扱わない。Gitを使用しないプロジェクトは実装・実テスト・独立レビューで完了できる。Gitによる提出をユーザーが求めた場合だけGitの導入と専用worktreeへの移行を行う。

新しいGit worktreeを作る前に、対象repoの命名規約・Issue番号・baseを確認する。プロジェクトが別規約を明示していなければ、directoryは`.worktrees/<YYYYMMDD_HHMMSS>-<Issue番号>-<slug>`、branchは`<type>/<Issue番号>-<slug>`とし、Issueとslugを一致させる。日付だけの名前やIssue番号の省略は標準ではない。時刻は作成環境のlocal time、slugは小文字英数字とハイフン、typeは`feature`・`fix`・`refactor`・`test`・`docs`・`chore`。標準作成は`worktree-create <repo-root> <issue> <type> <slug> <base>`を使う。`repo-root`は既存Git checkoutのrootであり、`.worktrees`自体ではない。返されたrepo・branch・baseを確認してから作業する。通常のGitで作る場合も同じ規約を適用する。詳細は[作業場所の規約](../../../v05/USAGE.md)を参照する。

既存worktreeを再開するときは、名前だけを理由に拒否・自動改名しない。複数Issueの作業はそれぞれのrepo・Issue・branch・baseを照合する。Issue番号がない場合はPR番号や日付を代用せず、プロジェクトのIssueなし作業規約を確認し、未定義なら命名に必要な情報だけ確認する。Git未管理の作業にIssue作成やGit導入を強制しない。

ASCの設置場所と作業対象は別に扱う。Git未管理の統合ディレクトリに複数repoがある場合、共通ルールと各repo固有ルールを確認し、対象ごとの許可範囲・作業場所・変更・検証結果を分離する。共通ルールから別repoへの変更許可を推定しない。repoをまたぐ変更は必要な統合テストも実施し、子repoを親の単一commitとして扱わない。未管理ファイルは勝手に追加・削除しない。

