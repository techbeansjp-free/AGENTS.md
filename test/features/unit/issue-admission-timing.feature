@unit
Feature: 起票時点の規律と計画単位

  Scenario: SCN-UNIT-ADMIT-001 規範文書が起票時点の条件を耐久トラッカーの目的から導く
    Given 配布される開発ワークフローの規範文書がある
    When 起票時点と計画単位の節を読み取る
    Then canonical Issueを作成してよい条件と別セッションからの再開への導出が同じ節にある

  Scenario: SCN-UNIT-ADMIT-002 規範文書が外部由来事象を対象外として列挙する
    Given 配布される開発ワークフローの規範文書がある
    When 起票時点と計画単位の節を読み取る
    Then 外部由来事象を規律の対象外とする列挙がある

  Scenario: SCN-UNIT-ADMIT-003 規範文書が計画期間の既定と変更可能性を持つ
    Given 配布される開発ワークフローの規範文書がある
    When 起票時点と計画単位の節を読み取る
    Then 既定を1週間とし利用プロジェクトが変更できることが同じ節にある

  Scenario: SCN-UNIT-ADMIT-004 規範文書が計画期間を分割単位に使わないと述べる
    Given 配布される開発ワークフローの規範文書がある
    When 起票時点と計画単位の節を読み取る
    Then 計画単位をIssue分割単位に使わないことが成果物の結合度と結び付けてある

  Scenario: SCN-UNIT-ADMIT-005 Step 0のskill契約から規律へ到達する
    Given 配布されるStep 0のskill契約がある
    When 起票時点の規律への相対リンクを解決する
    Then 解決先のファイルに規律の節見出しがある

  Scenario: SCN-UNIT-ADMIT-006 計画単位テンプレートが必須欄を持つ
    Given 配布される計画単位テンプレートがある
    When 必須欄を読み取る
    Then MVPと完了条件と対象外とタスク表と依存の5欄がある
