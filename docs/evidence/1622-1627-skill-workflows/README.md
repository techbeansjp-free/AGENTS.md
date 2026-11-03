# Issue 1622〜1627の現行照合と検証

## 判断

- #1622: 配布・登録と実適用は別だった。USAGEへ所有者が採用できるAGENTS.md/CLAUDE.md文例を追加。自動上書きは追加しない。
- #1623: 更新コマンド・競合・復元は既存。新Skillを増やさず、ASCからworkspace referenceを読み利用先・版・Host・結果を対応付ける導線を追加。
- #1624: review referenceへmerge直前の許可・CI・対象HEAD・base・指摘処理・依存PRからpost-mergeへの接続を追加。mergeの自動許可や無条件base更新は追加しない。
- #1625: 同じreferenceへHost起動例と通知/実行IDでの回収、終了と結果欠測の区別を追加。Claude実機は本環境にないため実証済みとしない。プロンプトread-onlyとOS/toolの強制制限を混同しない。
- #1626: 作業調整だけでは起票・field・途中作成を扱わないため、任意tracker-issue-writing Skillを追加。tracker固有API/IDは埋め込まない。
- #1627: 通常の全Skill登録へ協議を入れると明示限定を落とす恐れがある。Codex向けpolicyを含む任意原本をv05/optional-skillsへ分離。通常の両Host登録では一切登録せず、利用者がdirectory全体を明示採用する方式に限定。Claudeへの自動変換は提供しない。

## 実Host観測

Codex CLI 0.164.0-alpha.11.1、gpt-6.1-sol medium、ephemeral、各依頼1回。実配布した空Git worktreeへ案内文例を採用し、任意協議Skillはpolicyを含む全directoryをコピーした。通常8ケースはread-only、追加のtracker再開だけworkspace-writeで合成状態を変更。実trackerへの公開・個人設定変更はしていない。全ケースは合成で、統計的な発火率ではない。

| Case | 観測した読取り・適用 |
|---|---|
| dev | ASC正本→workspaceを読み、実startでworktree/規約/HEADを確認。追跡済み差分なし・未追跡を勝手に削除しない |
| merge | ASC正本→reviewを読み、実行中CI・別HEADレビュー・remote不明のため保留。可否判断からmerge許可を推定しない |
| update | workspace→USAGE/MIGRATIONの正本を読み、競合は未更新、別worktreeの旧版保持、利用先ごとの結果を区別 |
| review | review referenceを読み、独立Contextと実tool制限、実行IDでの回収、欠測を未完了と区別。今回は説明のみでReviewer起動はしない |
| tracker | 入口→本文を読み、重複候補・廃止field未確認を下書きへ明示。作成/公開なし |
| deliberation-negative | 通常の設計Skillだけを読み、任意協議Skillを読まない |
| deliberation-explicit | 明示選択で任意Skillを読む。利用可能モデル1種類の条件では複数モデル協議未実施とし、同モデルcontextを代用しない |
| nondev | 翻訳のみ。コマンド実行なし |

JSONLはfixture絶対pathだけ正規化し、成功宣言だけでなくcommand completionと出力を照合した。[cases.json](cases.json)、[observations.json](observations.json)、[source hash](source-sha256.json)を保持する。run.mjsは引数に隔離rootを受け取り、そのworktreeへ上記配布と案内採用後に実行する。元の呼出し条件を再現するもので、oracleはmodelへ渡さない。

### trackerの作成途中からの再開

合成API tracker.mjsで、作成応答喪失後にIssue17が存在する状態を準備した。旧設定は廃止field8、現APIはfield19。modelはfields/list/showで照合し、`update 17 19 High`を1回だけ実行してshowで読み戻した。最終tracker-state.jsonにはIssue1件、操作はupdate1件のみ。親Issue3と本文を保持し、二重作成なし。実trackerのAPI互換性は未検証。

### 権限制限と複数モデルの証跡の限界

sandbox-probeではモデルがread-only書込み拒否を報告し、marker内容は変わらなかった。しかしCLI JSONLにcommand executionが出ていないため、OS強制拒否の実証とは数えない。別のsandbox CLI診断も起動要件で失敗し、引数だけで保証しない規約を維持した。

deliberation-two-modelsではモデルが2種類の独立検討を報告したが、CLI JSONLにはspawnのモデル指定が出ずwaitだけが観測された。このCLI結果だけで2モデル実行を認定しない。別途親Hostの実際のspawn_agentでgpt-6.1-sol/gpt-6-sol、fork_turns:noneを明示し、同じ合成課題・本文を渡した2つの独立意見を取得した。引数・返されたAgent名・回答原文を[親Host観測の転記](parent-host-deliberation.json)に保存する。署名付きHost監査記録ではなく、Reviewerによる実行事実の独立認定とは分ける。これは起動モデルを観測できる親Hostでの手順確認であり、CLIの不完全なtraceを補完した同一実行とは扱わない。

両意見はDB outbox+workerを推奨し、同期送信でも保存成功と切り離せること、通知必達/欠落許容が未決であることを指摘した。進行役の統合では、人数ではなく要求への適合を根拠にする。与件だけなら保存確定後の有限timeout同期送信も要件を満たし、通知必達まで承認されたとは扱えない。少人数運用への暫定推奨は同期方式、欠落を許容しないと判明した場合は同一DBへの送信予定永続化へ変更する。これは設計推論であり実装性能の実測ではない。

## 配布・提出

15通常登録Skillと任意原本2ファイルで両Host時282 assets。保持preimage12件を含む上限294を維持する。任意原本はmanaged-runtime内だけへ配布し、両Hostの通常登録に混入しないことを実テストした。利用先が手で採用した任意Skillの更新は自動管理しない。

package変更には品質契約19→20の先行proposalを用意し、現mainに対する登録candidate・登録済み状態に対する実装candidateのbase validatorが合格。検査器を緩めていない。初回配布検査はリンクのfragment/HTTPSをファイル名と見なすテストの誤認で失敗し、正本byte一致を維持したまま外部URLとローカル参照を区別した。最新のCI結果と独立レビューはPRに記録する。
