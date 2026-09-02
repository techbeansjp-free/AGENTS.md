@integration @merge-method-policy
Feature: policy検証とPR merge境界で危険なmerge方式を扱う

  Scenario: SCN-INT-MERGEMETHOD-001 policy validateが長命branchのsquash単独指定を警告する
    Given 長命branchへsquashだけを解決する有効なpolicy fileがある
    When policy validate CLIを実行する
    Then policy validate結果にwarn診断がある

  Scenario: SCN-INT-MERGEMETHOD-002 警告だけでは終了コードを非0にしない
    Given 長命branchへsquashだけを解決する有効なpolicy fileがある
    When policy validate CLIを実行する
    Then policy validate CLIの終了コードは0である

  Scenario: SCN-INT-MERGEMETHOD-003 pr merge経路が長命branch同士のsquashを拒否する
    Given 長命branch同士のsquashを許可したtrusted policyとGitHub観測がある
    When pr merge経路で長命branch同士のsquashを認可する
    Then pr merge経路はrule ID付きで拒否し外部mergeを呼ばない

  Scenario: SCN-INT-MERGEMETHOD-004 短命branchのglobだけを列挙したpolicyは長命branch警告を出さない
    Given 短命branchのglobだけを列挙しsquashだけを許可したpolicy fileがある
    When policy validate CLIを実行する
    Then policy validate結果に長命branch警告がない

  Scenario: SCN-INT-MERGEMETHOD-005 globと具体名が混在する場合は具体名だけをbase候補にする
    Given globと具体名を混在させsquashだけを許可したpolicy fileがある
    When policy validate CLIを実行する
    Then 長命branch警告のbase候補は具体名だけになる

  Scenario: SCN-INT-MERGEMETHOD-006 除外後のbase候補が1件なら長命branch警告を出さない
    Given globと具体名1件を列挙しsquashだけを許可したpolicy fileがある
    When policy validate CLIを実行する
    Then policy validate結果に長命branch警告がない
