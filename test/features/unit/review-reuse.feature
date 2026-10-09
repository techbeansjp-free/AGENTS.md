@unit @issue-1544
Feature: review再利用判定はround記録とGit観測だけからtransition鎖を再導出する
  判定関数はGitを呼ばず観測値だけを受け取り、観測できない場合は判定不能へ倒す。

  Scenario: SCN-UNIT-REVREUSE-001 path別section digestは単独path diffのsha256と一致し件数不一致を例外にする
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-001"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-002 transition鎖はrecord layer roundを含めず全体検分より前を照合しない
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-002"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-003 linkは同一と内容非変化と追随と断絶に分類される
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-003"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-004 導出基点はclean追随だけで前進しactualAuditBaseと末尾headに一致しなければならない
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-004"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-005 全体検分は最も後ろの基点とdigestが一致するroundだけを起点にする
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-005"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-006 counted transitionはdigestと隣接範囲と影響集合の種別を再計算値と照合する
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-006"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-007 追随は既定branch側の変更とPRの変更pathと隣接範囲の交差を求め影響集合fullは判定不能にする
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-007"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-008 累積検分要求pathは最後のtag以降の累積検分を監査diffのsection digestと照合する
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-008"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-009 verdictは該当の種別から集約され診断は種別とpathとtransitionと次の操作を名指しする
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-009"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-010 雛形の割当は判定と同じ関数から追随と全体と累積pathと割当なしを決める
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-010"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる

  Scenario: SCN-UNIT-REVREUSE-011 実Gitの観測失敗は判定不能になり再計算回数はround数より1多い回数以内に収まる
    Given review再利用unit検査の準備がある
    When "SCN-UNIT-REVREUSE-011"のreview再利用unit検査を実行する
    Then review再利用unit検査は期待結果になる
