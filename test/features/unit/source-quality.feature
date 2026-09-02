@unit
Feature: project固有の型品質と汎用開発考慮事項

  Scenario: SCN-UNIT-QUALITY-001 開発考慮事項の欠落を拒否する
    Given 開発考慮事項が3行しかない成果物がある
    When 開発考慮事項conformanceを検証する
    Then 欠落した考慮事項IDを拒否する

  Scenario: SCN-UNIT-QUALITY-002 禁止された型表現を拒否する
    Given projectで禁止された型表現を持つsourceがある
    When source型契約を検証する
    Then source型契約は失敗する

  Scenario: SCN-UNIT-QUALITY-003 repositoryのTypeScript品質選択が成立する
    Given repositoryのproject choiceを読み込む
    When repositoryのsource品質を検証する
    Then TypeScript集約と補助言語対象外証拠を確認できる

  Scenario: SCN-UNIT-QUALITY-004 形式的な適用判断を具体的な証拠として受理しない
    Given 理由と証拠がxだけの開発考慮事項がある
    When 開発考慮事項conformanceを検証する
    Then 形式的な理由と証拠を拒否する

  Scenario: SCN-UNIT-QUALITY-005 大文字拡張子とshebangを含む任意directoryへの補助言語混入も拒否する
    Given 任意directoryに大文字拡張子とshebangのPython sourceを置いたprojectがある
    When repositoryのsource品質を検証する
    Then 大文字拡張子とshebangのPython source再混入を拒否する

  Scenario: SCN-UNIT-QUALITY-006 candidateはproject choice・品質script・runner・ESLint・trusted jobを自己緩和できない
    Given project choiceを乖離させtestとconformanceをtrue、runnerを空、ESLintをoff、trusted jobをfalseへ変更したprojectがある
    When project品質bindingを検証する
    Then project choice乖離と品質scriptの自己緩和を拒否する

  Scenario: SCN-UNIT-QUALITY-007 TypeScript sourceへJSDoc型注釈を残さない
    Given JSDoc型注釈を持つTypeScript sourceがある
    When source型契約を検証する
    Then source型契約は失敗する

  Scenario: SCN-UNIT-QUALITY-008 base事前登録済みの品質強化を次PRで有効化できる
    Given baseで事前登録したversioned staged品質proposalと完全一致するcandidateがある
    When trusted品質契約migrationを検証する
    Then 事前登録済みの品質強化だけを許可する

  Scenario: SCN-UNIT-QUALITY-009 candidateは同一PRで品質proposalを登録して自己承認できない
    Given baseで事前登録したversioned staged品質proposalと完全一致するcandidateがある
    And candidate自身だけが登録した品質proposalで同じ変更を有効化しようとする
    When trusted品質契約migrationを検証する
    Then candidateによる同一PR内の自己承認を拒否する

  Scenario: SCN-UNIT-QUALITY-010 外部JSONは入力種別ごとに型と未知fieldを検証する
    Given 型不正なmigration manifestとstateの外部JSONがある
    When CLIの入力種別別runtime validatorを実行する
    Then 型不正と未知fieldを副作用前に拒否する

  Scenario: SCN-UNIT-QUALITY-011 候補側の保護対象file欠損を構造化errorとして拒否する
    Given 候補から保護対象fileを1件削除したprojectがある
    When trusted品質契約migrationを検証する
    Then 候補側の保護対象file欠損をerrorとして名指しする

  Scenario: SCN-UNIT-QUALITY-012 trusted側の保護対象file欠損を候補側と区別して報告する
    Given trusted baseから保護対象fileを1件削除したprojectがある
    When trusted品質契約migrationを検証する
    Then trusted base側の保護対象file欠損をerrorとして名指しする

  Scenario: SCN-UNIT-QUALITY-013 存在しないことと読み取れないことを区別する
    Given 候補の保護対象fileをdirectoryへ置き換えたprojectがある
    When trusted品質契約migrationを検証する
    Then 候補側の読み取り不能をerrno付きで報告する

  Scenario: SCN-UNIT-QUALITY-014 正規化経路を持つ保護対象fileの欠損も報告する
    Given 候補からpackage-lock.jsonを削除したprojectがある
    When trusted品質契約migrationを検証する
    Then 候補側のpackage-lock.json欠損をerrorとして名指しする

  Scenario Outline: SCN-UNIT-QUALITY-015 snapshot外の候補保護file欠損を構造化errorで返す
    Given candidateのsnapshot外保護file "<path>" を欠損させたprojectがある
    When project品質bindingを検証する
    Then candidate側の "<path>" と存在しない理由を含むinvalid resultを返す

    Examples:
      | path |
      | scripts/check_project_quality.ts |
      | tsconfig.json |
      | eslint.config.mjs |
      | .github/workflows/ci.yml |
      | .github/workflows/trusted-quality.yml |

  Scenario Outline: SCN-UNIT-QUALITY-016 snapshot外の候補保護file非通常化を構造化errorで返す
    Given candidateのsnapshot外保護file "<path>" をdirectoryへ置換したprojectがある
    When project品質bindingを検証する
    Then candidate側の "<path>" と存在しない以外の理由を含むinvalid resultを返す

    Examples:
      | path |
      | scripts/check_project_quality.ts |
      | tsconfig.json |
      | eslint.config.mjs |
      | .github/workflows/ci.yml |
      | .github/workflows/trusted-quality.yml |

  Scenario: SCN-UNIT-QUALITY-017 candidate scriptを実行せず保護一覧を静的に読む
    Given 実行副作用を持つcandidateのcheck_project_quality sourceがある
    When project品質bindingを検証する
    Then candidate sourceの副作用を実行せず静的な読み取り結果だけで判定する

  Scenario: SCN-UNIT-QUALITY-018 読み取り成功後の内容不正policyを維持する
    Given 読み取り可能だがmalformedなcandidateのtsconfigがある
    When project品質bindingを検証する
    Then file読み取り失敗へ変換せず既存の内容不正policyで拒否する
