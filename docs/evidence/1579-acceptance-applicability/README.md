# #1579 既存受入の範囲と現行差分への適用

2026-11-03。評価対象はmain `60d68920d3f925ede528993c44bd4bd67fc795e6`。本変更は既存Evidenceの記述と評価runnerの出力文言を是正し、製品runtimeを変更しない。sourceの照合結果は[source-applicability.json](source-applicability.json)、今回の実行結果は[verification.json](verification.json)に分ける。

## 判定と終了範囲

#1579の2026-10-18の終了条件に対して、下記の代表ケース、既存Evidenceの適用範囲、現行差分の回帰、未達・欠測を固定して終了可能と判断する。性能改善が不成立であることを未検証と混同せず、成功するまで同じ比較を繰り返す要件は追加しない。独立レビューと親branchへの統合後の対象照合は提出側で行う。この記録だけでmerge・公開を許可しない。

これは任意規模・全Host・全障害での完全保証、現在のSkillによる一般的なAI品質向上、v0.4への同条件の優位性の認定ではない。中断時の終端usageや総経過時間の欠測は残す。#1509のレビュー反復費用、#1541のUnicode互換性、#1622のHostによるSkill読込みの契機は各Issueが所有する。

## 代表ケースと確認できる事実

| 代表ケース | 既存Evidence | 確認済み範囲と限界 |
|---|---|---|
| 標準Hostでの複雑2 Issue・共有契約・統合 | [PR188の記録](../../reviews/consumer-acceptance/claude-saved-verification-delivery.json) | alpha.60、予約・請求、JPY変更と旧データ互換、内外6検証、提出HEADの独立PASS、Draft PR188・両CI、4 Contextのusage照合。191.78084904秒、875,676 observed processed tokens。評価者による実装・計画・結果回収の代行なし。単発で、中断は注入していない。 |
| 2稼働workerの保存後中断・新Context再開 | [PR156の記録](../../reviews/consumer-acceptance/claude-active-worker-interruption-result.json) | 全子停止後に保存成果から再開、両保存ファイルの提出時bytes一致、6検証・独立レビュー・両CI。元のjobs API監視はtimeoutし、CIは同HEAD・PR・workflowに拘束した後日の読取りで成功確認。無介入の連続runner成功や完全な総usageには数えない。 |
| 再開後の必要修正を含む統合 | [PR164の記録](../../reviews/consumer-acceptance/claude-host-mask-interruption-delivery.json) | 保存成果を確認し、必要な修正・統合・独立レビュー・内外6検証からDraft PR164・両CIへ到達。請求ファイルは修正されたため保存時と提出時のbytesが異なる。評価器の解析修復を挟み、総経過時間・中断前終端usageは欠測。停止・fresh Host起動は評価Hostの故障注入であり、自動復活daemonの実証ではない。 |
| 明示snapshot経路の予算中断と複数Issue失敗分離 | [受入記録](../../../v05/RELEASE_READINESS.json)の`publicSyntheticGoalRecovery`、`publicSyntheticIssueRecovery` | 固定source commitの合成試験。予算中断後の再開、依存Issueの停止、独立した成果の保持とDraft/CIを確認。任意crashや自律的なowner権限拡張の証明には使わない。標準Host経路と合算しない。 |
| 更新・rollbackとowner成果保護 | [同梱runtimeの隔離配布試験](../../../v05/evaluation/BUNDLED_RUNTIME_LIFECYCLE.json)、[従来の配布試験](../../../v05/evaluation/DISTRIBUTION_LIFECYCLE.json) | 固定archive hashで不正archive拒否、ownerファイル/index保護、別worktreeの旧版継続、明示rollback、uninstall/reinstallを確認。Linux隔離・ネットワーク遮断下の合成環境。disk-full・SIGKILL・電源断の原子性は試験していない。 |
| 同条件の費用比較 | [固定5組](../../reviews/consumer-acceptance/claude-worker-verification-summary.json) | 同じ複雑fixture・モデル・effortで両側5件ずつ品質・usage・Draft/CI成功。時間中央値209.332230179→210.884368685秒、tokens中央値853,426→846,343。双方改善は不成立。平均・最大値・全試行も保持し、同候補の追加試行を行わず性能用段落を撤回。v0.4比較ではない。 |

過去の成功は上記source/package/Host/oracleの範囲で保持する。後から追加反例で品質欠陥が見つかった旧cohortは合格へ戻さない。特に[accessor反例](../../reviews/consumer-acceptance/native-accessor-counterexample.json)や[初回Claude実装](../../reviews/consumer-acceptance/claude-complex-implementation.json)の見逃しと、是正後の固定oracleを備えた記録を区別する。現行で失敗が再現したとの主張も行わない。

## PR188の時間範囲の訂正

保持された原`delivery.json`のSHA256は既存の`sourceResultSha256`、`d6db8d1077cf9fe5527ba3dc7fdc4034b8738e0a697c9e3f26d913a27a2e86ed`と一致した。公開要約のHEAD・base・model・effort・review・内側検証・usage・両CI・介入数・時間を原記録と照合した。原記録に`interruption`/`interruptedUsage`はなく、故障注入のsetupと実行directoryも存在しない。

`scripts/run-claude-delivery.mjs`が中断を注入しないmodeにも中断・再開を含むという同じ`timingScope`を無条件に出していた。PR188の要約を「初回実行からCIまで、fixture準備除外、中断注入なし」へ訂正し、runnerは実際の`interruption`の有無で文言を選ぶ。原記録・SHA256・時間・tokens・成功状態は変更しない。PR188を中断再開の費用証明には使わない。

## 現行差分に対する追加確認

[既存調査README](../../reviews/consumer-acceptance/README.md)の53ファイルbyte一致は`25cf778a`までの観測であり、現在HEADへ延長しない。そこからの差分をGitと現在bytesで固定した。

- `goal-plan`・`adaptive-run`・`goal-restart`は64 unit/ruleの固定上限を撤去している。既存の大きなGoal、依存・循環・共有契約の拒否、64件を超えるrestart、予算・再開・candidate保持の試験を使う。AIが大規模Goalを完走した証明へは読み替えない。
- `project-assets`は配布対象とHost登録、古いpreimage保持、inventory上限を変更している。既存のowner編集保護、削除/renameからの復旧、並列worktreeの失敗分離、両Host登録、inventoryおよび実pack/install試験で確認する。
- `verification-output`の共通化とCLI追加は、既存の保存成功/失敗、外部出力先・symlink・上書き拒否、worktree検証とpackage起動試験で確認する。Dockerの削除候補表示は読取り専用の別機能であり、複雑GoalのAI実走成功へ混ぜない。
- `skills/asc/`とレビューの正本は変更されている。配布・参照・owner保護の回帰は確認できるが、その新本文のモデル挙動・費用が過去と同じだとは認定しない。現在のSkillによる新たな改善率を主張するための実走はしていない。

今回の回帰は既存テストを使用し、追加モデル呼出し、外部通信、Draft PR作成、過去の高価な比較の再実行を行わない。sandbox内での子process`EPERM`は環境失敗として区別し、明示した昇格実行で実検証する。

## 関連Issueへの依存

- #1541が`project-assets`・pack・Unicode pathの照合を変更した場合は、この記録の当該source hashに対する適用を再評価し、NFC/NFD・衝突拒否とowner保護の回帰を統合後に行う。本Issueはその既知の別所有の配布互換性を解決済みと宣言しない。macOS実機も未認定のままとする。
- #1622は導入案内から「発見・本文読込み・該当手順の適用」を代表Hostで別々に確認する。その新案内のモデル実走結果を本記録で先取りしない。将来の案内・登録変更は該当するHost登録/配布回帰を確認し、必要なHost実走は#1622側で所有する。
- #1509は同じ既知欠陥/正常対照での反復・時間・usage・見逃しを評価する。単発のレビュー絶対評価やPR188の最終PASSを反復費用の完了証明にしない。

本件で残す欠測・未証明と、各Issueが持つ具体的な変更範囲を明示することで、無期限の全環境Gateを追加せずに終了する。
