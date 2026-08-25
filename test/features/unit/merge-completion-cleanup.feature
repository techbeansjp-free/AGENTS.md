@unit @wtclean
Feature: merge完了フローを副作用前に安全側へ計画する

  Scenario: SCN-UNIT-WTCLEAN-001 merge未確認とroot更新拒否ではcleanupへ進まない
    Given merge未確認とroot更新拒否の完了入力がある
    When merge完了フローを計画する
    Then cleanup phaseはすべてskippedになる

  Scenario: SCN-UNIT-WTCLEAN-002 cleanup authorityがなければpendingで停止し対象を保持する
    Given cleanup authorityだけがない完了入力がある
    When merge完了フローを計画する
    Then 完了計画はcleanup authority待ちのpendingになる

  Scenario: SCN-UNIT-WTCLEAN-003 digest不一致と不正digestではapplyを拒否する
    Given digest不一致と不正digestの完了入力がある
    When merge完了フローを計画する
    Then cleanup applyは新しいpreviewを要求してrejectedになる

  Scenario: SCN-UNIT-WTCLEAN-004 事後確認の不一致をpartially-completedとして返す
    Given cleanup適用後に事後確認が一致しない完了結果がある
    When merge完了結果を要約する
    Then 完了結果はpartially-completedになる

  Scenario: SCN-UNIT-WTCLEAN-005 prefix一致・大小文字違い・重複・他PR・root外path・symlinkを拒否する
    Given 境界を偽装したworktree cleanup入力がある
    When 偽装されたworktree cleanup対象を計画する
    Then すべての偽装cleanup計画はrejectedになる
