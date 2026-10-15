# ADR 0001: v0.5.0をIntent・Risk・Evidence中心の正式版として準備する

2026-10-14。状態: 方針承認済み、実装・受入未完了。ユーザーの「この方針で、v0.5.0をリリースできる状態にして」を根拠とする。公開・merge・releaseの実行は含まない。

2026-10-15追補: 最新の簡素化原則と承認済み境界は[ADR 0002](ARCHITECTURE_DECISION_0002.md)を参照。受入未完了は継続する。

## 決定

v0.4.xへの高速化機構の追加を止め、PR #1577をDraftで凍結する。独立PoCの保証を検証し、v0.5.0候補へ育てる。既存ASC本体・利用者projectを自動変更しない。独立repoの既存worktreeを使い、旧Evidenceを保持する。

中心はGoal（目的）・Risk（リスク）・Evidence（証拠）・Proof Obligation（証明責務）。完了はGoal達成と必要な保証の成立で決まり、固定Step完了では決めない。SPEC/DESIGN/IMPLEMENTATION/VALIDATIONは活動分類であり必須の直列工程ではない。不足責務と依存関係から次の仕事を選ぶ。要求・policy・HEADの変更で失効した証拠だけを再取得する。ただし正しく失効範囲を限定できない場合は安全側に再検証する。

実行の基本はfresh実装Agentとfresh独立Reviewer。2 Agentは上限ではない。追加設計・反証・承認は、未解決の要求、不変条件、危険な操作に必要な場合だけ追加する。Agentの安全自己申告を権限へ昇格しない。Git、要求、policy、実行された検証、独立review、PR/CIの対象を拘束する。StepやJournal、Sealの存在自体を受入条件にしない。それらが防いだ失敗を代替構造で防ぐことを受入条件にする。

trusted controllerだけがContract、Git正式化、検証、Delivery権限を持つ。Agentは必要なsourceを読書きする。provider認証をAgent tool環境へ渡さない。認証されたmodel通信とAgentのtool networkを区別する。OS拒否、モデルの自主拒否、approval拒否、後段diff拒否を別々に記録する。

## 段階と停止条件

- alpha: 実装Agent全体の権限、独立review、HEAD/要求拘束、失敗・中断・再開を実証。未対応hostはfail closed。
- beta: 文言/バグ、React、Laravel/API、認可、DB migrationで共通oracleと敵対試験を行う。正常系だけで採用しない。
- release candidate: 移行dry-run、非破壊移行、rollback、配布物からの再現、CI、独立reviewを通す。
- v0.5.0 release-ready: 品質・安全・性能・移行の全受入が成立した場合のみ。version文字列やテスト件数だけで昇格しない。

性能は同じfixture・モデル/effort・配布資産・権限・oracle・review責務・Draft作成・開始終了で比較する。失敗を含むwall time、起動数、retry、usage coverageを残す。欠測はnull、取得できた分は下限。既存123秒と1,574秒から倍率を算出しない。各群反復と分散を示す。条件が揃わない群は別枠にする。

## Draft契約の整理

凍結de8fd6acの規範文書とCLI/adapterを確認した範囲では、全PRをDraftで作る製品契約は確認できない。標準create引数に--draftがなく、明示的Draft設定も見つからない。通常PR作成は今回の実験条件との不一致であり、これだけで製品不具合と断定しない。

v0.5候補ではownerがDelivery種別を明示し、比較では最初からDraftを指定する。作成後のDraft化を同条件成功に数えない。凍結ASCを比較に使う場合、明示的な実験用変更とそのhashを別に記録する必要がある。通常PRを許す設定を無断で変更しない。

## 未完了

現PoCは固定fixture用Python prototype。一般project向け製品CLI、配布、v0.4資産の移行、rollback、全Agent境界、高リスク追加処理、同条件反復比較が未完了。既存テスト成功を正式版の完成と扱わない。

## 実装済みの責務選択（部分実装）

Controller.next_workは確定候補について現要求・Contract・HEADに有効な観測を評価し、clarify/design-approval/verify/independent-review/deliveryを返す。Git不正を実装作業と誤認して自動修復しない。共通fixture経路へ接続済み。これは一般的なリスク分類・設計承認・候補作成全体の実装完了ではない。

## 高リスク候補の責務（部分実装）

ownerが分類したauthorization/data-migration/public-contractでは、明示設計・Contract/base拘束のowner承認・リスク固有検証を必要とする。不明カテゴリや未解決要求は停止。承認はtrusted host portから取得し、Agent申告JSONを直接受け付けない。認証済みの実運用承認adapterは未実装。中立名service.pyの認可漏れを実隔離で拒否するfixtureと、承認変更/再試行/再起動の失効テストがある。DB migrationの実走や全リスク自動判定が完成したことは意味しない。

## Node実行本体（評価実装）

Node標準ライブラリのControllerを追加した。固定Stepを導入せず、未実装ならimplementation、署名不足ならdesign-approval、現HEADの検証不足ならverify、その後independent-review/deliveryを選ぶ。署名はhost固定Ed25519公開鍵とContract/base/run scope/期限を照合する。実装Agent・Reviewerの実起動までNodeから接続したが、正式配布の受入完了ではない。Python版は比較・回帰の参照として保持する。最新の未完了事項はNODE_ENGINE_EVIDENCE.mdとRELEASE_READINESS.jsonを正本とする。
