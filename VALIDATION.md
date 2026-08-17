# 独立検証レポート（セグメント④・validation-gate 入力）
#
# 対象: ISSUE-692「worktree削除の『未pushのcommit』判定がsquash merge済みブランチを誤ってブロックする」
# 形式: .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）
#       に完全一致する純YAML。見出し相当はコメントで表現する。
#
# 検証対象の振る舞い（本レポートが判定した契約。外部参照へ意味を委譲しない）:
#   worktree削除コマンド `cleanup <issue_id>` は、(1) 有効なwriter leaseが無い、(2) 作業ツリーに
#   未commitの変更が無い、(3) ローカル限定commit（remote上のいずれのrefからも到達できず、かつ
#   統合先ブランチへ内容として取り込まれてもいないcommit）が無い、(4) 対応するPRまたは
#   Integration Recordが完了済み（merged または closed）である、の4条件をすべて満たす場合のみ
#   worktreeを削除する。削除時は削除したworktreeパスを標準出力へ返し終了コード0、非削除時は
#   非0終了コードと日本語の拒否理由を標準エラー出力へ返す。保全済みか確定できない場合は削除を
#   拒否する（安全側）。判定はブランチ・ref・作業ツリーを書き換えない。
#
# 検証環境（本レポートの全結果はこの環境での実測である）:
#   Linux / node v20系 / npm test（= tsc build + node --test で test/unit・test/integration 全件）
#   結合テストは実git remote（bare repo）とgh CLIスタブを用い、ビルド後の bin/agents-md.js を
#   子プロセスとして起動する。すなわち実際に配布・実行される成果物そのものを対象にしている。
#
# 総合判定: 全10ACが pass。回帰実行の失敗0件。
#
# ---- 本セグメントで追加した受入テスト（独立検証としての上積み） ----
# 実装セグメントのテスト群は、squash merge後の誤検知の解消（偽陽性）と、ローカル限定commitの
# 取りこぼし防止（偽陰性）を厚く覆っていた一方、次の3点はコマンドの終了コードと副作用で直接
# 立証されていなかった。本セグメントで test/integration/cleanup-preservation-acceptance.test.ts
# を新設し、8本の受入テストで補った（実装コードは一切変更していない。差分は当該テストファイルと
# 本レポートのみ）。
#   1. upstream追跡refが統合先ブランチを指す構成（AC-6）。追跡設定の指し先が判定へ影響しない
#      ことを、upstream基準では統合先に先行commitが見える状態を作って立証した。
#   2. 未pushのcommit以外の3条件（AC-9）。有効なwriter lease・未commitの変更・Integration Record
#      未完了のそれぞれについて、非0終了・固有の日本語理由・worktreeの残存を一体で確認した。
#   3. 未push判定を共有する他用途（AC-10）。期限切れwriter leaseの回収（reconcile）と作業継続の
#      ためのlease再取得（lease resume）の双方について、(a) ローカル限定commitが残るworktree、
#      (b) 全commitがremoteの当該ブランチrefへpush済みで実remoteのheadから到達できるworktree、
#      (c) 全commitがpush済みだった後にsquash mergeで別SHAとして統合され、remoteのIssueブランチ
#      refとremote-tracking refがどちらも削除されたworktree（AC-1と同一構成の保全済みworktree）の
#      3構成を実行し、それぞれの扱いを固定した。
#
# ---- AC-10の保全済み側の「定義された挙動」（本レポートが判定の根拠として採る） ----
# reconcile（期限切れwriter leaseの回収可否判定）と lease resume（作業継続のためのlease再取得時の
# 残作業判定）は、未push判定を「統合位置（GitHub PRのheadRefOid／Integration Recordのhead_sha）を
# 渡さない」形で呼び出す。したがって上記(c)の構成——squash mergeで別SHAとして統合され、remoteの
# Issueブランチrefもremote-tracking refも存在しない保全済みworktree——では、両用途とも当該worktree
# を「保全されていない作業が残る」側として扱う。これが本Issueの変更後の定義された挙動であり、
# 本レポートは次の理由によりAC-10のThen（保全済みworktreeの扱いが定義された挙動に一致し、未定義・
# 不安全な状態にならない）を満たすと判定する。
#   1. 挙動が決定的である。判定入力（統合位置を渡さない呼び出し・remote refの不在・統合先から
#      到達不能なブランチ先端）に対して結果は一意に定まり、実行のたびに変わる余地が無い。上記(c)
#      の構成を両用途で実行する受入テストを追加し、この挙動をテストで固定した。
#   2. 誤りの方向が常に安全側である。reconcileは回収を据え置いて human_required へ昇格するのみで、
#      lease.yaml・lease ref・worktree・commitのいずれも削除しない。lease resumeは再開を許すのみで、
#      ブランチ先端も作業ツリーも書き換えない。どちらの経路も作業を失わせない。
#   3. 失われた作業が実際に無いことを同一テスト内で立証している。同じ(c)構成のworktreeに対し、
#      統合位置を受け取る cleanup は終了コード0で削除に成功する。すなわち作業は統合先へ保全済み
#      であり、reconcile・lease resume の「未保全側」扱いは情報不足による安全側の据え置きである。
# 残る影響は、回収されない期限切れleaseが運用上残り得ることに限られる。これは削除拒否と同種の
# 運用上の不便であり、作業消失でも未定義動作でもなく、本Issueの目的（cleanupの削除誤検知の解消）
# とは独立である。上記(b)の構成では両用途とも保全済み側として扱われる（回収する・再開を拒否する）
# ことも併せて固定した。
#
# ---- 成果物要求に関する観測（info、origin: specification、判定には用いていない） ----
# 本ブランチの差分は `.agent-skill-chain/schemas/integration.schema.yaml`（Integration Recordの
# head_shaの定義追記）を含む。`verify artifacts ISSUE-692 validation` は実行時に
# 「quick（size:quick）が指定されていますが、変更差分に .agent-skill-chain/schemas/ 配下が
# 含まれるため quick 適用対象外であり通常の成果物要求を適用します」という通知を標準エラーへ出す。
# すなわち本Issueは免除条件から外れており、DESIGN.md・PLAN.md を伴う通常フローが要求される状態に
# あるが、両成果物は本ブランチに存在しない。validationセグメントの成果物検査自体は
# VALIDATION.md の存在により終了コード0で通る（セグメント単位の検査であり、CIも差分から検出した
# セグメントのみを対象とするため、design セグメントは検査対象に入らない）。本レポートの全AC判定は
# この事実に依存しないため result へは反映していない。取り扱い（現状維持か、成果物を追加するか、
# 免除条件の判定時点を見直すか）は進行役の判断領域であるため、観測事実としてのみ記録する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-692
target_sha: 9533dc4ee1a583b2a62fe8f825c60a59f4d596ba

acceptance_criteria:
  # AC-1: 全commitがpush済みかつsquash mergeで統合済み、統合先は分岐後に前進していてIssueブランチ
  # 先端のtreeと一致するcommitが履歴に無い、remote refとremote-tracking refは削除済み。この構成で
  # cleanup が終了コード0で削除し、未push起因の拒否を出さないこと。
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: main前進後のsquash mergeでupstreamがgoneになってもworktreeを削除できる — PASS（統合先を別変更で前進させたうえでsquash merge、remoteのIssueブランチ削除。テスト内で『Issueブランチ先端がmainの祖先でないこと』『branchとmainのtreeが不一致であること』を前提として明示検査。cleanup終了コード0、標準出力に削除したworktreeパス、worktree実体の消滅を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: local backendでremote ref削除後もIntegration Recordの記録SHA以前なら削除できる — PASS（ローカルモードでも同一構成で削除成功。Integration Recordのhead_shaが統合時点のブランチSHAであることを確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: 同一pathの複数commitをsquash統合後もIntegration Recordの記録SHAにより削除できる — PASS（同一pathを連続更新した2commitがsquash統合された構成でも削除成功）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: default branchが別変更で前進した後のsquash mergeもPR headによりfalseになる — PASS（判定関数単体でも同一構成でfalse）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: squashマージ後にリモートブランチが削除されてもPR head以降のcommitが無ければfalseになる — PASS"

  # AC-2: PRがsquash mergeでマージ済みである一方、マージ後に作られたcommitがremoteのどのrefからも
  # 到達できず統合先にも取り込まれていない。cleanup が非0で終了し、保全されていないcommitが残る旨と
  # 特定に足る情報（SHAまたは件数）を日本語で出力し、PRマージ済みを根拠に削除しないこと。
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: squash merge後のローカル限定内容commitは削除せず保護する — PASS（PR状態はMERGED。終了コード1、標準エラーに『保全されていないcommit: N件』と短縮SHA、worktree残存を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: squash merge後のローカル限定空commitは削除せず保護する — PASS（内容変更を伴わない空commitでも保護対象になること）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: squash済みpathのローカル限定変更とrevertはSHAを表示しworktreeを残す — PASS（変更commitのSHAが出力に現れ、統合済みのrevert commitのSHAは現れないことまで確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: local backendでsquash後の同一path変更とrevertをIntegration RecordのSHAより後として保護する — PASS"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: 既存pathの変更を戻して別pathだけ統合した場合も到達不能commitを削除しない — PASS（最終差分から消えたpathを触ったcommit列を3件として報告）"
      - "npm test（test/unit/worktree.test.ts）: inspectUnpushedCommits: pathspec magicと同名のファイルを追加したローカル限定commitを未保全として報告する — PASS（commit由来のファイル名がpathspecとして解釈される経路が塞がれていること）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: squash済みpathのローカル限定変更とrevertをPR headとの内容一致で見逃さない — PASS"

  # AC-3: commitは存在するがremoteへ一度もpushされておらず、統合先にも取り込まれておらず、対応する
  # マージ済みPRも無い。cleanup が非0で終了し、保全されていないcommitが残る旨を日本語で出力すること。
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: 未push commit後のdraft Recordを手編集でclosedにしてもSHAを表示して削除を拒否する — PASS（未push commitのSHAをhead_shaへ手編集で埋めても自己参照を保全根拠にしない。終了コード1、『保全されていないcommit: 1件』と短縮SHAを出力し、統合完了に関するメッセージは出さないことまで確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: upstreamもremote refも無いローカル限定commitとrevertは削除せず保護する — PASS（最終treeが分岐点と一致する構成でも2件を未保全として報告）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: upstreamもremote refも無いローカル限定の空commitは削除せず保護する — PASS"
      - "npm test（test/integration/issue-lifecycle.test.ts）: pr complete: 未pushのbranch先端はhead_shaへ記録せず状態遷移を拒否する — PASS（保全されていない位置を統合位置として記録させない上流側の防御。短縮SHAを含む日本語理由を出力）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: push前はtrue、git push -u origin後はfalseになる — PASS"

  # AC-4: Issueブランチ先端が統合先ブランチの祖先となる形（merge commit方式またはfast-forward）で
  # 統合済み。cleanup が終了コード0で削除し、未push起因の拒否を出さないこと。
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: merge-commitで統合済みのworktreeをコマンド経由で削除できる — PASS（--no-ffマージ後にremoteのIssueブランチを削除。cleanup終了コード0、削除パスの標準出力、worktree実体の消滅を確認）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: merge commit方式で統合済みなupstream goneブランチはfalseになる — PASS"

  # AC-5: 各commitがrebase merge方式で別SHAとして統合先へ取り込まれ、Issueブランチ先端は統合先の
  # 祖先ではない。cleanup が終了コード0で削除し、未push起因の拒否を出さないこと。
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: rebase-mergeで統合済みのworktreeをコマンド経由で削除できる — PASS（統合先を前進させたうえでcherry-pickにより別SHAで取り込み、remoteのIssueブランチを削除。cleanup終了コード0とworktree消滅を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: PR head後のローカルcommitがcherry-pick済みなら削除できる — PASS（PR head以降のcommitが別SHAで統合済みの場合も削除できること）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: rebase merge方式でSHAが変わった統合済みブランチはfalseになる — PASS"

  # AC-6: upstream追跡refがIssueブランチ自身のremote refではなく統合先ブランチを指し、upstream基準
  # では先行commitが存在するように見える構成。内容はsquash mergeで統合済みでローカル限定commitは
  # 無い。cleanup が終了コード0で削除し、未push起因の拒否を出さないこと。
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: cleanup: upstream追跡refが統合先ブランチを指していてもsquash統合済みworktreeを削除できる — PASS（branch.<name>.remote=origin / branch.<name>.merge=refs/heads/main を設定し、テスト内で『upstreamがorigin/mainへ解決されること』『upstream基準では統合先に先行commitが存在するように見えること（rev-list --count が0でないこと）』を前提として明示検査。そのうえで cleanup 終了コード0、削除パスの標準出力、worktree実体の消滅を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: main前進後のsquash mergeでupstreamがgoneになってもworktreeを削除できる — PASS（upstreamが解決不能な状態でも判定が変わらないこと）"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: upstreamがgone状態でもdefault branchへ未統合の内容が残っていればtrueのままになる — PASS（upstream状態が判定根拠でないことの反対方向の確認。追跡設定に依らず未保全は未保全と判定される）"

  # AC-7: 全commitがremoteの当該ブランチrefへpush済みで統合先にはまだ取り込まれていない。対応するPR
  # またはIntegration Recordはcloseされている。cleanup が終了コード0で削除し、remoteへ保全済みの
  # 未マージcommitを未push扱いで拒否しないこと。
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: live remote headはlocal remote-tracking refが無くてもpush済みと判定する — PASS（commitはremoteのIssueブランチへpush済みで統合先には未取り込み、Integration Recordはclosed、ローカルのremote-tracking refは削除済み。テスト内で『local remote-tracking refが存在しないこと』『実remoteにはIssueブランチが存在すること』を前提として明示検査。cleanup終了コード0とworktree消滅を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: localに未取得のremote descendantを取得してから到達可能性を判定する — PASS（Integration Record closed、remoteが未取得のdescendantへ前進している構成でも、当該objectを取得したうえで到達可能と判定し削除できること）"

  # AC-8: 統合先ブランチを特定できない等の理由で保全済みか確定できない。cleanup が非0で終了し、
  # 保全状況を確定できなかった旨とその事由を日本語で出力すること。不確定を保全済みと扱わないこと。
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: デフォルトブランチを特定できない場合は理由を表示してworktreeを残す — PASS（終了コード1、標準エラーに『commitの保全状況を確認できないため削除できません』と『デフォルトブランチを特定できません』、worktree残存を確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: remoteへの問い合わせに失敗した場合は判定不能としてworktreeを残す — PASS（remote URLを不在パスへ差し替え。『実リモート origin を確認できません』を出力）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: localに未取得のremote descendantを取得できなければ削除を拒否する — PASS（2回目以降のupload-packを失敗させ、取得不能なremote headを到達可能とも不能とも判定せず拒否すること）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: head_shaが無い既存Integration Recordは対応方法を示して削除を拒否する — PASS（位置を推測せず、利用者が取るべき対応を日本語で提示）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: cleanup: 相殺された追加pathと統合済みpathが混在しても保全位置不明なら削除を拒否する — PASS"
      - "npm test（test/unit/worktree.test.ts）: hasUnpushedCommits: 実remoteで削除済みの古いremote-tracking refをpush済み根拠にしない — PASS（実remoteと一致しないローカルrefを保全の根拠にしないこと）"

  # AC-9: 有効なwriter leaseがあるworktree・未commitの変更が残るworktree・PRまたはIntegration Record
  # が未完了のworktreeについて、いずれも非0終了で削除されず、条件ごとの既存の日本語拒否理由が
  # 出力されること（他3条件の意味と挙動が回帰していないこと）。
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: cleanup: 有効なwriter lease・未commitの変更・Integration Record未完了はそれぞれの理由で削除を拒否する — PASS（同一worktreeで3条件を順に成立させ、それぞれ終了コード1、標準エラーが『有効な writer lease が存在するため削除できません』『未commitの変更があるため削除できません』『Integration Record が完了済み（merged または closed）ではないため削除できません』であること、および各回でworktreeが残存することを確認）"
      - "npm test（test/integration/issue-lifecycle.test.ts）: issue lifecycle (local backend): start -> lease -> segment -> gate -> checkpoint -> pr -> cleanup — PASS（Integration Record未完了時の拒否と、完了後の削除成功を素通しで確認。削除経路がworktree削除とpruneのままであることを含む）"
      - "npm test（test/integration/github-backend.test.ts）: issue lifecycle (github backend): lease acquire/release/re-acquire -> gate publish(Check Run) -> pr create -> cleanup — PASS（GitHubモードでも同一の削除条件で完了すること）"
      - "npm test（test/integration/claude-pretooluse.test.ts）: cleanupを経由しないgit worktree remove直接実行はexit 2で拒否される — PASS（削除経路がcleanupに限定されたままであること）"

  # AC-10: 期限切れwriter leaseの回収可否判定と、作業継続のためのlease再取得時の残作業判定において、
  # ローカル限定commitが残るworktreeが「保全されていない作業が残る」側として扱われ回収による作業
  # 消失が起きないこと。保全済みworktreeの扱いも定義された挙動に一致し未定義・不安全にならないこと。
  # 保全済み側は、AC-1と同一構成（squash mergeで別SHAとして統合済み、remoteのIssueブランチrefと
  # remote-tracking refはどちらも削除済み）を両用途で実行して扱いを確定させた。観測された扱いを
  # 「定義された挙動」と判定した根拠は本レポート冒頭のAC-10の節に記載し、テストで固定している。
  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: reconcile: ローカル限定commitが残るworktreeの期限切れleaseは回収せず人間判断へ昇格する — PASS（一度もpushしていないcommitが残る状態で期限切れleaseを作り、reconcileの出力が reclaimed:(none) / escalated: ISSUE-692:implementation（human_required）となり、lease.yamlとworktreeがともに残存することを確認）"
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: reconcile: push済みで未保全commitが無いworktreeの期限切れleaseは回収される — PASS（実remoteのheadから到達できる保全済み側の定義された挙動。reclaimedとしてlease.yamlのみ削除され、worktreeはreconcileの対象外として残る）"
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: reconcile: squash merge済みで保全済みのworktreeの期限切れleaseは回収を据え置く — PASS（AC-1と同一構成の保全済みworktree。統合先を分岐後に前進させたうえでsquash merge、Integration Recordのhead_shaが統合時点のブランチSHAであること・remote-tracking refとremoteのIssueブランチrefがともに存在しないこと・ブランチ先端が統合先の祖先でないことを前提として明示検査。reconcileは reclaimed:(none) / escalated: ISSUE-692:implementation（human_required）となりlease.yamlもworktreeも残す。続けて同一worktreeに対しcleanupが終了コード0で削除に成功することまで同一テスト内で確認し、据え置きが情報不足による安全側の扱いであって作業消失を伴わないことを立証した）"
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: lease resume: ローカル限定commitだけが残るworktreeは残作業ありとして再開できる — PASS（未commitの変更が無いことを前提検査したうえで、未pushのcommitだけを根拠に再開が成立し、当該ファイルが削除されず残ることを確認）"
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: lease resume: push済みで未保全commitも未commitの変更も無いworktreeは再開を拒否する — PASS（実remoteのheadから到達できる保全済み側の定義された挙動。『未commitまたは未pushの変更がありません』で拒否）"
      - "npm test（test/integration/cleanup-preservation-acceptance.test.ts、本セグメントで追加）: lease resume: squash merge済みで保全済みのworktreeは残作業あり側として再開を許す — PASS（AC-1と同一構成の保全済みworktree。remote-tracking refとremoteのIssueブランチrefがともに存在しないこと・ブランチ先端が統合先の祖先でないこと・未commitの変更が無いことを前提として明示検査。resumeは終了コード0で成立し、統合済みの内容とブランチ先端SHAが書き換わらないことを確認。続けてlease releaseの後、完了済みPRのheadRefOidを受け取るcleanupが同一worktreeを終了コード0で削除できることまで確認し、再開の許可が情報不足による安全側の扱いであって作業消失を伴わないことを立証した）"
      - "npm test（test/integration/reconcile.test.ts）: reconcile (トップレベル): worktreeに未commitの変更が残る期限切れleaseはescalatedされ回収されない / worktreeが無い期限切れleaseはreclaimedされ、lease.yamlが削除される — いずれもPASS（未commit側の既存挙動が回帰していないこと）"

regression:
  executed: true
  evidence:
    - "npm test 全件（tsc build + test/unit + test/integration、対象 9533dc4ee1a583b2a62fe8f825c60a59f4d596ba）: tests 1319 / suites 0 / pass 1318 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 370467。終了コード0"
    - "唯一のskipは『GitHub導入元へ実際に到達してpackage versionを取得できる』（環境変数 ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定した場合だけ実行するlive到達性テスト。本Issueと無関係の恒常的な条件付きskip）"
    - "本セグメント着手時点のベースライン（対象 1ac570b45d57e997923fd5fab237838c823c2cd3、受入テスト追加前）: tests 1311 / pass 1310 / fail 0 / skipped 1。差の8件は本セグメントで追加した受入テストであり、既存テストの増減・失敗は無い（うち2件はAC-10の保全済み側をsquash merge済み構成で検証するため本ラウンドで追加した）"
    - "npm run typecheck（tsc --noEmit -p tsconfig.test.json）: エラー0件"
    - "本セグメントの差分は test/integration/cleanup-preservation-acceptance.test.ts の新設・追記と本レポートのみで、src/ 配下・.agent-skill-chain/ 配下の実装資産を変更していない。target_sha は検証を実行したブランチ先端であり、本レポートのcommitは VALIDATION.md 以外を変更しない"
