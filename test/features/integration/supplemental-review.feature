@integration
Feature: 補助レビューのOllama実行と信頼境界

  Scenario: SCN-SUPPL-004 staging内のID不整合を検出する
    Given staging内の文書が同じIDに異なる内容を割り当てている
    When 補助レビューCLI(staging対象)を実行する
    Then 指摘一覧に当該IDの不整合が含まれる

  Scenario: SCN-SUPPL-005 Ollamaから構造化された指摘を取得する
    Given Ollamaがlocalhostで起動しており、収集済みの対象がある
    When 補助レビューCLIの送信処理を行う
    Then file・該当箇所・内容・重大度を持つ指摘一覧を受け取る

  Scenario: SCN-SUPPL-006 Ollama以外への通信が発生しない
    Given endpointがlocalhost以外を指すよう設定されている
    When 補助レビューCLIを実行する
    Then 送信は行われずdegradedを返す

  Scenario: SCN-SUPPL-007 Ollama未起動時は既存実施を妨げない
    Given Ollamaが起動していない
    When 補助レビューCLIを実行する
    Then CLIはdegradedを返し異常終了しない
