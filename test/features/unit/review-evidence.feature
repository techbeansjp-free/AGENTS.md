@unit @review-evidence
Feature: Step 10のreview証跡を収束済みsessionから生成し厳密に読む
  reviewの証明は散文ではなく構造化Evidenceである。証跡はsessionから導出でき、
  手書き・改竄・未収束・自己reviewを受理しない。

  Scenario: SCN-UNIT-REVEVID-001 収束済みsessionから正規証跡を生成し読み戻せる
    Given 2 roundで収束したreview sessionがある
    When review証跡を生成して正規直列化から読み戻す
    Then 読み戻した証跡は生成した証跡と一致しsessionの値を持つ

  Scenario: SCN-UNIT-REVEVID-002 finding IDごとの最終状態だけを持つ
    Given 2 roundで収束したreview sessionがある
    When review証跡を生成して正規直列化から読み戻す
    Then findingは各IDの最終roundの状態であり未解決Critical/Highは空である

  Scenario: SCN-UNIT-REVEVID-003 未知fieldと型違いと不正なSHAを拒否する
    Given 2 roundで収束したreview sessionがある
    When review証跡の構造を1箇所ずつ壊して読む
    Then 壊したすべての証跡をfield名つきで拒否する

  Scenario: SCN-UNIT-REVEVID-004 digest不一致と正規直列化以外のbyte列を拒否する
    Given 2 roundで収束したreview sessionがある
    When review証跡の値を書き換えるか再整形して読む
    Then digest不一致と再整形をそれぞれ拒否する

  Scenario: SCN-UNIT-REVEVID-005 未収束sessionと自己reviewと検証なしから証跡を生成しない
    Given 未解決blockerを持つreview sessionがある
    When 不正な入力でreview証跡を生成する
    Then 未収束と同一identityと検証command欠落をそれぞれ拒否する

  Scenario: SCN-UNIT-REVEVID-006 保存済みsessionとの不一致を検出する
    Given 2 roundで収束したreview sessionがある
    When 別sessionと別独立性モードで証跡を照合する
    Then session・finding・独立性モード・candidate HEADの不一致をすべて報告する

  Scenario: SCN-UNIT-REVEVID-007 再固定の種類ごとに変わってよいfieldだけを除いて比較する
    Given 2 roundで収束したreview sessionがある
    When 比較基点と検証記録をそれぞれ変えた証跡を比較する
    Then rebaseは比較基点とH_implだけを、前進修正は検証記録だけを許す

  Scenario: SCN-UNIT-REVEVID-008 round上限を超える証跡を拒否する
    Given 2 roundで収束したreview sessionがある
    When countedRoundsが上限を超える証跡を読む
    Then round上限超過として拒否する
