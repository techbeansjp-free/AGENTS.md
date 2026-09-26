@unit @verification-run
Feature: verify runの観測記録を厳密に読み証跡の検証欄を導出する
  検証の合格は自己申告ではなく観測である。記録はH_impl・影響集合digest・argv・
  終了値を持ち、証跡の検証欄は記録から導出して記録と照合する。

  Scenario: SCN-UNIT-VERIFYRUN-001 検証記録を封じて読み戻し改竄と不整合を拒否する
    Given 合格した検証記録がある
    When 検証記録を1箇所ずつ壊して読む
    Then 改竄・再整形・未知field・終了値とsignalの不整合・fullへのtargeted・不正なargvをそれぞれ拒否する

  Scenario: SCN-UNIT-VERIFYRUN-002 H_implと影響集合に一致する最新の合格実行だけから検証欄を導く
    Given 合格した検証記録がある
    When 記録の組み合わせごとに検証欄を導出する
    Then 記録なし・影響集合不一致・最新の不合格・scope=full欠落・targetedのfeature欠落を拒否し合格記録だけを導く

  Scenario: SCN-UNIT-VERIFYRUN-003 証跡の検証欄を保存済み記録と照合する
    Given 合格した検証記録がある
    When 検証欄を記録の欠落・不一致・後続の不合格と照合する
    Then 記録と一致する検証欄だけを受理する
