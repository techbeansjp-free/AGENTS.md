@integration
Feature: packed artifactを隔離環境で利用者と同じ入口から観測する

  Scenario: SCN-INT-CONSUMER-001 package:checkが存在しない公開binを検出する
    Given package:checkを実行できる候補treeがある
    When package.jsonのbinを存在しないpathへ変えてpackage:checkを実行する
    Then packed-binのconsumer acceptanceで不合格になる

  Scenario: SCN-INT-CONSUMER-002 保護契約とsource repositoryを変更しない
    Given 保護fileと配布scriptがorigin/mainとのmerge-baseに一致する
    When 最小fixture tarballのconsumer acceptanceを1回観測する
    Then 観測前後で保護契約のdigestが一致する

  Scenario: SCN-INT-CONSUMER-003 package:checkはregistry遮断下でも判定を返す
    Given 到達不能registryとoffline modeを持つ一時npm cacheがある
    When 同じ環境でregistry参照と実コマンドpackage:checkを実行する
    Then registry参照は失敗しpackage:checkは終了値0を返す

  Scenario: SCN-INT-CONSUMER-004 親processのnpm認証tokenを隔離環境へ伝播しない
    Given 親processに大小文字のnpm認証tokenがある
    When tokenを持つ親processからpacked artifactを観測する
    Then 観測用の全processにnpm認証tokenが存在しない

  Scenario: SCN-INT-CONSUMER-005 故障注入証跡を対象製品fileの内容と機構契約へ拘束する
    Given 3機構の故障注入証跡がある
    When 証跡の必須欄と対象製品fileのSHA-256と機構別の値を検査する
    Then 3件は合格し記録hashの不一致と形式不正と必須欄の欠落は不合格になる

  Scenario: SCN-INT-CONSUMER-006 fixture tarballを導入して公開入口を起動する
    Given 公開binを持つ最小fixture tarballがある
    When packed artifactを隔離環境で観測する
    Then 導入とbinの実在と公開入口の起動が観測される

  Scenario: SCN-INT-CONSUMER-007 git依存の準備欠落を実行入口で検出する
    Given install成功時に公開binを作る制御npm seamがある
    When consumer acceptance commandを実行してから公開binを作らない故障を注入して再実行する
    Then 注入前は終了値0で注入後はgit-dependencyを示して非0になる

  Scenario: SCN-INT-CONSUMER-008 大規模ignored出力で導入済み公開入口が成功する
    Given agent-skill-chainの候補tarballがある
    When ignored出力が1MiBを超えるscratch repositoryで公開入口を観測する
    Then scale-outputの公開入口は終了値0を返す

  Scenario: SCN-INT-CONSUMER-009 release対象の同じtarballで3機構を検査して公開する
    Given release workflowの公開artifact経路がある
    When pack artifactからconsumer acceptanceとpublishへの参照を検査する
    Then 1度だけ作った同じtarballに3機構の検査と公開が結び付く
