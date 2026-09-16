@unit @issue-template-contract
Feature: Issue templateと段階別検証の契約

  Scenario: SCN-UNIT-ISSUETPL-001 full templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When full modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-002 quick templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When quick modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-003 poc templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When poc modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-004 検証器の必須見出しをテンプレートから削ると検査が失敗する
    Given 必須見出しを削除したquick templateがある
    When 変更したIssue templateの見出し契約を検査する
    Then quickの不足見出しを示して検査が失敗する

  Scenario: SCN-UNIT-ISSUETPL-005 テンプレートの任意見出しは検査を失敗させない
    Given 任意見出し0. 管理情報を持つquick templateがある
    When 変更したIssue templateの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUESTG-001 requirements段階は00と01だけを要求する
    Given 00と01だけが記入済みで02と03が未記入のfull Issueがある
    When requirements段階でIssueを検証する
    Then Issue検証は合格する

  Scenario: SCN-UNIT-ISSUESTG-002 design段階は00から03を要求する
    Given 00と01だけを持つvalidなfull Issueがある
    When design段階でIssueを検証する
    Then 02と03の不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUESTG-003 stage未指定は従来どおり全件を要求する
    Given 00と01だけを持つvalidなfull Issueがある
    When stageを指定せずIssueを検証する
    Then 02と03の不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUESTG-004 quickはstageの有無で挙動が変わらない
    Given validなquick Issueがある
    When quick Issueを全stage指定と未指定で検証する
    Then quick Issueの検証結果はすべて同じである

  Scenario: SCN-UNIT-ISSUESTG-005 requirements段階でもGherkin scenario IDを要求する
    Given Gherkin scenario IDがない00と01のfull Issueがある
    When requirements段階でIssueを検証する
    Then Gherkin scenario ID不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUEPLC-001 code span内の型引数はplaceholderとしない
    Given validなquick Issueの本文にcode spanの型引数がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-002 code block内のobject literalはplaceholderとしない
    Given validなquick Issueの本文にcode blockのobject literalがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-003 説明文の変更しない条件はplaceholderとしない
    Given validなquick Issueの本文に説明文の変更しない条件がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-004 Scenario Outlineのparameterはplaceholderとしない
    Given validなquick Issueの本文にScenario Outlineのparameterがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-005 テンプレート由来の実placeholderは引き続き検出する
    Given validなquick Issueの本文にテンプレート由来のplaceholderがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorを示してIssue検証が失敗する
    And placeholder errorが原因の字面"（人が識別できる件名）"を示す

  Scenario: SCN-UNIT-ISSUEPLC-006 placeholderが6件のとき先頭5件とほか1件を示す
    Given validなquick Issueの本文にplaceholder6件がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorが字面"<a>、<b>、<e>、{c}、{d}"と"ほか1件"を示す

  Scenario: SCN-UNIT-ISSUEPLC-007 placeholderが5件のとき省略を示さない
    Given validなquick Issueの本文にplaceholder5件がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorが字面"<a>、<b>、<e>、{c}、{d}"を示し省略を示さない

  Scenario: SCN-UNIT-ISSUEPLC-008 templateのラベル行を残した文書は合格する
    Given validなquick Issueの本文にtemplateのラベル行がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario Outline: SCN-UNIT-ISSUETPL-010 要求定義templateが仕様の所有箇所を宣言する
    Given 出荷Issue templateと検証器の見出し契約がある
    When "<mode>"の要求定義templateを読む
    Then 要求定義templateは仕様の所有箇所の欄を持つ

    Examples:
      | mode |
      | full |
      | quick |
      | poc |

  Scenario: SCN-UNIT-ISSUECOMMENT-001 正規progress markerを含むIssueは合格する
    Given placeholder検査用のMarkdownがある
      """
      <!-- asc:parallel-progress:start -->
      <!-- asc:parallel-progress:end -->
      """
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario Outline: SCN-UNIT-ISSUECOMMENT-002 完全コメントを除外して前後の断片を結合しない
    Given placeholder検査用のMarkdownがある
      """
      <body>
      """
    When IssueとPR本文の共有placeholder境界を検証する
    Then IssueとPR本文はplaceholderなしで合格する

    Examples:
      | body |
      | <!-- <hidden> {hidden} （人が識別できる件名） --> |
      | <!--\n<hidden>\n{hidden}\n（人が識別できる件名）\n--> |
      | <!----> |
      | <!-- {a} --><!-- <b> --> |
      | <left<!-- comment -->right> |
      | {left<!----><!-- adjacent -->right} |
      | （人が<!--\ncomment\n-->識別できる件名） |
      | `Promise<T>`\n```ts\n{example}\n```\n<!-- {hidden} --> |
      | <!--\n```\n{hidden}\n--> |
      | <!-- ` {hidden} --> |
      | <!-- `code` {hidden} --> |
      | <!--\n~~~md\n{hidden}\n--> |
      | <!--\n```md\n{hidden}\n```\n{also-hidden}\n--> |

  Scenario Outline: SCN-UNIT-ISSUECOMMENT-003 コメント外と未終端コメントのplaceholderは名指しで拒否する
    Given placeholder検査用のMarkdownがある
      """
      <body>
      """
    When IssueとPR本文の共有placeholder境界を検証する
    Then Issueのplaceholder候補は"<expected>"だけになる
    And PR本文のplaceholder候補は"<expected>"だけになる

    Examples:
      | body | expected |
      | {outside}<!-- {hidden} --> | {outside} |
      | <!-- {hidden} -->{outside} | {outside} |
      | <!--\n<angle>\n{brace}\n（人が識別できる件名） | <angle>、{brace}、（人が識別できる件名） |
      | <!-- {hidden} -->\n<!--\n{unclosed}\n本文は{following} | {following}、{unclosed} |
      | <!--\n```\n-->\n{outside} | {outside} |
      | <!--\nGiven <hidden>\n-->\n本文は{outside} | {outside} |
      | ＜！-- {unicode} --＞ | {unicode} |
      | `<!--` {outside} --> | {outside} |
      | ``<!-- ` nested`` {outside} --> | {outside} |
      | ```html\n<!--\n```\n{outside}\n--> | {outside} |
      | ~~~html\n<!--\n~~~\n{outside}\n--> | {outside} |
      | ````html\n<!--\n```\n{inside}\n````\n{outside}\n--> | {outside} |
      | ```html <!--\n```\n{outside}\n--> | {outside} |
      | <!-- ` -->{outside} ` | {outside} |
      | <!--\n~~~md\n-->\n{outside} | {outside} |
      | `<!--` <!-- {hidden} --> {outside} --> | {outside} |
      | ```html\n<!--\n```\n<!-- {hidden} -->\n{outside}\n--> | {outside} |
      | <!-- 補足 --> Given <outside> | <outside> |
      | <!-- `{inline}` | {inline} |
      | <!--\n```md\n{fenced}\n``` | {fenced} |
      | <!-- {hidden} -->{f} {d} {c} <e> <b> <a> {c} | <a>、<b>、<e>、{c}、{d}、ほか1件 |

  Scenario: SCN-UNIT-ISSUECOMMENT-004 PR本文は共有comment境界と必須見出しを維持する
    Given placeholder検査用のMarkdownがある
      """
      <!--
      <hidden> {hidden} （人が識別できる件名）
      -->
      <left<!---->right>
      """
    When IssueとPR本文の共有placeholder境界を検証する
    Then IssueとPR本文はplaceholderなしで合格する
    And 完全コメント付きPR本文でも概要見出しの欠落は拒否する
    And PR本文でもコメント外と未終端のplaceholderは名指しで拒否する

  Scenario: SCN-UNIT-ISSUETPL-011 縮小した雛形の複写直後は事前充填が保たれ読者表を持ち行数が減る
    Given 出荷Issue templateと検証器の見出し契約がある
    When 配布templateからfullの件名と作成日時でstagingを複写する
    Then 00から03の件名、正本、作成更新日、開発考慮事項の行が事前充填されている
    And 00から03はそれぞれ冒頭に読者表を持つ
    And 00から03の合計行数は752行より少ない

  Scenario: SCN-UNIT-ISSUETPL-012 縮小した雛形を必須欄だけ埋めた成果物は受理され必須見出しを削ると拒否される
    Given 配布templateを複写し必須欄だけ埋めたfull stagingがある
    When 複写したstagingをdesign段階で検証する
    Then 複写したstagingの検証は合格する
    And 複写した00から必須見出しを1つ削ると必須項目の不足で拒否される

  Scenario: SCN-UNIT-ISSUETPL-013 複写した成果物は管理情報より先に目的の節が来る
    Given 出荷Issue templateと検証器の見出し契約がある
    When 配布templateからfullの件名と作成日時でstagingを複写する
    Then 00から03の最初の節見出しは管理情報ではない
    And 00から03の管理情報の節は最後の節である

  Scenario: SCN-UNIT-ISSUETPL-014 配布するIssue templateは全件が読者表を持ちreview templateは要約を持つ
    Given 出荷Issue templateと検証器の見出し契約がある
    When 配布するIssue templateを全件読む
    Then 全templateは冒頭に読者3区分の読者表を持つ
    And review templateは問題・解決・実施・確認・判定の要約表を持つ
