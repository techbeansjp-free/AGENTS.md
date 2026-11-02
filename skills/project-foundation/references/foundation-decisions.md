# 先行決定と検証の観点

各行の構成例は採用候補であり、一律の必須契約ではない。製品形態と既存規約に適用する行を選び、既存の規約・設定・実行結果と照合する。全行の実装や全製品の導入を要求する一覧ではない。まず現時点で不可逆性・横断影響の大きい判断を確定し、機能固有の具体値には有効化条件を付ける。

各判断の最小記録は「決定・理由／適用する境界／設定と機械検査または手動証拠／状態／未決なら有効化前の担当作業」。既存の台帳やIssueを利用し、同じ規則を複数文書の正本にしない。

詳細は対象に応じて[契約・型・画面・データ](contracts-and-ui.md)、[実行環境と並行開発](containers-and-worktrees.md)、[検証・セキュリティ・証跡](verification-and-security.md)を読む。

## 共通する基盤

| 観点 | 先に決める内容と確認する失敗経路 |
| --- | --- |
| 範囲と出口 | 開発環境、製品機能、商用配備の範囲。対応OS/CPU、チームと稼働、権限・外部接続。ローカルと共有CIの完了を分け、未確認の対象環境を支持済みとしない |
| 構造と責務 | source/test/infra/doc/generatedの所在、bounded context、domain/application/adapter等の依存方向、composition root、公開境界。単なるfolder名でDDDを満たしたとしない |
| 循環と停止 | module解決、型参照、再export、package初期化、生成物、alias/dynamic importの検査範囲。event/retry/state遷移の進捗・上限・中断。graph内の業務上の循環とは区別する |
| ツールと供給網 | runtime/compiler/managerの固定、lockとchecksum/digest、install script許可、licenseと配布条件、更新/廃止手順。必要なhost前提・proxy/通信先・権限を明示する |
| 共通コマンド | Makefile等の短い共通入口とhelp、READMEの前提/初回構築/起動先/停止/復旧。CLIとCIが同じ正本を使うbootstrap/doctor/check/test/build/audit。初回に未導入のツールを要求しないこと、入口から既存タスクへ委譲して失敗終了値を保持することを検証する。IDE独自設定や個人のPATHだけで成功しない。設定の欠落や破損を明示的に拒否する |
| 設定と秘密 | 型、必須/既定、優先順位、秘密生成/保管/更新/失効、権限、symlink、既存値保持。env・build context・生成物・browser・ログ・artifactへの漏えいを防ぐ |
| 環境の所有 | local/test/CI/staging/prod、worktree間の名前・port・volume・image tag。既存プロセスを強制停止しない。部分起動・INT/TERM・cleanup失敗とvolume保持を確認する |
| Worktreeと公開port | 既存運用に応じたport割当（例：root checkout固定値の予約とlinked worktree/環境の衝突時自動割当）。共有予約の排他・socket使用確認・起動直前競合の有限retry、own稼働の再利用、停止後の割当保持、接続先とテストの共通state・実URL表示。秘密を再生成せず他プロセスを停止しない。内部port、host dev/E2Eとの対象境界も決める |
| 規約の強制 | lint/format/型/依存方向/循環/schema/生成差分の検査対象、無効化構文や例外の範囲。命名・文字コード・改行・時刻基準。変更時の互換性・移行と規約版を一緒に管理する |
| Gitとチーム運用 | release頻度/配備方式に合うbranchモデル、PR統合先/merge方法、release/hotfixの戻し、必須CI・保護・実在担当者。developやGitFlowを全案件へ固定しない。1名の自己確認と他者承認を区別する |
| CIと再現性 | 新規checkout/cache、対象commit、OS/CPU matrix、実接続、timeout/concurrency、失敗診断と保存期間、権限最小化。workflow定義とremote実行成功を区別する |

## 型と外部契約

| 観点 | 先に決める内容と確認する失敗経路 |
| --- | --- |
| 型と検証 | strict、any相当/型断定/抑制の禁止境界、未信頼入力の検証、null/欠落/未知field、数値/文字列の暗黙変換、SDK/生成物の限定例外。型が正しいだけで入力を信用しない |
| Schemaと生成 | 通信/設定/イベントの正本、生成方向と所有、生成物の手編集禁止、再生成差分・不要物除去。ドメインとtransportの翻訳境界、破壊的変更の検知 |
| 正常応答 | versioning、識別子、値の表現、日時/精度/単位、status/header/body、空結果、pagination/filter/sort。envelopeの有無を選択し、レスポンスごとに勝手に変えない |
| 異常応答 | HTTP等のstatusと安定error code、利用者向けmessage、validation field path、correlation ID。404/405・未認証/権限・競合・rate・依存timeout・未知例外も同じ契約へ。内部例外/秘密を返さない |
| 再送と更新 | timeout/cancel、retry可否と上限・backoff、冪等性、二重送信、競合/楽観lock、部分成功と復旧。切断後も副作用が完了し得る場合の照会・再送を定める |
| 信頼境界 | identity/session、tenant、認可・権限変更、CSRF/CORS、入力/出力/URL、SSRF、upload制限、外部命令やAI出力の扱い。非公開とloopbackは認可の代替にしない |

## UIがある場合

| 観点 | 先に決める内容と確認する失敗経路 |
| --- | --- |
| 画面駆動 | 利用者・目的・画面遷移、loading/empty/success/validation/denied/conflict/error/retry/cancel、入力保持、再表示、連打/戻る/再読込を受入へ。見た目だけで完了にしない |
| 状態の所有 | 業務判断/永続化の正本、server cache、URL状態、formと局所UI状態の区別。DTOの別storeへの複製、認証/tenant切替後のcache残留、取消・鮮度・自動retryを検査する |
| トークンと部品 | primitive/semantic/componentおよびlayout tokenの正本、spacing/size/breakpoint/color/type/layer/motion、命名/生成/参照。共通UI→機能部品→画面の合成、登録/例外/追加手順。画面内の値直書きや共通UI迂回を検査する |
| 入力と表示 | schemaに沿うformと安全なerror表示、認可による操作可否、保存/通信UTCと表示timezone、locale、機密表示/持ち出し、長文/overflow、responsive |
| Accessibility | semantic要素、label、focus/keyboard、dialog/validation通知、contrast、reduced motion。部品単体と実画面操作を確認し、自動検査だけで全適合としない |
| モックと実接続 | 必要なHTTP/外部境界だけmockを使い、契約に追従。通常の実接続と障害再現を選べるようにし、productionへmock/開発endpoint/秘密を含めない |

## 保存・検索・非同期がある場合

| 観点 | 先に決める内容と確認する失敗経路 |
| --- | --- |
| 正本と投影 | transaction境界、整合性、識別子とtenant/削除、outbox/inbox、再構築/再送/水位。複数DBへ二重書込して整合したとみなさない |
| Migration | 版と命名・時刻基準、適用順、衝突/複数head、constraint/index、seed、lock/timeout、互換リリース。日時prefix採用時も過去revisionを勝手に改名せず、同秒衝突と順序を扱う |
| Graph | node/edgeの意味・向き・多重辺、identity/unique、provenance/時点/削除、探索深さ・循環・計算量・制約/index。投影の再構築とSQL等の正本との整合を試す |
| Vector/検索 | 用途、語彙/全文/graphとの組合せ、model/版/dimensions/距離/正規化、schema/index、tenant filter、再embedding、削除反映、評価集合と閾値。未選定modelで適当な次元を固定しない |
| オブジェクト | interfaceとprovider Adapter、非公開・短期URL・サイズ/checksum/content type・上書き・削除・権利/保持。S3互換のCRUDだけでversioning/Object Lock等も互換としない |
| Worker/queue | delivery保証、重複/順序、冪等性、再試行/隔離/DLQ、取消/停止、backpressure、poison messageと監査。broker導入を目的にしない |
| Backup/restore | DB/object/投影・秘密・設定の対応、RPO/RTO、移行と復旧の整合・checksum、破壊操作の権限。backup作成だけでrestore成功としない |

## 検証・セキュリティ・運用

| 観点 | 先に決める内容と確認する失敗経路 |
| --- | --- |
| テストの役割 | Unit/結合/E2E/公開境界blackbox、Gherkinの正常/拒否/失敗/回復、mock/real分類、fixtureと実データ禁止、並行分離・coverage対象。各層の成功で一連操作の欠落を隠さない |
| 自己監査 | lock依存と全実体build-stage/実行imageのOS・言語依存、対象OSの支持期限、SBOMとlicense。開発端末管理は製品ゲートから分け、本番/CI基盤は所有範囲を定義。scanner/DB時刻・digest/image ID・raw hashを保存。ビルド中の旧imageやstaleレポートを最終対象の合格に流用しない |
| 環境とimage派生 | 環境別依存とtarget/overlay（例：PRD最小runtime→STG/プレビュー→DEV）。秘密・data・project名/volume/portを分離し、無目的な追加package、PRDへの開発tool混入、逆方向COPYを防ぐ。全targetをbuild/監査し、PRDには実行依存だけがあることを検証する |
| 実行の防御 | 最小権限、image既定USERと配備設定の実効UID/GID、非root方針と初期化権限の必要性、rootfs/capability、公開port、TLS、秘密注入、依存接続、health/readiness、resource制限。rootless daemonと非root imageを区別し、通常initのroot依存を避け、新規volume copy-up/既存所有者不一致時の明示移行を検査して、doctorと実プロトコルの成功を区別する |
| ログと監査 | 運用ログ/security event/業務監査/host eventを区別。構造化schema、correlation・発生時刻、許可fieldと秘密/個人情報除外、改ざん耐性/権限分離、監査失敗時の扱いを決める |
| 回転と欠落 | file/stdout・転送queue・検索基盤の容量/世代/retention、checkpoint・元時刻・重複、停止中backupの再取得、disk full/queue overflow/長期停止、独立した欠落/容量監視。日数保持はvolume quotaではない |
| 異常検知と対応 | アプリ信号とhost/network IDSの対象・権限、閾値、陽性/陰性・古いログ・既存alertの誤合格、外部通知先/当番/抑止、確認/封じ込め/証拠保全/復旧。auditだけで侵入検知済みとしない |
| Portabilityと費用 | 標準protocol/形式、業務portとprovider Adapter、provider固有機能の必要性・代替・出口コスト、export/restore/切戻し。単一providerの成功と第二環境への移行を区別し、特定cloudや有償サービスを暗黙に必須化しない |

## 決定から実行への対応

採用する各行は、正本の所在・実装/設定・機械検査・実受入・未確認範囲までつなげる。型/lintだけでは認可、graph探索、復旧、移植性を保証しない。既存のチェックを弱めるために規約を変更しない。異なる文書・issue・コマンドへ同じ判断を二重定義せず、正本を参照する。

## 見積り・記録の扱い

検査に必要な作業を含め、実装単位を受入可能な大きさへ分割する。既存の分類・階層・計画周期を使い、成果・出口・実装/検証・依存を実在の稼働規模と受入へ対応付ける。Issue/Projectを使うかは既存運用と依頼範囲に合わせる。稼働とレビュー/検証/運用の容量を分け、拡張範囲で旧スプリント/ロードマップの前提が崩れたら再見積りする。未決や外部承認待ちを日付で自動完了にしない。
