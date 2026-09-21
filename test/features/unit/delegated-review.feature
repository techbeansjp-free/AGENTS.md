@unit
Feature: 設定されたローカルLLMへのreview委譲

  Scenario: SCN-UNIT-DELEGREVIEW-001 設定が無ければ既存経路を維持する
    Given 委譲reviewer設定の無い隔離projectがある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdisabledでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-002 ローカル設定を共通設定より優先する
    Given 異なるmodelのローカル設定とユーザー共通設定がある
    When Step 3の委譲reviewを実行する
    Then ローカルmodelでStep 3の肯定と敵対の結果を返す

  Scenario: SCN-UNIT-DELEGREVIEW-003 ローカルの明示無効化は共通設定を抑止する
    Given ユーザー共通設定と無効化したローカル設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdisabledでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-004 不正な送信先では起動しない
    Given loopback以外の委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-005 Critical指摘と承認自己申告を進行役確認へ渡す
    Given Step 10の委譲reviewerがCritical指摘と承認を返す
    When Step 10の委譲reviewを実行する
    Then 委譲reviewのCritical候補は進行役確認となりHEADへ固定される

  Scenario: SCN-UNIT-DELEGREVIEW-006 ユーザー共通設定だけでも委譲する
    Given ユーザー共通の委譲reviewer設定だけがある
    When Step 3の委譲reviewを実行する
    Then 共通modelでStep 3の肯定と敵対の結果を返す

  Scenario: SCN-UNIT-DELEGREVIEW-007 現在のHEADと異なる候補へは委譲しない
    Given Step 10の委譲reviewerがCritical指摘と承認を返す
    And 委譲reviewの対象HEADが古い
    When Step 10の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-008 Step 7で設計文書をreviewerへ委譲する
    Given Step 7用の設計文書とローカルreviewer設定がある
    When Step 7の委譲reviewを実行する
    Then 設計文書を含むStep 7の肯定と敵対の結果を返す

  Scenario: SCN-UNIT-DELEGREVIEW-009 差分外タスクの指摘を採用しない
    Given Step 10の委譲reviewerが差分外ファイルのCritical指摘を返す
    When Step 10の委譲reviewを実行する
    Then 差分外の指摘を除外して進行役確認へ渡す

  Scenario: SCN-UNIT-DELEGREVIEW-010 連結worktreeから主worktreeのローカル設定を使う
    Given 主worktreeに設定があり対象stagingは連結worktreeにある
    When Step 3の委譲reviewを実行する
    Then 主worktreeのmodelでStep 3の結果を返す

  Scenario: SCN-UNIT-DELEGREVIEW-011 異なるworktreeのstagingを読まない
    Given rootだけ主worktreeを指定してstagingは連結worktreeにある
    When Step 3の委譲reviewを実行する
    Then 異なるworktreeのstagingを拒否して起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-012 巨大staging文書は収集中に拒否する
    Given 上限超のstaging文書とローカルreviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-013 executor実行中にHEADが進んだら結果を破棄する
    Given Step 10の委譲reviewerがCritical指摘と承認を返す
    And 委譲reviewerの実行中にHEADが進む
    When Step 10の委譲reviewを実行する
    Then 委譲reviewはdegradedでHEAD不一致を理由に返す

  Scenario: SCN-UNIT-DELEGREVIEW-015 chill profileの委譲reviewはLowを隠しEffortを保持する
    Given chill profileのStep 3委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはHighのEffortだけを返す

  Scenario: SCN-UNIT-DELEGREVIEW-016 chill profileでも根拠のないblocked判定を拒否する
    Given chill profileのStep 3委譲reviewerが根拠のないblocked判定を返す
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedで応答不正を返す

  Scenario: SCN-UNIT-DELEGREVIEW-017 chillのStep 10も隠れた候補を第二passで検証する
    Given chill profileのStep 10委譲reviewerがHighとLowの指摘を返す
    When Step 10の委譲reviewを実行する
    Then 隠れたLow候補も第二passのindexへ結線される

  Scenario: SCN-UNIT-DELEGREVIEW-014 Step 10の検証者による却下は候補を消さない
    Given Step 10の委譲reviewerがCritical指摘と承認を返す
    And 投稿前検証者はfindingを却下する
    When Step 10の委譲reviewを実行する
    Then 委譲reviewは初回候補と検証者の却下を進行役確認へ渡す

  Scenario Outline: SCN-UNIT-DELEGREVIEW-018 任意のローカルOllamaモデルを補助reviewへ委譲できる
    Given "<model>" のローカル委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then "<model>" の委譲reviewが起動し進行役用の結果を返す

    Examples:
      | model |
      | qwen3.8:27b |
      | gemma3:27b |
      | gpt-oss:20b |
      | example/model:tag |

  Scenario: SCN-UNIT-DELEGREVIEW-019 空のmodel名は起動前に拒否する
    Given 空白のみのmodel識別子の委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-020 未登録providerは起動前に拒否する
    Given 未登録providerの委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-021 新tagをStep 7の設計reviewにも使える
    Given Step 7用の設計文書とローカルreviewer設定がある
    And 委譲modelをqwen3.8へ変更する
    When Step 7の委譲reviewを実行する
    Then qwen3.8でStep 7の設計reviewを返す

  Scenario: SCN-UNIT-DELEGREVIEW-022 新tagをStep 10の差分reviewにも使える
    Given Step 10の委譲reviewerがCritical指摘と承認を返す
    And 委譲modelをqwen3.8へ変更する
    When Step 10の委譲reviewを実行する
    Then qwen3.8でStep 10の候補を進行役へ返す

  Scenario: SCN-UNIT-DELEGREVIEW-023 将来登録された非Ollama providerも個人設定では拒否する
    Given 別providerをreviewer registryへ登録した個人設定がある
    When Step 3の委譲reviewを実行する
    Then 登録済みの非Ollama providerを起動前に拒否する

  Scenario: SCN-UNIT-DELEGREVIEW-024 過大なmodel名は起動前に拒否する
    Given 上限を超えるmodel識別子の委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない

  Scenario: SCN-UNIT-DELEGREVIEW-025 Unicode制御文字を含むmodel名は起動前に拒否する
    Given C1制御文字を含むmodel識別子の委譲reviewer設定がある
    When Step 3の委譲reviewを実行する
    Then 委譲reviewはdegradedでexecutorを起動しない
