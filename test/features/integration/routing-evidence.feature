@integration @provider-routing
Feature: routing evidenceの不変性と保持
  実装開始前の証拠と終了・状態・削除の追記記録を分離し、隔離storeだけで安全性を検証する。

  Scenario: SCN-INT-ROUTING-003 routing evidenceは別Issueへ再利用できない
    Given Issueとscopeへ拘束するrouting evidence入力がある
    When routing evidenceを隔離storeへ発行する
    Then routing evidenceは必須拘束項目と開始状態issuedを持つ
    And 同じ識別子の再発行は排他的に拒否される
    When routing evidenceへcompletion recordを追記する
    Then routing evidence本体は発行時から変化しない
    And 別Issueまたは別scopeへの再利用は拒否される

  Scenario: SCN-INT-ROUTING-004 保持方針が未設定なら保存も削除もしない
    Given 隔離した一時evidence storeと完全な保持方針がある
    When store rootまたは保持方針が未設定のまま保存と削除previewを試みる
    Then 保存も削除も行われず拒否される
    When 保存許可list外の秘密fieldと安全でない識別子で保存を試みる
    Then 秘密とpath脱出を含む記録は保存されない
    When 期限超過routing evidenceを発行して削除previewを実行する
    Then previewは削除せず対象id一覧とダイジェストを返す
    When tombstone耐久化後の物理削除を失敗させてから同じ削除を再開する
    Then auditとtombstoneから冪等に削除を完了できる
    When Issue単位件数が上限ちょうどのstoreをpreviewする
    Then oldest firstのrotation対象が1件提示される

  Scenario: SCN-INT-ROUTING-009 head変更はrouting evidenceを失効させない
    Given routing evidenceとそのheadに依存するcompletion recordがある
    When implementation headを変更して有効性を評価する
    Then routing evidenceは有効のままでcompletion recordだけが失効する
    When routing evidenceへinvalidated状態recordを追記する
    Then 有効状態は最後の状態recordから算出される
    And routing evidence状態とcompletion終了状態の集合は重ならない
