@integration
Feature: managed asset recordを既存entryの置換なしで公開する

  Scenario: SCN-INT-LIFECYCLE-045 公開直前のsymlink挿入をno-replaceで拒否する
    Given managed record公開検証用の隔離directoryがある
    When 完全書込み後のlink直前にsymlinkを挿入する
    Then symlink entryと参照先を保持し一時fileを残さない

  Scenario: SCN-INT-LIFECYCLE-046 部分書込みが失敗してもrecordを公開しない
    Given managed record公開検証用の隔離directoryがある
    When managed recordの一時書込みを途中で失敗させる
    Then 不完全なrecordと一時fileを残さない

  Scenario: SCN-INT-LIFECYCLE-047 既存recordからの連続更新は不変snapshotを連鎖する
    Given managed record公開検証用の隔離directoryがある
    When install後にupdateを2回適用する
    Then 旧recordは不変でsnapshotを2件追加しdoctorとdeleteが成立する

  Scenario: SCN-INT-LIFECYCLE-048 snapshotの改ざんは読み取り時に拒否する
    Given managed record公開検証用の隔離directoryがある
    When installとupdate後にsnapshotの内容を改ざんする
    Then doctorは不正snapshotを報告しupdateは資産を変更しない

  Scenario: SCN-INT-LIFECYCLE-049 hardlink非対応では資産変更前に停止する
    Given managed record公開検証用の隔離directoryがある
    When hardlinkを利用できない状態でinstallを適用する
    Then recordとpackage資産は配置されない

  Scenario: SCN-INT-LIFECYCLE-050 更新先snapshotにsymlinkが現れても置換しない
    Given managed record公開検証用の隔離directoryがある
    When install後のsnapshot公開直前にsymlinkを挿入する
    Then snapshotのsymlink entryと参照先を保持する

  Scenario: SCN-INT-LIFECYCLE-051 未接続snapshotを古いrecordへ降格しない
    Given managed record公開検証用の隔離directoryがある
    When install後に未接続snapshotを置く
    Then doctorとupdateは不正な連鎖を拒否する

  Scenario: SCN-INT-LIFECYCLE-052 snapshotだけが残った場合はrecord不在へ降格しない
    Given managed record公開検証用の隔離directoryがある
    When snapshot公開後に旧anchorだけを失う
    Then doctorは欠落した旧anchorを報告しrecoverも資産を変更しない

  Scenario: SCN-INT-LIFECYCLE-053 中断したhardlink probeは次回更新を塞がない
    Given managed record公開検証用の隔離directoryがある
    When install後のsnapshot directoryに中断したprobeのfileが残る
    Then updateとdoctorは一意のsnapshot連鎖を使える

  Scenario: SCN-INT-LIFECYCLE-054 同じ親への並行更新は先着1件だけ公開する
    Given managed record公開検証用の隔離directoryがある
    When 同じ親へ2つのupdateが競合する
    Then 先着のsnapshotだけが残りdoctorは健全である

  Scenario: SCN-INT-LIFECYCLE-055 hardlink確認probeの競合entryを消さない
    Given managed record公開検証用の隔離directoryがある
    When hardlink確認の公開直前に別のsymlinkを挿入する
    Then 競合したprobe entryと参照先は保持される

  Scenario: SCN-INT-LIFECYCLE-056 途中失敗後のlockを保持し次の適用を止める
    Given managed record公開検証用の隔離directoryがある
    When 資産処理後のsnapshot公開が失敗する
    Then 中断lockが残りdoctorと次の適用を停止する

  Scenario: SCN-INT-LIFECYCLE-057 snapshot配置先だけがhardlink非対応なら資産変更前に止める
    Given managed record公開検証用の隔離directoryがある
    When snapshot directoryだけでhardlinkを拒否する
    Then 不足資産を配置せず変更lockを残さない
