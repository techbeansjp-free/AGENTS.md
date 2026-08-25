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
