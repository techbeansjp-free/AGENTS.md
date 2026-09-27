@unit
Feature: 派生した欠陥の是正原則とASC本体規律の適用対象

  Scenario: SCN-UNIT-DERIVEDSCOPE-001 派生した欠陥は同じIssue・同じPRで直す原則がある
    Given 配布される開発ワークフローの規範文書の派生した欠陥の是正原則節がある
    When 節の内容を確認する
    Then 節には発見時期によらず同じIssue・同じPRで直す原則がある
    And 節には閉じた6条件の分離基準がある
    And round数は分離理由に含まれない
    And 節には収束解除と未解決blocker0件による終了条件がある

  Scenario: SCN-UNIT-DERIVEDSCOPE-002 ASC本体規律の適用対象が利用projectに限定されている
    Given 配布される開発ワークフローの規範文書のASC本体是正禁止節がある
    When 節の内容を確認する
    Then 節の適用対象が利用projectでの作業だと読み取れる
    And ASC本体repository自身には適用しないと書かれている

  Scenario: SCN-UNIT-DERIVEDSCOPE-003 Step 9・10 skillが新原則を参照する
    Given 配布されるStep 9のskill契約がある
    When 節の内容を確認する
    Then 派生した欠陥の是正原則への参照がある
    Given 配布されるStep 10のskill契約がある
    When 節の内容を確認する
    Then 派生した欠陥の是正原則への参照がある
