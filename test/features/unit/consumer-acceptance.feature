@unit
Feature: 配布artifactのconsumer acceptanceを安全側に判定する

  Scenario: SCN-UNIT-CONSUMER-001 source repository内の作業場所を拒否する
    Given source repository内を指す隔離条件がある
    When consumer acceptanceの隔離条件を判定する
    Then 作業場所がsource repositoryへ到達する理由で拒否される

  Scenario: SCN-UNIT-CONSUMER-002 source repositoryの実行入口を含むPATHを拒否する
    Given source repositoryの実行入口を含む隔離PATHがある
    When consumer acceptanceの隔離条件を判定する
    Then PATHがsource repositoryへ到達する理由で拒否される

  Scenario: SCN-UNIT-CONSUMER-003 source repository内のpackage manager cacheを拒否する
    Given source repository内を指す隔離cacheがある
    When consumer acceptanceの隔離条件を判定する
    Then cacheがsource repositoryへ到達する理由で拒否される

  Scenario: SCN-UNIT-CONSUMER-004 導入成功後にbinが無ければ不合格にする
    Given 導入は成功したがbinが無いpacked-bin観測がある
    When consumer acceptanceを判定する
    Then packed-binは不合格になる

  Scenario: SCN-UNIT-CONSUMER-005 公開入口の非0終了を不合格にする
    Given 公開入口が非0で終了したpacked-bin観測がある
    When consumer acceptanceを判定する
    Then packed-binは不合格になる

  Scenario: SCN-UNIT-CONSUMER-006 npm準備工程の不成立を不合格にする
    Given npm準備工程が非0で終了する注入runnerがある
    When consumer acceptanceを判定する
    Then git-dependencyは不合格になる

  Scenario: SCN-UNIT-CONSUMER-007 pnpmの明示停止だけを合格にする
    Given allowBuildsなしの明示errorと終了値0を返す注入runnerがある
    When consumer acceptanceをそれぞれ判定する
    Then pnpmの明示errorだけが合格になる

  Scenario: SCN-UNIT-CONSUMER-008 allowBuilds有効時は公開入口まで成立した場合だけ合格にする
    Given allowBuilds有効時の成立と不成立を返す注入runnerがある
    When consumer acceptanceをそれぞれ判定する
    Then 公開入口まで成立した観測だけが合格になる

  Scenario: SCN-UNIT-CONSUMER-009 判定不能を合格へ倒さない
    Given 終了値を観測できないpacked-bin観測がある
    When consumer acceptanceを判定する
    Then packed-binは判定不能として全体を不合格にする

  Scenario: SCN-UNIT-CONSUMER-010 対象機構を既知の3件に固定する
    Given consumer acceptanceの対象機構候補がある
    When 対象機構を検証する
    Then git-dependencyとpacked-binとscale-outputだけを受理する

  Scenario: SCN-UNIT-CONSUMER-011 artifactの3者一致だけを受理する
    Given 一致と不一致と算出不能のartifact digestがある
    When artifactの同一性を判定する
    Then 3者が一致する場合だけ合格になる

  Scenario: SCN-UNIT-CONSUMER-012 大規模ignored出力で公開入口が失敗したら不合格にする
    Given 公開入口が非0で終了したscale-output観測がある
    When consumer acceptanceを判定する
    Then scale-outputは不合格になる

  Scenario: SCN-UNIT-CONSUMER-013 symlink経由でsource repositoryへ戻るPATHを除外する
    Given source repositoryの実行入口へsymlinkで戻る継承PATHがある
    When consumer acceptance用の隔離envを作る
    Then symlinkで戻る実行入口は隔離PATHから除外される

  Scenario: SCN-UNIT-CONSUMER-014 規模の観測へ未到達なら判定不能にする
    Given 規模非依存の入力検証errorと規模由来errorと規模条件未達fixtureの観測がある
    When consumer acceptanceをそれぞれscale-outputとして判定する
    Then 3件は判定不能と不合格と判定不能になる

  Scenario: SCN-UNIT-CONSUMER-015 先行機構の不合格後は後続機構を観測しない
    Given 先行packed-binを不合格にする注入runnerがある
    When packed-binとscale-outputを順に検査する
    Then 後続機構を実行せず判定不能理由を残す

  Scenario: SCN-UNIT-CONSUMER-016 git依存の3条件を1件の複合観測としてfail-closedで判定する
    Given npmとpnpmの3条件を表す複合観測候補がある
    When 複合観測候補をそれぞれgit-dependencyとして判定する
    Then 3条件すべての成立だけが合格になり重複する機構観測は判定不能になる
