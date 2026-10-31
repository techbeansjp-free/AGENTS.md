## マージ後の同期と整理

許可された提出PRのmergeが完了したら、毎回、対象repoのPR状態と実際のマージ先branch・remoteを確認して同期と整理まで行う。`main`やdefault branchに固定しない。`develop`等へのPRならそのbranchが対象。PR作成までの依頼ではmergeせず、この処理はmerge確認後に限る。開発途中のローカルmerge・cherry-pickは提出PRのmergeではなく、この同期・整理の契機にしない。複数の作業branchをまとめた統合branchの提出PRなら、そのmergeを、含まれる作業branchと前の統合branchのworktreeを整理する契機にする。Git未管理の作業には適用しない。

対象remoteをfetchし、マージ先のlocal branchを使用するworktreeがcleanで他の作業に使用されていない場合だけfast-forwardで同期する。未commit変更・local固有commit・分岐・別作業があれば保持して理由を報告する。別worktreeでcheckout中のbranchを奪わず、強制reset・自動stash・rebaseで同期しない。localにマージ先branchがなければ取得したremote refを報告し、無関係なbranchを更新しない。

完了したPRのHEADと整理対象worktreeのHEAD・用途を照合する。squash・rebase mergeではマージ先との祖先判定を使わず、整理対象のHEADがmerge済みPRのHEADの祖先かを確かめる。PRのHEADは通常のfetchでは取得されないため、forgeが示すcommitを取得する（例：`git fetch <remote> refs/pull/<番号>/head`）。取得できない、またはworktreeのbranchにPRのHEADに含まれないcommitがあれば保持する。tracked変更だけでなく、未追跡・ignoredファイル、入れ子のrepo、未push commit、継続中のAgent・プロセス・別Issueの利用も確認する。固有データや進行中の作業がなく不要と確認できた対象だけ、安全な別directoryから通常の`git worktree remove`で削除する。`--force`や一括削除で押し切らない。local branchの削除は成果が保存済みと確認でき通常の削除が可能な場合だけとし、remote branch削除は別途の許可に従う。

上の確認で削除すると決めたworktreeがDockerを使っていれば、worktreeの削除前に、そのworktreeが作ったcontainer・volume・image・networkを削除する。Dockerはhost全体で他のprojectや同じprojectの並行するworktreeと共有されるため、このworktreeの物と確かめられた資源だけを対象にする。

1. compose projectは、作成時に定めたworktree固有のproject名（既定はhost上で一意なworktreeのdirectory名）を使う。その名前の`com.docker.compose.project` labelを持つcontainerが1件以上あり、全件の`com.docker.compose.project.working_dir`がこのworktree配下（pathの区切りで判定）の場合だけ対象にする。containerが無い、または他の場所を指すcontainerがあれば、持ち主を確かめられないので削除せず報告する。
2. 対象のcontainerがmountするvolumeを記録してから、cwdや`.env`に依存しないよう、このworktreeで起動時と同じcomposeファイルを指定して`docker compose -p <確かめたproject名> down --remove-orphans`を実行する。`--volumes`・`--rmi`は使わない。
3. 記録したvolumeのうち、無名volumeと、名前が`<project名>_`で始まりそのproject labelを持つvolumeを個別に削除する。imageは、そのproject labelを持ち、名前が`<project名>-`で始まるもの、またはtagのないものを`docker image rm --no-prune`で削除する。composeファイルの`name:`で名前を固定したvolume、`image:`で付けたtagのimageは他と共有し得るため残す。
4. compose外の資源は、作成時に付けた`asc.worktree=<worktreeの絶対path>`（またはプロジェクト規約のlabel）で絞り込み、個別に削除する（containerは`docker rm -v`）。

repo名やimage名の前方一致だけで絞らない。`docker system prune`等のhost全体の一括削除や`-f`で押し切らない。他のcontainerが使用中または他のimageが依存する資源、共有し得る資源、印のない資源、記録外のproject label付きvolume、host全体のbuild cacheは削除せず報告し、これらだけを理由にworktreeを保持しない。それ以外の理由で`down`や対象の削除に失敗した場合は、worktreeも保持して理由を報告する。

複数repo・Issueでは対象ごとに処理し、一つの保留を他の作業の禁止にしない。すでに整理済みなら何もしない。同期したbranch、削除したworktreeとDockerの資源、保持した対象と理由を完了報告へ簡潔に記す。専用AgentやJournalは追加しない。このSkillはHostへの実行指示であり、CLIがmerge後に自動実行する機能ではない。

