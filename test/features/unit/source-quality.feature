@unit
Feature: project固有の型品質と汎用開発考慮事項

  Scenario: SCN-UNIT-QUALITY-001 開発考慮事項の欠落を拒否する
    Given 開発考慮事項が3行しかない成果物がある
    When 開発考慮事項conformanceを検証する
    Then 欠落した考慮事項IDを拒否する

  Scenario: SCN-UNIT-QUALITY-002 禁止された型表現を拒否する
    Given projectで禁止された型表現を持つsourceがある
    When source型契約を検証する
    Then source型契約は失敗する

  Scenario: SCN-UNIT-QUALITY-003 repositoryのTypeScript品質選択が成立する
    Given repositoryのproject choiceを読み込む
    When repositoryのsource品質を検証する
    Then TypeScript集約と補助言語対象外証拠を確認できる

  Scenario: SCN-UNIT-QUALITY-004 形式的な適用判断を具体的な証拠として受理しない
    Given 理由と証拠がxだけの開発考慮事項がある
    When 開発考慮事項conformanceを検証する
    Then 形式的な理由と証拠を拒否する

  Scenario: SCN-UNIT-QUALITY-005 大文字拡張子とshebangを含む任意directoryへの補助言語混入も拒否する
    Given 任意directoryに大文字拡張子とshebangのPython sourceを置いたprojectがある
    When repositoryのsource品質を検証する
    Then 大文字拡張子とshebangのPython source再混入を拒否する

  Scenario: SCN-UNIT-QUALITY-006 candidateはproject choice・品質script・runner・ESLint・trusted jobを自己緩和できない
    Given project choiceを乖離させtestとconformanceをtrue、runnerを空、ESLintをoff、trusted jobをfalseへ変更したprojectがある
    When project品質bindingを検証する
    Then project choice乖離と品質scriptの自己緩和を拒否する

  Scenario: SCN-UNIT-QUALITY-007 TypeScript sourceへJSDoc型注釈を残さない
    Given JSDoc型注釈を持つTypeScript sourceがある
    When source型契約を検証する
    Then source型契約は失敗する
