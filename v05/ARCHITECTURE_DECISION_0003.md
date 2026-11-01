# ADR 0003: リポジトリ派生グラフは効果を確認できるまで導入を保留する

2026-11-01。状態: 判断の記録（Issue #1614）。ownerは、利用者repositoryを隔離環境で読取り専用に使うこと、Node 24以上を前提にしてよいこと、価値が再現しなければ製品化を止めることを承認した。ownerはグラフ機能自体に反対しておらず、効果を確認できれば導入する方針である。この記録はruntime・CLI・Skill・配布物を変更しない。

## 決定

gitから決定的に再構築できる依存・ID追跡グラフ（v0.4のSemantic Graphに相当）の標準経路（runtime・CLI・Skill・既定の検証）への導入を保留する。不採用の確定ではない。[ADR 0002](ARCHITECTURE_DECISION_0002.md)の機構追加審査で求める「具体的な失敗」と「既存手段では足りない理由」を、利用者repositoryの実測で示せなかったためである。影響範囲の確認は、現行どおり実装者と独立Reviewerが呼出し元・関連仕様を必要な範囲で読む方式とする。

## 根拠（Phase 0）

利用者repository 6件（Rust、TypeScript、PHP、HCL、Python×2）とこのrepositoryを、network遮断containerで測った。PRの最初の非merge commitのfileを起点に、後続commitで初めて変更された既存fileを、グラフ（import依存の双方向1段＋共通IDの共有）と非グラフ基準（同一directory、過去1000 commitの同時変更）がどれだけ予測するかを数えた。同時変更はグラフと同じ件数に揃え、同一directoryは件数を揃えていない。レビュー指摘への是正commit（メッセージで識別）で追加されたfileを別に集計した。利用者repositoryの名前・path・内容は記録しない。

| 対象 | 是正で追加された既存file | グラフの再現率 | 同時変更（同件数）の再現率 | 非グラフ基準では予測できずグラフだけが予測した割合 | グラフの予測件数（PR平均） |
|---|---|---|---|---|---|
| Rust | 17 | 0% | 0% | 0% | 2.6 |
| TypeScript | 519 | 12.5% | 5.2% | 8.3%（43件、うち全件が2 PR） | 11.0 |
| PHP | 12 | 0% | 0% | 0% | 7.0 |
| HCL | 13 | 0% | 0% | 0% | 9.2 |
| Python | 435 | 32.6% | 28.5% | 5.1% | 95.2 |
| Python | 2,149 | 18.5% | 16.0% | 4.0% | 187.7 |
| このrepository | 485 | 26.4% | 24.9% | 4.5% | 52.7 |

結論は対象ごとに異なる。Python 2件とこのrepositoryでは、グラフは同件数の同時変更より再現率が1.5〜4.1ポイント高いが、予測件数が是正fileを持つPRの平均で53〜188件と多く、後から変更された全fileに対する精度は2〜4%にとどまる。Rust・PHP・HCLでは是正fileの母数が12〜17件と小さく、グラフは1件も予測しなかった。TypeScriptでは予測件数（是正fileを持つPRの平均）11件、後から変更された全fileに対する精度14%と絞れていて非グラフ基準を上回るが、グラフだけが予測したfileは2 PRに集中しており、再検討条件の上積み15%に届かない。対象全体で共通するのは、非グラフ基準に対する上積みが0〜8%と15%未満であることである。後から変更されたfileは、対象全体では既存fileより新規fileが多く（このrepositoryではほぼ同数）、新規fileはどの方式でも予測できない。判定の数値基準は測定前に固定していない。

限界：
- 後から変更されたfileは見落としの代理指標であり、計画的な分割commitも含む。
- 是正commitの識別はメッセージの字面による。`comment`や`nit`などを語境界なしで照合するため広めに拾う（このrepositoryの直近3000 commitでは、語境界付きの照合よりcommit単位で約4〜7%多い。レビュー時の手動確認で、利用者repositoryでは確認していない）。
- 同時変更は基点treeに存在するノイズ以外のfileから選び、グラフの件数（最低5件）に揃える。50 fileを超える過去commitは数えない。同一directoryは件数を揃えていないため、「グラフだけが予測した割合」はグラフの上積みの下限である。同件数での比較は表の同時変更の列を参照する。
- グラフは基点treeで構築するので、最初のcommitで新規作成したfileは起点にならない。別のfeature branchの上に積んだPRは、その下のbranchの最初のcommitを起点にする（最大150 commitで打ち切る）。
- Python・PHP・Rust・HCLの依存抽出は簡易規則で、公式の解決結果と照合していない。JavaScript/TypeScriptの解決は、tsconfigの`extends`配列の2件目以降と、`require`専用の`exports`条件を扱わない。測定対象にはどちらも存在しなかった（`extends`配列のtsconfigと、`exports`に`require`条件を持つworkspace package.jsonは、各repositoryの全履歴で一度も追加されていない）。TypeScriptの対象は`.astro`等のscript部分のimportも抽出して測り直した値である。TypeScriptの解決結果との照合（zod、vite）は、依存を導入したcheckoutで行った。zodは依存導入のためにroot `package.json`の`packageManager`を削除し、`pnpm-workspace.yaml`を追加している。どちらもimport解決には関与しない。現在の`resolver-oracle.mjs`はHEADと異なるcheckoutを拒否するため、再実行時は依存の導入方法を別に用意する。
- グラフの価値をReviewerの指摘の質で直接測る比較試験は行っていない。

## 再検討する条件

次のいずれかを利用者repositoryの実測で示せたら、新しいIssueで導入を検討する。下記の設計事項と評価資産を出発点とし、同じ測定を最新の利用者repositoryで再実行して比較する。

- 依存・追跡情報の欠如が原因と特定できる見落とし（障害、差戻し、レビュー指摘）が繰り返し発生している。
- 予測件数をPR平均20件以下に絞った状態で、非グラフ基準に対する上積みが15%以上ある。
- 同じ候補・要求・正解を使う比較試験で、影響範囲を渡したReviewerの見落としが再現性をもって減る。

## 作る場合に確定している設計事項

再検討時に同じ誤りを繰り返さないため、試作で確かめた事項を残す。測定値は[評価記録](evaluation/repository-graph/REPOSITORY_GRAPH_EVIDENCE.json)にある。

- **層の分け方。** blobの内容と抽出器の版だけで決まる事実（L1）と、tree全体で決まる解決結果（L2）を分ける。L1にpath・設定・他fileの有無に依存する値を入れない。import指定子は生の文字列で持ち、tsconfig・package.jsonの値もblob単位の事実として抽出してL2で結合する。
- **増分更新の無効化。** 変更されたfileだけを解決し直すと、file追加・削除・package名変更などで他fileの解決が変わったことを取りこぼす（zod・viteの998回の更新のうち3回。4 repository計1,596回でも3回）。解決時に試した候補pathを、命中しなかったものも含めて記録し、追加・削除・設定変更から再解決の範囲を引く。この方式は公開repository 4件の計1,596回の増分更新で全再構築と完全に一致した。ただし実履歴だけでは無効化規則の一部が一度も働かず、規則を1つ外した変異が生存した。各規則を狙う合成commit列（[synthetic-invalidation.mjs](evaluation/repository-graph/synthetic-invalidation.mjs)）を必須の回帰とする。
- **保存。** treeごとにedgeを複写する方式は採らない（コード約15,000 fileのrepositoryで1 treeあたり208 MB、増分の書込み中央値3.6秒、初回と増分29回の計30 treeで4.6 GB）。解決結果を「対象blobと試行候補の結果と設定blob」のhashで共有すると、treeごとの複写に比べて行数が9〜21分の1になり（評価記録の`contentAddressedResults`）、同一keyで結果が食い違った例は0件だった。中規模（コード約1,500 file）では全再構築がメモリ上で中央値約0.1秒・p95約0.5秒であり、保存自体が不要な場合が多い。
- **問い合わせ。** SQLiteの再帰CTEで逆到達を書くと、plannerが`dst`側の索引を使わず全edgeを走査する（評価記録の`storage[].naivePlan`。コード約15,000 fileのrepositoryでは5分を超えても返らなかった。この時間は手動観測）。`FROM r CROSS JOIN edge e ON e.dst = r.n`で結合順を固定し、`EXPLAIN QUERY PLAN`を回帰で確認する。
- **未commitの作業tree。** 実indexの複製へ`git add -A`して`write-tree`すると、作業treeを約70〜300 ms（コード約1,500〜15,000 file）でtree hashにできる。この値は評価記録に含まない手動測定である。
- **ID追跡。** IDの定義位置は推測せずプロジェクトで宣言させる（このrepositoryの旧仕様では受入条件が`- 受け入れ条件:`行で定義されていた）。範囲表記（例：`-01〜06`）を展開しないと解決済み参照の4割前後（37〜44%）を失う。生成されるID、別文書のID、廃止済みIDは未解決として理由付きで残す。
- **言語。** 利用者repositoryの大半はJavaScript/TypeScript以外である。TypeScript本体を同梱する方式は配布方針に合わない。
- **実行履歴。** runごとのGit ref（`refs/asc/runs/<id>`）へeventを追記する方式は、ローカルの共有repositoryで衝突回避・競合時の拒否・gc耐性・決定的な再構築を確認した。ただしADR 0002の「新しいJournalを前提にしない」に当たるため、既存のPR・CI・`worktree-verify`の記録で足りないことを示すまで採らない。GitHub上での受付・保持は確認していない。

## 評価資産

`v05/evaluation/repository-graph/`の測定scriptはソースrepository用の評価資産で、配布物（`package.json`の`files`）に含めない。`prototype.mjs`はTypeScript devDependencyを使う試作であり、製品実装ではない。

```sh
D=v05/evaluation/repository-graph
node $D/synthetic-invalidation.mjs [out.json]                   # 無効化規則の合成回帰（失敗時は非0終了）
node $D/history-equivalence.mjs <repo> <N> <out.jsonl>          # 増分更新と全再構築の等価性
node $D/resolver-oracle.mjs <repo> <checkout-with-deps> <out.json>  # TypeScriptの解決結果との照合
node $D/storage.mjs <repo> <db-file> <out.json> [K]             # SQLite保存・書込み・CTE/BFS・SCC
node $D/content-addressed.mjs <repo> <N>                        # 解決結果の内容hash共有
node $D/synthetic-reachability.mjs [nodes] [edges] <db-file> [out.json]
node $D/trace-test262.mjs <test262> <ecma262> [out.json]
node $D/trace-asc.mjs <full-clone-of-this-repo> [out.json]
node $D/execution-history-refs.mjs [runs] [out.json]
node $D/phase0.mjs <repo> <default-branch> <out.jsonl> [maxPRs]
node $D/phase0-summary.mjs <out.jsonl>...
node $D/build-evidence.mjs <config.json> > $D/REPOSITORY_GRAPH_EVIDENCE.json
```

scriptはNode 24で実行した（`storage.mjs`等は`node:sqlite`を使うため、Node 20では起動しない）。`phase0.mjs`は`refs/pull/*/head`を取得済みのcloneを前提とする。利用者repositoryを測る場合は隔離環境で行う。`phase0.mjs`の生の出力は確認用にfile pathの例を含むためcommitしない。公開するのは`build-evidence.mjs`が出力する集計値だけとし、匿名IDと実repositoryの対応を書いたconfigもrepositoryの外に置く。手動観測と明記した値を除き、本書の数値は評価記録から再生成できる。
