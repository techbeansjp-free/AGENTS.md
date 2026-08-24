@unit
Feature: workspace衛生を副作用前に判定する

  Scenario: SCN-UNIT-HYGIENE-001 previewは外部writeなしで候補と除外理由を返す
    Given 空directoryと未追跡一時生成物と偽Git領域を持つ隔離repositoryがある
    When workspace hygieneをpreviewする
    Then previewは候補のpathと理由とownerと削除可否を返す
    And previewはfixtureを書き換えずGit領域の除外理由を返す

  Scenario: SCN-UNIT-HYGIENE-002 Git common directory配下は空でも候補にしない
    Given 空のGit補助directoryを持つ隔離repositoryがある
    When workspace hygieneをpreviewする
    Then Git common directory配下は候補に含まれない
    And Git common directoryはoverride不能な除外理由を持つ

  Scenario: SCN-UNIT-HYGIENE-003 repository root・home・filesystem root・親参照を拒否する
    Given root境界を検査する隔離repositoryがある
    When repository内directoryとhomeとfilesystem rootと親参照をpreview rootに指定する
    Then すべての危険なrootを拒否しremoveを呼ばない
    And repository root自身は除外一覧に記録される

  Scenario: SCN-UNIT-HYGIENE-004 symlinkとsymlink脱出を候補にしない
    Given repository内外を指すsymlinkを持つ隔離repositoryがある
    When workspace hygieneをpreviewする
    Then symlinkとその親directoryは候補に含まれない
    And symlink脱出の除外理由が返る

  Scenario: SCN-UNIT-HYGIENE-005 内容のあるmemoとnode_modulesを保持する
    Given 内容のあるmemoとpackage manager所有directoryを持つ隔離repositoryがある
    When workspace hygieneをpreviewする
    Then 内容のあるmemoとnode_modules配下は候補に含まれない
    And memo内の空directoryだけは候補になる

  Scenario: SCN-UNIT-HYGIENE-006 hash不一致とstale previewでは1件も削除しない
    Given apply候補を持つ隔離repositoryのpreview reportがある
    When hash不一致とTOCTOU変更後のapplyを順に試みる
    Then どちらのapplyもremoveを一度も呼ばず拒否される

  Scenario: SCN-UNIT-HYGIENE-007 指定外のoperationはskippedとして報告する
    Given 複数operationの候補を持つ隔離repositoryがある
    When temporary artifactだけを明示してapplyする
    Then 指定したoperationだけが削除される
    And 指定外のoperationはskipped理由とともに返る
