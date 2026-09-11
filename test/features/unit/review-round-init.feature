@unit
Feature: review round雛形と契約の露出

  Scenario: SCN-UNIT-REVINIT-001 round 1の雛形をreview roundが受理する
    Given 初回candidateを持つstagingがある
    When review round --initでround 1の雛形を書く
    Then 雛形をfileへ渡したreview round previewが受理される

  Scenario: SCN-UNIT-REVINIT-002 --initはstagingを書き換えない
    Given 初回candidateを持つstagingがある
    When review round --initでround 1の雛形を書く
    Then staging digestは--init前と同じである

  Scenario: SCN-UNIT-REVINIT-003 round 2の雛形は前roundのblockingとfixedDiffを埋める
    Given round 1をblocker付きで記録し是正commitを積んだstagingがある
    When review round --initで次roundの雛形を書く
    Then 雛形のpreviousBlockingとfixedDiffが実測と一致しpreviewが受理される

  Scenario: SCN-UNIT-REVINIT-004 staging内への--outを拒否する
    Given 初回candidateを持つstagingがある
    When --outをstaging内にしてreview round --initを実行する
    Then staging外を要求するerrorで拒否する

  Scenario: SCN-UNIT-REVINIT-005 既存fileへの--outを拒否する
    Given 初回candidateを持つstagingがある
    When --outを既存fileにしてreview round --initを実行する
    Then 既存fileを上書きしないerrorで拒否する

  Scenario: SCN-UNIT-REVINIT-006 --initと--applyの併用を拒否する
    Given 初回candidateを持つstagingがある
    When --initと--applyを併用してreview round --initを実行する
    Then 併用できないerrorで拒否する

  Scenario: SCN-UNIT-REVINIT-007 stagingを指すsymlink配下への--outを拒否する
    Given 初回candidateを持つstagingがある
    When --outをstagingを指すsymlinkの配下にしてreview round --initを実行する
    Then staging外を要求するerrorで拒否する
    And stagingにfileは作られていない

  Scenario: SCN-UNIT-REVINIT-008 HEADを進めていないsessionへの--initを拒否する
    Given round 1を記録しHEADを進めていないstagingがある
    When review round --initで次roundの雛形を書こうとする
    Then 実Git差分が空であるerrorで拒否し雛形を書かない

  Scenario: SCN-UNIT-REVINIT-009 current HEADと異なる--headの--initを拒否する
    Given 初回candidateを持つstagingがある
    When --headを基点SHAにしてreview round --initを実行する
    Then current HEADと一致しないerrorで拒否し雛形を書かない

  Scenario: SCN-UNIT-REVINIT-010 不足flagは--initの有無に応じて1回で列挙する
    Given 初回candidateを持つstagingがある
    When --stagingだけでreview roundを実行しさらに--initと--stagingだけで実行する
    Then 前者は--fileを後者は--outと--headを1回の診断で列挙する

  Scenario: SCN-UNIT-CLIHELP-010 review roundとpr createのhelpはinputContractを持つ
    Given 配布CLIのusage正本がある
    When review roundとpr createのhelpを取得する
    Then 両方のhelpにdescriptionとexampleを持つinputContractがある

  Scenario: SCN-UNIT-DIAGHINT-001 staging編集後のreview roundは再記録手順を案内する
    Given round 1を記録した後にstagingを編集した状態がある
    When 編集後のstagingでreview roundを実行する
    Then digest不一致の診断はworkflow recordの再実行を案内する

  Scenario: SCN-UNIT-DIAGHINT-002 delivery直前のdigest不一致は再記録手順を案内する
    Given round 1を記録した後にstagingを編集した状態がある
    When delivery直前の再検証を実行する
    Then digest不一致の診断はworkflow recordの再実行を案内する

  Scenario: SCN-UNIT-DIAGHINT-003 cleanup-apply拒否はapproved-digest flagを案内する
    Given 承認済みdigestがpreview digestと一致しないcompletion入力がある
    When completion状態を評価する
    Then cleanup-applyの拒否は--approved-digestを案内する

  Scenario: SCN-UNIT-DOCROW-001 配布文書に暗黙契約の行がある
    Given 配布template・規範文書・step-09 skillがある
    When 配布template・規範文書・step-09 skillを読む
    Then 04にH_impl行、01にQ-08の判定例表、step-09にstaging配置の手順がある

  Scenario: SCN-UNIT-REVINIT-011 検査後の親差し替えでもstaging内へ書かない
    Given 初回candidateを持つstagingがある
    When 親directoryの検査直後にstagingへのsymlinkへ差し替えて雛形を書く
    Then 親差し替えのerrorで拒否しstagingにも差し替え先にもfileを残さない

  Scenario: SCN-UNIT-REVINIT-015 再検証後に親を再差し替えても無関係fileを削除しない
    Given 初回candidateを持つstagingがある
    When 作成後とcleanup直前に親directoryを2回差し替える
    Then 親差し替えを拒否し作成fileを空にして無関係fileを保持する

  Scenario: SCN-UNIT-REVINIT-017 作成後の書込み失敗で部分内容を残さない
    Given 初回candidateを持つstagingがある
    When 排他的作成後に部分書込み失敗を注入する
    Then 書込み失敗を返し作成fileを空にして保持する

  Scenario: SCN-UNIT-REVINIT-018 作成直後のidentity取得失敗も残存を明示する
    Given 初回candidateを持つstagingがある
    When 排他的作成直後にidentity取得失敗を注入する
    Then identity取得失敗を返し作成fileを空にして保持する

  Scenario: SCN-UNIT-REVINIT-012 差し替えが無ければ検査した実体の親へ雛形を書く
    Given 初回candidateを持つstagingがある
    When --outをstaging外を指すsymlink配下にしてreview round --initでround 1の雛形を書く
    Then writtenは利用者指定pathのまま実体の親へ雛形を書く

  Scenario: SCN-UNIT-REVINIT-013 budget-exhaustedのsessionへの--initを拒否する
    Given budget-exhaustedのsessionを持つstagingがある
    When review round --initで次roundの雛形を書こうとする
    Then budget-exhaustedのerrorで拒否し雛形を書かない

  Scenario: SCN-UNIT-REVINIT-016 HEADが同じbudget-exhausted sessionも固有errorで拒否する
    Given budget-exhaustedのsessionを持つstagingがある
    And HEADをbudget-exhausted sessionのcandidateへ戻す
    When review round --initで次roundの雛形を書こうとする
    Then budget-exhaustedのerrorで拒否し雛形を書かない

  Scenario: SCN-UNIT-REVINIT-014 session有りで--invariantだけを渡すと無視を通知する
    Given round 1をblocker付きで記録し是正commitを積んだstagingがある
    When --invariantだけを添えてreview round --initで次roundの雛形を書く
    Then notesにanchorをsessionから写した旨がある

  Scenario: SCN-UNIT-DIAGHINT-004 cleanup-apply拒否の案内は--approved-digestだけである
    Given 承認済みdigestがpreview digestと一致しないcompletion入力がある
    When completion状態を評価する
    Then cleanup-applyの拒否は--approved-digestだけを案内し--report-hashを含まない

  Scenario: SCN-UNIT-DOCROW-002 REQ-WF-009とtemplate 04に注記がある
    Given 配布template・規範文書・step-09 skillがある
    When 配布template・規範文書・step-09 skillを読む
    Then session依存flagの個別報告とDC-UX根拠と発見IDの注記がある
