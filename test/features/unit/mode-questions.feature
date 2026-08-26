@unit @mode-questions
Feature: モード判定質問の正本
  Q-01〜Q-08の質問文とquick失格分類を単一の対として保持し、対応の欠落と付け替えを拒否する。

  Scenario: SCN-UNIT-MODEQ-001 質問の組が8件公開されている
    Given 公開されたモード判定質問がある
    When 質問の組を数える
    Then 8件あり、IDと分類と質問文がすべて空でない

  Scenario: SCN-UNIT-MODEQ-004 質問IDの列が既存のQUESTIONSと一致する
    Given 公開されたモード判定質問がある
    When 質問IDの列を取り出す
    Then 既存のQUESTIONSと完全一致する

  Scenario: SCN-UNIT-MODEQ-005 分類の集合が承認済み8件と一致する
    Given 公開されたモード判定質問がある
    When 分類の集合を取り出す
    Then 承認済みの8分類と完全一致する

  Scenario: SCN-UNIT-MODEQ-006 分類に対応する質問が無いと失敗する
    Given 分類を1件差し替えたモード判定質問がある
    When モード判定質問の対応を検証する
    Then 対応が無い分類を示して失敗する

  Scenario: SCN-UNIT-MODEQ-008 正しい組で検証が合格する
    Given 公開されたモード判定質問がある
    When モード判定質問の対応を検証する
    Then 検証は成功する

  Scenario: SCN-UNIT-MODEQ-014 分類が重複すると失敗する
    Given 分類を重複させたモード判定質問がある
    When モード判定質問の対応を検証する
    Then 重複した分類を示して失敗する

  Scenario: SCN-UNIT-MODEQ-021 分類が空文字だと失敗する
    Given 分類を空文字にしたモード判定質問がある
    When モード判定質問の対応を検証する
    Then 承認済みでない分類を示して失敗する

  Scenario: SCN-UNIT-MODEQ-012 Q-06に引用の例外と不明時の扱いが書かれている
    Given 公開されたモード判定質問がある
    When Q-06の質問文を読む
    Then 復旧可能性と、変えない引用の例外と、不明ならfalseとする旨が含まれる

  Scenario: SCN-UNIT-MODEQ-015 Q-01とQ-02が対象を限定している
    Given 公開されたモード判定質問がある
    When Q-01とQ-02の質問文を読む
    Then 一方は外部へ公開するinterface、他方は保存されているデータの形式を対象にしている

  Scenario: SCN-UNIT-MODEQ-018 Q-07が成果物間の矛盾を問う
    Given 公開されたモード判定質問がある
    When Q-07の質問文を読む
    Then 目的と対象範囲と受け入れ条件と不変条件と要件の矛盾を問う旨が含まれる

  Scenario: SCN-UNIT-MODEQ-019 モード判定の結果が変更前と一致する
    Given モード判定の代表入力がある
    When 各入力でモードを判定する
    Then 期待するモードと理由がすべて一致する

  Scenario: SCN-UNIT-MODEQ-022 質問文が重複すると失敗する
    Given 質問文を重複させたモード判定質問がある
    When モード判定質問の対応を検証する
    Then 重複した質問文を示して失敗する
