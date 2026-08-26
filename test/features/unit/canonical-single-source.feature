@unit
Feature: 契約の正本複製を検出し参照へ置換させる

  Scenario: SCN-UNIT-CANON-001 正本以外での規約記述に参照が無ければ違反とする
    Given 契約正本registryと正本以外の複製fileがある
    When 正本複製を検査する
    Then 検査は違反を報告する

  Scenario: SCN-UNIT-CANON-002 診断が複製箇所と正本pathと置換方針を含む
    Given 契約正本registryと正本以外の複製fileがある
    When 正本複製を検査する
    Then 診断は複製箇所と契約IDと正本pathと置換方針を含む

  Scenario: SCN-UNIT-CANON-003 正本への参照があれば適合とする
    Given 検出tokenと正本へのMarkdown linkを持つfileがある
    When 正本複製を検査する
    Then 検査は適合を報告する

  Scenario: SCN-UNIT-CANON-004 正本自身は違反にしない
    Given 正本自身が検出tokenを含む
    When 正本複製を検査する
    Then 検査は適合を報告する

  Scenario: SCN-UNIT-CANON-005 registryへの追加で検出対象が増える
    Given 契約entryを1件追加したregistryがある
    When 正本複製を検査する
    Then 追加した契約の違反を報告する

  Scenario: SCN-UNIT-CANON-006 registryが不正ならfail-closedで拒否する
    Given 正本pathが実在しないregistryがある
    When 契約正本registryを検証する
    Then 検証は理由付きで拒否する

  Scenario: SCN-UNIT-CANON-007 未登録の語は違反にしない
    Given registryへ未登録の語だけを含むfileがある
    When 正本複製を検査する
    Then 検査は適合を報告する

  Scenario: SCN-UNIT-CANON-008 記述内容が正本と異なっても参照があれば適合とする
    Given 正本と異なる記述と正本へのMarkdown linkを持つfileがある
    When 正本複製を検査する
    Then 検査は適合を報告する

  Scenario: SCN-UNIT-CANON-009 path言及だけでは参照として認めない
    Given 検出tokenを含み正本pathを言及するがMarkdown linkを持たないfileがある
    When 正本複製を検査する
    Then 検査は違反を報告する

  Scenario: SCN-UNIT-CANON-010 契約が未登録なら違反0件とする
    Given contractsが空のregistryがある
    When 正本複製を検査する
    Then 検査は違反0件の適合を報告する

  Scenario: SCN-UNIT-CANON-011 読めないfileは違反ではなく走査errorとする
    Given 読み取れない走査対象fileがある
    When 正本複製を検査する
    Then 検査は走査errorを報告し違反にしない

  Scenario: SCN-UNIT-CANON-012 正本pathが規範宣言location外なら拒否する
    Given 正本pathが規範宣言location外を指すregistryがある
    When 契約正本registryを検証する
    Then 検証は理由付きで拒否する

  Scenario: SCN-UNIT-CANON-013 契約IDが重複したregistryを拒否する
    Given 契約IDが重複したregistryがある
    When 契約正本registryを検証する
    Then 検証は理由付きで拒否する

  Scenario: SCN-UNIT-CANON-014 走査対象に証跡と一時ステージングと実装を含めない
    Given 証跡と一時ステージングと実装を含むpath一覧がある
    When 走査対象file集合を構築する
    Then 集合は規範宣言locationのMarkdownだけを含む

  Scenario: SCN-UNIT-CANON-015 anchor付きやpercent encodeなどのlink記法も参照として認める
    Given 正本へのlinkをanchor付きとtitle付きと山括弧とpercent encodeと参照定義で書いたfileがある
    When 正本複製を検査する
    Then 検査は適合を報告する

  Scenario: SCN-UNIT-CANON-016 registryのtop-levelに未知fieldがあれば拒否する
    Given top-levelに未知fieldがあるregistryがある
    When 契約正本registryを検証する
    Then 検証は理由付きで拒否する

  Scenario: SCN-UNIT-CANON-017 contractIdが規約外なら要求するprefixを示して拒否する
    Given contractIdが規約外のregistryがある
    When 契約正本registryを検証する
    Then 拒否理由は要求するcontractId prefixを示す

  Scenario: SCN-UNIT-CANON-018 走査対象locationは規範宣言location3箇所に限る
    Given 実装の走査location一覧がある
    When 走査locationを確認する
    Then locationは規範宣言location3箇所に一致する
