@unit
Feature: project固有rule台帳の単体契約

  Scenario: SCN-UNIT-LEDGER-001 全project ruleがID・目的・所有者・scope・enforcement・証拠・変更authorityを持つ
    Given 必須fieldだけのlegacy ruleと変更authorityを持つ拡張ruleがある
    When project ruleの構造を検証する
    Then 後方互換を保ち拡張ruleの変更authorityも検証される

  Scenario: SCN-UNIT-LEDGER-002 runtimeにもCIにも現れないruleをorphanとして拒否する
    Given runtimeにもCIにもIDがないrule coverage入力がある
    When rule coverage matrixを構築する
    Then 未検証ruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-003 規範文書にあるがpolicy未定義のrule IDを拒否する
    Given policy未定義のrule IDを持つ規範文書がある
    When rule coverage matrixを構築する
    Then 規範だけのruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-004 CIにだけ現れる暗黙ruleを拒否する
    Given policy未定義のrule IDを持つCIがある
    When rule coverage matrixを構築する
    Then CIだけの暗黙ruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-005 連番prefixと日本語名を持たない固定Markdownを拒否する
    Given 連番または日本語名を欠く固定Markdown名がある
    When 固定Markdown名を検証する
    Then すべての不正な固定Markdown名が拒否される

  Scenario: SCN-UNIT-LEDGER-006 契約上固定された名称だけを命名例外として許可する
    Given 契約上の固定名称と未知の英語Markdown名がある
    When 固定Markdown名を検証する
    Then 明示された固定名称だけが許可される

  Scenario: SCN-UNIT-LEDGER-007 rule metadataの省略と非空文字列を許可し不正値を拒否する
    Given metadataを省略したruleと有効・空文字列・非文字列のmetadataを持つruleがある
    When runtimeでrule metadataとtrusted policy比較を検証する
    Then metadata省略と有効値だけを許可しmetadata追加を意味変更として拒否しない

  Scenario: SCN-UNIT-LEDGER-008 未提案のtrusted rule削除を拒否しauthorityと先行登録経路を返す
    Given trusted policyのproject ruleを候補側から取り除いた差分がある
    When trusted rule削除の判定結果を読む
    Then 削除を拒否しauthorityと先行登録経路を診断へ返す

  Scenario: SCN-UNIT-LEDGER-009 npm registryへ公開しない強制点の宣言を検査する
    Given privateを持つpackage.jsonと持たないpackage.jsonがある
    When npm公開禁止の強制点を検査する
    Then privateを持つ側だけを受理する
  Scenario: SCN-UNIT-LEDGER-010 trusted提案とraw SHAが一致する完全削除を受理する
    Given trusted fragmentとproject rule廃止提案がある
    When 承認対象のproject ruleを完全削除して比較する
    Then 承認済みrule廃止のIDとpathと両SHAを返す

  Scenario: SCN-UNIT-LEDGER-011 提案を撤回すると完全削除を再び拒否する
    Given trusted fragmentとproject rule廃止提案がある
    When trustedの廃止提案を撤回して削除を比較する
    Then project rule削除をASC-TRUST-001で拒否する

  Scenario: SCN-UNIT-LEDGER-012 candidate側だけの廃止提案では削除を受理しない
    Given trusted fragmentとproject rule廃止提案がある
    When candidate側だけに廃止提案を置いて削除を比較する
    Then project rule削除をASC-TRUST-001で拒否する

  Scenario: SCN-UNIT-LEDGER-013 rawの1byte差と不正提案とsource欠落を拒否する
    Given trusted fragmentとproject rule廃止提案がある
    When 廃止提案とsourceの境界値を比較する
    Then 全不正入力を拒否して観測値またはsource欠落を返す

  Scenario: SCN-UNIT-LEDGER-014 廃止提案を部分弱化へ流用しない
    Given trusted fragmentとproject rule廃止提案がある
    When 提案対象ruleを残して部分弱化する
    Then 部分弱化を拒否して承認済みrule廃止を返さない

  Scenario: SCN-UNIT-LEDGER-015 承認したruleと未承認ruleの便乗削除は全体を拒否する
    Given trusted fragmentとproject rule廃止提案がある
    When 未承認ruleも同時に削除して比較する
    Then 承認済みrule廃止を記録してもpolicy全体を拒否する

  Scenario: SCN-UNIT-LEDGER-016 最後のruleを廃止してもpackage floorとoperation検証を保つ
    Given trusted fragmentとproject rule廃止提案がある
    When 空project inventoryを読みpackage floorへ合成する
    Then package floorを保持し存在しないruleのoperationを拒否して復元できる

  Scenario: SCN-UNIT-LEDGER-017 既存rule差分と提案を持たない比較の結果を保つ
    Given trusted fragmentとproject rule廃止提案がある
    When 既存rule差分を提案の有無で比較する
    Then 追加と部分弱化とmetadataの既存判定は変わらない
