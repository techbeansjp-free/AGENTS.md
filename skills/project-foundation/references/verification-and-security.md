# 検証・セキュリティ・証跡

テスト・CI・監査・ログを整備/点検する場合に読む。特定scanner、深刻度、保持日数、過去CVEの非該当判断を新案件へコピーしない。

## テストの責任と失敗の扱い

単体・結合・E2Eを基準に、公開画面/API/CLIには公開仕様からのブラックボックス観点を持つ。BDDはGherkinを初期値とし、既存方式や明示要求を優先する。各層の対象、mock/実接続、正常/拒否/失敗/回復、fixtureと実データ禁止、coverageと未検証範囲を定める。タグ/step未定義、skip/only、無根拠なretryで未実行や失敗を隠さない。対象外の層は理由を記す。

内部import/状態の書換えをブラックボックスの期待値にせず、公開status/header/body、操作後の再取得、副作用と回復を確認する。coverageだけで実接続を代用しない。実行環境の準備と、公開仕様からの期待値を分ける。

構築は初回と再実行、新規/既存データ、部分起動/停止、中断、依存故障、port競合・並行起動等を該当範囲で確認する。sourceが見えただけでreloadを実証したとせず、doctorだけで実protocol/復旧成功としない。私物サービスを誤ってtest対象へ流用しない。

shellの最後の終了値だけで複数assertを合格にしない。`! check_a; ! check_b`等は先行失敗が消える場合があるため、各条件で明示的に失敗させる。pipelineの終端が成功しても本体が失敗していれば失敗として伝える。試験自体の構文・環境・OS依存の失敗を製品失敗と区別し、是正後に実行し直す。

## 自己監査の対象

| 対象 | 必要な検査/対応 |
| --- | --- |
| 依存 | lockの直接/推移依存、runtimeとdev/toolの必要性、manager/SDKのvendored依存、script許可、更新/ライセンス |
| コンテナ | 実行OSと言語依存、支持期限/EOL、全環境targetと実体builderの実インストール内容、SBOM |
| 実行設定 | image既定USERと配備UID/GID、capability、書込み、公開範囲、秘密注入、資源・ログ上限 |
| 基盤 | 開発端末管理は製品ゲートと分離。本番/CIのOS/kernel/runtimeは所有範囲とその実環境で検証 |

基盤整備では、上表から実際の監査対象、対象版の識別、scanner/DBの鮮度、停止基準、例外承認者、証跡の保持を決める。点検のみなら設定と既存結果の不足を返し、scanや依存更新まで暗黙に広げない。実行が必要なときは対象と結果を結び付け、空結果・検査不能・失敗をゼロ件にしない。

対象照合、原始結果、非該当、是正・再scanの詳細を扱う場合は[監査と成果物の証拠照合](../../security-evidence/SKILL.md)を読む。基盤側に別の評価規則を再定義せず、選択した範囲とその実施結果を基盤の受入へ対応付ける。

依存auditはSAST、秘密検知、認可/tenant境界試験、DAST、脅威モデル、侵入検知の代替ではない。自分のSBOM/検出を製品入力にするdogfoodingも、未完成の自己分析器だけを安全判定の正本にしない。

## CIとSummary

ローカルとCIが同じ固定依存・検査入口を使い、必要なOS/CPU、新規checkout/cache、有限のtimeout/concurrency、最小権限とAction等の固定を確認する。team運用ではbranchの役割とPR統合先・レビュー・必須checkを決める。main/develop、feature/bugfix/hotfix、必要ならreleaseを候補にし、既存の合意済みフローを維持する。設定payloadと実際の保護設定は区別する。

Summaryはsetup・監査・描画・保存それぞれの終了状態と未検査範囲を伝える入口にする。成功表示やupload成功で監査失敗を消さず、bootstrap失敗時にも出力できる手段を選ぶ。表示内容・非秘密artifact・保持範囲を決め、失敗・欠落・不正入力を含む受入を用意する。具体的な集計・escape・証跡照合は[原始結果とSummary](../../security-evidence/references/findings-and-summary.md)に従う。

## ログと異常検知

運用ログ、security event、業務監査、host/network eventを区別し、構造化schema、correlation/発生時刻、許可field、秘密/個人情報除外、権限分離/改ざん耐性を決める。container stdoutだけでなく、file、転送queue、検索先それぞれの容量/世代/保持、checkpoint、停止中の回転backup再取得、重複・欠落・disk full等を扱う。日数保持をvolume quotaの代わりにしない。

異常検知は信号と権限、閾値、陽性/陰性、古いログや既存alertの誤合格、通知先/当番/抑止、封じ込め・証拠保全・復旧を確認する。API拒否通知だけで侵入やhost IDS完成としない。実外部送信は依頼された範囲で行う。

## 最終証拠の対応

実コマンド・終了値・対象source/commit/未commit差分・lock・実行imageと結果を結び付ける。受入後に再buildでIDが変わったら、全RootFS・実行Config・OS/CPU等を検証して同一性を判断し、tag名やIDの見た目で付け替えない。

証跡は安全なfieldだけを抽出する。生serviceログ、認証付きURL、.env、container/image Config全文のENV等を無条件に保存しない。必要ならメモリ内で比較し、非秘密metadataや正規化hashを残す。ローカル資料を許可なくuploadしない。hash/単なるtrueだけを証明とせず、どの入力をどの実行で比較したか追えるようにする。

probe外の別コマンドで測った結果は別実行として記録し、実行済みprobeを後から書き換えて結果を生んだように見せない。初回失敗の記録を保持し、修正後の成功範囲と区別する。独立レビューは対象プロジェクトの手順に従い、実装者の自己評価と分ける。

ローカル、対応OS/CPU、新規runner、共有CI、実商用環境の成功を別々に判定する。スキル更新だけなら、その構造/参照検査と適用判断の検証を報告し、アプリやCIを新たに検証したとは言わない。
