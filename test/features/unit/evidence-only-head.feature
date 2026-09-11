@unit
Feature: artifact-onlyのHEAD移動の受理

  Scenario: SCN-UNIT-EVIDHEAD-001 artifact commit後のH_finalでStep 10のsession検査が通る
    Given 収束したsessionの後にartifact 1 fileだけをcommitしたstagingがある
    When H_finalでconverged session検査とbinding検査を行う
    Then 両方が受理される

  Scenario: SCN-UNIT-EVIDHEAD-002 H_finalでのworkflow record --step=10はbindingにH_implを書く
    Given 収束したsessionの後にartifact 1 fileだけをcommitしたstagingがある
    When CLIでStep 10を記録する
    Then 記録は成功しbinding.headShaはsessionのcandidate HEADである

  Scenario: SCN-UNIT-EVIDHEAD-003 artifactとsrcの2 pathは拒否する
    Given 収束したsessionの後にartifactとsrcをcommitしたstagingがある
    When H_finalでconverged session検査を行う
    Then candidate HEADがcurrent HEADと一致しないerrorで拒否する

  Scenario: SCN-UNIT-EVIDHEAD-004 allowlist外の1 pathは拒否する
    Given 収束したsessionの後にsrc 1 fileだけをcommitしたstagingがある
    When H_finalでconverged session検査を行う
    Then candidate HEADがcurrent HEADと一致しないerrorで拒否する

  Scenario: SCN-UNIT-EVIDHEAD-005 空差分のHEAD移動は拒否する
    Given 収束したsessionの後に空commitを積んだstagingがある
    When H_finalでconverged session検査を行う
    Then candidate HEADがcurrent HEADと一致しないerrorで拒否する

  Scenario: SCN-UNIT-EVIDHEAD-006 非ancestorのHEADは拒否する
    Given 収束したsessionの後に別branchでartifactをcommitしたstagingがある
    When H_finalでconverged session検査を行う
    Then candidate HEADがcurrent HEADと一致しないerrorで拒否する

  Scenario: SCN-UNIT-EVIDHEAD-007 規範文書とskillが取り直し不要を述べる
    Given 規範文書01とstep-10 skillがある
    When 規範文書01とstep-10 skillを読む
    Then artifact 1 fileのcommitに取り直しroundは要らない旨がある
