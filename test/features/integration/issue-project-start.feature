@integration
Feature: trusted GitHub Projectでcanonical Issueの着手を同期する

  Scenario: SCN-INT-GHPROJ-001 未所属Issueを追加してIn progressをread-backする
    Given trusted Issue Projectと未所属Issueのfixtureがある
    When Issue着手を承認して実行する
    Then Project追加とStatus更新が各1回行われstartedになる

  Scenario: SCN-INT-GHPROJ-002 既に着手済みならmutationを送らない
    Given trusted Issue Projectで既に着手済みのfixtureがある
    When Issue着手を承認して実行する
    Then mutationなしでstartedになる

  Scenario: SCN-E2E-GHPROJ-003 Project未構成なら既存workflowを維持する
    Given trusted Issue Projectが未構成のfixtureがある
    When Issue着手をpreviewする
    Then providerを呼ばずnot-configuredになる

  Scenario: SCN-INT-GHPROJ-004 Status optionが曖昧ならwriteを拒否する
    Given trusted Issue ProjectのStatus optionが重複したfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-005 Status失敗後は既存itemから再開する
    Given trusted Issue ProjectでStatus更新が一度失敗するfixtureがある
    When Issue着手を承認して再開する
    Then Project追加を再送せずStatusだけを完了する

  Scenario: SCN-E2E-GHPROJ-006 previewは予定を返してwriteしない
    Given trusted Issue Projectと未所属Issueのfixtureがある
    When Issue着手をpreviewする
    Then add-item予定を返してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-007 candidateだけの設定は着手authorityにならない
    Given candidateだけにIssue Projectを設定したfixtureがある
    When Issue着手を承認して実行する
    Then providerを呼ばずnot-configuredになる

  Scenario: SCN-INT-GHPROJ-008 Project itemのpaginationが未完了ならwriteしない
    Given trusted Issue Projectのitem観測が未完了なfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-009 不正なtrusted設定はproviderより前に拒否する
    Given trusted Issue Project設定が不正なfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してprovider callは0回である

  Scenario: SCN-INT-GHPROJ-010 同じProjectのitemが重複していればwriteしない
    Given trusted Issue Projectのitemが重複したfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-011 provider default tipとlocal trusted commitが違えばwriteしない
    Given provider default tipがlocal trusted commitと不一致のfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-012 Project write authorityがなければwriteしない
    Given trusted Issue Projectのwrite authorityがないfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である

  Scenario: SCN-INT-GHPROJ-013 symlink祖先または非直下stagingを拒否する
    Given Issue stagingではない入れ子directoryのfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してprovider callは0回である

  Scenario: SCN-INT-GHPROJ-014 inspect後にitemが出現したらwriteしない
    Given write直前の再観測でitemが出現するfixtureがある
    When Issue着手を承認して実行する
    Then 非0終了してProject writeは0回である
