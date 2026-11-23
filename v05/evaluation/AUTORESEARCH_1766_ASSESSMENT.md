# ASC改善案の固定評価による自動反復の必要性調査（Issue #1766）

2026-11-23。結論：**現時点では実装不要（Phase 1以降は実施しない）**。ADR 0005の例外7条件のうち、条件5（対照評価で総費用の価値を示す）と実測された必要性（置き場所の判定表「実測された失敗や費用があるか」）を満たす根拠が、Phase 0で示されなかった。再開条件は末尾に置く。

## 1. 調査時点

- main完全SHA：`98afe3500b5e1cbeedb396434f1f8f2e6ae5ba4f`（Issue起票時と同一）。
- 対象は現行v0.5のtree（`skills/asc/SKILL.md`、`v05/`、`scripts/`、`src/`）。標準Host経路と、owner明示選択の`--snapshot`経路（ADR 0005の表）は区別する。旧v0.4（#1486等）の実験成果は現行機能として扱わない。
- 配布版：`package.json`のversion `0.5.0`（mainのtree）。Host：Claude Code 2.1.323（調査者の端末で実行したHostの版。Codex・各モデルの版は本調査で使っておらず未取得）。標準Host経路の調査で、`--snapshot`経路は実行していない。
- 調査者の端末：Darwin、`bwrap`なし。Linux専用の隔離（後述）は実行できないため、動作確認ではなくコードと既存テストの読取りに基づく。実モデルの実験は、Phase 0のみで結論したため行っていない。外部サービスへリポジトリ内容は送っていない。autoresearch原典の内容は、Issue本文の引用に依拠し、再取得していない。

## 2. ASCが既に持つ能力と持たない能力

| 目的 | 既存の手段（読取り確認済み） | 状態 |
| --- | --- | --- |
| 要求・Evidence・HEADの束縛、古いHEADへのEvidence流用の拒否 | ADR 0005の1〜4、`skills/asc/SKILL.md`、`worktree-verify` | 既存 |
| 独立Reviewer（別Context）による元要求・実差分の検査 | `skills/asc/SKILL.md`、`v05/evaluation/review-corpus.mjs`、`scenario-corpus.mjs`、`scenario-review-results/README.md` | 既存 |
| baselineと候補の対照比較（同条件の強制） | `scripts/native-pair-summary.mjs`（冒頭に注記があるとおり固定の合成fixture専用。5組・draft PR・CI全緑・review PASS等のnative delivery固有の受入条件を含み、任意のASC改善へ一般化できる根拠は無い）：Skill・runtime・Reviewer条件・モデル・base・コマンドの同一性、HEADの重複なし、検証のHEAD一致、時間・usageの欠測を判定。`test_native_pair_summary.mjs`が通る | 既存（固定fixture用の組比較。一般化は未確認） |
| 反復実験の記録と採否の判定規則の事前固定 | `v05/evaluation/graph-runtime/PHASE1_ADAPTIVE_PROTOCOL.md`（結果を見た後に閾値を変えない）と`PHASE1_ADAPTIVE_RESULTS.json`。ADR 0004に採否を記録 | 既存（実験ごとの手作業の運用） |
| 評価用のHost制約 | `scripts/claude-evaluation-settings.mjs`（Claude Codeのsandbox設定。保護パスへの`denyWrite`、履歴ディレクトリの`denyRead`、`failIfUnavailable`、ネットワーク許可なし）、`scripts/native-evaluation-launch.mjs`（`clean-linux`で`bwrap`で`/usr`等を読取り専用bind、synthetic rootと`CODEX_HOME`を書込みbind、`/tmp`はtmpfs。provider用にネットワークは遮断せず、内側のCodexの権限が正本） | 評価専用。どちらもソース中に「Evaluation only」の注記がある。一般の隔離安全性を示す根拠は読取りでは見つからない |
| 改善案の**自動生成→隔離実験→棄却／採用候補の選別**の反復 | 該当する機能・Issue・PRは見つからない（`gh issue list`と`gh pr list`で`autoresearch`等を検索。全履歴・未公開運用の不存在証明ではない） | **持たない** |
| 失敗した候補の集計除外を検知する機構 | `native-pair-summary`は呼出し側が明示した組だけを集計する。除外された候補の有無は検査しない | **持たない**（未検証） |

autoresearch型反復との差分は、実質的に「候補の自動生成」と「無人の反復」の2点である。比較・判定規則の固定・Evidenceの束縛は既に手段がある。ADR 0005の「原則の存在と候補自動生成・反復の機能の存在は別」という整理は正しい。ただし、機能が無いことは必要性を示さない。

## 3. 既存評価資産の再利用性（ファイル名だけで認定しない）

- 実行したもの：`node --test test/test_claude_evaluation_settings.mjs test/test_native_evaluation_launch.mjs test/test_native_pair_summary.mjs`。21件すべて合格。コードを読み、隔離の範囲を次のとおり確認した。
- `claudeEvaluationSettings`が書込みを拒否するのは、引数で渡した3つの保護パス（distribution・owner・captureFile）に限る。書込みを許すのは`origin`一つで、保護パスが`origin`の内側にある構成は拒否する。強制の主体はHostのsandboxで、ASCの機構ではない。
- `native-evaluation-launch.mjs`の`clean-linux`は`process.platform==='linux'`かつ`/var/tmp/asc-native-(complex|delivery)-*`のroot限定。macOSでは使えない（本端末はmacOSで実行できず、テスト合格はこのLinux経路の実動作を示さない）。
- 以上から、Issueが求める「oracle・baseline・予算を、候補Agentの変更対象とOS権限で分離」は、評価用の既存部品を**固定したfixture**でならHostのsandbox範囲内で成立しうるが、任意のASC改善テーマとpathに一般化できる根拠は無い。一般化には、テーマごとにpath集合の設計と、Host別の実動作確認が要る。

## 4. 代表課題での障害の実測：#1737 Phase 1（Adaptive-lived Context）

ASC自身の改善案を固定条件で比較した最新の実例として、`PHASE1_ADAPTIVE_RESULTS.json`から数値を再集計した（機械的な集計。値はファイルの記録そのもの）。

- 試行数5（xl 1件、xxl 4件。baseline-adaptive-adaptive-baselineの2組を含む）。processed tokensの合計は**約3.48億**（24.6M、85.4M、60.4M、50.7M、126.9M）。wall-clock合計は27,143秒（約7.5時間）。
- 組ごとの結果は、所要時間比が1.908と1.131、処理token比が0.708と0.399。token条件は満たしたが所要時間条件（中央値120%以下）が1.429で不成立となり、採用しなかった。所要時間は2組の間で大きく揺れた。この差が順序・時刻・arm効果・ノイズのどれによるかは2組では分離できず、「ノイズと区別できる改善」を言い切れない（ノイズの大きさ自体は推定していない）。
- 前提条件（baseline側の平均入力130k以上）がxlでは不成立（観測109,114）で、xxlへ規模を上げて再実行した。環境の不具合（macOSの`/usr/bin/git`のshimとlogin shellの`path_helper`）への対処は、試行前の動作確認・中断で見つかり、harnessの修正（xlとxxlでharness commitが異なる）を要した。専用harnessの整備にどれだけの手間がかかったかは定量記録が無く、未測定である。
- 所見：既存手段（事前固定プロトコル＋単発の組比較＋ADR記録）で、採否は一貫して下せている。記録から読める障害は、「反復の自動化の欠如」としては現れておらず、1試行あたりの費用（25M〜127M token、約0.5〜2時間）と、2組での所要時間の揺れである。ただしこの費用はContext引継ぎという大規模な実モデル実験のもので、決定論的oracleだけの安価な評価には当てはまらない。

また、`scenario-review-results/README.md`の評価（Reviewerの変更）でも、各armの起動数は1、tokensは`null`（未取得）で、7/8対7/8という差の無い結果だった。小規模な固定corpusでは、品質の差を検出できるだけの検出力が未確認である。

## 5. 判定

### 5.1 Issue本文の完了基準との対応

- Phase 0の項目：SHA・配布版・Host・経路は1節、評価資産・スクリプトは2〜3節、関連Issueと代表課題は4〜5節に記録した。ADR 0002（必要な品質を最小の仕組みで保証し、候補の自己承認とEvidence流用を禁じる）と`skills/asc/references/implementation.md`（差分に応じた実テスト・再読込抑制・既存テスト再利用）は読み、2節の「既存の手段」の根拠とした。ただし実装コード（`src/`）の網羅的な読取りは行っておらず、能力の対応付けはSkill・ADR・scripts・既存corpusに基づく。
- 関連Issue：#1648（グラフ型runtime、導入せず）、#1737（Adaptive-lived Context、導入せず、上記）、#1738（責務境界、ADR 0005）、#1755（Context更新はHost主導。クローズ済み。測定を費用からowner判断待ちとする記述はADR 0005にある）、#1579（受入済み）、#1576（全工程の計測統合。owner判断のv0.5刷新に置き換えられクローズ。速度・token削減の達成とはしない）、#1486（旧v0.4、現行機能として扱わない）、#1765（別Issue、OPEN）。これらの実験・責務を再実装しない。
- 「改善余地が示されなければPhase 1以降を行わず『新しい実装不要』で完了可能」の条件を、次の理由で適用する。Phase 1〜3は**実施していない**。実施していないため、Phase 2の反例検証（テスト削除、oracle改ざん、失敗候補の除外等）とPhase 3のA/B/C対照の数値は**欠測**であり、推測で埋めない。

### 5.2 実装しない理由（根拠）

1. **追加価値の実測が無い**。ASC自身の改善で、採否の判定ができなかった事例、または既存の比較で見逃した悪化の事例は、Phase 0の調査範囲（本書の資産・Issue・PRの検索）では見つからなかった。範囲外の不存在は示していない。
2. **総費用が不利になる可能性が高く、有利とする根拠が無い**。実モデルで同種の比較を反復する場合、#1737の実績では1試行24.6M〜126.9M tokenで、候補数に応じて増える見込み（単純な推測。手動方式Aの費用との対照は未実施で欠測）。ADR 0005は#1755の測定を費用の大きさからowner判断待ちとしている。Issueは無期限・高額な実験を開始しないこととし、費用上限もownerから示されていないため、Phase 1〜3は実施していない。
3. **ノイズの影響を受ける可能性がある**。2組で所要時間比が1.131〜1.908と揺れた（原因は未分離）。選別の回数が増えると、ノイズに基づく誤った採用の危険が増える一般的な懸念があるが、本調査では測っていない。これを抑えるための反復数・順序交替・閾値は、owner判断が要る数値であり、本書では確定しない。
4. **隔離が一般化できない**。上記3のとおり、評価用の隔離は固定fixtureと使い捨てrootの範囲。ASC本体のpathを候補Agentに変更させ、oracleを物理的に分離して保つ構成の実証は無い。ADR 0005は、Hostのsandboxを再実装せず、足りなければfail-closedで止めると定める。
5. **ADR 0005の例外7条件**：条件1（Hostに同等の能力が無い）は、Hostの汎用のAgent・worktree機能の範囲では満たさない可能性が高い。条件3（薄いadapterで解決できない）、条件5（対照評価）は示されていない。正式な導入を提案しない。

### 5.3 採否

**既存機能で十分（新しい機構は追加しない）**。具体的には、

- 改善案の比較は、従来どおり事前にプロトコルを固定し、`native-pair-summary`等の単発の組比較で行う。候補の自動反復は追加しない。
- 候補の生成が必要な場合は、Hostの標準のsubagentとGit worktreeを、技術担当が手動で使う（既存のASC Skillの範囲）。
- 製品へ入れる唯一の変更は、本書（評価の記録）である。Skill・CLI・CIは変更しない。配布物にも含めない。

## 6. 再開条件（反証条件）

次のいずれかが示されれば、この判断を見直す。

- ASC自身の改善で、既存の組比較では採否を下せなかった、または悪化を見逃した、実測された事例。
- 1試行あたりの費用を大幅に下げる安価な評価（決定論的なoracleのみで実モデルを呼ばない）が、実際の改善課題に存在すること。この場合は、候補の自動生成ではなく**評価の再現手順の薄い整備**を先に検討する。
- Hostが、候補の隔離・予算・評価を一体で提供する公式機能を持ったとき。ASC側の実装は不要になる。

## 7. ownerへの確認事項（案）

本調査は採用閾値・費用上限を確定していない。再開する場合に限り、次の判断が要る。

1. 実モデル実験の費用上限（token・課金・時間）。提案：1テーマにつき、既存#1737の1試行（約25M token）の数倍を上限の目安とする案。数値の確定はowner。
2. 採否の閾値の形式。提案：#1737と同様に、事前固定の「品質非劣性を必須条件、token・所要時間の中央値比を副条件」とし、反復数は2組以上、順序を交替する。
3. 対象テーマ。提案：候補が小さく、oracleが決定論的なもの（例：Reviewer corpusの検出力、検証コマンドの選択）から始める。
4. 「実装不要」で本Issueを閉じてよいか。本書は閉じる前提（Closes）で提出する。

## 8. 付記（Issue本文の記述との対応）

- 「`v05/evaluation/`は汎用の自己改善ループが実装済みであることを意味しない」という記述は、確認の結果、正しい。
- 未再現の不具合を「現在の欠陥」と断定していない。本書が示すのは、費用・ノイズ・隔離の範囲という、既存の記録から読める制約である。
