@unit @evidence-reanchor
Feature: rebase後の証跡再固定を内容等価性で受理する

  Scenario: SCN-UNIT-REANCHOR-001 等価なrebaseで再固定記録が1件積まれる
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定を適用する
    Then 再固定chainは1件伸び実効HEADは新headになる

  Scenario: SCN-UNIT-REANCHOR-002 追記後も既存の耐久stateが1 byteも変わらない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定を適用する
    Then delivery stateとjournalは1 byteも変わらない

  Scenario: SCN-UNIT-REANCHOR-003 内容が変わったrebaseを拒否する
    Given 固定済みPR identityを持つstagingと内容が変わったrebaseがある
    When 再固定を適用する
    Then 再固定は拒否され両側のdiff digestが理由に含まれる

  Scenario: SCN-UNIT-REANCHOR-004 連鎖条件を満たさない記録を実効HEADの導出に使わない
    Given 連鎖条件を満たさない再固定chainがある
    When 実効HEADを導出する
    Then 実効HEADは固定済み記録headのままになる

  Scenario: SCN-UNIT-REANCHOR-005 delivery stateが無ければpr reanchorを拒否する
    Given delivery stateを持たないstagingがある
    When delivery層の再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-006 delivery stateがあればreview reanchorを拒否する
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When review層の再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-007 収束判定が実効HEADと照合する
    Given 収束済みreview sessionと等価なrebaseがある
    When review層の再固定を適用する
    Then 収束判定は新headと一致する

  Scenario: SCN-UNIT-REANCHOR-008 providerを観測できない場合に正常と断定しない
    Given 実効HEADを持つstagingとproviderを観測できない環境がある
    When 到達性を判定する
    Then 到達性はunverifiableになる

  Scenario: SCN-UNIT-REANCHOR-009 再固定記録が無い既存stateで判定が変わらない
    Given 再固定記録を持たないstagingがある
    When 実効HEADを導出する
    Then 実効HEADは固定済み記録headのままになる

  Scenario: SCN-UNIT-REANCHOR-010 file modeだけが変わったrebaseを等価と判定しない
    Given 固定済みPR identityを持つstagingとfile modeだけが変わったrebaseがある
    When 再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-011 収束していないsessionのreview reanchorを拒否する
    Given 収束していないreview sessionと等価なrebaseがある
    When review層の再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-012 旧headと新headが同一の再固定を拒否する
    Given 固定済みPR identityを持つstagingと移動していないheadがある
    When 再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-013 SHAを解決できない入力を拒否する
    Given 固定済みPR identityを持つstagingと解決できないSHAがある
    When 再固定を適用する
    Then 再固定は拒否される

  Scenario: SCN-UNIT-REANCHOR-014 step11-recorded以外の状態で両方の再固定を拒否する
    Given delivery stateがstep11-recorded以外のstagingがある
    When 両方の再固定を適用する
    Then どちらも拒否され復旧経路が案内される

  Scenario: SCN-UNIT-REANCHOR-015 同一の再固定を再実行しても追記しない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定を二回適用する
    Then 再固定chainは1件のままになる

  Scenario: SCN-UNIT-REANCHOR-016 旧baseを引数で受け取らない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定の入力契約を調べる
    Then 旧baseと旧headを受け取る引数が存在しない

  Scenario: SCN-UNIT-REANCHOR-017 実効HEADがPR headの祖先でなければrewrittenになる
    Given 実効HEADがPR headの祖先でないstagingがある
    When 到達性を判定する
    Then 到達性はrewrittenになる

  Scenario: SCN-UNIT-REANCHOR-018 成立した再固定の記録時刻を実効HEADとともに返す
    Given 成立する再固定chainがある
    When 実効HEADを導出する
    Then 実効HEADの再固定時刻を返す

  Scenario: SCN-UNIT-REANCHOR-019 再固定が無ければ記録時刻を返さない
    Given 再固定記録を持たないstagingがある
    When 実効HEADを導出する
    Then 再固定時刻を返さない

  Scenario: SCN-UNIT-REANCHOR-020 連鎖しない記録の時刻を採用しない
    Given 連鎖条件を満たさない再固定chainがある
    When 実効HEADを導出する
    Then 再固定時刻を返さない

  Scenario: SCN-UNIT-REANCHOR-021 SHA行だけを更新したrebaseを再固定できる
    Given SHA行だけを更新したrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定chainは1件伸び実効HEADは新headになる

  Scenario: SCN-UNIT-REANCHOR-022 SHA行以外を書き換えたrebaseを拒否する
    Given SHA行に加えて判定も書き換えたrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"artifact-body-changed"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-023 識別情報の欄が重複する証跡を拒否する
    Given 識別情報の欄を重複させたrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"identity-unresolvable"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-024 H_implの宣言が構造と一致しない証跡を拒否する
    Given H_implの宣言が構造と一致しないrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"boundary-mismatch"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-025 実装の内容まで変わったrebaseを拒否する
    Given 実装の内容まで変わったrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"implementation-diff-changed"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-026 識別情報の節が一意でない証跡を拒否する
    Given 識別情報の節が2つあるrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"identity-unresolvable"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-027 比較基点の宣言が再固定の基点と違う証跡を拒否する
    Given 比較基点の宣言が再固定の基点と違うrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"base-mismatch"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-028 artifactのpathが変わったrebaseを拒否する
    Given artifactのpathが変わったrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"artifact-path-changed"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-029 識別情報の見出しが本文中にしかない証跡を拒否する
    Given 識別情報の見出しが本文中にしかないrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"identity-unresolvable"を理由に拒否される

  Scenario: SCN-UNIT-REANCHOR-030 存在しないH_implを宣言した証跡を拒否する
    Given 存在しないH_implを宣言したrebase後のreview証跡がある
    When 再固定を適用する
    Then 再固定は"boundary-mismatch"を理由に拒否される
