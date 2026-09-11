@unit @review-artifact-validation
Feature: Markdown review artifactの構造検証
  レビュアーは承認を生成せず、監査前に構造欠陥を検出する。

  Scenario: SCN-UNIT-REVARTVAL-001 正しいartifactをvalidと判定する
    Given 構造が正しいMarkdown review artifactがある
    When Markdown review artifactの構造を検証する
    Then 診断なしでartifact構造をvalidと判定する

  Scenario: SCN-UNIT-REVARTVAL-002 identity欠陥に行番号と期待形式を含める
    Given 不正形式と重複したidentity行を持つreview artifactがある
    When Markdown review artifactの構造を検証する
    Then すべてのidentity診断に行番号と期待形式がある

  Scenario: SCN-UNIT-REVARTVAL-003 必須sectionと配布物影響の欠陥を集約する
    Given section不足と曖昧な配布物影響を持つreview artifactがある
    When Markdown review artifactの構造を検証する
    Then sectionと配布物影響の診断をまとめて返す
