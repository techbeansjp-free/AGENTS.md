@unit
Feature: 隔離copy検査のtrust anchor契約

  Scenario: SCN-1344-001 Git依存検査はcandidate外部の固定済みtrust anchorを使う
    Given 隔離copy検査の配布規範と実装計画templateがある
    When trust anchor境界の記述を検査する
    Then Git依存検査の実行場所と外部anchorが定義されている

  Scenario: SCN-1344-002 candidateが合成したGit状態をauthorityに使わない
    Given 隔離copy検査の配布規範と実装計画templateがある
    When trust anchor境界の記述を検査する
    Then candidate由来のrepositoryとoriginとcommitは禁止されている

  Scenario: SCN-1344-003 no-indexの差分と空でない診断を区別する
    Given 隔離copy検査の配布規範と実装計画templateがある
    When trust anchor境界の記述を検査する
    Then no-index検査は終了値ではなく空の標準出力を合格条件にする

  Scenario: SCN-1344-004 Git非依存検査は通常file copyで実行できる
    Given 隔離copy検査の配布規範と実装計画templateがある
    When trust anchor境界の記述を検査する
    Then Git非依存検査はGit状態を合成せずcopy内で実行する
