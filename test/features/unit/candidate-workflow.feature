@unit
Feature: 実装先行候補は実差分と不足責務から次の仕事を選び正式gateを代替しない

  Scenario Outline: SCN-UNIT-CANDIDATE-001 事前判定は重大リスクをスコアで相殺しない
    Given 隔離候補の事前条件を用意する
    And 事前条件「<condition>」を設定する
    When 候補実装の事前判定を行う
    Then 候補の経路は「<route>」で正式権限を持たない

    Examples:
      | condition               | route     |
      | safe                    | candidate |
      | auth                    | upstream  |
      | no-criterion            | clarify   |
      | unknown-risk            | clarify   |
      | no-isolation            | clarify   |
      | vague-intent            | clarify   |
      | misclassified-auth-path | upstream  |
      | misclassified-neutral-path | candidate |

  Scenario Outline: SCN-UNIT-CANDIDATE-002 実差分と独立reviewの前に正式完了にしない
    Given 候補実装後の差分と対象テストを用意する
    And 事後条件「<condition>」を設定する
    When 候補実装の事後判定を行う
    Then 候補の経路は「<route>」で正式権限を持たない

    Examples:
      | condition        | route              |
      | safe             | independent-review |
      | unexpected-path  | upstream           |
      | failed-test      | repair             |
      | security-gap     | upstream           |
      | requirement-gap  | upstream           |
      | verification-gap | repair             |
      | no-diff          | repair             |
      | hidden-scope-and-implementation-gap | upstream |
      | removed-access-guard | upstream |

  Scenario: SCN-UNIT-CANDIDATE-003 未追跡ファイルを含む候補worktreeのGit証拠を拒否する
    Given 専用Git worktreeに候補実装をcommitする
    When 候補のGit差分を観測する
    Then 変更ファイルはGitから観測される
    When 候補worktreeに未追跡ファイルを追加する
    Then 候補のGit観測はdirty worktreeを拒否する

  Scenario: SCN-UNIT-CANDIDATE-004 Git環境の上書きと主worktreeを候補から拒否する
    Given 専用Git worktreeに候補実装をcommitする
    Then 主worktreeは候補として拒否される
    When Git環境上書きを設定する
    Then 候補のGit観測は環境上書きを拒否する

  Scenario: SCN-UNIT-CANDIDATE-005 renameの旧新両pathを変更範囲として観測する
    Given 専用Git worktreeに候補実装をcommitする
    When 候補worktreeでファイルをrenameしてcommitする
    Then renameの旧新両pathをGitから観測する

  Scenario: SCN-UNIT-CANDIDATE-006 著者名fieldの変更を認可guard削除と誤認しない
    Given 著者名fieldを変更する隔離Git dummyがある
    When 著者名fieldの差分を観測する
    Then 著者名の削除を認可guard削除と誤判定しない
