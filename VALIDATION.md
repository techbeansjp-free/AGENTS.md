# VALIDATION: agent-skill-chain — writer leaseの真の原子性強化・.worktrees未gitignore・gate-report digest不一致検知漏れ
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# (agent-skill-chain/validation-report/v1) に完全一致する単一YAMLドキュメントである。
#
# 注記: .agent-skill-chain/templates/issue/VALIDATION.md のテンプレートは
# Markdown見出し + AC毎に分割した複数の```yaml```フェンスという構造だが、
# src/commands/verify.ts の acCoverage() は本ファイル全体を readYamlFile()
# （yamlパッケージの parse() を生のテキストへ直接適用）で1つのYAML文書として
# 読み込む実装であり、Markdown見出しや複数フェンスが混在するとパースに失敗する
# （先行issue #171・#166・#174で実機確認済み）。よって本ファイルはテンプレートの見出し構造ではなく、
# スキーマが要求するフィールドをすべて満たす1つのYAMLとして記述する（見出し相当の情報は
# 本コメントとキー名・配列構造で表現する）。
#
# 本検証は実装者本人とは別の独立した検証者として実施した。実装者の自己申告
# （384/384テストpass等）を鵜呑みにせず、以下すべてを自ら再実測した:
#   - npm test をこのworktreeで実行し件数を実測（conformance/falsification共通の前提）。
#     384/384 pass, 0 fail, 0 skipped を実測（実装者報告と一致）。
#   - test/integration/lease-concurrency.test.ts を読み、gh-stub/モック無しの実子プロセス
#     spawn + 実bare remoteへの実git pushであることをコードレベルで確認したうえで、
#     `node --import tsx --test` により単体で13回連続実行し（うち5回は個別に、8回は
#     ループで）、全回で2/2 pass・0 failであることを確認した（flaky挙動なし）。
#   - 上記とは別に、実装コードを一切参照せず自分で書いた独立スクリプト
#     （/tmp scratchpad配下、テストスイート外）で、ビルド済みCLI（bin/agents-md.js）に対し
#     ローカル/GitHub両バックエンドそれぞれ10プロセスの`lease acquire`を実際に同時spawnさせ、
#     8回連続実行した（計16レース）。全レースで成功が常に1件のみであることを実測した。
#   - AC-3: `.gitignore`への`.worktrees/`追加が、リポジトリに既存の`.worktrees/.gitignore`
#     （トラック済みプレースホルダファイル）と組み合わさったときの実際の挙動を、
#     /tmp隔離gitリポジトリ（実リポジトリの履歴を模した順序でコミット）で確認した。
#     git statusのclean判定・doctorのmain worktree cleanチェックは意図通り機能するが、
#     `git check-ignore -v .worktrees`（ディレクトリパス自体への実行）はexit 1のままである
#     ことを発見した（findings参照、AC-3自体の合否には影響しない）。
#   - AC-4/AC-5: 実装者のテスト（test/integration/verify.test.ts、issue start→gate review→
#     承認→ファイル削除の完全なe2eフロー）を実行して確認したことに加え、それとは別に
#     独立して手組みしたgate-report.yamlに対しverify gate-reportを直接実行し、
#     ベースライン成功→内容変更で不一致検知→削除で不一致検知、の3段階を自ら再現した。
#   - AC-6: 実装者のテスト（lease-renew.test.ts）に加え、独立スクリプトでローカルバックエンドの
#     leaseを取得しexpires_atを直接過去日時へ書き換えたうえでrenewを実行し、正しいtokenでも
#     拒否されexpires_atが書き換わらないことを実測した。GitHubモードの期限切れチェックは
#     本Issue以前から実装済みだったこと（対称性の欠落が本当にローカル側のみだったこと）を
#     git logで確認した。
#   - 全PLAN.mdタスク（#1〜#13）に対応するコード変更の有無をgit diff/git showで1件ずつ突合した。
#   - `git diff --stat` で本Issueの全コミット差分ファイル一覧を取得し、PLAN.md/DESIGN.mdが
#     明示していなかった src/commands/reconcile.ts の変更（旧listLeaseComments/
#     deleteLeaseComment APIの置換）を検出し、内容の妥当性と既存テスト（reconcile.test.ts、
#     6/6 pass）でのregression有無を確認した（findings参照）。
#   - npm run typecheck を実行しエラー0件を確認、削除されたAPI
#     （listLeaseComments/deleteLeaseComment）への残存参照が無いことをgrepで確認した。
#   - 検証後、隔離git repo・独立スクリプトが作成した一時ディレクトリ（/tmp配下）は削除した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-176
target_sha: 7dccad52d8cb79d3fb503d4c3f25a41d748ddc5e

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（test/integration/lease-concurrency.test.ts、実bare remoteへの実git push・8並行子プロセス）に加え、実装コードを見ずに独立して書いたスクリプトで同様の並行acquireを別途10プロセス×複数回実測した"
      procedure: "1) test/integration/lease-concurrency.test.tsのGitHubバックエンドテストを単体実行（node --import tsx --test）し13回連続で2/2 pass・0 failを確認。2) /tmp独立スクリプトでcreateTmpRepo相当のbare remote+gh-stubを自前構築し、bin/agents-md.js lease acquire ISSUE-9 specを10プロセス同時spawnするレースを8回連続実行、全回でsuccesses=1・failures=9を実測。3) src/lib/github-lease.tsを読み、acquireLeaseRefがgit commit-tree（空tree親）+ git push origin <sha>:<ref>（force無し）であり、既存refがあればサーバ側receive-packが非fast-forwardとして拒否する（TOCTOUウィンドウが構造的に存在しない）ことをコードで確認した"
      executor: claude
    evidence:
      - "test/integration/lease-concurrency.test.ts"
      - "src/lib/github-lease.ts（acquireLeaseRef, classifyPushFailure）"
      - "test/unit/github-lease.test.ts（acquireLeaseRef: 既存refがある状態での再acquireはconflictとして拒否される）"
      - "独立実測: /tmp scratchpad配下の独立スクリプト（テストスイート外）で10プロセス×8回=16レース全てsuccesses=1"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（test/integration/lease-concurrency.test.ts のローカルバックエンドテスト）に加え、独立スクリプトでも同様の並行acquireを別途実測した"
      procedure: "1) test/integration/lease-concurrency.test.tsのローカルバックエンドテストを単体実行し13回連続で2/2 pass・0 failを確認。2) /tmp独立スクリプトでbin/agents-md.js lease acquire ISSUE-500 specを10プロセス同時spawnするレースを8回連続実行、全回でsuccesses=1・failures=9を実測。3) src/lib/yaml-io.tsのwriteYamlFileExclusiveがfs.writeFileSyncのflag:'wx'（O_CREAT|O_EXCL|O_WRONLY相当）であり、既存ファイルがあればEEXIST例外を捕捉してfalseを返す設計であることをコードで確認し、read-check-then-writeのTOCTOUウィンドウが排除されていることを確認した"
      executor: claude
    evidence:
      - "test/integration/lease-concurrency.test.ts"
      - "src/lib/yaml-io.ts（writeYamlFileExclusive）"
      - "src/commands/lease.ts（acquireのlocal分岐: 排他生成→競合/stale判定→1回だけ再試行）"
      - "独立実測: /tmp scratchpad配下の独立スクリプトで10プロセス×8回=16レース全てsuccesses=1"

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: "git statusのclean判定・doctorのmain worktree cleanチェックというAC-3が literally 要求する挙動は/tmp隔離環境で実測しpassを確認した。ただし検証観点として指定された`git check-ignore -v .worktrees`コマンド自体は、リポジトリに既存の`.worktrees/.gitignore`（トラック済みプレースホルダ）が存在するためexit 1のままであることも実測した（findings参照。AC-3自体の合否には影響しない）"
      procedure: "/tmp隔離gitリポジトリを、実リポジトリの実際の履歴順序（.worktrees/.gitignoreを先にtracked化→後から.gitignoreへ.worktrees/を追加）で再現。1) worktree0件の状態でgit statusを実行しclean（出力なし）を確認。2) git check-ignore -v .worktreesを実行しexit 1（マッチ無し）を確認——これは.worktrees/.gitignoreがトラック済みファイルであるため、ディレクトリパス自体はcheck-ignoreの対象外になるというgitの挙動による。3) .agent-skill-chain一式・AGENTS.md等を複製したうえでnode bin/agents-md.js doctorを実行し「OK main worktreeのclean状態」を確認（template-syncは本Issueのスコープ外のため別途NGだが無関係）。4) 実際の未追跡worktreeサブディレクトリ（.worktrees/20260101_000000-feature-1-test/README.md）を新規作成し、git check-ignore -v <そのファイルパス>がexit 0（無視される）こと、git statusにも一切表示されないことを確認した——これが実運用でworktreeが作られた際にAC-3が要求する実効果（dirty化しないこと）そのものである"
      executor: claude
    evidence:
      - ".gitignore（.worktrees/追加）"
      - ".worktrees/.gitignore（既存トラック済みプレースホルダ、本Issュー以前からの資産）"
      - "実機確認: /tmp隔離repoでのgit status clean・doctor『OK main worktreeのclean状態』・新規worktreeサブディレクトリのgit status非表示"
      - "findings参照: git check-ignore -v .worktrees 自体はexit 1（ディレクトリ内にトラック済みファイルがあるため）"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: "実装者が追加したe2eテスト（issue start→gate review→承認→ファイル削除の完全フロー）に加え、独立して手組みしたgate-report.yamlに対しverify gate-reportを直接実行し削除検知を確認した"
      procedure: "1) test/integration/verify.test.tsのAC-4テストを単体実行しpassを確認。2) /tmp隔離環境でスキーマに完全準拠したgate-report.yaml（approved_artifacts 1件）を独自に作成し、承認対象ファイルが存在する状態でverify gate-reportを実行しexit 0を確認。3) 当該ファイルを削除した状態で再実行し、exit 1・標準エラーに『approved_artifacts のファイルが削除されています（digest不一致として扱います）: artifact.txt』が出力されることを確認した"
      executor: claude
    evidence:
      - "src/commands/verify.ts（gateReport、if(!fs.existsSync)分岐）"
      - "test/integration/verify.test.ts（ISSUE-176 AC-4テスト）"
      - "独立実測: /tmp隔離環境での手組みgate-report.yamlに対するverify gate-report実行（削除前exit 0→削除後exit 1、削除メッセージ一致）"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "既存のdigest不一致（内容変更）検知テストが引き続きpassすることに加え、独立実行でも同じregressionなしを確認した"
      procedure: "1) test/integration/verify.test.tsの既存digest不一致テスト（内容変更ケース）を実行しpassを確認。2) 独立して作成した同じgate-report.yamlに対し、削除ではなくファイル内容の変更（『modified content』への書き換え）を行いverify gate-reportを実行、exit 1・『approved_artifacts の digest が現在のファイル内容と一致しません: artifact.txt』を確認した（AC-4の削除ケースと同一ファイルに対する2種類の不一致が正しく区別されることも確認）"
      executor: claude
    evidence:
      - "src/commands/verify.ts（gateReport、else if(digestOfFile...)分岐）"
      - "test/integration/verify.test.ts（既存の内容変更ケーステスト）"
      - "独立実測: /tmp隔離環境での内容変更ケース（exit 1、digest不一致メッセージ）"

  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "実装者のregressionテスト（lease-renew.test.ts、AC-6テストケース）に加え、独立スクリプトでローカルバックエンドの期限切れleaseへのrenewが拒否されることを実測した。GitHubバックエンドの期限切れチェックは本Issue以前から存在していたこと（非対称性が本当にローカル側のみだったこと）をgit logで確認した"
      procedure: "1) test/integration/lease-renew.test.tsのAC-6テスト（ローカルバックエンド、期限切れ後renewは拒否される）を実行しpassを確認。2) 独立スクリプトで/tmp隔離環境にてlease acquireでleaseを取得しexpires_atを1時間前へ直接書き換えたうえで、正しいtokenでlease renewを実行、exit 1・『lease は既に期限切れです』・lease.yamlのexpires_atが変化しないことを実測した。3) git log -pでsrc/commands/lease.tsの履歴を確認し、GitHubモード分岐の期限切れチェック（held.lease.writer_lease.expires_at <= now.toISOString()）はcommit c0cfcab（本Issue以前）で既に存在し、ローカル分岐への追加はcommit d4774e9（本Issue）であることを確認、非対称性の解消がローカル側の追加のみで完結していることを確認した"
      executor: claude
    evidence:
      - "src/commands/lease.ts（renew local分岐の期限切れチェック追加、commit d4774e9）"
      - "test/integration/lease-renew.test.ts（ISSUE-176 AC-6テスト）"
      - "独立実測: /tmp隔離環境での期限切れlease renew試行（exit 1、期限切れメッセージ、expires_at不変）"
      - "git log -p src/commands/lease.ts によるGitHubモード側チェックの先行存在確認（commit c0cfcab）"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
      reason: "npm testはリポジトリの自動テストスイート全体を実行するコマンドである"
      procedure: "npm test をこのworktreeで実行し384/384 pass・0 fail・0 skippedを実測した（実装者報告の384件と一致）。npm run typecheckも実行しエラー0件を確認。既存launch_worker/launch_gate_reviewer関連テスト（worker-adapters.test.ts・gate-adapters.test.ts・gate-judgment.test.ts）を含む全テストがfailなしでpassしていることを確認した。加えて、PLAN.md/DESIGN.mdに明記されていなかったsrc/commands/reconcile.ts（旧listLeaseComments/deleteLeaseComment APIの利用箇所）の変更をgit diff --statで発見し、対応するtest/integration/reconcile.test.tsを単体実行して6/6 passであることを確認した"
      executor: claude
    evidence:
      - "commit:7dccad5"
      - "npm test 実行結果: 384/384 pass、0 fail、0 skipped"
      - "npm run typecheck 実行結果: エラー0件"
      - "test/integration/reconcile.test.ts 単体実行結果: 6/6 pass"

regression:
  executed: true
  evidence:
    - "npm test（384/384 pass、0 fail、0 skipped。本VALIDATION作成セッションで実測、実行日時2026-07-20）"
    - "npm run typecheck（エラー0件）"
    - "test/integration/lease-concurrency.test.ts 単体実行を13回連続実施し全回2/2 pass（flakyでないことを確認）"
    - "既存launch_worker/launch_gate_reviewer関連テスト（worker-adapters.test.ts・gate-adapters.test.ts・gate-judgment.test.ts）を含め無破壊を確認"
    - "reconcile.test.ts（PLAN.md非記載の副次的変更箇所）6/6 passを確認"

# --- 独立検証者の所見（findings） ---
# 本セクションはスキーマの additionalProperties: false 制約に抵触するため、
# 正式なYAMLフィールドとしては追加しない。所見はコメントとして本ファイル内に記載し、
# 対応するACのreason/procedureにも要点を転記済みである。
#
# [Low] git check-ignore -v .worktrees はこのリポジトリではexit 1（未マッチ）を返す。
# 原因: .worktrees/.gitignore が本Issue以前から git 追跡済みのプレースホルダファイルであり、
# gitは「トラック済みファイルを含むディレクトリ」自体をcheck-ignoreの対象外として扱う
# （check-ignoreは未追跡パスの判定に使う機構であり、ディレクトリ内に追跡済みファイルが
# 1つでもあると、そのディレクトリパス自体へのcheck-ignore照会はヒットしない、という
# gitの一般的挙動。/tmp隔離環境で同一構成を再現し実測確認した）。
# 実害への影響: 無い。AC-3が実際に要求する効果——(a) worktreeが1つも無い状態でのgit status
# clean、(b) 実際にworktreeサブディレクトリが作られた後もそのサブディレクトリ・配下ファイルが
# 正しく無視されgit statusに出ないこと——はいずれも/tmp隔離環境で実測し正しく機能することを
# 確認した（このリポジトリ内でこのコマンド自体を使う自動チェックも存在しない、grep確認済み）。
# 助言: 将来このリポジトリの.gitignoreを手動デバッグする際、`git check-ignore -v .worktrees`
# （ディレクトリパス自体）で結果を判断しようとすると「効いていない」ように見えて混乱しうる。
# 判断するなら `git status --porcelain` そのもの、または`.worktrees/`配下の具体的なファイル
# パスに対するcheck-ignoreを使うべきである。
#
# [Low] DESIGN.mdの「依存関係」図（§責務・境界 直下）は、github-lease.tsの旧API
# （listLeaseComments/deleteLeaseComment）の消費者としてsegment.tsのみを列挙しており、
# 実際にはsrc/commands/reconcile.tsも同APIの消費者だった。実装フェーズ（commit cc6bd52）で
# reconcile.tsもallLeasesFor/releaseLeaseRefへ正しく置換されており（旧escalation分岐
# 「複数の有効leaseが競合」は、ref-based CASにより構造的に発生し得なくなったための削除で
# 妥当）、test/integration/reconcile.test.tsも6/6 passであるため機能的な欠陥ではない。
# DESIGN.mdの依存関係列挙が実装時に見つかった1箇所の消費者を漏らしていた、という設計ドキュメントの
# 網羅性の軽微なギャップとして記録する。
#
# 総合判定: AC-1〜AC-7すべてpass。上記2件のfindingsはいずれもLow severityであり、
# 実装の是正を要する不具合ではない（1件目はgit挙動の理解に関する注記、2件目は設計文書の
# 記載漏れで実装側は正しく対応済み）。conformance観点（PLAN.mdの全13タスクがコード上に
# 実装されていること）・falsification観点（実プロセス並行実行での二重取得ゼロ・複数回再実行での
# 非flaky性・削除検知の実測・renew非対称性解消の実測）のいずれも独立に実測確認できた。
# ISSUE-176は検証合格とする。
