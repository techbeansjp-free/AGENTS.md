# 実行環境と並行開発

コンテナ・複数環境・worktreeを使うとき、採用する範囲を読む。コンテナが不要な製品へ導入を強制しない。

## 再現可能な入口

runtime/package manager/依存を版・lock・checksum/digestで固定する。リポジトリには再現用の設定/取得手順を置き、ツールbinary・cache・秘密を無目的にGitへ含めない。project-localな導入が要件ならbootstrap・cache・PATHもそのcheckoutへ閉じる。個人のグローバル環境を暗黙に更新しない。

初参加者が短い共通コマンドでbootstrap→doctor→起動→品質→実接続/監査→停止を実行できるようにする。READMEで前提、初回コマンド、構築だけ/全検証の違い、実URL、失敗時の確認先を示す。Make等は既存taskへ委譲し、処理や規約を二重定義しない。pipeline/tee等でも本来の終了値を伝える。

## PRD→STG→DEV

環境を分ける場合の構成例として、最小PRD runtimeを土台に、STG（preview）へ必要な設定/依存、DEVへ開発・試験用設定/依存を足す。必要なものがなければSTGにpackageを追加しない。言語compiler、package manager、テスト/デバッグ/監査オーケストレータ等は用途のある環境/専用toolへ分離する。製品へ開発用依存を混入させないことを確認する。同一成果物の昇格や独立したbuild stage等の既存方式でも、この境界を満たせばよい。

builderからは必要な成果物/実行依存だけを渡す。既定targetとmode選択を明示し、配布用buildが意図した最小runtimeを生成することを確認する。STGは同じ業務成果物と本番相当の安全設定を保ち、秘密はbuildに埋めず環境別に注入する。独立した承認なしに本番データ/資格情報をDEV/STGへコピーしない。

DEVの実起動も確認する。実行binaryだけでなく共有ライブラリ、packageの実際の入口、内部DNS/API proxy、Host検証、memory、cacheの書込み先が必要である。proxyを動かすために認可/TrustedHost等を無条件に緩めない。source共有は必要なdirectoryだけとし、host node_modulesや秘密を丸ごとmountしない。watch/bindの可視性とserver reloadは区別し、作成・変更・削除、外部ディスク/仮想化での通知、必要な明示再起動を実測して手順にする。

## 非rootと状態の所有

実行imageと配備設定の実効UID/GIDを確認し、非rootを優先する。DB、一時init、STG/DEVも対象とするが、公式imageや基盤が要求する初期化権限は用途・期間・対象を限定して評価する。project契約が全段非rootを要求するならその条件を検査する。起動後の降格と起動時からの非rootを区別して報告する。インストール等のbuilder管理権限とは分ける。capability削減、no-new-privileges、rootfs read-only、書込みvolume/tmpfs、loopback公開、health/readiness、資源制限を用途に合わせる。必要な書込み例外は対象directory/環境と理由を明示する。

rootless daemonは別の配備基盤設定であり、USERだけで実証済みとしない。個人のOS/Docker Desktopの資産管理を製品の必須ゲートへ広げない。本番/管理CIのOS・kernel・runtimeは所有責任と配備範囲で別に検証する。

通常initをroot/chown頼みにせず、新規volumeのcopy-up/事前provision等で所有権を整える。既存volumeで不一致なら明示的に失敗させ、backup・対象を確認した移行へ分ける。再帰chownやresetを暗黙実行しない。既存データ保持と、既存volumeを接続しない新規初期化の両方を確認する。

## Worktreeと公開port

Git等の実metadataでprimary checkoutとlinked worktreeを識別し、branch/フォルダー名の推測に頼らない。worktree利用時の初期方針はrootの既定portを固定予約し、worktree/環境は衝突を避けて空きportへ割り当てる。既存の別運用が合意済みならそれに合わせ、root後起動・同時起動の受入を満たす。

- root未起動でも固定値をworktreeに取らせない。rootの衝突では勝手にずらさず、他プロセスを停止しない。
- 共有予約の排他制御と実socket/Docker公開情報を使う。稼働中の自分のportを誤って外部競合としない。前回割当を再利用できなければ元の希望から有限候補を探し、範囲を無制限に延ばさない。
- 確認とDocker bind間の外部競合は残るため、そのエラーだけを有限回再割当する。build/health/認証等の失敗をretryで隠さない。
- 非秘密の割当stateを原子的に保存し、別checkout/modeへの流用・不正値・危険なsymlinkを拒否する。秘密ファイルをport調整で再生成しない。
- Compose等、DB接続/migration、診断、テストが同じ実割当を読み、実URLを表示できるようにする。環境変数と生成stateの優先順位を定める。内部portとhost dev/E2Eの対象範囲を分ける。
- project/container/network/volume/image tagも独立性を確認する。共有するtagを別worktreeのbuildが更新しないか、監査中のIDが失効しないかを扱う。管理用project/file/env-file/任意publishで予約を迂回させず、run/execのコマンド本体はCompose optionと区別する。

停止後の再利用と、削除済みworktreeの予約整理を決める。status/log/config/down等が勝手に再割当して実稼働とずれないことを確認する。

## 起動・中断・移植性

既存資源と今回起動した資源を区別し、部分起動、INT/TERM、timeout、cleanup失敗でも所有するものだけを整理する。通常停止でvolumeを削除せず、必要な場合だけ明示的なreset手順へ進む。再起動で同じ秘密/データを保持する。

HTTP/OpenAPI、OCI、JSON/OTLP、DB protocol、S3互換等の境界を使い、provider固有の機能はAdapterと設定へ閉じる。必要性・代替・出口コスト・export/restore/切戻しを確認し、単一providerの成功を移植完了としない。ローカルComposeの成功を商用配備の完成と扱わない。
