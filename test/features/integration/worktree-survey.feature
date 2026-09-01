@integration
Feature: CLIで登録済みworktreeを事後走査する

  Scenario: SCN-INT-WTSURVEY-001 fixture repositoryでworktree surveyが登録済みworktreeを列挙する
    Given 走査用のfixture repositoryがある
    When worktree surveyをJSON形式で実行する
    Then 登録済みworktreeがすべて列挙される

  Scenario: SCN-INT-WTSURVEY-002 merge済みworktreeをcleanup-readyとして報告する
    Given merge済みの走査用worktreeがある
    When worktree surveyをJSON形式で実行する
    Then 対象worktreeはcleanup-readyとして報告される

  Scenario: SCN-INT-WTSURVEY-010 未commitの変更を持つmerge済みworktreeをretainとし理由を報告する
    Given 未commit変更を持つmerge済みの走査用worktreeがある
    When worktree surveyをJSON形式で実行する
    Then 対象worktreeはretainで未commit理由を報告する

  Scenario: SCN-INT-WTSURVEY-011 走査はfile systemを一切変更しない
    Given merge済みの走査用worktreeがある
    When directory内容を比較してworktree surveyを実行する
    Then 実行前後のdirectory内容は一致する

  Scenario: SCN-INT-WTSURVEY-005 apply指定を日本語errorで拒否する
    Given 走査用のfixture repositoryがある
    When applyを指定してworktree surveyを実行する
    Then 日本語errorで拒否される

  Scenario: SCN-INT-WTSURVEY-006 後片付け漏れがあっても終了コードが0である
    Given merge済みの走査用worktreeがある
    When worktree surveyをJSON形式で実行する
    Then 走査の終了コードは0である

  Scenario: SCN-INT-WTSURVEY-007 text形式が日本語の要約表を出す
    Given merge済みの走査用worktreeがある
    When worktree surveyをtext形式で実行する
    Then 日本語の要約表が出力される

  Scenario: SCN-INT-WTSURVEY-008 doctorがworktree要約を報告する
    Given doctor可能でmerge済みworktreeを持つfixture repositoryがある
    When doctor CLIを実行する
    Then doctorはworktree要約を報告する

  Scenario: SCN-INT-WTSURVEY-009 後片付け漏れがあってもdoctorのhealthyが偽にならない
    Given doctor可能でmerge済みworktreeを持つfixture repositoryがある
    When doctor CLIを実行する
    Then doctorはhealthyを維持する

  Scenario: SCN-INT-WTSURVEY-003 worktree surveyがslug不一致を報告する
    Given branch改名でslugがずれたmerge済みworktreeがある
    When worktree surveyをJSON形式で実行する
    Then 対象worktreeはslug不一致を報告する

  Scenario: SCN-INT-WTSURVEY-004 不一致があっても削除判断が変わらない
    Given branch改名でslugがずれたmerge済みworktreeがある
    When worktree surveyをJSON形式で実行する
    Then 対象worktreeはslug不一致でもcleanup-readyを維持する

  Scenario: SCN-INT-WTSURVEY-012 ignored出力が1MiBを超えるrepositoryでも走査が分類を返す
    Given ignored出力が1MiBを超える走査用worktreeがある
    When worktree surveyをJSON形式で実行する
    Then 走査はerrorなしで登録済みworktreeを分類する

  Scenario: SCN-INT-WTSURVEY-013 remote branch削除後もmerge済みworktreeをcleanup-readyとして報告する
    Given remote branchを削除したmerge済みの走査用worktreeがある
    When worktree surveyをJSON形式で実行する
    Then 対象worktreeはcleanup-readyとして報告される

