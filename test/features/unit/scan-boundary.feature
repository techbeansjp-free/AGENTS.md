@unit @scan-boundary
Feature: 除外述語の被覆の観測
  登録済みの除外述語がどの生成物を除外するかを観測し、どの述語にも掛からない生成物を差分として返す。

  Scenario: SCN-UNIT-SCANBND-001 観測は述語ごとの除外pathと理由codeを返し判定不能な入力を除外側へ倒さない
    Given 除外述語の被覆の観測入力がある
    When 除外述語の被覆を観測する
    Then 述語ごとに所有gateと適用範囲と除外pathと理由codeと件数が返る
    And 判定不能なpathは除外にも被覆にも現れず理由codeで報告される

  Scenario: SCN-UNIT-SCANBND-002 述語が覆う生成物では被覆差分が0になる
    Given 登録済み述語が覆う生成物を足した観測と足さない観測がある
    When 2つの観測を比較する
    Then 走査差分は0より大きく被覆差分は0になる

  Scenario: SCN-UNIT-SCANBND-003 どの述語にも掛からない生成物で被覆差分が検出される
    Given どの述語にも掛からない生成物を足した観測と足さない観測がある
    When 2つの観測を比較する
    Then 被覆差分が0より大きく寄与pathが名指しされる

  Scenario: SCN-UNIT-SCANBND-004 期待した述語の欠落と不完全な観測は成功へ倒れない
    Given 期待した述語を供給元から落とした観測入力がある
    When 除外述語の被覆を観測する
    Then 述語の欠落と述語未公開と重複登録が別の理由codeで報告される
    And 不完全な観測どうしの比較は拒否される

  Scenario: SCN-UNIT-SCANBND-005 報告scriptは不完全な観測を非0終了で返す
    Given ignored生成物を持つ一時repositoryがある
    When 報告scriptを実行する
    Then 述語未公開が報告され終了値が非0になる
