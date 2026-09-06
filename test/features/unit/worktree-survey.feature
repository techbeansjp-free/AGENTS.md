@unit
Feature: 登録済みworktreeを安全側に分類する

  Scenario: SCN-UNIT-WTSURVEY-001 未mergeのworktreeをin-progressとする
    Given 未mergeのworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はin-progressである

  Scenario: SCN-UNIT-WTSURVEY-002 merge済みかつcleanなworktreeをcleanup-readyとする
    Given merge済みかつcleanなworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はcleanup-readyである

  Scenario: SCN-UNIT-WTSURVEY-003 merge済みでもdirtyならretainとし理由を含める
    Given merge済みで未commit変更を持つworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はretainで未commit理由を含む

  Scenario: SCN-UNIT-WTSURVEY-004 merge済みでも未追跡fileがあればretainとし件数を理由に含める
    Given merge済みで未追跡fileを2件持つworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はretainで未追跡2件の理由を含む

  Scenario: SCN-UNIT-WTSURVEY-005 merge済みでも未pushのcommitがあればretainとし件数を理由に含める
    Given merge済みで未pushのcommitを3件持つworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はretainで未push3件の理由を含む

  Scenario: SCN-UNIT-WTSURVEY-006 merge済みでもrecoveryReachableが偽ならretainとする
    Given merge済みで復旧参照のないworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はretainで復旧不能理由を含む

  Scenario: SCN-UNIT-WTSURVEY-007 複数の保持理由をすべて列挙する
    Given merge済みで4種類の保持条件を持つworktree観測がある
    When worktree走査を純粋判定する
    Then 4種類の保持理由をすべて含む

  Scenario: SCN-UNIT-WTSURVEY-008 isPrimaryをprimaryとし後片付け対象にしない
    Given repository root自身のworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はprimaryで後片付け一覧に含まれない

  Scenario: SCN-UNIT-WTSURVEY-009 未mergeかつdirtyをin-progressとする
    Given 未mergeかつdirtyなworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はin-progressである

  Scenario: SCN-UNIT-WTSURVEY-010 未知fieldを持つentryをerrorsとし他entryの判定は続行する
    Given 未知fieldを持つ観測と正常な観測がある
    When worktree走査を純粋判定する
    Then 未知fieldのerrorと正常な判定を返す

  Scenario: SCN-UNIT-WTSURVEY-011 pathの重複をerrorsとする
    Given pathが重複するworktree観測がある
    When worktree走査を純粋判定する
    Then path重複のerrorを返す

  Scenario: SCN-UNIT-WTSURVEY-012 unpushedCommitsが負数をerrorsとする
    Given 未pushcommit数が負数のworktree観測がある
    When worktree走査を純粋判定する
    Then 未pushcommit数のerrorを返す

  Scenario: SCN-UNIT-WTSURVEY-013 配列でない入力をerrorsとする
    Given worktree観測入力が配列でない
    When worktree走査を純粋判定する
    Then 配列入力のerrorを返す

  Scenario: SCN-UNIT-WTSURVEY-014 空配列でerrorsを出さず空の結果を返す
    Given worktree観測入力が空配列である
    When worktree走査を純粋判定する
    Then errorのない空の走査結果を返す

  Scenario: SCN-UNIT-WTSURVEY-015 directory名とbranch名のslug不一致を報告する
    Given directory名とbranch名のslugが異なるworktree観測がある
    When worktree走査を純粋判定する
    Then slug不一致を理由として報告する

  Scenario: SCN-UNIT-WTSURVEY-016 directory名とbranch名のIssue番号不一致を報告する
    Given directory名とbranch名のIssue番号が異なるworktree観測がある
    When worktree走査を純粋判定する
    Then Issue番号不一致を理由として報告する

  Scenario: SCN-UNIT-WTSURVEY-017 不一致の報告がdispositionを変えない
    Given cleanup-readyでslugだけが異なるworktree観測がある
    When worktree走査を純粋判定する
    Then slug不一致を報告しても判定はcleanup-readyである

  Scenario: SCN-UNIT-WTSURVEY-018 upstreamが無くても既定branchから到達できれば復旧可能とする
    Given 既定branchへmerge済みでupstreamを失ったworktreeがある
    When 復旧可能性を観測する
    Then 復旧可能性は"真"である

  Scenario: SCN-UNIT-WTSURVEY-019 既定branchから到達できずupstreamも一致しなければ復旧不能とする
    Given 既定branchから到達できないcommitを持つworktreeがある
    When 復旧可能性を観測する
    Then 復旧可能性は"偽"である

  Scenario: SCN-UNIT-WTSURVEY-020 既定branch refを解決できないときは到達不可として扱う
    Given 既定branch refを解決できないworktreeがある
    When 復旧可能性を観測する
    Then 既定branch到達は"偽"である

  Scenario: SCN-UNIT-WTSURVEY-021 既定branch到達を観測できたときupstream由来の拒否理由を出さない
    Given 既定branch到達を観測できupstream由来の観測が偽の入力がある
    When worktree削除の安全性を判定する
    Then 拒否理由にupstream由来は含まれない

  Scenario: SCN-UNIT-WTSURVEY-022 既定branch到達が不明ならupstream由来の拒否理由を出す
    Given 既定branch到達が不明でupstream由来の観測が偽の入力がある
    When worktree削除の安全性を判定する
    Then 拒否理由にupstream由来が含まれる

  Scenario: SCN-UNIT-WTSURVEY-023 detached HEADのmerge済みworktreeをentriesへ入れretainとしdetached理由を含める
    Given detached HEADでmerge済みかつcleanなworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はretainでdetached理由を含みbranchはnullである

  Scenario: SCN-UNIT-WTSURVEY-024 detached HEADの未mergeworktreeをin-progressとしdetached理由を含める
    Given detached HEADで未mergeのworktree観測がある
    When worktree走査を純粋判定する
    Then 判定はin-progressでdetached理由を含む

  Scenario: SCN-UNIT-WTSURVEY-025 attachment状態の矛盾をpath付きerrorへ分離し正常な観測の判定を継続する
    Given attachedなのにbranchが空の観測とdetachedなのにbranchを持つ観測と正常な観測がある
    When worktree走査を純粋判定する
    Then attachment状態の矛盾はpath付きerrorになり正常な観測だけが分類される

  Scenario: SCN-UNIT-WTSURVEY-026 headStateが不明な観測をpath付きerrorへ分離する
    Given headStateが不明なworktree観測がある
    When worktree走査を純粋判定する
    Then headState不明はpath付きerrorになりentriesへ入らない
