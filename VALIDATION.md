# VALIDATION: agent-skill-chain — launch_worker の権限モード不足解消・ローカルバックエンド issue 本文スキーマ拡張
#
# 目的: Issue #183 の受入条件 AC-1〜AC-10 について、前段（実装エージェントおよび進行役の
#   ライブ実機検証）の報告を鵜呑みにせず、独立検証者が現時点のコード・テスト・ライブ報告の
#   論理整合を自ら再確認し、各 AC の pass/fail を確定する。
#
# 対象範囲: (a) 既定 WORKER_CMD の責務スコープ allowlist 化（要件1・AC-1/AC-2）、
#   (b) state.schema.yaml への title/request 追加（要件3・AC-3）、
#   (c) issue start のフィールド受理・永続化（要件4・AC-4）、
#   (d) segment start のワーカーへの issue 本文供給（要件5・AC-5）、
#   (e) launch_worker の本物 claude CLI での実機完走・human_required 対照（要件6/7・AC-6〜AC-9）、
#   (f) 既存テストスイートの回帰（要件8・AC-10）。
#
# 前提（成果物の自己完結性の原則に従い本ファイル内に明記する）:
#   - 対象リポジトリは techbeansjp-free/AGENTS.md、統合ブランチ chore/162-agent-skill-chain-bootstrap、
#     本Issueブランチ feature/183-worker-permission-mode、Draft PR #184。
#   - 検証対象コミット target_sha は実装 HEAD 7bad757（issue/segment の本文供給まで反映済み。
#     直前に 0e4f591=state schema拡張・4c5ea2e=claude.sh allowlist化）。VALIDATION.md 自体の
#     コミットはこの直後に積む。
#   - 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
#     （agent-skill-chain/validation-report/v1）に完全一致する単一YAML文書である。見出し構造では
#     なく1つのYAMLとして記述する理由は、src/commands/verify.ts の acCoverage() が本ファイル全体を
#     readYamlFile() で単一YAMLとして読み込むため（Markdown見出し・複数フェンス混在はparse失敗を招く）。
#     散文・Given/When/Then相当の所見はコメント（#）および各ACの reason/procedure フィールドで表現する。
#   - ライブの claude CLI 起動（AC-1/AC-5/AC-6〜AC-8 の live 部分）は進行役が /tmp 配下の使い捨て
#     fixture リポジトリ（coordination.backend:local・独立 bare remote）で実施済みで、fixture は後始末
#     済み（再実行不能）。独立検証者はその報告の妥当性を、コードを実際に読み論理整合を確認する形で裏付ける。
#
# 検証方法（独立再実測の実施内容。実装者・進行役の自己申告を再確認した）:
#   - ビルド/テスト: このworktree（HEAD=7bad757）で npm run build（tsc、exit 0）・npm test を自ら
#     フル再実行し tests 401 / pass 401 / fail 0 / skipped 0 を実測（前段報告の 401/401 と一致）。
#   - AC-1/AC-2: .agent-skill-chain/adapters/claude.sh を自ら読み、WORKER_CMD 未指定時の既定起動系が
#     『claude -p --output-format text --allowed-tools "$worker_allowed_tools"』であり、
#     WORKER_ALLOWED_TOOLS_DEFAULT が責務範囲（Edit/Write/MultiEdit・Bash(git commit/push:*)・
#     Bash(gh pr create:*)・Bash(.agent-skill-chain/scripts/*)・npm run/test 等）に限定した allowlist で
#     あること、bypassPermissions/acceptEdits を既定に含まないこと、WORKER_ALLOWED_TOOLS env で上書き可
#     であることを確認。test/integration/worker-adapters.test.ts の追加テストが claude stub 経由で
#     --allowed-tools 付与・bypassPermissions 不在・env 上書きを assert し pass することも確認した。
#   - AC-3: .agent-skill-chain/schemas/state.schema.yaml を自ら読み、properties に title/request（共に
#     type:string・required 非追加＝任意）が追加され、schema_version が v1 据え置き、examples に本文入り
#     例が1件追記されたことを確認。test/unit/schema.test.ts の追加テストの pass も確認した。
#   - AC-4: src/commands/issue.ts の start を自ら読み、--title/--request/--request-file を解析し（4
#     positional 引数は不変）、local backend 分岐で title/resolvedRequest を state へ条件付き同梱し
#     validateAgainstSchema('state') 後に writeYamlFileAtomic すること、--request と --request-file の
#     同時指定を拒否することを確認。test/integration/issue-lifecycle.test.ts の追加テストの pass も確認した。
#   - AC-5: src/commands/segment.ts の start を自ら読み、local backend で state.yaml の title/request が
#     あれば buildIssueBlock で `issue:`（id/title/request）ブロックを contract 出力へ同梱し、本文なし
#     state・GitHub モードでは同梱しないこと（後方互換）を確認。加えて進行役ライブ報告（使い捨て issue へ
#     issue start で本文を渡し、ワーカーが SPEC.md を人間の本文作り込みなしに生成した）が本供給経路と整合
#     することを確認した。
#   - AC-6/AC-7/AC-8: 進行役ライブ報告（allowlist 起動で本物 claude CLI が SPEC.md 作成・git commit・
#     git push まで人間介在なく完走＝Issue #180 の git push の壁が解消）を確認。ただし launch_worker 自身
#     は完走を正しく検知できず blocked へフェイルセーフした。その2つの新規根本原因が実際にコード上も実在
#     することを独立確認した（下記 finding-1）: (1) src/lib/paths.ts の repoRoot() が worktree の .git
#     ファイルにも fs.existsSync でマッチし worktree ローカルへ状態を分裂させる、(2) claude.sh の認証
#     チェックが ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN の env 非空のみで判定しキーチェーン認証環境を
#     誤って認証欠如と判定する。これらは Issue #185 として切り出し済み（gh issue view 185 で OPEN 実在確認）。
#   - AC-9: npm test をフル再実行し worker-adapters.test.ts の認証欠如・起動失敗・完了偽装・target_sha
#     不一致の各フェイルセーフ系テストが全 pass することを実測。認証欠如注入の live 対照は前段報告に依拠。
#   - AC-10: このworktreeで npm run build（exit 0）・npm test（401/401 pass, 0 fail, 0 skipped）を自ら実測。
#
# 前段報告との突合結果: 独立に再確認した AC-1〜AC-5・AC-9・AC-10 は前段報告と食い違いなし。実装3コミット
#   （4c5ea2e/0e4f591/7bad757）の内容は報告どおりで、追加テストも報告どおり存在し pass する。AC-6/AC-7/AC-8
#   の未達成も、報告された Issue #185 の2バグがコード上実在すること・#185 が実際に OPEN で起票済みである
#   ことと整合し齟齬なし。前段の中核主張「allowlist 方式は実機で有効（git push 完走）だが launch_worker の
#   完走検知は #185 の2バグで未達」を独立に裏付けた。
#
# ---- findings（AC個別判定に加えて記録する検証者所見） ----
#
# finding-1（AC-6/AC-7/AC-8、launch_worker 完走検知を阻む2つの新規根本原因のコード整合確認）:
#   (1) repoRoot() の worktree 分裂: src/lib/paths.ts の repoRoot() は
#       `fs.existsSync(path.join(dir, '.git'))` で最初に .git を持つ祖先を返すが、git worktree の
#       ルートは .git を「ファイル」（gitdir ポインタ）として持つため、fs.existsSync はディレクトリと
#       同様に true を返す。よってワーカーが worktree 内から report status 等を実行すると、その状態ファイル
#       （issues/<n>/.agent-skill-chain/reports/<segment>.yaml 等）は worktree ローカルへ分裂して書かれ、
#       メイン作業ツリー側で走る launch_worker からは見えない。launch_worker はワーカーが実際に完走・push・
#       report status completed まで済ませたにもかかわらず「worker report がありません／完了確認できません」
#       と誤検知し blocked へ倒れた。これは安全機構の正常動作ではなくパス解決の実装バグによる誤検知である。
#   (2) 認証チェックの誤検知: claude.sh の launch_worker（および launch_gate_reviewer）の認証チェックは
#       ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN の env 非空チェックのみで、キーチェーン等のセッション認証
#       で動く環境（本検証環境がまさに該当。claude -p "1+1" が env 無しで正常応答することを進行役が実機確認）を
#       誤って認証欠如と判定する。検証時はダミー値でこのチェックを迂回する必要があった。
#   本 finding の恒久解消（両バグの修正）は Issue #185 として切り出し済み。本 Issue #183 の allowlist 方式
#   自体（要件1・AC-1/AC-2）は実機で有効性が確認できており、#185 とは独立の別バグである。
#
# finding-2（全体所見、完了を偽装しないための総括）:
#   Issue #183 の成功基準は「(要件1) ワーカー責務に限定した権限設計で git push を非対話完走可能にする、
#   (要件3〜5) local backend の state に issue 本文を持たせワーカーへ供給する、(要件6/7) 本物 claude CLI で
#   launch_worker が1セグメント人間介在なく完走し正常経路で human_required が誤発火しない」である。
#   達成: 要件1（allowlist 方式・AC-1/AC-2）は実機で git push 完走を確認し達成——Issue #180 で確定していた
#   「git push の壁」が解消された。要件3〜5（AC-3/AC-4/AC-5）はコード・自動テスト・ライブ着手で達成。
#   要件8（AC-10）も 401/401 pass で達成。
#   未達成: 要件6/7（AC-6/AC-7/AC-8＝launch_worker 自身の完走検知）は、権限モードではなく Issue #185 の
#   2つの新規バグ（repoRoot 分裂・認証チェック誤検知）により launch_worker が完走を検知できず blocked へ
#   誤フェイルセーフしたため未達成。ワーカーの実質作業（SPEC.md 作成・commit・push・report completed）自体は
#   完走しており、未達なのは launch_worker のオーケストレーション層の検知である。したがって本 Issue の中核
#   （権限モード不足の解消）は達成したが、end-to-end の完全自走実証（AC-6〜AC-8）は #185 解消まで持ち越す。
#
# ---- 未解決事項 ----
#   U1（別Issue #185 へ切り出し済み・OPEN）: launch_worker 完走検知を阻む2バグの恒久解消。
#     (a) repoRoot() が git worktree の .git ファイルにマッチし状態を worktree ローカルへ分裂させる
#         （fs.existsSync がファイル/ディレクトリを区別しないことに起因）。
#     (b) 認証チェックが env 変数の非空のみでキーチェーン認証環境を認証欠如と誤判定する。
#     これらは Issue #183 の権限モード修正とは独立の別根本原因であり、恒久解消により AC-6/AC-7/AC-8 の
#     再検証を Issue #185 側で行う。gh api repos/techbeansjp-free/AGENTS.md/issues/185 で内容確認可。
#
# ---- 関連ADR ----
#   本 Issue は docs/adr/ADR-0003-worker-permission-model.md（ワーカーへのツール権限付与を無制限
#   bypassPermissions ではなく責務スコープ allowlist（--allowed-tools）を既定とする、status:proposed）を
#   新設した。DESIGN.md の related_adrs（ADR-0003, relation:adopts）と整合することを確認した。ADR-0003 は
#   設計ゲート承認時に accepted へ遷移する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-183
target_sha: 7bad75727538018567b13dd1a3ac1e53885d0764

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "既定起動フラグ・allowlist の存在はコード/テストで自動確認できるが、非対話 git push の実挙動は本物 claude CLI 実行を要する。前段報告に依拠せず、コード整合とライブ報告の両面を独立に再確認した"
      procedure: "1) .agent-skill-chain/adapters/claude.sh を自ら読み、WORKER_CMD 未指定時の既定起動が --allowed-tools（WORKER_ALLOWED_TOOLS_DEFAULT）を用い、当該 allowlist が Bash(git push:*) を含むこと、bypassPermissions/acceptEdits を含まないことを確認。2) test/integration/worker-adapters.test.ts の追加テストが claude stub 経由で --allowed-tools 付与を assert し pass することを npm test で実測。3) 進行役ライブ報告（使い捨て issue に対し本物 claude CLI を新 allowlist で起動→SPEC.md 作成・git commit・git push まで人間介在なく完走。Issue #180 で承認待ち停止していた git push の壁が解消）を確認。fail-safe が発火したのは git push 承認待ちではなく Issue #185 の検知バグに起因するものであり、AC-1 が問う『git push 承認待ちに起因するフェイルセーフ不発火』は成立している"
      executor: claude
    evidence:
      - ".agent-skill-chain/adapters/claude.sh（既定 worker_cmd=claude -p --output-format text --allowed-tools \"$worker_allowed_tools\"、WORKER_ALLOWED_TOOLS_DEFAULT に Bash(git push:*) 含む）"
      - "test/integration/worker-adapters.test.ts（既定起動が --allowed-tools を用い bypassPermissions を含まないことを assert、pass）"
      - "進行役ライブ報告: allowlist 起動で SPEC.md 作成・git commit・git push を人間介在なく完走（#180 の git push の壁が解消）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "実現方式の限定性は設計判断とコードの照合による確認であり、DESIGN.md 確定内容（候補A採用・候補B/C却下）と実装の整合を独立に検証した"
      procedure: ".agent-skill-chain/adapters/claude.sh の WORKER_ALLOWED_TOOLS_DEFAULT を自ら読み、Read/Grep/Glob/Edit/Write/MultiEdit と Bash(git add/commit/push/status/diff/rev-parse/log/show/fetch/restore:*)・Bash(gh pr create/view/edit/comment:*)・Bash(.agent-skill-chain/scripts/*)・Bash(npm run/test/ci:*) 等、ワーカーの正規責務範囲（自 branch commit/push・Draft PR 作成・テスト実行・report/lease/checkpoint スクリプト・自 worktree 編集）に限定され、それ以外は列挙外＝ヘッドレスで拒否（安全側 fail）であること、既定に --permission-mode bypassPermissions/acceptEdits を用いないことを確認。DESIGN.md『権限付与方式の設計判断』の候補A採用・候補B/C却下、および ADR-0003 と整合することを確認した。自 branch 以外への書込み禁止（I5）は worktree 隔離＋credential 分離の一次防御で担保され allowlist は責務外の自動承認を与えない層として機能する"
      executor: claude
    evidence:
      - ".agent-skill-chain/adapters/claude.sh（WORKER_ALLOWED_TOOLS_DEFAULT: 責務スコープ allowlist、bypassPermissions/acceptEdits を既定に不使用、WORKER_ALLOWED_TOOLS で上書き可）"
      - "docs/adr/ADR-0003-worker-permission-model.md（責務スコープ allowlist を既定とする決定、status:proposed）"
      - "test/integration/worker-adapters.test.ts（bypassPermissions 不在・WORKER_ALLOWED_TOOLS env 上書きを assert、pass）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
      reason: "スキーマ定義とバリデーションの検査であり自動化に適する。前段報告に依拠せずスキーマと追加テストを自ら確認した"
      procedure: ".agent-skill-chain/schemas/state.schema.yaml を自ら読み、properties に title/request（共に type:string、required 非追加＝任意）が追加され、schema_version が agent-skill-chain/state/v1 据え置き（破壊的変更なし）、additionalProperties:false 維持、examples に本文（title/request）入り例が1件追記されたことを確認。test/unit/schema.test.ts の追加テスト（title/request を含む state が検証通過し、含まない既存 state も通過する後方互換）が npm test で pass することを実測した"
      executor: claude
    evidence:
      - ".agent-skill-chain/schemas/state.schema.yaml（title/request を任意 properties として追加、schema_version v1 据え置き）"
      - "test/unit/schema.test.ts（title/request 入り state 通過・非含有 state も通過、pass）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
      reason: "CLI 実行結果と生成ファイルの検査であり自動化に適する。前段報告に依拠せず実装と追加テストを自ら確認した"
      procedure: "src/commands/issue.ts の start を自ら読み、parseStartArgs が --title/--request/--request-file を分離し（4 positional 引数 issue_id/type/slug/issue_created_at は不変＝後方互換）、--request と --request-file の同時指定を拒否し、--request-file は存在確認後に readFileSync すること、local backend 分岐で title/resolvedRequest を条件付き（undefined なら非同梱）で state へ含め validateAgainstSchema('state') 後に writeYamlFileAtomic することを確認。test/integration/issue-lifecycle.test.ts の追加テスト（--title/--request-file 付与で state.yaml へ永続化、フラグ無し従来起票は本フィールド非保持で成功）が npm test で pass することを実測した"
      executor: claude
    evidence:
      - "src/commands/issue.ts（parseStartArgs で --title/--request/--request-file 受理、4 positional 不変、local backend で state へ永続化）"
      - "test/integration/issue-lifecycle.test.ts（title/request 永続化・後方互換の追加テスト、pass）"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "供給経路の存在は自動テスト化できるが、本物のワーカーが内容を受け取り着手できることは実機実行を要する。両面を独立に確認した"
      procedure: "1) src/commands/segment.ts の start を自ら読み、local backend のとき state.yaml の title/request があれば buildIssueBlock が `issue:`（id/title/request）ブロックを role_contract 出力へ同梱し、本文なし state・GitHub モードでは同梱しない（後方互換）ことを確認。launch_worker は segment start 出力全文を stdin プロンプトへ渡すため本同梱でワーカーへ本文が供給される。2) test/integration/segment 系（本文入り state で同梱・本文なしで従来出力）の追加テスト pass を実測。3) 進行役ライブ報告（使い捨て issue へ issue start で title/request を渡すだけで、ワーカーが Issue 本文の人間作り込みなしに SPEC.md を生成）が本供給経路と整合することを確認した"
      executor: claude
    evidence:
      - "src/commands/segment.ts（buildIssueBlock: state.yaml の title/request を issue: ブロックとして contract 出力へ同梱、本文なし・GitHub モードでは非同梱）"
      - "test/integration（segment start が本文入り state から issue 本文を同梱する追加テスト、pass）"
      - "進行役ライブ報告: 使い捨て issue が本文の人間作り込みなしにワーカーへ供給され SPEC.md 生成に着手"

  - ac_id: AC-6
    verification:
      mode: manual
      result: fail
      reason: "本物 claude CLI（headless・認証あり・CLI利用可）で launch_worker が1セグメントを人間介在なく完走し終了コード0・report completed・target_sha一致・lease解放に至ることを求めるが、ワーカーの実質作業（SPEC.md 作成・commit・push・report status completed）は完走した一方、launch_worker 自身が Issue #185 の2バグ（repoRoot の worktree 分裂で worker report が見えない／認証チェックの env 非空のみ判定でキーチェーン認証を誤って欠如判定）により完走を検知できず blocked へ誤フェイルセーフした。終了コード0・完走検知は成立せず result:fail。ただし失敗原因は本 Issue の権限モード（allowlist は git push 完走に成功）ではなく #185 の別バグである"
      procedure: "launch_worker 実機起動そのものは進行役が使い捨て fixture を破棄済みで再実行不能。独立検証として src/lib/paths.ts の repoRoot() が `fs.existsSync(path.join(dir,'.git'))` で worktree の .git ファイルにもマッチし状態を worktree ローカルへ分裂させること、.agent-skill-chain/adapters/claude.sh の launch_worker が完了確認（report latest の status/target_sha を push済みHEADと突合）で不一致時に _fail_blocked（report_status blocked/human_escalation_requested・lease解放・非0非3 return）へ倒れること、認証チェックが env 変数の非空のみで判定することを自ら読み、進行役が報告した2根本原因がコード上も実在することを確認した（finding-1）。#185 が gh issue view 185 で OPEN 実在することも確認した"
      executor: claude
    evidence:
      - "src/lib/paths.ts（repoRoot: fs.existsSync で .git ファイルにもマッチ＝worktree 分裂バグ、Issue #185）"
      - ".agent-skill-chain/adapters/claude.sh（launch_worker 完了確認: report latest の status!=completed または target_sha 不一致で _fail_blocked へ；認証チェックは env 非空のみ＝#185）"
      - "進行役ライブ報告: ワーカーは SPEC.md 作成・commit・push・report status completed まで完走したが launch_worker が『worker report がありません』と誤検知し blocked へフェイルセーフ（#185 の2バグに起因、権限モードは無関係）"
      - "Issue #185（OPEN）: repoRoot worktree 分裂・認証チェック誤検知の恒久解消（未解決事項U1）"

  - ac_id: AC-7
    verification:
      mode: manual
      result: fail
      reason: "AC-7 は『人間介在なしに1セグメントが正常完了した（report_status completed・target_sha一致）ことを示す launch_worker の実行ログ・report-status 記録』の証跡を求める。ワーカー自身は report status completed・push まで済ませたが、launch_worker は #185 のバグでそれを検知できず終了コード2・blocked を記録したため、launch_worker レベルでの『正常完走の証跡』は存在しない。AC-6 に従属して result:fail"
      procedure: "AC-6 の判定に従属。進行役が採取した launch_worker ログは、ワーカーの completed 報告にもかかわらず launch_worker 側が worker report 不可視（repoRoot 分裂）により blocked 到達（human_escalation_requested）へ倒れた記録であり、launch_worker が終了コード0で正常完走を確認した記録は存在しないことを確認した"
      executor: claude
    evidence:
      - "AC-6 参照: launch_worker 終了コード0・完走検知の証跡は不存在（存在するのは #185 バグによる blocked 誤到達の記録）"
      - "finding-1/finding-2参照: ワーカー実質作業は完走・push・report completed 済みだが、launch_worker オーケストレーション層が #185 で検知できず完走証跡が採取できない"

  - ac_id: AC-8
    verification:
      mode: manual
      result: fail
      reason: "AC-6 の正常経路（認証あり・CLI利用可・issue 本文供給あり）の実機起動中に launch_worker のフェイルセーフ（report_status blocked/human_escalation_requested）が実際に発火した。今回の発火は Issue #180 と異なり真の実ブロッカー（git push 続行不能）に対する正しい安全側動作ではなく、Issue #185 の2バグ（repoRoot 分裂による worker report 誤不可視・認証チェック誤検知）による誤発火である。字義通り『正常経路で human_required が発火しない』は実証できておらず result:fail。ただし本 Issue の権限モード修正（allowlist）は正常に機能し git push は完走しており、誤発火は #185 の別バグに帰責される"
      executor: claude
      procedure: "AC-6 と同一の実機起動に依拠（再実行不能）。進行役報告の『ワーカーは completed まで完走したのに launch_worker が blocked を発火した／認証チェック迂回にダミー値が必要だった』を、finding-1 のコード整合確認（repoRoot が worktree の .git ファイルにマッチ、認証チェックが env 非空のみ）と突合し、正常経路での human_required 不発火が実証できていないことを確認した"
    evidence:
      - "進行役報告: 正常経路（認証あり・CLI利用可・git push 完走）で report_status blocked が誤発火（原因は #185 の repoRoot 分裂・認証チェック誤検知であり、権限モード・真の異常ではない）"
      - "finding-1参照: 今回の発火は #180 の『実ブロッカーへの正しい安全側動作』とは異なり、実装バグ（#185）による誤発火"

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: "認証欠如・CLI不在等の真の異常時に human_required が正しく発火することを確認する。異常注入の自動テストは既存 worker-adapters.test.ts が網羅し、これを含む npm test 全401件が pass することを独立に再実測した。認証欠如注入（env -u）の live 対照は前段報告に依拠（再実行不能）。AC-9 自身のシナリオ（真の異常→blocked発火・非0非3）は成立するため pass。ただし SPEC が求める『AC-8（正常経路で不発火）との対比による裏付け』は AC-8 が #185 バグにより未達成のため完全には確立していない旨を付記する。加えて認証チェック自体が env 非空のみで判定する #185 のバグにより『真の異常のみ発火』の精度は不完全（キーチェーン認証環境を誤って欠如判定しうる）だが、env が真に欠如する自動テスト経路では正しく発火する"
      procedure: "1) npm test をこのworktreeでフル実行し、test/integration/worker-adapters.test.ts の認証欠如・起動失敗・完了偽装・target_sha不一致の各フェイルセーフテストを含む 401件全 pass を実測（AC-9 automated 部分・回帰なし）。2) 進行役報告の live 対照（認証 env 未設定で launch_worker 起動→blocked_reason に認証未設定・human_escalation_requested・非0非3 return）を、claude.sh の認証欠如フェイルセーフ経路コードと突合し整合を確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts（認証欠如・起動失敗・完了偽装・target_sha不一致の各フェイルセーフ、pass）"
      - "実機確認: npm test 401/401 pass（フェイルセーフ系テスト全pass、権限モード変更後も回帰なし）"
      - "付記: AC-8 が #185 バグで未達成のため『正常経路で不発火・異常時のみ発火』の完全対比は未確立。認証チェックの env 非空のみ判定（#185）により精度は不完全だが、env 真欠如の automated 経路では正しく発火"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
      reason: "既存テストスイート全passを前段報告に依拠せず自ら再実行して実測した"
      procedure: "このworktree（feature/183-worker-permission-mode、HEAD=7bad757）で npm run build（tsc）を実行し終了コード0を実測。続いて npm test をフル実行し、tests 401 / pass 401 / fail 0 / cancelled 0 / skipped 0 / todo 0 を実測した（権限モード allowlist 化・state schema 拡張・issue/segment 変更・追加テスト反映後も回帰なし）"
      executor: claude
    evidence:
      - "実機確認: npm run build（tsc）終了コード0"
      - "実機確認: npm test → 1..401, tests 401, pass 401, fail 0, cancelled 0, skipped 0, todo 0"

regression:
  executed: true
  evidence:
    - "実機確認: npm run build（tsc）終了コード0"
    - "実機確認: npm test 401/401 pass, 0 fail, 0 skipped（worker-adapters.test.ts のフェイルセーフ系・新規追加テスト含む）"
