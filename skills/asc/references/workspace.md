# 作業場所の選択・作成・再開

標準入口は `start <project-directory>`。Git管理済みなら専用worktreeを使う。Git未管理の新規フォルダーでも開始でき、現在のHostで要求整理・実装・実テストを進められる。これは作業場所を確認して責務を案内するだけで、別Agentを起動しない。Git初期化・commit・外部公開は勝手に行わない。Git未管理の場合は元要求と実際の変更・テスト結果を独立レビューし、Git差分・commit拘束・PR提出が成立したとは扱わない。Gitを使用しないプロジェクトは実装・実テスト・独立レビューで完了できる。Gitによる提出をユーザーが求めた場合だけGitの導入と専用worktreeへの移行を行う。

新しいGit worktreeを作る前に、対象repoの命名規約・Issue番号・baseを確認する。プロジェクトが別規約を明示していなければ、directoryは`.worktrees/<YYYYMMDD_HHMMSS>-<Issue番号>-<slug>`、branchは`<type>/<Issue番号>-<slug>`とし、Issueとslugを一致させる。日付だけの名前やIssue番号の省略は標準ではない。時刻は作成環境のlocal time、slugは小文字英数字とハイフン、typeは`feature`・`fix`・`refactor`・`test`・`docs`・`chore`。標準作成は`worktree-create <repo-root> <issue> <type> <slug> <base>`を使う。`repo-root`は既存Git checkoutのrootであり、`.worktrees`自体ではない。返されたrepo・branch・baseを確認してから作業する。通常のGitで作る場合も同じ規約を適用する。詳細は[作業場所の規約](../../../v05/USAGE.md)を参照する。

既存worktreeを再開するときは、名前だけを理由に拒否・自動改名しない。複数Issueの作業はそれぞれのrepo・Issue・branch・baseを照合する。Issue番号がない場合はPR番号や日付を代用せず、プロジェクトのIssueなし作業規約を確認し、未定義なら命名に必要な情報だけ確認する。Git未管理の作業にIssue作成やGit導入を強制しない。

ASCの設置場所と作業対象は別に扱う。Git未管理の統合ディレクトリに複数repoがある場合、共通ルールと各repo固有ルールを確認し、対象ごとの許可範囲・作業場所・変更・検証結果を分離する。共通ルールから別repoへの変更許可を推定しない。repoをまたぐ変更は必要な統合テストも実施し、子repoを親の単一commitとして扱わない。未管理ファイルは勝手に追加・削除しない。


## ASC配布版の更新を依頼されたとき

更新の正本は[利用手順](../../../v05/USAGE.md#プロジェクト内の配布資産を導入更新する)と[移行・復元](../../../v05/MIGRATION_PLAN.md)。独自のupdateコマンドを作らず、その版にあるCLIのhelpと配布物を確認する。

対象の利用先ごとに、依頼された範囲、Git/非Git、実際の入口・runtime.jsonの版、導入元、編集済み資産、使用Hostを確認する。別worktreeの旧版を正常な並行作業と区別し、無関係な利用先を一括更新しない。Gitなら専用worktree、非Gitなら利用者のバックアップと変更範囲を確認する。公式Releaseの目的版・checksumと取得物を照合し、最新という名前だけで真正性や適合性を推定しない。

取得・照合したtarballを操作ごとの新規専用一時prefixへ導入し、そのCLIで選んだ版のproject-assetsをpreviewする。既存の`.agent-skill-chain/`や共有prefixへnpm install・uninstall・pruneを実行しない。旧bootstrapの所有が不明なら保持する。導入用prefixの後始末と配布資産の撤去は[利用手順](../../../v05/USAGE.md#配布資産を手動で撤去する)で区別する。競合を確認してから許可範囲でapplyする。Host入口は配布記録に保存されたHostで通常更新にも追従する。previewの`registeredHosts`と`kind: "host-entry"`の追加・更新・削除を確認する。初回やHostを追加するときだけ対応する登録オプションを選び、未登録Hostへの配置を推定しない。旧記録から所有を証明できない入口や編集・削除済み入口は競合として止まり、強制上書きしない。既存AGENTS.md/CLAUDE.md・hook・権限設定はまず読み取り、勝手に変換しない。CLI・配置・Host設定は別の更新対象である。

適用後は実際のversion・入口・正本への参照・必要な検証を照合し、利用者固有の規約・成果を保持したことを確認する。previewのみ、途中停止、競合を更新済みと報告しない。複数利用先は成功・未更新・競合を個別に報告し、一括トランザクションとして全体成功を推定しない。中断時は変更状態を保ち正本の復元手順へ戻る。他の利用先まで巻き戻さず、再適用前に現在状態を確認する。提出・push・mergeはその許可の範囲で行う。
