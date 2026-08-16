# SPEC: worktree削除の「未pushのcommit」判定がsquash merge済みブランチを誤ってブロックする

- Issue: `ISSUE-692`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/692-cleanup-squash-merge-detection`

## 目的・背景

worktree削除コマンド（`.agent-skill-chain/scripts/cleanup.sh` および同等のCLIサブコマンド `cleanup`）は、削除前に4つの条件（有効なwriter leaseが無い・作業ツリーに未commitの変更が無い・未pushのcommitが無い・対応するPRまたはIntegration Recordが完了済み）を検査し、すべて満たす場合のみworktreeを削除する。この4条件は、進行中の作業や失われる変更を伴うworktreeを誤って消さないための安全装置である。

このうち「未pushのcommitが無い」条件が、squash mergeでPRをマージする運用において、実際には全ての変更が remote と統合先ブランチへ取り込まれているにもかかわらず「未pushのcommitがあるため削除できません」として削除を拒否する事象が発生した。squash mergeは、Issueブランチの複数commitを統合先ブランチ上の1つの新しいcommitに置き換えるため、Issueブランチ先端のcommit SHAは統合先ブランチの祖先にならない。またマージ時点で統合先ブランチが分岐後に前進していると、生成されるcommitのtreeはIssueブランチ先端のtreeとも一致しない。この結果、SHAの一致・祖先関係・tree一致のいずれも成立せず、作業内容は完全に保全されているのに「失われる変更がある」と判定される。

本Issueの目的は、この誤検知（保全済みのworktreeを削除できない）を解消しつつ、逆方向の欠陥（本当に失われる作業があるworktreeを削除してしまう）を新たに作らないことである。誤検知は運用上の不便にとどまるが、取りこぼしは復元不能な作業消失であり、両者は等価ではない。判断が確定できない場合は削除を拒否する側へ倒す。

## 前提・用語

- Issueブランチ: 1つのIssueに対応するブランチ。1 Issue = 1ブランチ = 1 worktree = 1 PR の分離規約に従う。
- 統合先ブランチ: IssueブランチのPRがマージされる先のブランチ（このリポジトリの既定は `main`）。
- upstream追跡ref: ローカルブランチに設定された追跡先（例: `origin/<ブランチ名>` に相当するremote-tracking ref）。設定されていない、設定はあるが参照先が削除済み（gone）、統合先ブランチを指している、といった状態を取り得る。
- squash merge: Issueブランチの変更内容を1つの新しいcommitとして統合先ブランチへ載せるマージ方式。commit SHAは保存されない。
- merge commit方式: 2つの親を持つマージcommitを作る方式。Issueブランチ先端は統合先ブランチの祖先になる。
- rebase merge方式: Issueブランチの各commitを統合先ブランチ上に付け替える方式。変更内容は1対1で保存されるがcommit SHAは変わる。
- ローカル限定commit: そのcommitが持つ変更内容が、remote上のいずれのrefからも到達できず、かつ統合先ブランチの履歴にも取り込まれていないcommit。worktreeを削除するとこの内容は復元できない。
- 保全済み: Issueブランチ上の全commitについて、変更内容がremote上のいずれかのrefから到達可能であるか、または統合先ブランチへ取り込まれている状態。つまりローカル限定commitが1つも存在しない状態。

## 入力・出力

- 入力: 削除対象のIssue ID、対象worktreeとIssueブランチのGit状態（commit・ref・追跡設定・統合先ブランチの履歴）、および利用可能な場合は対応するPRまたはIntegration Recordの状態。
- 出力: 削除に成功した場合は終了コード0と削除したworktreeパスを標準出力へ。削除しない場合は非0の終了コードと、拒否理由を説明する日本語メッセージを標準エラー出力へ。

## 要求 → 要件 → 受入条件

### 要求

- squash mergeでPRをマージした運用者が、マージ完了後にworktree削除コマンドを実行して、追加の手作業や強制オプションなしにworktreeを削除できること。
- 同時に、まだどこにも保全されていない作業が残るworktreeについては、これまで通り削除が拒否され、作業が失われないこと。

### 要件

1. 「未pushのcommitがある」という削除拒否は、ローカル限定commitが存在する場合にのみ発生させる。commit SHAの一致や祖先関係が成立しないこと自体を、作業が失われる根拠にしてはならない。
2. squash mergeによってIssueブランチの内容が統合先ブランチへ取り込まれている場合、保全済みと判定する。統合先ブランチが分岐後に他の変更も取り込んでおり、Issueブランチ先端のtreeと一致するcommitが統合先ブランチの履歴に存在しない場合も同様とする。
3. merge commit方式・rebase merge方式でマージされている場合も、同じく保全済みと判定する（本Issueの対象範囲に含む）。
4. 判定結果は、upstream追跡refの状態（未設定・gone・統合先ブランチを指している・remoteの実体と乖離している）によって変わってはならない。追跡設定の有無は作業が失われるかどうかの根拠ではない。
5. ローカル限定commitが1つでも存在する場合は削除を拒否し、拒否理由と、保全されていないcommitを運用者が特定できる情報（commit SHAまたは件数）を日本語で出力する。PRがマージ済みであることだけを根拠に、この検査を省略してはならない。
6. 保全済みかどうかを確定できない場合（統合先ブランチを特定できない、判定に必要な情報を取得できない等）は、削除を拒否し、何が確定できなかったかを日本語で示す。不確定を保全済みとして扱ってはならない。
7. 判定処理は、Issueブランチ・統合先ブランチ・remote上のrefおよび作業ツリーの内容を変更しない（読み取りと情報取得のみで完結させる）。
8. 削除可否の他の3条件（writer lease・未commitの変更・PRまたはIntegration Recordの完了）の意味と挙動、および削除がworktree削除操作とpruneを経由する点は変更しない。
9. 「未pushのcommitがあるか」という判定を共有する他の用途（期限切れwriter leaseの回収可否判定、作業継続のためのlease再取得時の残作業判定）において、ローカル限定commitが残るworktreeを安全でないものとして扱う性質を維持する。
10. 判定はGitの事実だけで成立させる。Coordination Backendから得られる追加情報（PRのマージ状態等）は補助として利用してよいが、GitHubモードでもローカルモードでも、squash merge済みのworktreeで誤検知が起きてはならない。

### 受入条件（Acceptance Criteria）

各受入条件は散文形式のGiven/When/Thenで記述し、検証方法見込みを `automated`・`manual`・`hybrid` のいずれか1語で示す。

#### AC-1: squash merge済みで統合先が前進していてもworktreeを削除できる

- Given: Issueブランチの全commitがremoteへpush済みで、その内容がsquash mergeにより統合先ブランチへ取り込まれている。統合先ブランチは分岐後に別の変更も取り込んでおり、Issueブランチ先端のtreeと一致するcommitは統合先ブランチの履歴に存在しない。remote上のIssueブランチrefとローカルのremote-tracking refはマージ後に削除されている。有効なwriter leaseは無く、作業ツリーに未commitの変更は無く、対応するPRまたはIntegration Recordは完了済みである。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コード0で削除が成功し、削除したworktreeパスが標準出力へ出る。「未pushのcommitがあるため削除できません」等の未push起因の拒否は発生しない。
- 検証方法見込み: `automated`

#### AC-2: マージ後に作られた未pushのcommitが残る場合は削除を拒否する

- Given: IssueブランチのPRがマージ済み（squash merge）である一方、そのマージ後にworktree内で新しいcommitが作られ、remoteのどのrefからも到達できず統合先ブランチにも取り込まれていない状態で残っている。他の削除条件（writer lease・未commitの変更・PR完了）はすべて満たしている。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コードが非0となり削除は行われず、保全されていないcommitが残っている旨と、その特定に足る情報（commit SHAまたは件数）を含む日本語メッセージが標準エラー出力へ出る。PRがマージ済みであることを根拠に削除が許可されることはない。
- 検証方法見込み: `automated`

#### AC-3: 一度もpushしていない作業が残る場合は削除を拒否する

- Given: Issueブランチにcommitが存在するが、remoteへ一度もpushされておらず、統合先ブランチにも取り込まれておらず、対応するマージ済みPRも存在しない。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コードが非0となり削除は行われず、保全されていないcommitが残っている旨の日本語メッセージが標準エラー出力へ出る。
- 検証方法見込み: `automated`

#### AC-4: merge commit方式でマージ済みのworktreeを削除できる

- Given: Issueブランチの内容が、Issueブランチ先端が統合先ブランチの祖先となる形（merge commit方式またはfast-forward）で統合先ブランチへ取り込まれている。他の削除条件はすべて満たしている。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コード0で削除が成功し、未push起因の拒否は発生しない。
- 検証方法見込み: `automated`

#### AC-5: rebase merge方式でマージ済みのworktreeを削除できる

- Given: Issueブランチの各commitが、rebase merge方式により別のcommit SHAとして統合先ブランチへ取り込まれている。Issueブランチ先端は統合先ブランチの祖先ではない。他の削除条件はすべて満たしている。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コード0で削除が成功し、未push起因の拒否は発生しない。
- 検証方法見込み: `automated`

#### AC-6: upstream追跡refが統合先ブランチを指す構成でも誤検知しない

- Given: Issueブランチのupstream追跡refが、そのブランチ自身のremote refではなく統合先ブランチを指すよう設定されており（そのためupstream基準では先行commitが存在するように見える）、Issueブランチの内容はsquash mergeで統合先ブランチへ取り込まれ、ローカル限定commitは存在しない。他の削除条件はすべて満たしている。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コード0で削除が成功し、未push起因の拒否は発生しない。
- 検証方法見込み: `automated`

#### AC-7: push済みで未マージのcommitは未push理由でブロックされない

- Given: Issueブランチの全commitがremoteの当該ブランチrefへpush済みで、統合先ブランチにはまだ取り込まれていない。対応するPRまたはIntegration Recordはcloseされており、他の削除条件も満たしている。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コード0で削除が成功する。remoteへ保全済みの未マージcommitが未push扱いで拒否されることはない。
- 検証方法見込み: `automated`

#### AC-8: 保全済みか確定できない場合は削除を拒否する

- Given: 統合先ブランチを特定できない等の理由で、Issueブランチのcommitが保全済みかどうかを確定できない。Issueブランチにはcommitが存在する。
- When: 対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: 終了コードが非0となり削除は行われず、保全状況を確定できなかった旨とその事由を示す日本語メッセージが標準エラー出力へ出る。
- 検証方法見込み: `automated`

#### AC-9: 他の削除条件の挙動が回帰していない

- Given: 有効なwriter leaseが存在するworktree、作業ツリーに未commitの変更が残るworktree、対応するPRまたはIntegration Recordが未完了のworktreeをそれぞれ用意する。
- When: それぞれについて対象Issue IDを指定してworktree削除コマンドを実行する。
- Then: いずれも終了コードが非0となり削除は行われず、それぞれの条件に対応する既存の日本語拒否理由（有効なwriter lease・未commitの変更・PRまたはIntegration Record未完了）が出力される。
- 検証方法見込み: `automated`

#### AC-10: 未push判定を共有する他用途の安全性が維持される

- Given: 期限切れwriter leaseの回収可否判定と、作業継続のためのlease再取得時の残作業判定の対象として、ローカル限定commitが残るworktreeと、squash merge済みで保全済みのworktreeをそれぞれ用意する。
- When: それぞれの用途で判定を実行する。
- Then: ローカル限定commitが残るworktreeは、いずれの用途でも「保全されていない作業が残る」側として扱われ、回収による作業消失が起きない。保全済みのworktreeについての扱いは本Issueの変更後も定義された挙動に一致し、未定義・不安全な状態にならない。
- 検証方法見込み: `automated`

## 制約

- 削除は不可逆であるため、判定が不確実な場合は必ず拒否側へ倒す（安全側の既定）。
- 判定のためにブランチ・ref・作業ツリーを書き換えない。読み取りと情報取得のみで行う。
- 本コマンドは進行役が実行する調整操作であり、Issueブランチへcommitを追加しない。
- 出力契約（成功時は削除したworktreeパスを標準出力へ、失敗時は非0終了コードと日本語理由を標準エラー出力へ）を維持する。
- worktreeの削除経路（Git のworktree削除操作とprune）は変更しない。

## 未決事項

- 保全済み判定の根拠として、remoteへの情報取得（fetch等）を行うか、ローカルに存在する情報のみで判断するか。オフライン環境での挙動を含めて設計セグメントで決定する。
- Coordination Backendから得られるPRのマージ状態やマージ先commitの情報を補助的な根拠として使うかどうか。使う場合も、ローカル限定commitの検査を省略しない前提を満たす必要がある。
- 保全済み判定に用いる粒度（ブランチ全体か個々のcommitか）と、その計算コストが実運用で許容できるか。

## スコープ外

- writer lease・未commitの変更・PRまたはIntegration Record完了という他3条件の判定基準そのものの変更。
- worktree削除後のローカルブランチ削除やremoteブランチ削除といった、削除範囲の拡張。
- マージ方式の変更、PRマージコマンドの挙動変更、マージ後の統合先ブランチ同期処理の変更。
- 判定を運用者が無効化・強制迂回できるオプションの追加。
