@unit
Feature: Mode判定と入力境界をfail-closedにする
  後から判定理由と攻撃入力への期待結果を理解できるように、各境界を具体例で記述する。

  Scenario: SCN-UNIT-MODE-001 Q-01〜Q-08がすべてtrueかつ根拠付きならquickを選ぶ
    Given Q-01〜Q-08がすべてtrueで、それぞれに根拠がある
    When modeを判定する
    Then 判定結果はquickである
    And 不適格理由は0件である

  Scenario Outline: SCN-UNIT-MODE-002 Q条件が不完全ならfullへ倒す
    Given Q-01〜Q-08がすべてtrueで、それぞれに根拠がある
    And Q-04を<状態>にする
    When modeを判定する
    Then 判定結果はfullである
    And 不適格理由にQ-04が含まれる

    Examples:
      | 状態 |
      | false |
      | unknown |
      | 根拠なし |
      | 未回答 |

  Scenario: SCN-UNIT-MODE-003 quick中に公開APIとdependency変更を検出したらfullへ単調昇格する
    Given quickとして開始した変更fileが"src/public-api.ts,package.json"である
    When quick不適格要因を検査する
    Then 不適格要因は"public-api,dependency"である

  Scenario: SCN-UNIT-MODE-004 文書だけの変更に不適格要因を捏造しない
    Given quickとして開始した変更fileが"docs/README.md"である
    When quick不適格要因を検査する
    Then 不適格要因は空である

  Scenario Outline: SCN-UNIT-SEC-001 path構文やUnicode制御文字をtitleとして拒否する
    Given issue titleが<入力>である
    When 安全なslugへ変換する
    Then title検証は失敗する

    Examples:
      | 入力 |
      | "../escape" |
      | ".." |
      | "/absolute" |
      | "a\\..\\b" |
      | "ok<NUL>bad" |
      | "abc<RLO>txt" |

  Scenario: SCN-UNIT-SEC-002 安全な日本語titleはNFC正規化して保持する
    Given issue titleが"仕様 改善"である
    When 安全なslugへ変換する
    Then slugは"仕様-改善"である

  Scenario: SCN-UNIT-SEC-003 字句上のpath traversalを拒否する
    Given containment rootと"../secret"がある
    When contained pathを解決する
    Then path検証は失敗する

  Scenario: SCN-UNIT-SEC-004 symlinkによるroot外脱出を拒否する
    Given containment root内のsymlinkがroot外を指す
    When symlink配下の未作成fileを解決する
    Then path検証は失敗する

  Scenario: SCN-UNIT-SEC-005 診断出力からGitHub tokenとBearer credentialを除去する
    Given 診断文字列にGitHub tokenとBearer credentialが含まれる
    When secret redactionを行う
    Then 診断文字列に元のcredentialは残らない

  Scenario: SCN-UNIT-SEC-006 外部command失敗時も引数のtokenを診断へ残さない
    Given secret tokenを引数に持つ失敗commandがある
    When process境界でcommandを実行する
    Then process errorに元のtokenは残らない
    And process errorには伏字が含まれる
