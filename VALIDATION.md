# VALIDATION: agent-skill-chain — doctor網羅性拡張・branch-name自己違反・segments.yaml矛盾・PRテンプレート未使用の解消
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# (agent-skill-chain/validation-report/v1) に完全一致する単一YAMLドキュメントである。
#
# 注記: .agent-skill-chain/templates/issue/VALIDATION.md のテンプレートは
# Markdown見出し + AC毎に分割した複数の```yaml```フェンスという構造だが、
# src/commands/verify.ts の acCoverage() は本ファイル全体を readYamlFile()
# （yamlパッケージの parse() を生のテキストへ直接適用）で1つのYAML文書として
# 読み込む実装であり、Markdown見出しや複数フェンスが混在すると
# 「Implicit keys need to be on a single line」でパースに失敗する
# （先行issue #171・#166で実機確認済み）。よって本ファイルはテンプレートの見出し構造ではなく、
# スキーマが要求するフィールドをすべて満たす1つのYAMLとして記述する（見出し相当の情報は
# 本コメントとキー名・配列構造で表現する）。
#
# 本検証は実装者本人とは別の独立した検証者として実施した。実装者の自己申告
# （371/371テストpass等）を鵜呑みにせず、以下すべてを自ら再実測した:
#   - npm test をこのworktreeで実行し件数を実測（conformance/falsification共通の前提）
#   - node bin/agents-md.js doctor をこのworktreeおよび実際のmain worktree
#     （/home/adachi/projects/AGENTS.md）に対して実行し、4新規項目の出力を実測した
#   - /tmp配下の隔離git repo（本リポジトリの実worktreeとは独立、.agent-skill-chain/一式を
#     複製し coordination.backend を local に切り替え）へ、doctor拡張4項目それぞれについて
#     意図的に条件を崩した状態を1つずつ作り、NG検出と復旧後のOK復帰を実機で確認した
#     （worktree命名規約違反・main worktree未commit差分・template-sync欠落/差分の2パターン・
#     schemas構文エラー）
#   - node bin/agents-md.js verify branch-name chore/162-agent-skill-chain-bootstrap を実行し
#     終了コード0を実測。feature/123-foo（既存許容type）・invalidtype/123-foo（許容外type）でも
#     regressionが無いことを実測した
#   - .agent-skill-chain/schemas/validation-report.schema.yaml準拠の本VALIDATION.mdを作成した上で
#     verify artifacts ISSUE-174 validation・verify ac-coverage ISSUE-174 を実行してpassを確認した
#   - 検証後、隔離git repo（/tmp配下）は完全に削除した

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-174
target_sha: 1d57930f0b57aab4d92a26e8683161cbb8e2fbf8

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（test/integration/doctor.test.ts の worktree命名規約違反ケース）に加え、/tmp隔離repoで規約外の名前のworktreeをgit worktree addで実際に作り、doctorがNG検出することを実地確認した"
      procedure: "隔離repoで git worktree add -b feature/bad-name .worktrees/not-a-valid-name main を実行後 doctor を実行 → NG worktree命名規約: <path> は worktree.path_pattern に適合しません、終了コード1を実測。worktree削除後は OK worktree命名規約 に復帰することも確認した"
      executor: claude
    evidence:
      - "test/integration/doctor.test.ts"
      - "src/commands/doctor.ts（worktree命名規約チェック）"
      - "実機確認: /tmp隔離repoでのgit worktree add→doctor NG→worktree削除→doctor OK（本VALIDATION作成セッションで実施、隔離repoは検証後削除済み）"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "自動テストに加え、/tmp隔離repoで未commitファイルを作成しdoctorがNG検出することを実地確認した。加えて実際のmain worktree（/home/adachi/projects/AGENTS.md）に対してdoctorを実行したところ、.worktrees/が.gitignore対象外であるため常時untrackedとなり、このリポジトリの通常運用（複数worktree並行作業）下では本チェックが恒常的にNGになることを実測した（詳細はfindings参照）"
      procedure: "隔離repoで untracked.txt を作成後 doctor を実行 → NG main worktreeのclean状態: 未commitの変更があります、終了コード1を実測。ファイル削除後はOKに復帰。加えて実際のmain worktree（/home/adachi/projects/AGENTS.md）でdoctorを実行し、NG main worktreeのclean状態: 未commitの変更があります（原因は.worktrees/の未追跡）を実測した"
      executor: claude
    evidence:
      - "test/integration/doctor.test.ts"
      - "src/commands/doctor.ts（main worktreeのclean状態チェック）"
      - "実機確認: /tmp隔離repoでのuntrackedファイル作成→doctor NG→削除→doctor OK"
      - "実機確認: /home/adachi/projects/AGENTS.md（実main worktree）での doctor 実行結果（NG main worktreeのclean状態、原因: .worktrees/未追跡）— findings参照"

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（欠落・差分あり両パターン）に加え、/tmp隔離repoで.github/配下のファイルを削除・改変しdoctorがNG検出することを実地確認した"
      procedure: "隔離repoで sync templates 実行後 doctor 実行→OK template-sync を確認。続けて.github/CODEOWNERSへ追記→NG template-sync: 未同期（差分あり）: CODEOWNERSを実測。復元後.github/SECURITY.mdを削除→NG template-sync: 未同期（欠落）: SECURITY.mdを実測。いずれも復元後はOKに復帰した"
      executor: claude
    evidence:
      - "test/integration/doctor.test.ts"
      - "src/lib/template-sync.ts（computeTemplateSyncDiffs）"
      - "実機確認: /tmp隔離repoでの.github/改変→doctor NG（差分・欠落の両パターン）→復元→doctor OK"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: "自動テストに加え、/tmp隔離repoでschemas/*.yamlの1つに構文エラーを混入しdoctorがNG検出することを実地確認した"
      procedure: "隔離repoで .agent-skill-chain/schemas/segments.schema.yaml を 'foo: [1, 2\\n  bar: [unbalanced\\n' という構文エラーのある内容に書き換え doctor を実行→NG schemas構文妥当性: segments.schema.yaml: Implicit keys of flow sequence pairs need to be on a single line...、終了コード1を実測。git checkoutで復元後はOKに復帰した"
      executor: claude
    evidence:
      - "test/integration/doctor.test.ts"
      - "src/commands/doctor.ts（schemas構文妥当性チェック）"
      - "実機確認: /tmp隔離repoでのschemas構文エラー注入→doctor NG→復元→doctor OK"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（doctor: 追加4項目すべてが正常な状態であれば全項目OK・終了コード0になる）に加え、/tmp隔離repoで異常系注入前後（ベースライン状態）にdoctorを実行し4項目全てOK・終了コード0であることを実地確認した"
      procedure: "隔離repoでsync templates実行・commit後にdoctorを実行し、worktree命名規約・main worktreeのclean状態・template-sync・schemas構文妥当性の4項目すべてがOK表示・終了コード0であることを確認した。各異常系注入後の復元直後にも同様に4項目OK・終了コード0への復帰を都度確認した"
      executor: claude
    evidence:
      - "test/integration/doctor.test.ts"
      - "実機確認: /tmp隔離repoでのベースラインdoctor実行（4項目OK・終了コード0）"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
      reason: "verify branch-nameはbranch.pattern（issue.allowed_typesを動的参照）に対する文字列照合という機械的検証がそのまま受入条件になっている"
      procedure: "node bin/agents-md.js verify branch-name chore/162-agent-skill-chain-bootstrap を実行し終了コード0を実測した"
      executor: claude
    evidence:
      - ".agent-skill-chain/config/agent-skill-chain.yaml（issue.allowed_types）"
      - "実機確認: verify branch-name chore/162-agent-skill-chain-bootstrap → EXIT=0"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
      reason: "既存許容type・許容外typeそれぞれの終了コードを実測することで機械的にregressionの有無を判定できる"
      procedure: "node bin/agents-md.js verify branch-name feature/123-foo（終了コード0）と invalidtype/123-foo（終了コード1、branch.patternに適合しない旨のメッセージ）をそれぞれ実行し、chore追加前と同じ判定結果であることを確認した"
      executor: claude
    evidence:
      - "実機確認: verify branch-name feature/123-foo → EXIT=0"
      - "実機確認: verify branch-name invalidtype/123-foo → EXIT=1（branch.patternに適合しないメッセージ）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
      reason: "segments.yamlのvalidation.outputsは静的な設定ファイルの内容そのものであり、直接読み込んで確認できる"
      procedure: ".agent-skill-chain/config/segments.yamlのvalidationセグメントのoutputsが[acceptance_test_results, regression_test_results]のみ（prを含まない）であることをcatで確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/config/segments.yaml"
      - "test/unit/segments.test.ts（EXPECTED配列からのpr削除）"

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（verify.test.ts等の既存artifacts検証テスト）に加え、本VALIDATION.md作成後に実際にverify artifactsを実行し、pr出力欠落を理由にした誤検知が発生しないことを実地確認した"
      procedure: "本ISSUE-174 worktreeにVALIDATION.mdを作成した状態で node bin/agents-md.js verify artifacts ISSUE-174 validation を実行し、成功（pr出力の欠落を理由とするエラーが出ない）ことを確認した。src/commands/verify.tsのcheckOutputExists()からcase 'pr'が削除され、到達不能コードが解消されていることをコード読解で確認した"
      executor: claude
    evidence:
      - "src/commands/verify.ts（checkOutputExists、case 'pr'削除）"
      - "実機確認: verify artifacts ISSUE-174 validation → 成功"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
      reason: "gh呼び出しをスタブ化した既存の自動テスト（test/integration/github-backend.test.ts）が、gh-stubへ渡された--bodyの内容を正規表現で直接検証しており、機械的に確認可能である"
      procedure: "test/integration/github-backend.test.ts の3テスト（SPEC.mdのみ存在時の変更概要・理由・成果物リンク自動充填とプレースホルダ残置、DESIGN.md追加時の影響範囲・ロールバック方針の自動充填、テンプレート不在時のCloses #<id>のみへのフォールバック）を読み、gh-stubが記録した--bodyへの正規表現アサーション（## 変更概要・## 理由・## 影響範囲・## ロールバック方針・## 成果物リンクの各見出しと本文）を確認した。npm test実行でこれら3テストがpassしていることも実測した"
      executor: claude
    evidence:
      - "test/integration/github-backend.test.ts"
      - "src/commands/pr.ts（buildIssueBody）"
      - ".agent-skill-chain/templates/github/.github/pull_request_template.md"

  - ac_id: AC-11
    verification:
      mode: automated
      result: pass
      reason: "npm testはリポジトリの自動テストスイート全体を実行するコマンドである"
      procedure: "npm test をこのworktreeで実行し371/371 pass・0 fail・0 skippedを実測した（実装者報告の371件と一致）。既存launch_worker/launch_gate_reviewer関連テスト（worker-adapters.test.ts・gate-adapters.test.ts・gate-judgment.test.ts）を含む全テストが個別のfailなしでpassしていることを、TAP出力のfail=0・cancelled=0・not ok行が0件であることから確認した"
      executor: claude
    evidence:
      - "commit:1d57930"
      - "npm test 実行結果: 371/371 pass、0 fail、0 skipped"

regression:
  executed: true
  evidence:
    - "npm test（371/371 pass、0 fail、0 skipped。本VALIDATION作成セッションで実測、実行日時2026-07-20）"
    - "既存launch_worker/launch_gate_reviewer関連テスト（worker-adapters.test.ts・gate-adapters.test.ts・gate-judgment.test.ts）を含め無破壊を確認"

# --- 独立検証者の所見（findings） ---
# 本セクションはスキーマの additionalProperties: false 制約に抵触するため、
# 正式なYAMLフィールドとしては追加しない。所見はコメントとして本ファイル内に記載し、
# 対応するAC（AC-2）のreason/procedureにも要点を転記済みである。
#
# [Medium] AC-2実装は、実際のmain worktree（/home/adachi/projects/AGENTS.md）に対して
# 実行すると恒常的にNGになる。原因は、AGENTS.mdが正式なディレクトリ構成として定める
# `.worktrees/` がこのリポジトリの .gitignore に含まれておらず、`git status --porcelain`
# が `.worktrees/` を常にuntrackedディレクトリとして報告するため。本システムは
# 「1 Issue = 1 worktree」の並行運用を前提としており（AGENTS.md I4）、実運用下では
# 常に1つ以上のworktreeが.worktrees/配下に存在する。つまりAC-2の実装自体は仕様どおり
# 正しく動作しているが（未commit差分の検出は正確）、このリポジトリが自身の.gitignoreを
# 是正しない限り、通常運用下のdogfooding（PLAN.md #12が要求する
# 「本リポジトリ自身に対してdoctorを実行し終了コード0を確認する」）は満たされない。
# 実測: 2026-07-20時点のmain worktreeでdoctorを実行した結果、
# NG main worktreeのclean状態: 未commitの変更があります: /home/adachi/projects/AGENTS.md
# （原因: `?? .worktrees/`のみ）。本Issueのスコープ外の可能性が高い
# （.gitignoreの是正はISSUE-174のAC群に含まれていない）が、副作用として記録する。
#
# [Low] 同じmain worktree実行で、worktree命名規約チェックも
# `/home/adachi/projects/AGENTS.md/.claude/worktrees/agent-ae45945bb042dc565`
# （Claude Code自身が管理する、agent-skill-chainのworktree.path_pattern外の
# worktree）をNG対象として検出した。これはgit worktree listがgit管理下の
# 全worktreeを列挙する以上、agent-skill-chainの外側で作られたworktree
# （本開発環境ではClaude Codeのサブエージョン用worktree）も検査対象に含まれて
# しまうという、AC-1の実装が前提とする「worktreeは全てagent-skill-chainが
# 作成したものである」という仮定の限界を示す実例。SPEC.md・DESIGN.mdの
# 記載範囲内の実装としては正しく、AC-1自体は満たしているため result は pass
# のままとするが、実運用（特にこのリポジトリのようにClaude Code経由で
# 開発する環境）でのdoctor全項目OKの実現可能性に影響しうる副作用として記録する。
