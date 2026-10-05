@integration
Feature: 常時観測を廃止して開発操作を停止させない
  旧host登録は互換入口で正常終了し、更新はASC所有登録だけを削除する。

  Scenario: SCN-INT-LIFERETIRE-001 残留記録があっても観測と拒否を行わない
    Given 常時観測を廃止したASCを検証する
    When 廃止hookと旧登録の移行を状態異常込みで検証する
    Then 旧記録を変更せず全操作を許可し利用者設定を保持する
