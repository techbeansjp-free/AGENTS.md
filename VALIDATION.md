# VALIDATION: agent-skill-chain — 完全自走の実効化: ruleset実適用・worker/review adapterのclaude切替実機検証
#
# 目的: Issue #180 の受入条件 AC-1〜AC-10 について、前段（spec/design/implementation 各セグメント
#   および進行役）の報告を鵜呑みにせず、独立検証者が現時点のライブ状態・コード・テストを自ら
#   再実測し、各 AC の pass/fail を確定する。
#
# 対象範囲: (a) ライブ GitHub 保護（main ruleset・統合ブランチ branch protection・使い捨て失敗PRの
#   ブロック実測）、(b) config の adapter 切替、(c) launch_worker 実機完走・human_required 対照確認、
#   (d) 既存テストスイートの回帰。
#
# 前提（成果物の自己完結性の原則に従い本ファイル内に明記する）:
#   - 対象リポジトリは techbeansjp-free/AGENTS.md、統合ブランチ chore/162-agent-skill-chain-bootstrap、
#     本Issueブランチ feature/180-autonomous-execution、Draft PR #181。
#   - 検証対象コミット target_sha は config 切替コミット 8cb0ee4（worker.adapter/review.adapter を
#     human→claude へ変更）。VALIDATION.md 自体のコミットはこの直後に積む。
#   - 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
#     （agent-skill-chain/validation-report/v1）に完全一致する単一YAML文書である。見出し構造
#     ではなく1つのYAMLとして記述する理由は、src/commands/verify.ts の acCoverage() が本ファイル全体を
#     readYamlFile() で単一YAMLとして読み込むため（Markdown見出し・複数フェンス混在はparse失敗を招く）。
#     散文・Given/When/Then相当の所見はコメント（#）および各ACの reason/procedure フィールドで表現する。
#
# 検証方法（独立再実測の実施内容。実装者・進行役の自己申告を再確認した）:
#   - AC-1/AC-2: gh api repos/techbeansjp-free/AGENTS.md/rulesets を自ら実行。main-protection が
#     enforcement:active で存在し、required_status_checks に spec/design/implementation/validation-gate
#     と verify の5コンテキストが含まれることを実測。conditions.ref_name.include が refs/heads/main のみ
#     （正本 main.json 無変更＝採用案(b)整合）であることも確認した。
#   - AC-3: gh api .../branches/chore%2F162-agent-skill-chain-bootstrap/protection を自ら実行。404 でなく
#     protection が返り、5コンテキスト・enforce_admins:false・restrictions:null であることを実測。
#     併せて main の既存 classic 保護（contexts:["self-enforce"]）が温存されていることも確認した。
#   - AC-4: gh pr view 182 を自ら実行。state:CLOSED、mergeStateStatus:BLOCKED、verify Check Run が
#     FAILURE であることを実測。使い捨てブランチ chore/asc-block-probe-20260721_063757 が
#     git ls-remote --heads origin 上に存在しない（リモート実削除済み）ことも実測した（finding-2）。
#   - AC-5: .agent-skill-chain/config/agent-skill-chain.yaml を自ら読み、worker.adapter:claude・
#     review.adapter:claude を確認。git show 8cb0ee4 で当該2行のみの変更であることも確認した。
#   - AC-6/AC-7/AC-8: launch_worker の実機完走そのものは前段が使い捨て環境を破棄済みで再実行不能。
#     代わりに .agent-skill-chain/adapters/claude.sh を自ら読み、報告された根本原因（既定 WORKER_CMD の
#     --permission-mode acceptEdits）がコード上も実在することを確認した（下記 finding-1）。
#   - AC-9: npm test をフル再実行し worker-adapters.test.ts を含む既存フェイルセーフ系テストが全pass
#     することを実測。認証欠如注入の live 対照（env -u）は前段報告に依拠する（再実行不能）。
#   - AC-10: このworktreeで npm run build（exit 0）・npm test（394/394 pass, 0 fail, 0 skipped）を
#     自ら実行し実測した。
#
# 前段報告との突合結果: 独立に再確認した AC-1〜AC-5・AC-9・AC-10 は前段報告と食い違いなし。
#   AC-6/AC-8 の未達成も、コードおよびユーザー決定事項と整合しており齟齬なし。
#   唯一の差分は finding-2（使い捨てブランチの stale なリモート追跡refが本worktree側に残存していた点。
#   リモート実体は削除済みで、検証中に git remote prune で追跡refも解消した。実害なし）。
#
# ---- findings（AC個別判定に加えて記録する検証者所見） ----
#
# finding-1（AC-6/AC-8、根本原因のコード整合確認。ユーザー決定により別Issueへ先送り）:
#   .agent-skill-chain/adapters/claude.sh の launch_worker は、WORKER_CMD 未指定時の既定起動系を
#   「claude -p --output-format text --permission-mode acceptEdits」と定めている。acceptEdits は
#   ファイル編集ツールを自動承認するが、git push 等のBash/ネットワーク操作は非対話ヘッドレスでは
#   自動承認しない。このため spec worker は SPEC.md 作成・commit までは無介在で進むが git push で
#   承認待ちとなり、launch_worker のフェイルセーフ（report_status blocked / human_escalation_requested、
#   非0非3 return）へ倒れる——という前段報告の根本原因が、コード上（既定 worker_cmd の定義、および
#   認証・起動・完了確認の各フェイルセーフ経路）と整合することを確認した。コード内コメントも当該フラグを
#   「実機検証のうえ確定するスコープ外事項」と明記しており、恒久確定が未了である旨が設計意図として
#   残されている。よって AC-6（実機完走）および AC-8（正常経路で human_required 不発火）は、認証あり・
#   CLI利用可という条件下でも権限モード不足により達成できていない。ユーザーは本 finding の恒久修正
#   （権限モードの適正化）を Issue #180 の対象外とし別Issueへ先送りすることを決定済みであり、独立検証者は
#   これを未解決事項として記録するにとどめる（下記「未解決事項」参照）。
#
# finding-2（AC-4、後始末の軽微な取りこぼし。検証中に是正済み・実害なし）:
#   使い捨てブランチ chore/asc-block-probe-20260721_063757 は git ls-remote --heads origin 上に存在せず
#   リモート実体は削除済みである一方、本worktree（共有ref store）側に stale なリモート追跡ref
#   （remotes/origin/chore/asc-block-probe-20260721_063757）が残っていた。git remote prune origin で
#   [pruned] を実測し解消した。リモートの実ブランチは残っておらず main・統合ブランチへの混入も無いため
#   AC-4 の pass 判定には影響しない（追跡refの stale は表示上の残渣であり保護・マージには無関係）。
#
# finding-3（全体所見、完了を偽装しないための総括）:
#   本 Issue の本来の成功基準は「(a) ライブ GitHub でゲートを機械強制、(b) 自走アダプタを本物の claude CLI
#   で1セグメント以上人間介在なく完走、(c) その正常経路で human_required が誤発火しない、をいずれも実機で
#   実測」の3点である。このうち (a) は AC-1〜AC-4 として完全達成（ライブ ruleset・統合ブランチ保護・
#   使い捨て失敗PRのBLOCKED実測）。(b)(c) は AC-6/AC-8 として未達成——認証やCLI利用可否ではなく、既定
#   権限モード（acceptEdits）が git push を自動承認しないことに起因する。したがって Issue #180 は
#   「ライブ機械強制の実効化」は達成したが「自走アダプタの本物CLIでの完走実証」は未達成であり、
#   本 Issue 単独では完全自走の end-to-end 実証には至っていない。この未達成部分の恒久修正は
#   ユーザー決定により別Issueへ切り出す。
#
# ---- 未解決事項 ----
#   U1（別Issueへ切り出し・ユーザー決定済み）: 既定 WORKER_CMD の権限モード不足の恒久修正。
#     launch_worker が既定で用いる claude CLI 起動フラグ（--permission-mode acceptEdits）は git push 等の
#     Bash/ネットワーク操作を非対話ヘッドレスで自動承認しないため、正常経路（認証あり・CLI利用可）でも
#     1セグメントを人間介在なく完走できない。この修正（適切な権限モード確定・非対話での git push 承認方式の
#     設計）は SPEC.md スコープ外（『claude CLI の恒久起動フラグの確定』）と整合し、ユーザー決定により
#     Issue #180 の対象外・別Issueへ先送りとする。本切り出しにより AC-6/AC-7/AC-8 の再検証も別Issueで行う。
#
# ---- 関連ADR ----
#   docs/adr/ 配下には ADR-0001（docs/system-spec 構築、proposed）・ADR-0002（GitHub lease git-ref CAS、
#   accepted）が存在するが、いずれも本 Issue #180 の判断（ライブ provisioning・adapter 切替・実機検証）と
#   直接の関係は無い。DESIGN.md も本 Issue の中核判断（統合ブランチは採用案(b)の branch protection）が
#   正本アセットを変えない一過性・命令的操作であり durable な architecture 決定に当たらないとして新規 ADR を
#   作成しないと明記しており、独立検証者もこれが妥当（related_adrs: []）と確認した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-180
target_sha: 8cb0ee480c515da1a36977e048560f7d7d7c0f69

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: manual
      result: pass
      reason: "ライブ ruleset の適用結果は GitHub API での一回性の実機確認であり自動化に馴染まない。前段報告に依拠せず独立に照会した"
      procedure: "gh api repos/techbeansjp-free/AGENTS.md/rulesets を自ら実行し、返却が [] でなく ruleset main-protection（id=19276510）が enforcement:active・target:branch で存在することを実測した。conditions.ref_name.include が refs/heads/main のみ（正本 main.json 無変更＝採用案(b)と整合）であることも確認した"
      executor: claude
    evidence:
      - "実機確認: gh api .../rulesets → {name:main-protection, id:19276510, enforcement:active, target:branch}"
      - "実機確認: 当該ruleset conditions.ref_name.include = [refs/heads/main]（正本main.json無変更）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "適用済みライブ ruleset の required_status_checks 内容照合は GitHub API での実機確認であり自動化に馴染まない"
      procedure: "gh api repos/techbeansjp-free/AGENTS.md/rulesets/19276510 の rules[] から type==required_status_checks を抽出し、agent-skill-chain/spec-gate・design-gate・implementation-gate・validation-gate・verify の5コンテキストがすべて required として含まれることを実測した"
      executor: claude
    evidence:
      - "実機確認: ruleset 19276510 の required_status_checks = [spec-gate, design-gate, implementation-gate, validation-gate, verify]（5件すべて）"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "main と統合ブランチ双方のライブ保護状態の実機確認であり自動化に馴染まない。統合ブランチ側の 404 解消を自ら再照会した"
      procedure: "1) gh api .../branches/chore%2F162-agent-skill-chain-bootstrap/protection を実行し、404 でなく protection が返り required_status_checks.contexts に5コンテキスト、enforce_admins:false、restrictions:null であることを実測（SPEC 観測の 404 が解消済み）。2) gh api .../branches/main/protection で main の既存 classic 保護（contexts:[self-enforce]）が温存され、AC-1/AC-2 の ruleset（5コンテキスト）と論理和で厳格側に機能することを確認。双方のブランチで required check 未達PRがマージ不可になる状態であることを確認した"
      executor: claude
    evidence:
      - "実機確認: 統合ブランチ protection = {contexts:[spec-gate,design-gate,implementation-gate,validation-gate,verify], enforce_admins:false, restrictions:null}（404解消）"
      - "実機確認: main は ruleset(5件, active) + 既存classic protection(contexts:[self-enforce]) の論理和"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "ライブPRを作成しマージ可否を実測する一回性手順。使い捨てPR #182 の現状態を自ら再照会して確認した"
      procedure: "gh pr view 182 --json state,mergeStateStatus,mergeable,statusCheckRollup を自ら実行し、verify Check Run が FAILURE の状態で mergeStateStatus:BLOCKED（保護によりマージブロック）であることを実測した。mergeable は MERGEABLE（差分自体は競合なし）だが mergeStateStatus:BLOCKED であり、required check 未達が実際にマージをブロックしている。PR は state:CLOSED（マージせず後始末済み）。使い捨てブランチ chore/asc-block-probe-20260721_063757 が git ls-remote --heads origin 上に存在しない（リモート実削除済み）ことも実測した（finding-2: stale なローカル追跡refは git remote prune で是正済み）"
      executor: claude
    evidence:
      - "実機確認: gh pr view 182 → state:CLOSED, mergeStateStatus:BLOCKED, mergeable:MERGEABLE, verify=FAILURE"
      - "実機確認: git ls-remote --heads origin にprobeブランチ無し（リモート実削除済み、main/統合ブランチへ未混入）"
      - "finding-2: stale なリモート追跡refが本worktreeに残存していたが git remote prune origin で解消（実害なし、AC判定に影響せず）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
      reason: "設定ファイルの値検査。前段報告に依拠せず現在値を自ら読み、変更commitの差分粒度も確認した"
      procedure: ".agent-skill-chain/config/agent-skill-chain.yaml を自ら読み、worker.adapter:claude・review.adapter:claude であることを確認した。git show --stat 8cb0ee4 で当該config 1ファイル・2行のみの変更（2 insertions, 2 deletions）であることを確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/config/agent-skill-chain.yaml（worker.adapter:claude, review.adapter:claude）"
      - "実機確認: git show --stat 8cb0ee4 → agent-skill-chain.yaml のみ 2 insertions(+) 2 deletions(-)"

  - ac_id: AC-6
    verification:
      mode: manual
      result: fail
      reason: "本物の claude CLI（headless・認証あり・CLI利用可）で launch_worker を1セグメント人間介在なく完走させる実機検証を前段が複数回試みたが達成できなかった。根本原因は認証やCLI利用可否ではなく、既定 WORKER_CMD の --permission-mode acceptEdits が git push 等のBash/ネットワーク操作を非対話ヘッドレスで自動承認しないこと（finding-1でコード整合を独立確認）。spec worker は SPEC.md 作成・commit までは無介在で進むが git push で承認待ちとなりフェイルセーフ（human_required）へ倒れた。ユーザー決定により恒久修正は本Issue対象外・別Issueへ先送り。実測事実として result:fail を維持する"
      procedure: "launch_worker 実機起動そのものは前段が使い捨て環境を破棄済みで再実行不能。独立検証として .agent-skill-chain/adapters/claude.sh を自ら読み、WORKER_CMD 未指定時の既定起動系が『claude -p --output-format text --permission-mode acceptEdits』であること、および認証未設定・起動失敗・timeout・完了偽装（report status/target_sha 突合）の各フェイルセーフ経路が report_status blocked（human_escalation_requested扱い）＋lease解放＋非0非3 return で実装されていることを確認した。前段が報告した『acceptEdits はファイル編集は自動承認するが git push は自動承認しない』という挙動がコードの設計意図（当該フラグを実機検証で確定するスコープ外事項とするコメント）と整合することを確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/adapters/claude.sh（launch_worker: 既定 worker_cmd=claude -p --output-format text --permission-mode acceptEdits、認証/起動/完了確認の各フェイルセーフ）"
      - "前段実装エージェント報告: spec worker が SPEC.md 作成・commit まで完走後 git push で承認待ち→human_required フェイルセーフ（終了コード2, human_escalation_requested:true）"
      - "finding-1参照: 根本原因（権限モード不足）のコード整合を独立確認。ユーザー決定により恒久修正は別Issueへ先送り（未解決事項U1）"

  - ac_id: AC-7
    verification:
      mode: manual
      result: fail
      reason: "AC-7 は『人間介在なしに1セグメントが正常完了したことを示す実行ログ・report-status 記録』の証跡を求めるが、AC-6 が未達成のため『完走の証跡』そのものが存在しない。存在する証跡は正常完走ではなくフェイルセーフ（blocked）到達の記録であり、AC-7 が要求する『正常完了の証跡』には当たらない。AC-6 に従属して result:fail"
      procedure: "AC-6 の判定に従属。前段が採取したログは git push 承認待ち→blocked 到達（human_escalation_requested）の記録であり、report_status completed（target_sha=push済みHEAD一致）の正常完走記録は存在しないことを確認した"
      executor: claude
    evidence:
      - "AC-6 参照: 正常完走（report_status completed・target_sha一致）の証跡は不存在。存在するのは blocked 到達の記録のみ"
      - "finding-1/finding-3参照: 権限モード不足により正常経路が完走に至らず、完走証跡が採取できない"

  - ac_id: AC-8
    verification:
      mode: manual
      result: fail
      reason: "AC-6 の正常経路（認証あり・CLI利用可）の実行中に、実際には launch_worker のフェイルセーフ（report_status blocked / human_escalation_requested）が発火した。発火原因は真の異常（認証欠如・CLI不在等）ではなく既定権限モード acceptEdits が git push を自動承認しなかったことである（finding-1）。字義通り『正常経路で human_required が発火しない』ことは実証できておらず result:fail。ただし発火はフェイルセーフ設計が git push 続行不能という実ブロッカーに対して正しく安全側へ倒れた結果であり、フェイルセーフ機構自体の欠陥ではない点を付記する。ユーザー決定により恒久修正は別Issueへ先送り"
      procedure: "AC-6 と同一の実機起動に依拠（再実行不能）。前段報告の『認証あり・CLI利用可という条件下で blocked が発火した（原因は認証ではなく権限モード）』を、finding-1 のコード整合確認（既定 acceptEdits）と突合し、正常経路での human_required 不発火が実証できていないことを確認した"
      executor: claude
    evidence:
      - "前段報告: 正常経路（認証あり・CLI利用可）で report_status blocked が発火（human_escalation_requested、終了コード2）。原因は権限モード acceptEdits の git push 非自動承認"
      - "finding-1参照: フェイルセーフ機構自体は健全（git push 続行不能に対し安全側へ倒れた）。誤発火ではなく権限モード不足に起因する発火"

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: "認証欠如注入（真の異常）に対し human_required が正しく発火することを確認する。異常注入の自動テストは既存 worker-adapters.test.ts が網羅しており、これを含む npm test 全394件が pass することを独立に再実測した。認証欠如の live 対照（env -u）は前段報告に依拠する（再実行不能）。AC-9 自身のシナリオ（認証欠如→blocked発火・非0非3）は成立するため pass とする。ただし SPEC が求める『AC-8（正常経路で不発火）との対比による裏付け』は、AC-8 が未達成のため完全には確立していない旨を付記する"
      procedure: "1) npm test をこのworktreeでフル実行し、test/integration/worker-adapters.test.ts の認証欠如・起動失敗・完了偽装・target_sha不一致の各フェイルセーフテストを含む 394件全passを実測（AC-9 の automated 部分）。2) 前段報告の live 対照（env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN で launch_worker 起動→3秒で blocked_reason に認証未設定・human_escalation_requested:true・終了コード2＝非0非3）を、.agent-skill-chain/adapters/claude.sh の認証欠如フェイルセーフ経路のコードと突合し整合を確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts（認証欠如・起動失敗・完了偽装・target_sha不一致の各フェイルセーフ）"
      - "実機確認: npm test 394/394 pass（フェイルセーフ系テスト全pass）"
      - "前段報告: env -u での認証欠如注入→blocked発火（human_escalation_requested:true, 終了コード2, blocked_reason:認証情報未設定）"
      - "付記: AC-8 未達成のため『正常経路で不発火・異常時のみ発火』の完全な対比は未確立（finding-3）。AC-9 単独シナリオ（異常時発火）は成立"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
      reason: "既存テストスイート全passを前段報告に依拠せず自ら再実行して実測した"
      procedure: "このworktree（feature/180-autonomous-execution, HEAD=8cb0ee4）で npm run build（tsc）を実行し終了コード0を実測。続いて npm test をフル実行し、tests 394 / pass 394 / fail 0 / cancelled 0 / skipped 0 / todo 0 を実測した（config の adapter 切替後も回帰なし）"
      executor: claude
    evidence:
      - "実機確認: npm run build（tsc）終了コード0"
      - "実機確認: npm test → 1..394, tests 394, pass 394, fail 0, cancelled 0, skipped 0"

regression:
  executed: true
  evidence:
    - "実機確認: npm run build（tsc）終了コード0"
    - "実機確認: npm test 394/394 pass, 0 fail, 0 skipped（worker-adapters.test.ts のフェイルセーフ系含む）"
