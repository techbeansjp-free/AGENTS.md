@unit
Feature: 実Git差分から影響集合を一度だけ導出し影響を証明できなければ全体へ倒す

  Scenario: SCN-UNIT-IMPACT-001 変更sourceの直接import元とimport先を隣接範囲にし影響featureを選ぶ
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When src/b.tsだけを変更した影響集合を導出する
    Then 影響集合はtargetedで理由を持たない
    And 隣接範囲はsrc/a.tsとsrc/c.tsだけでGraph Evidenceは影響集合digestである
    And 影響featureはstep定義経由と追跡表経由のfeatureを含み無関係featureを含まない

  Scenario: SCN-UNIT-IMPACT-002 全体に効く設定の変更は全体検証へ倒れ理由を名指しする
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When package.jsonとsrc/b.tsを変更した影響集合を導出する
    Then 影響集合はfullで理由に"package.json"を含む
    And fullの影響集合は検証featureと検査を選ばない

  Scenario: SCN-UNIT-IMPACT-003 step定義の変更は全featureで共有されるため全体検証へ倒れる
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When test/steps/a.steps.tsを変更した影響集合を導出する
    Then 影響集合はfullで理由に"test/steps/a.steps.ts"を含む

  Scenario: SCN-UNIT-IMPACT-004 文書だけの変更は形式検査だけを選びspec文書は追跡検査も選ぶ
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When docs/specs/guide.mdだけを変更した影響集合を導出する
    Then 影響集合はtargetedで理由を持たない
    And 影響featureは空で検査はdocs:formatとtrace:checkである

  Scenario: SCN-UNIT-IMPACT-005 step定義が字面で読む文書の変更はそのstep定義を使うfeatureを選ぶ
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When step定義が字面で読むdocs/read.mdだけを変更した影響集合を導出する
    Then 影響集合はtargetedで理由を持たない
    And 影響featureはtest/features/a.featureだけである

  Scenario: SCN-UNIT-IMPACT-006 security関連pathはreviewerへ注意を促すが単独では全体検証にしない
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When src/adapters/merge-gate.tsだけを変更した影響集合を導出する
    Then 影響集合はtargetedで理由を持たない
    And security注意pathはsrc/adapters/merge-gate.tsである

  Scenario: SCN-UNIT-IMPACT-007 検証featureへ到達できない変更sourceは全体検証へ倒れる
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When どこからもimportされないsrc/orphan.tsを変更した影響集合を導出する
    Then 影響集合はfullで理由に"検証featureへ到達できません: src/orphan.ts"を含む

  Scenario: SCN-UNIT-IMPACT-008 意味Graphを構築できない場合は隣接範囲を持たず全体へ倒れる
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When 意味Graphを構築できないままsrc/b.tsの影響集合を導出する
    Then 影響集合はfullで理由に"意味Graphを構築できません"を含む
    And 影響集合はGraph content hashと隣接範囲を持たない

  Scenario: SCN-UNIT-IMPACT-009 build成果物は同時に変わったsourceへ委ね単独の変化は全体へ倒す
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When src/b.tsとdist/src/b.jsを変更した影響集合を導出する
    Then 影響集合はtargetedで理由を持たない
    When dist/src/b.jsだけを変更した影響集合を導出する
    Then 影響集合はfullで理由に"build成果物だけが変化"を含む

  Scenario: SCN-UNIT-IMPACT-010 hookまたはWorldとして全scenarioへ効くfileが影響を受けると全体へ倒れる
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    And test/support/world.tsがsrc/c.tsをimportしWorldを登録する
    When src/c.tsだけを変更した影響集合を導出する
    Then 影響集合はfullで理由に"test/support/world.ts"を含む

  Scenario: SCN-UNIT-IMPACT-011 影響集合digestは本体から決定論的に導出され入力が変われば変わる
    Given import鎖と追跡表とstep定義を持つ意味Graphがある
    When src/b.tsだけを変更した影響集合を2回導出する
    Then 2回の影響集合digestは一致し本体のstable JSONのSHA-256である
    When 差分digestだけを変えて影響集合を導出する
    Then 影響集合digestは変わる

  Scenario: SCN-UNIT-IMPACT-012 feature照合はOutline展開とalternationとoptionalとparameterを解釈し未照合featureを返す
    Given 文字列とregexとtemplateのstep patternを持つ2つのstep定義fileがある
    When Outlineを含むfeatureと未定義stepを含むfeatureを照合する
    Then Outlineのfeatureは2つのstep定義fileへ結び付く
    And 未定義stepを含むfeatureは未照合として返る

  Scenario: SCN-UNIT-IMPACT-013 検証済み隣接範囲の修正起因Highと固定契約違反だけをcurrent blockerにする
    Given 隣接範囲を持つround 2の入力がある
    When 隣接範囲と範囲外のfindingをadmissionへ通す
    Then 隣接範囲の前round blocker起因Highはcurrent blockerになる
    And 隣接範囲の固定Acceptance Criteria違反はcurrent blockerになる
    And 隣接範囲の改善提案と範囲外Highはrecord-onlyである
