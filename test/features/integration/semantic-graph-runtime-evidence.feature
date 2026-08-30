@integration @actual-graphqlite
Feature: 隔離疑似projectでGraphQLite runtime Evidenceを即時観測する
  観測期間を置かず、固定assetを注入した実GraphQLiteとGit worktreeを使って、
  worktree分離と再構築の再現性を同一test実行内で立証する。

  Scenario: SCN-INT-SEMRUNTIME-001 同一commitの2 worktreeはsemantic contentを共有してruntimeを分離する
    Given actual GraphQLiteによる2 worktree分離観測用の隔離疑似projectがある
    When 両worktreeを完全再構築してAだけtracked sourceを変更し再構築する
    Then 初期semantic contentは一致しworktree identityとruntimeは物理的に分離される
    And Aの変更後もBのruntime byte列とqueryとfreshnessは不変である

  Scenario: SCN-INT-SEMRUNTIME-002 同一sourceのactual再構築と探索結果は固定seedで再現する
    Given actual GraphQLiteによる固定seed再現性観測用の隔離疑似projectがある
    When 同一sourceからactual GraphQLite projectionを2回完全再構築する
    Then 正規化したstatusとimpactとpathとorderは完全に一致する
    And node数とedge数と各hrtimeを閾値判定せず観測Evidenceとして保持する
