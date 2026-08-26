@unit @merge-integrity
Feature: 監査範囲内mergeの損失検知
  監査範囲に含まれるmerge commitが、両親の保持していた損失検知tokenと、
  いずれかの親が導入した損失検知tokenを、出現位置ごとに失っていないことを判定する。

  Scenario: SCN-UNIT-MERGEINT-001 安定IDとID以外のtokenをともに損失検知tokenとして取り出す
    Given 損失検知tokenを含む文字列がある
    When 損失検知tokenを取り出す
    Then 取り出したtokenに "REQ-WF-010"、"TERM-ASC-068"、"AC-01"、"SHA-256" が含まれる

  Scenario: SCN-UNIT-MERGEINT-002 連番を持たないtokenを損失検知tokenにしない
    Given 損失検知tokenを含まない文字列がある
    When 損失検知tokenを取り出す
    Then 取り出したtokenに "worktree"、"main"、"v0.3.1"、"X-1" が含まれない

  Scenario: SCN-UNIT-MERGEINT-003 両親が保持していたtokenの消失を検出する
    Given 両親が保持していたtokenがmerge結果から消えたmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、失われたtokenを示す

  Scenario: SCN-UNIT-MERGEINT-004 片方の親が導入したtokenの消失を検出し次操作を示す
    Given 第2親だけが導入したtokenがmerge結果に無いmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、失われたtokenを示す
    And 失敗の説明にpathとcommitと安全な次操作が含まれる

  Scenario: SCN-UNIT-MERGEINT-005 別pathに同じtokenが残っていても当該pathの消失を検出する
    Given 第2親が2つのpathへ同じtokenを導入し片方だけがmerge結果に残るmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、失われたtokenを示す

  Scenario: SCN-UNIT-MERGEINT-006 保持必須集合がすべて残っている場合は合格する
    Given 両親が導入したtokenがすべてmerge結果にあるmerge観測がある
    When merge損失を判定する
    Then 判定は成功する

  Scenario: SCN-UNIT-MERGEINT-007 片方の親だけが削除したtokenの消失は許容する
    Given merge-baseにあるtokenを第1親だけが削除したmerge観測がある
    When merge損失を判定する
    Then 判定は成功する

  Scenario: SCN-UNIT-MERGEINT-008 rename移動先が一意なら移動先での存在を認める
    Given merge結果にpathが無くrename移動先が一意なmerge観測がある
    When merge損失を判定する
    Then 判定は成功する

  Scenario: SCN-UNIT-MERGEINT-009 親が3個のmergeを判定不能として拒否する
    Given 親が3個のmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-010 merge-baseが一意でないmergeを判定不能として拒否する
    Given merge-baseが2個のmerge観測とmerge-baseが0個のmerge観測がある
    When merge損失を判定する
    Then 両方の観測が判定不能として拒否される

  Scenario: SCN-UNIT-MERGEINT-011 観測が0件なら合格し件数が0になる
    Given merge観測が0件である
    When merge損失を判定する
    Then 判定は成功し、検査merge件数と検査path件数がともに0である

  Scenario: SCN-UNIT-MERGEINT-012 観測側が判定規則を自前で持たない
    Given 監査検査scriptがある
    When 監査検査scriptのsourceを読む
    Then 判定規則の定義を参照し、正規表現を自前で書いていない

  Scenario: SCN-UNIT-MERGEINT-013 検査件数が観測件数とpath件数の総和に一致する
    Given 判定可能な観測と判定不能な観測が混在するmerge観測列がある
    When merge損失を判定する
    Then 検査merge件数が観測件数に一致し、検査path件数が全観測のpath件数の総和に一致する

  Scenario: SCN-UNIT-MERGEINT-014 品質基準が追随手順を定めている
    Given 配布される品質基準がある
    When 配布される品質基準を読む
    Then 追随の位置とH_implと比較基点の指し先と個別監査表の再生成が書かれている

  Scenario: SCN-UNIT-MERGEINT-015 reviewテンプレートが追随時の確認項目を持つ
    Given 配布されるreviewテンプレートとPR事前確認テンプレートがある
    When 配布されるreviewテンプレートとPR事前確認テンプレートを読む
    Then 追随時の比較基点とH_implの指し先を確認する項目がある

  Scenario: SCN-UNIT-MERGEINT-016 正本が意図的な削除の置き場所を定めている
    Given 配布される品質基準がある
    When 配布される品質基準を読む
    Then 意図的な削除をmergeではなく後続commitで行う旨が書かれている

  Scenario: SCN-UNIT-MERGEINT-017 追随手順の記載先が配布対象に含まれる
    Given 追随手順を記載したfileの一覧がある
    When 配布対象judgementのためpackage.jsonを読む
    Then すべてがpackage.jsonのfilesが配布する範囲に含まれる

  Scenario: SCN-UNIT-MERGEINT-018 移動先を特定できないpath消失を損失として拒否する
    Given merge結果にpathが無くrename移動先も無いmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、失われたtokenを示す

  Scenario: SCN-UNIT-MERGEINT-019 内容の観測に失敗した観測を判定不能として拒否する
    Given 第2親の内容を観測できないmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-020 rename移動先が一意でない観測を判定不能として拒否する
    Given merge結果にpathが無く親ごとにrename移動先が異なるmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-021 片方の親でだけ移動先を特定できた観測を判定不能として拒否する
    Given merge結果にpathが無く片方の親でだけ移動先を特定できたmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-022 複数の移動元が同じ移動先へ解決された観測を判定不能として拒否する
    Given 異なる2つの移動元が同じ移動先へ解決されたmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-023 移動先がmerge結果に残る別の要求元である観測を判定不能として拒否する
    Given 移動先がmerge結果に残る別の要求元であるmerge観測がある
    When merge損失を判定する
    Then 判定は失敗し、判定不能の理由を示す

  Scenario: SCN-UNIT-MERGEINT-024 保持必須集合が空の移動元は衝突として扱わない
    Given 保持必須集合が空の移動元が既存pathへ解決されたmerge観測がある
    When merge損失を判定する
    Then 判定は成功する
