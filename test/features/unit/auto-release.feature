@unit @auto-release
Feature: main mergeの自動release計画と配布digest
  npm配布物の内容を正準化し、前回releaseとの差から安全な計画を作る。

  Scenario: SCN-UNIT-AUTORELEASE-001 未releaseの現在versionはそのままreleaseする
    Given release対象の現在tagが未存在な自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は現在versionのreleaseへ進む

  Scenario: SCN-UNIT-AUTORELEASE-002 配布物が同一ならreleaseしない
    Given 現在tagが存在して配布digestが一致する自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は配布物同一を理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-003 skip ciを含むcommitではreleaseしない
    Given skip ciを含む自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は再帰防止を理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-004 既定branch以外のrefではreleaseしない
    Given 既定branch以外の自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画はbranch不一致を理由に停止する

  Scenario: SCN-UNIT-AUTORELEASE-005 既存tagと配布差分があるversionはbump後にreleaseする
    Given 現在tagが存在して配布digestが異なる自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は次のprerelease tagでreleaseする

  Scenario: SCN-UNIT-AUTORELEASE-006 prereleaseとpatchのbump規則が0.3.xの範囲を出ない
    Given prereleaseと通常versionと解決不能versionの衝突入力がある
    When 衝突した自動release計画を作成する
    Then 解決可能なversionは0.3.x内で次tagへ進み解決不能なversionは停止する

  Scenario: SCN-UNIT-AUTORELEASE-007 bump_version jobを持つworkflowを拒否する
    Given bump_version jobを持つworkflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はbump_version jobの存在を根拠に拒否する

  Scenario: SCN-UNIT-DIGEST-001 配布entryをpath昇順に正準化して同一digestを返す
    Given 入力順だけが異なる同じ配布entry集合がある
    When 配布digestをそれぞれ算出する
    Then 配布digestとentry件数は同じになる

  Scenario: SCN-UNIT-DIGEST-002 contentHashが1件でも変われば異なるdigestになる
    Given contentHashが1件だけ異なる配布entry集合がある
    When 配布digestをそれぞれ算出する
    Then 配布digestは異なる

  Scenario: SCN-UNIT-DIGEST-003 pathの重複をerrorとしdigestを空にする
    Given pathが重複する配布entry集合がある
    When 配布digestを算出する
    Then 配布digestは空で重複errorを返す

  Scenario: SCN-UNIT-DIGEST-004 entry 0件をerrorとする
    Given 空の配布entry集合がある
    When 配布digestを算出する
    Then 配布digestは空で配布物空errorを返す

  Scenario: SCN-UNIT-DIGEST-005 不正なcontentHash形式をerrorとする
    Given 不正なcontentHashを持つ配布entry集合がある
    When 配布digestを算出する
    Then 配布digestは空でcontentHash errorを返す

  Scenario: SCN-UNIT-DIGEST-006 package.jsonのversionだけを正規化から除外する
    Given versionだけが異なる二つのpackage.json内容がある
    When 二つの配布内容を正規化する
    Then 二つの正規化結果は同じになる

  Scenario: SCN-UNIT-DIGEST-007 package-lock.jsonのversionだけを正規化から除外する
    Given 指定versionだけが異なる二つのpackage-lock.json内容がある
    When 二つの配布内容を正規化する
    Then 二つの正規化結果は同じになる

  Scenario: SCN-UNIT-DIGEST-008 package.jsonのversion以外のfield変更は差として残る
    Given version以外も異なる二つのpackage.json内容がある
    When 二つの配布内容を正規化する
    Then 二つの正規化結果は異なる

  Scenario: SCN-UNIT-DIGEST-009 配布対象外のfileは内容をそのまま返す
    Given 通常fileの配布内容がある
    When 配布内容を正規化する
    Then 配布内容は変更されない

  Scenario: SCN-UNIT-DIGEST-010 JSON parseに失敗した内容をそのまま返す
    Given 壊れたpackage.jsonの配布内容がある
    When 配布内容を正規化する
    Then 配布内容は変更されない

  Scenario: SCN-UNIT-AUTOREL-D01 currentTag未存在ならdigestを比較せずreleaseする
    Given currentTagが未存在で現在の配布digestが空の入力がある
    When 自動release計画を作成する
    Then 自動release計画は現在versionのreleaseへ進む

  Scenario: SCN-UNIT-AUTOREL-D02 currentTag存在かつdigest一致で停止する
    Given 現在tagが存在して配布digestが一致する自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は前回tagを含む配布物同一理由で停止する

  Scenario: SCN-UNIT-AUTOREL-D03 currentTag存在かつdigest相違でbump後にreleaseする
    Given 現在tagが存在して配布digestが異なる自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は次のprerelease tagでreleaseする

  Scenario: SCN-UNIT-AUTOREL-D04 前回digestが空ならfail-openする
    Given 現在tagが存在して前回配布digestが空の入力がある
    When 自動release計画を作成する
    Then 自動release計画は次のprerelease tagでreleaseする

  Scenario: SCN-UNIT-AUTOREL-D05 現在digestが空なら停止する
    Given 現在tagが存在して現在の配布digestが空の入力がある
    When 自動release計画を作成する
    Then 自動release計画は現在digest算出不能を理由に停止する

  Scenario: SCN-UNIT-AUTOREL-D06 現在digestの形式不正なら停止する
    Given 現在tagが存在して現在の配布digest形式が不正な入力がある
    When 自動release計画を作成する
    Then 自動release計画は現在digest算出不能を理由に停止する

  Scenario: SCN-UNIT-AUTOREL-D07 skip ciはdigest比較より先に評価する
    Given skip ciと不正な現在配布digestを含む自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は再帰防止を理由に停止する

  Scenario: SCN-UNIT-AUTOREL-D08 未知fieldを拒否する
    Given 未知fieldを含む自動release入力がある
    When 自動release計画を作成する
    Then 自動release計画は未知fieldを理由に停止する

  Scenario: SCN-UNIT-RELWF-P01 push.pathsが存在するYAMLをinvalidとする
    Given push pathsを追加したrelease workflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はpush pathsを理由に拒否する

  Scenario: SCN-UNIT-RELWF-P02 push.paths不在かつdigest step有りをvalidとする
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はdigest契約を満たす

  Scenario: SCN-UNIT-RELWF-P03 digest算出stepが無いYAMLをinvalidとする
    Given digest算出stepを削除したrelease workflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はdigest step欠落を理由に拒否する

  Scenario: SCN-UNIT-RELWF-P04 接尾辞つきscript名を配布前品質検証と誤認しない
    Given 配布前品質検証の入口へ接尾辞を付けたrelease workflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証は配布前品質検証の欠落を理由に拒否する

  Scenario: SCN-UNIT-RELWF-P05 権限境界表が存在しないjobを載せる文書を拒否する
    Given release workflowと、廃止済みjobを載せた権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then 存在しないjobを載せていることを理由に拒否する

  Scenario: SCN-UNIT-RELWF-P06 権限境界表がjobを載せ落とした文書を拒否する
    Given release workflowと、jobを載せ落とした権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then jobを載せていないことを理由に拒否する

  Scenario: SCN-UNIT-RELWF-P07 job集合と権限境界表が一致する文書を受理する
    Given release workflowと、一致する権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then release jobと権限境界表の不一致は0件である

  Scenario: SCN-UNIT-RELWF-P08 ハイフン・大文字・アンダースコア始まりのjob IDを取り違えない
    Given ハイフンと大文字とアンダースコア始まりのjobを持つrelease workflowと、空の権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then 3件のjobを載せていないことを理由に拒否する

  Scenario: SCN-UNIT-RELWF-P09 権限境界表の外にある同形式の表を走査しない
    Given 権限境界表の外に同形式の表があるreview文書がある
    When release jobと権限境界表の一致を検証する
    Then release jobと権限境界表の不一致は0件である

  Scenario: SCN-UNIT-RELWF-P10 行末コメントつきのjobs見出しとjob keyを取りこぼさない
    Given 行末コメントつきのjobs見出しとjob keyを持つrelease workflowと、空の権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then 2件のjobを載せていないことを理由に拒否する

  Scenario: SCN-UNIT-RELWF-P11 値を持つkeyをjobとして拾わない
    Given 行末コメントに見える値を持つkeyだけのrelease workflowと、空の権限境界表がある
    When release jobと権限境界表の一致を検証する
    Then validateだけを載せていないことを理由に拒否する
