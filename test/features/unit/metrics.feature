@unit
Feature: 計測基盤（step_ms・role_ms・model_ms・deterministic_ms・review_rounds）

  Background:
    Given 空の計測用worldを準備する

  Scenario: SCN-MT-1482-001 step_msを連続entry間のrecordedAt差分として算出する
    Given journal/steps.jsonlにStep1・Step2・Step4のentryが記録済みである
    When 対象journalのstep_msを算出する
    Then step_msはStep間のrecordedAt差分と一致する

  Scenario: SCN-MT-1482-002 review_roundsをfollowOnly・recordLayerOnlyを除いた件数として算出する
    Given rounds 3件のうち1件がfollowOnly、1件がrecordLayerOnlyのreview session stateである
    When review_roundsを算出する
    Then review_roundsは1である

  Scenario: SCN-MT-1482-003 同一kindでopen状態のまま二重startを拒否する
    Given kind=roleでlabel=implementerの計測イベントがopen状態である
    When 同じkind=roleでstartの新規イベントを検証する
    Then INV-03により拒否される

  Scenario: SCN-MT-1482-004 idle状態でのendを拒否する
    Given kind=modelの計測イベントはidle状態である
    When 同じkind=modelでendの新規イベントを検証する
    Then INV-04により拒否される

  Scenario: SCN-MT-1482-005 role=implementerの区間からartifact_build_msとsupport_msを算出する
    Given kind=roleでlabel=implementerが1000ms、label=reviewerが500ms記録済みのイベント系列である
    And 計測window全体が2000msである
    When support_msとartifact_build_msを算出する
    Then artifact_build_msは1000でsupport_msは1000である

  Scenario: SCN-MT-1482-012 kind=roleのlabelはROLES列挙値でなければ拒否する
    Given kind=roleでlabelがROLES列挙値でないイベント行である
    When その行をparseする
    Then ROLES列挙値エラーで拒否される

  Scenario: SCN-MT-1482-013 endがstartより前の時刻なら時間逆行として拒否する
    Given kind=modelでlabel=codexがopen状態（start=00:00:05）である
    When startより前の時刻でendの新規イベントを検証する
    Then 時間逆行として拒否される

  Scenario: SCN-MT-1482-014 計測windowはjournalとevent両方を合わせた最古から最新までである
    Given journal/steps.jsonlの範囲外に計測イベントがあるfixtureである
    When 計測windowを算出する
    Then 計測windowは合わせた集合の最古から最新までの10000msである

  Scenario: SCN-MT-1482-015 role区間が開いたままならartifact_build_msとsupport_msはunavailableである
    Given kind=roleでlabel=implementerが開いたままのイベント系列である
    When support_msとartifact_build_msを算出する
    Then artifact_build_msとsupport_msはunavailableである

  Scenario: SCN-MT-1482-008 step_msの境界値（0件・1件）で例外にならない
    Given journal/steps.jsonlのentryが0件である
    When 対象journalのstep_msを算出する
    Then step_msは空集合である
    Given journal/steps.jsonlのentryが1件だけである
    When 対象journalのstep_msを算出する
    Then step_msは空集合である

  Scenario: SCN-MT-1482-009 未終了区間はwarningとして報告し合計から除外する
    Given kind=deterministicのstartだけが記録され対応するendが無いイベント系列である
    When role_ms・model_ms・deterministic_msを算出する
    Then deterministic_msの合計は0でunavailable警告が1件以上ある

  Scenario: SCN-MT-1482-011 metrics.tsはadapter層とCLI層をimportしない
    Given repository rootのsrc/domain/metrics.tsを対象にする
    When src/domain/metrics.tsの依存importを検査する
    Then src/adapters配下とsrc/cli.tsへのimportは無い
