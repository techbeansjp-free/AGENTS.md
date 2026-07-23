# 正本: AGENTS.md §不変条件I7
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に完全一致する単一YAMLドキュメントである。
# 見出し構造ではなく1つのYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 本ファイル全体を単一YAMLとして readYamlFile() で読み込むため、見出し相当の情報はコメントで表現する）。
#
# 本検証は実装者本人とは別の独立検証者（validation_worker）として実施した。
# 本worktree直下には前Issue（#208）由来のVALIDATION.mdが混入していたため、
# 本ファイルは当該内容を Issue #211 自身の検証成果物として完全に上書きしたものである。
#
# 本Issueの構造的性質（自己完結の記載）:
#   SPEC.md AC-2・AC-3 は、本Issue自身のPRが実際に `gh pr merge --admin --squash` で
#   main へマージされ、マージ後にGitHub Actionsのワークフロー起動有無を実地観測して
#   初めて検証可能な性質の受入条件である。ところが本検証セグメントは、通常のセグメント順序
#   （spec→design→implementation→validation→ゲート通過→マージ）に従い、マージより前に実施
#   される。検証実施時点（本ファイル作成時点）で `gh pr view 212` を実行し確認した結果、
#   PR #212 は state: OPEN, mergedAt: null であり、マージは未実施である。したがって
#   AC-2が要求する「マージ後の実地観測」・AC-3が要求する「観測結果に基づく結論記録」は、
#   本検証セッションの時点で観測対象事象そのものが発生していない。
#
#   これは過去Issue #196のAC-6/AC-7（[skip ci]の残存という決定論的・検証可能な一次的根拠を
#   使い、実行時点で確認できる事実からpassを積極的に論証したケース）とも、Issue #208の
#   AC-4（対象workflow自体はmainに存在しなかったが、GitHub Actionsの一般仕様・既に実行実績の
#   ある近縁workflowでの決定論的挙動という一次的根拠を積み重ねてpassを論証できたケース）とも
#   構造が異なる。#196・#208はいずれも「今この時点で確認できる一次的根拠」が存在し、それを
#   根拠にpass/failを確定できた。一方、本Issue #211のAC-2・AC-3は、検証対象の事象
#   （マージ後のワークフロー起動有無というGitHub Actions側の外部観測）が本検証時点で
#   文字通りまだ発生しておらず、代わりに援用できる一次的根拠も存在しない（AC-2・AC-3は
#   本Issue固有の実験結果そのものを問うものであり、他workflowでの実績からの類推では
#   代替できない）。ゆえに、この時点でpass/failのいずれを記録しても実態と乖離する
#   （pass:未検証をpassしたと偽ることになりsilent passになる。fail:機能や設計が失敗した
#   わけではなく、単に観測がまだ行われていないだけであり、失敗の烙印は不正確）。
#
#   本schema（agent-skill-chain/validation-report/v1）の verification.result は
#   pass|fail の2値のみを許容し「未実施」を表す3値目は存在しない。この制約下で最も安全側
#   （虚偽のpassを記録しない側）に倒す選択として、AC-2・AC-3はいずれも result: fail を
#   記録する。ただし reason に明記する通り、これは「本Issueが実装した変更や設計判断が
#   失敗した」という意味ではなく、「本検証セッション時点でPRが未マージであり、AC-2・AC-3が
#   要求する観測事象自体がまだ発生していないため、この時点でpassと確定できない」という
#   意味の fail である。マージ実行・実地観測・結論記録は、validation-gate承認後に進行役が
#   PRマージを実行した後に行い、その結果はGitHub Issue #211のクローズ時コメントとして
#   記録する。本VALIDATION.mdファイル自体はマージ後も削除されず本Issueの成果物として
#   残り続けるため、可能であればマージ後に本ファイルへ実地観測結果・結論を追記することも
#   検討する。
#
# 実施した検証の要旨:
#   - AC-1: `npm run build`（tsc）はエラーなく完了した。`npm test`
#     （node --import tsx --test 経由）で 474 tests / 474 pass / 0 fail / 0 skipped、
#     duration_ms 200374.21 を実測した。あわせて `git diff main...HEAD --stat` により、
#     (1) `.github/workflows/` 配下の変更が0件であること（`git diff main...HEAD --stat --
#     .github/workflows/` の出力が空であることを確認）、(2) `.agent-skill-chain/scripts/
#     doctor.sh` への1行追加（1 file changed, 1 insertion(+)）が含まれること、の両方を
#     機械的に確認した。さらに `.github/workflows/agent-skill-chain-release.yml` の
#     `on.push.paths` 定義を実際に読み、`.agent-skill-chain/**` パターンが列挙されている
#     こと（`.agent-skill-chain/scripts/doctor.sh` が一致すること）を確認した。以上より
#     AC-1が要求する2条件（`.github/workflows/`配下非変更・pathフィルタ一致変更を含む）を
#     いずれも実測で確認できたため、result: pass として記録する。
#   - AC-2・AC-3: 上記の通り、observationが本質的にまだ行われていないため result: fail
#     （「未実施」を表す安全側の値であり「失敗」ではない）として記録する。
#
# regressionについて: AC-1の検証で実施した `npm test` の全体実行結果（474/474 pass）を
# regressionの証跡として扱う。本Issueの変更はコメント1行追加のみであり、既存テストへの
# 影響は生じないことも実測で確認済みである。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-211
target_sha: 4881b82c25abf48d18e50cf3e9f57a805d99ebea

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 実行結果: 474 tests / 474 pass / 0 fail / 0 skipped（duration_ms 200374.21、本worktreeでの実行、2026-07-23実測）"
      - "npm run build 実行結果: tsc正常終了（エラー0件）"
      - "git diff main...HEAD --stat -- .github/workflows/ の出力が空（.github/workflows/配下の変更0件を確認）"
      - "git diff main...HEAD --stat -- .agent-skill-chain/scripts/doctor.sh の出力: 1 file changed, 1 insertion(+)（コメント1行追加を確認）"
      - ".github/workflows/agent-skill-chain-release.yml の on.push.paths に '.agent-skill-chain/**' が列挙されていることを目視確認（pathフィルタ一致を確認）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: fail
      reason: "AC-2はPRがgh pr merge --admin --squashによりmainへマージされた直後のGitHub Actions実地観測を要求する受入条件である。本検証セッション時点（VALIDATION.md作成時点）でgh pr view 212を実行し確認した結果、PR #212はstate: OPEN, mergedAt: nullでありマージ未実施である。したがってAC-2が要求する観測事象（マージ後のワークフロー起動有無の実地観測）自体が本検証時点でまだ発生していないため、この時点でpass/failを確定的に論証できる一次的根拠が存在しない。result: failは「本Issueの変更や設計が失敗した」ことを意味するものではなく、「観測が本検証セッション内では未実施である」ことを表す、schemaがpass|failの2値しか許容しない制約下での安全側（虚偽passを避ける側）の選択である。"
      procedure: "validation-gate承認後、進行役がPR #212に対しgh pr merge --admin --squashを実行してmainへマージし、マージ直後からGitHub Actions UI（Actionsタブ）およびgh run list等のAPIの双方で、マージcommitを対象としたagent-skill-chain / releaseワークフローの実行有無を、マージ直後から少なくとも20分間観測する。起動した場合は起動時刻・対象commit SHA・実行結果を、起動しなかった場合は20分経過後もUI・API双方で実行回数が0件であったことを記録する。"
      executor: "進行役（PRマージ後に実施。本検証セッションの実行者ではない）"
    evidence:
      - "gh pr view 212 --json state,mergedAt,number,title 実行結果（本検証時点）: {\"mergedAt\":null,\"number\":212,\"state\":\"OPEN\",\"title\":\"ISSUE-211: 211 actions trigger diagnosis\"}"
      - "SPEC.md AC-2定義（本Issue内成果物、要求する観測手順の一次情報源）"

  - ac_id: AC-3
    verification:
      mode: manual
      result: fail
      reason: "AC-3はAC-2による実地観測結果が得られていることを前提（Given）とする受入条件である。AC-2の観測自体が本検証セッション時点で未実施であるため（PR #212はマージ未実施、gh pr view 212で確認済み）、AC-3が要求する原因切り分けの結論記録はその入力データが存在せず、この時点で導出不可能である。result: failは「結論記録という作業が失敗した」ことを意味するものではなく、「その前提となる観測結果が本検証セッション内では存在しないため結論を確定できない」ことを表す、schemaの2値制約下での安全側の選択である。"
      procedure: "AC-2の観測完了後、進行役が観測結果（起動有無・起動した場合の時刻や対象SHA、起動しなかった場合の非起動継続時間）を、SPEC.mdに記載済みのIssue #208マージ時の状況（.github/workflows/配下を変更、admin bypassマージ、「1 check was pending」表示）およびIssue #196〜#204マージ時の状況（.github/workflows/配下を変更しない、同じくadmin bypassマージだが毎回release起動）と比較し、原因が(a).github/workflows/配下を変更するマージに固有の問題である、(b) admin bypassマージ全般に共通する問題である、(c) 今回の観測のみでは切り分けられなかった、のいずれに該当するかを結論として明記する。"
      executor: "進行役（AC-2観測完了後に実施。本検証セッションの実行者ではない）"
    evidence:
      - "gh pr view 212 --json state,mergedAt,number,title 実行結果（本検証時点）: {\"mergedAt\":null,\"number\":212,\"state\":\"OPEN\",\"title\":\"ISSUE-211: 211 actions trigger diagnosis\"}"
      - "SPEC.md AC-3定義（本Issue内成果物、要求する比較対象・結論区分の一次情報源）"

regression:
  executed: true
  evidence:
    - "npm test 全体実行結果: 474 tests / 474 pass / 0 fail / 0 skipped（duration_ms 200374.21、本worktreeでの実行、2026-07-23実測）"
