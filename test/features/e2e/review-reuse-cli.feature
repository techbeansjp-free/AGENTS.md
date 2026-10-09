@e2e @issue-1544
Feature: review済みexact diffの再利用と再review必須条件によるmerge認可
  pr mergeはround記録とGitからtransition鎖を再導出し、内容変化がすべて検分identityで被覆された場合だけ認可する。

  Scenario: SCN-REVIEW-REUSE-001 focused round 2で収束した是正は全体reviewのやり直しなしにmergeできる
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-001"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-002 既定branchのhunkを巻き戻したtransitionを検分していなければpath名が検分済みでもmergeできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-002"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-003 是正した内容の依存先を検分していなければmergeできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-003"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-004 検分identityが改変されたsessionは全体reviewが無ければmergeできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-004"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-005 検分identityを持たない既存sessionは暫定guardと同じ判定になる
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-005"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-006 是正後の最終headで検証を取り直していなければmergeできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-006"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-007 既定branch追随で比較基点が動いたPRは同じsessionの全体検分roundが無ければmergeできずあればmergeできる
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-007"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-009 PRの依存先と交差する既定branch追随も全体検分roundが無ければmergeできず前headを第1親としない追随mergeはfollowOnlyにできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-009"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-010 暫定guardの5条件を満たすsessionは新判定でも認可される
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-010"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる

  Scenario: SCN-REVIEW-REUSE-011 security注意pathの是正は累積差分を検分しなければmergeできない
    Given review再利用E2Eの隔離環境がある
    When "SCN-REVIEW-REUSE-011"のreview再利用E2E検査を実行する
    Then review再利用E2E検査は期待結果になる
